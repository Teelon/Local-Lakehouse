import os
import io
import time
import uuid
import logging
from contextlib import asynccontextmanager
from typing import Optional, Dict, Any

import boto3
import duckdb
from fastapi import FastAPI, HTTPException, status, UploadFile, File, Form, Request
from pydantic import BaseModel, Field

from app.pipelines.cleaner import IngestionCleaner
from app.pipelines.committer import DuckLakeCommitter

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("lakehouse-worker")

DATABASE_URI = os.getenv("DATABASE_URI", "postgres://lakehouse_admin:lakehouse_secret_change_me@postgres:5432/lakehouse")
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://storage:9000")
S3_ACCESS_KEY = os.getenv("S3_ROOT_USER", "lakehouse_storage_admin")
S3_SECRET_KEY = os.getenv("S3_ROOT_PASSWORD", "storage_secret_change_me")
S3_BUCKET = os.getenv("S3_BUCKET_NAME", "lakehouse-bucket")
S3_REGION = os.getenv("S3_REGION", "us-east-1")

s3_client = boto3.client(
    "s3",
    endpoint_url=S3_ENDPOINT,
    aws_access_key_id=S3_ACCESS_KEY,
    aws_secret_access_key=S3_SECRET_KEY,
    region_name=S3_REGION,
)

# Shared DuckDB connection for queries & tables
con = duckdb.connect(database="/tmp/lakehouse.duckdb")

def configure_duckdb_s3():
    """Configures DuckDB's httpfs extension for S3-compatible RustFS."""
    try:
        con.install_extension("httpfs")
        con.load_extension("httpfs")
        endpoint_clean = S3_ENDPOINT.replace("http://", "").replace("https://", "")
        use_ssl = "true" if S3_ENDPOINT.startswith("https://") else "false"
        con.execute(f"SET s3_endpoint='{endpoint_clean}';")
        con.execute(f"SET s3_access_key_id='{S3_ACCESS_KEY}';")
        con.execute(f"SET s3_secret_access_key='{S3_SECRET_KEY}';")
        con.execute(f"SET s3_use_ssl={use_ssl};")
        con.execute("SET s3_url_style='path';")
        con.execute(f"SET s3_region='{S3_REGION}';")
        logger.info("DuckDB httpfs extension successfully configured for RustFS S3.")
    except Exception as e:
        logger.error(f"Failed to configure DuckDB S3: {e}")

def init_s3_bucket():
    """Ensures primary lakehouse bucket exists in RustFS."""
    try:
        existing = [b["Name"] for b in s3_client.list_buckets().get("Buckets", [])]
        if S3_BUCKET not in existing:
            s3_client.create_bucket(Bucket=S3_BUCKET)
            logger.info(f"Created primary lakehouse bucket: {S3_BUCKET}")
        else:
            logger.info(f"Primary lakehouse bucket '{S3_BUCKET}' verified.")
    except Exception as e:
        logger.error(f"Error initializing bucket {S3_BUCKET}: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_s3_bucket()
    configure_duckdb_s3()
    sync_all_tables_from_storage()
    yield

app = FastAPI(
    title="Lakehouse Processing Worker",
    version="0.1.0",
    description="Asynchronous ingestion, validation, and DuckLake table committer",
    lifespan=lifespan,
)

class IngestJobRequest(BaseModel):
    job_id: str
    tenant_id: str
    table_name: str
    file_path: str
    file_format: str = Field(..., description="csv, json, or parquet")
    sts_credentials: Optional[Dict[str, Any]] = None

class CreateGoldViewRequest(BaseModel):
    tenant_id: str
    view_name: str
    query: str

class MaterializeGoldTableRequest(BaseModel):
    tenant_id: str
    table_name: str
    query: str

class DeleteDatasetRequest(BaseModel):
    tenant_id: str
    name: str
    layer: str = "silver" # "silver" or "gold"
    object_type: str = "table" # "table" or "view"

class HardDeleteTenantRequest(BaseModel):
    tenant_id: str

class CreateTenantRequest(BaseModel):
    tenant_id: str
    name: Optional[str] = None

@app.get("/healthz", status_code=status.HTTP_200_OK)
def health_check():
    return {"status": "healthy", "service": "lakehouse-worker"}

def ensure_tenant_schemas(tenant_id: str):
    """Ensures {tenant_id}_silver and {tenant_id}_gold schemas exist in DuckDB."""
    try:
        con.execute(f"CREATE SCHEMA IF NOT EXISTS {tenant_id}_silver;")
        con.execute(f"CREATE SCHEMA IF NOT EXISTS {tenant_id}_gold;")
    except Exception as e:
        logger.warning(f"Error ensuring schemas for {tenant_id}: {e}")

def sync_tenant_tables_from_storage(tenant_id: str):
    """
    Auto-discovers and registers existing Parquet tables and views in RustFS S3 into DuckDB.
    Guarantees tables and views are always visible and queryable even after container restart.
    """
    try:
        ensure_tenant_schemas(tenant_id)
        configure_duckdb_s3()

        # 1. Discover Silver tables: tenants/{tenant_id}/tables/{table_name}/
        silver_prefix = f"tenants/{tenant_id}/tables/"
        res_silver = s3_client.list_objects_v2(Bucket=S3_BUCKET, Prefix=silver_prefix, Delimiter="/")
        for cp in res_silver.get("CommonPrefixes", []):
            parts = cp["Prefix"].strip("/").split("/")
            if len(parts) >= 4:
                tbl_name = parts[3]
                tbl_objs = s3_client.list_objects_v2(Bucket=S3_BUCKET, Prefix=cp["Prefix"], MaxKeys=2)
                has_parquet = any(o["Key"].endswith(".parquet") for o in tbl_objs.get("Contents", []))
                if has_parquet:
                    glob_uri = f"s3://{S3_BUCKET}/tenants/{tenant_id}/tables/{tbl_name}/*.parquet"
                    silver_qualified = f"{tenant_id}_silver.{tbl_name}"
                    legacy_name = f"{tenant_id}_{tbl_name}"
                    try:
                        con.execute(f"CREATE OR REPLACE VIEW {silver_qualified} AS SELECT * FROM read_parquet('{glob_uri}', union_by_name=true);")
                        con.execute(f"CREATE OR REPLACE VIEW {legacy_name} AS SELECT * FROM {silver_qualified};")
                    except Exception as ex:
                        logger.warning(f"Could not register view {silver_qualified}: {ex}")

        # 2. Discover Gold materialized tables: tenants/{tenant_id}/gold/{table_name}/
        gold_prefix = f"tenants/{tenant_id}/gold/"
        res_gold = s3_client.list_objects_v2(Bucket=S3_BUCKET, Prefix=gold_prefix, Delimiter="/")
        for cp in res_gold.get("CommonPrefixes", []):
            parts = cp["Prefix"].strip("/").split("/")
            if len(parts) >= 4:
                tbl_name = parts[3]
                tbl_objs = s3_client.list_objects_v2(Bucket=S3_BUCKET, Prefix=cp["Prefix"], MaxKeys=2)
                has_parquet = any(o["Key"].endswith(".parquet") for o in tbl_objs.get("Contents", []))
                if has_parquet:
                    gold_glob = f"s3://{S3_BUCKET}/tenants/{tenant_id}/gold/{tbl_name}/*.parquet"
                    gold_qualified = f"{tenant_id}_gold.{tbl_name}"
                    try:
                        con.execute(f"CREATE OR REPLACE VIEW {gold_qualified} AS SELECT * FROM read_parquet('{gold_glob}', union_by_name=true);")
                    except Exception as ex:
                        logger.warning(f"Could not register gold view {gold_qualified}: {ex}")
    except Exception as e:
        logger.warning(f"Error syncing tenant tables from storage for {tenant_id}: {e}")

def sync_all_tables_from_storage():
    """Syncs tables across all tenant folders found in RustFS."""
    try:
        configure_duckdb_s3()
        res = s3_client.list_objects_v2(Bucket=S3_BUCKET, Prefix="tenants/", Delimiter="/")
        for cp in res.get("CommonPrefixes", []):
            parts = cp["Prefix"].strip("/").split("/")
            if len(parts) >= 2:
                tid = parts[1]
                sync_tenant_tables_from_storage(tid)
    except Exception as e:
        logger.warning(f"Error syncing all tables from storage: {e}")


@app.post("/api/v1/pipeline/upload-and-commit")
async def upload_and_commit(
    tenant_id: str = Form(...),
    table_name: str = Form(...),
    file: UploadFile = File(...)
):
    """
    Receives an uploaded CSV/JSON/Parquet file:
    1. Uploads the raw object directly to RustFS at s3://{S3_BUCKET}/tenants/{tenant_id}/raw/{filename}.
    2. Cleans and normalizes columns using DuckDB & IngestionCleaner.
    3. Commits the resulting table as Parquet into RustFS under tenants/{tenant_id}/tables/{table_name}/.
    4. Registers table in {tenant_id}_silver.{table_name} and alias {tenant_id}_{table_name}.
    """
    try:
        content = await file.read()
        filename = file.filename or "data.csv"

        # Ensure bucket exists and S3 is wired
        init_s3_bucket()
        configure_duckdb_s3()
        ensure_tenant_schemas(tenant_id)

        # 1. Store raw file into RustFS S3 under tenant prefix (Bronze)
        raw_key = f"tenants/{tenant_id}/raw/{filename}"
        raw_s3_uri = f"s3://{S3_BUCKET}/{raw_key}"
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=raw_key,
            Body=content
        )
        logger.info(f"Saved raw file to RustFS at {raw_s3_uri}")

        silver_table_name = f"{tenant_id}_silver.{table_name}"
        full_table_name = f"{tenant_id}_{table_name}"
        logger.info(f"Processing raw file from {raw_s3_uri} for table {silver_table_name}...")

        # 2. Ingest and sanitize schema via IngestionCleaner reading directly from S3
        if filename.endswith(".csv"):
            rel = IngestionCleaner.process_csv(raw_s3_uri, con)
        elif filename.endswith(".parquet"):
            rel = IngestionCleaner.process_parquet(raw_s3_uri, con)
        elif filename.endswith(".json") or filename.endswith(".ndjson"):
            rel = IngestionCleaner.process_json(raw_s3_uri, con)
        else:
            rel = IngestionCleaner.process_csv(raw_s3_uri, con)

        # 3. Commit Parquet files directly into RustFS S3 under tenant table prefix (Silver)
        clean_fn = "".join(c if c.isalnum() else "_" for c in filename.split(".")[0])
        part_filename = f"part_{int(time.time())}_{uuid.uuid4().hex[:8]}_{clean_fn}.parquet"
        parquet_key = f"tenants/{tenant_id}/tables/{table_name}/{part_filename}"
        parquet_s3_uri = f"s3://{S3_BUCKET}/{parquet_key}"

        con.register("temp_clean_source", rel)
        con.execute(f"COPY (SELECT * FROM temp_clean_source) TO '{parquet_s3_uri}' (FORMAT PARQUET);")
        logger.info(f"Committed Parquet part to RustFS at {parquet_s3_uri}")

        # 4. Register Silver view/table in DuckDB over the entire table directory (*.parquet)
        table_glob_uri = f"s3://{S3_BUCKET}/tenants/{tenant_id}/tables/{table_name}/*.parquet"
        try:
            con.execute(f"DROP VIEW IF EXISTS {silver_table_name};")
            con.execute(f"DROP TABLE IF EXISTS {silver_table_name};")
            con.execute(f"DROP VIEW IF EXISTS {full_table_name};")
            con.execute(f"DROP TABLE IF EXISTS {full_table_name};")
        except Exception:
            pass

        con.execute(f"CREATE OR REPLACE VIEW {silver_table_name} AS SELECT * FROM read_parquet('{table_glob_uri}', union_by_name=true);")
        # Legacy/convenience alias
        con.execute(f"CREATE OR REPLACE VIEW {full_table_name} AS SELECT * FROM {silver_table_name};")

        row_count = con.execute(f"SELECT COUNT(*) FROM {silver_table_name}").fetchone()[0]
        columns = con.execute(f"PRAGMA table_info('{silver_table_name}')").fetchall()
        col_names = [col[1] for col in columns]

        return {
            "success": True,
            "tenant_id": tenant_id,
            "table_name": silver_table_name,
            "legacy_name": full_table_name,
            "layer": "silver",
            "row_count": row_count,
            "columns": col_names,
            "raw_s3_uri": raw_s3_uri,
            "parquet_s3_uri": parquet_s3_uri,
            "message": f"Successfully committed {row_count} rows to Silver layer ({silver_table_name})."
        }
    except Exception as e:
        logger.exception("Pipeline ingestion to RustFS failed")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/jobs/ingest")
async def ingest_job(req: IngestJobRequest):
    """
    Asynchronously processes a file ingestion job:
    1. Reads raw file from RustFS S3.
    2. Cleans and normalizes columns using IngestionCleaner.
    3. Commits Parquet file under tenants/{tenant_id}/tables/{table_name}/.
    4. Registers table under {tenant_id}_silver.{table_name} (and backward compatible {tenant_id}_{table_name}).
    """
    try:
        start_time = time.time()
        init_s3_bucket()
        configure_duckdb_s3()
        ensure_tenant_schemas(req.tenant_id)

        # Normalize raw path
        raw_path = req.file_path.strip()
        if not raw_path.startswith("s3://"):
            raw_s3_uri = f"s3://{S3_BUCKET}/{raw_path.lstrip('/')}"
        else:
            raw_s3_uri = raw_path

        silver_table_name = f"{req.tenant_id}_silver.{req.table_name}"
        full_table_name = f"{req.tenant_id}_{req.table_name}"
        logger.info(f"[Job {req.job_id}] Processing raw file from {raw_s3_uri} for table {silver_table_name}...")

        # Ingest and sanitize schema
        fmt = (req.file_format or "").lower()
        if fmt == "csv" or raw_s3_uri.endswith(".csv"):
            rel = IngestionCleaner.process_csv(raw_s3_uri, con)
        elif fmt == "parquet" or raw_s3_uri.endswith(".parquet"):
            rel = IngestionCleaner.process_parquet(raw_s3_uri, con)
        elif fmt in ["json", "ndjson"] or raw_s3_uri.endswith(".json") or raw_s3_uri.endswith(".ndjson"):
            rel = IngestionCleaner.process_json(raw_s3_uri, con)
        else:
            rel = IngestionCleaner.process_csv(raw_s3_uri, con)

        # Commit unique Parquet part to RustFS S3 under Silver tables prefix
        clean_job = "".join(c if c.isalnum() else "_" for c in req.job_id)
        part_filename = f"part_{int(time.time())}_{uuid.uuid4().hex[:6]}_{clean_job}.parquet"
        parquet_key = f"tenants/{req.tenant_id}/tables/{req.table_name}/{part_filename}"
        parquet_s3_uri = f"s3://{S3_BUCKET}/{parquet_key}"

        con.register("temp_clean_source", rel)
        con.execute(f"COPY (SELECT * FROM temp_clean_source) TO '{parquet_s3_uri}' (FORMAT PARQUET);")
        logger.info(f"[Job {req.job_id}] Committed Parquet part to RustFS at {parquet_s3_uri}")

        # Register queryable view in DuckDB over all parts in table folder under {tenant_id}_silver
        table_glob_uri = f"s3://{S3_BUCKET}/tenants/{req.tenant_id}/tables/{req.table_name}/*.parquet"
        try:
            con.execute(f"DROP VIEW IF EXISTS {silver_table_name};")
            con.execute(f"DROP TABLE IF EXISTS {silver_table_name};")
            con.execute(f"DROP VIEW IF EXISTS {full_table_name};")
            con.execute(f"DROP TABLE IF EXISTS {full_table_name};")
        except Exception:
            pass

        con.execute(f"CREATE OR REPLACE VIEW {silver_table_name} AS SELECT * FROM read_parquet('{table_glob_uri}', union_by_name=true);")
        con.execute(f"CREATE OR REPLACE VIEW {full_table_name} AS SELECT * FROM {silver_table_name};")

        row_count = con.execute(f"SELECT COUNT(*) FROM {silver_table_name}").fetchone()[0]
        columns_info = con.execute(f"PRAGMA table_info('{silver_table_name}')").fetchall()
        col_names = [col[1] for col in columns_info]

        duration_seconds = round(time.time() - start_time, 2)
        duration_ms = int(duration_seconds * 1000)

        return {
            "success": True,
            "job_id": req.job_id,
            "tenant_id": req.tenant_id,
            "table_name": silver_table_name,
            "legacy_name": full_table_name,
            "layer": "silver",
            "ducklake_table": silver_table_name,
            "row_count": row_count,
            "columns": col_names,
            "duration": duration_seconds,
            "duration_seconds": duration_seconds,
            "duration_ms": duration_ms,
            "raw_s3_uri": raw_s3_uri,
            "parquet_s3_uri": parquet_s3_uri,
            "message": f"Successfully ingested into Silver layer '{silver_table_name}'. Total cumulative rows: {row_count}.",
        }
    except Exception as e:
        logger.exception(f"[Job {req.job_id}] Ingestion failed")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/gold/view")
async def create_gold_view(req: CreateGoldViewRequest):
    """
    Creates or replaces a Gold SQL view (default Gold object):
    CREATE VIEW {tenant_id}_gold.{view_name} AS {query}
    Zero Parquet storage footprint, live dynamic evaluation.
    """
    try:
        configure_duckdb_s3()
        ensure_tenant_schemas(req.tenant_id)

        clean_view_name = req.view_name.strip().replace('"', '').replace("'", "")
        qualified_name = f"{req.tenant_id}_gold.{clean_view_name}"

        # Clean DDL statement
        sql_stmt = f"CREATE OR REPLACE VIEW {qualified_name} AS {req.query.strip().rstrip(';')};"
        con.execute(sql_stmt)
        logger.info(f"Created Gold view: {qualified_name}")

        columns_info = con.execute(f"PRAGMA table_info('{qualified_name}')").fetchall()
        col_names = [col[1] for col in columns_info]

        return {
            "success": True,
            "tenant_id": req.tenant_id,
            "name": clean_view_name,
            "full_name": qualified_name,
            "layer": "gold",
            "object_type": "view",
            "columns": col_names,
            "message": f"Gold view '{qualified_name}' successfully created.",
        }
    except Exception as e:
        logger.exception(f"Failed to create Gold view {req.view_name}")
        raise HTTPException(status_code=400, detail=f"Failed to create Gold view: {str(e)}")

@app.post("/api/v1/gold/materialize")
async def materialize_gold_table(req: MaterializeGoldTableRequest):
    """
    Materializes a Gold table (explicit opt-in escape hatch):
    Writes Parquet to s3://{S3_BUCKET}/tenants/{tenant_id}/gold/{table_name}/*.parquet
    and registers {tenant_id}_gold.{table_name}.
    """
    try:
        init_s3_bucket()
        configure_duckdb_s3()
        ensure_tenant_schemas(req.tenant_id)

        clean_table_name = req.table_name.strip().replace('"', '').replace("'", "")
        qualified_name = f"{req.tenant_id}_gold.{clean_table_name}"

        # 1. Execute query and write Parquet under tenants/{tenant_id}/gold/{table_name}/
        part_filename = f"gold_{int(time.time())}_{uuid.uuid4().hex[:6]}.parquet"
        parquet_key = f"tenants/{req.tenant_id}/gold/{clean_table_name}/{part_filename}"
        parquet_s3_uri = f"s3://{S3_BUCKET}/{parquet_key}"

        # Drop old definition if was a view or table
        try:
            con.execute(f"DROP VIEW IF EXISTS {qualified_name};")
            con.execute(f"DROP TABLE IF EXISTS {qualified_name};")
        except Exception:
            pass

        con.execute(f"COPY ({req.query.strip().rstrip(';')}) TO '{parquet_s3_uri}' (FORMAT PARQUET);")
        logger.info(f"Materialized Gold table Parquet to {parquet_s3_uri}")

        # 2. Register table over the gold parquet prefix
        gold_glob_uri = f"s3://{S3_BUCKET}/tenants/{req.tenant_id}/gold/{clean_table_name}/*.parquet"
        con.execute(f"CREATE OR REPLACE VIEW {qualified_name} AS SELECT * FROM read_parquet('{gold_glob_uri}', union_by_name=true);")

        row_count = con.execute(f"SELECT COUNT(*) FROM {qualified_name}").fetchone()[0]
        columns_info = con.execute(f"PRAGMA table_info('{qualified_name}')").fetchall()
        col_names = [col[1] for col in columns_info]

        return {
            "success": True,
            "tenant_id": req.tenant_id,
            "name": clean_table_name,
            "full_name": qualified_name,
            "layer": "gold",
            "object_type": "table",
            "row_count": row_count,
            "columns": col_names,
            "parquet_s3_uri": parquet_s3_uri,
            "message": f"Gold table '{qualified_name}' successfully materialized ({row_count} rows).",
        }
    except Exception as e:
        logger.exception(f"Failed to materialize Gold table {req.table_name}")
        raise HTTPException(status_code=400, detail=f"Failed to materialize Gold table: {str(e)}")

@app.post("/api/v1/datasets/delete")
async def delete_dataset(req: DeleteDatasetRequest):
    """
    Deletes a single dataset (Silver table, Gold view, or Gold materialized table).
    1. For Gold view: drop view from DuckDB catalog (metadata-only, zero storage).
    2. For Silver table or Gold materialized table:
       - Drop table/view from DuckDB catalog
       - Purge specific RustFS prefix (tenants/{tenant_id}/tables/{name}/ or tenants/{tenant_id}/gold/{name}/)
    """
    try:
        configure_duckdb_s3()
        layer = req.layer.lower()
        schema_name = f"{req.tenant_id}_{layer}"
        qualified_name = f"{schema_name}.{req.name}"

        # 1. Drop catalog entry
        try:
            con.execute(f"DROP VIEW IF EXISTS {qualified_name};")
            con.execute(f"DROP TABLE IF EXISTS {qualified_name};")
            # Also drop legacy flat name if in silver
            if layer == "silver":
                con.execute(f"DROP VIEW IF EXISTS {req.tenant_id}_{req.name};")
        except Exception as e:
            logger.warning(f"Drop catalog warning: {e}")

        # 2. Purge RustFS storage if table
        storage_deleted = False
        if req.object_type != "view":
            prefix = f"tenants/{req.tenant_id}/{'tables' if layer == 'silver' else 'gold'}/{req.name}/"
            logger.info(f"Deleting storage objects under prefix: {prefix}")
            try:
                paginator = s3_client.get_paginator('list_objects_v2')
                pages = paginator.paginate(Bucket=S3_BUCKET, Prefix=prefix)
                for page in pages:
                    if 'Contents' in page:
                        delete_keys = [{'Key': obj['Key']} for obj in page['Contents']]
                        if delete_keys:
                            s3_client.delete_objects(Bucket=S3_BUCKET, Delete={'Objects': delete_keys})
                            storage_deleted = True
            except Exception as e:
                logger.error(f"Error purging storage for {prefix}: {e}")

        return {
            "success": True,
            "tenant_id": req.tenant_id,
            "name": req.name,
            "layer": layer,
            "object_type": req.object_type,
            "storage_purged": storage_deleted,
            "message": f"Successfully deleted {req.object_type} '{qualified_name}'.",
        }
    except Exception as e:
        logger.exception("Failed to delete dataset")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/tenants")
async def list_tenants():
    """Lists all tenants discovered across S3 object storage."""
    try:
        init_s3_bucket()
        res = s3_client.list_objects_v2(Bucket=S3_BUCKET, Prefix="tenants/", Delimiter="/")
        tenants = []
        for cp in res.get("CommonPrefixes", []):
            parts = cp["Prefix"].strip("/").split("/")
            if len(parts) >= 2:
                tenants.append(parts[1])
        return {"tenants": sorted(list(set(tenants)))}
    except Exception as e:
        logger.exception("Failed to list tenants from S3")
        return {"tenants": []}

@app.post("/api/v1/tenants")
async def create_tenant(req: CreateTenantRequest):
    """Initializes schemas and storage prefix for a new tenant."""
    try:
        init_s3_bucket()
        configure_duckdb_s3()
        ensure_tenant_schemas(req.tenant_id)
        # Put empty init marker in S3
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=f"tenants/{req.tenant_id}/.init",
            Body=b"initialized"
        )
        return {"success": True, "tenant_id": req.tenant_id}
    except Exception as e:
        logger.exception("Failed to initialize tenant")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/tenants/hard-delete")
async def hard_delete_tenant(req: HardDeleteTenantRequest):
    """
    Executes an idempotent multi-step async hard delete of all tenant resources:
    1. Drop all Gold schema objects (views and materialized tables)
    2. Drop all Silver schema tables
    3. Drop tenant schemas ({tenant_id}_gold, {tenant_id}_silver)
    4. Purge all RustFS objects under tenants/{tenant_id}/* (raw, tables, gold)
    """
    steps_completed = []
    try:
        configure_duckdb_s3()
        tid = req.tenant_id

        # Step 1: Drop Gold schema
        try:
            con.execute(f"DROP SCHEMA IF EXISTS {tid}_gold CASCADE;")
            steps_completed.append("drop_gold_schema")
        except Exception as e:
            logger.warning(f"Failed to drop gold schema {tid}_gold: {e}")

        # Step 2: Drop Silver schema and legacy aliases
        try:
            con.execute(f"DROP SCHEMA IF EXISTS {tid}_silver CASCADE;")
            # Drop any remaining legacy tables starting with {tid}_
            tables = [t[0] for t in con.execute("SHOW TABLES;").fetchall() if t[0].startswith(f"{tid}_")]
            for t in tables:
                con.execute(f"DROP VIEW IF EXISTS {t};")
            steps_completed.append("drop_silver_schema")
        except Exception as e:
            logger.warning(f"Failed to drop silver schema {tid}_silver: {e}")

        # Step 3: Purge entire RustFS prefix tenants/{tenant_id}/*
        tenant_prefix = f"tenants/{tid}/"
        logger.info(f"Purging all RustFS objects under {tenant_prefix}...")
        try:
            paginator = s3_client.get_paginator('list_objects_v2')
            pages = paginator.paginate(Bucket=S3_BUCKET, Prefix=tenant_prefix)
            for page in pages:
                if 'Contents' in page:
                    delete_keys = [{'Key': obj['Key']} for obj in page['Contents']]
                    if delete_keys:
                        s3_client.delete_objects(Bucket=S3_BUCKET, Delete={'Objects': delete_keys})
            steps_completed.append("purge_storage_prefix")
        except Exception as e:
            logger.error(f"Error purging prefix {tenant_prefix}: {e}")
            raise e

        return {
            "success": True,
            "tenant_id": tid,
            "steps_completed": steps_completed,
            "message": f"Successfully hard-deleted all storage and catalog resources for tenant '{tid}'.",
        }
    except Exception as e:
        logger.exception(f"Hard delete failed for tenant {req.tenant_id}")
        raise HTTPException(status_code=500, detail={"error": str(e), "steps_completed": steps_completed})

@app.get("/api/v1/tables")
async def list_tables(tenant_id: Optional[str] = None):
    """
    Lists tables and views grouped by Medallion layer (Silver / Gold) for the specified tenant.
    """
    try:
        configure_duckdb_s3()
        if tenant_id:
            sync_tenant_tables_from_storage(tenant_id)
        else:
            sync_all_tables_from_storage()

        # Introspect schemas from DuckDB
        schema_query = """
        SELECT table_schema, table_name, table_type 
        FROM information_schema.tables 
        WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'temp')
        """
        all_objs = con.execute(schema_query).fetchall()

        tables_data = []
        for row in all_objs:
            schema, name, tbl_type = row[0], row[1], row[2]
            if name == "temp_clean_source":
                continue

            layer = "silver"
            obj_type = "view" if "VIEW" in (tbl_type or "").upper() else "table"

            # Check if matching tenant
            if tenant_id:
                if schema == f"{tenant_id}_silver":
                    layer = "silver"
                elif schema == f"{tenant_id}_gold":
                    layer = "gold"
                elif schema == "main" and name.startswith(f"{tenant_id}_"):
                    # Legacy flat name in main schema
                    layer = "silver"
                else:
                    continue
            else:
                if "_silver" in schema:
                    layer = "silver"
                elif "_gold" in schema:
                    layer = "gold"

            # Determine qualified name
            if schema == "main":
                qualified_name = name
                display_name = name[len(tenant_id) + 1:] if (tenant_id and name.startswith(f"{tenant_id}_")) else name
            else:
                qualified_name = f"{schema}.{name}"
                display_name = name

            try:
                info = con.execute(f"PRAGMA table_info('{qualified_name}');").fetchall()
                cols = [{"name": c[1], "type": c[2]} for c in info]
            except Exception:
                cols = []

            tables_data.append({
                "name": display_name,
                "full_name": qualified_name,
                "schema": schema,
                "layer": layer,
                "type": obj_type,
                "columns": cols
            })

        # Deduplicate if both qualified and legacy names exist
        unique_tables = []
        seen = set()
        for t in tables_data:
            key = (t["layer"], t["name"])
            if key not in seen:
                seen.add(key)
                unique_tables.append(t)

        return {
            "tenant_id": tenant_id,
            "tables": unique_tables
        }
    except Exception as e:
        logger.exception("Failed to list tables")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/query")
async def run_query(request: Request):
    """Executes a query against the committed tables (accepts JSON or Form data)."""
    try:
        content_type = request.headers.get("content-type", "")
        tenant_id = None
        if "application/json" in content_type:
            body = await request.json()
            sql_query = (body.get("query") if isinstance(body, dict) else "") or ""
            if isinstance(body, dict):
                tenant_id = body.get("tenant_id")
        else:
            form = await request.form()
            sql_query = form.get("query") or ""
            tenant_id = form.get("tenant_id")

        if not sql_query.strip():
            raise HTTPException(status_code=400, detail="Query cannot be empty")

        configure_duckdb_s3()
        if tenant_id:
            sync_tenant_tables_from_storage(tenant_id)

        rel = con.sql(sql_query)
        columns = rel.columns
        rows = [list(r) for r in rel.fetchall()]
        return {
            "columns": columns,
            "rows": rows,
            "row_count": len(rows)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


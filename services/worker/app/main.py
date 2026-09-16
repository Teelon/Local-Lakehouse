import os
import io
import time
import uuid
import logging
from contextlib import asynccontextmanager
from typing import Optional, Dict, Any, List

import boto3
import duckdb
from fastapi import FastAPI, HTTPException, status, UploadFile, File, Form, Request
from pydantic import BaseModel, Field

from app.pipelines.cleaner import IngestionCleaner
from app.pipelines.committer import DuckLakeCommitter

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("lakehouse-worker")

# ---------------------------------------------------------------------------
# Environment / configuration
# ---------------------------------------------------------------------------

DATABASE_URI = os.getenv(
    "DATABASE_URI",
    "postgres://lakehouse_admin:lakehouse_secret_change_me@postgres:5432/lakehouse",
)
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://storage:9000")
S3_ACCESS_KEY = os.getenv("S3_ROOT_USER", "lakehouse_storage_admin")
S3_SECRET_KEY = os.getenv("S3_ROOT_PASSWORD", "storage_secret_change_me")
S3_BUCKET = os.getenv("S3_BUCKET_NAME", "lakehouse-bucket")
S3_REGION = os.getenv("S3_REGION", "us-east-1")

# S3 key prefix used as the DuckLake DATA_PATH root.
# DuckLake manages its own file layout underneath this prefix.
DUCKLAKE_DATA_PATH = f"s3://{S3_BUCKET}/ducklake/"

# ---------------------------------------------------------------------------
# Module-level clients
# ---------------------------------------------------------------------------

s3_client = boto3.client(
    "s3",
    endpoint_url=S3_ENDPOINT,
    aws_access_key_id=S3_ACCESS_KEY,
    aws_secret_access_key=S3_SECRET_KEY,
    region_name=S3_REGION,
)

# ---------------------------------------------------------------------------
# DuckDB connections
#
# A single shared connection `con` is used for all DuckDB operations
# (schema setup, view registration, queries, and table listing).
#
# DuckDB disallows opening the same file with two connections that have
# different read_only settings — attempting it crashes at startup.
# A separate read-only connection is therefore not used here.
#
# Backstops in place without read_only=True:
#   - memory_limit='512MB' caps resource consumption
#   - The worker port is NOT exposed externally (docker-compose.yml)
#     so /api/v1/query is only reachable from the web container
#   - SQL content validation lives in LakehouseQueryService.validateQuery()
#     in the TypeScript layer (single source of truth for content checks)
#
# DuckLakeCommitter shares this same connection (`con`) so that
# relations created by IngestionCleaner on `con` can be registered directly
# without cross-connection serialization errors.
# ---------------------------------------------------------------------------

con = duckdb.connect(database="/tmp/lakehouse.duckdb")
# Memory limit as a resource backstop
con.execute("SET memory_limit='512MB';")

# Module-level DuckLakeCommitter — initialized in lifespan, used by ingest handlers.
_committer: Optional[DuckLakeCommitter] = None
_ducklake_active: bool = False


# ---------------------------------------------------------------------------
# S3 / DuckDB utility functions
# ---------------------------------------------------------------------------

def configure_duckdb_s3(db_con: Optional[duckdb.DuckDBPyConnection] = None):
    """
    Configures DuckDB's httpfs extension for S3-compatible RustFS.
    Applied once at startup; subsequent calls are idempotent no-ops on the
    extension load (DuckDB handles repeated install/load gracefully).
    """
    target = db_con or con
    try:
        target.install_extension("httpfs")
        target.load_extension("httpfs")
        endpoint_clean = S3_ENDPOINT.replace("http://", "").replace("https://", "")
        use_ssl = "true" if S3_ENDPOINT.startswith("https://") else "false"
        target.execute(f"SET s3_endpoint='{endpoint_clean}';")
        target.execute(f"SET s3_access_key_id='{S3_ACCESS_KEY}';")
        target.execute(f"SET s3_secret_access_key='{S3_SECRET_KEY}';")
        target.execute(f"SET s3_use_ssl={use_ssl};")
        target.execute("SET s3_url_style='path';")
        target.execute(f"SET s3_region='{S3_REGION}';")
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


def ensure_tenant_schemas(tenant_id: str, db_con: Optional[duckdb.DuckDBPyConnection] = None):
    """Ensures {tenant_id}_silver and {tenant_id}_gold schemas exist in the given DuckDB connection."""
    target = db_con or con
    try:
        target.execute(f"CREATE SCHEMA IF NOT EXISTS {tenant_id}_silver;")
        target.execute(f"CREATE SCHEMA IF NOT EXISTS {tenant_id}_gold;")
    except Exception as e:
        logger.warning(f"Error ensuring schemas for {tenant_id}: {e}")


# ---------------------------------------------------------------------------
# DuckLake initialization
# ---------------------------------------------------------------------------

def _init_ducklake() -> bool:
    """
    Initializes the module-level DuckLakeCommitter and attaches the catalog.
    Returns True if DuckLake is successfully active, False otherwise.
    If this returns False the worker WILL NOT silently fall back — it logs
    clearly and marks DuckLake as inactive so callers can detect this.
    """
    global _committer, _ducklake_active

    committer = DuckLakeCommitter(db_uri=DATABASE_URI, conn=con)
    if not committer._initialized:
        logger.error(
            "DUCKLAKE NOT ACTIVE: Extensions failed to load. "
            "The ingest path cannot commit to DuckLake. "
            "Verify duckdb>=1.0.0 is installed. Worker will start but ingest will fail."
        )
        _committer = committer
        _ducklake_active = False
        return False

    # Configure S3 on the committer's connection
    committer.configure_s3(
        endpoint=S3_ENDPOINT,
        access_key=S3_ACCESS_KEY,
        secret_key=S3_SECRET_KEY,
        region=S3_REGION,
        use_ssl=S3_ENDPOINT.startswith("https://"),
    )

    # Attach the DuckLake catalog backed by Postgres
    try:
        committer.attach_catalog(data_path=DUCKLAKE_DATA_PATH)
        _committer = committer
        _ducklake_active = True
        logger.info(
            f"DuckLake ACTIVE. Catalog attached. Data path: {DUCKLAKE_DATA_PATH}"
        )
        return True
    except Exception as e:
        logger.error(
            f"DUCKLAKE NOT ACTIVE: Failed to attach catalog: {e}. "
            "Ingest will fail until this is resolved."
        )
        _committer = committer
        _ducklake_active = False
        return False


# ---------------------------------------------------------------------------
# Table registration & discovery
# ---------------------------------------------------------------------------

def sync_tenant_tables_from_ducklake(tenant_id: str):
    """
    Primary table registration path (DuckLake active):
    Reads table names from the DuckLake catalog and registers views on the
    shared query connection so they are queryable via SQL Studio.
    """
    if not _ducklake_active or _committer is None:
        return

    for layer in ("silver", "gold"):
        table_names = _committer.list_tables(tenant_id, layer)
        for tbl_name in table_names:
            qualified_in_catalog = (
                f"{DuckLakeCommitter.CATALOG_ALIAS}.{tenant_id}_{layer}.{tbl_name}"
            )
            qualified_local = f"{tenant_id}_{layer}.{tbl_name}"
            try:
                ensure_tenant_schemas(tenant_id, con)
                # Register a view on the read connection pointing at the DuckLake table
                con.execute(
                    f"CREATE OR REPLACE VIEW {qualified_local} AS "
                    f"SELECT * FROM {qualified_in_catalog};"
                )
            except Exception as ex:
                logger.warning(
                    f"Could not register DuckLake view {qualified_local}: {ex}"
                )


def sync_tenant_tables_from_storage(tenant_id: str):
    """
    Fallback table registration (S3 scan):
    Used when DuckLake is not active, or as a fallback for tables written
    before DuckLake was activated. Scans S3 directly and creates views
    over raw Parquet files.

    DEPRECATED: This will be the primary path only if DuckLake is inactive.
    Once DuckLake is confirmed active end-to-end, this function becomes a
    fallback for pre-DuckLake data only.
    """
    try:
        ensure_tenant_schemas(tenant_id)
        configure_duckdb_s3()

        # Discover Silver tables: tenants/{tenant_id}/tables/{table_name}/
        silver_prefix = f"tenants/{tenant_id}/tables/"
        res_silver = s3_client.list_objects_v2(
            Bucket=S3_BUCKET, Prefix=silver_prefix, Delimiter="/"
        )
        for cp in res_silver.get("CommonPrefixes", []):
            parts = cp["Prefix"].strip("/").split("/")
            if len(parts) >= 4:
                tbl_name = parts[3]
                tbl_objs = s3_client.list_objects_v2(
                    Bucket=S3_BUCKET, Prefix=cp["Prefix"], MaxKeys=2
                )
                has_parquet = any(
                    o["Key"].endswith(".parquet") for o in tbl_objs.get("Contents", [])
                )
                if has_parquet:
                    glob_uri = f"s3://{S3_BUCKET}/tenants/{tenant_id}/tables/{tbl_name}/*.parquet"
                    silver_qualified = f"{tenant_id}_silver.{tbl_name}"
                    legacy_name = f"{tenant_id}_{tbl_name}"
                    try:
                        con.execute(
                            f"CREATE OR REPLACE VIEW {silver_qualified} AS "
                            f"SELECT * FROM read_parquet('{glob_uri}', union_by_name=true);"
                        )
                        con.execute(
                            f"CREATE OR REPLACE VIEW {legacy_name} AS "
                            f"SELECT * FROM {silver_qualified};"
                        )
                    except Exception as ex:
                        logger.warning(f"Could not register view {silver_qualified}: {ex}")

        # Discover Gold materialized tables: tenants/{tenant_id}/gold/{table_name}/
        gold_prefix = f"tenants/{tenant_id}/gold/"
        res_gold = s3_client.list_objects_v2(
            Bucket=S3_BUCKET, Prefix=gold_prefix, Delimiter="/"
        )
        for cp in res_gold.get("CommonPrefixes", []):
            parts = cp["Prefix"].strip("/").split("/")
            if len(parts) >= 4:
                tbl_name = parts[3]
                tbl_objs = s3_client.list_objects_v2(
                    Bucket=S3_BUCKET, Prefix=cp["Prefix"], MaxKeys=2
                )
                has_parquet = any(
                    o["Key"].endswith(".parquet") for o in tbl_objs.get("Contents", [])
                )
                if has_parquet:
                    gold_glob = f"s3://{S3_BUCKET}/tenants/{tenant_id}/gold/{tbl_name}/*.parquet"
                    gold_qualified = f"{tenant_id}_gold.{tbl_name}"
                    try:
                        con.execute(
                            f"CREATE OR REPLACE VIEW {gold_qualified} AS "
                            f"SELECT * FROM read_parquet('{gold_glob}', union_by_name=true);"
                        )
                    except Exception as ex:
                        logger.warning(f"Could not register gold view {gold_qualified}: {ex}")
    except Exception as e:
        logger.warning(f"Error syncing tenant tables from storage for {tenant_id}: {e}")


def sync_tenant_tables(tenant_id: str):
    """
    Unified table sync: uses DuckLake catalog as primary source when active,
    falls back to S3 scan only if DuckLake is not active.
    """
    if _ducklake_active and _committer is not None:
        sync_tenant_tables_from_ducklake(tenant_id)
    else:
        sync_tenant_tables_from_storage(tenant_id)


def sync_all_tables_from_storage():
    """Syncs tables across all tenant folders found in RustFS."""
    try:
        configure_duckdb_s3()
        res = s3_client.list_objects_v2(Bucket=S3_BUCKET, Prefix="tenants/", Delimiter="/")
        for cp in res.get("CommonPrefixes", []):
            parts = cp["Prefix"].strip("/").split("/")
            if len(parts) >= 2:
                tid = parts[1]
                sync_tenant_tables(tid)
    except Exception as e:
        logger.warning(f"Error syncing all tables from storage: {e}")


# ---------------------------------------------------------------------------
# Shared ingest commit function (single source of truth for both ingest paths)
# ---------------------------------------------------------------------------

def _commit_to_ducklake(
    tenant_id: str,
    table_name: str,
    relation: duckdb.DuckDBPyRelation,
    layer: str = "silver",
) -> str:
    """
    Commits a cleaned DuckDB relation to a DuckLake-managed table.
    This is the single implementation called by both ingest paths
    (ingest_job and upload_and_commit) to avoid divergence.

    Returns the fully-qualified DuckLake table name.
    Raises RuntimeError if DuckLake is not active.
    """
    if not _ducklake_active or _committer is None:
        raise RuntimeError(
            "DuckLake is not active. Cannot commit table. "
            "Check startup logs for DuckLake initialization errors."
        )

    _committer.commit_table(
        tenant_id=tenant_id,
        table_name=table_name,
        relation=relation,
        layer=layer,
    )

    # After committing, register a view on the shared read connection
    # so the table is immediately queryable via SQL Studio without a restart.
    qualified_name = f"{tenant_id}_{layer}.{table_name}"
    catalog_qualified = (
        f"{DuckLakeCommitter.CATALOG_ALIAS}.{tenant_id}_{layer}.{table_name}"
    )
    try:
        ensure_tenant_schemas(tenant_id, con)
        con.execute(
            f"CREATE OR REPLACE VIEW {qualified_name} AS "
            f"SELECT * FROM {catalog_qualified};"
        )
        # Legacy flat-name alias for silver tables
        if layer == "silver":
            legacy_name = f"{tenant_id}_{table_name}"
            con.execute(
                f"CREATE OR REPLACE VIEW {legacy_name} AS SELECT * FROM {qualified_name};"
            )
    except Exception as ex:
        logger.warning(
            f"DuckLake commit succeeded but view registration on query connection failed: {ex}"
        )

    return qualified_name


# ---------------------------------------------------------------------------
# FastAPI lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_s3_bucket()
    configure_duckdb_s3(con)
    ducklake_ok = _init_ducklake()
    if ducklake_ok:
        logger.info("DuckLake initialization successful. Syncing existing tables from catalog.")
    else:
        logger.warning(
            "DuckLake initialization FAILED. "
            "Falling back to S3-scan table registration for existing data. "
            "New ingest operations will fail until DuckLake is fixed."
        )
    sync_all_tables_from_storage()
    yield


app = FastAPI(
    title="Lakehouse Processing Worker",
    version="0.2.0",
    description="Asynchronous ingestion worker with DuckLake transactional commits",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

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
    layer: str = "silver"  # "silver" or "gold"
    object_type: str = "table"  # "table" or "view"


class HardDeleteTenantRequest(BaseModel):
    tenant_id: str


class CreateTenantRequest(BaseModel):
    tenant_id: str
    name: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/healthz", status_code=status.HTTP_200_OK)
def health_check():
    return {
        "status": "healthy",
        "service": "lakehouse-worker",
        "ducklake_active": _ducklake_active,
    }


@app.post("/api/v1/jobs/ingest")
async def ingest_job(req: IngestJobRequest):
    """
    Primary ingest path (called by Next.js via Payload background jobs):
    1. Reads raw file from RustFS S3.
    2. Cleans and normalizes columns using IngestionCleaner.
    3. Commits as a DuckLake-managed table via _commit_to_ducklake().
    4. Registers a queryable view on the shared read connection.
    """
    try:
        start_time = time.time()
        init_s3_bucket()
        configure_duckdb_s3(con)

        # Normalize raw path
        raw_path = req.file_path.strip()
        if not raw_path.startswith("s3://"):
            raw_s3_uri = f"s3://{S3_BUCKET}/{raw_path.lstrip('/')}"
        else:
            raw_s3_uri = raw_path

        logger.info(
            f"[Job {req.job_id}] Processing raw file from {raw_s3_uri} "
            f"for table {req.tenant_id}_silver.{req.table_name}..."
        )

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

        # Commit to DuckLake (single source of truth — shared with upload_and_commit)
        qualified_name = _commit_to_ducklake(req.tenant_id, req.table_name, rel, "silver")
        logger.info(f"[Job {req.job_id}] DuckLake commit complete: {qualified_name}")

        row_count = con.execute(f"SELECT COUNT(*) FROM {qualified_name}").fetchone()[0]
        columns_info = con.execute(f"PRAGMA table_info('{qualified_name}')").fetchall()
        col_names = [col[1] for col in columns_info]

        duration_seconds = round(time.time() - start_time, 2)
        duration_ms = int(duration_seconds * 1000)

        return {
            "success": True,
            "job_id": req.job_id,
            "tenant_id": req.tenant_id,
            "table_name": qualified_name,
            "legacy_name": f"{req.tenant_id}_{req.table_name}",
            "layer": "silver",
            "ducklake_table": qualified_name,
            "row_count": row_count,
            "columns": col_names,
            "duration": duration_seconds,
            "duration_seconds": duration_seconds,
            "duration_ms": duration_ms,
            "raw_s3_uri": raw_s3_uri,
            "message": (
                f"Successfully committed into Silver layer '{qualified_name}' via DuckLake. "
                f"Total rows: {row_count}."
            ),
        }
    except Exception as e:
        logger.exception(f"[Job {req.job_id}] Ingestion failed")
        raise HTTPException(status_code=500, detail=str(e))


ENABLE_LEGACY_UPLOAD = os.getenv("ENABLE_LEGACY_UPLOAD_ENDPOINT", "false").lower() == "true"


@app.post("/api/v1/pipeline/upload-and-commit")
async def upload_and_commit(
    tenant_id: str = Form(...),
    table_name: str = Form(...),
    file: UploadFile = File(...),
):
    """
    DEPRECATED: This endpoint is disabled by default. The Next.js app uses
    /api/v1/jobs/ingest via Payload background jobs. Gated behind
    ENABLE_LEGACY_UPLOAD_ENDPOINT=true for test harnesses only.
    """
    if not ENABLE_LEGACY_UPLOAD:
        raise HTTPException(
            status_code=404,
            detail="The /api/v1/pipeline/upload-and-commit endpoint is deprecated and disabled. Use /api/v1/jobs/ingest instead.",
        )
    try:
        content = await file.read()
        filename = file.filename or "data.csv"

        init_s3_bucket()
        configure_duckdb_s3(con)

        # Store raw file under tenant prefix
        raw_key = f"tenants/{tenant_id}/raw/{filename}"
        raw_s3_uri = f"s3://{S3_BUCKET}/{raw_key}"
        s3_client.put_object(Bucket=S3_BUCKET, Key=raw_key, Body=content)
        logger.info(f"[upload-and-commit] Saved raw file to {raw_s3_uri}")

        # Ingest and sanitize schema
        if filename.endswith(".csv"):
            rel = IngestionCleaner.process_csv(raw_s3_uri, con)
        elif filename.endswith(".parquet"):
            rel = IngestionCleaner.process_parquet(raw_s3_uri, con)
        elif filename.endswith(".json") or filename.endswith(".ndjson"):
            rel = IngestionCleaner.process_json(raw_s3_uri, con)
        else:
            rel = IngestionCleaner.process_csv(raw_s3_uri, con)

        # Commit via the shared function — same implementation as ingest_job
        qualified_name = _commit_to_ducklake(tenant_id, table_name, rel, "silver")

        row_count = con.execute(f"SELECT COUNT(*) FROM {qualified_name}").fetchone()[0]
        columns_info = con.execute(f"PRAGMA table_info('{qualified_name}')").fetchall()
        col_names = [col[1] for col in columns_info]

        return {
            "success": True,
            "tenant_id": tenant_id,
            "table_name": qualified_name,
            "legacy_name": f"{tenant_id}_{table_name}",
            "layer": "silver",
            "row_count": row_count,
            "columns": col_names,
            "raw_s3_uri": raw_s3_uri,
            "message": (
                f"Successfully committed {row_count} rows to Silver layer ({qualified_name}) via DuckLake. "
                f"[DEPRECATED endpoint — use /api/v1/jobs/ingest instead]"
            ),
        }
    except Exception as e:
        logger.exception("upload-and-commit failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/gold/view")
async def create_gold_view(req: CreateGoldViewRequest):
    """
    Creates or replaces a Gold SQL view:
    CREATE VIEW {tenant_id}_gold.{view_name} AS {query}
    Gold views are metadata-only (no Parquet storage) and evaluated live.
    """
    try:
        configure_duckdb_s3(con)
        ensure_tenant_schemas(req.tenant_id, con)
        sync_tenant_tables(req.tenant_id)

        clean_view_name = req.view_name.strip().replace('"', '').replace("'", "")
        qualified_name = f"{req.tenant_id}_gold.{clean_view_name}"

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
    Commits the query result as a DuckLake-managed table under
    {tenant_id}_gold.{table_name}.
    """
    try:
        configure_duckdb_s3(con)
        sync_tenant_tables(req.tenant_id)

        clean_table_name = req.table_name.strip().replace('"', '').replace("'", "")

        # Execute the query to get the relation, then commit to DuckLake Gold schema
        rel = con.sql(req.query.strip().rstrip(";"))
        qualified_name = _commit_to_ducklake(req.tenant_id, clean_table_name, rel, "gold")
        logger.info(f"Materialized Gold table via DuckLake: {qualified_name}")

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
            "message": f"Gold table '{qualified_name}' successfully materialized ({row_count} rows) via DuckLake.",
        }
    except Exception as e:
        logger.exception(f"Failed to materialize Gold table {req.table_name}")
        raise HTTPException(status_code=400, detail=f"Failed to materialize Gold table: {str(e)}")


@app.post("/api/v1/datasets/delete")
async def delete_dataset(req: DeleteDatasetRequest):
    """
    Deletes a single dataset (Silver table, Gold view, or Gold materialized table).
    1. For Gold view: drop view from DuckDB catalog (metadata-only).
    2. For Silver table or Gold materialized table:
       - Drop table/view from DuckDB catalog
       - Purge the corresponding RustFS prefix
    """
    try:
        configure_duckdb_s3(con)
        layer = req.layer.lower()
        schema_name = f"{req.tenant_id}_{layer}"
        qualified_name = f"{schema_name}.{req.name}"

        # 1. Drop catalog entry from read connection
        try:
            con.execute(f"DROP VIEW IF EXISTS {qualified_name};")
            con.execute(f"DROP TABLE IF EXISTS {qualified_name};")
            if layer == "silver":
                con.execute(f"DROP VIEW IF EXISTS {req.tenant_id}_{req.name};")
        except Exception as e:
            logger.warning(f"Drop catalog warning: {e}")

        # 2. Purge RustFS storage if table (not a view)
        storage_deleted = False
        if req.object_type != "view":
            prefix = f"tenants/{req.tenant_id}/{'tables' if layer == 'silver' else 'gold'}/{req.name}/"
            logger.info(f"Deleting storage objects under prefix: {prefix}")
            try:
                paginator = s3_client.get_paginator("list_objects_v2")
                pages = paginator.paginate(Bucket=S3_BUCKET, Prefix=prefix)
                for page in pages:
                    if "Contents" in page:
                        delete_keys = [{"Key": obj["Key"]} for obj in page["Contents"]]
                        if delete_keys:
                            s3_client.delete_objects(
                                Bucket=S3_BUCKET, Delete={"Objects": delete_keys}
                            )
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
        configure_duckdb_s3(con)
        ensure_tenant_schemas(req.tenant_id, con)
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=f"tenants/{req.tenant_id}/.init",
            Body=b"initialized",
        )
        # Also provision schemas in the DuckLake catalog if active
        if _ducklake_active and _committer is not None:
            _committer.ensure_tenant_schema(req.tenant_id, "silver")
            _committer.ensure_tenant_schema(req.tenant_id, "gold")
        return {"success": True, "tenant_id": req.tenant_id}
    except Exception as e:
        logger.exception("Failed to initialize tenant")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/tenants/hard-delete")
async def hard_delete_tenant(req: HardDeleteTenantRequest):
    """
    Executes an idempotent multi-step hard delete of all tenant resources:
    1. Drop all Gold schema objects (views and tables)
    2. Drop all Silver schema objects
    3. Drop tenant schemas ({tenant_id}_gold, {tenant_id}_silver)
    4. Purge all RustFS objects under tenants/{tenant_id}/*

    Note: Once DuckLake snapshot-expiry APIs are implemented, this step will
    also need to trigger DuckLake snapshot expiry to fully remove DuckLake
    catalog metadata for the tenant. Currently the catalog entries in
    ducklake_catalog will be orphaned after this operation.
    """
    steps_completed = []
    try:
        configure_duckdb_s3(con)
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
            tables = [
                t[0]
                for t in con.execute("SHOW TABLES;").fetchall()
                if t[0].startswith(f"{tid}_")
            ]
            for t in tables:
                con.execute(f"DROP VIEW IF EXISTS {t};")
            steps_completed.append("drop_silver_schema")
        except Exception as e:
            logger.warning(f"Failed to drop silver schema {tid}_silver: {e}")

        # Step 3: Purge entire RustFS prefix tenants/{tenant_id}/*
        tenant_prefix = f"tenants/{tid}/"
        logger.info(f"Purging all RustFS objects under {tenant_prefix}...")
        try:
            paginator = s3_client.get_paginator("list_objects_v2")
            pages = paginator.paginate(Bucket=S3_BUCKET, Prefix=tenant_prefix)
            for page in pages:
                if "Contents" in page:
                    delete_keys = [{"Key": obj["Key"]} for obj in page["Contents"]]
                    if delete_keys:
                        s3_client.delete_objects(
                            Bucket=S3_BUCKET, Delete={"Objects": delete_keys}
                        )
            steps_completed.append("purge_storage_prefix")
        except Exception as e:
            logger.error(f"Error purging prefix {tenant_prefix}: {e}")
            raise e

        return {
            "success": True,
            "tenant_id": tid,
            "steps_completed": steps_completed,
            "message": (
                f"Successfully hard-deleted all storage and catalog resources for tenant '{tid}'. "
                f"Note: DuckLake catalog metadata in ducklake_catalog schema may require "
                f"manual cleanup until snapshot-expiry APIs are implemented."
            ),
        }
    except Exception as e:
        logger.exception(f"Hard delete failed for tenant {req.tenant_id}")
        raise HTTPException(
            status_code=500,
            detail={"error": str(e), "steps_completed": steps_completed},
        )


@app.get("/api/v1/tables")
async def list_tables(tenant_id: Optional[str] = None):
    """
    Lists tables and views grouped by Medallion layer (Silver / Gold) for the specified tenant.
    Uses DuckLake catalog as primary source when active; S3 scan as fallback.
    """
    try:
        configure_duckdb_s3(con)
        if tenant_id:
            sync_tenant_tables(tenant_id)
        else:
            sync_all_tables_from_storage()

        schema_query = """
        SELECT table_schema, table_name, table_type 
        FROM information_schema.tables 
        WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'temp')
        """
        all_objs = con.execute(schema_query).fetchall()

        tables_data = []
        for row in all_objs:
            schema, name, tbl_type = row[0], row[1], row[2]
            if name == "temp_clean_source" or name == "_committer_source":
                continue

            layer = "silver"
            obj_type = "view" if "VIEW" in (tbl_type or "").upper() else "table"

            if tenant_id:
                if schema == f"{tenant_id}_silver":
                    layer = "silver"
                elif schema == f"{tenant_id}_gold":
                    layer = "gold"
                elif schema == "main" and name.startswith(f"{tenant_id}_"):
                    layer = "silver"
                else:
                    continue
            else:
                if "_silver" in schema:
                    layer = "silver"
                elif "_gold" in schema:
                    layer = "gold"

            if schema == "main":
                qualified_name = name
                display_name = (
                    name[len(tenant_id) + 1 :]
                    if (tenant_id and name.startswith(f"{tenant_id}_"))
                    else name
                )
            else:
                qualified_name = f"{schema}.{name}"
                display_name = name

            try:
                info = con.execute(f"PRAGMA table_info('{qualified_name}');").fetchall()
                cols = [{"name": c[1], "type": c[2]} for c in info]
            except Exception:
                cols = []

            tables_data.append(
                {
                    "name": display_name,
                    "full_name": qualified_name,
                    "schema": schema,
                    "layer": layer,
                    "type": obj_type,
                    "columns": cols,
                }
            )

        # Deduplicate (qualified and legacy names may both appear)
        unique_tables = []
        seen = set()
        for t in tables_data:
            key = (t["layer"], t["name"])
            if key not in seen:
                seen.add(key)
                unique_tables.append(t)

        return {"tenant_id": tenant_id, "tables": unique_tables}
    except Exception as e:
        logger.exception("Failed to list tables")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/query")
async def run_query(request: Request):
    """
    Executes a SQL query against committed tables (accepts JSON or form data).

    SECURITY NOTE: This endpoint has no SQL-content validation of its own.
    The sole content validation layer is LakehouseQueryService.validateQuery()
    in the Next.js web layer. This endpoint is isolated from external networks
    (not exposed in docker-compose.yml) so it is only reachable from the web
    container. The backstops here are resource limits (memory_limit on the
    connection) and read_only mode, not content inspection.
    """
    try:
        content_type = request.headers.get("content-type", "")
        # NOTE: tenant_id is caller-supplied and not cryptographically verified (MVP 1 — no auth).
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

        configure_duckdb_s3(con)
        if tenant_id:
            sync_tenant_tables(tenant_id)

        rel = con.sql(sql_query)
        columns = rel.columns
        rows = [list(r) for r in rel.fetchall()]
        return {"columns": columns, "rows": rows, "row_count": len(rows)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

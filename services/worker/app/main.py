import os
import io
import logging
from contextlib import asynccontextmanager
from typing import Optional, Dict, Any

import boto3
import duckdb
from fastapi import FastAPI, HTTPException, status, UploadFile, File, Form
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

@app.get("/healthz", status_code=status.HTTP_200_OK)
def health_check():
    return {"status": "healthy", "service": "lakehouse-worker"}

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
    3. Commits the resulting table as Parquet into RustFS at s3://{S3_BUCKET}/tenants/{tenant_id}/tables/{table_name}/data.parquet.
    4. Registers a persistent view in DuckDB pointing to the Parquet dataset for SQL queries.
    """
    try:
        content = await file.read()
        filename = file.filename or "data.csv"

        # Ensure bucket exists and S3 is wired
        init_s3_bucket()
        configure_duckdb_s3()

        # 1. Store raw file into RustFS S3 under tenant prefix
        raw_key = f"tenants/{tenant_id}/raw/{filename}"
        raw_s3_uri = f"s3://{S3_BUCKET}/{raw_key}"
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=raw_key,
            Body=content
        )
        logger.info(f"Saved raw file to RustFS at {raw_s3_uri}")

        full_table_name = f"{tenant_id}_{table_name}"
        logger.info(f"Processing raw file from {raw_s3_uri} for table {full_table_name}...")

        # 2. Ingest and sanitize schema via IngestionCleaner reading directly from S3
        if filename.endswith(".csv"):
            rel = IngestionCleaner.process_csv(raw_s3_uri, con)
        elif filename.endswith(".parquet"):
            rel = IngestionCleaner.process_parquet(raw_s3_uri, con)
        elif filename.endswith(".json") or filename.endswith(".ndjson"):
            rel = IngestionCleaner.process_json(raw_s3_uri, con)
        else:
            rel = IngestionCleaner.process_csv(raw_s3_uri, con)

        # 3. Commit Parquet files directly into RustFS S3 under tenant table prefix
        parquet_key = f"tenants/{tenant_id}/tables/{table_name}/data.parquet"
        parquet_s3_uri = f"s3://{S3_BUCKET}/{parquet_key}"

        # Delete previous object if exists for clean overwrite
        try:
            s3_client.delete_object(Bucket=S3_BUCKET, Key=parquet_key)
        except Exception:
            pass

        con.register("temp_clean_source", rel)
        con.execute(f"COPY (SELECT * FROM temp_clean_source) TO '{parquet_s3_uri}' (FORMAT PARQUET);")
        logger.info(f"Committed Parquet table to RustFS at {parquet_s3_uri}")

        # 4. Register view in DuckDB so SQL Studio can query the S3 Parquet dataset directly
        try:
            con.execute(f"DROP VIEW {full_table_name};")
        except Exception:
            pass
        try:
            con.execute(f"DROP TABLE {full_table_name};")
        except Exception:
            pass
        con.execute(f"CREATE OR REPLACE VIEW {full_table_name} AS SELECT * FROM read_parquet('{parquet_s3_uri}');")

        row_count = con.execute(f"SELECT COUNT(*) FROM {full_table_name}").fetchone()[0]
        columns = con.execute(f"PRAGMA table_info('{full_table_name}')").fetchall()
        col_names = [col[1] for col in columns]

        return {
            "success": True,
            "tenant_id": tenant_id,
            "table_name": full_table_name,
            "row_count": row_count,
            "columns": col_names,
            "raw_s3_uri": raw_s3_uri,
            "parquet_s3_uri": parquet_s3_uri,
            "message": f"Successfully committed {row_count} rows to RustFS S3 ({parquet_s3_uri})."
        }
    except Exception as e:
        logger.exception("Pipeline ingestion to RustFS failed")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/query")
async def run_query(query: str = Form(...)):
    """Executes a query against the committed tables."""
    try:
        configure_duckdb_s3()
        rel = con.sql(query)
        columns = rel.columns
        rows = [list(r) for r in rel.fetchall()]
        return {
            "columns": columns,
            "rows": rows,
            "row_count": len(rows)
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

import duckdb
import os
import logging
from typing import Optional, Dict, Any

logger = logging.getLogger("ducklake-committer")

class DuckLakeCommitter:
    """
    Manages commits to DuckLake tables via DuckDB and PostgreSQL catalog.
    """
    def __init__(self, db_uri: str, catalog_schema: str = "ducklake_catalog"):
        self.db_uri = db_uri
        self.catalog_schema = catalog_schema
        self.conn = duckdb.connect()
        self._init_extensions()

    def _init_extensions(self):
        try:
            self.conn.install_extension("ducklake")
            self.conn.load_extension("ducklake")
            self.conn.install_extension("postgres")
            self.conn.load_extension("postgres")
            self.conn.install_extension("httpfs")
            self.conn.load_extension("httpfs")
            logger.info("DuckDB extensions (ducklake, postgres, httpfs) initialized successfully.")
        except Exception as e:
            logger.warning(f"Could not load native extensions in current environment: {e}")

    def configure_s3_storage(self, endpoint: str, access_key: str, secret_key: str, region: str = "us-east-1", use_ssl: bool = False):
        """Sets S3 / RustFS / MinIO credentials and endpoint in DuckDB."""
        self.conn.execute(f"SET s3_endpoint='{endpoint.replace('http://', '').replace('https://', '')}';")
        self.conn.execute(f"SET s3_access_key_id='{access_key}';")
        self.conn.execute(f"SET s3_secret_access_key='{secret_key}';")
        self.conn.execute(f"SET s3_region='{region}';")
        self.conn.execute(f"SET s3_use_ssl={'true' if use_ssl else 'false'};")
        self.conn.execute("SET s3_url_style='path';")

    def attach_catalog(self, catalog_name: str = "lakehouse_cat"):
        """Attaches DuckLake catalog using the shared Postgres connection."""
        attach_cmd = f"""
        ATTACH 'dbname=lakehouse' AS {catalog_name} (
            TYPE DUCKLAKE,
            POSTGRES_SCHEMA '{self.catalog_schema}'
        );
        """
        try:
            self.conn.execute(attach_cmd)
            logger.info(f"Attached DuckLake catalog {catalog_name} to schema {self.catalog_schema}")
        except Exception as e:
            logger.error(f"Failed to attach DuckLake catalog: {e}")

    def commit_table(self, tenant_id: str, table_name: str, relation: duckdb.DuckDBPyRelation, storage_path: str, layer: str = "silver"):
        """
        Commits cleaned relation to DuckLake under tenant schema ({tenant_id}_silver or {tenant_id}_gold).
        """
        schema_name = f"{tenant_id}_{layer}"
        qualified_table_name = f"{schema_name}.{table_name}"
        logger.info(f"Committing table {qualified_table_name} into {storage_path}")
        
        # Ensure tenant layer schema exists in catalog / session
        try:
            self.conn.execute(f"CREATE SCHEMA IF NOT EXISTS {schema_name};")
        except Exception as e:
            logger.warning(f"Could not create schema {schema_name}: {e}")

        # Commits the relation directly to Parquet / DuckLake managed location
        self.conn.register("source_relation", relation)
        create_sql = f"""
        CREATE TABLE IF NOT EXISTS {qualified_table_name} AS SELECT * FROM source_relation;
        """
        self.conn.execute(create_sql)
        logger.info(f"Table {qualified_table_name} successfully committed.")


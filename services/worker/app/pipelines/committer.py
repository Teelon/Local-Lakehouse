import duckdb
import os
import logging
from typing import Optional

logger = logging.getLogger("ducklake-committer")

class DuckLakeCommitter:
    """
    Manages atomic commits to DuckLake tables via DuckDB + PostgreSQL catalog.

    Uses the DuckLake v1.0 ATTACH syntax:
        ATTACH 'ducklake:postgres:<connection_string>' AS <alias>
              (DATA_PATH 's3://...', METADATA_SCHEMA 'ducklake_catalog');

    DuckLakeCommitter operates directly on the shared DuckDB connection
    so that relations created by IngestionCleaner on that connection can be
    registered directly without cross-connection serialization errors.
    """

    CATALOG_ALIAS = "lakehouse_cat"

    def __init__(
        self,
        db_uri: str,
        conn: duckdb.DuckDBPyConnection,
        catalog_schema: str = "ducklake_catalog",
    ):
        """
        Args:
            db_uri: PostgreSQL connection URI (postgres://user:pass@host:port/dbname)
            conn: Shared DuckDB connection (same connection used by cleaner and query studio)
            catalog_schema: Postgres schema used by DuckLake for metadata (default: ducklake_catalog)
        """
        self.db_uri = db_uri
        self.catalog_schema = catalog_schema
        self._catalog_attached = False
        # Use shared DuckDB connection so relations and views are co-located
        self.conn = conn
        self._initialized = self._init_extensions()

    def _init_extensions(self) -> bool:
        """
        Installs and loads ducklake, postgres, and httpfs extensions.
        Returns True if all extensions loaded successfully, False otherwise.
        """
        try:
            self.conn.install_extension("ducklake")
            self.conn.load_extension("ducklake")
            self.conn.install_extension("postgres")
            self.conn.load_extension("postgres")
            self.conn.install_extension("httpfs")
            self.conn.load_extension("httpfs")
            logger.info("DuckDB extensions (ducklake, postgres, httpfs) initialized successfully.")
            return True
        except Exception as e:
            logger.error(
                f"Failed to load DuckLake extensions: {e}. "
                "DuckLakeCommitter will not be available. "
                "Verify that duckdb>=1.0.0 is installed and the extensions can be downloaded."
            )
            return False

    def configure_s3(
        self,
        endpoint: str,
        access_key: str,
        secret_key: str,
        region: str = "us-east-1",
        use_ssl: bool = False,
    ):
        """Configures S3/RustFS credentials on the committer's DuckDB connection."""
        clean_endpoint = endpoint.replace("http://", "").replace("https://", "")
        self.conn.execute(f"SET s3_endpoint='{clean_endpoint}';")
        self.conn.execute(f"SET s3_access_key_id='{access_key}';")
        self.conn.execute(f"SET s3_secret_access_key='{secret_key}';")
        self.conn.execute(f"SET s3_region='{region}';")
        self.conn.execute(f"SET s3_use_ssl={'true' if use_ssl else 'false'};")
        self.conn.execute("SET s3_url_style='path';")

    def _build_pg_conn_str(self) -> str:
        """
        Converts a Postgres URI (postgres://user:pass@host:port/dbname) to
        a libpq-style connection string required by DuckLake's ATTACH syntax.
        """
        uri = self.db_uri
        # Strip scheme
        uri = uri.replace("postgres://", "").replace("postgresql://", "")
        # user:pass@host:port/dbname
        if "@" in uri:
            credentials, rest = uri.split("@", 1)
            if ":" in credentials:
                user, password = credentials.split(":", 1)
            else:
                user, password = credentials, ""
        else:
            user, password, rest = "", "", uri

        if "/" in rest:
            hostport, dbname = rest.rsplit("/", 1)
        else:
            hostport, dbname = rest, "lakehouse"

        if ":" in hostport:
            host, port = hostport.split(":", 1)
        else:
            host, port = hostport, "5432"

        parts = [f"host={host}", f"port={port}", f"dbname={dbname}"]
        if user:
            parts.append(f"user={user}")
        if password:
            parts.append(f"password={password}")
        return " ".join(parts)

    def attach_catalog(self, data_path: str):
        """
        Attaches the DuckLake catalog using the Postgres metadata backend.
        Uses DuckLake v1.0 syntax:
            ATTACH 'ducklake:postgres:<conn_str>' AS lakehouse_cat
                   (DATA_PATH '<s3_path>', METADATA_SCHEMA 'ducklake_catalog');

        Args:
            data_path: S3 URI root where DuckLake should store data files
                       e.g. 's3://lakehouse-bucket/ducklake/'
        """
        if not self._initialized:
            raise RuntimeError(
                "DuckLakeCommitter extensions failed to load. Cannot attach catalog."
            )

        pg_conn_str = self._build_pg_conn_str()
        attach_sql = (
            f"ATTACH 'ducklake:postgres:{pg_conn_str}' AS {self.CATALOG_ALIAS} ("
            f"DATA_PATH '{data_path}', "
            f"METADATA_SCHEMA '{self.catalog_schema}'"
            f");"
        )
        try:
            self.conn.execute(attach_sql)
            self._catalog_attached = True
            logger.info(
                f"DuckLake catalog attached as '{self.CATALOG_ALIAS}' "
                f"(metadata schema: {self.catalog_schema}, data path: {data_path})"
            )
        except Exception as e:
            if "already attached" in str(e).lower() or "already exists" in str(e).lower():
                self._catalog_attached = True
                logger.info(f"DuckLake catalog '{self.CATALOG_ALIAS}' already attached.")
            else:
                logger.error(f"Failed to attach DuckLake catalog: {e}")
                raise

    def ensure_tenant_schema(self, tenant_id: str, layer: str = "silver"):
        """
        Ensures the tenant's schema exists in the DuckLake catalog.
        Schema name: {tenant_id}_{layer} (e.g. tenant_acme_silver)
        """
        if not self._catalog_attached:
            raise RuntimeError("DuckLake catalog not attached. Call attach_catalog() first.")
        schema_name = f"{tenant_id}_{layer}"
        try:
            self.conn.execute(
                f"CREATE SCHEMA IF NOT EXISTS {self.CATALOG_ALIAS}.{schema_name};"
            )
        except Exception as e:
            logger.warning(f"Could not create schema {schema_name} in DuckLake catalog: {e}")

    def commit_table(
        self,
        tenant_id: str,
        table_name: str,
        relation: duckdb.DuckDBPyRelation,
        layer: str = "silver",
    ):
        """
        Atomically commits a cleaned DuckDB relation as a DuckLake-managed table.

        DuckLake handles:
          - Writing Parquet data files to the configured DATA_PATH
          - Recording the commit in the PostgreSQL metadata catalog (ducklake_catalog schema)
          - Schema evolution and snapshot tracking

        The table is created under:
            lakehouse_cat.{tenant_id}_{layer}.{table_name}
        And is immediately queryable as:
            {tenant_id}_{layer}.{table_name}  (via the catalog alias)

        Args:
            tenant_id: Tenant identifier (caller-supplied; enforced by prefix in DATA_PATH)
            table_name: Target table name within the tenant's layer schema
            relation: DuckDB relation containing cleaned, normalized data
            layer: 'silver' or 'gold'
        """
        if not self._catalog_attached:
            raise RuntimeError("DuckLake catalog not attached. Call attach_catalog() first.")

        schema_name = f"{tenant_id}_{layer}"
        qualified_name = f"{self.CATALOG_ALIAS}.{schema_name}.{table_name}"

        self.ensure_tenant_schema(tenant_id, layer)

        # Register the cleaned relation on this connection and commit it to DuckLake.
        # DuckLake's CREATE OR REPLACE TABLE writes Parquet to DATA_PATH and records
        # the transaction in the PostgreSQL catalog — this is the atomic commit.
        existing_tables = self.list_tables(tenant_id, layer)
        self.conn.register("_committer_source", relation)
        try:
            if table_name in existing_tables:
                self.conn.execute(
                    f"INSERT INTO {qualified_name} SELECT * FROM _committer_source;"
                )
                logger.info(
                    f"DuckLake append successful: {qualified_name} "
                    f"(catalog: {self.catalog_schema})"
                )
            else:
                self.conn.execute(
                    f"CREATE TABLE {qualified_name} AS SELECT * FROM _committer_source;"
                )
                logger.info(
                    f"DuckLake commit successful: {qualified_name} "
                    f"(catalog: {self.catalog_schema})"
                )
        finally:
            try:
                self.conn.unregister("_committer_source")
            except Exception:
                pass

    def list_tables(self, tenant_id: str, layer: str = "silver") -> list[str]:
        """
        Lists live tables in the DuckLake catalog for the given tenant and layer.

        Queries DuckLake's hidden metadata schema (__ducklake_metadata_{alias})
        which is the correct DuckLake v1.0 API for catalog introspection.
        Falls back to SHOW ALL TABLES filtered by catalog prefix if metadata
        schema query fails.

        Returns table names (not fully qualified).
        """
        if not self._catalog_attached:
            return []
        schema_name = f"{tenant_id}_{layer}"
        meta_schema = f"__ducklake_metadata_{self.CATALOG_ALIAS}"
        try:
            rows = self.conn.execute(f"""
                SELECT t.table_name
                FROM {meta_schema}.ducklake_table t
                JOIN {meta_schema}.ducklake_schema s ON t.schema_id = s.schema_id
                WHERE s.schema_name = '{schema_name}'
                  AND t.end_snapshot IS NULL
                  AND s.end_snapshot IS NULL;
            """).fetchall()
            return [row[0] for row in rows]
        except Exception:
            # Fallback: use SHOW ALL TABLES and filter by catalog + schema
            try:
                rows = self.conn.execute("SHOW ALL TABLES;").fetchall()
                return [
                    row[2]  # table_name column
                    for row in rows
                    if row[0] == self.CATALOG_ALIAS and row[1] == schema_name
                ]
            except Exception as e2:
                logger.warning(f"Could not list DuckLake tables for {schema_name}: {e2}")
                return []

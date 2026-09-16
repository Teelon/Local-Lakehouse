"""
engine.py

LakehouseEngine: Centralized facade and connection manager for DuckDB and DuckLake.
Encapsulates:
- Singleton shared DuckDB connection (/tmp/lakehouse.duckdb).
- DuckLakeCommitter catalog integration.
- Write/DDL concurrency control via asyncio.Lock.
- Idempotent S3 configuration.
- Tenant schema provisioning and catalog synchronization.
- Three semantic prepare methods (prepare_for_write, prepare_for_read, prepare_for_delete).
"""

import os
import asyncio
import logging
from typing import Optional, List, Dict, Any
import duckdb
from app.pipelines.committer import DuckLakeCommitter

logger = logging.getLogger("lakehouse-engine")

S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://storage:9000")
S3_ACCESS_KEY = os.getenv("S3_ROOT_USER", "lakehouse_storage_admin")
S3_SECRET_KEY = os.getenv("S3_ROOT_PASSWORD", "storage_secret_change_me")
S3_BUCKET = os.getenv("S3_BUCKET_NAME", "lakehouse-bucket")
S3_REGION = os.getenv("S3_REGION", "us-east-1")


class LakehouseEngine:
    def __init__(
        self,
        con: duckdb.DuckDBPyConnection,
        committer: Optional[DuckLakeCommitter] = None,
        s3_client: Optional[Any] = None,
    ):
        self.con = con
        self.committer = committer
        self.s3_client = s3_client
        self._s3_configured = False
        self._write_lock = asyncio.Lock()

    def set_committer(self, committer: DuckLakeCommitter):
        self.committer = committer

    def _ensure_s3_configured(self):
        """Idempotently configure DuckDB httpfs extension with S3 root credentials."""
        if self._s3_configured:
            return
        try:
            endpoint_clean = S3_ENDPOINT.replace("http://", "").replace("https://", "")
            use_ssl = "true" if S3_ENDPOINT.startswith("https://") else "false"

            self.con.execute(f"SET s3_endpoint='{endpoint_clean}';")
            self.con.execute(f"SET s3_access_key_id='{S3_ACCESS_KEY}';")
            self.con.execute(f"SET s3_secret_access_key='{S3_SECRET_KEY}';")
            self.con.execute(f"SET s3_use_ssl={use_ssl};")
            self.con.execute("SET s3_url_style='path';")
            self.con.execute(f"SET s3_region='{S3_REGION}';")
            self._s3_configured = True
            logger.info("DuckDB S3 credentials configured successfully on shared connection.")
        except Exception as e:
            logger.warning(f"Could not configure DuckDB S3: {e}")

    def _ensure_tenant_schemas(self, tenant_id: str):
        """Ensures isolated schemas for the given tenant exist in DuckDB."""
        try:
            self.con.execute(f"CREATE SCHEMA IF NOT EXISTS {tenant_id}_silver;")
            self.con.execute(f"CREATE SCHEMA IF NOT EXISTS {tenant_id}_gold;")
        except Exception as e:
            logger.warning(f"Error creating schemas for tenant {tenant_id}: {e}")

    def sync_tenant_tables_from_ducklake(self, tenant_id: str):
        """Syncs tables from DuckLake catalog and creates queryable views."""
        if self.committer is None or not getattr(self.committer, "_initialized", False):
            return

        for layer in ("silver", "gold"):
            table_names = self.committer.list_tables(tenant_id, layer)
            for tbl_name in table_names:
                catalog_qualified = (
                    f"{DuckLakeCommitter.CATALOG_ALIAS}.{tenant_id}_{layer}.{tbl_name}"
                )
                qualified_local = f"{tenant_id}_{layer}.{tbl_name}"
                try:
                    self._ensure_tenant_schemas(tenant_id)
                    self.con.execute(
                        f"CREATE OR REPLACE VIEW {qualified_local} AS "
                        f"SELECT * FROM {catalog_qualified};"
                    )
                except Exception as ex:
                    logger.warning(
                        f"Could not register DuckLake view {qualified_local}: {ex}"
                    )

    def sync_tenant_tables_from_storage(self, tenant_id: str):
        """Fallback sync from S3 parquet storage if DuckLake is not active."""
        if not self.s3_client:
            return
        try:
            self._ensure_tenant_schemas(tenant_id)
            self._ensure_s3_configured()

            silver_prefix = f"tenants/{tenant_id}/tables/"
            res_silver = self.s3_client.list_objects_v2(
                Bucket=S3_BUCKET, Prefix=silver_prefix, Delimiter="/"
            )
            for cp in res_silver.get("CommonPrefixes", []):
                parts = cp["Prefix"].strip("/").split("/")
                if len(parts) >= 4:
                    tbl_name = parts[3]
                    tbl_objs = self.s3_client.list_objects_v2(
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
                            self.con.execute(
                                f"CREATE OR REPLACE VIEW {silver_qualified} AS "
                                f"SELECT * FROM read_parquet('{glob_uri}', union_by_name=true);"
                            )
                            self.con.execute(
                                f"CREATE OR REPLACE VIEW {legacy_name} AS "
                                f"SELECT * FROM {silver_qualified};"
                            )
                        except Exception as ex:
                            logger.warning(f"Could not register view {silver_qualified}: {ex}")

            gold_prefix = f"tenants/{tenant_id}/gold/"
            res_gold = self.s3_client.list_objects_v2(
                Bucket=S3_BUCKET, Prefix=gold_prefix, Delimiter="/"
            )
            for cp in res_gold.get("CommonPrefixes", []):
                parts = cp["Prefix"].strip("/").split("/")
                if len(parts) >= 4:
                    tbl_name = parts[3]
                    tbl_objs = self.s3_client.list_objects_v2(
                        Bucket=S3_BUCKET, Prefix=cp["Prefix"], MaxKeys=2
                    )
                    has_parquet = any(
                        o["Key"].endswith(".parquet") for o in tbl_objs.get("Contents", [])
                    )
                    if has_parquet:
                        glob_uri = f"s3://{S3_BUCKET}/tenants/{tenant_id}/gold/{tbl_name}/*.parquet"
                        gold_qualified = f"{tenant_id}_gold.{tbl_name}"
                        try:
                            self.con.execute(
                                f"CREATE OR REPLACE VIEW {gold_qualified} AS "
                                f"SELECT * FROM read_parquet('{glob_uri}', union_by_name=true);"
                            )
                        except Exception as ex:
                            logger.warning(f"Could not register gold view {gold_qualified}: {ex}")
        except Exception as e:
            logger.warning(f"Storage sync error for tenant {tenant_id}: {e}")

    def sync_tenant_tables(self, tenant_id: str):
        """Unified table sync: prefers DuckLake catalog when active, falls back to S3 scan."""
        if self.committer is not None and getattr(self.committer, "_initialized", False):
            self.sync_tenant_tables_from_ducklake(tenant_id)
        else:
            self.sync_tenant_tables_from_storage(tenant_id)

    # ---------------------------------------------------------------------------
    # Three Semantic Prepare Methods (Addendum v2 Section 3)
    # ---------------------------------------------------------------------------
    def prepare_for_write(self, tenant_id: str) -> None:
        """For ingest, gold view/materialize creation, and other operations
        that need the tenant's schema to exist first."""
        self._ensure_s3_configured()
        self._ensure_tenant_schemas(tenant_id)

    def prepare_for_read(self, tenant_id: str) -> None:
        """For queries and table listing â€” syncs the tenant's tables from
        the DuckLake catalog."""
        self._ensure_s3_configured()
        self.sync_tenant_tables(tenant_id)

    def prepare_for_delete(self, tenant_id: str) -> None:
        """For dataset/tenant deletion â€” only needs S3 configured, not schema
        ensure or table sync, since it's about to remove things, not add them."""
        self._ensure_s3_configured()

    # ---------------------------------------------------------------------------
    # Concurrency-Protected Write / DDL Operations
    # ---------------------------------------------------------------------------
    async def commit_table(
        self,
        tenant_id: str,
        table_name: str,
        relation: duckdb.DuckDBPyRelation,
        layer: str = "silver",
    ) -> str:
        """Commits a relation to DuckLake and creates queryable views under write lock."""
        async with self._write_lock:
            if not self.committer or not getattr(self.committer, "_initialized", False):
                raise RuntimeError("DuckLake is not active. Cannot commit table.")

            self.committer.commit_table(
                tenant_id=tenant_id,
                table_name=table_name,
                relation=relation,
                layer=layer,
            )

            qualified_name = f"{tenant_id}_{layer}.{table_name}"
            catalog_qualified = (
                f"{DuckLakeCommitter.CATALOG_ALIAS}.{tenant_id}_{layer}.{table_name}"
            )
            try:
                self._ensure_tenant_schemas(tenant_id)
                self.con.execute(
                    f"CREATE OR REPLACE VIEW {qualified_name} AS "
                    f"SELECT * FROM {catalog_qualified};"
                )
                if layer == "silver":
                    legacy_name = f"{tenant_id}_{table_name}"
                    self.con.execute(
                        f"CREATE OR REPLACE VIEW {legacy_name} AS SELECT * FROM {qualified_name};"
                    )
            except Exception as ex:
                logger.warning(
                    f"DuckLake commit succeeded but view registration failed: {ex}"
                )

            return qualified_name

    async def create_gold_view(self, tenant_id: str, view_name: str, query: str) -> Dict[str, Any]:
        """Creates or replaces a Gold SQL view under write lock."""
        async with self._write_lock:
            clean_view_name = view_name.strip().replace('"', '').replace("'", "")
            qualified_name = f"{tenant_id}_gold.{clean_view_name}"

            sql_stmt = f"CREATE OR REPLACE VIEW {qualified_name} AS {query.strip().rstrip(';')};"
            self.con.execute(sql_stmt)
            logger.info(f"Created Gold view: {qualified_name}")

            columns_info = self.con.execute(f"PRAGMA table_info('{qualified_name}')").fetchall()
            col_names = [col[1] for col in columns_info]

            return {
                "name": clean_view_name,
                "full_name": qualified_name,
                "layer": "gold",
                "object_type": "view",
                "columns": col_names,
            }

    async def materialize_gold_table(self, tenant_id: str, table_name: str, query: str) -> Dict[str, Any]:
        """Materializes a Gold table by executing query and committing to DuckLake under write lock."""
        async with self._write_lock:
            clean_table_name = table_name.strip().replace('"', '').replace("'", "")
            rel = self.con.sql(query.strip().rstrip(";"))

            if not self.committer or not getattr(self.committer, "_initialized", False):
                raise RuntimeError("DuckLake is not active. Cannot materialize table.")

            self.committer.commit_table(
                tenant_id=tenant_id,
                table_name=clean_table_name,
                relation=rel,
                layer="gold",
            )

            qualified_name = f"{tenant_id}_gold.{clean_table_name}"
            catalog_qualified = (
                f"{DuckLakeCommitter.CATALOG_ALIAS}.{tenant_id}_gold.{clean_table_name}"
            )
            self._ensure_tenant_schemas(tenant_id)
            self.con.execute(
                f"CREATE OR REPLACE VIEW {qualified_name} AS "
                f"SELECT * FROM {catalog_qualified};"
            )

            row_count = self.con.execute(f"SELECT COUNT(*) FROM {qualified_name}").fetchone()[0]
            columns_info = self.con.execute(f"PRAGMA table_info('{qualified_name}')").fetchall()
            col_names = [col[1] for col in columns_info]

            return {
                "name": clean_table_name,
                "full_name": qualified_name,
                "layer": "gold",
                "object_type": "table",
                "row_count": row_count,
                "columns": col_names,
            }

    async def drop_dataset(self, tenant_id: str, name: str, layer: str, object_type: str) -> None:
        """Drops catalog views/tables under write lock."""
        async with self._write_lock:
            qualified_name = f"{tenant_id}_{layer}.{name}"
            catalog_name = f"{DuckLakeCommitter.CATALOG_ALIAS}.{tenant_id}_{layer}.{name}"
            try:
                self.con.execute(f"DROP VIEW IF EXISTS {qualified_name};")
                self.con.execute(f"DROP TABLE IF EXISTS {qualified_name};")
                try:
                    self.con.execute(f"DROP TABLE IF EXISTS {catalog_name};")
                    self.con.execute(f"DROP VIEW IF EXISTS {catalog_name};")
                except Exception as cat_e:
                    logger.warning(f"DuckLake catalog drop warning: {cat_e}")
                if layer == "silver":
                    self.con.execute(f"DROP VIEW IF EXISTS {tenant_id}_{name};")
            except Exception as e:
                logger.warning(f"Drop catalog warning: {e}")

    async def drop_tenant_schemas(self, tenant_id: str) -> None:
        """Drops tenant schemas and legacy views under write lock."""
        async with self._write_lock:
            try:
                self.con.execute(f"DROP SCHEMA IF EXISTS {tenant_id}_silver CASCADE;")
                self.con.execute(f"DROP SCHEMA IF EXISTS {tenant_id}_gold CASCADE;")
                try:
                    self.con.execute(f"DROP SCHEMA IF EXISTS {DuckLakeCommitter.CATALOG_ALIAS}.{tenant_id}_silver CASCADE;")
                    self.con.execute(f"DROP SCHEMA IF EXISTS {DuckLakeCommitter.CATALOG_ALIAS}.{tenant_id}_gold CASCADE;")
                except Exception as cat_e:
                    logger.warning(f"DuckLake catalog drop schema warning: {cat_e}")
                flat_views = self.con.execute(
                    f"SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' AND table_name LIKE '{tenant_id}_%';"
                ).fetchall()
                for (vname,) in flat_views:
                    try:
                        self.con.execute(f"DROP VIEW IF EXISTS {vname};")
                    except Exception:
                        pass
            except Exception as e:
                logger.warning(f"Error dropping DuckDB schemas for {tenant_id}: {e}")

    # ---------------------------------------------------------------------------
    # Read-Only Operations (No write lock needed)
    # ---------------------------------------------------------------------------
    def run_query(self, sql_query: str) -> Dict[str, Any]:
        """Runs a read query on the shared DuckDB connection."""
        rel = self.con.sql(sql_query)
        columns = rel.columns
        rows = [list(r) for r in rel.fetchall()]
        return {"columns": columns, "rows": rows, "row_count": len(rows)}

    def list_tables(self, tenant_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Introspects tables and views in DuckDB schemas."""
        schema_query = """
        SELECT table_schema, table_name, table_type 
        FROM information_schema.tables 
        WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'temp')
        """
        all_objs = self.con.execute(schema_query).fetchall()

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
                info = self.con.execute(f"PRAGMA table_info('{qualified_name}');").fetchall()
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

        unique_tables = []
        seen = set()
        for t in tables_data:
            if t["full_name"] not in seen:
                seen.add(t["full_name"])
                unique_tables.append(t)

        return unique_tables

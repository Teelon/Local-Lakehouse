import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
import json
import csv
from pathlib import Path
from typing import Dict, Any

class IngestionCleaner:
    """
    Parses and sanitizes input data (CSV, JSON/NDJSON, Parquet)
    before committing to DuckLake.
    """
    
    @staticmethod
    def clean_column_name(name: str) -> str:
        clean = "".join(c if c.isalnum() else "_" for c in name.strip())
        while "__" in clean:
            clean = clean.replace("__", "_")
        return clean.strip("_").lower()

    @classmethod
    def _normalize_path(cls, file_path: str) -> str:
        if file_path.startswith("s3://") or file_path.startswith("http://") or file_path.startswith("https://"):
            return file_path
        return Path(file_path).as_posix()

    @classmethod
    def process_csv(cls, file_path: str, duckdb_conn: duckdb.DuckDBPyConnection) -> duckdb.DuckDBPyRelation:
        """Loads and sanitizes CSV into a DuckDB relation."""
        normalized_path = cls._normalize_path(file_path)
        rel = duckdb_conn.read_csv(normalized_path, header=True, auto_detect=True, delimiter=',')
        cleaned_columns = [f'"{col}" AS "{cls.clean_column_name(col)}"' for col in rel.columns]
        query = f"SELECT {', '.join(cleaned_columns)} FROM rel"
        return duckdb_conn.sql(query)

    @classmethod
    def process_parquet(cls, file_path: str, duckdb_conn: duckdb.DuckDBPyConnection) -> duckdb.DuckDBPyRelation:
        """Loads and sanitizes Parquet into a DuckDB relation."""
        normalized_path = cls._normalize_path(file_path)
        rel = duckdb_conn.read_parquet(normalized_path)
        cleaned_columns = [f'"{col}" AS "{cls.clean_column_name(col)}"' for col in rel.columns]
        query = f"SELECT {', '.join(cleaned_columns)} FROM rel"
        return duckdb_conn.sql(query)

    @classmethod
    def process_json(cls, file_path: str, duckdb_conn: duckdb.DuckDBPyConnection) -> duckdb.DuckDBPyRelation:
        """Loads and sanitizes JSON/NDJSON into a DuckDB relation."""
        normalized_path = cls._normalize_path(file_path)
        rel = duckdb_conn.read_json(normalized_path)
        cleaned_columns = [f'"{col}" AS "{cls.clean_column_name(col)}"' for col in rel.columns]
        query = f"SELECT {', '.join(cleaned_columns)} FROM rel"
        return duckdb_conn.sql(query)

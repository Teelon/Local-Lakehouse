# services/worker
This directory contains the Python/FastAPI asynchronous data processing worker.

Responsibilities:
- Ingestion, validation, and cleaning for raw CSV, JSON, and Parquet data.
- Temporary STS-credential consumption for tenant-scoped object storage access.
- DuckLake commits (writing partitioned Parquet files and catalog transactions via DuckDB).
- Execution callback notifications to Payload Jobs Queue.

# Local Lakehouse

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![Payload CMS](https://img.shields.io/badge/Payload-3.0-blueviolet)](https://payloadcms.com/)
[![DuckDB](https://img.shields.io/badge/DuckDB-1.0%2B-yellow)](https://duckdb.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688)](https://fastapi.tiangolo.com/)
[![RustFS](https://img.shields.io/badge/RustFS-S3%20Compatible-orange)](https://github.com/rustfs/rustfs)
[![zread](https://img.shields.io/badge/Ask_Zread-_.svg?style=flat&color=00b0aa&labelColor=000000&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQuOTYxNTYgMS42MDAxSDIuMjQxNTZDMS44ODgxIDEuNjAwMSAxLjYwMTU2IDEuODg2NjQgMS42MDE1NiAyLjI0MDFWNC45NjAxQzEuNjAxNTYgNS4zMTM1NiAxLjg4ODEgNS42MDAxIDIuMjQxNTYgNS42MDAxSDQuOTYxNTZDNS4zMTUwMiA1LjYwMDEgNS42MDE1NiA1LjMxMzU2IDUuNjAxNTYgNC45NjAxVjIuMjQwMUM1LjYwMTU2IDEuODg2NjQgNS4zMTUwMiAxLjYwMDEgNC45NjE1NiAxLjYwMDFaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00Ljk2MTU2IDEwLjM5OTlIMi4yNDE1NkMxLjg4ODEgMTAuMzk5OSAxLjYwMTU2IDEwLjY4NjQgMS42MDE1NiAxMS4wMzk5VjEzLjc1OTlDMS42MDE1NiAxNC4xMTM0IDEuODg4MSAxNC4zOTk5IDIuMjQxNTYgMTQuMzk5OUg0Ljk2MTU2QzUuMzE1MDIgMTQuMzk5OSA1LjYwMTU2IDE0LjExMzQgNS42MDE1NiAxMy43NTk5VjExLjAzOTlDNS42MDE1NiAxMC42ODY0IDUuMzE1MDIgMTAuMzk5OSA0Ljk2MTU2IDEwLjM5OTlaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik0xMy43NTg0IDEuNjAwMUgxMS4wMzg0QzEwLjY4NSAxLjYwMDEgMTAuMzk4NCAxLjg4NjY0IDEwLjM5ODQgMi4yNDAxVjQuOTYwMUMxMC4zOTg0IDUuMzEzNTYgMTAuNjg1IDUuNjAwMSAxMS4wMzg0IDUuNjAwMUgxMy43NTg0QzE0LjExMTkgNS42MDAxIDE0LjM5ODQgNS4zMTM1NiAxNC4zOTg0IDQuOTYwMVYyLjI0MDFDMTQuMzk4NCAxLjg4NjY0IDE0LjExMTkgMS42MDAxIDEzLjc1ODQgMS42MDAxWiIgZmlsbD0iI2ZmZiIvPgo8cGF0aCBkPSJNNCAxMkwxMiA0TDQgMTJaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00IDEyTDEyIDQiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K&logoColor=ffffff)](https://zread.ai/Teelon/Local-Lakehouse)

> **Status:** Early-stage / actively developed. Core ingestion → query flow works end to end; expect rough edges. Issues and PRs welcome.

An open-source, self-hostable lakehouse data stack engineered for small teams and single-node workloads.

Turn _"wire together an object store, catalog, and query engine yourself"_ into a single `docker compose up`.

<p align="center">
  <img src="media/docker-containers.png" alt="Local Lakehouse Containers running healthy in Docker Desktop" width="100%">
</p>

---

## Overview

**Local Lakehouse** gives teams the complete power of a modern data lakehouse — automated file ingestion, structured Medallion storage (Bronze/Silver/Gold), transactional table commits, and an interactive SQL Studio — in an integrated, self-contained stack that runs smoothly on a single VPS or local workstation.

Traditional analytical stacks often force teams into complex, expensive distributed setups (Spark clusters, Trino engines, external metastores, or high cloud warehouse bills) when their datasets comfortably fit in tens of gigabytes to terabytes on modern multicore hardware. Local Lakehouse is purpose-built to deliver lightning-fast analytics, open file formats, and full data sovereignty without the operational complexity of distributed platforms.

---

## Technology Stack: Why We Chose Our Tools

Every component in Local Lakehouse was selected to deliver maximum analytical throughput, open standards, and operational simplicity:

### 1. DuckDB — In-Process Analytical Powerhouse
- **Why we chose it**: DuckDB provides state-of-the-art vectorized columnar execution with sub-second query response times. It runs in-process with zero network serialization overhead, executes directly against Parquet files with column pruning and predicate pushdown, and requires no JVM or cluster orchestration.

### 2. DuckLake — Native Open Table ACID Commits
- **Why we chose it**: DuckLake extends DuckDB with open-table transactional capabilities. It brings atomic commits, snapshot isolation, and schema evolution directly to our Parquet tables on S3 storage. DuckLake keeps its metadata in a lightweight PostgreSQL schema (`ducklake_catalog`), giving us full lakehouse consistency without the overhead of heavy external metastore services.

### 3. RustFS — High-Performance Embedded S3 Storage
- **Why we chose it**: Written in Rust, RustFS is an ultra-fast, memory-safe, S3-compatible object store with minimal memory and CPU overhead. It natively supports AWS STS temporary credentials, enabling secure multi-tenant path namespacing and high-concurrency read/write streams.

### 4. Next.js 15 & Payload CMS 3.0 — Unified TypeScript Control Plane
- **Why we chose it**: Payload CMS 3.0 runs natively inside Next.js 15, providing a robust headless CMS data layer, tenant management, and an asynchronous background task queue engine. Coupled with React 19, it gives users an elegant interactive UI (SQL Studio, Ingestion Uploader, Views Manager, and Documentation Hub) built on a unified TypeScript stack.

### 5. FastAPI & PyArrow — Asynchronous Processing Worker
- **Why we chose it**: FastAPI offers high-performance asynchronous request handling for ingestion pipelines. Paired with PyArrow and DuckDB's Python runtime, it cleans, normalizes, and streams multi-gigabyte datasets without memory explosion.

### 6. PostgreSQL 16 — Rock-Solid Relational Persistence
- **Why we chose it**: PostgreSQL serves as the reliable single source of truth for both Payload CMS operational state (users, tenants, job histories) and the DuckLake catalog metadata (table schemas, snapshot commits, file manifests).

---

## Architecture & Component Blueprint

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Control Plane (apps/web)                           │
│  Next.js 15 • Payload CMS 3.0 • Tenant Management • Web SQL Studio • Docs   │
└───────────────────────┬─────────────────────────────┬───────────────────────┘
                        │ HTTP / Task Dispatch        │ SQL / DuckDB Queries
                        ▼                             ▼
┌───────────────────────────────────┐    ┌────────────────────────────────────┐
│      Worker (services/worker)     │    │       DuckDB + DuckLake Catalog    │
│  FastAPI • IngestionCleaner • Arrow│───►│    Transactional Table Commits     │
└─────────────────┬─────────────────┘    └─────────────────┬──────────────────┘
                  │ S3 API                                 │ S3 API / Parquet
                  ▼                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       RustFS S3-Compatible Storage                          │
│          Tenant Isolation: raw/  •  tables/  •  metadata/                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

| Component | Technology | Role & Responsibilities |
|---|---|---|
| **Control Plane** | Next.js 15, Payload CMS 3.0, React 19 | Admin dashboard, tenant management, dataset uploader, interactive SQL Studio, and Documentation Hub. |
| **Processing Worker** | Python 3.11+, FastAPI, PyArrow | Asynchronous ingestion worker, schema inference, automated data normalization, and DuckLake commits. |
| **Analytics Engine** | DuckDB + DuckLake | In-process analytical queries, transactional writes, snapshot tracking, and Gold virtual view evaluation. |
| **Object Storage** | RustFS (S3 Compatible) | Local object storage with tenant-isolated bucket prefixes (`raw/`, `tables/`, `gold/`). |
| **Metadata DB** | PostgreSQL 16 | Relational storage for Payload CMS application state and the DuckLake transactional catalog. |

---

## Multi-Tenant Security & Storage Isolation

Local Lakehouse MVP 1 is designed for **small teams of trusted users** running a self-hosted instance. It intentionally has **no session-based, JWT, or OAuth authentication**.

### Why No Authentication in MVP 1?
For an initial Proof of Concept (POC), authentication is one more heavyweight system to configure, maintain, and troubleshoot. We decided it was not worth the setup friction when evaluating core lakehouse performance, ingestion throughput, and analytical query execution. 

### What This Means in Practice
- `tenant_id` is a **caller-supplied value** (selected directly in the workspace UI or passed via API requests).
- Users can immediately test multi-tenant workflows, simulate isolated environments, and switch workspaces without configuring identity providers, logins, or user directories first.

### Enforced Isolation Boundaries
Even without auth friction, Local Lakehouse enforces strict isolation mechanisms across tenant boundaries:

| Security Boundary | Mechanism & Enforcement |
|---|---|
| **S3 Storage Namespacing** | All object keys are partitioned by tenant prefix (`tenants/{tenant_id}/raw/`, `tenants/{tenant_id}/tables/`, `tenants/{tenant_id}/gold/`). |
| **STS Temporary Credentials** | File uploads use short-lived AWS STS AssumeRole credentials strictly scoped to the tenant's designated S3 prefix. |
| **DuckDB Schema Partitioning** | Each tenant operates inside dedicated DuckDB schemas (`{tenant_id}_silver`, `{tenant_id}_gold`), preventing cross-tenant schema collision. |
| **SQL Query AST Inspection** | `query-service.ts` inspects all incoming SQL queries against strict AST validation rules, blocking cross-tenant references, unauthorized schema access, and dangerous system commands. |
| **Worker Network Isolation** | The Python processing worker is confined to internal Docker network boundaries and communicates exclusively with the Control Plane. |

---

## Data Ingestion: How Raw Data Becomes Silver

Local Lakehouse automates the full ingestion and transformation lifecycle, turning unvalidated raw files into high-performance, queryable Silver Parquet tables with zero data engineering overhead.

```
┌─────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
│   Raw Source    │  STS  │   RustFS S3 Bucket   │       │  Payload CMS Engine  │
│ CSV/JSON/Parquet│ ────► │ tenants/{tenant}/raw │ ────► │  Datasets Collection │
└─────────────────┘       └──────────────────────┘       │  State: 'uploaded'   │
                                                         └──────────┬───────────┘
                                                                    │ Enqueue Job
                                                                    ▼
┌─────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
│  DuckDB Studio  │ View  │  DuckLake Committer  │ DuckDB│    FastAPI Worker    │
│ {tenant}_silver │ ◄──── │ Parquet + PG Catalog │ ◄──── │   IngestionCleaner   │
└─────────────────┘       └──────────────────────┘       └──────────────────────┘
```

### The 6-Stage Ingestion Lifecycle

1. **STS-Scoped Raw Landing (Bronze)**:
   - When a tenant uploads a file (CSV, Parquet, or JSON), the Control Plane requests temporary AWS STS credentials strictly scoped to `tenants/{tenant_id}/*`.
   - The file lands immutably in RustFS S3 under:
     ```text
     s3://lakehouse-bucket/tenants/{tenant_id}/raw/{timestamp}_{filename}
     ```
   - This provides an immutable audit trail, allowing data to be safely re-processed or backfilled at any time.

2. **Metadata Registration (Payload CMS)**:
   - A dataset record is created inside the Payload CMS `datasets` collection with status `uploaded`, storing file format, target table name, tenant ID, and raw storage URI.

3. **Asynchronous Background Task Dispatch**:
   - Payload's `afterChange` hook detects the `uploaded` state and dispatches the `ingest-file` background task to the Python processing worker via `POST /api/v1/jobs/ingest`.
   - The dataset status updates to `processing`.

4. **Data Cleansing & Normalization (`IngestionCleaner`)**:
   - The FastAPI worker executes the `IngestionCleaner` module over DuckDB:
     - **Column Name Sanitization**: Strips invalid characters, replaces spaces and special characters with underscores, deduplicates consecutive underscores, and forces lowercase (e.g., `"Order ID (#)"` → `"order_id"`).
     - **Format & Delimiter Auto-Detection**: Uses DuckDB's parallel CSV detector, JSON schema deduction, or zero-copy Parquet readers.
     - **Streaming Relation**: Creates an in-memory DuckDB relation without high-memory serialization.

5. **DuckLake Transactional Parquet Commit**:
   - Under an asynchronous write lock (`_write_lock`), the `DuckLakeCommitter` commits the sanitized relation:
     - **Parquet Storage**: Writes snappy-compressed Parquet files to `s3://lakehouse-bucket/tenants/{tenant_id}/tables/{table_name}/*.parquet`.
     - **PostgreSQL Metadata Catalog**: Updates table definitions, column types, snapshot IDs, and file manifests inside the PostgreSQL schema `ducklake_catalog`.
     - Ensures full ACID transactions (atomic commit, schema evolution, and rollback safety).

6. **Live Queryable Silver View Registration**:
   - The engine creates a live schema-qualified view in DuckDB:
     ```sql
     CREATE OR REPLACE VIEW {tenant_id}_silver.{table_name} AS
     SELECT * FROM lakehouse_cat.{tenant_id}_silver.{table_name};
     ```
   - The dataset status transitions to `completed`, recording duration in milliseconds and total row count. The table is immediately queryable in the Web SQL Studio.

---

## The Medallion Architecture

Local Lakehouse organizes data into structured medallion layers:

| Layer | Name | Storage Path | Description | Query Access |
|---|---|---|---|---|
| 🥉 **Bronze** | Raw Landing | `tenants/{tenant}/raw/` | Immutable, original files (CSV, JSON, Parquet). Preserves audit trail. | Via raw S3 reader |
| 🥈 **Silver** | Cleaned Tables | `tenants/{tenant}/tables/` | Cleaned, typed, normalized open Parquet tables managed by DuckLake. | `{tenant}_silver.{table}` |
| 🥇 **Gold** | Curated Views & Marts | Virtual (0 KB) or `tenants/{tenant}/gold/` | Aggregated business metrics, reporting marts, and transformed views. | `{tenant}_gold.{view}` |

> **Gold Virtual Views**: In Local Lakehouse, Gold views can be created with **zero Parquet storage footprint** as virtual SQL views re-evaluated live against Silver tables, or materialized into dedicated Parquet storage for high-frequency dashboard queries.

---

## Interactive In-App Documentation Hub

The web application includes a built-in, comprehensive **Documentation Hub** accessible directly from the left sidebar navigation menu:

- **Location**: Click the **Documentation** tab at the bottom of the primary menu area.
- **Features**:
  - Interactive visual pipeline flow diagrams.
  - Step-by-step ingestion and raw-to-silver technical walkthroughs.
  - Storage layout and STS credential isolation deep-dives.
  - Interactive REST API reference with copyable `curl` requests.
  - "Try Ingestion" and "Open in SQL Studio" direct action shortcuts.


## Quickstart

### Option 1: Docker Compose (Recommended)

Boot the entire stack (PostgreSQL, RustFS, Python Worker, and Web UI) with one command:

1. **Clone the repository**:

   ```bash
   git clone https://github.com/Teelon/Local-Lakehouse.git
   cd Local-Lakehouse
   ```

2. **Set up environment variables**:

   ```bash
   # Windows PowerShell
   if (!(Test-Path .env)) { Copy-Item .env.example .env }

   # Linux / macOS
   cp -n .env.example .env
   ```

3. **Start the containers**:

   ```bash
   docker compose up -d --build
   ```

4. **Verify container health**:
   ```bash
   docker compose ps
   ```

---

### Option 2: Standalone Local Development

For fast local iteration on the frontend or worker:

#### 1. Web Control Plane (Next.js + Payload)

```bash
cd apps/web
npm install
npm run dev
```

Access the application at [http://localhost:3000](http://localhost:3000) and the Payload Admin panel at [http://localhost:3000/admin](http://localhost:3000/admin).

#### 2. Processing Worker (FastAPI)

```bash
cd services/worker
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux / macOS:
source .venv/bin/activate

pip install -e .
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Test the worker health endpoint:

```bash
curl http://localhost:8000/healthz
```

---

## Service Endpoints & Default Ports

| Service               | Port            | Default URL                                                | Description                                                  |
| --------------------- | --------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| **Web Control Plane** | `3000`          | [http://localhost:3000](http://localhost:3000)             | Main application & Interactive DuckDB SQL Studio             |
| **Payload CMS Admin** | `3000`          | [http://localhost:3000/admin](http://localhost:3000/admin) | Auth, Tenant management, and Collection administration       |
| **FastAPI Worker**    | `8000`          | [http://localhost:8000](http://localhost:8000)             | Ingestion and transformation API                             |
| **RustFS Console**    | `9001`          | [http://localhost:9001](http://localhost:9001)             | Object storage web console (user: `lakehouse_storage_admin`) |
| **RustFS S3 API**     | `9000`          | [http://localhost:9000](http://localhost:9000)             | S3-compatible API endpoint                                   |
| **PostgreSQL**        | `5432` / `5433` | `localhost:5432`                                           | Shared operational database & DuckLake catalog               |

---

## Repository Structure

```
Local-Lakehouse/
├── apps/
│   └── web/                   # Next.js 15 + Payload CMS 3.0 control plane & SQL studio
│       ├── Dockerfile
│       ├── package.json
│       └── src/
├── services/
│   └── worker/                # Python + FastAPI processing & DuckLake worker
│       ├── Dockerfile
│       ├── pyproject.toml
│       └── app/
├── infrastructure/
│   ├── postgres/              # PostgreSQL initialization scripts and schemas
│   └── storage/               # Storage configurations
├── media/                     # Project screenshots and documentation assets
├── .env.example               # Template environment configuration
├── docker-compose.yml         # Full multi-container composition
├── LICENSE                    # Apache 2.0 License
└── README.md                  # Project documentation
```

---

## Teardown & Data Reset

Stop containers:

```bash
docker compose down
```

Stop containers and remove persistent data volumes (`postgres_data`, `storage_data`):

```bash
docker compose down -v
```

---

## License

This project is licensed under the **Apache License 2.0**. See the [LICENSE](LICENSE) file for complete details.

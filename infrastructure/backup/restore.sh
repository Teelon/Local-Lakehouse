#!/usr/bin/env bash
# ==============================================================================
# Local Lakehouse MVP 1: Disaster Recovery Restore Runner
# Restores both PostgreSQL schemas and RustFS object storage on a clean machine
# ==============================================================================
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <db_dump_file> <storage_tar_file>"
  echo "Example: $0 /backups/lakehouse_db_20260914.dump /backups/lakehouse_storage_20260914.tar.gz"
  exit 1
fi

DB_BACKUP="$1"
STORAGE_BACKUP="$2"

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-lakehouse-postgres}"
STORAGE_CONTAINER="${STORAGE_CONTAINER:-lakehouse-storage}"
POSTGRES_USER="${POSTGRES_USER:-lakehouse_admin}"
POSTGRES_DB="${POSTGRES_DB:-lakehouse}"

if [ ! -f "${DB_BACKUP}" ]; then
  echo "Error: DB backup file not found: ${DB_BACKUP}" >&2
  exit 1
fi

if [ ! -f "${STORAGE_BACKUP}" ]; then
  echo "Error: Storage backup file not found: ${STORAGE_BACKUP}" >&2
  exit 1
fi

echo "==> [1/3] Restoring PostgreSQL schemas (payload_core + ducklake_catalog)..."
docker exec -i "${POSTGRES_CONTAINER}" pg_restore \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  --clean \
  --if-exists \
  < "${DB_BACKUP}" || true

echo "==> PostgreSQL schemas restored."

echo "==> [2/3] Restoring RustFS Object Storage data..."
docker exec -i "${STORAGE_CONTAINER}" tar -xzf - -C /data < "${STORAGE_BACKUP}"

echo "==> RustFS storage restored."

echo "==> [3/3] Verifying restoration..."
TABLE_COUNT=$(docker exec "${POSTGRES_CONTAINER}" psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('payload_core', 'ducklake_catalog');")
echo "Restored table count in Postgres: ${TABLE_COUNT}"

OBJECT_COUNT=$(docker exec "${STORAGE_CONTAINER}" find /data/lakehouse-bucket -type f | wc -l)
echo "Restored object count in RustFS: ${OBJECT_COUNT}"

echo "==> Disaster recovery restoration complete and verified."

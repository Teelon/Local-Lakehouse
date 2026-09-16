#!/usr/bin/env bash
# ==============================================================================
# Local Lakehouse MVP 1: Automated Backup Runner
# Covers both PostgreSQL schemas (payload_core + ducklake_catalog) and RustFS storage
# ==============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-lakehouse-postgres}"
STORAGE_CONTAINER="${STORAGE_CONTAINER:-lakehouse-storage}"
POSTGRES_USER="${POSTGRES_USER:-lakehouse_admin}"
POSTGRES_DB="${POSTGRES_DB:-lakehouse}"

mkdir -p "${BACKUP_DIR}"

echo "==> [1/3] Starting atomic PostgreSQL backup (payload_core + ducklake_catalog)..."
DB_BACKUP_FILE="${BACKUP_DIR}/lakehouse_db_${TIMESTAMP}.dump"
docker exec "${POSTGRES_CONTAINER}" pg_dump \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  -Fc \
  --schema=payload_core \
  --schema=ducklake_catalog \
  > "${DB_BACKUP_FILE}"

echo "==> PostgreSQL backup complete: ${DB_BACKUP_FILE} ($(du -h "${DB_BACKUP_FILE}" | cut -f1))"

echo "==> [2/3] Snapshotting RustFS Object Storage volume..."
STORAGE_BACKUP_FILE="${BACKUP_DIR}/lakehouse_storage_${TIMESTAMP}.tar.gz"
docker exec "${STORAGE_CONTAINER}" tar -czf - -C /data lakehouse-bucket > "${STORAGE_BACKUP_FILE}"

echo "==> RustFS storage backup complete: ${STORAGE_BACKUP_FILE} ($(du -h "${STORAGE_BACKUP_FILE}" | cut -f1))"

echo "==> [3/3] Generating checksum manifest..."
MANIFEST_FILE="${BACKUP_DIR}/manifest_${TIMESTAMP}.txt"
sha256sum "${DB_BACKUP_FILE}" "${STORAGE_BACKUP_FILE}" > "${MANIFEST_FILE}"

echo "==> Backup successfully completed at ${TIMESTAMP}."
echo "Manifest: ${MANIFEST_FILE}"

-- ==============================================================================
-- 01-init-schemas.sql
-- Initializes isolated database schemas for:
-- 1) Payload CMS Control Plane & Jobs Queue (payload_core)
-- 2) DuckLake Table Catalog & Snapshots (ducklake_catalog)
-- ==============================================================================

-- Ensure necessary extensions are installed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Schema 1: Payload CMS operational tables (auth, tenants, datasets, jobs)
CREATE SCHEMA IF NOT EXISTS payload_core;

-- Schema 2: DuckLake table catalog, manifests, schema definitions, and snapshots
CREATE SCHEMA IF NOT EXISTS ducklake_catalog;

-- Set default permissions for lakehouse_admin
GRANT ALL ON SCHEMA payload_core TO CURRENT_USER;
GRANT ALL ON SCHEMA ducklake_catalog TO CURRENT_USER;

ALTER DEFAULT PRIVILEGES IN SCHEMA payload_core GRANT ALL ON TABLES TO CURRENT_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA payload_core GRANT ALL ON SEQUENCES TO CURRENT_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA ducklake_catalog GRANT ALL ON TABLES TO CURRENT_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA ducklake_catalog GRANT ALL ON SEQUENCES TO CURRENT_USER;

-- Comment schemas for clarity
COMMENT ON SCHEMA payload_core IS 'Operational state for Payload CMS: users, tenants, datasets, and background jobs.';
COMMENT ON SCHEMA ducklake_catalog IS 'DuckLake metadata catalog: stores table definitions, partitions, and transaction snapshots.';

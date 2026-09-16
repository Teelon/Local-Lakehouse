import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { LakehouseQueryService } from '@/services/query-service'
import { extractTableDependencies } from '@/lib/sql-dependencies'
import { TenantRepository, DatasetRepository } from '@/repositories'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    // NOTE: tenant_id is caller-supplied and not cryptographically verified (MVP 1 — no auth).
    // Query isolation is enforced via queryService.validateQuery() below.
    const {
      tenant_id,
      name,
      query,
      action = 'view', // 'view' | 'materialize'
      dependencies = [],
    } = body

    if (!tenant_id || !name || !query) {
      return NextResponse.json(
        { error: 'tenant_id, name, and query are required' },
        { status: 400 }
      )
    }

    const cleanName = name.trim().replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()

    // 1. Enforce tenant query isolation on the SQL query before proceeding
    const queryService = new LakehouseQueryService()
    try {
      queryService.validateQuery(tenant_id, query)
    } catch (err: any) {
      return NextResponse.json(
        { error: `Query validation failed: ${err.message}` },
        { status: 403 }
      )
    }

    const workerUrl = process.env.WORKER_URL || 'http://worker:8000'
    const endpoint =
      action === 'materialize'
        ? `${workerUrl}/api/v1/gold/materialize`
        : `${workerUrl}/api/v1/gold/view`

    const workerPayload =
      action === 'materialize'
        ? { tenant_id, table_name: cleanName, query }
        : { tenant_id, view_name: cleanName, query }

    // 2. Execute view or materialized table creation in worker
    const workerRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workerPayload),
    })

    if (!workerRes.ok) {
      const errData = await workerRes.json().catch(() => ({}))
      return NextResponse.json(
        { error: errData.detail || 'Failed to create Gold object in worker' },
        { status: workerRes.status }
      )
    }

    const workerData = await workerRes.json()

    // 3. Register or update Gold object in Payload CMS Datasets collection with dependency tracking
    const payload = await getPayload({ config: configPromise })
    const tenantRepo = new TenantRepository(payload)
    const datasetRepo = new DatasetRepository(payload)

    const tenantDoc = await tenantRepo.findOrCreateBySlug(tenant_id)
    const tenantDocId = tenantDoc.id

    // Auto-extract dependencies from query if not provided
    const finalDeps =
      Array.isArray(dependencies) && dependencies.length > 0
        ? [...dependencies]
        : extractTableDependencies(query, tenant_id, cleanName)

    const dataset = await datasetRepo.createOrUpdateGoldDataset({
      name: cleanName,
      tenantDocId,
      objectType: (action === 'materialize' ? 'table' : 'view') as 'table' | 'view',
      sqlQuery: query,
      dependencies: finalDeps,
      format: (action === 'materialize' ? 'parquet' : 'sql_view') as 'parquet' | 'sql_view',
      ducklakeTable: `${tenant_id}_gold.${cleanName}`,
      rowCount: workerData.row_count ?? 0,
    })
    const datasetId = String(dataset.id)

    return NextResponse.json({
      success: true,
      dataset_id: datasetId,
      tenant_id,
      name: cleanName,
      full_name: `${tenant_id}_gold.${cleanName}`,
      layer: 'gold',
      object_type: action === 'materialize' ? 'table' : 'view',
      columns: workerData.columns || [],
      row_count: workerData.row_count,
      dependencies: finalDeps,
      message:
        action === 'materialize'
          ? `Materialized Gold table '${cleanName}' created with Parquet storage.`
          : `Gold SQL view '${cleanName}' created (zero storage, live recomputed).`,
    })
  } catch (err: any) {
    console.error('Gold creation error:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to create Gold object' },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tenantId = searchParams.get('tenant_id') || 'tenant_acme'

    const payload = await getPayload({ config: configPromise })
    const tenantRepo = new TenantRepository(payload)
    const datasetRepo = new DatasetRepository(payload)

    const tenantDoc = await tenantRepo.findBySlug(tenantId)
    const datasets = tenantDoc
      ? await datasetRepo.findByTenantId(tenantDoc.id, { layer: 'gold', limit: 100, sort: '-updatedAt' })
      : []

    // Also fetch tables from worker to verify DuckDB schema / catch any direct tables
    const workerUrl = process.env.WORKER_URL || 'http://worker:8000'
    let workerGoldTables: any[] = []
    try {
      const res = await fetch(`${workerUrl}/api/v1/tables?tenant_id=${encodeURIComponent(tenantId)}`)
      if (res.ok) {
        const tData = await res.json()
        workerGoldTables = (tData.tables || []).filter((t: any) => t.layer === 'gold')
      }
    } catch (e) {
      console.warn('Worker tables fetch error in GET /api/gold:', e)
    }

    const goldObjects = datasets.map((doc: any) => {
      const deps: string[] =
        Array.isArray(doc.dependencies) && doc.dependencies.length > 0
          ? doc.dependencies
          : extractTableDependencies(doc.sqlQuery || '', tenantId, doc.name)

      return {
        id: String(doc.id),
        name: doc.name,
        full_name: doc.ducklakeTable || `${tenantId}_gold.${doc.name}`,
        layer: 'gold',
        objectType: (doc.objectType || (doc.format === 'parquet' ? 'table' : 'view')) as 'view' | 'table',
        sqlQuery: doc.sqlQuery || `CREATE VIEW ${tenantId}_gold.${doc.name} AS SELECT * FROM ${tenantId}_silver.${doc.name};`,
        dependencies: deps,
        rowCount: doc.rowCount ?? null,
        updatedAt: doc.updatedAt || doc.createdAt || null,
        createdAt: doc.createdAt || null,
      }
    })

    // Add any worker gold tables not already in payload docs
    for (const wt of workerGoldTables) {
      if (!goldObjects.some((g: any) => g.name === wt.name)) {
        goldObjects.push({
          id: `worker-${wt.name}`,
          name: wt.name,
          full_name: wt.full_name,
          layer: 'gold',
          objectType: (wt.type || 'view') as 'view' | 'table',
          sqlQuery: `SELECT * FROM ${wt.full_name};`,
          dependencies: [],
          rowCount: null,
          updatedAt: null,
          createdAt: null,
        })
      }
    }

    return NextResponse.json({
      success: true,
      tenant_id: tenantId,
      gold_objects: goldObjects,
    })
  } catch (err: any) {
    console.error('Error fetching gold objects:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

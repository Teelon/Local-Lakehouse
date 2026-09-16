import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@/payload.config'
import { LakehouseQueryService } from '@/services/query-service'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
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

    // Find tenant
    const tenants = await payload.find({
      collection: 'tenants',
      where: { slug: { equals: tenant_id } },
      limit: 1,
    })

    let tenantDocId = tenants.docs[0]?.id
    if (!tenantDocId) {
      const newTenant = await payload.create({
        collection: 'tenants',
        data: { name: tenant_id, slug: tenant_id, active: true },
      })
      tenantDocId = newTenant.id
    }

    // Check if dataset record already exists for this gold object
    const existing = await payload.find({
      collection: 'datasets',
      where: {
        and: [
          { tenant: { equals: tenantDocId } },
          { name: { equals: cleanName } },
          { layer: { equals: 'gold' } },
        ],
      },
      limit: 1,
    })

    const datasetData = {
      name: cleanName,
      tenant: tenantDocId,
      layer: 'gold' as const,
      objectType: (action === 'materialize' ? 'table' : 'view') as 'table' | 'view',
      sqlQuery: query,
      dependencies,
      format: (action === 'materialize' ? 'parquet' : 'sql_view') as 'parquet' | 'sql_view',
      status: 'completed' as const,
      ducklakeTable: `${tenant_id}_gold.${cleanName}`,
      rowCount: workerData.row_count ?? 0,
    }

    let datasetId: string
    if (existing.docs.length > 0) {
      const updated = await payload.update({
        collection: 'datasets',
        id: existing.docs[0].id,
        data: datasetData,
      })
      datasetId = String(updated.id)
    } else {
      const created = await payload.create({
        collection: 'datasets',
        data: datasetData,
      })
      datasetId = String(created.id)
    }

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

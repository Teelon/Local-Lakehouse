import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { TenantRepository, DatasetRepository } from '@/repositories'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      // NOTE: tenant_id is caller-supplied and not cryptographically verified (MVP 1 — no auth).
      // Tenant storage and catalog boundaries ARE enforced, but nothing prevents a caller from
      // claiming to be any tenant. See README Security Model section.
      tenant_id,
      name,
      layer = 'silver', // 'silver' | 'gold'
      object_type = 'table', // 'table' | 'view'
      force = false,
    } = body

    if (!tenant_id || !name) {
      return NextResponse.json(
        { error: 'tenant_id and name are required' },
        { status: 400 }
      )
    }

    const payload = await getPayload({ config: configPromise })
    const tenantRepo = new TenantRepository(payload)
    const datasetRepo = new DatasetRepository(payload)

    // Resolve the tenant document first — needed both for the scoped query below
    // and for the delete step further down.
    const tenantDoc = await tenantRepo.findBySlug(tenant_id)

    if (!tenantDoc) {
      return NextResponse.json(
        { error: `Tenant '${tenant_id}' not found` },
        { status: 404 }
      )
    }

    // 1. Dependency Check before deleting Silver table (or Gold table).
    const goldDatasets = await datasetRepo.findGoldDependents(tenantDoc.id)

    const dependentObjects: string[] = []
    for (const doc of goldDatasets as any[]) {
      // Check explicit dependencies array
      const deps: string[] = Array.isArray(doc.dependencies) ? doc.dependencies : []
      const sql: string = (doc.sqlQuery || '').toLowerCase()

      const isDep =
        deps.includes(name) ||
        deps.includes(`${tenant_id}_silver.${name}`) ||
        deps.includes(`${tenant_id}_${name}`) ||
        sql.includes(name.toLowerCase())

      if (isDep) {
        dependentObjects.push(`${doc.name} (${doc.objectType || 'view'})`)
      }
    }

    if (dependentObjects.length > 0 && !force) {
      return NextResponse.json(
        {
          has_dependents: true,
          error: `Cannot delete ${layer} object '${name}' because Gold objects depend on it: ${dependentObjects.join(', ')}. Drop or update dependent views first, or specify force=true.`,
          dependents: dependentObjects,
        },
        { status: 409 }
      )
    }

    // 2. Call Worker to delete dataset from DuckDB catalog and purge specific RustFS prefix
    const workerUrl = process.env.WORKER_URL || 'http://worker:8000'
    const workerRes = await fetch(`${workerUrl}/api/v1/datasets/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id,
        name,
        layer,
        object_type,
      }),
    })

    if (!workerRes.ok) {
      const errData = await workerRes.json().catch(() => ({}))
      return NextResponse.json(
        { error: errData.detail || 'Worker dataset deletion failed' },
        { status: workerRes.status }
      )
    }

    const workerResult = await workerRes.json()

    // 3. Delete records in Payload Datasets collection — scoped to this tenant by ID
    const matching = await datasetRepo.findByTenantAndName(tenantDoc.id, name, layer as any)
    if (matching) {
      await datasetRepo.delete(matching.id)
    }

    return NextResponse.json({
      success: true,
      tenant_id,
      name,
      layer,
      object_type,
      storage_purged: workerResult.storage_purged,
      message: `Successfully deleted ${layer} ${object_type} '${name}'.`,
    })
  } catch (err: any) {
    console.error('Dataset deletion error:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to delete dataset' },
      { status: 500 }
    )
  }
}

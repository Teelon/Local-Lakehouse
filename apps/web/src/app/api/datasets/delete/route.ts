import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@/payload.config'

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

    // Resolve the tenant document first — needed both for the scoped query below
    // and for the delete step further down.
    const tenantLookup = await payload.find({
      collection: 'tenants',
      where: { slug: { equals: tenant_id } },
      limit: 1,
    })

    if (tenantLookup.docs.length === 0) {
      return NextResponse.json(
        { error: `Tenant '${tenant_id}' not found` },
        { status: 404 }
      )
    }

    const tenantDoc = tenantLookup.docs[0] as any

    // 1. Dependency Check before deleting Silver table (or Gold table).
    // Bug fix: previously queried Gold datasets with no tenant filter (across ALL tenants),
    // and used depth:0 so doc.tenant was an unpopulated ID — doc.tenant?.slug was always
    // undefined, meaning the guard docTenant !== tenant_id silently always passed.
    // Fix: filter by tenant at query time, and use depth:1 to populate tenant.slug.
    const goldDatasets = await payload.find({
      collection: 'datasets',
      depth: 1,
      where: {
        and: [
          { layer: { equals: 'gold' } },
          { tenant: { equals: tenantDoc.id } },
        ],
      },
      limit: 100,
    })

    const dependentObjects: string[] = []
    for (const doc of goldDatasets.docs as any[]) {
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
    const matchingDatasets = await payload.find({
      collection: 'datasets',
      depth: 1,
      where: {
        and: [
          { name: { equals: name } },
          { layer: { equals: layer } },
          { tenant: { equals: tenantDoc.id } },
        ],
      },
      limit: 10,
    })

    for (const doc of matchingDatasets.docs) {
      await payload.delete({
        collection: 'datasets',
        id: doc.id,
      })
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

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@/payload.config'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
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

    // 1. Dependency Check before deleting Silver table (or Gold table)
    // Find all Gold datasets for this tenant
    const goldDatasets = await payload.find({
      collection: 'datasets',
      where: {
        and: [
          { layer: { equals: 'gold' } },
        ],
      },
      limit: 100,
    })

    const dependentObjects: string[] = []
    for (const doc of goldDatasets.docs as any[]) {
      // Check if doc belongs to same tenant
      const docTenant = typeof doc.tenant === 'object' ? doc.tenant?.slug : doc.tenant
      if (docTenant !== tenant_id) continue

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

    // 3. Delete or mark deleted in Payload Datasets collection
    const matchingDatasets = await payload.find({
      collection: 'datasets',
      where: {
        and: [
          { name: { equals: name } },
          { layer: { equals: layer } },
        ],
      },
      limit: 10,
    })

    for (const doc of matchingDatasets.docs) {
      const docTenant = typeof doc.tenant === 'object' ? (doc.tenant as any).slug : doc.tenant
      if (docTenant === tenant_id) {
        await payload.delete({
          collection: 'datasets',
          id: doc.id,
        })
      }
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

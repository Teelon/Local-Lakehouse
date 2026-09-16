import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@/payload.config'

function formatTenantFriendlyName(slug: string): string {
  if (slug === 'tenant_acme') return 'Acme Corp (EU-Prod)'
  if (slug === 'tenant_globex') return 'Globex Corporation'
  if (slug === 'tenant_a') return 'Tenant Alpha'
  if (slug === 'tenant_b') return 'Tenant Beta'
  
  // Format tenant_foo_bar -> Foo Bar
  const clean = slug.replace(/^tenant_/, '').replace(/[_-]+/g, ' ').trim()
  return clean
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export async function GET() {
  try {
    const payload = await getPayload({ config: configPromise })
    const workerUrl = process.env.WORKER_URL || 'http://worker:8000'

    // 1. Fetch tenants currently registered in Payload CMS
    const payloadTenants = await payload.find({
      collection: 'tenants',
      limit: 100,
      sort: 'name',
    })

    const existingSlugs = new Set(payloadTenants.docs.map((d: any) => d.slug))

    // 2. Discover tenants from storage via Worker
    try {
      const workerRes = await fetch(`${workerUrl}/api/v1/tenants`)
      if (workerRes.ok) {
        const workerData = await workerRes.json()
        const storageTenants: string[] = workerData.tenants || []

        for (const slug of storageTenants) {
          if (!existingSlugs.has(slug)) {
            const name = formatTenantFriendlyName(slug)
            try {
              const created = await payload.create({
                collection: 'tenants',
                data: {
                  name,
                  slug,
                  active: true,
                  status: 'active',
                },
              })
              payloadTenants.docs.push(created as any)
              existingSlugs.add(slug)
            } catch (createErr) {
              console.warn(`Could not auto-register storage tenant ${slug}:`, createErr)
            }
          }
        }
      }
    } catch (workerErr) {
      console.warn('Could not query worker for storage tenants:', workerErr)
    }

    // 3. Count datasets per tenant
    const tenantsWithCounts = await Promise.all(
      payloadTenants.docs.map(async (doc: any) => {
        let datasetCount = 0
        try {
          const dsCount = await payload.count({
            collection: 'datasets',
            where: { tenant: { equals: doc.id } },
          })
          datasetCount = dsCount.totalDocs
        } catch {
          // Ignore count error
        }

        return {
          id: doc.id,
          name: doc.name,
          slug: doc.slug,
          active: doc.active !== false,
          status: doc.status || 'active',
          datasetCount,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        }
      })
    )

    // Sort active first, then alphabetically
    tenantsWithCounts.sort((a, b) => {
      if (a.slug === 'tenant_acme') return -1
      if (b.slug === 'tenant_acme') return 1
      return a.name.localeCompare(b.name)
    })

    return NextResponse.json({
      success: true,
      tenants: tenantsWithCounts,
    })
  } catch (err: any) {
    console.error('Failed to list tenants:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to list tenants' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, slug } = body

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Tenant name is required' }, { status: 400 })
    }

    const trimmedName = name.trim()
    let cleanSlug = (slug || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')

    if (!cleanSlug) {
      cleanSlug = `tenant_${trimmedName.toLowerCase().replace(/[^a-z0-9_-]+/g, '_')}`
    } else if (!cleanSlug.startsWith('tenant_')) {
      cleanSlug = `tenant_${cleanSlug}`
    }

    const payload = await getPayload({ config: configPromise })

    // Check if slug already exists
    const existing = await payload.find({
      collection: 'tenants',
      where: { slug: { equals: cleanSlug } },
      limit: 1,
    })

    if (existing.docs.length > 0) {
      return NextResponse.json(
        { error: `Tenant with identifier '${cleanSlug}' already exists` },
        { status: 409 }
      )
    }

    // 1. Create tenant in Payload CMS
    const newTenant = await payload.create({
      collection: 'tenants',
      data: {
        name: trimmedName,
        slug: cleanSlug,
        active: true,
        status: 'active',
      },
    })

    // 2. Initialize in storage and DuckDB via Worker
    const workerUrl = process.env.WORKER_URL || 'http://worker:8000'
    try {
      await fetch(`${workerUrl}/api/v1/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: cleanSlug,
          name: trimmedName,
        }),
      })
    } catch (workerErr) {
      console.warn('Worker tenant initialization warning:', workerErr)
    }

    return NextResponse.json(
      {
        success: true,
        tenant: {
          id: newTenant.id,
          name: newTenant.name,
          slug: newTenant.slug,
          active: newTenant.active,
          status: newTenant.status,
          datasetCount: 0,
        },
      },
      { status: 201 }
    )
  } catch (err: any) {
    console.error('Failed to create tenant:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to create tenant' },
      { status: 500 }
    )
  }
}

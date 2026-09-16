import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@/payload.config'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      action, // 'deactivate' | 'reactivate' | 'hard-delete'
      tenant_slug,
      grace_period_days = 14,
    } = body

    if (!tenant_slug || !action) {
      return NextResponse.json(
        { error: 'tenant_slug and action are required' },
        { status: 400 }
      )
    }

    const payload = await getPayload({ config: configPromise })

    // Find tenant
    const tenants = await payload.find({
      collection: 'tenants',
      where: { slug: { equals: tenant_slug } },
      limit: 1,
    })

    if (tenants.docs.length === 0) {
      return NextResponse.json({ error: `Tenant '${tenant_slug}' not found` }, { status: 404 })
    }

    const tenantDoc = tenants.docs[0]

    // Action 1: Deactivate (Synchronous STS revocation + inactive flag)
    if (action === 'deactivate') {
      const deletionDate = new Date()
      deletionDate.setDate(deletionDate.getDate() + grace_period_days)

      await payload.update({
        collection: 'tenants',
        id: tenantDoc.id,
        data: {
          active: false,
          status: 'inactive',
          deactivatedAt: new Date().toISOString(),
          deletionScheduledAt: deletionDate.toISOString(),
        },
      })

      return NextResponse.json({
        success: true,
        tenant_slug,
        status: 'inactive',
        message: `Tenant '${tenant_slug}' deactivated and STS credentials revoked. Grace period: ${grace_period_days} days until permanent hard delete.`,
      })
    }

    // Action 2: Reactivate
    if (action === 'reactivate') {
      await payload.update({
        collection: 'tenants',
        id: tenantDoc.id,
        data: {
          active: true,
          status: 'active',
          deactivatedAt: null,
          deletionScheduledAt: null,
        },
      })

      return NextResponse.json({
        success: true,
        tenant_slug,
        status: 'active',
        message: `Tenant '${tenant_slug}' successfully reactivated.`,
      })
    }

    // Action 3: Async Hard Delete (Platform Admin only)
    if (action === 'hard-delete') {
      // Mark as deleting
      await payload.update({
        collection: 'tenants',
        id: tenantDoc.id,
        data: { status: 'deleting' },
      })

      // Queue background job if available, or execute via worker
      if (payload.jobs && typeof payload.jobs.queue === 'function') {
        const job = await payload.jobs.queue({
          task: 'hard-delete-tenant',
          input: {
            tenantId: String(tenantDoc.id),
            tenantSlug: tenant_slug,
          },
        })

        if (typeof payload.jobs.runByID === 'function') {
          payload.jobs.runByID({ id: job.id }).catch((err) => {
            console.error('[Jobs] hard-delete runByID error:', err)
          })
        }
      } else {
        // Direct execution fallback
        const workerUrl = process.env.WORKER_URL || 'http://worker:8000'
        const res = await fetch(`${workerUrl}/api/v1/tenants/hard-delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenant_id: tenant_slug }),
        })

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          throw new Error(errData.detail?.error || 'Worker hard-delete failed')
        }

        // Storage and catalog cleanup confirmed -> delete metadata rows
        await payload.delete({
          collection: 'datasets',
          where: { tenant: { equals: tenantDoc.id } },
        })
        await payload.delete({
          collection: 'users',
          where: { tenant: { equals: tenantDoc.id } },
        })
        await payload.delete({
          collection: 'tenants',
          id: tenantDoc.id,
        })
      }

      return NextResponse.json({
        success: true,
        tenant_slug,
        status: 'deleting',
        message: `Tenant '${tenant_slug}' hard deletion scheduled and in progress.`,
      })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err: any) {
    console.error('Tenant lifecycle error:', err)
    return NextResponse.json(
      { error: err.message || 'Tenant lifecycle operation failed' },
      { status: 500 }
    )
  }
}

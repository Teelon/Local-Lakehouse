import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '../../../../payload.config'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tenantId = searchParams.get('tenant_id') || 'tenant_acme'

    const payload = await getPayload({ config: configPromise })

    // Find datasets for tenant
    const datasets = await payload.find({
      collection: 'datasets',
      depth: 1,
      sort: '-createdAt',
      limit: 20,
    })

    // Filter by tenant if needed
    const filtered = datasets.docs.filter((d: any) => {
      if (!tenantId) return true
      if (typeof d.tenant === 'object' && d.tenant !== null) {
        return d.tenant.slug === tenantId || d.tenant.id === tenantId
      }
      return d.tenant === tenantId
    })

    // Also fetch payload-jobs if enabled
    let jobsList: any[] = []
    try {
      const jobs = await (payload as any).find({
        collection: 'payload-jobs',
        limit: 20,
        sort: '-createdAt',
      })
      jobsList = jobs.docs || []
    } catch (e) {
      // payload-jobs collection may be internally named or not queried directly
    }

    return NextResponse.json({
      success: true,
      tenant_id: tenantId,
      datasets: filtered.map((d: any) => ({
        id: d.id,
        name: d.name,
        format: d.format,
        status: d.status,
        rawFilePath: d.rawFilePath,
        ducklakeTable: d.ducklakeTable,
        rowCount: d.rowCount,
        errorMessage: d.errorMessage,
        jobId: d.jobId,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        durationMs: d.durationMs,
      })),
      jobs: jobsList,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch job statuses' },
      { status: 500 }
    )
  }
}

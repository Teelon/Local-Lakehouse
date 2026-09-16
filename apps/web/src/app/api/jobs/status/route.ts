import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { TenantRepository, DatasetRepository } from '@/repositories'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    // NOTE: tenant_id is caller-supplied and not cryptographically verified (MVP 1 — no auth).
    // Tenant boundaries ARE enforced via the query filter below.
    const tenantId = searchParams.get('tenant_id') || 'tenant_acme'

    const payload = await getPayload({ config: configPromise })
    const tenantRepo = new TenantRepository(payload)
    const datasetRepo = new DatasetRepository(payload)

    // Resolve tenant document — needed to filter datasets by tenant ID (not slug),
    // which is the correct foreign-key field in the datasets collection.
    const tenantDoc = await tenantRepo.findBySlug(tenantId)

    // Fail-closed guard: if tenant does not resolve (invalid ID, typo, probe),
    // immediately return empty results rather than falling through to an unfiltered query.
    if (!tenantDoc) {
      return NextResponse.json({
        success: true,
        tenant_id: tenantId,
        datasets: [],
        jobs: [],
      })
    }

    // Tenant filter is strictly applied in the Payload query before limit applies.
    const filtered = await datasetRepo.findByTenantId(tenantDoc.id, {
      limit: 20,
      sort: '-createdAt',
      depth: 1,
    })
    const datasetIds = new Set(filtered.map((d: any) => String(d.id)))

    // Also fetch payload-jobs if enabled, strictly scoped to this tenant
    let jobsList: any[] = []
    try {
      const jobs = await (payload as any).find({
        collection: 'payload-jobs',
        limit: 50,
        sort: '-createdAt',
      })
      const allJobs = jobs.docs || []
      jobsList = allJobs.filter((j: any) => {
        if (j.input?.tenantId) return j.input.tenantId === tenantId
        if (j.input?.datasetId && datasetIds.has(String(j.input.datasetId))) return true
        return false
      }).slice(0, 20)
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

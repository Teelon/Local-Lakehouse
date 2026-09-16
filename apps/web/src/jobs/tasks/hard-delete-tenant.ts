import type { TaskConfig } from 'payload'
import { TenantRepository } from '../../repositories/tenant-repository'

export const hardDeleteTenantTask: TaskConfig = {
  slug: 'hard-delete-tenant',
  inputSchema: [
    { name: 'tenantId', type: 'text', required: true },
    { name: 'tenantSlug', type: 'text', required: true },
  ],
  handler: async ({ input, req }: { input: any; req: any }) => {
    const workerUrl = process.env.WORKER_URL || 'http://worker:8000'
    // 1. Trigger worker hard delete for DuckDB schemas and RustFS storage prefix
    const res = await fetch(`${workerUrl}/api/v1/tenants/hard-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: input.tenantSlug }),
    })

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}))
      throw new Error(errData.detail?.error || 'Worker hard-delete failed')
    }

    // 2. Storage and DuckDB cleanup confirmed complete -> delete Payload metadata rows
    // Delete Datasets
    await req.payload.delete({
      collection: 'datasets',
      where: { tenant: { equals: input.tenantId } },
    })

    // Delete Users
    await req.payload.delete({
      collection: 'users',
      where: { tenant: { equals: input.tenantId } },
    })

    // Delete Tenant row
    const tenantRepo = new TenantRepository(req.payload)
    await tenantRepo.delete(input.tenantId)

    return {
      output: {
        success: true,
        message: `Tenant ${input.tenantSlug} successfully hard-deleted across storage, catalog, and metadata.`,
      },
    }
  },
}

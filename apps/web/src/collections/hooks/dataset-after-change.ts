import type { CollectionAfterChangeHook } from 'payload'
import { TenantRepository } from '../../repositories/tenant-repository'

export const datasetAfterChangeHook: CollectionAfterChangeHook = async ({ doc, req }) => {
  // Automatically enqueue ingestion job when dataset transitions to 'uploaded'
  if (doc.status === 'uploaded' && doc.layer !== 'gold') {
    try {
      const tenantRepo = new TenantRepository(req.payload)
      let tenantSlug = 'tenant_acme'
      if (typeof doc.tenant === 'object' && doc.tenant !== null) {
        tenantSlug = (doc.tenant as any).slug || (doc.tenant as any).id || tenantSlug
      } else if (typeof doc.tenant === 'string' || typeof doc.tenant === 'number') {
        try {
          const t = await tenantRepo.findById(doc.tenant)
          if (t && t.slug) tenantSlug = t.slug
        } catch (e) {
          tenantSlug = String(doc.tenant)
        }
      }

      const cleanTableName = doc.name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()
      const jobId = `job_${Date.now()}`

      if (req.payload.jobs && typeof req.payload.jobs.queue === 'function') {
        const queuedJob = await req.payload.jobs.queue({
          task: 'ingest-file',
          input: {
            datasetId: String(doc.id),
            tenantId: tenantSlug,
            rawFilePath: doc.rawFilePath,
            tableName: cleanTableName,
            format: doc.format,
          },
        })

        if (typeof req.payload.jobs.runByID === 'function') {
          req.payload.jobs.runByID({ id: queuedJob.id }).catch((err: any) => {
            console.error('[Jobs] runByID async error:', err)
          })
        }
      } else {
        // Direct async fallback trigger if jobs queue runner is not active
        const workerUrl = process.env.WORKER_URL || 'http://worker:8000'
        const triggerStartTime = Date.now()
        fetch(`${workerUrl}/api/v1/jobs/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_id: jobId,
            tenant_id: tenantSlug,
            table_name: cleanTableName,
            file_path: doc.rawFilePath,
            file_format: doc.format,
          }),
        })
          .then(async (res) => {
            const data = await res.json()
            const elapsedMs = Date.now() - triggerStartTime
            if (res.ok) {
              await req.payload.update({
                collection: 'datasets',
                id: doc.id,
                data: {
                  status: 'completed',
                  ducklakeTable: data.table_name || `${tenantSlug}_silver.${cleanTableName}`,
                  rowCount: data.row_count || 0,
                  jobId,
                  durationMs: data.duration_ms || elapsedMs,
                },
              })
            } else {
              await req.payload.update({
                collection: 'datasets',
                id: doc.id,
                data: {
                  status: 'failed',
                  errorMessage: data.detail || 'Worker ingestion error',
                  jobId,
                },
              })
            }
          })
          .catch(async (err) => {
            await req.payload.update({
              collection: 'datasets',
              id: doc.id,
              data: {
                status: 'failed',
                errorMessage: err.message,
                jobId,
              },
            })
          })
      }
    } catch (err: any) {
      console.error('[Datasets Hook] Error auto-enqueuing job:', err)
    }
  }
}

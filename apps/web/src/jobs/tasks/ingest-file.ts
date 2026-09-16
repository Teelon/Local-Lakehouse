import type { TaskConfig } from 'payload'

export const ingestFileTask: TaskConfig = {
  slug: 'ingest-file',
  inputSchema: [
    { name: 'datasetId', type: 'text', required: true },
    { name: 'tenantId', type: 'text', required: true },
    { name: 'rawFilePath', type: 'text', required: true },
    { name: 'tableName', type: 'text', required: true },
    { name: 'format', type: 'text', required: true },
  ],
  handler: async ({ input, req }: { input: any; req: any }) => {
    const workerUrl = process.env.WORKER_URL || 'http://worker:8000'
    const jobId = `job_${Date.now()}`
    const taskStartTime = Date.now()

    // Mark dataset as processing
    try {
      await req.payload.update({
        collection: 'datasets',
        id: input.datasetId,
        data: { status: 'processing', jobId },
      })
    } catch (e) {
      console.error('Failed to update status to processing:', e)
    }

    try {
      const res = await fetch(`${workerUrl}/api/v1/jobs/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          tenant_id: input.tenantId,
          table_name: input.tableName,
          file_path: input.rawFilePath,
          file_format: input.format,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || data.error || 'Worker ingestion failed')
      }

      const elapsedMs = Date.now() - taskStartTime
      const finalDurationMs = data.duration_ms || elapsedMs

      // Mark dataset as completed
      await req.payload.update({
        collection: 'datasets',
        id: input.datasetId,
        data: {
          status: 'completed',
          ducklakeTable: data.table_name || `${input.tenantId}_silver.${input.tableName}`,
          rowCount: data.row_count || 0,
          jobId,
          durationMs: finalDurationMs,
        },
      })

      return {
        output: {
          success: true,
          table_name: data.table_name,
          row_count: data.row_count,
        },
      }
    } catch (err: any) {
      await req.payload.update({
        collection: 'datasets',
        id: input.datasetId,
        data: {
          status: 'failed',
          errorMessage: err.message,
          jobId,
        },
      })
      throw err
    }
  },
}

import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { fileURLToPath } from 'url'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: 'users',
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [
    {
      slug: 'users',
      auth: true,
      access: {
        read: ({ req }) => {
          const user = req.user
          if (!user) return false
          if (user.role === 'platform_admin') return true
          // Tenant admin sees users in same tenant
          if (user.role === 'tenant_admin' && user.tenant) {
            return {
              tenant: {
                equals: typeof user.tenant === 'object' ? (user.tenant as any).id : user.tenant,
              },
            } as any
          }
          // Tenant user sees only self
          return { id: { equals: user.id } } as any
        },
        create: ({ req }) => {
          const user = req.user
          return user?.role === 'platform_admin' || user?.role === 'tenant_admin'
        },
        update: ({ req }) => {
          const user = req.user
          if (!user) return false
          if (user.role === 'platform_admin') return true
          if (user.role === 'tenant_admin' && user.tenant) {
            return {
              tenant: {
                equals: typeof user.tenant === 'object' ? (user.tenant as any).id : user.tenant,
              },
            } as any
          }
          return { id: { equals: user.id } } as any
        },
        delete: ({ req }) => {
          return req.user?.role === 'platform_admin'
        },
      },
      fields: [
        {
          name: 'role',
          type: 'select',
          options: [
            { label: 'Platform Admin', value: 'platform_admin' },
            { label: 'Tenant Admin', value: 'tenant_admin' },
            { label: 'Tenant User', value: 'tenant_user' },
          ],
          defaultValue: 'tenant_user',
          required: true,
        },
        {
          name: 'tenant',
          type: 'relationship',
          relationTo: 'tenants',
        },
      ],
    },
    {
      slug: 'tenants',
      admin: {
        useAsTitle: 'name',
      },
      access: {
        read: ({ req }) => {
          const user = req.user
          if (!user) return false
          if (user.role === 'platform_admin') return true
          if (user.tenant) {
            return {
              id: {
                equals: typeof user.tenant === 'object' ? (user.tenant as any).id : user.tenant,
              },
            } as any
          }
          return false
        },
        create: ({ req }) => req.user?.role === 'platform_admin',
        update: ({ req }) => {
          const user = req.user
          if (!user) return false
          if (user.role === 'platform_admin') return true
          if (user.role === 'tenant_admin' && user.tenant) {
            return {
              id: {
                equals: typeof user.tenant === 'object' ? (user.tenant as any).id : user.tenant,
              },
            } as any
          }
          return false
        },
        delete: ({ req }) => req.user?.role === 'platform_admin',
      },
      fields: [
        {
          name: 'name',
          type: 'text',
          required: true,
        },
        {
          name: 'slug',
          type: 'text',
          required: true,
          unique: true,
        },
        {
          name: 'active',
          type: 'checkbox',
          defaultValue: true,
        },
        {
          name: 'status',
          type: 'select',
          options: ['active', 'inactive', 'deleting', 'deleted'],
          defaultValue: 'active',
        },
        {
          name: 'deactivatedAt',
          type: 'date',
        },
        {
          name: 'deletionScheduledAt',
          type: 'date',
        },
      ],
    },
    {
      slug: 'datasets',
      admin: {
        useAsTitle: 'name',
      },
      access: {
        read: ({ req }) => {
          const user = req.user
          if (!user) return false
          if (user.role === 'platform_admin') return true
          if (user.tenant) {
            return {
              tenant: {
                equals: typeof user.tenant === 'object' ? (user.tenant as any).id : user.tenant,
              },
            } as any
          }
          return false
        },
        create: ({ req }) => Boolean(req.user),
        update: ({ req }) => {
          const user = req.user
          if (!user) return false
          if (user.role === 'platform_admin') return true
          if (user.tenant) {
            return {
              tenant: {
                equals: typeof user.tenant === 'object' ? (user.tenant as any).id : user.tenant,
              },
            } as any
          }
          return false
        },
        delete: ({ req }) => {
          const user = req.user
          return user?.role === 'platform_admin' || user?.role === 'tenant_admin'
        },
      },
      hooks: {
        afterChange: [
          async ({ doc, req, operation }) => {
            // Automatically enqueue ingestion job when dataset transitions to 'uploaded'
            if (doc.status === 'uploaded' && doc.layer !== 'gold') {
              try {
                let tenantSlug = 'tenant_acme'
                if (typeof doc.tenant === 'object' && doc.tenant !== null) {
                  tenantSlug = (doc.tenant as any).slug || (doc.tenant as any).id || tenantSlug
                } else if (typeof doc.tenant === 'string') {
                  try {
                    const t = await req.payload.findByID({ collection: 'tenants', id: doc.tenant })
                    if (t && t.slug) tenantSlug = t.slug
                  } catch (e) {
                    tenantSlug = doc.tenant
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
          },
        ],
      },
      fields: [
        {
          name: 'name',
          type: 'text',
          required: true,
        },
        {
          name: 'tenant',
          type: 'relationship',
          relationTo: 'tenants',
          required: true,
        },
        {
          name: 'layer',
          type: 'select',
          options: [
            { label: 'Bronze', value: 'bronze' },
            { label: 'Silver', value: 'silver' },
            { label: 'Gold', value: 'gold' },
          ],
          defaultValue: 'silver',
        },
        {
          name: 'objectType',
          type: 'select',
          options: [
            { label: 'Table', value: 'table' },
            { label: 'View', value: 'view' },
          ],
          defaultValue: 'table',
        },
        {
          name: 'sqlQuery',
          type: 'textarea',
          admin: {
            description: 'Definition query for Gold views or materialized tables',
          },
        },
        {
          name: 'dependencies',
          type: 'json',
          admin: {
            description: 'List of dataset IDs or table names this view depends on',
          },
        },
        {
          name: 'rawFilePath',
          type: 'text',
        },
        {
          name: 'format',
          type: 'select',
          options: ['csv', 'json', 'parquet', 'sql_view'],
          defaultValue: 'csv',
        },
        {
          name: 'status',
          type: 'select',
          options: ['pending', 'uploaded', 'processing', 'completed', 'failed'],
          defaultValue: 'pending',
        },
        {
          name: 'ducklakeTable',
          type: 'text',
        },
        {
          name: 'rowCount',
          type: 'number',
        },
        {
          name: 'errorMessage',
          type: 'textarea',
        },
        {
          name: 'jobId',
          type: 'text',
        },
        {
          name: 'durationMs',
          type: 'number',
        },
      ],
    },
  ],
  jobs: {
    tasks: [
      {
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
      },
      {
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
          await req.payload.delete({
            collection: 'tenants',
            id: input.tenantId,
          })

          return {
            output: {
              success: true,
              message: `Tenant ${input.tenantSlug} successfully hard-deleted across storage, catalog, and metadata.`,
            },
          }
        },
      },
    ],
    autoRun: [
      {
        cron: '* * * * *',
        queue: 'default',
      },
    ],
  },
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || 'dev_secret_fallback_key_123456789012345',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URI || 'postgres://lakehouse_admin:lakehouse_secret_change_me@localhost:5432/lakehouse',
    },
    schemaName: 'payload_core',
  }),
})

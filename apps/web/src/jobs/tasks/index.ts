import type { TaskConfig } from 'payload'
import { ingestFileTask } from './ingest-file'
import { hardDeleteTenantTask } from './hard-delete-tenant'

export { ingestFileTask, hardDeleteTenantTask }
export const tasks: TaskConfig[] = [ingestFileTask, hardDeleteTenantTask]

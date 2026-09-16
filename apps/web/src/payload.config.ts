import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { fileURLToPath } from 'url'
import { collections } from './collections'
import { jobsConfig } from './jobs'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: 'users',
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections,
  jobs: jobsConfig,
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || 'dev_secret_fallback_key_123456789012345',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString:
        process.env.DATABASE_URI ||
        'postgres://lakehouse_admin:lakehouse_secret_change_me@localhost:5432/lakehouse',
    },
    schemaName: 'payload_core',
  }),
})

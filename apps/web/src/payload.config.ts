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
  },
  collections: [
    {
      slug: 'users',
      auth: true,
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
      ],
    },
    {
      slug: 'datasets',
      admin: {
        useAsTitle: 'name',
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
          name: 'rawFilePath',
          type: 'text',
          required: true,
        },
        {
          name: 'format',
          type: 'select',
          options: ['csv', 'json', 'parquet'],
          required: true,
        },
        {
          name: 'status',
          type: 'select',
          options: ['pending', 'processing', 'committed', 'failed'],
          defaultValue: 'pending',
        },
      ],
    },
  ],
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

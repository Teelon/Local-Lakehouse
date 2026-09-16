import type { CollectionConfig } from 'payload'
import { usersAccess } from '../access/users'

export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  access: usersAccess,
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
}

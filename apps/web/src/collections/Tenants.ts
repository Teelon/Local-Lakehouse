import type { CollectionConfig } from 'payload'
import { tenantsAccess } from '../access/tenants'

export const Tenants: CollectionConfig = {
  slug: 'tenants',
  admin: {
    useAsTitle: 'name',
  },
  access: tenantsAccess,
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
}

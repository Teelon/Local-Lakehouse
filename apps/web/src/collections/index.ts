import type { CollectionConfig } from 'payload'
import { Users } from './Users'
import { Tenants } from './Tenants'
import { Datasets } from './Datasets'

export { Users, Tenants, Datasets }
export const collections: CollectionConfig[] = [Users, Tenants, Datasets]

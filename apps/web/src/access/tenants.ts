import type { Access } from 'payload'
import { isPlatformAdmin, isTenantAdmin, getTenantId } from './roles'

export const tenantsAccess: {
  read: Access
  create: Access
  update: Access
  delete: Access
} = {
  read: ({ req }) => {
    const user = req.user
    if (!user) return false
    if (isPlatformAdmin(user)) return true

    const tenantId = getTenantId(user.tenant)
    if (tenantId) {
      return {
        id: {
          equals: tenantId,
        },
      }
    }

    return false
  },

  create: ({ req }) => isPlatformAdmin(req.user),

  update: ({ req }) => {
    const user = req.user
    if (!user) return false
    if (isPlatformAdmin(user)) return true

    const tenantId = getTenantId(user.tenant)
    if (isTenantAdmin(user) && tenantId) {
      return {
        id: {
          equals: tenantId,
        },
      }
    }

    return false
  },

  delete: ({ req }) => isPlatformAdmin(req.user),
}

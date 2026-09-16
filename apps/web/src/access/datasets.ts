import type { Access } from 'payload'
import { isPlatformAdmin, isTenantAdmin, getTenantId } from './roles'

export const datasetsAccess: {
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
        tenant: {
          equals: tenantId,
        },
      }
    }

    return false
  },

  create: ({ req }) => Boolean(req.user),

  update: ({ req }) => {
    const user = req.user
    if (!user) return false
    if (isPlatformAdmin(user)) return true

    const tenantId = getTenantId(user.tenant)
    if (tenantId) {
      return {
        tenant: {
          equals: tenantId,
        },
      }
    }

    return false
  },

  delete: ({ req }) => {
    const user = req.user
    return isPlatformAdmin(user) || isTenantAdmin(user)
  },
}

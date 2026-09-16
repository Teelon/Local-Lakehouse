import type { Access, Where } from 'payload'
import { isPlatformAdmin, isTenantAdmin, getTenantId } from './roles'

export const usersAccess: {
  read: Access
  create: Access
  update: Access
  delete: Access
} = {
  read: ({ req }) => {
    const user = req.user
    if (!user) return false
    if (isPlatformAdmin(user)) return true

    // Tenant admin sees users in same tenant
    const tenantId = getTenantId(user.tenant)
    if (isTenantAdmin(user) && tenantId) {
      const where: Where = {
        tenant: {
          equals: tenantId,
        },
      }
      return where
    }

    // Tenant user sees only self
    const where: Where = { id: { equals: user.id } }
    return where
  },

  create: ({ req }) => {
    const user = req.user
    return isPlatformAdmin(user) || isTenantAdmin(user)
  },

  update: ({ req }) => {
    const user = req.user
    if (!user) return false
    if (isPlatformAdmin(user)) return true

    const tenantId = getTenantId(user.tenant)
    if (isTenantAdmin(user) && tenantId) {
      const where: Where = {
        tenant: {
          equals: tenantId,
        },
      }
      return where
    }

    const where: Where = { id: { equals: user.id } }
    return where
  },

  delete: ({ req }) => {
    return isPlatformAdmin(req.user)
  },
}

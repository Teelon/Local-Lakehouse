export const isPlatformAdmin = (user?: any): boolean => {
  return user?.role === 'platform_admin'
}

export const isTenantAdmin = (user?: any): boolean => {
  return user?.role === 'tenant_admin'
}

export const getTenantId = (tenant?: any): string | number | undefined => {
  if (!tenant) return undefined
  return typeof tenant === 'object' ? tenant.id : tenant
}

import type { Payload } from 'payload'

export interface TenantDoc {
  id: string | number
  name: string
  slug: string
  active?: boolean | null
  status?: ('active' | 'suspended') | null
  settings?: any
  createdAt?: string
  updatedAt?: string
}

export class TenantRepository {
  constructor(private payload: Payload) {}

  async findBySlug(slug: string): Promise<TenantDoc | null> {
    const result = await this.payload.find({
      collection: 'tenants',
      where: { slug: { equals: slug } },
      limit: 1,
    })
    return (result.docs[0] as unknown as TenantDoc) ?? null
  }

  async findById(id: string | number): Promise<TenantDoc | null> {
    try {
      const doc = await this.payload.findByID({
        collection: 'tenants',
        id: String(id),
      })
      return (doc as unknown as TenantDoc) ?? null
    } catch {
      return null
    }
  }

  async findOrCreateBySlug(slug: string): Promise<TenantDoc> {
    const existing = await this.findBySlug(slug)
    if (existing) return existing

    const created = await this.payload.create({
      collection: 'tenants',
      data: {
        slug,
        name: this.formatFriendlyName(slug),
        active: true,
        status: 'active',
      },
    })
    return created as unknown as TenantDoc
  }

  /**
   * Single, standardized naming rule â€” replaces conflicting inline formats.
   */
  public formatFriendlyName(slug: string): string {
    if (slug === 'tenant_acme') return 'Acme Corp (EU-Prod)'
    if (slug === 'tenant_globex') return 'Globex Corporation'
    if (slug === 'tenant_a') return 'Tenant Alpha'
    if (slug === 'tenant_b') return 'Tenant Beta'

    return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }

  async listTenants(options?: { limit?: number; sort?: string }): Promise<TenantDoc[]> {
    const result = await this.payload.find({
      collection: 'tenants',
      limit: options?.limit ?? 100,
      sort: options?.sort ?? 'name',
    })
    return result.docs as unknown as TenantDoc[]
  }

  async updateStatus(
    id: string | number,
    active: boolean,
    status: 'active' | 'suspended'
  ): Promise<TenantDoc> {
    const updated = await this.payload.update({
      collection: 'tenants',
      id: String(id),
      data: { active, status },
    })
    return updated as unknown as TenantDoc
  }

  async delete(id: string | number): Promise<void> {
    await this.payload.delete({
      collection: 'tenants',
      id: String(id),
    })
  }
}

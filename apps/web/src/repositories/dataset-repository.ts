import type { Payload } from 'payload'

export interface DatasetDoc {
  id: string | number
  name: string
  description?: string | null
  tenant: string | number | { id: string | number; slug?: string }
  layer: 'bronze' | 'silver' | 'gold'
  objectType?: 'table' | 'view' | null
  format: 'parquet' | 'json' | 'csv' | 'duckdb' | 'sql_view'
  status: 'uploaded' | 'processing' | 'completed' | 'error'
  sqlQuery?: string | null
  dependencies?: string[] | null
  ducklakeTable?: string | null
  rawFilePath?: string | null
  jobId?: string | null
  rowCount?: number | null
  schemaSnapshot?: any
  createdAt?: string
  updatedAt?: string
}

export class DatasetRepository {
  constructor(private payload: Payload) {}

  /**
   * Finds datasets belonging to a specific tenant.
   * IMPORTANT: datasets.tenant is a relation field storing the foreign-key tenant ID
   * (numeric or uuid), NOT the tenant slug string.
   */
  async findByTenantId(
    tenantDocId: string | number,
    options?: { layer?: 'bronze' | 'silver' | 'gold'; limit?: number; sort?: string; depth?: number }
  ): Promise<DatasetDoc[]> {
    const conditions: any[] = [{ tenant: { equals: tenantDocId } }]
    if (options?.layer) {
      conditions.push({ layer: { equals: options.layer } })
    }

    const result = await this.payload.find({
      collection: 'datasets',
      where: { and: conditions },
      limit: options?.limit ?? 50,
      sort: options?.sort ?? '-createdAt',
      depth: options?.depth ?? 1,
    })

    return result.docs as unknown as DatasetDoc[]
  }

  async findByTenantAndName(
    tenantDocId: string | number,
    name: string,
    layer?: 'bronze' | 'silver' | 'gold'
  ): Promise<DatasetDoc | null> {
    const conditions: any[] = [
      { tenant: { equals: tenantDocId } },
      { name: { equals: name } },
    ]
    if (layer) {
      conditions.push({ layer: { equals: layer } })
    }

    const result = await this.payload.find({
      collection: 'datasets',
      where: { and: conditions },
      limit: 1,
      depth: 1,
    })

    return (result.docs[0] as unknown as DatasetDoc) ?? null
  }

  async createSilverDataset(data: {
    name: string
    tenantDocId: string | number
    rawFilePath: string
    format: 'parquet' | 'json' | 'csv' | 'duckdb'
    ducklakeTable: string
  }): Promise<DatasetDoc> {
    const created = await this.payload.create({
      collection: 'datasets',
      data: {
        name: data.name,
        tenant: data.tenantDocId as any,
        rawFilePath: data.rawFilePath,
        format: data.format,
        layer: 'silver',
        objectType: 'table',
        status: 'uploaded',
        ducklakeTable: data.ducklakeTable,
      },
    })
    return created as unknown as DatasetDoc
  }

  async createOrUpdateGoldDataset(data: {
    name: string
    tenantDocId: string | number
    objectType: 'table' | 'view'
    sqlQuery: string
    dependencies: string[]
    format: 'parquet' | 'sql_view'
    ducklakeTable: string
    rowCount?: number
  }): Promise<DatasetDoc> {
    const existing = await this.findByTenantAndName(data.tenantDocId, data.name, 'gold')

    const datasetPayload = {
      name: data.name,
      tenant: data.tenantDocId as any,
      layer: 'gold' as const,
      objectType: data.objectType,
      sqlQuery: data.sqlQuery,
      dependencies: data.dependencies,
      format: data.format,
      status: 'completed' as const,
      ducklakeTable: data.ducklakeTable,
      rowCount: data.rowCount ?? 0,
    }

    if (existing) {
      const updated = await this.payload.update({
        collection: 'datasets',
        id: String(existing.id),
        data: datasetPayload,
      })
      return updated as unknown as DatasetDoc
    } else {
      const created = await this.payload.create({
        collection: 'datasets',
        data: datasetPayload,
      })
      return created as unknown as DatasetDoc
    }
  }

  async findGoldDependents(tenantDocId: string | number): Promise<DatasetDoc[]> {
    const result = await this.payload.find({
      collection: 'datasets',
      where: {
        and: [
          { tenant: { equals: tenantDocId } },
          { layer: { equals: 'gold' } },
        ],
      },
      limit: 100,
      depth: 1,
    })
    return result.docs as unknown as DatasetDoc[]
  }

  async updateStatus(
    id: string | number,
    status: 'uploaded' | 'processing' | 'completed' | 'error',
    extra?: Partial<DatasetDoc>
  ): Promise<DatasetDoc> {
    const updated = await this.payload.update({
      collection: 'datasets',
      id: String(id),
      data: {
        status,
        ...(extra || {}),
      },
    })
    return updated as unknown as DatasetDoc
  }

  async delete(id: string | number): Promise<void> {
    await this.payload.delete({
      collection: 'datasets',
      id: String(id),
    })
  }

  async findJobs(tenantDocId: string | number, limit = 50): Promise<any[]> {
    try {
      const jobs = await (this.payload as any).find({
        collection: 'payload-jobs',
        limit,
        sort: '-createdAt',
      })
      return (jobs.docs || []).filter((j: any) => {
        const inputTenant = j.input?.tenantId || j.input?.tenant
        return (
          inputTenant === String(tenantDocId) ||
          (j.input?.datasetId && j.input?.datasetId !== '')
        )
      })
    } catch {
      return []
    }
  }
}

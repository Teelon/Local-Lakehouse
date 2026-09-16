export interface QueryResult {
  columns: string[]
  rows: any[][]
  rowCount: number
  truncated: boolean
}

export class LakehouseQueryService {
  private workerUrl: string

  constructor(workerUrl = process.env.WORKER_URL || 'http://worker:8000') {
    this.workerUrl = workerUrl
  }

  /**
   * Validates and enforces tenant isolation guardrails before sending query to DuckDB.
   */
  public validateQuery(tenantId: string, sqlQuery: string): void {
    const trimmed = sqlQuery.trim()
    if (!trimmed) {
      throw new Error('Query cannot be empty.')
    }

    const lower = trimmed.toLowerCase()

    // 1. Guardrail: Prohibit modifications and administrative commands
    const forbiddenKeywords = [
      'drop',
      'alter',
      'delete',
      'insert',
      'update',
      'attach',
      'detach',
      'copy',
      'export',
      'create',
      'vacuum',
      'install',
      'load',
    ]

    for (const kw of forbiddenKeywords) {
      const regex = new RegExp(`(^|\\s|;)${kw}(\\s|;|$)`, 'i')
      if (regex.test(lower)) {
        throw new Error(`Modification query with '${kw}' is prohibited in Query Studio.`)
      }
    }

    // 2. Guardrail: Reject multiple chained SQL statements (SQL injection mitigation)
    const statements = trimmed
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
    if (statements.length > 1) {
      throw new Error('Executing multiple chained SQL statements is prohibited.')
    }

    // 3. Guardrail: Tenant Isolation & Foreign Schema Protection (Phase 5.2)
    // Extract tables referenced in FROM or JOIN clauses
    const tableRefRegex = /(?:from|join)\s+([a-zA-Z0-9_."]+)/gi
    let match: RegExpExecArray | null
    const matchedTables: string[] = []

    while ((match = tableRefRegex.exec(trimmed)) !== null) {
      const rawName = match[1].replace(/["`]/g, '').trim()
      matchedTables.push(rawName)
    }

    // Prohibit cross-schema traversal (e.g. tenant_b.table, ducklake_catalog.table, payload_core.table)
    const forbiddenSchemas = ['ducklake_catalog', 'payload_core', 'information_schema', 'pg_catalog']
    for (const schema of forbiddenSchemas) {
      if (lower.includes(`${schema}.`) || lower.includes(`"${schema}"`)) {
        throw new Error(
          `Access Denied: Cross-schema query to '${schema}' is prohibited. Queries must stay within tenant workspace.`
        )
      }
    }

    // Direct file readers bypassing catalog
    if (lower.includes('read_parquet(') || lower.includes('read_csv(') || lower.includes('read_json(')) {
      if (lower.includes('tenants/') && !lower.includes(`tenants/${tenantId.toLowerCase()}/`)) {
        throw new Error(
          `Access Denied: Query attempts to read object storage outside tenant '${tenantId}' scope.`
        )
      }
    }

    // Check each referenced table
    for (const table of matchedTables) {
      const tableLower = table.toLowerCase()
      const tId = tenantId.toLowerCase()
      const allowedSchemas = [tId, `${tId}_silver`, `${tId}_gold`]

      // If query references a table with a dot e.g. schema.table
      if (tableLower.includes('.')) {
        const [schemaPart] = tableLower.split('.')
        if (!allowedSchemas.includes(schemaPart)) {
          throw new Error(
            `Access Denied: Cross-tenant schema access prohibited. Foreign schema '${schemaPart}' is not allowed for tenant '${tenantId}'.`
          )
        }
      } else {
        // Flat table name e.g. tenant_b_customers or other_tenant_...
        if (tableLower.startsWith('tenant_') && !tableLower.startsWith(`${tId}_`)) {
          throw new Error(
            `Access Denied: Cross-tenant table access prohibited for tenant '${tenantId}'. Table '${table}' does not belong to your tenant workspace.`
          )
        }
      }
    }
  }

  /**
   * Executes a read-only SQL query strictly scoped to tenant resources.
   */
  public async executeQuery(
    tenantId: string,
    sqlQuery: string,
    maxRows = 1000
  ): Promise<QueryResult> {
    // Run security and isolation guardrails
    this.validateQuery(tenantId, sqlQuery)

    // Execute query via worker analytics engine
    const res = await fetch(`${this.workerUrl}/api/v1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: sqlQuery,
        tenant_id: tenantId,
      }),
    })

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ detail: 'Query execution failed' }))
      throw new Error(errData.detail || errData.error || 'Query execution failed')
    }

    const data = await res.json()
    const columns: string[] = data.columns || []
    const rawRows: any[][] = data.rows || []
    const rowCount = rawRows.length
    const truncated = rowCount > maxRows
    const slicedRows = truncated ? rawRows.slice(0, maxRows) : rawRows

    return {
      columns,
      rows: slicedRows,
      rowCount: slicedRows.length,
      truncated,
    }
  }
}

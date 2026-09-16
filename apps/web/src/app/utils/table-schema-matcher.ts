export interface ColumnSchema {
  name: string
  type: string
  nullable?: boolean
  sample?: string
}

export interface TableColumn {
  name: string
  type: string
}

export interface ExistingTable {
  name: string
  full_name: string
  schema?: string
  layer?: 'silver' | 'gold'
  type?: 'table' | 'view'
  columns: TableColumn[]
}

export interface MatchedColumnDetail {
  inferredName: string
  inferredType: string
  matchedExistingName: string
  matchedExistingType: string
  exactTypeMatch: boolean
}

export interface SchemaMatchResult {
  table: ExistingTable
  matchScore: number // 0 - 100
  exactTypeMatches: number
  compatibleTypeMatches: number
  totalInferredColumns: number
  totalExistingColumns: number
  matchedColumns: MatchedColumnDetail[]
  unmatchedInferredColumns: string[]
  unmatchedExistingColumns: string[]
}

// Logical type categorization to determine compatibility
export function normalizeTypeCategory(typeStr: string): string {
  const t = (typeStr || '').toLowerCase().trim()

  // Integers
  if (
    t.includes('int') ||
    t === 'bigint' ||
    t === 'smallint' ||
    t === 'tinyint' ||
    t === 'hugeint' ||
    t === 'int8' ||
    t === 'int4' ||
    t === 'int2'
  ) {
    return 'INTEGER'
  }

  // Floats / Decimals
  if (
    t.includes('double') ||
    t.includes('float') ||
    t.includes('decimal') ||
    t.includes('numeric') ||
    t.includes('real')
  ) {
    return 'FLOAT'
  }

  // Datetime / Date / Time
  if (t.includes('timestamp') || t.includes('time') || t.includes('date')) {
    return 'DATETIME'
  }

  // Boolean
  if (t.includes('bool')) {
    return 'BOOLEAN'
  }

  // UUID
  if (t.includes('uuid')) {
    return 'UUID'
  }

  // JSON
  if (t.includes('json')) {
    return 'JSON'
  }

  // Strings / Varchar
  if (t.includes('char') || t.includes('text') || t.includes('str')) {
    return 'STRING'
  }

  return 'OTHER'
}

export function cleanColName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Compares inferred columns against all existing tenant tables.
 * Returns tables with schema overlap ranked by similarity score.
 */
export function findSchemaMatches(
  inferredCols: ColumnSchema[],
  existingTables: ExistingTable[],
  minScoreThreshold: number = 30
): SchemaMatchResult[] {
  if (!inferredCols || inferredCols.length === 0 || !existingTables || existingTables.length === 0) {
    return []
  }

  const results: SchemaMatchResult[] = []

  for (const table of existingTables) {
    // Only match against Silver tables / ingest targets (skip views or gold unless relevant)
    if (table.layer === 'gold') continue

    const existingCols = table.columns || []
    if (existingCols.length === 0) continue

    const matchedCols: MatchedColumnDetail[] = []
    const matchedExistingNames = new Set<string>()
    const matchedInferredNames = new Set<string>()

    let exactTypeMatches = 0
    let compatibleTypeMatches = 0

    // Compare each inferred column with existing table columns
    for (const infCol of inferredCols) {
      const cleanInf = cleanColName(infCol.name)
      const infCategory = normalizeTypeCategory(infCol.type)

      // Find best match in table columns
      const existingMatch = existingCols.find(
        (ec) => cleanColName(ec.name) === cleanInf
      )

      if (existingMatch) {
        matchedInferredNames.add(infCol.name)
        matchedExistingNames.add(existingMatch.name)

        const exCategory = normalizeTypeCategory(existingMatch.type)
        const isExactType =
          infCol.type.toLowerCase() === existingMatch.type.toLowerCase() ||
          infCategory === exCategory

        if (isExactType) {
          exactTypeMatches++
        } else if (exCategory === 'STRING' || infCategory === 'STRING') {
          // Soft compatibility: string can accept most types
          compatibleTypeMatches++
        }

        matchedCols.push({
          inferredName: infCol.name,
          inferredType: infCol.type,
          matchedExistingName: existingMatch.name,
          matchedExistingType: existingMatch.type,
          exactTypeMatch: isExactType,
        })
      }
    }

    const unmatchedInferred = inferredCols
      .filter((c) => !matchedInferredNames.has(c.name))
      .map((c) => c.name)

    const unmatchedExisting = existingCols
      .filter((c) => !matchedExistingNames.has(c.name))
      .map((c) => c.name)

    // Calculate score (0-100) based on column overlap and type compatibility
    const maxCols = Math.max(inferredCols.length, existingCols.length)
    if (maxCols === 0) continue

    const totalWeightedMatches = exactTypeMatches * 1.0 + compatibleTypeMatches * 0.75 + (matchedCols.length - exactTypeMatches - compatibleTypeMatches) * 0.5
    const matchScore = Math.round((totalWeightedMatches / maxCols) * 100)

    if (matchScore >= minScoreThreshold || matchedCols.length >= 3) {
      results.push({
        table,
        matchScore,
        exactTypeMatches,
        compatibleTypeMatches,
        totalInferredColumns: inferredCols.length,
        totalExistingColumns: existingCols.length,
        matchedColumns: matchedCols,
        unmatchedInferredColumns: unmatchedInferred,
        unmatchedExistingColumns: unmatchedExisting,
      })
    }
  }

  // Sort by match score descending, then by exact type matches
  return results.sort((a, b) => b.matchScore - a.matchScore || b.exactTypeMatches - a.exactTypeMatches)
}

/**
 * Generates intelligent table name suggestions based on data heuristics and filename.
 */
export function generateTableNameSuggestions(
  filename: string = '',
  inferredCols: ColumnSchema[] = []
): string[] {
  const suggestions = new Set<string>()

  // 1. Heuristic from sanitized file name
  if (filename) {
    // Strip common extensions
    let base = filename.replace(/\.(csv|parquet|json|ndjson|tsv|txt)$/i, '')
    // Remove date/timestamp patterns: 2026-09-15, 2026_09_15, 20260915, 1726450000
    base = base.replace(/[\-_]?(?:20\d{2}[-_]?\d{2}[-_]?\d{2}|\d{10,13})/g, '')
    // Remove version/backup tags: _v1, _v2, _export, _backup, _raw, _final, _sample
    base = base.replace(/[\-_]?(?:v\d+|export|backup|raw|final|sample|data|dataset|dump|output)/gi, '')
    // Clean to snake_case
    const cleanBase = base
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')

    if (cleanBase.length >= 3 && cleanBase !== 'dataset') {
      suggestions.add(cleanBase)
      // Pluralize if likely singular noun
      if (!cleanBase.endsWith('s') && !cleanBase.endsWith('data')) {
        suggestions.add(`${cleanBase}s`)
      }
    }
  }

  // 2. Heuristic from primary key / identifier columns
  const colNames = inferredCols.map((c) => cleanColName(c.name))

  const idMap: Record<string, string> = {
    student_id: 'students',
    customer_id: 'customers',
    user_id: 'users',
    account_id: 'accounts',
    order_id: 'orders',
    product_id: 'products',
    item_id: 'items',
    employee_id: 'employees',
    patient_id: 'patients',
    vehicle_id: 'vehicles',
    invoice_id: 'invoices',
    transaction_id: 'transactions',
    event_id: 'events',
    session_id: 'sessions',
    ticket_id: 'tickets',
    device_id: 'devices',
    log_id: 'logs',
  }

  for (const col of colNames) {
    if (idMap[col]) {
      suggestions.add(idMap[col])
    } else if (col.endsWith('_id')) {
      const entity = col.replace(/_id$/, '')
      if (entity.length >= 3) {
        suggestions.add(`${entity}s`)
      }
    }
  }

  // 3. Domain keyword cluster detection
  const hasCol = (term: string) => colNames.some((c) => c.includes(term))

  if (hasCol('exam') || hasCol('gpa') || hasCol('grade') || hasCol('study') || hasCol('education')) {
    suggestions.add('student_performance')
    suggestions.add('academic_records')
  }

  if (hasCol('order') || (hasCol('price') && hasCol('quantity'))) {
    suggestions.add('orders')
    suggestions.add('sales_transactions')
  }

  if (hasCol('spend') || hasCol('monthly') || hasCol('subscription') || hasCol('tier')) {
    suggestions.add('customer_subscriptions')
  }

  if (hasCol('lat') || hasCol('lon') || hasCol('city') || hasCol('country')) {
    suggestions.add('locations')
  }

  if (hasCol('event') || hasCol('action') || hasCol('payload')) {
    suggestions.add('activity_events')
  }

  if (hasCol('salary') || hasCol('department') || hasCol('hire_date')) {
    suggestions.add('employees')
  }

  // If filename clean base is available, combine with entity
  if (filename) {
    const rawClean = filename
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')

    if (rawClean && rawClean.length >= 3 && rawClean !== 'dataset') {
      suggestions.add(rawClean)
    }
  }

  // Filter out generic bad suggestions
  const invalid = new Set(['dataset', 'data', 'file', 'table', 'temp', 'test', 'export'])
  const filtered = Array.from(suggestions).filter((s) => s.length >= 3 && !invalid.has(s))

  // Guarantee at least fallback suggestions if nothing detected
  if (filtered.length === 0) {
    return ['ingested_records', 'source_data', 'imported_table']
  }

  return filtered.slice(0, 5)
}

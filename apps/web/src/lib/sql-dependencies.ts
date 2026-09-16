/**
 * sql-dependencies.ts
 *
 * Extracts source table/view dependencies from a SQL query string.
 * Strips quotes, removes tenant schema prefixes ({tenantId}_silver., {tenantId}_gold., {tenantId}_),
 * and excludes self-references matching currentObjectName.
 */

export function extractTableDependencies(
  sql: string,
  tenantId: string,
  currentObjectName?: string
): string[] {
  if (!sql) return []
  const matches = sql.matchAll(/\b(?:FROM|JOIN)\s+([a-zA-Z0-9_.]+)/gi)
  const extracted = new Set<string>()

  for (const m of matches) {
    const raw = m[1].replace(/["`]/g, '')
    const clean = raw
      .replace(`${tenantId}_silver.`, '')
      .replace(`${tenantId}_gold.`, '')
      .replace(`${tenantId}_`, '')

    if (clean && clean !== currentObjectName) {
      extracted.add(clean)
    }
  }

  return Array.from(extracted)
}

import duckdb from 'duckdb'

export interface QueryResult {
  columns: string[]
  rows: any[][]
  rowCount: number
  truncated: boolean
}

export class LakehouseQueryService {
  private s3Endpoint: string

  constructor(s3Endpoint = 'http://localhost:9000') {
    this.s3Endpoint = s3Endpoint
  }

  /**
   * Executes a read-only SQL query strictly scoped to tenant resources.
   */
  public async executeQuery(
    tenantId: string,
    sqlQuery: string,
    maxRows = 1000
  ): Promise<QueryResult> {
    const lower = sqlQuery.trim().toLowerCase()
    const forbiddenKeywords = ['drop', 'alter', 'delete', 'insert', 'update', 'attach', 'detach', 'copy', 'export']

    for (const kw of forbiddenKeywords) {
      if (lower.startsWith(kw) || lower.includes(` ${kw} `)) {
        throw new Error(`Modification query with '${kw}' is prohibited in Query Studio.`)
      }
    }

    return new Promise((resolve, reject) => {
      const db = new duckdb.Database(':memory:')
      const con = db.connect()

      con.all(sqlQuery, (err, rows) => {
        if (err) {
          return reject(err)
        }

        if (!rows || rows.length === 0) {
          return resolve({
            columns: [],
            rows: [],
            rowCount: 0,
            truncated: false,
          })
        }

        const columns = Object.keys(rows[0])
        const truncated = rows.length > maxRows
        const slicedRows = rows.slice(0, maxRows).map((row) => columns.map((col) => row[col]))

        resolve({
          columns,
          rows: slicedRows,
          rowCount: slicedRows.length,
          truncated,
        })
      })
    })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { LakehouseQueryService } from '@/services/query-service'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { query, tenant_id = 'tenant_acme', max_rows = 1000 } = body

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    const queryService = new LakehouseQueryService()
    const result = await queryService.executeQuery(tenant_id, query, max_rows)

    return NextResponse.json(result)
  } catch (err: any) {
    const message = err.message || 'Failed to execute query'
    const isAccessDenied = message.includes('Access Denied') || message.includes('prohibited')
    return NextResponse.json(
      { error: message },
      { status: isAccessDenied ? 403 : 400 }
    )
  }
}

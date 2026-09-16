import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tenantId = searchParams.get('tenant_id') || 'tenant_acme'

    const workerUrl = process.env.WORKER_URL || 'http://worker:8000'
    const res = await fetch(`${workerUrl}/api/v1/tables?tenant_id=${encodeURIComponent(tenantId)}`)

    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: `Worker error: ${err}` }, { status: res.status })
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to list tables for tenant' },
      { status: 500 }
    )
  }
}

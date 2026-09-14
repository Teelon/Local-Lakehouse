import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { query } = body

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    const workerUrl = process.env.WORKER_URL || 'http://localhost:8000'
    const formData = new FormData()
    formData.append('query', query)

    // Execute query via the worker's DuckDB store
    const res = await fetch(`${workerUrl}/api/v1/query`, {
      method: 'POST',
      body: formData,
    })

    const data = await res.json()
    if (!res.ok) {
      return NextResponse.json({ error: data.detail || 'Query execution failed' }, { status: res.status })
    }

    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to execute query' }, { status: 500 })
  }
}

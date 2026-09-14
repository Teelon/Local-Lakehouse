import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { tenant_id, table_name, file_path, file_format } = body

    if (!tenant_id || !table_name || !file_path || !file_format) {
      return NextResponse.json(
        { error: 'Missing required parameters: tenant_id, table_name, file_path, file_format' },
        { status: 400 }
      )
    }

    const workerUrl = process.env.WORKER_URL || 'http://localhost:8000'
    const jobId = `job_${Date.now()}`

    // Forward ingestion task to Python/FastAPI worker
    const workerRes = await fetch(`${workerUrl}/api/v1/jobs/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId,
        tenant_id,
        table_name,
        file_path,
        file_format,
      }),
    })

    if (!workerRes.ok) {
      const workerErr = await workerRes.text()
      return NextResponse.json(
        { error: `Worker rejected job: ${workerErr}` },
        { status: workerRes.status }
      )
    }

    const workerData = await workerRes.json()
    return NextResponse.json({
      success: true,
      job: workerData,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to dispatch ingestion job' },
      { status: 500 }
    )
  }
}

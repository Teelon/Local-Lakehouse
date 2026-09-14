import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const workerUrl = process.env.WORKER_URL || 'http://localhost:8000'

    // Forward multipart form data directly to the Python worker
    const workerRes = await fetch(`${workerUrl}/api/v1/pipeline/upload-and-commit`, {
      method: 'POST',
      body: formData,
    })

    const data = await workerRes.json()
    if (!workerRes.ok) {
      return NextResponse.json(
        { error: data.detail || 'Worker failed to process dataset' },
        { status: workerRes.status }
      )
    }

    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Server failed to dispatch to worker' },
      { status: 500 }
    )
  }
}

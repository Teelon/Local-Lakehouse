import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getPayload } from 'payload'
import configPromise from '../../../../payload.config'
import { getTenantScopedCredentials } from '@/lib/s3-credentials'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    // NOTE: tenant_id is caller-supplied and not cryptographically verified (MVP 1 — no auth).
    // Tenant storage isolation IS enforced via STS-scoped credentials and S3 key prefix namespacing.
    const tenantId = (formData.get('tenant_id') as string)?.trim() || 'tenant_acme'
    const rawTableName = (formData.get('table_name') as string)?.trim() || ''
    const file = formData.get('file') as File

    if (!rawTableName || rawTableName.toLowerCase() === 'dataset') {
      return NextResponse.json(
        { error: 'Target table name is required. Ingestion cannot proceed without an explicit, confirmed table name.' },
        { status: 400 }
      )
    }

    const cleanTableName = rawTableName.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '')
    if (!cleanTableName || cleanTableName.length < 2) {
      return NextResponse.json(
        { error: 'Target table name must contain at least 2 alphanumeric characters.' },
        { status: 400 }
      )
    }

    const tableName = cleanTableName

    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 })
    }

    const filename = file.name || `${tableName}.csv`
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // 1. Obtain tenant-scoped temporary S3 credentials via STS.
    // Previously this used root credentials (S3_ROOT_USER/S3_ROOT_PASSWORD) directly,
    // bypassing the tenant-scoped credential system that already existed in /api/auth/sts.
    // STS scoping ensures uploads can only land under tenants/{tenantId}/* in the bucket.
    const scopedCreds = await getTenantScopedCredentials(tenantId)

    const s3Endpoint = process.env.S3_ENDPOINT || 'http://storage:9000'
    const bucket = process.env.S3_BUCKET_NAME || 'lakehouse-bucket'
    const region = process.env.S3_REGION || 'us-east-1'

    const s3Client = new S3Client({
      endpoint: s3Endpoint,
      region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: scopedCreds.accessKeyId,
        secretAccessKey: scopedCreds.secretAccessKey,
        ...(scopedCreds.sessionToken ? { sessionToken: scopedCreds.sessionToken } : {}),
      },
    })

    const rawKey = `tenants/${tenantId}/raw/${Date.now()}_${filename}`
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: rawKey,
        Body: buffer,
        ContentType: file.type || 'text/plain',
      })
    )

    const rawS3Uri = `s3://${bucket}/${rawKey}`

    // 2. Initialize Payload and ensure tenant exists
    const payload = await getPayload({ config: configPromise })

    let tenantDoc = null
    const existingTenants = await payload.find({
      collection: 'tenants',
      where: { slug: { equals: tenantId } },
      limit: 1,
    })

    if (existingTenants.docs.length > 0) {
      tenantDoc = existingTenants.docs[0]
    } else {
      tenantDoc = await payload.create({
        collection: 'tenants',
        data: {
          name: tenantId.replace('_', ' ').toUpperCase(),
          slug: tenantId,
          active: true,
        },
      })
    }

    // Determine format
    let format: 'csv' | 'json' | 'parquet' = 'csv'
    if (filename.endsWith('.parquet')) format = 'parquet'
    else if (filename.endsWith('.json') || filename.endsWith('.ndjson')) format = 'json'

    // 3. Create Dataset in Payload with status 'uploaded' -> fires afterChange hook to enqueue ingest-file job
    const dataset = await payload.create({
      collection: 'datasets',
      data: {
        name: tableName,
        tenant: tenantDoc.id,
        rawFilePath: rawKey,
        format,
        layer: 'silver',
        objectType: 'table',
        status: 'uploaded',
        ducklakeTable: `${tenantId}_silver.${tableName}`,
      },
    })

    return NextResponse.json({
      success: true,
      dataset_id: dataset.id,
      tenant_id: tenantId,
      table_name: `${tenantId}_silver.${tableName}`,
      layer: 'silver',
      raw_s3_uri: rawS3Uri,
      status: 'uploaded',
      message: `File uploaded to RustFS (${rawS3Uri}). Ingestion job automatically enqueued in Payload Jobs Queue for '${tenantId}_silver.${tableName}'.`,
    })
  } catch (err: any) {
    console.error('Upload & Ingest Pipeline error:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to upload and enqueue ingestion' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts'

export async function POST(req: NextRequest) {
  try {
    const { tenant_id } = await req.json()

    if (!tenant_id) {
      return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 })
    }

    const s3Endpoint = process.env.S3_ENDPOINT || 'http://storage:9000'
    const accessKeyId = process.env.S3_ROOT_USER || 'lakehouse_storage_admin'
    const secretAccessKey = process.env.S3_ROOT_PASSWORD || 'storage_secret_change_me'
    const bucket = process.env.S3_BUCKET_NAME || 'lakehouse-bucket'
    const region = process.env.S3_REGION || 'us-east-1'

    const stsClient = new STSClient({
      endpoint: s3Endpoint,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    })

    // Scoped IAM policy strictly restricting access to tenants/{tenant_id}/*
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
          Resource: [`arn:aws:s3:::${bucket}/tenants/${tenant_id}/*`],
        },
        {
          Effect: 'Allow',
          Action: ['s3:ListBucket'],
          Resource: [`arn:aws:s3:::${bucket}`],
          Condition: {
            StringLike: {
              's3:prefix': [`tenants/${tenant_id}/*`],
            },
          },
        },
      ],
    }

    const command = new AssumeRoleCommand({
      RoleArn: 'arn:aws:iam:::role/tenant-scoped-role',
      RoleSessionName: `session_${tenant_id}_${Date.now()}`,
      Policy: JSON.stringify(policy),
      DurationSeconds: 3600,
    })

    const response = await stsClient.send(command)

    if (!response.Credentials) {
      throw new Error('Failed to obtain STS temporary credentials')
    }

    return NextResponse.json({
      success: true,
      tenant_id,
      credentials: {
        AccessKeyId: response.Credentials.AccessKeyId,
        SecretAccessKey: response.Credentials.SecretAccessKey,
        SessionToken: response.Credentials.SessionToken,
        Expiration: response.Credentials.Expiration,
      },
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to issue STS temporary credentials' },
      { status: 500 }
    )
  }
}

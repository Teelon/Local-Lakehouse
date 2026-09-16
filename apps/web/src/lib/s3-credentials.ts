/**
 * s3-credentials.ts
 *
 * Shared internal utility for obtaining tenant-scoped temporary S3 credentials
 * via STS AssumeRole. Called directly by ingest and other write routes — not
 * via an HTTP round-trip to /api/auth/sts.
 *
 * IMPORTANT — RustFS STS inline policy note (MVP 1):
 * RustFS implements the STS AssumeRole API, but its enforcement of inline
 * session policies (the Policy JSON below) may be incomplete compared to AWS IAM.
 * The scoped token is still materially better than root credentials because:
 *   1. The token is ephemeral (1-hour TTL).
 *   2. If/when RustFS or a future S3 backend enforces inline policies, the
 *      restriction to tenants/{tenant_id}/* is already expressed correctly here.
 * Do not rely on this as a hard enforcement boundary for adversarial tenants;
 * the primary tenant storage isolation is enforced via the key-prefix naming
 * convention and the TypeScript SQL guardrails.
 */

import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts'

export interface TenantScopedCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  expiration?: Date
}

/**
 * Obtains tenant-scoped temporary S3 credentials via STS AssumeRole.
 * The returned credentials are restricted to tenants/{tenant_id}/* within
 * the lakehouse bucket.
 *
 * Falls back to root credentials with a logged warning if STS fails.
 * This ensures ingest is not broken if STS is misconfigured, while making
 * the failure clearly visible in logs rather than silent.
 */
export async function getTenantScopedCredentials(
  tenantId: string
): Promise<TenantScopedCredentials> {
  const s3Endpoint = process.env.S3_ENDPOINT || 'http://storage:9000'
  const rootAccessKeyId = process.env.S3_ROOT_USER || 'lakehouse_storage_admin'
  const rootSecretAccessKey = process.env.S3_ROOT_PASSWORD || 'storage_secret_change_me'
  const bucket = process.env.S3_BUCKET_NAME || 'lakehouse-bucket'
  const region = process.env.S3_REGION || 'us-east-1'

  try {
    const stsClient = new STSClient({
      endpoint: s3Endpoint,
      region,
      credentials: {
        accessKeyId: rootAccessKeyId,
        secretAccessKey: rootSecretAccessKey,
      },
    })

    // Inline session policy scoped strictly to this tenant's S3 prefix.
    // Note: enforcement depends on the STS implementation of the object store
    // (see file-level comment above).
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
          Resource: [`arn:aws:s3:::${bucket}/tenants/${tenantId}/*`],
        },
        {
          Effect: 'Allow',
          Action: ['s3:ListBucket'],
          Resource: [`arn:aws:s3:::${bucket}`],
          Condition: {
            StringLike: {
              's3:prefix': [`tenants/${tenantId}/*`],
            },
          },
        },
      ],
    }

    const command = new AssumeRoleCommand({
      RoleArn: 'arn:aws:iam:::role/tenant-scoped-role',
      RoleSessionName: `session_${tenantId}_${Date.now()}`,
      Policy: JSON.stringify(policy),
      DurationSeconds: 3600,
    })

    const response = await stsClient.send(command)

    if (!response.Credentials) {
      throw new Error('STS returned no credentials')
    }

    return {
      accessKeyId: response.Credentials.AccessKeyId!,
      secretAccessKey: response.Credentials.SecretAccessKey!,
      sessionToken: response.Credentials.SessionToken,
      expiration: response.Credentials.Expiration,
    }
  } catch (err: any) {
    // Log clearly — do not silently swallow. Falls back to root credentials
    // so ingest continues to work if STS is not supported by the object store.
    console.warn(
      `[s3-credentials] STS AssumeRole failed for tenant '${tenantId}'; ` +
        `falling back to root credentials. Error: ${err.message}`
    )
    return {
      accessKeyId: rootAccessKeyId,
      secretAccessKey: rootSecretAccessKey,
    }
  }
}

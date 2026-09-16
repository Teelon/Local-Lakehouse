import { S3Client } from '@aws-sdk/client-s3'
import { STSClient } from '@aws-sdk/client-sts'
import { getTenantScopedCredentials } from './s3-credentials'

/**
 * S3ClientFactory
 *
 * Centralized factory for creating S3 and STS client instances.
 * Enforces tenant-scoped STS credentials for data operations touching a specific tenant,
 * while isolating root-credentialed client creation to administrative tasks.
 */
export class S3ClientFactory {
  /**
   * Tenant-scoped S3 client â€” for any operation touching a specific tenant's data.
   * Obtains temporary scoped STS credentials restricted to tenants/{tenantId}/*
   * (falling back to root credentials if STS is unavailable, with logged warning).
   */
  static async createTenantS3Client(tenantId: string): Promise<S3Client> {
    const creds = await getTenantScopedCredentials(tenantId)
    const endpoint = process.env.S3_ENDPOINT || 'http://storage:9000'
    const region = process.env.S3_REGION || 'us-east-1'

    return new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        ...(creds.sessionToken ? { sessionToken: creds.sessionToken } : {}),
      },
    })
  }

  /**
   * Root-credentialed S3 client â€” only for genuinely tenant-independent admin operations
   * (e.g. initial bucket provisioning, health checks).
   * Do NOT use this for anything that touches a specific tenant's data.
   */
  static createAdminS3Client(): S3Client {
    const endpoint = process.env.S3_ENDPOINT || 'http://storage:9000'
    const region = process.env.S3_REGION || 'us-east-1'
    const accessKeyId = process.env.S3_ROOT_USER || 'lakehouse_storage_admin'
    const secretAccessKey = process.env.S3_ROOT_PASSWORD || 'storage_secret_change_me'

    return new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    })
  }

  /**
   * Raw STS client factory, for operations that need to call STS AssumeRole
   * directly (e.g. STS credential vending endpoint).
   */
  static createSTSClient(): STSClient {
    const endpoint = process.env.S3_ENDPOINT || 'http://storage:9000'
    const region = process.env.S3_REGION || 'us-east-1'
    const accessKeyId = process.env.S3_ROOT_USER || 'lakehouse_storage_admin'
    const secretAccessKey = process.env.S3_ROOT_PASSWORD || 'storage_secret_change_me'

    return new STSClient({
      endpoint,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    })
  }
}

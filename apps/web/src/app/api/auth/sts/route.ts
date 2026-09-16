import { NextRequest, NextResponse } from 'next/server'
import { getTenantScopedCredentials } from '@/lib/s3-credentials'

/**
 * POST /api/auth/sts
 *
 * HTTP endpoint for tenant-scoped STS credential vending.
 * The core logic lives in @/lib/s3-credentials (getTenantScopedCredentials),
 * which is also called directly (not via this HTTP endpoint) by ingest and
 * other write routes to avoid unnecessary round-trips.
 *
 * This endpoint is retained for future client-side STS credential requests
 * (e.g., direct browser uploads or external integrations).
 */
export async function POST(req: NextRequest) {
  try {
    const { tenant_id } = await req.json()

    if (!tenant_id) {
      return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 })
    }

    const credentials = await getTenantScopedCredentials(tenant_id)

    return NextResponse.json({
      success: true,
      tenant_id,
      credentials: {
        AccessKeyId: credentials.accessKeyId,
        SecretAccessKey: credentials.secretAccessKey,
        SessionToken: credentials.sessionToken,
        Expiration: credentials.expiration,
      },
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to issue STS temporary credentials' },
      { status: 500 }
    )
  }
}

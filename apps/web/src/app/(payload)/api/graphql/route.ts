import config from '@payload-config'
import { GRAPHQL_POST, GRAPHQL_PLAYGROUND_GET } from '@payloadcms/next/routes'

export const POST = GRAPHQL_POST(config)
export const GET = GRAPHQL_PLAYGROUND_GET(config)

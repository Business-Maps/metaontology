/**
 * HTTP Transport -
 *  - testConnection sends a HEAD or GET to the endpoint root and
 *    verifies the response is < 500
 *
 * **What it does NOT do:**
 *  - Retry on failure (the Pipeline runtime in Phase 10 owns retries)
 *  - Rate limiting (the Pipeline's `rateLimit` field drives this in
 *    Phase 10)
 *  - OAuth2 flow (Phase 11 auth story - credential refresh etc.)
 *  - Connection pooling (browser fetch handles this internally)
 *
 * **Dependency injection for tests:**
 *
 * The transport accepts an optional `fetchImpl` callback. In production
 * it defaults to the global `fetch`. Tests can pass a stub without
 * touching the network.
 */

import type {
  Transport,
  TransportRequest,
  TransportResponse,
  TransportDataSource,
} from './types'
import type { SecretValue } from '../secretStore'

export interface HttpTransportOptions {
  /** Optional fetch implementation for testing. Defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Default request timeout in ms. Default 30000. */
  defaultTimeoutMs?: number
}

const METHOD_BY_OPERATION: Record<TransportRequest['operation'], string> = {
  read: 'GET',
  list: 'GET',
  write: 'POST',
  delete: 'DELETE',
}

function buildUrl(endpoint: string, path?: string, params?: Record<string, unknown>): string {
  // Concatenate path safely: strip trailing slash from endpoint, leading slash from path.
  const base = endpoint.replace(/\/$/, '')
  const suffix = path ? (path.startsWith('/') ? path : `/${path}`) : ''
  const url = new URL(`${base}${suffix}`)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

function buildHeaders(
  dataSource: TransportDataSource,
  credentials: SecretValue | null | undefined,
  hasBody: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  if (hasBody) headers['Content-Type'] = 'application/json'

  if (!credentials) return headers

  switch (dataSource.authType) {
    case 'bearer': {
      const token = credentials.accessToken ?? credentials.token ?? credentials.apiKey
      if (token) headers.Authorization = `Bearer ${token}`
      break
    }
    case 'basic': {
      const { username = '', password = '' } = credentials
      if (username || password) {
        const encoded = typeof btoa === 'function'
          ? btoa(`${username}:${password}`)
          : Buffer.from(`${username}:${password}`).toString('base64')
        headers.Authorization = `Basic ${encoded}`
      }
      break
    }
    case 'api-key': {
      // Most API-key services use a custom header - the DataSource
      // config can specify which header name to use. Default to
      // `X-API-Key` as the most common convention.
      const headerName = (dataSource.config?.apiKeyHeader as string | undefined) ?? 'X-API-Key'
      if (credentials.apiKey) headers[headerName] = credentials.apiKey
      break
    }
    // none / oauth2 / sasl handled upstream or not applicable to plain HTTP.
  }

  return headers
}

export function createHttpTransport(options: HttpTransportOptions = {}): Transport {
  const { fetchImpl = globalThis.fetch, defaultTimeoutMs = 30_000 } = options

  if (typeof fetchImpl !== 'function') {
    throw new Error(
      'httpTransport requires a fetch implementation - pass `fetchImpl` in options or run in an environment with global fetch',
    )
  }

  async function execute<T = unknown>(
    request: TransportRequest,
    credentials?: SecretValue | null,
  ): Promise<TransportResponse<T>> {
    const url = buildUrl(request.dataSource.endpoint, request.path, request.params as Record<string, unknown> | undefined)
    const method = METHOD_BY_OPERATION[request.operation]
    const hasBody = request.body !== undefined && method !== 'GET'
    const headers = buildHeaders(request.dataSource, credentials, hasBody)

    const controller = new AbortController()
    const timeoutMs = request.timeoutMs ?? defaultTimeoutMs
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetchImpl(url, {
        method,
        headers,
        body: hasBody ? JSON.stringify(request.body) : undefined,
        signal: controller.signal,
      })
      const contentType = response.headers.get('content-type') ?? ''
      let data: unknown
      if (contentType.includes('application/json')) {
        try {
          data = await response.json()
        } catch {
          data = undefined
        }
      } else {
        data = await response.text()
      }

      if (!response.ok) {
        return {
          success: false,
          statusCode: response.status,
          error: `HTTP ${response.status}: ${response.statusText}`,
          data: data as T,
        }
      }

      return {
        success: true,
        statusCode: response.status,
        data: data as T,
      }
    } catch (e) {
      const isAbort = e instanceof Error && e.name === 'AbortError'
      return {
        success: false,
        error: isAbort
          ? `Request timed out after ${timeoutMs}ms`
          : e instanceof Error ? e.message : String(e),
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async function testConnection(
    dataSource: TransportDataSource,
    credentials?: SecretValue | null,
  ) {
    const result = await execute(
      { dataSource, operation: 'read' },
      credentials,
    )
    // Treat any status < 500 as "we reached the server" - 404 is a
    // successful connection to a missing resource, not a broken
    // transport.
    if (result.success) return { success: true }
    if (result.statusCode !== undefined && result.statusCode < 500) return { success: true }
    return { success: false, error: result.error }
  }

  return {
    kind: 'http',
    execute,
    testConnection,
  }
}

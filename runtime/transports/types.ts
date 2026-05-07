/**
 * Transport contract - then shapes those
 * records into typed instances.
 *
 * **Responsibility split** - this is the line that Phase 9.7 will
 * exploit to split the composite repository cleanly:
 *
 *   Transport:     DataSource + request → raw records (bytes/JSON)
 *   Mapping:       raw records + mapping spec → typed instances
 *   Provider:      strategy-specific storage (local, synced, etc.)
 *   CompositeRepo: per-Thing routing into providers
 *
 * Transports know nothing about the M1 model. They know about their
 * protocol (http, file, sql) and about the DataSource's transport-
 * specific config (headers, query params, file path).
 *
 * **Credentials** are resolved through the secret store (Phase 7) at
 * the point a transport needs to authenticate. Transports accept a
 * credential resolver callback rather than reading the store
 * directly - this keeps the test implementations free of any store
 * dependency and makes it obvious in code review which transports
 * actually need credentials.
 */

import type { SecretValue } from '../secretStore'

// ── Request/response shapes ─────────────────────────────────────────────────

export interface TransportRequest {
  /** The DataSource this request is for - transports inspect its endpoint + config. */
  dataSource: TransportDataSource
  /** HTTP method / SQL operation / file action. Transport-specific interpretation. */
  operation: 'read' | 'write' | 'delete' | 'list'
  /** Path relative to `dataSource.endpoint` (for http: URL path; for file: relative file path). */
  path?: string
  /** Query parameters (for http) or filter predicates (for sql). Interpretation is transport-specific. */
  params?: Record<string, unknown>
  /** Body payload for write operations. */
  body?: unknown
  /** Per-request timeout override. */
  timeoutMs?: number
}

/**
 * Narrow DataSource projection - just the fields a transport needs.
 * Avoids coupling transports to the full DataSource type (which lives
 * in the generated context.ts and changes across codegen runs).
 */
export interface TransportDataSource {
  id: string
  transport: string
  endpoint: string
  credentialRef?: string
  authType?: string
  config?: Record<string, unknown>
}

export interface TransportResponse<T = unknown> {
  /** True if the underlying operation succeeded. */
  success: boolean
  /** Raw response body - transport decodes JSON/text as appropriate. */
  data?: T
  /** HTTP-like status code for diagnostic purposes. Optional for non-http transports. */
  statusCode?: number
  /** Human-readable error message when success is false. */
  error?: string
  /** Unstructured diagnostic metadata (headers, timing, etc.). */
  metadata?: Record<string, unknown>
}

// ── The Transport interface ────────────────────────────────────────────────

/**
 * A Transport adapter for a single protocol family (http, file, sql, etc.).
 *
 * Implementations:
 *   - Stateless where possible (http is just `fetch` + headers)
 *   - May cache connections (sql uses a pool)
 *   - MUST NOT retain credentials in memory beyond the request lifetime
 *   - Must not import from app layer - transports are pure-layer code
 */
export interface Transport {
  /** Canonical transport kind, matching DataSourceTransport enum values. */
  readonly kind: string

  /** Execute a single request. */
  execute<T = unknown>(
    request: TransportRequest,
    credentials?: SecretValue | null,
  ): Promise<TransportResponse<T>>

  /**
   * Test connectivity. Phase 7 acceptance includes
   * `datasource:test-connection`, which runs this method and surfaces
   * the result in the UI. A successful test proves the transport can
   * reach the endpoint with the given credentials.
   *
   * Returns { success: true } on successful contact, or
   * { success: false, error } on failure.
   */
  testConnection(
    dataSource: TransportDataSource,
    credentials?: SecretValue | null,
  ): Promise<{ success: boolean; error?: string }>
}

/**
 * A credential resolver callback - the Phase 7 secret store exports
 * one of these per DataSource. Providers inject this into transports
 * so the test implementations don't need a running secret store.
 */
export type CredentialResolver = (credentialRef: string) => SecretValue | null | undefined

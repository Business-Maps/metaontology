/**
 * FakeTransport - the test double for Transport.
 *
 *` - any
 *    subsequent `execute({ path })` returns the seeded response.
 *  - Track every call for assertion - `calls` is an append-only log.
 *  - Control connection test results via `setConnectionResult`.
 *  - Optional `delayMs` per call for testing race conditions.
 *  - Optional `failAfterN` to simulate transient failures.
 *
 * Nothing about this implementation touches the network, the file
 * system, or any secret store. It's a pure in-memory record + replay.
 */

import type {
  Transport,
  TransportRequest,
  TransportResponse,
  TransportDataSource,
} from './types'
import type { SecretValue } from '../secretStore'

export interface FakeTransportOptions {
  /** Per-call latency in ms. Default 0. */
  delayMs?: number
  /** Transport kind advertised. Default 'fake'. */
  kind?: string
}

export interface FakeCall {
  request: TransportRequest
  credentials?: SecretValue | null
  timestamp: number
}

export interface FakeTransport extends Transport {
  /** All execute() calls in order of invocation. */
  readonly calls: readonly FakeCall[]
  /** Seed a response for a specific path (undefined path = default). */
  setResponse<T = unknown>(path: string | undefined, response: TransportResponse<T>): void
  /** Clear all seeded responses and call log. */
  reset(): void
  /** Control connection test results. */
  setConnectionResult(result: { success: boolean; error?: string }): void
  /** Cause the next N calls to fail before succeeding. */
  failNextN(n: number, error?: string): void
}

export function createFakeTransport(opts: FakeTransportOptions = {}): FakeTransport {
  const kind = opts.kind ?? 'fake'
  const delayMs = opts.delayMs ?? 0

  const responses = new Map<string, TransportResponse>()
  const calls: FakeCall[] = []
  let connectionResult: { success: boolean; error?: string } = { success: true }
  let failuresRemaining = 0
  let failureError = 'Fake transport failure'

  const DEFAULT_KEY = '__default__'

  return {
    kind,

    get calls() {
      return calls
    },

    setResponse(path, response) {
      responses.set(path ?? DEFAULT_KEY, response as TransportResponse)
    },

    setConnectionResult(result) {
      connectionResult = result
    },

    failNextN(n, error = 'Fake transport failure') {
      failuresRemaining = n
      failureError = error
    },

    reset() {
      responses.clear()
      calls.length = 0
      connectionResult = { success: true }
      failuresRemaining = 0
    },

    async execute<T = unknown>(
      request: TransportRequest,
      credentials?: SecretValue | null,
    ): Promise<TransportResponse<T>> {
      calls.push({ request, credentials, timestamp: Date.now() })

      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }

      if (failuresRemaining > 0) {
        failuresRemaining--
        return {
          success: false,
          statusCode: 500,
          error: failureError,
        }
      }

      const key = request.path ?? DEFAULT_KEY
      const response = responses.get(key) ?? responses.get(DEFAULT_KEY)
      if (!response) {
        return {
          success: false,
          statusCode: 404,
          error: `No seeded response for path "${key}"`,
        }
      }

      return response as TransportResponse<T>
    },

    async testConnection(_dataSource: TransportDataSource, _credentials?: SecretValue | null) {
      return connectionResult
    },
  }
}

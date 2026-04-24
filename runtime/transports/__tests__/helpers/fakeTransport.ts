/**
 * `FakeTransport` - controllable mock for tests that need to exercise transport
 * behavior (HTTP, file, GraphQL, webhook, etc.) without standing up a real
 * server or filesystem.
 *
 * Why this lives here, ahead of Phase 9:
 *   The. Every transport test, every Pipeline runtime test, every
 *   simulation test, every writeback test, and every operations console test
 *   needs to inject canned responses without a real network. Building this now
 *   stops every future test from re-deriving its own mock.
 *
 * Design decisions:
 *   - Transport-agnostic. The fixture does NOT import a `Transport` interface,
 *     because that interface doesn't exist yet. Phase 9 will define it; tests
 *     can wrap the fixture in whatever shape Phase 9 lands on.
 *   - The protocol surface is `request(method, url, body) → response`. Even SQL
 *     and file transports can be modeled this way (the URL is the query, the
 *     body is the parameters).
 *   - Routes are matched in order, first wins. Use `addRoute` for explicit
 *     control or `setDefaultResponse` for catch-all.
 *   - Failure injection is per-route or global, deterministic by call count
 *     (`failOnCall: 3` fails the 3rd matching call) - never random, so tests
 *     don't flake.
 *   - Latency is configurable per-route. Default is 0 (synchronous-feeling).
 *     Tests using `vi.useFakeTimers()` can advance time deterministically.
 *   - Rate-limit emulation is opt-in via `setRateLimit({ requestsPerWindow,
 *     windowMs })`. When the limit is exceeded, the fixture returns a 429
 *     response. The test author chooses whether the transport-under-test
 *     respects 429s; the fixture only enforces the surface.
 *
 * The fixture exposes a rich call log (`.calls`) so tests can assert on
 * "did you call /v1/customers exactly twice with these query params".
 */

// ── Surface types ──────────────────────────────────────────────────────────

/** HTTP-style request. SQL/file transports model their query as `url` and
 *  parameters as `body`. */
export interface FakeRequest {
  method: string
  url: string
  body?: unknown
  headers?: Record<string, string>
}

/** HTTP-style response. Body is opaque to the fixture - the test author
 *  decides whether it's JSON, raw, or a typed structure. */
export interface FakeResponse {
  status: number
  body: unknown
  headers?: Record<string, string>
}

/** Predicate for route matching. Routes are matched in registration order. */
export type RouteMatcher = (req: FakeRequest) => boolean

/** Response producer. Receives the request and the call index (1-based, per
 *  route) so the responder can vary output by call number. */
export type ResponseProducer =
  | FakeResponse
  | ((req: FakeRequest, callIndex: number) => FakeResponse | Promise<FakeResponse>)

/** A registered route definition. */
export interface FakeRoute {
  matcher: RouteMatcher
  responder: ResponseProducer
  /** Latency in milliseconds before responding. Default: 0. */
  latencyMs?: number
  /** Fail this specific route on the Nth matching call (1-based). Throws an
   *  error instead of returning a response. Use for transient-error tests. */
  failOnCall?: number
  /** Error to throw on the failed call. Default: `new Error('FakeTransport route failure')`. */
  failError?: Error
  /** Optional label for debugging assertion failures. */
  label?: string
}

export interface RateLimitConfig {
  /** Maximum requests allowed per window. */
  requestsPerWindow: number
  /** Window length in milliseconds. */
  windowMs: number
  /** Status code to return when limit exceeded. Default: 429. */
  rejectStatus?: number
  /** Body to return when limit exceeded. Default: `{ error: 'rate_limited' }`. */
  rejectBody?: unknown
}

// ── Public surface ─────────────────────────────────────────────────────────

export interface FakeTransport {
  /** Issue a request. Resolves to the matched route's response, or rejects if
   *  the route is configured to fail on the current call index. */
  request(req: FakeRequest): Promise<FakeResponse>
  /** Register a route. Routes are matched in registration order - first match
   *  wins. */
  addRoute(route: FakeRoute): void
  /** Convenience: register a literal-URL match. */
  whenUrl(url: string, responder: ResponseProducer, opts?: Omit<FakeRoute, 'matcher' | 'responder'>): void
  /** Convenience: register a method+URL prefix match. */
  whenMethodAndPathPrefix(
    method: string,
    pathPrefix: string,
    responder: ResponseProducer,
    opts?: Omit<FakeRoute, 'matcher' | 'responder'>,
  ): void
  /** Set the catch-all response when no route matches. Default: 404. */
  setDefaultResponse(resp: FakeResponse): void
  /** Enable rate-limit emulation. Pass `null` to disable. */
  setRateLimit(config: RateLimitConfig | null): void
  /** All requests received in order, with the matched route label and the
   *  response that was returned. */
  readonly calls: readonly FakeCall[]
  /** Number of recorded calls. Equivalent to `calls.length`. */
  readonly callCount: number
  /** Clear all routes, calls, and rate-limit state. The default response is
   *  preserved (404). */
  reset(): void
}

export interface FakeCall {
  request: FakeRequest
  response: FakeResponse | null  // null if the call threw
  thrownError: Error | null
  matchedRoute: string | null
  timestamp: number
}

// ── Implementation ─────────────────────────────────────────────────────────

const DEFAULT_404: FakeResponse = { status: 404, body: { error: 'no route matched' } }

export function createFakeTransport(): FakeTransport {
  const routes: FakeRoute[] = []
  const calls: FakeCall[] = []
  const routeCallCounts = new Map<FakeRoute, number>()
  let defaultResponse: FakeResponse = DEFAULT_404
  let rateLimit: RateLimitConfig | null = null
  let rateLimitWindowStart = 0
  let rateLimitCount = 0

  function checkRateLimit(): FakeResponse | null {
    if (!rateLimit) return null
    const now = Date.now()
    // Reset window if it has elapsed
    if (now - rateLimitWindowStart >= rateLimit.windowMs) {
      rateLimitWindowStart = now
      rateLimitCount = 0
    }
    if (rateLimitCount >= rateLimit.requestsPerWindow) {
      return {
        status: rateLimit.rejectStatus ?? 429,
        body: rateLimit.rejectBody ?? { error: 'rate_limited' },
      }
    }
    rateLimitCount++
    return null
  }

  async function delay(ms: number): Promise<void> {
    if (ms <= 0) return
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async function resolveResponder(
    responder: ResponseProducer,
    req: FakeRequest,
    callIndex: number,
  ): Promise<FakeResponse> {
    if (typeof responder === 'function') {
      return responder(req, callIndex)
    }
    return responder
  }

  const transport: FakeTransport = {
    get calls() { return calls },
    get callCount() { return calls.length },

    async request(req: FakeRequest): Promise<FakeResponse> {
      const limited = checkRateLimit()
      if (limited) {
        // Rate-limited responses are still recorded as calls so tests can
        // assert "we tried 11 times but only got 10 successes".
        calls.push({
          request: req,
          response: limited,
          thrownError: null,
          matchedRoute: '<rate-limited>',
          timestamp: Date.now(),
        })
        return limited
      }

      // First-match-wins routing.
      const route = routes.find(r => r.matcher(req))
      if (!route) {
        calls.push({
          request: req,
          response: defaultResponse,
          thrownError: null,
          matchedRoute: null,
          timestamp: Date.now(),
        })
        return defaultResponse
      }

      const callIndex = (routeCallCounts.get(route) ?? 0) + 1
      routeCallCounts.set(route, callIndex)

      // Check failure injection BEFORE producing the response so the call is
      // recorded as a thrown error rather than a fake success.
      if (route.failOnCall === callIndex) {
        const err = route.failError ?? new Error('FakeTransport route failure')
        if (route.latencyMs) await delay(route.latencyMs)
        calls.push({
          request: req,
          response: null,
          thrownError: err,
          matchedRoute: route.label ?? '<unlabeled>',
          timestamp: Date.now(),
        })
        throw err
      }

      if (route.latencyMs) await delay(route.latencyMs)
      const resp = await resolveResponder(route.responder, req, callIndex)
      calls.push({
        request: req,
        response: resp,
        thrownError: null,
        matchedRoute: route.label ?? '<unlabeled>',
        timestamp: Date.now(),
      })
      return resp
    },

    addRoute(route: FakeRoute): void {
      routes.push(route)
    },

    whenUrl(url: string, responder: ResponseProducer, opts: Omit<FakeRoute, 'matcher' | 'responder'> = {}): void {
      routes.push({
        matcher: req => req.url === url,
        responder,
        label: opts.label ?? `URL ${url}`,
        latencyMs: opts.latencyMs,
        failOnCall: opts.failOnCall,
        failError: opts.failError,
      })
    },

    whenMethodAndPathPrefix(
      method: string,
      pathPrefix: string,
      responder: ResponseProducer,
      opts: Omit<FakeRoute, 'matcher' | 'responder'> = {},
    ): void {
      const upperMethod = method.toUpperCase()
      routes.push({
        matcher: req => req.method.toUpperCase() === upperMethod && req.url.startsWith(pathPrefix),
        responder,
        label: opts.label ?? `${upperMethod} ${pathPrefix}*`,
        latencyMs: opts.latencyMs,
        failOnCall: opts.failOnCall,
        failError: opts.failError,
      })
    },

    setDefaultResponse(resp: FakeResponse): void {
      defaultResponse = resp
    },

    setRateLimit(config: RateLimitConfig | null): void {
      rateLimit = config
      rateLimitWindowStart = Date.now()
      rateLimitCount = 0
    },

    reset(): void {
      routes.length = 0
      calls.length = 0
      routeCallCounts.clear()
      defaultResponse = DEFAULT_404
      rateLimit = null
      rateLimitWindowStart = 0
      rateLimitCount = 0
    },
  }

  return transport
}

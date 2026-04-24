/**
 * Tests for the FakeTransport helper. Validates that canned responses, route
 * matching, failure injection, latency, and rate-limit emulation behave the
 * way the test plan documents - every Phase 9-19 transport test relies on
 * these semantics being predictable.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFakeTransport, type FakeTransport, type FakeResponse } from './fakeTransport'

describe('createFakeTransport', () => {
  let transport: FakeTransport

  beforeEach(() => {
    transport = createFakeTransport()
  })

  describe('routing', () => {
    it('returns the default 404 when no route matches', async () => {
      const resp = await transport.request({ method: 'GET', url: '/unknown' })
      expect(resp.status).toBe(404)
    })

    it('whenUrl matches an exact URL', async () => {
      transport.whenUrl('/v1/customers', { status: 200, body: [] })
      const resp = await transport.request({ method: 'GET', url: '/v1/customers' })
      expect(resp.status).toBe(200)
      expect(resp.body).toEqual([])
    })

    it('whenUrl does not match a different URL', async () => {
      transport.whenUrl('/v1/customers', { status: 200, body: [] })
      const resp = await transport.request({ method: 'GET', url: '/v1/orders' })
      expect(resp.status).toBe(404)
    })

    it('whenMethodAndPathPrefix matches method + prefix', async () => {
      transport.whenMethodAndPathPrefix('GET', '/v1/customers', { status: 200, body: { ok: true } })
      const a = await transport.request({ method: 'GET', url: '/v1/customers' })
      const b = await transport.request({ method: 'GET', url: '/v1/customers/123' })
      const c = await transport.request({ method: 'POST', url: '/v1/customers' })
      expect(a.status).toBe(200)
      expect(b.status).toBe(200)
      expect(c.status).toBe(404)
    })

    it('routes are matched first-wins in registration order', async () => {
      transport.whenMethodAndPathPrefix('GET', '/v1', { status: 200, body: 'first' })
      transport.whenUrl('/v1/customers', { status: 200, body: 'second' })
      const resp = await transport.request({ method: 'GET', url: '/v1/customers' })
      expect(resp.body).toBe('first')
    })

    it('responder function receives the request and call index', async () => {
      const seen: Array<{ url: string; idx: number }> = []
      transport.whenMethodAndPathPrefix('GET', '/v1', (req, idx) => {
        seen.push({ url: req.url, idx })
        return { status: 200, body: { idx } }
      })
      const a = await transport.request({ method: 'GET', url: '/v1/a' })
      const b = await transport.request({ method: 'GET', url: '/v1/b' })
      expect(seen).toEqual([{ url: '/v1/a', idx: 1 }, { url: '/v1/b', idx: 2 }])
      expect((a.body as { idx: number }).idx).toBe(1)
      expect((b.body as { idx: number }).idx).toBe(2)
    })
  })

  describe('default response override', () => {
    it('setDefaultResponse changes the no-match response', async () => {
      transport.setDefaultResponse({ status: 418, body: { teapot: true } })
      const resp = await transport.request({ method: 'GET', url: '/anything' })
      expect(resp.status).toBe(418)
      expect((resp.body as { teapot: boolean }).teapot).toBe(true)
    })
  })

  describe('failure injection', () => {
    it('failOnCall throws on the configured call index', async () => {
      transport.addRoute({
        matcher: req => req.url === '/v1/flaky',
        responder: { status: 200, body: 'ok' },
        failOnCall: 2,
        failError: new Error('boom'),
      })
      // First call succeeds
      const a = await transport.request({ method: 'GET', url: '/v1/flaky' })
      expect(a.status).toBe(200)
      // Second call throws
      await expect(transport.request({ method: 'GET', url: '/v1/flaky' })).rejects.toThrow('boom')
      // Third call succeeds again (only the 2nd was poisoned)
      const c = await transport.request({ method: 'GET', url: '/v1/flaky' })
      expect(c.status).toBe(200)
    })

    it('failOnCall uses a default error when none provided', async () => {
      transport.addRoute({
        matcher: () => true,
        responder: { status: 200, body: 'ok' },
        failOnCall: 1,
      })
      await expect(transport.request({ method: 'GET', url: '/anything' })).rejects.toThrow(/FakeTransport/)
    })

    it('thrown calls are recorded in the call log', async () => {
      transport.addRoute({
        matcher: () => true,
        responder: { status: 200, body: 'ok' },
        failOnCall: 1,
      })
      await expect(transport.request({ method: 'GET', url: '/x' })).rejects.toThrow()
      expect(transport.calls).toHaveLength(1)
      expect(transport.calls[0]!.thrownError).toBeTruthy()
      expect(transport.calls[0]!.response).toBeNull()
    })
  })

  describe('latency', () => {
    it('latencyMs delays the response', async () => {
      vi.useFakeTimers()
      transport.addRoute({
        matcher: () => true,
        responder: { status: 200, body: 'ok' },
        latencyMs: 100,
      })

      let resolved = false
      const promise = transport.request({ method: 'GET', url: '/x' }).then(() => { resolved = true })

      // Advance the timer by half - should NOT have resolved yet
      await vi.advanceTimersByTimeAsync(50)
      expect(resolved).toBe(false)

      // Advance to full latency - should resolve now
      await vi.advanceTimersByTimeAsync(50)
      await promise
      expect(resolved).toBe(true)

      vi.useRealTimers()
    })
  })

  describe('rate limiting', () => {
    it('rejects requests beyond the limit', async () => {
      transport.whenUrl('/v1/x', { status: 200, body: 'ok' })
      transport.setRateLimit({ requestsPerWindow: 2, windowMs: 1000 })

      const a = await transport.request({ method: 'GET', url: '/v1/x' })
      const b = await transport.request({ method: 'GET', url: '/v1/x' })
      const c = await transport.request({ method: 'GET', url: '/v1/x' })

      expect(a.status).toBe(200)
      expect(b.status).toBe(200)
      expect(c.status).toBe(429)
    })

    it('rate-limited responses are recorded as calls', async () => {
      transport.whenUrl('/v1/x', { status: 200, body: 'ok' })
      transport.setRateLimit({ requestsPerWindow: 1, windowMs: 1000 })
      await transport.request({ method: 'GET', url: '/v1/x' })
      await transport.request({ method: 'GET', url: '/v1/x' })
      expect(transport.callCount).toBe(2)
      expect(transport.calls[1]!.matchedRoute).toBe('<rate-limited>')
    })

    it('window resets after windowMs', async () => {
      vi.useFakeTimers()
      transport.whenUrl('/v1/x', { status: 200, body: 'ok' })
      transport.setRateLimit({ requestsPerWindow: 1, windowMs: 1000 })

      const a = await transport.request({ method: 'GET', url: '/v1/x' })
      expect(a.status).toBe(200)

      // Within window - rejected
      const b = await transport.request({ method: 'GET', url: '/v1/x' })
      expect(b.status).toBe(429)

      // Advance past window - should succeed again
      vi.advanceTimersByTime(1100)
      const c = await transport.request({ method: 'GET', url: '/v1/x' })
      expect(c.status).toBe(200)

      vi.useRealTimers()
    })

    it('custom reject status and body', async () => {
      transport.whenUrl('/v1/x', { status: 200, body: 'ok' })
      transport.setRateLimit({
        requestsPerWindow: 0,
        windowMs: 1000,
        rejectStatus: 503,
        rejectBody: { error: 'too_busy' },
      })
      const resp = await transport.request({ method: 'GET', url: '/v1/x' })
      expect(resp.status).toBe(503)
      expect((resp.body as { error: string }).error).toBe('too_busy')
    })

    it('setRateLimit(null) disables rate limiting', async () => {
      transport.whenUrl('/v1/x', { status: 200, body: 'ok' })
      transport.setRateLimit({ requestsPerWindow: 0, windowMs: 1000 })
      const a = await transport.request({ method: 'GET', url: '/v1/x' })
      expect(a.status).toBe(429)
      transport.setRateLimit(null)
      const b = await transport.request({ method: 'GET', url: '/v1/x' })
      expect(b.status).toBe(200)
    })
  })

  describe('call log', () => {
    it('records the matched route label', async () => {
      transport.whenUrl('/v1/customers', { status: 200, body: [] }, { label: 'list-customers' })
      await transport.request({ method: 'GET', url: '/v1/customers' })
      expect(transport.calls[0]!.matchedRoute).toBe('list-customers')
    })

    it('records calls in order', async () => {
      transport.whenUrl('/a', { status: 200, body: 'a' })
      transport.whenUrl('/b', { status: 200, body: 'b' })
      await transport.request({ method: 'GET', url: '/a' })
      await transport.request({ method: 'GET', url: '/b' })
      await transport.request({ method: 'GET', url: '/a' })
      expect(transport.calls.map(c => c.request.url)).toEqual(['/a', '/b', '/a'])
    })

    it('callCount mirrors calls.length', async () => {
      transport.whenUrl('/x', { status: 200, body: '' })
      await transport.request({ method: 'GET', url: '/x' })
      await transport.request({ method: 'GET', url: '/x' })
      expect(transport.callCount).toBe(2)
    })
  })

  describe('reset', () => {
    it('clears routes, calls, and rate-limit state', async () => {
      transport.whenUrl('/x', { status: 200, body: 'ok' })
      transport.setRateLimit({ requestsPerWindow: 1, windowMs: 1000 })
      await transport.request({ method: 'GET', url: '/x' })
      await transport.request({ method: 'GET', url: '/x' }) // rate-limited

      transport.reset()

      expect(transport.callCount).toBe(0)
      // Route is cleared - without it, the request hits the default 404
      const resp: FakeResponse = await transport.request({ method: 'GET', url: '/x' })
      expect(resp.status).toBe(404)
    })
  })
})

/**
 * FakeTransport tests -.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeTransport } from '../fakeTransport'
import type { TransportRequest, TransportDataSource } from '../types'

const STRIPE: TransportDataSource = {
  id: 'ds-stripe',
  transport: 'http',
  endpoint: 'https://api.stripe.com/v1',
  credentialRef: 'stripe_sk',
  authType: 'bearer',
}

function req(path: string | undefined, operation: TransportRequest['operation'] = 'read'): TransportRequest {
  return { dataSource: STRIPE, operation, path }
}

describe('FakeTransport - basic CRUD', () => {
  let transport: ReturnType<typeof createFakeTransport>

  beforeEach(() => {
    transport = createFakeTransport()
  })

  it('returns 404 when no response is seeded', async () => {
    const result = await transport.execute(req('/customers'))
    expect(result.success).toBe(false)
    expect(result.statusCode).toBe(404)
  })

  it('returns a seeded response for a specific path', async () => {
    transport.setResponse('/customers', {
      success: true,
      statusCode: 200,
      data: { object: 'list', data: [{ id: 'cus_1' }] },
    })
    const result = await transport.execute(req('/customers'))
    expect(result.success).toBe(true)
    expect(result.statusCode).toBe(200)
    expect((result.data as any).data[0].id).toBe('cus_1')
  })

  it('falls back to the default response when no path-specific match', async () => {
    transport.setResponse(undefined, {
      success: true,
      data: { fallback: true },
    })
    const result = await transport.execute(req('/unknown'))
    expect(result.success).toBe(true)
    expect((result.data as any).fallback).toBe(true)
  })

  it('prefers path-specific over default response', async () => {
    transport.setResponse(undefined, { success: true, data: { source: 'default' } })
    transport.setResponse('/specific', { success: true, data: { source: 'specific' } })
    const result = await transport.execute(req('/specific'))
    expect((result.data as any).source).toBe('specific')
  })
})

describe('FakeTransport - call tracking', () => {
  it('records every call in order', async () => {
    const t = createFakeTransport()
    t.setResponse(undefined, { success: true, data: {} })

    await t.execute(req('/a'))
    await t.execute(req('/b', 'write'))
    await t.execute(req('/c'))

    expect(t.calls).toHaveLength(3)
    expect(t.calls[0]!.request.path).toBe('/a')
    expect(t.calls[1]!.request.path).toBe('/b')
    expect(t.calls[1]!.request.operation).toBe('write')
    expect(t.calls[2]!.request.path).toBe('/c')
  })

  it('captures credentials passed to execute', async () => {
    const t = createFakeTransport()
    t.setResponse(undefined, { success: true, data: {} })

    await t.execute(req('/x'), { apiKey: 'sk_fake' })
    expect(t.calls[0]!.credentials).toEqual({ apiKey: 'sk_fake' })
  })

  it('reset clears call log and seeded responses', async () => {
    const t = createFakeTransport()
    t.setResponse('/x', { success: true, data: {} })
    await t.execute(req('/x'))
    expect(t.calls).toHaveLength(1)

    t.reset()
    expect(t.calls).toHaveLength(0)
    const result = await t.execute(req('/x'))
    expect(result.success).toBe(false) // response was cleared
  })
})

describe('FakeTransport - failure injection', () => {
  it('failNextN causes the next N calls to fail', async () => {
    const t = createFakeTransport()
    t.setResponse(undefined, { success: true, data: {} })
    t.failNextN(2, 'Network down')

    const r1 = await t.execute(req('/a'))
    const r2 = await t.execute(req('/b'))
    const r3 = await t.execute(req('/c'))

    expect(r1.success).toBe(false)
    expect(r1.error).toBe('Network down')
    expect(r2.success).toBe(false)
    expect(r3.success).toBe(true) // recovered
  })
})

describe('FakeTransport - testConnection', () => {
  it('defaults to success', async () => {
    const t = createFakeTransport()
    const result = await t.testConnection(STRIPE)
    expect(result.success).toBe(true)
  })

  it('returns the configured result', async () => {
    const t = createFakeTransport()
    t.setConnectionResult({ success: false, error: 'Auth failed' })
    const result = await t.testConnection(STRIPE)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Auth failed')
  })
})

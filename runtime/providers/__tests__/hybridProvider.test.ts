import { describe, it, expect } from 'vitest'
import { createHybridProvider } from '../hybridProvider'
import { createFakeTransport } from '../../transports/fakeTransport'
import type { DataSource } from '../../../types'

const CATALOG = { id: 'ds-catalog', name: 'Catalog API', driver: 'http' } as unknown as DataSource
const PRODUCT_MAPPING = {
  iterate: '$.products',
  identity: { externalId: '$.sku' },
  fields: { sku: '$.sku', name: '$.name', price: '$.price' },
}

function seqId() {
  let n = 0
  return () => `id-${++n}`
}

describe('HybridProvider - cache + TTL', () => {
  it('first read populates the cache and hits the transport', async () => {
    const transport = createFakeTransport()
    transport.setResponse('/products', {
      success: true,
      data: { products: [{ sku: 'A', name: 'Widget', price: 10 }] },
    })

    let now = 1000
    const provider = createHybridProvider({
      thingId: 'thing-product',
      transport,
      dataSource: CATALOG,
      mapping: PRODUCT_MAPPING,
      listPath: '/products',
      ttlMs: 5000,
      now: () => now,
      generateId: seqId(),
    })

    const result = await provider.findByThing('thing-product')
    expect(result).toHaveLength(1)
    expect(provider.cacheMisses()).toBe(1)
    expect(provider.cacheHits()).toBe(0)
    expect(transport.calls).toHaveLength(1)
  })

  it('subsequent reads within TTL hit the cache', async () => {
    const transport = createFakeTransport()
    transport.setResponse('/products', {
      success: true,
      data: { products: [{ sku: 'A', name: 'Widget', price: 10 }] },
    })

    let now = 1000
    const provider = createHybridProvider({
      thingId: 'thing-product',
      transport,
      dataSource: CATALOG,
      mapping: PRODUCT_MAPPING,
      listPath: '/products',
      ttlMs: 5000,
      now: () => now,
      generateId: seqId(),
    })

    await provider.findByThing('thing-product') // miss
    now += 1000 // still within TTL
    await provider.findByThing('thing-product') // hit
    await provider.findByThing('thing-product') // hit

    expect(provider.cacheMisses()).toBe(1)
    expect(provider.cacheHits()).toBe(2)
    expect(transport.calls).toHaveLength(1) // only the first call
  })

  it('read after TTL expiry triggers a refresh', async () => {
    const transport = createFakeTransport()
    transport.setResponse('/products', {
      success: true,
      data: { products: [{ sku: 'A', name: 'Widget', price: 10 }] },
    })

    let now = 1000
    const provider = createHybridProvider({
      thingId: 'thing-product',
      transport,
      dataSource: CATALOG,
      mapping: PRODUCT_MAPPING,
      listPath: '/products',
      ttlMs: 5000,
      now: () => now,
      generateId: seqId(),
    })

    await provider.findByThing('thing-product') // miss
    now += 10_000 // way past TTL
    await provider.findByThing('thing-product') // miss (stale)

    expect(provider.cacheMisses()).toBe(2)
    expect(transport.calls).toHaveLength(2)
  })

  it('invalidate() forces the next read to hit the transport', async () => {
    const transport = createFakeTransport()
    transport.setResponse('/products', {
      success: true,
      data: { products: [{ sku: 'A', name: 'Widget', price: 10 }] },
    })

    let now = 1000
    const provider = createHybridProvider({
      thingId: 'thing-product',
      transport,
      dataSource: CATALOG,
      mapping: PRODUCT_MAPPING,
      listPath: '/products',
      ttlMs: 60_000,
      now: () => now,
      generateId: seqId(),
    })

    await provider.findByThing('thing-product') // miss
    provider.invalidate()
    await provider.findByThing('thing-product') // miss (invalidated)

    expect(provider.cacheMisses()).toBe(2)
    expect(transport.calls).toHaveLength(2)
  })

  it('serves stale data when a refresh fails (degraded mode)', async () => {
    const transport = createFakeTransport()
    transport.setResponse('/products', {
      success: true,
      data: { products: [{ sku: 'A', name: 'Stale', price: 10 }] },
    })

    let now = 1000
    const provider = createHybridProvider({
      thingId: 'thing-product',
      transport,
      dataSource: CATALOG,
      mapping: PRODUCT_MAPPING,
      listPath: '/products',
      ttlMs: 5000,
      now: () => now,
      generateId: seqId(),
    })

    await provider.findByThing('thing-product') // miss - populates cache
    now += 10_000 // past TTL
    transport.failNextN(1, 'Refresh failed')

    // This call triggers a refresh that fails. The cache is NOT wiped -
    // stale data remains available.
    const result = await provider.findByThing('thing-product')
    expect(result).toHaveLength(1)
    expect(result[0]!.attributes.name?.value).toBe('Stale')
  })
})

describe('HybridProvider - writes go through + invalidate cache', () => {
  it('create writes to the transport and updates the cache', async () => {
    const transport = createFakeTransport()
    transport.setResponse('/products', { success: true, data: { ok: true } })

    const provider = createHybridProvider({
      thingId: 'thing-product',
      transport,
      dataSource: CATALOG,
      mapping: PRODUCT_MAPPING,
      listPath: '/products',
      generateId: seqId(),
    })

    const instance = await provider.create('thing-product', { sku: 'NEW', name: 'New', price: 20 })
    expect(instance.id).toBe('id-1')
    expect(instance.attributes.sku?.value).toBe('NEW')

    const writeCall = transport.calls.find(c => c.request.operation === 'write')
    expect(writeCall).toBeDefined()
  })

  it('update writes to the transport first, then updates the cache', async () => {
    const transport = createFakeTransport()
    transport.setResponse('/products', {
      success: true,
      data: { products: [{ sku: 'A', name: 'Widget', price: 10 }] },
    })

    const provider = createHybridProvider({
      thingId: 'thing-product',
      transport,
      dataSource: CATALOG,
      mapping: PRODUCT_MAPPING,
      listPath: '/products',
      ttlMs: 60_000,
      generateId: seqId(),
    })

    await provider.findByThing('thing-product') // populate
    const updated = await provider.update('id-1', { price: 15 })
    expect(updated.attributes.price?.value).toBe(15)

    const writeCall = transport.calls.find(c => c.request.operation === 'write')
    expect(writeCall).toBeDefined()
  })

  it('create throws when the transport write fails', async () => {
    const transport = createFakeTransport()
    transport.failNextN(1, 'Write blocked')

    const provider = createHybridProvider({
      thingId: 'thing-product',
      transport,
      dataSource: CATALOG,
      mapping: PRODUCT_MAPPING,
      listPath: '/products',
      generateId: seqId(),
    })

    await expect(provider.create('thing-product', { sku: 'X' })).rejects.toThrow(
      /create failed on transport/,
    )
  })
})

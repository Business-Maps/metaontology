/**
 * CompositeRepository tests - +
 * (Product as Synced) + (LTV as Computed) routes every call to the
 * right provider without the caller knowing which.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createCompositeRepository } from '../compositeRepository'
import { createLocalProvider } from '../providers/localProvider'
import { createSyncedProvider } from '../providers/syncedProvider'
import { createComputedProvider } from '../providers/computedProvider'
import { createFakeTransport } from '../transports/fakeTransport'
import { createFunctionRegistry } from '../functionRuntime'
import type { Function as BmFunction } from '../../types/context'
import type { TransportDataSource } from '../transports/types'
import type { PipelineMapping } from '../../types/context'
import { createEmptyRootContext } from '../../engine/apply'

const SHOPIFY: TransportDataSource = {
  id: 'ds-shopify',
  transport: 'http',
  endpoint: 'https://shop.example.com/api',
}

const PRODUCT_MAPPING: PipelineMapping = {
  iterate: '$.products',
  identity: { externalId: '$.sku' },
  fields: {
    sku: '$.sku',
    name: '$.name',
    price: '$.price',
  },
}

function seqId(prefix = 'id') {
  let n = 0
  return () => `${prefix}-${++n}`
}

function makeFn(id: string, source: string): BmFunction {
  return {
    uri: id,
    name: id,
    tags: [],
    description: '',
    signature: {
      parameters: [{ name: 'record', required: true, cardinality: 'scalar' }],
      returns: { cardinality: 'scalar' },
    },
    // Keep tests aligned with runtime safety defaults: computed Functions should
    // be expression bodies (TypeScript execution is opt-in).
    body: { kind: 'expression', source },
    stereotype: 'calculator',
    purity: 'pure',
    cacheable: false,
    visibility: 'internal',
  } as any as BmFunction
}

// ── Basic registration ────────────────────────────────────────────────────

describe('CompositeRepository - registration', () => {
  it('registers a provider and exposes it via getProvider', () => {
    const composite = createCompositeRepository()
    const local = createLocalProvider({ thingId: 'thing-customer' })

    composite.register({ thingId: 'thing-customer', provider: local })

    expect(composite.getProvider('thing-customer')).toBe(local)
    expect(composite.registeredThings()).toEqual(['thing-customer'])
  })

  it('throws on duplicate thingId', () => {
    const composite = createCompositeRepository()
    const a = createLocalProvider({ thingId: 'thing-customer' })
    const b = createLocalProvider({ thingId: 'thing-customer' })

    composite.register({ thingId: 'thing-customer', provider: a })
    expect(() => composite.register({ thingId: 'thing-customer', provider: b })).toThrow(
      /already registered/,
    )
  })

  it('getProvider returns null for an unregistered Thing', () => {
    const composite = createCompositeRepository()
    expect(composite.getProvider('thing-missing')).toBeNull()
  })
})

// ── Per-Thing routing ────────────────────────────────────────────────────

describe('CompositeRepository - per-Thing routing', () => {
  it('findByThing routes to the right provider', async () => {
    const composite = createCompositeRepository()
    const customers = createLocalProvider({ thingId: 'thing-customer', generateId: seqId('cus') })
    const orders = createLocalProvider({ thingId: 'thing-order', generateId: seqId('ord') })

    composite.register({ thingId: 'thing-customer', provider: customers })
    composite.register({ thingId: 'thing-order', provider: orders })

    await customers.create('thing-customer', { name: 'Alice' })
    await orders.create('thing-order', { total: 100 })
    await orders.create('thing-order', { total: 200 })

    const customerResults = await composite.findByThing('thing-customer')
    expect(customerResults).toHaveLength(1)
    expect(customerResults[0]!.thingId).toBe('thing-customer')

    const orderResults = await composite.findByThing('thing-order')
    expect(orderResults).toHaveLength(2)
    expect(orderResults.every(r => r.thingId === 'thing-order')).toBe(true)
  })

  it('findByThing returns empty for an unregistered Thing', async () => {
    const composite = createCompositeRepository()
    const result = await composite.findByThing('thing-missing')
    expect(result).toEqual([])
  })

  it('create routes by thingId', async () => {
    const composite = createCompositeRepository()
    const customers = createLocalProvider({ thingId: 'thing-customer', generateId: seqId('cus') })
    composite.register({ thingId: 'thing-customer', provider: customers })

    const instance = await composite.create('thing-customer', { name: 'Alice' })
    expect(instance.id).toBe('cus-1')
    expect(instance.thingId).toBe('thing-customer')
  })

  it('create throws when no provider is registered', async () => {
    const composite = createCompositeRepository()
    await expect(composite.create('thing-missing', {})).rejects.toThrow(/no provider registered/)
  })
})

// ── findById walks providers ─────────────────────────────────────────────

describe('CompositeRepository - findById walks providers', () => {
  it('returns the instance from whichever provider owns the id', async () => {
    const composite = createCompositeRepository()
    const customers = createLocalProvider({ thingId: 'thing-customer', generateId: seqId('cus') })
    const orders = createLocalProvider({ thingId: 'thing-order', generateId: seqId('ord') })

    composite.register({ thingId: 'thing-customer', provider: customers })
    composite.register({ thingId: 'thing-order', provider: orders })

    await customers.create('thing-customer', { name: 'Alice' }) // cus-1
    await orders.create('thing-order', { total: 100 })          // ord-1

    const cus = await composite.findById('cus-1')
    expect(cus?.thingId).toBe('thing-customer')

    const ord = await composite.findById('ord-1')
    expect(ord?.thingId).toBe('thing-order')
  })

  it('findById returns null when no provider has the id', async () => {
    const composite = createCompositeRepository()
    composite.register({
      thingId: 'thing-customer',
      provider: createLocalProvider({ thingId: 'thing-customer' }),
    })
    expect(await composite.findById('missing')).toBeNull()
  })

  it('update routes via findById to the right provider', async () => {
    const composite = createCompositeRepository()
    const customers = createLocalProvider({ thingId: 'thing-customer', generateId: seqId('cus') })
    const orders = createLocalProvider({ thingId: 'thing-order', generateId: seqId('ord') })

    composite.register({ thingId: 'thing-customer', provider: customers })
    composite.register({ thingId: 'thing-order', provider: orders })

    await customers.create('thing-customer', { name: 'Alice' }) // cus-1

    const updated = await composite.update('cus-1', { name: 'Alice Renamed' })
    expect(updated.attributes.name?.value).toBe('Alice Renamed')
  })

  it('delete routes via findById and removes from the right provider', async () => {
    const composite = createCompositeRepository()
    const customers = createLocalProvider({ thingId: 'thing-customer', generateId: seqId('cus') })
    composite.register({ thingId: 'thing-customer', provider: customers })

    await customers.create('thing-customer', { name: 'Alice' }) // cus-1
    await composite.delete('cus-1')
    expect(await composite.findById('cus-1')).toBeNull()
  })
})

// ── Mixed-flavor composite (the Phase 9 headline scenario) ───────────────

describe('CompositeRepository - mixed-flavor routing', () => {
  it('routes across Local + Synced + Computed providers', async () => {
    // 1. Local provider for Customer
    const customers = createLocalProvider({ thingId: 'thing-customer', generateId: seqId('cus') })
    await customers.create('thing-customer', { name: 'Alice', orderTotal: 100 })
    await customers.create('thing-customer', { name: 'Bob', orderTotal: 500 })

    // 2. Synced provider for Product (from Shopify via FakeTransport)
    const transport = createFakeTransport()
    transport.setResponse('/products', {
      success: true,
      data: {
        products: [
          { sku: 'P1', name: 'Widget', price: 10 },
          { sku: 'P2', name: 'Gadget', price: 25 },
        ],
      },
    })
    const products = createSyncedProvider({
      thingId: 'thing-product',
      transport,
      dataSource: SHOPIFY,
      mapping: PRODUCT_MAPPING,
      path: '/products',
      generateId: seqId('prod'),
    })
    await products.refresh()

    // 3. Computed provider for CustomerTier (from Customer via Function)
    const calculateTier = makeFn(
      'calculateTier',
      '({ name: record.name, tier: record.orderTotal >= 300 ? "gold" : "silver" })',
    )
    const registry = createFunctionRegistry([calculateTier])
    const tiers = createComputedProvider({
      thingId: 'thing-customer-tier',
      functionId: 'calculateTier',
      registry,
      source: customers,
      sourceThingId: 'thing-customer',
    })

    // 4. Compose all three
    const composite = createCompositeRepository()
    composite.register({ thingId: 'thing-customer', provider: customers })
    composite.register({ thingId: 'thing-product', provider: products })
    composite.register({ thingId: 'thing-customer-tier', provider: tiers })

    // Verify routing
    const customerResults = await composite.findByThing('thing-customer')
    expect(customerResults).toHaveLength(2)

    const productResults = await composite.findByThing('thing-product')
    expect(productResults).toHaveLength(2)
    expect(productResults[0]!.attributes.sku?.value).toBe('P1')

    const tierResults = await composite.findByThing('thing-customer-tier')
    expect(tierResults).toHaveLength(2)
    const bob = tierResults.find(t => t.attributes.name?.value === 'Bob')!
    expect(bob.attributes.tier?.value).toBe('gold')
    const alice = tierResults.find(t => t.attributes.name?.value === 'Alice')!
    expect(alice.attributes.tier?.value).toBe('silver')

    // Cross-Thing findById: same composite, different providers
    const cus1 = await composite.findById('cus-1')
    expect(cus1?.thingId).toBe('thing-customer')

    // query unions across all providers
    const allInstances = await composite.query({ op: 'base', objectType: 'thing-customer' } as any, createEmptyRootContext('Test'))
    // 2 customers + 2 products + 2 tiers = 6
    expect(allInstances.length).toBe(6)
  })
})

// ── Relationships ────────────────────────────────────────────────────────

describe('CompositeRepository - relationships', () => {
  let composite: ReturnType<typeof createCompositeRepository>
  let customers: ReturnType<typeof createLocalProvider>

  beforeEach(async () => {
    composite = createCompositeRepository()
    customers = createLocalProvider({ thingId: 'thing-customer', generateId: seqId('cus') })
    composite.register({ thingId: 'thing-customer', provider: customers })

    await customers.create('thing-customer', { name: 'Alice' }) // cus-1
    await customers.create('thing-customer', { name: 'Bob' })   // cus-2
  })

  it('createRelationship routes to the source provider', async () => {
    const rel = await composite.createRelationship('knows', 'cus-1', 'cus-2')
    expect(rel.sourceInstanceId).toBe('cus-1')
    expect(rel.targetInstanceId).toBe('cus-2')
  })

  it('findRelationships unions across providers', async () => {
    await composite.createRelationship('knows', 'cus-1', 'cus-2')
    const rels = await composite.findRelationships('cus-1')
    expect(rels).toHaveLength(1)
  })

  it('createRelationship throws when the source is not in any provider', async () => {
    await expect(composite.createRelationship('knows', 'missing', 'cus-2')).rejects.toThrow(
      /no provider owns source instance "missing"/,
    )
  })
})

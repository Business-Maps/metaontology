import { describe, it, expect } from 'vitest'
import { createSyncedProvider } from '../syncedProvider'
import { createFakeTransport } from '../../transports/fakeTransport'
import type { DataSource } from '../../../types'

const STRIPE = { id: 'ds-stripe', name: 'Stripe API', driver: 'http' } as unknown as DataSource
const CUSTOMER_MAPPING = {
  iterate: '$.data',
  identity: { externalId: '$.id' },
  fields: { email: '$.email', name: '$.name' },
}

function seqId() {
  let n = 0
  return () => `id-${++n}`
}

describe('SyncedProvider - refresh()', () => {
  it('pulls from the transport, maps, and populates the local mirror', async () => {
    const transport = createFakeTransport()
    transport.setResponse('/customers', {
      success: true,
      data: {
        data: [
          { id: 'cus_1', email: 'a@b.com', name: 'Alice' },
          { id: 'cus_2', email: 'b@b.com', name: 'Bob' },
        ],
      },
    })

    const provider = createSyncedProvider({
      thingId: 'thing-customer',
      transport,
      dataSource: STRIPE,
      mapping: CUSTOMER_MAPPING,
      path: '/customers',
      generateId: seqId(),
    })

    const result = await provider.refresh()
    expect(result.success).toBe(true)
    expect(result.instancesImported).toBe(2)
    expect(result.errors).toBe(0)

    const all = await provider.findByThing('thing-customer')
    expect(all).toHaveLength(2)
    expect(all.map(i => i.attributes.email?.value)).toEqual(['a@b.com', 'b@b.com'])
  })

  it('sets lastRefreshedAt on success', async () => {
    const transport = createFakeTransport()
    transport.setResponse('/customers', { success: true, data: { data: [] } })

    const provider = createSyncedProvider({
      thingId: 'thing-customer',
      transport,
      dataSource: STRIPE,
      mapping: CUSTOMER_MAPPING,
      path: '/customers',
    })

    expect(provider.lastRefreshedAt()).toBeNull()
    await provider.refresh()
    expect(provider.lastRefreshedAt()).toBeTruthy()
  })

  it('reports failure + leaves local mirror unchanged on transport error', async () => {
    const transport = createFakeTransport()
    transport.setResponse('/customers', { success: true, data: { data: [{ id: 'cus_1', email: 'a@b.com', name: 'Alice' }] } })

    const provider = createSyncedProvider({
      thingId: 'thing-customer',
      transport,
      dataSource: STRIPE,
      mapping: CUSTOMER_MAPPING,
      path: '/customers',
      generateId: seqId(),
    })

    // First refresh populates the mirror
    await provider.refresh()
    const before = await provider.findByThing('thing-customer')
    expect(before).toHaveLength(1)

    // Second refresh fails - old data must remain
    transport.failNextN(1, 'Network blip')
    const result = await provider.refresh()
    expect(result.success).toBe(false)

    const after = await provider.findByThing('thing-customer')
    expect(after).toHaveLength(1)
  })

  it('passes credentials through to the transport', async () => {
    const transport = createFakeTransport()
    transport.setResponse('/customers', { success: true, data: { data: [] } })

    const provider = createSyncedProvider({
      thingId: 'thing-customer',
      transport,
      dataSource: STRIPE,
      mapping: CUSTOMER_MAPPING,
      path: '/customers',
      getCredentials: () => ({ apiKey: 'sk_fake' }),
    })

    await provider.refresh()
    expect(transport.calls[0]!.credentials).toEqual({ apiKey: 'sk_fake' })
  })
})

describe('SyncedProvider - local-only CRUD (Phase 9 baseline)', () => {
  it('create goes to the local mirror', async () => {
    const transport = createFakeTransport()
    const provider = createSyncedProvider({
      thingId: 'thing-customer',
      transport,
      dataSource: STRIPE,
      mapping: CUSTOMER_MAPPING,
      generateId: seqId(),
    })

    const instance = await provider.create('thing-customer', { email: 'local@x.com' })
    expect(instance.id).toBe('id-1')
    const found = await provider.findById('id-1')
    expect(found?.attributes.email?.value).toBe('local@x.com')
  })

  it('update modifies the local mirror', async () => {
    const transport = createFakeTransport()
    const provider = createSyncedProvider({
      thingId: 'thing-customer',
      transport,
      dataSource: STRIPE,
      mapping: CUSTOMER_MAPPING,
      generateId: seqId(),
    })
    await provider.create('thing-customer', { email: 'a@b.com' })
    await provider.update('id-1', { email: 'updated@b.com' })
    const found = await provider.findById('id-1')
    expect(found?.attributes.email?.value).toBe('updated@b.com')
  })

  it('delete removes from the local mirror', async () => {
    const transport = createFakeTransport()
    const provider = createSyncedProvider({
      thingId: 'thing-customer',
      transport,
      dataSource: STRIPE,
      mapping: CUSTOMER_MAPPING,
      generateId: seqId(),
    })
    await provider.create('thing-customer', { email: 'a@b.com' })
    await provider.delete('id-1')
    expect(await provider.findById('id-1')).toBeNull()
  })
})

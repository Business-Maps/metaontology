import { describe, it, expect } from 'vitest'
import { createVirtualProvider } from '../virtualProvider'
import { createFakeTransport } from '../../transports/fakeTransport'
import type { DataSource } from '../../../types'

const WAREHOUSE = { id: 'ds-warehouse', name: 'Warehouse DB', driver: 'postgres' } as unknown as DataSource
const INVENTORY_MAPPING = {
  iterate: '$.rows',
  identity: { externalId: '$.sku' },
  fields: { sku: '$.sku', quantity: '$.quantity', warehouse_id: '$.warehouse_id' },
}

describe('VirtualProvider tests', () => {
  it('findByThing fetches live data on every call', async () => {
    const transport = createFakeTransport()
    transport.setResponse('/inventory', {
      success: true,
      data: { rows: [{ sku: 'SKU-1', quantity: 10, warehouse_id: 'W1' }] },
    })

    const provider = createVirtualProvider({
      thingId: 'thing-inventory',
      transport,
      dataSource: WAREHOUSE,
      mapping: INVENTORY_MAPPING,
      listPath: '/inventory',
    })

    await provider.findByThing('thing-inventory')
    await provider.findByThing('thing-inventory')
    await provider.findByThing('thing-inventory')

    // Every call goes through the transport - no caching
    expect(transport.calls).toHaveLength(3)
  })

  it('findById uses itemPath when provided', async () => {
    const transport = createFakeTransport()
    transport.setResponse('/inventory/SKU-1', {
      success: true,
      data: { rows: [{ sku: 'SKU-1', quantity: 5, warehouse_id: 'W1' }] },
    })

    const provider = createVirtualProvider({
      thingId: 'thing-inventory',
      transport,
      dataSource: WAREHOUSE,
      mapping: INVENTORY_MAPPING,
      listPath: '/inventory',
      itemPath: id => `/inventory/${id}`,
    })

    const found = await provider.findById('SKU-1')
    expect(found).not.toBeNull()
    expect(found!.attributes.quantity?.value).toBe(5)
  })

  it('findById returns null when the transport returns failure', async () => {
    const transport = createFakeTransport()
    // No seeded response - transport will return 404

    const provider = createVirtualProvider({
      thingId: 'thing-inventory',
      transport,
      dataSource: WAREHOUSE,
      mapping: INVENTORY_MAPPING,
      listPath: '/inventory',
      itemPath: id => `/inventory/${id}`,
    })

    expect(await provider.findById('missing')).toBeNull()
  })

  it('findByThing returns empty array on transport failure', async () => {
    const transport = createFakeTransport()
    // No seeded response

    const provider = createVirtualProvider({
      thingId: 'thing-inventory',
      transport,
      dataSource: WAREHOUSE,
      mapping: INVENTORY_MAPPING,
      listPath: '/inventory',
    })

    const result = await provider.findByThing('thing-inventory')
    expect(result).toEqual([])
  })
})

describe('VirtualProvider - writes go straight to the transport', () => {
  it('create posts to the transport and maps the response back', async () => {
    const transport = createFakeTransport()
    transport.setResponse('/inventory', {
      success: true,
      data: { rows: [{ sku: 'NEW-1', quantity: 100, warehouse_id: 'W1' }] },
    })

    const provider = createVirtualProvider({
      thingId: 'thing-inventory',
      transport,
      dataSource: WAREHOUSE,
      mapping: INVENTORY_MAPPING,
      listPath: '/inventory',
    })

    const instance = await provider.create('thing-inventory', { sku: 'NEW-1', quantity: 100 })
    expect(instance.id).toBe('NEW-1')
    expect(instance.attributes.quantity?.value).toBe(100)
    expect(transport.calls).toHaveLength(1)
    expect(transport.calls[0]!.request.operation).toBe('write')
    expect(transport.calls[0]!.request.body).toEqual({ sku: 'NEW-1', quantity: 100 })
  })

  it('create throws when the transport fails', async () => {
    const transport = createFakeTransport()
    transport.failNextN(1, 'Server error')

    const provider = createVirtualProvider({
      thingId: 'thing-inventory',
      transport,
      dataSource: WAREHOUSE,
      mapping: INVENTORY_MAPPING,
      listPath: '/inventory',
    })

    await expect(provider.create('thing-inventory', { sku: 'x' })).rejects.toThrow(/create failed/)
  })

  it('delete issues a delete operation on the transport', async () => {
    const transport = createFakeTransport()
    transport.setResponse('/inventory/SKU-1', { success: true, data: null })

    const provider = createVirtualProvider({
      thingId: 'thing-inventory',
      transport,
      dataSource: WAREHOUSE,
      mapping: INVENTORY_MAPPING,
      listPath: '/inventory',
      itemPath: id => `/inventory/${id}`,
    })

    await provider.delete('SKU-1')
    expect(transport.calls[0]!.request.operation).toBe('delete')
    expect(transport.calls[0]!.request.path).toBe('/inventory/SKU-1')
  })
})

describe('VirtualProvider - no local relationships', () => {
  it('createRelationship throws (not supported)', async () => {
    const transport = createFakeTransport()
    const provider = createVirtualProvider({
      thingId: 'thing-inventory',
      transport,
      dataSource: WAREHOUSE,
      mapping: INVENTORY_MAPPING,
    })
    await expect(provider.createRelationship('pairedWith', 'a', 'b')).rejects.toThrow(
      /does not support relationships/,
    )
  })

  it('findRelationships returns empty', async () => {
    const transport = createFakeTransport()
    const provider = createVirtualProvider({
      thingId: 'thing-inventory',
      transport,
      dataSource: WAREHOUSE,
      mapping: INVENTORY_MAPPING,
    })
    expect(await provider.findRelationships('any')).toEqual([])
  })
})

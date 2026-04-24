import { describe, it, expect } from 'vitest'
import { generateDomainModelLayer } from '../domainLayer'
import type { RootContext } from '../../types/context'
import { createEmptyRootContext } from '../../engine/apply'

function createTestModel(): RootContext {
  const root = createEmptyRootContext('Nike')

  // Add a context
  root.contexts['ctx-retail'] = {
    uri: 'ctx-retail',
    name: 'Retail',
    description: 'Nike retail operations',
    parentUri: root.uri,
    facets: {
      things: [
        {
          uri: 'thing-product',
          name: 'Product',
          definition: 'A sellable item',
          attributes: [
            { name: 'name', type: 'text' },
            { name: 'price', type: 'decimal' },
            { name: 'category', type: 'enum', enumValues: ['shoes', 'apparel', 'accessories'] },
          ],
          rules: [],
          states: [],
        },
        {
          uri: 'thing-order',
          name: 'Order',
          definition: 'A customer purchase',
          attributes: [
            { name: 'total', type: 'money' },
            { name: 'status', type: 'enum', enumValues: ['pending', 'shipped', 'delivered'] },
          ],
          rules: [],
          states: [],
        },
      ] as any,
      personas: [
        { uri: 'persona-shopper', name: 'Shopper', personaType: 'customer', role: 'Buys products' },
      ] as any,
      actions: [
        { uri: 'action-browse', name: 'BrowseProducts', type: 'query', description: 'Search and filter products' },
        { uri: 'action-checkout', name: 'Checkout', type: 'command', description: 'Complete a purchase' },
      ] as any,
      workflows: [],
      interfaces: [],
      events: [
        { uri: 'event-placed', name: 'OrderPlaced', eventType: 'domain', payload: [] },
      ] as any,
      measures: [],
      ports: [],
    },
    symbols: [],
  }
  root.links = []

  return root
}

describe('generateDomainModelLayer', () => {
  const model = createTestModel()
  const files = generateDomainModelLayer(model, { layerName: 'nike', version: '1.0.0' })

  it('produces the expected number of files', () => {
    // model/root.ts, model/version.ts, types/(5), repository/(2), composables/(4), nuxt.config.ts = 14
    expect(files.length).toBe(14)
  })

  it('generates model/root.ts with MODEL export', () => {
    const root = files.find(f => f.path === 'model/root.ts')
    expect(root).toBeDefined()
    expect(root!.content).toContain('export const MODEL')
    expect(root!.content).toContain('Nike')
  })

  it('generates model/version.ts', () => {
    const ver = files.find(f => f.path === 'model/version.ts')
    expect(ver).toBeDefined()
    expect(ver!.content).toContain("'1.0.0'")
    expect(ver!.content).toContain("'Nike'")
  })

  it('generates types/entities.ts with interfaces', () => {
    const types = files.find(f => f.path === 'types/entities.ts')
    expect(types).toBeDefined()
    expect(types!.content).toContain('interface Product')
    expect(types!.content).toContain('interface Order')
  })

  it('generates types/schemas.ts with Zod schemas', () => {
    const schemas = files.find(f => f.path === 'types/schemas.ts')
    expect(schemas).toBeDefined()
    expect(schemas!.content).toContain('ProductSchema')
    expect(schemas!.content).toContain('OrderSchema')
    expect(schemas!.content).toContain("z.enum(['shoes', 'apparel', 'accessories'])")
  })

  it('generates types/operations.ts', () => {
    const ops = files.find(f => f.path === 'types/operations.ts')
    expect(ops).toBeDefined()
    // The action generator only produces output for actions with structured parameters/mutations.
    // For simple actions, it produces a header-only file - which is still valid.
    expect(ops!.content).toContain('Action functions')
  })

  it('generates types/events.ts from events', () => {
    const events = files.find(f => f.path === 'types/events.ts')
    expect(events).toBeDefined()
    expect(events!.content).toContain('OrderPlaced')
  })

  it('generates repository/types.ts with typed collections', () => {
    const repoTypes = files.find(f => f.path === 'repository/types.ts')
    expect(repoTypes).toBeDefined()
    expect(repoTypes!.content).toContain('NikeRepository')
    expect(repoTypes!.content).toContain('TypedCollection<Product>')
    expect(repoTypes!.content).toContain('TypedCollection<Order>')
    expect(repoTypes!.content).toContain('products: TypedCollection<Product>')
    expect(repoTypes!.content).toContain('orders: TypedCollection<Order>')
  })

  it('generates repository/factory.ts wiring thingIds', () => {
    const factory = files.find(f => f.path === 'repository/factory.ts')
    expect(factory).toBeDefined()
    expect(factory!.content).toContain('createNikeRepository')
    expect(factory!.content).toContain("thingId: 'thing-product'")
    expect(factory!.content).toContain("thingId: 'thing-order'")
    expect(factory!.content).toContain('ProductSchema')
    expect(factory!.content).toContain('OrderSchema')
  })

  it('generates composables with correct naming', () => {
    const model = files.find(f => f.path === 'composables/useNikeModel.ts')
    const repo = files.find(f => f.path === 'composables/useNikeRepository.ts')
    const triples = files.find(f => f.path === 'composables/useNikeTriples.ts')
    const query = files.find(f => f.path === 'composables/useNikeQuery.ts')

    expect(model).toBeDefined()
    expect(repo).toBeDefined()
    expect(triples).toBeDefined()
    expect(query).toBeDefined()

    expect(model!.content).toContain('useNikeModel')
    expect(repo!.content).toContain('useNikeRepository')
    expect(repo!.content).toContain('NikeRepository')
    expect(triples!.content).toContain('useNikeTriples')
    expect(triples!.content).toContain('createTripleIndex')
    expect(query!.content).toContain('useNikeQuery')
    expect(query!.content).toContain("fromEntity<Product>('Product')")
  })

  it('generates nuxt.config.ts extending ontology', () => {
    const config = files.find(f => f.path === 'nuxt.config.ts')
    expect(config).toBeDefined()
    expect(config!.content).toContain("extends: ['../ontology']")
  })

  it('handles empty model gracefully', () => {
    const empty = createEmptyRootContext('Empty')
    const emptyFiles = generateDomainModelLayer(empty, { layerName: 'empty' })
    expect(emptyFiles.length).toBe(14)
    const repoTypes = emptyFiles.find(f => f.path === 'repository/types.ts')
    expect(repoTypes!.content).toContain('EmptyRepository')
  })
})

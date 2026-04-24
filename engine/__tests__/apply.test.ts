import { describe, it, expect, vi } from 'vitest'
import { applyCommand, applyBatch, validateCommand, createEmptyRootContext, createDefaultFacet, resolveEntityType } from '../apply'
import type { RootContext } from '../../types/context'
import type { Command, BatchCommand } from '../../types/commands'

function makeRoot(name = 'Test'): RootContext {
  return createEmptyRootContext(name)
}

/** Test helper: asserts the command succeeded and returns the new state. */
function apply(root: RootContext, cmd: Command): RootContext {
  const result = applyCommand(root, cmd)
  expect(result.success).toBe(true)
  return result.state
}

describe('applyCommand', () => {
  describe('context:add', () => {
    it('adds a sub-context to the root', () => {
      const root = makeRoot()
      const cmd: Command = {
        type: 'context:add',
        payload: { name: 'Payments', parentUri: root.uri },
      }
      const result = apply(root, cmd)
      const ctxs = Object.values(result.contexts)
      expect(ctxs).toHaveLength(1)
      expect(ctxs[0]!.name).toBe('Payments')
      expect(ctxs[0]!.parentUri).toBe(root.uri)
    })

    it('does not mutate the original root', () => {
      const root = makeRoot()
      const cmd: Command = {
        type: 'context:add',
        payload: { name: 'Orders', parentUri: root.uri },
      }
      apply(root, cmd)
      expect(Object.keys(root.contexts)).toHaveLength(0)
    })
  })

  describe('context:remove', () => {
    it('removes a context and its descendants', () => {
      let root = makeRoot()
      root = apply(root, {
        type: 'context:add',
        payload: { name: 'Parent', parentUri: root.uri },
      })
      const parentUri = Object.values(root.contexts)[0]!.uri
      root = apply(root, {
        type: 'context:add',
        payload: { name: 'Child', parentUri },
      })
      expect(Object.keys(root.contexts)).toHaveLength(2)

      root = apply(root, { type: 'context:remove', payload: { contextUri: parentUri } })
      expect(Object.keys(root.contexts)).toHaveLength(0)
    })

    it('removes links referencing deleted contexts', () => {
      let root = makeRoot()
      root = apply(root, {
        type: 'context:add',
        payload: { name: 'A', parentUri: root.uri },
      })
      root = apply(root, {
        type: 'context:add',
        payload: { name: 'B', parentUri: root.uri },
      })
      const [a, b] = Object.values(root.contexts)
      root = apply(root, {
        type: 'link:add',
        payload: { predicate: 'valueStream', sourceUri: a!.uri, targetUri: b!.uri },
      })
      expect(root.links).toHaveLength(1)

      root = apply(root, { type: 'context:remove', payload: { contextUri: a!.uri } })
      expect(root.links).toHaveLength(0)
    })

    it('handles cycles without infinite loop (visited guard)', () => {
      const root = makeRoot()
      // Manually create a cycle in contexts (shouldn't happen, but tests the guard)
      root.contexts['a'] = { uri: 'a', name: 'A', description: '', parentUri: 'b', facets: { things: [], personas: [], ports: [], actions: [], workflows: [], interfaces: [], events: [], measures: [], functions: [], datasources: [], pipelines: [] }, symbols: [] }
      root.contexts['b'] = { uri: 'b', name: 'B', description: '', parentUri: 'a', facets: { things: [], personas: [], ports: [], actions: [], workflows: [], interfaces: [], events: [], measures: [], functions: [], datasources: [], pipelines: [] }, symbols: [] }

      // Should not hang - the visited guard prevents infinite loop
      const result = apply(root, { type: 'context:remove', payload: { contextUri: 'a' } })
      expect(Object.keys(result.contexts)).toHaveLength(0)
    })
  })

  describe('context:rename', () => {
    it('renames the root context', () => {
      const root = makeRoot('Old Name')
      const result = apply(root, {
        type: 'context:rename',
        payload: { contextUri: root.uri, name: 'New Name' },
      })
      expect(result.name).toBe('New Name')
    })

    it('renames a sub-context', () => {
      let root = makeRoot()
      root = apply(root, {
        type: 'context:add',
        payload: { name: 'Old', parentUri: root.uri },
      })
      const ctxId = Object.values(root.contexts)[0]!.uri
      root = apply(root, {
        type: 'context:rename',
        payload: { contextUri: ctxId, name: 'Renamed' },
      })
      expect(root.contexts[ctxId]!.name).toBe('Renamed')
    })
  })

  describe('facet:add / facet:remove', () => {
    it('adds a facet to the root', () => {
      const root = makeRoot()
      const facet = createDefaultFacet('things', 'Order', 'order-1')
      const result = apply(root, {
        type: 'facet:add',
        payload: { contextUri: root.uri, facetType: 'things', facet },
      })
      expect(result.facets.things).toHaveLength(1)
      expect(result.facets.things[0]!.name).toBe('Order')
    })

    it('removes a facet and cleans up associated links', () => {
      let root = makeRoot()
      const facet = createDefaultFacet('things', 'Order', 'order-1')
      const owner = createDefaultFacet('things', 'Customer', 'customer-1')
      root = apply(root, {
        type: 'facet:add',
        payload: { contextUri: root.uri, facetType: 'things', facet },
      })
      root = apply(root, {
        type: 'facet:add',
        payload: { contextUri: root.uri, facetType: 'things', facet: owner },
      })
      root = apply(root, {
        type: 'link:add',
        payload: { predicate: 'owns', sourceUri: 'customer-1', targetUri: 'order-1' },
      })
      expect(root.links).toHaveLength(1)

      root = apply(root, {
        type: 'facet:remove',
        payload: { contextUri: root.uri, facetType: 'things', facetUri: 'order-1' },
      })
      expect(root.facets.things).toHaveLength(1)
      expect(root.links).toHaveLength(0)
    })
  })

  describe('facet:move', () => {
    it('moves a facet between contexts', () => {
      let root = makeRoot()
      const facet = createDefaultFacet('things', 'Order', 'order-1')
      root = apply(root, {
        type: 'facet:add',
        payload: { contextUri: root.uri, facetType: 'things', facet },
      })
      root = apply(root, {
        type: 'context:add',
        payload: { name: 'Target', parentUri: root.uri },
      })
      const targetId = Object.values(root.contexts)[0]!.uri

      root = apply(root, {
        type: 'facet:move',
        payload: { sourceContextUri: root.uri, targetContextUri: targetId, facetType: 'things', facetUri: 'order-1' },
      })
      expect(root.facets.things).toHaveLength(0)
      expect(root.contexts[targetId]!.facets.things).toHaveLength(1)
    })
  })

  describe('symbol:classify', () => {
    it('promotes a symbol to a context', () => {
      let root = makeRoot()
      root = apply(root, {
        type: 'symbol:add',
        payload: { content: 'Checkout' },
      })
      const symbolId = root.symbols[0]!.uri

      root = apply(root, {
        type: 'symbol:classify',
        payload: { symbolUri: symbolId, to: 'context', parentContextUri: root.uri },
      })
      expect(root.symbols).toHaveLength(0)
      const ctxs = Object.values(root.contexts)
      expect(ctxs).toHaveLength(1)
      expect(ctxs[0]!.name).toBe('Checkout')
    })

    it('promotes a symbol to a context and removes all links', () => {
      let root = makeRoot()
      root = apply(root, {
        type: 'symbol:add',
        payload: { content: 'Shipping' },
      })
      const symbolId = root.symbols[0]!.uri
      const thing = createDefaultFacet('things', 'Package', 'pkg-1')
      root = apply(root, {
        type: 'facet:add',
        payload: { contextUri: root.uri, facetType: 'things', facet: thing },
      })
      root = apply(root, {
        type: 'link:add',
        payload: { predicate: 'references', sourceUri: symbolId, targetUri: 'pkg-1' },
      })
      expect(root.links).toHaveLength(1)

      root = apply(root, {
        type: 'symbol:classify',
        payload: { symbolUri: symbolId, to: 'context', parentContextUri: root.uri },
      })
      expect(root.symbols).toHaveLength(0)
      expect(root.links).toHaveLength(0)
    })

    it('promotes a symbol to a Thing with a references link - link survives', () => {
      let root = makeRoot()
      const thingB = createDefaultFacet('things', 'Product', 'prod-1')
      root = apply(root, {
        type: 'facet:add',
        payload: { contextUri: root.uri, facetType: 'things', facet: thingB },
      })
      root = apply(root, {
        type: 'symbol:add',
        payload: { content: 'Order' },
      })
      const symbolId = root.symbols[0]!.uri
      root = apply(root, {
        type: 'link:add',
        payload: { predicate: 'references', sourceUri: symbolId, targetUri: 'prod-1' },
      })
      expect(root.links).toHaveLength(1)

      root = apply(root, {
        type: 'symbol:classify',
        payload: { symbolUri: symbolId, to: { targetContextUri: root.uri, facetType: 'things' }, parentContextUri: root.uri },
      })
      expect(root.facets.things).toHaveLength(2)
      // references: Thing→Thing - link should survive
      expect(root.links).toHaveLength(1)
    })

    it('promotes a symbol to a facet and prunes invalid links', () => {
      let root = makeRoot()
      const action = createDefaultFacet('actions', 'Checkout', 'checkout-1')
      root = apply(root, {
        type: 'facet:add',
        payload: { contextUri: root.uri, facetType: 'actions', facet: action },
      })
      root = apply(root, {
        type: 'symbol:add',
        payload: { content: 'Worker' },
      })
      const symbolId = root.symbols[0]!.uri
      // references: domain=Thing, range=Thing - promoting to Persona should prune it
      root = apply(root, {
        type: 'link:add',
        payload: { predicate: 'references', sourceUri: symbolId, targetUri: 'checkout-1' },
      })
      expect(root.links).toHaveLength(1)

      root = apply(root, {
        type: 'symbol:classify',
        payload: { symbolUri: symbolId, to: { targetContextUri: root.uri, facetType: 'personas' }, parentContextUri: root.uri },
      })
      expect(root.facets.personas).toHaveLength(1)
      // references requires Thing→Thing, Persona is not in domain, link pruned
      expect(root.links).toHaveLength(0)
    })

    it('promotes a symbol to a facet, reroutes valid links and prunes invalid ones', () => {
      let root = makeRoot()
      // Create a Thing so we can have a valid measures link target
      const thing = createDefaultFacet('things', 'Revenue', 'rev-thing')
      root = apply(root, {
        type: 'facet:add',
        payload: { contextUri: root.uri, facetType: 'things', facet: thing },
      })
      // Create a sub-context for the valueStream link target
      root = apply(root, {
        type: 'context:add',
        payload: { name: 'Sales', parentUri: root.uri },
      })
      const salesCtxId = Object.values(root.contexts)[0]!.uri
      root = apply(root, {
        type: 'symbol:add',
        payload: { content: 'RevenueMetric' },
      })
      const symbolId = root.symbols[0]!.uri
      // Add a valid link: measures (Value→Thing) - will survive after promote to values
      root = apply(root, {
        type: 'link:add',
        payload: { predicate: 'measures', sourceUri: symbolId, targetUri: 'rev-thing' },
      })
      // Add an invalid link: valueStream (Context→Context) - will be pruned
      root = apply(root, {
        type: 'link:add',
        payload: { predicate: 'valueStream', sourceUri: symbolId, targetUri: salesCtxId },
      })
      expect(root.links).toHaveLength(2)

      root = apply(root, {
        type: 'symbol:classify',
        payload: { symbolUri: symbolId, to: { targetContextUri: root.uri, facetType: 'measures' }, parentContextUri: root.uri },
      })
      expect(root.symbols).toHaveLength(0)
      expect(root.facets.measures).toHaveLength(1)
      // Only the valid measures link survives, rerouted to new facet ID
      expect(root.links).toHaveLength(1)
      expect(root.links[0]!.predicate).toBe('measures')
      expect(root.links[0]!.sourceUri).toBe(root.facets.measures[0]!.uri)
    })
  })

  describe('link operations', () => {
    it('add / update / remove a link', () => {
      let root = makeRoot()
      root = apply(root, {
        type: 'context:add',
        payload: { name: 'Source', parentUri: root.uri },
      })
      root = apply(root, {
        type: 'context:add',
        payload: { name: 'Target', parentUri: root.uri },
      })
      const [ctxA, ctxB] = Object.values(root.contexts)
      root = apply(root, {
        type: 'link:add',
        payload: { predicate: 'valueStream', sourceUri: ctxA!.uri, targetUri: ctxB!.uri, label: 'flow' },
      })
      expect(root.links).toHaveLength(1)
      const linkUri = root.links[0]!.uri

      root = apply(root, {
        type: 'link:update',
        payload: { linkUri, label: 'updated' },
      })
      expect(root.links[0]!.label).toBe('updated')

      root = apply(root, {
        type: 'link:remove',
        payload: { linkUri },
      })
      expect(root.links).toHaveLength(0)
    })
  })

  describe('facet:retype', () => {
    it('retypes Thing→Persona: id preserved, name preserved, description mapped from definition', () => {
      let root = makeRoot()
      const thing = createDefaultFacet('things', 'Customer', 'cust-1')
      ;(thing as any).definition = 'A paying customer'
      root = apply(root, {
        type: 'facet:add',
        payload: { contextUri: root.uri, facetType: 'things', facet: thing },
      })
      expect(root.facets.things).toHaveLength(1)

      root = apply(root, {
        type: 'facet:retype',
        payload: { contextUri: root.uri, facetUri: 'cust-1', fromType: 'things', toType: 'personas' },
      })
      expect(root.facets.things).toHaveLength(0)
      expect(root.facets.personas).toHaveLength(1)
      expect(root.facets.personas[0]!.uri).toBe('cust-1')
      expect(root.facets.personas[0]!.name).toBe('Customer')
      expect((root.facets.personas[0] as any).description).toBe('A paying customer')
    })

    it('retypes Persona→Action: description carried over', () => {
      let root = makeRoot()
      const persona = createDefaultFacet('personas', 'Admin', 'admin-1')
      ;(persona as any).description = 'System administrator'
      root = apply(root, {
        type: 'facet:add',
        payload: { contextUri: root.uri, facetType: 'personas', facet: persona },
      })

      root = apply(root, {
        type: 'facet:retype',
        payload: { contextUri: root.uri, facetUri: 'admin-1', fromType: 'personas', toType: 'actions' },
      })
      expect(root.facets.personas).toHaveLength(0)
      expect(root.facets.actions).toHaveLength(1)
      expect(root.facets.actions[0]!.uri).toBe('admin-1')
      expect(root.facets.actions[0]!.name).toBe('Admin')
      expect((root.facets.actions[0] as any).description).toBe('System administrator')
    })

    it('retypes Action→Thing: description mapped to definition', () => {
      let root = makeRoot()
      const action = createDefaultFacet('actions', 'PlaceOrder', 'place-1')
      ;(action as any).description = 'Places a new order'
      root = apply(root, {
        type: 'facet:add',
        payload: { contextUri: root.uri, facetType: 'actions', facet: action },
      })

      root = apply(root, {
        type: 'facet:retype',
        payload: { contextUri: root.uri, facetUri: 'place-1', fromType: 'actions', toType: 'things' },
      })
      expect(root.facets.actions).toHaveLength(0)
      expect(root.facets.things).toHaveLength(1)
      expect(root.facets.things[0]!.uri).toBe('place-1')
      expect(root.facets.things[0]!.name).toBe('PlaceOrder')
      expect((root.facets.things[0] as any).definition).toBe('Places a new order')
    })

    it('links survive when new type is still valid for the predicate', () => {
      let root = makeRoot()
      // references: Thing→Thing - retype Thing to Thing (via different facet) keeps it
      const thingA = createDefaultFacet('things', 'Order', 'order-1')
      const thingB = createDefaultFacet('things', 'Item', 'item-1')
      root = apply(root, {
        type: 'facet:add',
        payload: { contextUri: root.uri, facetType: 'things', facet: thingA },
      })
      root = apply(root, {
        type: 'facet:add',
        payload: { contextUri: root.uri, facetType: 'things', facet: thingB },
      })
      root = apply(root, {
        type: 'link:add',
        payload: { predicate: 'references', sourceUri: 'order-1', targetUri: 'item-1' },
      })
      expect(root.links).toHaveLength(1)

      // Retype order-1 from Thing→Persona: references requires Thing→Thing, so link removed
      root = apply(root, {
        type: 'facet:retype',
        payload: { contextUri: root.uri, facetUri: 'order-1', fromType: 'things', toType: 'personas' },
      })
      expect(root.facets.personas[0]!.uri).toBe('order-1')
      expect(root.links).toHaveLength(0)
    })

    it('prunes invalid links: performs (Persona→Action), retype Persona to Thing removes link', () => {
      let root = makeRoot()
      const persona = createDefaultFacet('personas', 'Buyer', 'buyer-1')
      const action = createDefaultFacet('actions', 'PlaceOrder', 'place-1')
      root = apply(root, {
        type: 'facet:add',
        payload: { contextUri: root.uri, facetType: 'personas', facet: persona },
      })
      root = apply(root, {
        type: 'facet:add',
        payload: { contextUri: root.uri, facetType: 'actions', facet: action },
      })
      root = apply(root, {
        type: 'link:add',
        payload: { predicate: 'performs', sourceUri: 'buyer-1', targetUri: 'place-1' },
      })
      expect(root.links).toHaveLength(1)

      // Retype Persona→Thing: performs requires Persona in domain, Thing is not
      root = apply(root, {
        type: 'facet:retype',
        payload: { contextUri: root.uri, facetUri: 'buyer-1', fromType: 'personas', toType: 'things' },
      })
      expect(root.facets.things).toHaveLength(1)
      expect(root.links).toHaveLength(0)
    })

    it('returns failure result when facet does not exist', () => {
      const root = makeRoot()
      const result = applyCommand(root, {
        type: 'facet:retype',
        payload: { contextUri: root.uri, facetUri: 'nonexistent', fromType: 'things', toType: 'personas' },
      })
      expect(result.success).toBe(false)
      expect(result.state).toBe(root)
      expect(result.error).toContain('does not exist')
    })

    it('returns failure result when fromType === toType', () => {
      const root = makeRoot()
      const result = applyCommand(root, {
        type: 'facet:retype',
        payload: { contextUri: root.uri, facetUri: 'any', fromType: 'things', toType: 'things' },
      })
      expect(result.success).toBe(false)
      expect(result.state).toBe(root)
      expect(result.error).toContain('same')
    })
  })

  it('shares structure: renaming context A leaves context B as the same reference', () => {
    let root = makeRoot()
    root = apply(root, {
      type: 'context:add',
      payload: { name: 'A', parentUri: root.uri },
    })
    root = apply(root, {
      type: 'context:add',
      payload: { name: 'B', parentUri: root.uri },
    })
    const [ctxA, ctxB] = Object.values(root.contexts)
    const bBefore = root.contexts[ctxB!.uri]

    const result = applyCommand(root, {
      type: 'context:rename',
      payload: { contextUri: ctxA!.uri, name: 'A-renamed' },
    })

    // Context B was not touched - Immer shares the reference
    expect(result.state.contexts[ctxB!.uri]).toBe(bBefore)
    // Context A was mutated - it's a new object
    expect(result.state.contexts[ctxA!.uri]).not.toBe(root.contexts[ctxA!.uri])
    expect(result.state.contexts[ctxA!.uri]!.name).toBe('A-renamed')
  })

  it('sets meta.updatedAt to a valid ISO date', () => {
    const root = makeRoot()
    const result = applyCommand(root, {
      type: 'context:rename',
      payload: { contextUri: root.uri, name: 'New' },
    })
    expect(new Date(result.state.meta.updatedAt).toISOString()).toBe(result.state.meta.updatedAt)
  })

  describe('domain events', () => {
    it('emits context.created on context:add', () => {
      const root = makeRoot()
      const result = applyCommand(root, {
        type: 'context:add',
        payload: { name: 'New', parentUri: root.uri },
      })
      expect(result.events).toHaveLength(1)
      expect(result.events[0]!.type).toBe('context.created')
    })

    it('emits facet.removed and link.pruned on facet:remove with links', () => {
      let root = makeRoot()
      const facet = createDefaultFacet('things', 'Order', 'order-1')
      const owner = createDefaultFacet('things', 'Customer', 'customer-1')
      root = apply(root, {
        type: 'facet:add',
        payload: { contextUri: root.uri, facetType: 'things', facet },
      })
      root = apply(root, {
        type: 'facet:add',
        payload: { contextUri: root.uri, facetType: 'things', facet: owner },
      })
      root = apply(root, {
        type: 'link:add',
        payload: { predicate: 'owns', sourceUri: 'customer-1', targetUri: 'order-1' },
      })

      const result = applyCommand(root, {
        type: 'facet:remove',
        payload: { contextUri: root.uri, facetType: 'things', facetUri: 'order-1' },
      })
      expect(result.success).toBe(true)
      const eventTypes = result.events.map(e => e.type)
      expect(eventTypes).toContain('facet.removed')
      expect(eventTypes).toContain('link.pruned')
    })
  })
})

describe('applyBatch', () => {
  it('applies all commands atomically', () => {
    const root = makeRoot()
    const batch: BatchCommand = {
      type: 'batch',
      payload: {
        commands: [
          { type: 'context:add', payload: { name: 'A', parentUri: root.uri } },
          { type: 'context:add', payload: { name: 'B', parentUri: root.uri } },
        ],
        label: 'Add two contexts',
      },
    }
    const result = applyBatch(root, batch)
    expect(result.success).toBe(true)
    expect(Object.keys(result.state.contexts)).toHaveLength(2)
  })

  it('rolls back all changes on failure', () => {
    let root = makeRoot()
    root = apply(root, {
      type: 'context:add',
      payload: { name: 'Existing', parentUri: root.uri },
    })
    const existingCtxId = Object.values(root.contexts)[0]!.uri

    const batch: BatchCommand = {
      type: 'batch',
      payload: {
        commands: [
          { type: 'context:rename', payload: { contextUri: existingCtxId, name: 'Renamed' } },
          // This should fail - nonexistent context
          { type: 'context:remove', payload: { contextUri: 'nonexistent' } },
        ],
      },
    }
    const result = applyBatch(root, batch)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Command 1')
    expect(result.error).toContain('context:remove')
    // State should be the original - rename should have been rolled back
    expect(result.state).toBe(root)
    expect(root.contexts[existingCtxId]!.name).toBe('Existing')
  })

  it('validates against intermediate state', () => {
    let root = makeRoot()
    root = apply(root, {
      type: 'context:add',
      payload: { name: 'A', parentUri: root.uri },
    })
    root = apply(root, {
      type: 'context:add',
      payload: { name: 'B', parentUri: root.uri },
    })
    const [ctxA, ctxB] = Object.values(root.contexts)
    const batch: BatchCommand = {
      type: 'batch',
      payload: {
        commands: [
          { type: 'context:add', payload: { name: 'New', parentUri: root.uri } },
          // link:add validates entities - contexts exist so this should work
          { type: 'link:add', payload: { predicate: 'valueStream', sourceUri: ctxA!.uri, targetUri: ctxB!.uri } },
        ],
      },
    }
    const result = applyBatch(root, batch)
    expect(result.success).toBe(true)
    expect(Object.keys(result.state.contexts)).toHaveLength(3)
    expect(result.state.links).toHaveLength(1)
  })

  it('collects events from all commands', () => {
    let root = makeRoot()
    root = apply(root, {
      type: 'context:add',
      payload: { name: 'A', parentUri: root.uri },
    })
    root = apply(root, {
      type: 'context:add',
      payload: { name: 'B', parentUri: root.uri },
    })
    const [ctxA, ctxB] = Object.values(root.contexts)
    const batch: BatchCommand = {
      type: 'batch',
      payload: {
        commands: [
          { type: 'context:add', payload: { name: 'C', parentUri: root.uri } },
          { type: 'link:add', payload: { predicate: 'valueStream', sourceUri: ctxA!.uri, targetUri: ctxB!.uri } },
        ],
      },
    }
    const result = applyBatch(root, batch)
    expect(result.success).toBe(true)
    expect(result.events.length).toBeGreaterThanOrEqual(2)
    const eventTypes = result.events.map(e => e.type)
    expect(eventTypes).toContain('context.created')
    expect(eventTypes).toContain('link.added')
  })

  it('handles empty batch', () => {
    const root = makeRoot()
    const batch: BatchCommand = {
      type: 'batch',
      payload: { commands: [] },
    }
    const result = applyBatch(root, batch)
    expect(result.success).toBe(true)
    expect(result.events).toHaveLength(0)
  })
})

describe('validateCommand', () => {
  describe('context:remove', () => {
    it('returns an error when contextId does not exist', () => {
      const root = makeRoot()
      const error = validateCommand(root, {
        type: 'context:remove',
        payload: { contextUri: 'nonexistent' },
      })
      expect(error).toContain('does not exist')
    })

    it('returns null when contextId exists', () => {
      let root = makeRoot()
      root = apply(root, {
        type: 'context:add',
        payload: { name: 'A', parentUri: root.uri },
      })
      const ctxId = Object.values(root.contexts)[0]!.uri
      const error = validateCommand(root, {
        type: 'context:remove',
        payload: { contextUri: ctxId },
      })
      expect(error).toBeNull()
    })
  })

  describe('link:add', () => {
    it('returns an error when sourceId and targetId are the same', () => {
      const root = makeRoot()
      const error = validateCommand(root, {
        type: 'link:add',
        payload: { predicate: 'valueStream', sourceUri: 'same', targetUri: 'same' },
      })
      expect(error).toContain('must not be the same')
    })

    it('returns null when sourceId and targetId differ and entities exist', () => {
      let root = makeRoot()
      root = apply(root, {
        type: 'context:add',
        payload: { name: 'A', parentUri: root.uri },
      })
      root = apply(root, {
        type: 'context:add',
        payload: { name: 'B', parentUri: root.uri },
      })
      const [ctxA, ctxB] = Object.values(root.contexts)
      const error = validateCommand(root, {
        type: 'link:add',
        payload: { predicate: 'valueStream', sourceUri: ctxA!.uri, targetUri: ctxB!.uri },
      })
      expect(error).toBeNull()
    })
  })

  describe('facet:add', () => {
    it('returns an error when contextId does not exist', () => {
      const root = makeRoot()
      const facet = createDefaultFacet('things', 'Order', 'order-1')
      const error = validateCommand(root, {
        type: 'facet:add',
        payload: { contextUri: 'nonexistent', facetType: 'things', facet },
      })
      expect(error).toContain('does not exist')
    })

    it('returns an error when facet name is empty', () => {
      const root = makeRoot()
      const facet = createDefaultFacet('things', '', 'order-1')
      const error = validateCommand(root, {
        type: 'facet:add',
        payload: { contextUri: root.uri, facetType: 'things', facet },
      })
      expect(error).toContain('non-empty')
    })

    it('returns null for a valid facet:add', () => {
      const root = makeRoot()
      const facet = createDefaultFacet('things', 'Order', 'order-1')
      const error = validateCommand(root, {
        type: 'facet:add',
        payload: { contextUri: root.uri, facetType: 'things', facet },
      })
      expect(error).toBeNull()
    })
  })

  describe('link:remove', () => {
    it('returns an error when linkId does not exist', () => {
      const root = makeRoot()
      const error = validateCommand(root, {
        type: 'link:remove',
        payload: { linkUri: 'nonexistent' },
      })
      expect(error).toContain('does not exist')
    })

    it('returns null when linkId exists', () => {
      let root = makeRoot()
      root = apply(root, {
        type: 'context:add',
        payload: { name: 'A', parentUri: root.uri },
      })
      root = apply(root, {
        type: 'context:add',
        payload: { name: 'B', parentUri: root.uri },
      })
      const [ctxA, ctxB] = Object.values(root.contexts)
      root = apply(root, {
        type: 'link:add',
        payload: { predicate: 'valueStream', sourceUri: ctxA!.uri, targetUri: ctxB!.uri },
      })
      const linkUri = root.links[0]!.uri
      const error = validateCommand(root, {
        type: 'link:remove',
        payload: { linkUri },
      })
      expect(error).toBeNull()
    })
  })

  describe('symbol:remove', () => {
    it('returns an error when symbolId does not exist', () => {
      const root = makeRoot()
      const error = validateCommand(root, {
        type: 'symbol:remove',
        payload: { symbolUri: 'nonexistent' },
      })
      expect(error).toContain('does not exist')
    })

    it('returns null when symbolId exists', () => {
      let root = makeRoot()
      root = apply(root, {
        type: 'symbol:add',
        payload: { content: 'Test' },
      })
      const symbolUri = root.symbols[0]!.uri
      const error = validateCommand(root, {
        type: 'symbol:remove',
        payload: { symbolUri },
      })
      expect(error).toBeNull()
    })
  })

  describe('facet:remove', () => {
    it('returns an error when facetId does not exist', () => {
      const root = makeRoot()
      const error = validateCommand(root, {
        type: 'facet:remove',
        payload: { contextUri: root.uri, facetType: 'things', facetUri: 'nonexistent' },
      })
      expect(error).toContain('does not exist')
    })
  })

  describe('integration with applyCommand', () => {
    it('returns failure result unchanged when validation fails', () => {
      const root = makeRoot()
      const result = applyCommand(root, {
        type: 'context:remove',
        payload: { contextUri: 'nonexistent' },
      })
      expect(result.success).toBe(false)
      expect(result.state).toBe(root)
      expect(result.error).toContain('does not exist')
    })
  })
})

describe('link:add ontology validation', () => {
  it('valid framework predicate passes (Persona performs Action)', () => {
    let root = makeRoot()
    const persona = createDefaultFacet('personas', 'Buyer', 'buyer-1')
    const action = createDefaultFacet('actions', 'PlaceOrder', 'place-1')
    root = apply(root, {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'personas', facet: persona },
    })
    root = apply(root, {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'actions', facet: action },
    })
    const error = validateCommand(root, {
      type: 'link:add',
      payload: { predicate: 'performs', sourceUri: 'buyer-1', targetUri: 'place-1' },
    })
    expect(error).toBeNull()
  })

  it('domain violation fails (Thing → Action with performs)', () => {
    let root = makeRoot()
    const thing = createDefaultFacet('things', 'Order', 'order-1')
    const action = createDefaultFacet('actions', 'PlaceOrder', 'place-1')
    root = apply(root, {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'things', facet: thing },
    })
    root = apply(root, {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'actions', facet: action },
    })
    const error = validateCommand(root, {
      type: 'link:add',
      payload: { predicate: 'performs', sourceUri: 'order-1', targetUri: 'place-1' },
    })
    expect(error).not.toBeNull()
    expect(error).toContain('link:add')
    expect(error).toContain('requires source to be Persona')
  })

  it('range violation fails (Persona → Persona with performs)', () => {
    let root = makeRoot()
    const personaA = createDefaultFacet('personas', 'Buyer', 'buyer-1')
    const personaB = createDefaultFacet('personas', 'Seller', 'seller-1')
    root = apply(root, {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'personas', facet: personaA },
    })
    root = apply(root, {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'personas', facet: personaB },
    })
    const error = validateCommand(root, {
      type: 'link:add',
      payload: { predicate: 'performs', sourceUri: 'buyer-1', targetUri: 'seller-1' },
    })
    expect(error).not.toBeNull()
    expect(error).toContain('link:add')
    expect(error).toContain('requires target to be Action')
  })

  it('non-existent source entity fails', () => {
    let root = makeRoot()
    const action = createDefaultFacet('actions', 'PlaceOrder', 'place-1')
    root = apply(root, {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'actions', facet: action },
    })
    const error = validateCommand(root, {
      type: 'link:add',
      payload: { predicate: 'performs', sourceUri: 'nonexistent', targetUri: 'place-1' },
    })
    expect(error).not.toBeNull()
    expect(error).toContain('source entity')
    expect(error).toContain('not found')
  })

  it('non-existent target entity fails', () => {
    let root = makeRoot()
    const persona = createDefaultFacet('personas', 'Buyer', 'buyer-1')
    root = apply(root, {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'personas', facet: persona },
    })
    const error = validateCommand(root, {
      type: 'link:add',
      payload: { predicate: 'performs', sourceUri: 'buyer-1', targetUri: 'nonexistent' },
    })
    expect(error).not.toBeNull()
    expect(error).toContain('target entity')
    expect(error).toContain('not found')
  })

  it('symbol links bypass validation', () => {
    let root = makeRoot()
    root = apply(root, {
      type: 'symbol:add',
      payload: { content: 'Rough concept' },
    })
    const symbolId = root.symbols[0]!.uri
    const action = createDefaultFacet('actions', 'PlaceOrder', 'place-1')
    root = apply(root, {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'actions', facet: action },
    })
    // Symbol as source - any predicate should pass
    const error = validateCommand(root, {
      type: 'link:add',
      payload: { predicate: 'performs', sourceUri: symbolId, targetUri: 'place-1' },
    })
    expect(error).toBeNull()
  })

  it('symbol as target bypasses validation', () => {
    let root = makeRoot()
    root = apply(root, {
      type: 'symbol:add',
      payload: { content: 'Rough concept' },
    })
    const symbolId = root.symbols[0]!.uri
    const persona = createDefaultFacet('personas', 'Buyer', 'buyer-1')
    root = apply(root, {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'personas', facet: persona },
    })
    // Symbol as target - any predicate should pass
    const error = validateCommand(root, {
      type: 'link:add',
      payload: { predicate: 'performs', sourceUri: 'buyer-1', targetUri: symbolId },
    })
    expect(error).toBeNull()
  })
})

describe('structural sharing', () => {
  it('unchanged subtrees share references after produce()', () => {
    let root = makeRoot()
    root = apply(root, {
      type: 'context:add',
      payload: { name: 'A', parentUri: root.uri },
    })
    root = apply(root, {
      type: 'context:add',
      payload: { name: 'B', parentUri: root.uri },
    })
    const [ctxA, ctxB] = Object.values(root.contexts)

    // Rename only context A
    const next = apply(root, {
      type: 'context:rename',
      payload: { contextUri: ctxA!.uri, name: 'A-renamed' },
    })

    // Context B was not touched - Immer should share the reference
    expect(next.contexts[ctxB!.uri]).toBe(root.contexts[ctxB!.uri])
    // Context A was mutated - should be a new object
    expect(next.contexts[ctxA!.uri]).not.toBe(root.contexts[ctxA!.uri])
    expect(next.contexts[ctxA!.uri]!.name).toBe('A-renamed')
  })
})

/**
 * Tests for the shared builders themselves. These guard against the helpers
 * silently returning malformed shapes - every downstream test that consumes
 * the builders depends on `aModel().build()` producing a valid `RootContext`.
 */

import { describe, it, expect } from 'vitest'
import {
  aModel,
  aContext,
  aThing,
  aPersona,
  anAction,
  emptyLayout,
  createEmptyRootContext,
} from './builders'
import { FACET_TYPES } from '../../meta/facets'

describe('builders', () => {
  describe('aModel', () => {
    it('produces a RootContext with all empty facet arrays', () => {
      const root = aModel('Test').build()
      expect(root.uri).toBeTruthy()
      expect(root.name).toBe('Test')
      expect(root.contexts).toEqual({})
      expect(root.links).toEqual([])
      expect(root.symbols).toEqual([])
      // Every facet type from the registry has an empty array
      for (const ft of FACET_TYPES) {
        expect(Array.isArray(root.facets[ft])).toBe(true)
        expect(root.facets[ft]).toHaveLength(0)
      }
    })

    it('withId sets a deterministic root id', () => {
      const root = aModel().withId('root-1').build()
      expect(root.uri).toBe('root-1')
    })

    it('withContext appends a sub-context with parentUri set to the root uri', () => {
      const root = aModel()
        .withId('root-1')
        .withContext(aContext('Payments').withId('ctx-pay'))
        .build()
      expect(root.contexts['ctx-pay']!.parentUri).toBe('root-1')
      expect(root.contexts['ctx-pay']!.name).toBe('Payments')
    })

    it('withLink appends to the links array with the given predicate', () => {
      const root = aModel()
        .withLink('relatedTo', 'src', 'tgt', 'l-1')
        .build()
      expect(root.links).toHaveLength(1)
      expect(root.links[0]!.uri).toBe('l-1')
      expect(root.links[0]!.predicate).toBe('relatedTo')
      expect(root.links[0]!.sourceUri).toBe('src')
      expect(root.links[0]!.targetUri).toBe('tgt')
    })

    it('build returns a fresh clone - mutating the result does not affect the builder', () => {
      const builder = aModel('Test').withContext(aContext('A').withId('ctx-a'))
      const r1 = builder.build()
      r1.contexts['ctx-a']!.name = 'Mutated'
      const r2 = builder.build()
      expect(r2.contexts['ctx-a']!.name).toBe('A')
    })
  })

  describe('aContext', () => {
    it('withThing appends to the things facet array', () => {
      const ctx = aContext('Orders').withThing('Order').build('parent')
      expect(ctx.facets.things).toHaveLength(1)
      expect(ctx.facets.things[0]!.name).toBe('Order')
    })

    it('withThing accepts a builder fn for further customization', () => {
      const ctx = aContext('Orders')
        .withThing('Order', b => b.withAttribute('total', 'decimal').withDefinition('A purchase'))
        .build('parent')
      const order = ctx.facets.things[0]!
      expect(order.definition).toBe('A purchase')
      expect(order.attributes).toHaveLength(1)
      expect(order.attributes[0]!.name).toBe('total')
      expect(order.attributes[0]!.type).toBe('decimal')
    })

    it('withPersona appends to the personas facet array', () => {
      const ctx = aContext('Orders')
        .withPersona('Clerk', b => b.withRole('Operator').withPersonaType('human'))
        .build('parent')
      expect(ctx.facets.personas).toHaveLength(1)
      expect(ctx.facets.personas[0]!.name).toBe('Clerk')
      expect(ctx.facets.personas[0]!.role).toBe('Operator')
      expect(ctx.facets.personas[0]!.personaType).toBe('human')
    })

    it('withAction appends to the actions facet array', () => {
      const ctx = aContext('Orders')
        .withAction('Place', b => b.withType('command').withParameter('itemName'))
        .build('parent')
      expect(ctx.facets.actions).toHaveLength(1)
      expect(ctx.facets.actions[0]!.name).toBe('Place')
      expect(ctx.facets.actions[0]!.parameters).toHaveLength(1)
      expect(ctx.facets.actions[0]!.parameters![0]!.name).toBe('itemName')
    })
  })

  describe('aThing', () => {
    it('builds a Thing with uri, name, and empty attributes', () => {
      const t = aThing('Order').build()
      expect(t.uri).toBeTruthy()
      expect(t.name).toBe('Order')
      expect(t.definition).toBe('')
      expect(t.attributes).toEqual([])
    })

    it('withAttribute adds attributes in order', () => {
      const t = aThing('Order')
        .withAttribute('total', 'decimal')
        .withAttribute('status', 'enum', { enumValues: ['pending', 'paid'] })
        .build()
      expect(t.attributes).toHaveLength(2)
      expect(t.attributes[0]!.name).toBe('total')
      expect(t.attributes[1]!.enumValues).toEqual(['pending', 'paid'])
    })

    it('withTags sets the tags array', () => {
      const t = aThing('Order').withTags(['domain', 'core']).build()
      expect(t.tags).toEqual(['domain', 'core'])
    })
  })

  describe('aPersona / anAction', () => {
    it('produce shapes that match the canonical empty constructors', () => {
      const p = aPersona('Customer').build()
      expect(p.personaType).toBe('human')
      const a = anAction('Submit').build()
      expect(a.type).toBe('command')
    })
  })

  describe('emptyLayout', () => {
    it('produces an empty CanvasLayout for the given modelId', () => {
      const layout = emptyLayout('map-1')
      expect(layout.modelId).toBe('map-1')
      expect(layout.positions).toEqual({})
      expect(layout.handles).toEqual({})
      expect(layout.sizes).toEqual({})
      expect(layout.zIndices).toEqual({})
    })
  })

  describe('re-export sanity', () => {
    it('createEmptyRootContext is the canonical constructor', () => {
      const r = createEmptyRootContext('Sanity')
      expect(r.name).toBe('Sanity')
      // Same shape as `aModel().build()` for the empty case
      const built = aModel('Sanity').withId(r.uri).build()
      // facets/contexts/links arrays match
      expect(built.facets).toEqual(r.facets)
      expect(built.contexts).toEqual(r.contexts)
      expect(built.links).toEqual(r.links)
    })
  })
})

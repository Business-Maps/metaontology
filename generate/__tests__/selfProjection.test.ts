import { describe, it, expect } from 'vitest'
import { projectMetaontologyAsContext } from '../selfProjection'
import { ENTITY_CLASSES, PREDICATES, DATATYPE_REGISTRY, BUILTIN_VALUE_TYPES } from '../../meta/ontology'

describe('projectMetaontologyAsContext', () => {
  const result = projectMetaontologyAsContext('test-parent')

  it('returns 5 contexts (root + 4 children)', () => {
    expect(Object.keys(result.contexts)).toHaveLength(5)
  })

  it('root context has correct parentId', () => {
    const root = result.contexts['meta-root']
    expect(root).toBeDefined()
    expect(root.parentUri).toBe('test-parent')
  })

  it('child contexts parent to the metaontology root', () => {
    const childIds = ['meta-ctx-entity-classes', 'meta-ctx-predicates', 'meta-ctx-datatypes', 'meta-ctx-value-types']
    for (const id of childIds) {
      expect(result.contexts[id]).toBeDefined()
      expect(result.contexts[id].parentUri).toBe('meta-root')
    }
  })

  it('entity classes context has one Thing per ENTITY_CLASSES entry', () => {
    const ctx = result.contexts['meta-ctx-entity-classes']
    const count = Object.keys(ENTITY_CLASSES).length
    expect(ctx.facets.things).toHaveLength(count)
  })

  it('predicates context has one Thing per PREDICATES entry', () => {
    const ctx = result.contexts['meta-ctx-predicates']
    const count = Object.keys(PREDICATES).length
    expect(ctx.facets.things).toHaveLength(count)
  })

  it('datatypes context has one Thing per DATATYPE_REGISTRY entry', () => {
    const ctx = result.contexts['meta-ctx-datatypes']
    expect(ctx.facets.things).toHaveLength(DATATYPE_REGISTRY.length)
  })

  it('value types context has one Thing per BUILTIN_VALUE_TYPES entry', () => {
    const ctx = result.contexts['meta-ctx-value-types']
    expect(ctx.facets.things).toHaveLength(BUILTIN_VALUE_TYPES.length)
  })

  it('all Things have required fields', () => {
    for (const ctx of Object.values(result.contexts) as any[]) {
      for (const thing of ctx.facets.things) {
        expect(thing.uri).toBeTruthy()
        expect(thing.name).toBeTruthy()
        expect(thing.definition).toBeTruthy()
        expect(thing.attributes).toBeInstanceOf(Array)
      }
    }
  })

  it('generates references links', () => {
    expect(result.links.length).toBeGreaterThan(0)
    for (const link of result.links) {
      expect(link.predicate).toBe('references')
      expect(link.sourceUri).toBeTruthy()
      expect(link.targetUri).toBeTruthy()
    }
  })

  it('all link sourceId/targetId reference valid Thing IDs', () => {
    const allThingIds = new Set<string>()
    for (const ctx of Object.values(result.contexts) as any[]) {
      for (const thing of ctx.facets.things) {
        allThingIds.add(thing.uri)
      }
    }
    for (const link of result.links) {
      expect(allThingIds.has(link.sourceUri), `sourceId ${link.sourceUri} not found`).toBe(true)
      expect(allThingIds.has(link.targetUri), `targetId ${link.targetUri} not found`).toBe(true)
    }
  })

  it('is idempotent', () => {
    const result2 = projectMetaontologyAsContext('test-parent')
    expect(Object.keys(result2.contexts)).toHaveLength(Object.keys(result.contexts).length)
    expect(result2.links).toHaveLength(result.links.length)
  })

  it('all contexts have empty non-things facet arrays', () => {
    for (const ctx of Object.values(result.contexts) as any[]) {
      expect(ctx.facets.personas).toHaveLength(0)
      expect(ctx.facets.actions).toHaveLength(0)
      expect(ctx.facets.workflows).toHaveLength(0)
      expect(ctx.facets.interfaces).toHaveLength(0)
      expect(ctx.facets.events).toHaveLength(0)
      expect(ctx.facets.measures).toHaveLength(0)
      expect(ctx.facets.ports).toHaveLength(0)
    }
  })
})

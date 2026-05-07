import { describe, it, expect } from 'vitest'
import { migrateModel } from '../pipeline'
import { CURRENT_SCHEMA_VERSION } from '../registry'
import { createEmptyRootContext } from '../../engine/apply'

/** Build a minimal v0 model (pre-migration era): no schemaVersion, missing symbols, legacy attribute types. */
function makeV0Model(): any {
  return {
    id: 'test-map',
    name: 'Test Map',
    description: '',
    facets: {
      things: [
        {
          id: 't1',
          name: 'Order',
          attributes: [
            { name: 'total', type: 'number' },
            { name: 'notes', type: 'other' },
            { name: 'email', type: 'email' },
          ],
        },
      ],
      personas: [],
      ports: [],
      actions: [],
      workflows: [],
      interfaces: [],
      events: [],
      measures: [],
    },
    contexts: {
      ctx1: {
        id: 'ctx1',
        name: 'Payments',
        description: '',
        parentId: 'test-map',
        facets: {
          things: [
            {
              id: 't2',
              name: 'Invoice',
              attributes: [{ name: 'amount', type: 'number' }],
            },
          ],
          personas: [],
          ports: [],
          actions: [],
          workflows: [],
          interfaces: [],
          events: [],
          measures: [],
        },
        // Note: no symbols[] - this is the gap the migration fixes
      },
    },
    links: [],
    meta: { createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
    // Note: no symbols[], no schemaVersion
  }
}

describe('migrateModel', () => {
  it('migrates a v0 model to current version', () => {
    const model = makeV0Model()
    migrateModel(model)

    expect(model.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('adds symbols[] to root and all contexts', () => {
    const model = makeV0Model()
    migrateModel(model)

    expect(model.symbols).toEqual([])
    expect(model.contexts.ctx1.symbols).toEqual([])
  })

  it('migrates legacy attribute types (number→decimal, other→text)', () => {
    const model = makeV0Model()
    migrateModel(model)

    const rootThing = model.facets.things[0]!
    expect(rootThing.attributes[0].type).toBe('decimal')
    expect(rootThing.attributes[1].type).toBe('text')
    expect(rootThing.attributes[2].type).toBe('email') // known type passes through

    const ctxThing = model.contexts.ctx1.facets.things[0]!
    expect(ctxThing.attributes[0].type).toBe('decimal')
  })

  it('is idempotent - running twice produces the same result', () => {
    const model = makeV0Model()
    migrateModel(model)
    const snapshot = JSON.stringify(model)

    migrateModel(model)
    expect(JSON.stringify(model)).toBe(snapshot)
  })

  it('skips migrations for already-current models', () => {
    const model = makeV0Model() as any
    model.schemaVersion = CURRENT_SCHEMA_VERSION
    model.symbols = [] // already has correct structure

    const snapshot = JSON.stringify(model)
    migrateModel(model)
    expect(JSON.stringify(model)).toBe(snapshot)
  })

  it('handles models with missing facets object', () => {
    const model = {
      id: 'bare',
      name: 'Bare Map',
      description: '',
      contexts: {},
      links: [],
      meta: { createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
    } as any

    migrateModel(model)

    expect(model.facets).toBeDefined()
    expect(Array.isArray(model.facets.things)).toBe(true)
    expect(Array.isArray(model.facets.personas)).toBe(true)
    expect(model.symbols).toEqual([])
    expect(model.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('handles models with missing top-level fields', () => {
    const model = {
      id: 'minimal',
      name: 'Minimal',
      description: '',
    } as any

    migrateModel(model)

    expect(model.contexts).toEqual({})
    expect(model.links).toEqual([])
    expect(model.meta).toBeDefined()
    expect(model.meta.createdAt).toBeDefined()
    expect(model.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('stamps schemaVersion on a freshly-created RootContext', () => {
    const root = createEmptyRootContext('Fresh') as any
    expect(root.schemaVersion).toBeUndefined()

    migrateModel(root)
    expect(root.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })
})

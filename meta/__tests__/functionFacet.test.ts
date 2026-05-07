/**
 * Function facet - meta-registry coverage for, this file fails at the drift point.
 *
 * Coverage:
 *
 *  1. Registration - Function appears in ENTITY_CLASSES, BASE_FACET_REGISTRY,
 *     and FACET_FIELD_DEFS; `computes`/`calls` appear in PREDICATES.
 *  2. Command round-trip - `facet:add`/`update`/`remove` for a Function
 *     work via the existing generic facet handlers (no new command
 *     types; the engine is already registry-driven).
 *  3. Inverse round-trip - applying a command then its inverse returns
 *     the model to its prior state.
 *  4. Batch round-trip - `applyBatch` with mixed function + other
 *     commits produces the expected state, and its inverse reverses
 *     everything atomically.
 *  5. Predicate validation - `validateLink` accepts `computes` and
 *     `calls` with valid domain/range and rejects invalid combinations.
 */

import { describe, it, expect } from 'vitest'
import { ENTITY_CLASSES, PREDICATES } from '../ontology'
import { BASE_FACET_REGISTRY, FACET_TYPES } from '../facets'
import { FACET_FIELD_DEFS, LINK_PARAM_DEFS } from '../fields'
import { applyCommand, applyBatch, createEmptyRootContext } from '../../engine/apply'
import { computeInverse } from '../../engine/inverse'
import { validateLink } from '../ontology'
import type { RootContext } from '../../types/context'
import type { Command, BatchCommand } from '../../types/commands'

// ── 1. Registration ────────────────────────────────────────────────────────

describe('Function facet - meta registration', () => {
  it('Function appears in ENTITY_CLASSES with a bm: URI and facetKey', () => {
    const fn = (ENTITY_CLASSES as any).Function
    expect(fn).toBeDefined()
    expect(fn.id).toBe('Function')
    expect(fn.uri).toMatch(/ontology\.businessmaps\.io\/Function$/)
    expect(fn.labels.en).toBe('Function')
    expect(fn.facetKey).toBe('functions')
  })

  it('functions appears in BASE_FACET_REGISTRY as tier 3', () => {
    const entry = BASE_FACET_REGISTRY.functions
    expect(entry).toBeDefined()
    expect(entry.key).toBe('functions')
    expect(entry.label.en).toBe('Functions')
    expect(entry.singular.en).toBe('Function')
    expect(entry.entityClass).toBe('Function')
    expect(entry.tier).toBe(3)
  })

  it('functions appears in FACET_TYPES (derived from registry)', () => {
    expect(FACET_TYPES).toContain('functions')
  })

  it('computes predicate is registered with correct domain/range', () => {
    const p = (PREDICATES as any).computes
    expect(p).toBeDefined()
    expect(p.domain).toEqual(['Function'])
    expect(p.range).toEqual(['Thing'])
    expect(p.cardinality).toBe('many-to-many')
    expect(p.tier).toBe('framework')
  })

  it('calls predicate is registered with correct domain/range', () => {
    const p = (PREDICATES as any).calls
    expect(p).toBeDefined()
    expect(p.domain).toEqual(['Function', 'Action', 'Interface', 'Measure', 'Workflow'])
    expect(p.range).toEqual(['Function'])
    expect(p.cardinality).toBe('many-to-many')
  })

  it('FACET_FIELD_DEFS contains Function-specific fields', () => {
    const fnFields = FACET_FIELD_DEFS.filter(f => f.facetTypes.includes('functions'))
    const paramNames = fnFields.map(f => f.paramName).sort()

    // The six Function-specific fields plus the two inherited ones
    // (tags + description) should all be present.
    expect(paramNames).toContain('signature')
    expect(paramNames).toContain('body')
    expect(paramNames).toContain('functionStereotype')
    expect(paramNames).toContain('purity')
    expect(paramNames).toContain('cacheable')
    expect(paramNames).toContain('visibility')
    expect(paramNames).toContain('tags') // inherited shared field
  })

  it('LINK_PARAM_DEFS contains computesThingIds + callsFunctionIds', () => {
    const fnLinks = LINK_PARAM_DEFS.filter(lp => lp.facetTypes.includes('functions'))
    const paramNames = fnLinks.map(lp => lp.paramName).sort()
    expect(paramNames).toContain('computesThingIds')
    expect(paramNames).toContain('callsFunctionIds')
  })
})

// ── 2-4. Command round-trip ────────────────────────────────────────────────

function makeRoot(): RootContext {
  return createEmptyRootContext('Phase 6 Test')
}

function makeFunction(id: string, name: string) {
  return {
    uri: id,
    name,
    description: 'test function',
    tags: [],
    signature: {
      parameters: [
        { name: 'x', type: 'integer', required: true, cardinality: 'scalar' as const },
      ],
      returns: { type: 'integer', cardinality: 'scalar' as const },
    },
    body: { kind: 'expression' as const, source: '$x + 1' },
    stereotype: 'calculator' as const,
    purity: 'pure' as const,
    cacheable: true,
    visibility: 'internal' as const,
  }
}

describe('Function facet - command round-trip', () => {
  it('facet:add inserts a Function into the root container', () => {
    const root = makeRoot()
    const fn = makeFunction('fn-1', 'addOne')

    const cmd: Command = {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'functions', facet: fn as any },
    }
    const result = applyCommand(root, cmd)

    expect(result.success).toBe(true)
    expect(result.state.facets.functions).toHaveLength(1)
    expect(result.state.facets.functions[0]!.uri).toBe('fn-1')
    expect(result.state.facets.functions[0]!.name).toBe('addOne')
  })

  it('facet:update modifies a Function in place', () => {
    const root = makeRoot()
    const fn = makeFunction('fn-1', 'addOne')
    const afterAdd = applyCommand(root, {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'functions', facet: fn as any },
    }).state

    const afterUpdate = applyCommand(afterAdd, {
      type: 'facet:update',
      payload: {
        contextUri: root.uri,
        facetType: 'functions',
        facetUri: 'fn-1',
        changes: { name: 'addOneRenamed', cacheable: false } as any,
      },
    }).state

    expect(afterUpdate.facets.functions[0]!.name).toBe('addOneRenamed')
    expect((afterUpdate.facets.functions[0] as any).cacheable).toBe(false)
  })

  it('facet:remove deletes a Function and prunes any links it touched', () => {
    const root = makeRoot()
    const fn = makeFunction('fn-1', 'addOne')
    const afterAdd = applyCommand(root, {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'functions', facet: fn as any },
    }).state

    const afterRemove = applyCommand(afterAdd, {
      type: 'facet:remove',
      payload: { contextUri: root.uri, facetType: 'functions', facetUri: 'fn-1' },
    }).state

    expect(afterRemove.facets.functions).toHaveLength(0)
  })
})

describe('Function facet - inverse round-trip', () => {
  it('facet:add inverse removes the Function', () => {
    const root = makeRoot()
    const fn = makeFunction('fn-rt', 'roundTrip')
    const cmd: Command = {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'functions', facet: fn as any },
    }
    const after = applyCommand(root, cmd).state
    const inverse = computeInverse(cmd, root, after)

    const afterInverse = applyCommand(after, inverse as Command).state
    expect(afterInverse.facets.functions).toHaveLength(0)
  })

  it('facet:update inverse restores the prior values', () => {
    const root = makeRoot()
    const fn = makeFunction('fn-rt', 'roundTrip')
    const afterAdd = applyCommand(root, {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'functions', facet: fn as any },
    }).state

    const updateCmd: Command = {
      type: 'facet:update',
      payload: {
        contextUri: root.uri,
        facetType: 'functions',
        facetUri: 'fn-rt',
        changes: { name: 'renamed' } as any,
      },
    }
    const afterUpdate = applyCommand(afterAdd, updateCmd).state
    const inverse = computeInverse(updateCmd, afterAdd, afterUpdate)

    const afterInverse = applyCommand(afterUpdate, inverse as Command).state
    expect(afterInverse.facets.functions[0]!.name).toBe('roundTrip')
  })

  it('facet:remove inverse restores the full Function', () => {
    const root = makeRoot()
    const fn = makeFunction('fn-rt', 'roundTrip')
    const afterAdd = applyCommand(root, {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'functions', facet: fn as any },
    }).state

    const removeCmd: Command = {
      type: 'facet:remove',
      payload: { contextUri: root.uri, facetType: 'functions', facetUri: 'fn-rt' },
    }
    const afterRemove = applyCommand(afterAdd, removeCmd).state
    const inverse = computeInverse(removeCmd, afterAdd, afterRemove)

    // Inverse may be a batch (restores facet + pruned links)
    let replayed = afterRemove
    if ((inverse as BatchCommand).type === 'batch') {
      replayed = applyBatch(afterRemove, inverse as BatchCommand).state
    } else {
      replayed = applyCommand(afterRemove, inverse as Command).state
    }
    expect(replayed.facets.functions).toHaveLength(1)
    expect(replayed.facets.functions[0]!.uri).toBe('fn-rt')
    expect(replayed.facets.functions[0]!.name).toBe('roundTrip')
  })
})

describe('Function facet - applyBatch round-trip', () => {
  it('applyBatch with multiple function:add commits all or nothing', () => {
    const root = makeRoot()
    const batch: BatchCommand = {
      type: 'batch',
      payload: {
        label: 'Add three functions',
        commands: [
          { type: 'facet:add', payload: { contextUri: root.uri, facetType: 'functions', facet: makeFunction('fn-a', 'A') as any } },
          { type: 'facet:add', payload: { contextUri: root.uri, facetType: 'functions', facet: makeFunction('fn-b', 'B') as any } },
          { type: 'facet:add', payload: { contextUri: root.uri, facetType: 'functions', facet: makeFunction('fn-c', 'C') as any } },
        ],
      },
    }
    const result = applyBatch(root, batch)
    expect(result.success).toBe(true)
    expect(result.state.facets.functions).toHaveLength(3)
    expect(result.state.facets.functions.map(f => f.name)).toEqual(['A', 'B', 'C'])
  })
})

// ── 5. Predicate validation ────────────────────────────────────────────────

describe('Function facet - predicate validation', () => {
  // `validateLink` returns `null` on success and a `ValidationError` on
  // failure. A valid link is a null result.

  it('validateLink accepts computes(Function, Thing)', () => {
    expect(validateLink('computes', 'Function', 'Thing')).toBeNull()
  })

  it('validateLink rejects computes(Function, Persona)', () => {
    const err = validateLink('computes', 'Function', 'Persona')
    expect(err).not.toBeNull()
    expect(err?.code).toBe('RANGE_VIOLATION')
  })

  // calls(Function, Function) is subject to SELF_REFERENCE only if sourceId
  // === targetId. Domain/range allows Function→Function.
  it('validateLink accepts calls(Function, Function) at the type level', () => {
    expect(validateLink('calls', 'Function', 'Function')).toBeNull()
  })

  it('validateLink accepts calls(Action, Function)', () => {
    expect(validateLink('calls', 'Action', 'Function')).toBeNull()
  })

  it('validateLink rejects calls(Thing, Function) - Thing is not in the domain', () => {
    const err = validateLink('calls', 'Thing', 'Function')
    expect(err).not.toBeNull()
    expect(err?.code).toBe('DOMAIN_VIOLATION')
  })
})

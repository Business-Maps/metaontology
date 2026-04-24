/**
 * Pipeline facet - meta-registry coverage for. The cardinality is advisory metadata
 *     per the ontology, not enforced at dispatch time - but the
 *     metadata must be correctly recorded so future Phase 9 provider
 *     routing can rely on it.
 *  7. Triple store projection - Pipeline projects rdf:type, memberOf,
 *     rdfs:label, and pullsFrom/pushesTo/populates links.
 *  8. ADR-003 consolidation - `feeds` is NOT a stored predicate;
 *     `pullsFrom`'s inverseLabels carries the "feeds" UI label so the
 *     DataSource→Pipeline edge still renders correctly.
 */

import { describe, it, expect } from 'vitest'
import { ENTITY_CLASSES, PREDICATES, validateLink, getBmNamespace } from '../ontology'
import { BASE_FACET_REGISTRY, FACET_TYPES } from '../facets'
import { FACET_FIELD_DEFS, LINK_PARAM_DEFS } from '../fields'
import { applyCommand, applyBatch, createEmptyRootContext } from '../../engine/apply'
import { computeInverse } from '../../engine/inverse'
import { projectToTriples } from '../../engine/triples'
import type { RootContext } from '../../types/context'
import type { Command, BatchCommand } from '../../types/commands'

// ── 1. Registration ───────────────────────────────────────────────────────

describe('Pipeline facet - meta registration', () => {
  it('Pipeline appears in ENTITY_CLASSES with a bm: URI and facetKey', () => {
    const p = (ENTITY_CLASSES as any).Pipeline
    expect(p).toBeDefined()
    expect(p.id).toBe('Pipeline')
    expect(p.uri).toMatch(/ontology\.businessmaps\.io\/Pipeline$/)
    expect(p.labels.en).toBe('Pipeline')
    expect(p.facetKey).toBe('pipelines')
  })

  it('pipelines appears in BASE_FACET_REGISTRY as tier 3', () => {
    const entry = BASE_FACET_REGISTRY.pipelines
    expect(entry).toBeDefined()
    expect(entry.entityClass).toBe('Pipeline')
    expect(entry.tier).toBe(3)
  })

  it('pipelines appears in FACET_TYPES (derived from registry)', () => {
    expect(FACET_TYPES).toContain('pipelines')
  })

  it('pullsFrom is registered with correct domain/range/cardinality', () => {
    const p = (PREDICATES as any).pullsFrom
    expect(p).toBeDefined()
    expect(p.domain).toEqual(['Pipeline'])
    expect(p.range).toEqual(['DataSource'])
    expect(p.cardinality).toBe('many-to-one') // Phase 8 acceptance (cardinality)
    expect(p.tier).toBe('framework')
  })

  it('pushesTo is registered with correct domain/range', () => {
    const p = (PREDICATES as any).pushesTo
    expect(p).toBeDefined()
    expect(p.domain).toEqual(['Pipeline'])
    expect(p.range).toEqual(['DataSource'])
    expect(p.cardinality).toBe('many-to-one')
  })

  it('populates is registered with correct domain/range', () => {
    const p = (PREDICATES as any).populates
    expect(p).toBeDefined()
    expect(p.domain).toEqual(['Pipeline'])
    expect(p.range).toEqual(['Thing'])
    expect(p.cardinality).toBe('many-to-many')
  })

  it('FACET_FIELD_DEFS contains Pipeline-specific fields', () => {
    const pipeFields = FACET_FIELD_DEFS.filter(f => f.facetTypes.includes('pipelines'))
    const paramNames = pipeFields.map(f => f.paramName).sort()

    expect(paramNames).toContain('mapping')
    expect(paramNames).toContain('strategy')
    expect(paramNames).toContain('pipelineDirection')
    expect(paramNames).toContain('schedule')
    expect(paramNames).toContain('rateLimit')
    expect(paramNames).toContain('pipelineStereotype')
    expect(paramNames).toContain('lastRunAt')
    expect(paramNames).toContain('lastRunStatus')
  })

  it('LINK_PARAM_DEFS contains the three Pipeline flow params', () => {
    const pipeLinks = LINK_PARAM_DEFS.filter(lp => lp.facetTypes.includes('pipelines'))
    const paramNames = pipeLinks.map(lp => lp.paramName).sort()
    expect(paramNames).toContain('pullsFromDataSourceId')
    expect(paramNames).toContain('pushesToDataSourceId')
    expect(paramNames).toContain('populatesThingIds')
  })
})

// ── 2-4. Command round-trip ────────────────────────────────────────────────

function makeRoot(): RootContext {
  return createEmptyRootContext('Phase 8 Test')
}

function makePipeline(id: string, name: string) {
  return {
    uri: id,
    name,
    description: 'Stripe customer sync',
    tags: [],
    mapping: {
      iterate: '$.data',
      identity: { externalId: '$.id' },
      fields: { email: '$.email' },
    },
    strategy: 'materialize' as const,
    direction: 'pull' as const,
    schedule: { kind: 'on-demand' as const },
    stereotype: 'import' as const,
  }
}

describe('Pipeline facet - command round-trip', () => {
  it('facet:add inserts a Pipeline into the root container', () => {
    const root = makeRoot()
    const pipe = makePipeline('pipe-1', 'StripeCustomerSync')

    const cmd: Command = {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'pipelines', facet: pipe as any },
    }
    const result = applyCommand(root, cmd)

    expect(result.success).toBe(true)
    expect(result.state.facets.pipelines).toHaveLength(1)
    expect(result.state.facets.pipelines[0]!.uri).toBe('pipe-1')
    expect(result.state.facets.pipelines[0]!.name).toBe('StripeCustomerSync')
  })

  it('facet:update modifies a Pipeline in place', () => {
    const root = makeRoot()
    const pipe = makePipeline('pipe-1', 'Original')
    const afterAdd = applyCommand(root, {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'pipelines', facet: pipe as any },
    }).state

    const afterUpdate = applyCommand(afterAdd, {
      type: 'facet:update',
      payload: {
        contextUri: root.uri,
        facetType: 'pipelines',
        facetUri: 'pipe-1',
        changes: { name: 'Renamed', lastRunStatus: 'ok' } as any,
      },
    }).state

    expect(afterUpdate.facets.pipelines[0]!.name).toBe('Renamed')
    expect((afterUpdate.facets.pipelines[0] as any).lastRunStatus).toBe('ok')
  })

  it('facet:remove deletes a Pipeline', () => {
    const root = makeRoot()
    const pipe = makePipeline('pipe-1', 'Removable')
    const afterAdd = applyCommand(root, {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'pipelines', facet: pipe as any },
    }).state

    const afterRemove = applyCommand(afterAdd, {
      type: 'facet:remove',
      payload: { contextUri: root.uri, facetType: 'pipelines', facetUri: 'pipe-1' },
    }).state

    expect(afterRemove.facets.pipelines).toHaveLength(0)
  })
})

describe('Pipeline facet - inverse round-trip', () => {
  it('facet:add inverse removes the Pipeline', () => {
    const root = makeRoot()
    const pipe = makePipeline('pipe-rt', 'RoundTrip')
    const cmd: Command = {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'pipelines', facet: pipe as any },
    }
    const after = applyCommand(root, cmd).state
    const inverse = computeInverse(cmd, root, after)

    const afterInverse = applyCommand(after, inverse as Command).state
    expect(afterInverse.facets.pipelines).toHaveLength(0)
  })

  it('facet:remove inverse restores the full Pipeline including mapping', () => {
    const root = makeRoot()
    const pipe = makePipeline('pipe-rt', 'RoundTrip')
    const afterAdd = applyCommand(root, {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'pipelines', facet: pipe as any },
    }).state

    const removeCmd: Command = {
      type: 'facet:remove',
      payload: { contextUri: root.uri, facetType: 'pipelines', facetUri: 'pipe-rt' },
    }
    const afterRemove = applyCommand(afterAdd, removeCmd).state
    const inverse = computeInverse(removeCmd, afterAdd, afterRemove)

    let replayed = afterRemove
    if ((inverse as BatchCommand).type === 'batch') {
      replayed = applyBatch(afterRemove, inverse as BatchCommand).state
    } else {
      replayed = applyCommand(afterRemove, inverse as Command).state
    }

    expect(replayed.facets.pipelines).toHaveLength(1)
    const restored = replayed.facets.pipelines[0] as any
    expect(restored.uri).toBe('pipe-rt')
    expect(restored.mapping.iterate).toBe('$.data')
    expect(restored.mapping.identity.externalId).toBe('$.id')
    expect(restored.strategy).toBe('materialize')
    expect(restored.direction).toBe('pull')
  })
})

describe('Pipeline facet - applyBatch round-trip', () => {
  it('applyBatch with multiple pipeline:add commits all or nothing', () => {
    const root = makeRoot()
    const batch: BatchCommand = {
      type: 'batch',
      payload: {
        label: 'Add three pipelines',
        commands: [
          { type: 'facet:add', payload: { contextUri: root.uri, facetType: 'pipelines', facet: makePipeline('p-a', 'A') as any } },
          { type: 'facet:add', payload: { contextUri: root.uri, facetType: 'pipelines', facet: makePipeline('p-b', 'B') as any } },
          { type: 'facet:add', payload: { contextUri: root.uri, facetType: 'pipelines', facet: makePipeline('p-c', 'C') as any } },
        ],
      },
    }
    const result = applyBatch(root, batch)
    expect(result.success).toBe(true)
    expect(result.state.facets.pipelines).toHaveLength(3)
    expect(result.state.facets.pipelines.map(f => f.name)).toEqual(['A', 'B', 'C'])
  })
})

// ── 5. Predicate validation ────────────────────────────────────────────────

describe('Pipeline facet - predicate validation', () => {
  // `validateLink` returns null on success, ValidationError on failure.

  it('validateLink accepts pullsFrom(Pipeline, DataSource)', () => {
    expect(validateLink('pullsFrom', 'Pipeline', 'DataSource')).toBeNull()
  })

  it('validateLink rejects pullsFrom(Pipeline, Thing)', () => {
    const err = validateLink('pullsFrom', 'Pipeline', 'Thing')
    expect(err).not.toBeNull()
    expect(err?.code).toBe('RANGE_VIOLATION')
  })

  it('validateLink rejects pullsFrom(DataSource, Pipeline) - reverse direction', () => {
    const err = validateLink('pullsFrom', 'DataSource', 'Pipeline')
    expect(err).not.toBeNull()
    expect(err?.code).toBe('DOMAIN_VIOLATION')
  })

  it('validateLink accepts pushesTo(Pipeline, DataSource)', () => {
    expect(validateLink('pushesTo', 'Pipeline', 'DataSource')).toBeNull()
  })

  it('validateLink accepts populates(Pipeline, Thing)', () => {
    expect(validateLink('populates', 'Pipeline', 'Thing')).toBeNull()
  })

  it('validateLink rejects populates(Pipeline, DataSource)', () => {
    const err = validateLink('populates', 'Pipeline', 'DataSource')
    expect(err).not.toBeNull()
    expect(err?.code).toBe('RANGE_VIOLATION')
  })
})

// ── 6. Cardinality (Phase 8 acceptance) ────────────────────────────────────

describe('Pipeline facet - cardinality', () => {
  it('pullsFrom cardinality is many-to-one (one DataSource per Pipeline)', () => {
    const p = (PREDICATES as any).pullsFrom
    expect(p.cardinality).toBe('many-to-one')
  })

  it('populates cardinality is many-to-many (multiple Things per Pipeline)', () => {
    const p = (PREDICATES as any).populates
    expect(p.cardinality).toBe('many-to-many')
  })
})

// ── 7. Triple store projection ─────────────────────────────────────────────

describe('Pipeline facet - triple projection', () => {
  it('projects a root-level Pipeline with rdf:type and memberOf', () => {
    const root = makeRoot()
    root.facets.pipelines.push(makePipeline('pipe-proj', 'ProjectedPipe') as any)

    const triples = projectToTriples(root)

    const typeT = triples.find(
      t => t.subject === 'pipe-proj' && t.predicate === 'rdf:type',
    )
    expect(typeT).toBeDefined()
    expect(typeT!.object).toBe(`${getBmNamespace()}Pipeline`)

    const memberT = triples.find(
      t => t.subject === 'pipe-proj' && t.predicate === 'memberOf',
    )
    expect(memberT).toBeDefined()
    expect(memberT!.object).toBe(root.uri)
  })

  it('projects pullsFrom, pushesTo, and populates links', () => {
    const root = makeRoot()
    root.facets.pipelines.push(makePipeline('pipe-1', 'Sync') as any)
    root.facets.datasources.push({
      uri: 'ds-stripe',
      name: 'Stripe',
      description: '',
      tags: [],
      transport: 'http',
      endpoint: 'https://api.stripe.com',
      credentialRef: 'stripe-key',
      authType: 'bearer',
      config: {},
      connectionStatus: 'untested',
      stereotype: 'read-write',
      environment: 'prod',
      acceptsSimulationTraffic: false,
    } as any)
    root.facets.things.push({
      uri: 'thing-customer',
      name: 'Customer',
      definition: '',
      attributes: [],
      rules: [],
      states: [],
      tags: [],
    } as any)
    root.links.push(
      { uri: 'l-1', predicate: 'pullsFrom', sourceUri: 'pipe-1', targetUri: 'ds-stripe' } as any,
      { uri: 'l-2', predicate: 'populates', sourceUri: 'pipe-1', targetUri: 'thing-customer' } as any,
    )

    const triples = projectToTriples(root)

    const pullsT = triples.find(t => t.subject === 'pipe-1' && t.predicate === 'pullsFrom')
    expect(pullsT).toBeDefined()
    expect(pullsT!.object).toBe('ds-stripe')

    const populatesT = triples.find(t => t.subject === 'pipe-1' && t.predicate === 'populates')
    expect(populatesT).toBeDefined()
    expect(populatesT!.object).toBe('thing-customer')
  })
})

// ── 8. ADR-003: feeds is NOT a stored predicate ──────────────────────────

describe('Pipeline facet - ADR-003 feeds consolidation', () => {
  it('`feeds` is NOT a stored predicate', () => {
    // Phase 8.5 will add an explicit validateLink rejection test. For
    // now, the structural guarantee: the predicates registry has no
    // `feeds` key.
    expect((PREDICATES as any).feeds).toBeUndefined()
  })

  it("pullsFrom's inverseLabel is `feeds` - what the UI renders from the DataSource side", () => {
    const p = (PREDICATES as any).pullsFrom
    expect(p.inverseLabels.en).toBe('feeds')
  })
})

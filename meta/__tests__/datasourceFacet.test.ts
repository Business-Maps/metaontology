import { describe, it, expect } from 'vitest'
import {
  ENTITY_CLASSES,
  PREDICATES,
  validateLink,
  getBmNamespace,
} from '../ontology'
import { BASE_FACET_REGISTRY, FACET_TYPES } from '../facets'
import { FACET_FIELD_DEFS, LINK_PARAM_DEFS } from '../fields'
import type { RootContext } from '../../types/context'
import type { Command, BatchCommand } from '../../engine'
import { createEmptyRootContext } from '../../engine/apply'
import { applyCommand, applyBatch } from '../../engine/apply'
import { computeInverse } from '../../engine/inverse'
import { projectToTriples } from '../../engine/triples'

describe('DataSource facet - meta-registry coverage', () => {
  it('DataSource appears in ENTITY_CLASSES with a bm: URI and facetKey', () => {
    const ds = (ENTITY_CLASSES as any).DataSource
    expect(ds).toBeDefined()
    expect(ds.id).toBe('DataSource')
    expect(ds.uri).toMatch(/ontology\.businessmaps\.io\/DataSource$/)
    expect(ds.labels.en).toBe('Data Source')
    expect(ds.facetKey).toBe('datasources')
  })

  it('datasources appears in BASE_FACET_REGISTRY as tier 3', () => {
    const entry = BASE_FACET_REGISTRY.datasources
    expect(entry).toBeDefined()
    expect(entry.key).toBe('datasources')
    expect(entry.label.en).toBe('Data Sources')
    expect(entry.singular.en).toBe('Data Source')
    expect(entry.entityClass).toBe('DataSource')
    expect(entry.tier).toBe(3)
  })

  it('datasources appears in FACET_TYPES (derived from registry)', () => {
    expect(FACET_TYPES).toContain('datasources')
  })

  it('boundTo predicate is registered with correct domain/range', () => {
    const p = (PREDICATES as any).boundTo
    expect(p).toBeDefined()
    expect(p.domain).toEqual(['DataSource'])
    expect(p.range).toEqual(['Port'])
    expect(p.cardinality).toBe('many-to-many')
    expect(p.tier).toBe('framework')
  })

  it('FACET_FIELD_DEFS contains DataSource-specific fields', () => {
    const dsFields = FACET_FIELD_DEFS.filter(f => f.facetTypes.includes('datasources'))
    const paramNames = dsFields.map(f => f.paramName).sort()

    expect(paramNames).toContain('transport')
    expect(paramNames).toContain('endpoint')
    expect(paramNames).toContain('credentialRef')
    expect(paramNames).toContain('authType')
    expect(paramNames).toContain('config')
    expect(paramNames).toContain('connectionStatus')
    expect(paramNames).toContain('dataSourceStereotype')
    expect(paramNames).toContain('environment')
    expect(paramNames).toContain('acceptsSimulationTraffic')
    expect(paramNames).toContain('tags') // inherited shared field
  })

  it('LINK_PARAM_DEFS contains boundPortIds', () => {
    const dsLinks = LINK_PARAM_DEFS.filter(lp => lp.facetTypes.includes('datasources'))
    const paramNames = dsLinks.map(lp => lp.paramName)
    expect(paramNames).toContain('boundPortIds')
  })
})

// ── 2-4. Command round-trip ────────────────────────────────────────────────

function makeRoot(): RootContext {
  return createEmptyRootContext('Phase 7 Test')
}

function makeDataSource(id: string, name: string) {
  return {
    uri: id,
    name,
    description: 'Stripe production API',
    tags: [],
    transport: 'http' as const,
    endpoint: 'https://api.stripe.com/v1',
    credentialRef: 'stripe_prod_key',
    authType: 'bearer' as const,
    config: { apiVersion: '2023-10-16' },
    connectionStatus: 'untested' as const,
    stereotype: 'read-write' as const,
    environment: 'prod' as const,
    acceptsSimulationTraffic: false,
  }
}

describe('DataSource facet - command round-trip', () => {
  it('facet:add inserts a DataSource into the root container', () => {
    const root = makeRoot()
    const ds = makeDataSource('ds-1', 'Stripe')

    const cmd: Command = {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'datasources', facet: ds as any },
    }
    const result = applyCommand(root, cmd)

    expect(result.success).toBe(true)
    expect(result.state.facets.datasources).toHaveLength(1)
    expect(result.state.facets.datasources[0]!.uri).toBe('ds-1')
    expect(result.state.facets.datasources[0]!.name).toBe('Stripe')
  })

  it('facet:update modifies a DataSource in place', () => {
    const root = makeRoot()
    const ds = makeDataSource('ds-1', 'Stripe')
    const afterAdd = applyCommand(root, {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'datasources', facet: ds as any },
    }).state

    const afterUpdate = applyCommand(afterAdd, {
      type: 'facet:update',
      payload: {
        contextUri: root.uri,
        facetType: 'datasources',
        facetUri: 'ds-1',
        changes: { name: 'Stripe (renamed)', connectionStatus: 'connected' } as any,
      },
    }).state

    expect(afterUpdate.facets.datasources[0]!.name).toBe('Stripe (renamed)')
    expect((afterUpdate.facets.datasources[0] as any).connectionStatus).toBe('connected')
  })

  it('facet:remove deletes a DataSource', () => {
    const root = makeRoot()
    const ds = makeDataSource('ds-1', 'Stripe')
    const afterAdd = applyCommand(root, {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'datasources', facet: ds as any },
    }).state

    const afterRemove = applyCommand(afterAdd, {
      type: 'facet:remove',
      payload: { contextUri: root.uri, facetType: 'datasources', facetUri: 'ds-1' },
    }).state

    expect(afterRemove.facets.datasources).toHaveLength(0)
  })
})

describe('DataSource facet - inverse round-trip', () => {
  it('facet:add inverse removes the DataSource', () => {
    const root = makeRoot()
    const ds = makeDataSource('ds-rt', 'RoundTrip')
    const cmd: Command = {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'datasources', facet: ds as any },
    }
    const after = applyCommand(root, cmd).state
    const inverse = computeInverse(cmd, root, after)

    const afterInverse = applyCommand(after, inverse as Command).state
    expect(afterInverse.facets.datasources).toHaveLength(0)
  })

  it('facet:remove inverse restores the full DataSource', () => {
    const root = makeRoot()
    const ds = makeDataSource('ds-rt', 'RoundTrip')
    const afterAdd = applyCommand(root, {
      type: 'facet:add',
      payload: { contextUri: root.uri, facetType: 'datasources', facet: ds as any },
    }).state

    const removeCmd: Command = {
      type: 'facet:remove',
      payload: { contextUri: root.uri, facetType: 'datasources', facetUri: 'ds-rt' },
    }
    const afterRemove = applyCommand(afterAdd, removeCmd).state
    const inverse = computeInverse(removeCmd, afterAdd, afterRemove)

    let replayed = afterRemove
    if ((inverse as BatchCommand).type === 'batch') {
      replayed = applyBatch(afterRemove, inverse as BatchCommand).state
    } else {
      replayed = applyCommand(afterRemove, inverse as Command).state
    }
    expect(replayed.facets.datasources).toHaveLength(1)
    expect(replayed.facets.datasources[0]!.uri).toBe('ds-rt')
    // All the original fields survive the round-trip
    expect((replayed.facets.datasources[0] as any).transport).toBe('http')
    expect((replayed.facets.datasources[0] as any).credentialRef).toBe('stripe_prod_key')
  })
})

describe('DataSource facet - applyBatch round-trip', () => {
  it('applyBatch with multiple datasource:add commits all or nothing', () => {
    const root = makeRoot()
    const batch: BatchCommand = {
      type: 'batch',
      payload: {
        label: 'Add three datasources',
        commands: [
          { type: 'facet:add', payload: { contextUri: root.uri, facetType: 'datasources', facet: makeDataSource('ds-a', 'A') as any } },
          { type: 'facet:add', payload: { contextUri: root.uri, facetType: 'datasources', facet: makeDataSource('ds-b', 'B') as any } },
          { type: 'facet:add', payload: { contextUri: root.uri, facetType: 'datasources', facet: makeDataSource('ds-c', 'C') as any } },
        ],
      },
    }
    const result = applyBatch(root, batch)
    expect(result.success).toBe(true)
    expect(result.state.facets.datasources).toHaveLength(3)
    expect(result.state.facets.datasources.map(f => f.name)).toEqual(['A', 'B', 'C'])
  })
})

// ── 5. Predicate validation ────────────────────────────────────────────────

describe('DataSource facet - predicate validation', () => {
  // validateLink returns null on success, ValidationError on failure.

  it('validateLink accepts boundTo(DataSource, Port)', () => {
    expect(validateLink('boundTo', 'DataSource', 'Port')).toBeNull()
  })

  it('validateLink rejects boundTo(DataSource, Thing)', () => {
    const err = validateLink('boundTo', 'DataSource', 'Thing')
    expect(err).not.toBeNull()
    expect(err?.code).toBe('RANGE_VIOLATION')
  })

  it('validateLink rejects boundTo(Persona, Port)', () => {
    const err = validateLink('boundTo', 'Persona', 'Port')
    expect(err).not.toBeNull()
    expect(err?.code).toBe('DOMAIN_VIOLATION')
  })
})

// ── 6. Triple store projection ─────────────────────────────────────────────

describe('DataSource facet - triple projection', () => {
  it('projects a root-level DataSource with rdf:type and memberOf', () => {
    const root = makeRoot()
    root.facets.datasources.push(makeDataSource('ds-proj', 'ProjectedDS') as any)

    const triples = projectToTriples(root)

    const typeT = triples.find(
      t => t.subject === 'ds-proj' && t.predicate === 'rdf:type',
    )
    expect(typeT).toBeDefined()
    expect(typeT!.object).toBe(`${getBmNamespace()}DataSource`)

    const memberT = triples.find(
      t => t.subject === 'ds-proj' && t.predicate === 'memberOf',
    )
    expect(memberT).toBeDefined()
    expect(memberT!.object).toBe(root.uri)

    const labelT = triples.find(
      t => t.subject === 'ds-proj' && t.predicate === 'rdfs:label',
    )
    expect(labelT).toBeDefined()
    expect(labelT!.object).toBe('ProjectedDS')
  })

  it('projects boundTo links between a DataSource and a Port', () => {
    const root = makeRoot()
    root.facets.datasources.push(makeDataSource('ds-stripe', 'Stripe') as any)
    root.facets.ports.push({
      uri: 'port-customers-in',
      name: 'customers-in',
      description: '',
      direction: 'consumes',
      tags: [],
    } as any)
    root.links.push({
      uri: 'link-1',
      predicate: 'boundTo',
      sourceUri: 'ds-stripe',
      targetUri: 'port-customers-in',
    } as any)

    const triples = projectToTriples(root)
    const boundT = triples.find(
      t => t.subject === 'ds-stripe' && t.predicate === 'boundTo',
    )
    expect(boundT).toBeDefined()
    expect(boundT!.object).toBe('port-customers-in')
  })
})

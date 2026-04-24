import { describe, it, expect } from 'vitest'
import { projectM0Triples } from '../m0Triples'
import { projectToTriples, buildIndexes, sp, po, spo } from '../triples'
import { createEmptyRootContext } from '../apply'
import { createEmptyM0State } from '../../types/m0'
import type { M0State, Instance, PipelineRun, WritebackQueueItem } from '../../types/m0'
import type { RootContext } from '../../types/context'

function makeModel(): RootContext {
  const root = createEmptyRootContext('Test')
  const ctx = {
    uri: 'bm:ctx:main',
    name: 'Main',
    description: '',
    parentUri: root.uri,
    facets: {
      things: [{ uri: 'bm:thing:customer', name: 'Customer', definition: 'A customer', attributes: [], rules: [], states: [], tags: [] }],
      personas: [], ports: [], actions: [], workflows: [],
      interfaces: [], events: [], measures: [],
      functions: [], datasources: [],
      pipelines: [{ uri: 'bm:pipe:stripe', name: 'Stripe Sync', description: '', strategy: 'materialize', direction: 'pull', tags: [] }],
    },
    symbols: [],
    customFacets: {},
    tags: [],
  }
  return { ...root, contexts: { [ctx.uri]: ctx as any } }
}

function makeM0WithInstances(): M0State {
  const m0 = createEmptyM0State()
  // Add Customer instances
  m0.instances['bm:thing:customer'] = {
    'bm:inst:cust-1': {
      uri: 'bm:inst:cust-1', typeUri: 'bm:thing:customer',
      data: { name: 'Jane Doe', email: 'jane@co.com' },
      sourceUri: 'bm:run:1',
      createdAt: '2026-04-10T00:00:00Z', updatedAt: '2026-04-10T00:00:00Z',
    },
    'bm:inst:cust-2': {
      uri: 'bm:inst:cust-2', typeUri: 'bm:thing:customer',
      data: { name: 'John Smith' },
      sourceUri: 'bm:run:1',
      createdAt: '2026-04-10T00:00:00Z', updatedAt: '2026-04-10T00:00:00Z',
    },
  }
  // Add a PipelineRun
  m0.pipelineRuns['bm:run:1'] = {
    uri: 'bm:run:1', pipelineUri: 'bm:pipe:stripe',
    status: 'completed', startedAt: '2026-04-10T00:00:00Z',
    completedAt: '2026-04-10T00:01:00Z', recordsProcessed: 2, recordsFailed: 0,
  }
  // Add a failed PipelineRun
  m0.pipelineRuns['bm:run:2'] = {
    uri: 'bm:run:2', pipelineUri: 'bm:pipe:stripe',
    status: 'failed', startedAt: '2026-04-10T01:00:00Z',
    completedAt: '2026-04-10T01:01:00Z', error: 'rate limited',
  }
  // Add a writeback queue item
  m0.writebackQueue['bm:wb:1'] = {
    uri: 'bm:wb:1', pipelineUri: 'bm:pipe:stripe',
    instanceUri: 'bm:inst:cust-1',
    reverseMappedPayload: { name: 'Jane' },
    idempotencyKey: 'key-1', attemptCount: 0,
    status: 'pending', enqueuedAt: '2026-04-10T00:00:00Z',
  }
  return m0
}

describe('projectM0Triples', () => {
  const model = makeModel()
  const m0 = makeM0WithInstances()

  it('projects Instance entities as (uri, rdf:type, typeUri)', () => {
    const triples = projectM0Triples(m0, model)
    const custTypeTriples = triples.filter(t =>
      t.predicate === 'rdf:type' && t.object === 'bm:thing:customer',
    )
    expect(custTypeTriples).toHaveLength(2)
    expect(custTypeTriples.map(t => t.subject).sort()).toEqual([
      'bm:inst:cust-1', 'bm:inst:cust-2',
    ])
  })

  it('projects Instance labels from data.name', () => {
    const triples = projectM0Triples(m0, model)
    const janeLabel = triples.find(t =>
      t.subject === 'bm:inst:cust-1' && t.predicate === 'rdfs:label',
    )
    expect(janeLabel?.object).toBe('Jane Doe')
  })

  it('projects producedBy triples for sourced instances', () => {
    const triples = projectM0Triples(m0, model)
    const produced = triples.filter(t => t.predicate === 'producedBy')
    expect(produced).toHaveLength(2)
    expect(produced[0]?.object).toBe('bm:run:1')
  })

  it('projects PipelineRun → runFor → Pipeline', () => {
    const triples = projectM0Triples(m0, model)
    const runForTriples = triples.filter(t => t.predicate === 'runFor')
    expect(runForTriples).toHaveLength(2)
    expect(runForTriples[0]?.object).toBe('bm:pipe:stripe')
  })

  it('projects pendingWriteback triples', () => {
    const triples = projectM0Triples(m0, model)
    const wb = triples.filter(t => t.predicate === 'pendingWriteback')
    expect(wb).toHaveLength(1)
    expect(wb[0]?.subject).toBe('bm:pipe:stripe')
    expect(wb[0]?.object).toBe('bm:wb:1')
  })
})

describe('cross-tier triple query (M0 + M1)', () => {
  const model = makeModel()
  const m0 = makeM0WithInstances()

  it('merged index contains both M1 and M0 triples', () => {
    const m1Triples = projectToTriples(model)
    const m0Triples = projectM0Triples(m0, model)
    const all = [...m1Triples, ...m0Triples]
    const idx = buildIndexes(all)

    // M1: the Customer Thing exists
    const customerType = idx.byS.get('bm:thing:customer')
    expect(customerType?.some(t => t.predicate === 'rdf:type')).toBe(true)

    // M0: Customer instances exist
    const cust1Type = idx.byS.get('bm:inst:cust-1')
    expect(cust1Type?.some(t => t.predicate === 'rdf:type' && t.object === 'bm:thing:customer')).toBe(true)
  })

  it('cross-tier query: instances produced by a specific PipelineRun', () => {
    const m1Triples = projectToTriples(model)
    const m0Triples = projectM0Triples(m0, model)
    const all = [...m1Triples, ...m0Triples]
    const idx = buildIndexes(all)

    // Find instances produced by run:1
    const producedByRun1 = (idx.byPO.get(po('producedBy', 'bm:run:1')) ?? [])
      .map(t => t.subject)

    expect(producedByRun1.sort()).toEqual(['bm:inst:cust-1', 'bm:inst:cust-2'])
  })

  it('cross-tier query: pipeline runs for a specific pipeline', () => {
    const m1Triples = projectToTriples(model)
    const m0Triples = projectM0Triples(m0, model)
    const all = [...m1Triples, ...m0Triples]
    const idx = buildIndexes(all)

    // Find all runs for stripe pipeline
    const runsForStripe = (idx.byPO.get(po('runFor', 'bm:pipe:stripe')) ?? [])
      .map(t => t.subject)

    expect(runsForStripe.sort()).toEqual(['bm:run:1', 'bm:run:2'])
  })

  it('cross-tier query: instances from failed runs (spans M0 PipelineRun status + M0 Instance lineage)', () => {
    const m0Triples = projectM0Triples(m0, model)
    const idx = buildIndexes(m0Triples)

    // 1. Find runs for the pipeline
    const allRuns = (idx.byPO.get(po('runFor', 'bm:pipe:stripe')) ?? [])
      .map(t => t.subject)

    // 2. Filter to failed runs (check against m0 state directly - triple store has type, but
    //    status is not projected as a triple; it's a field query on the materialized M0State)
    const failedRunUris = allRuns.filter(uri => m0.pipelineRuns[uri]?.status === 'failed')
    expect(failedRunUris).toEqual(['bm:run:2'])

    // 3. Find instances produced by failed runs
    const instancesFromFailed = failedRunUris.flatMap(runUri =>
      (idx.byPO.get(po('producedBy', runUri)) ?? []).map(t => t.subject),
    )
    // run:2 produced no instances (it failed), so this should be empty
    expect(instancesFromFailed).toEqual([])

    // 4. Verify run:1 (successful) produced instances
    const instancesFromSuccessful = (idx.byPO.get(po('producedBy', 'bm:run:1')) ?? [])
      .map(t => t.subject)
    expect(instancesFromSuccessful.sort()).toEqual(['bm:inst:cust-1', 'bm:inst:cust-2'])
  })
})

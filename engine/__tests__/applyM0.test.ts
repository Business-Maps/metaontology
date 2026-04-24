import { describe, it, expect } from 'vitest'
import { applyM0Command } from '../applyM0'
import { computeM0Inverse } from '../inverseM0'
import { createEmptyRootContext } from '../apply'
import { createEmptyM0State } from '../../types/m0'
import type { M0State, Instance, PipelineRun, WritebackQueueItem } from '../../types/m0'
import type { M0Command } from '../../types/commands'
import { isM0Command, M0_COMMAND_SCOPE } from '../../types/commands'
import type { RootContext } from '../../types/context'

// ── Helpers ───────────────────────────────────────────────────────────────

function makeModel(): RootContext {
  let root = createEmptyRootContext('Test')
  // Add a context with a Thing so we can test instance creation
  const ctx = {
    uri: 'bm:ctx:main',
    name: 'Main',
    description: '',
    parentUri: root.uri,
    facets: {
      things: [{ uri: 'bm:thing:customer', name: 'Customer', definition: 'A customer', attributes: [], rules: [], states: [], tags: [] }],
      personas: [{ uri: 'bm:persona:operator', name: 'Operator', description: '', role: 'ops', personaType: 'human', tags: [] }],
      ports: [],
      actions: [{ uri: 'bm:action:processPayment', name: 'Process Payment', description: '', type: 'command', tags: [] }],
      workflows: [{ uri: 'bm:workflow:fulfillment', name: 'Order Fulfillment', description: '', trigger: { type: 'manual' }, steps: [], tags: [] }],
      interfaces: [{ uri: 'bm:interface:dashboard', name: 'Dashboard', description: '', kind: 'dashboard', tags: [] }],
      events: [{ uri: 'bm:event:orderPlaced', name: 'Order Placed', description: '', eventType: 'event', tags: [] }],
      measures: [{ uri: 'bm:measure:revenue', name: 'Revenue', description: '', measureType: 'financial', unit: 'USD', tags: [] }],
      functions: [{ uri: 'bm:fn:calcLtv', name: 'Calculate LTV', description: '', tags: [] }],
      datasources: [],
      pipelines: [],
    },
    symbols: [],
    customFacets: {},
    tags: [],
  }
  root = { ...root, contexts: { [ctx.uri]: ctx as any } }
  return root
}

function makeInstance(uri: string, typeUri: string): Instance {
  return {
    uri,
    typeUri,
    data: { name: 'Test', email: 'test@example.com' },
    createdAt: '2026-04-10T00:00:00Z',
    updatedAt: '2026-04-10T00:00:00Z',
  }
}

function applyOk(m0: M0State, cmd: M0Command, model: RootContext): M0State {
  const result = applyM0Command(m0, cmd, model)
  expect(result.success).toBe(true)
  return result.state
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('applyM0Command', () => {
  const model = makeModel()

  describe('instance:upsert', () => {
    it('creates an instance of a Thing', () => {
      const m0 = createEmptyM0State()
      const inst = makeInstance('bm:inst:cust-1', 'bm:thing:customer')
      const result = applyOk(m0, {
        type: 'instance:upsert',
        payload: { thingUri: 'bm:thing:customer', instance: inst },
      }, model)

      expect(result.instances['bm:thing:customer']?.['bm:inst:cust-1']).toBeDefined()
      expect(result.instances['bm:thing:customer']?.['bm:inst:cust-1']?.data.name).toBe('Test')
    })

    it('creates an instance of a Persona', () => {
      const m0 = createEmptyM0State()
      const inst = makeInstance('bm:inst:user-1', 'bm:persona:operator')
      const result = applyOk(m0, {
        type: 'instance:upsert',
        payload: { thingUri: 'bm:persona:operator', instance: inst },
      }, model)

      expect(result.instances['bm:persona:operator']?.['bm:inst:user-1']).toBeDefined()
    })

    it('creates an instance of an Event', () => {
      const m0 = createEmptyM0State()
      const inst = makeInstance('bm:inst:evt-1', 'bm:event:orderPlaced')
      const result = applyOk(m0, {
        type: 'instance:upsert',
        payload: { thingUri: 'bm:event:orderPlaced', instance: inst },
      }, model)

      expect(result.instances['bm:event:orderPlaced']?.['bm:inst:evt-1']).toBeDefined()
    })

    it('rejects instance of a non-instantiable class (Interface)', () => {
      const m0 = createEmptyM0State()
      const inst = makeInstance('bm:inst:bad-1', 'bm:interface:dashboard')
      const result = applyM0Command(m0, {
        type: 'instance:upsert',
        payload: { thingUri: 'bm:interface:dashboard', instance: inst },
      }, model)

      expect(result.success).toBe(false)
      expect(result.error).toContain('does not support M0 instances')
    })

    it('rejects instance of a non-instantiable class (Function)', () => {
      const m0 = createEmptyM0State()
      const inst = makeInstance('bm:inst:bad-2', 'bm:fn:calcLtv')
      const result = applyM0Command(m0, {
        type: 'instance:upsert',
        payload: { thingUri: 'bm:fn:calcLtv', instance: inst },
      }, model)

      expect(result.success).toBe(false)
      expect(result.error).toContain('does not support M0 instances')
    })

    it('rejects instance with unknown typeUri', () => {
      const m0 = createEmptyM0State()
      const inst = makeInstance('bm:inst:bad-3', 'bm:thing:nonexistent')
      const result = applyM0Command(m0, {
        type: 'instance:upsert',
        payload: { thingUri: 'bm:thing:nonexistent', instance: inst },
      }, model)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Unknown type URI')
    })
  })

  describe('instance:update', () => {
    it('updates a Thing instance', () => {
      let m0 = createEmptyM0State()
      const inst = makeInstance('bm:inst:cust-1', 'bm:thing:customer')
      m0 = applyOk(m0, {
        type: 'instance:upsert',
        payload: { thingUri: 'bm:thing:customer', instance: inst },
      }, model)

      m0 = applyOk(m0, {
        type: 'instance:update',
        payload: { instanceUri: 'bm:inst:cust-1', thingUri: 'bm:thing:customer', changes: { data: { name: 'Updated' } } },
      }, model)

      expect(m0.instances['bm:thing:customer']?.['bm:inst:cust-1']?.data).toEqual({ name: 'Updated' })
    })

    it('rejects update on immutable Event instance', () => {
      let m0 = createEmptyM0State()
      const inst = makeInstance('bm:inst:evt-1', 'bm:event:orderPlaced')
      m0 = applyOk(m0, {
        type: 'instance:upsert',
        payload: { thingUri: 'bm:event:orderPlaced', instance: inst },
      }, model)

      const result = applyM0Command(m0, {
        type: 'instance:update',
        payload: { instanceUri: 'bm:inst:evt-1', thingUri: 'bm:event:orderPlaced', changes: { data: { name: 'Changed' } } },
      }, model)

      expect(result.success).toBe(false)
      expect(result.error).toContain('immutable')
    })

    it('rejects update on immutable Measure instance', () => {
      let m0 = createEmptyM0State()
      const inst = makeInstance('bm:inst:msr-1', 'bm:measure:revenue')
      m0 = applyOk(m0, {
        type: 'instance:upsert',
        payload: { thingUri: 'bm:measure:revenue', instance: inst },
      }, model)

      const result = applyM0Command(m0, {
        type: 'instance:update',
        payload: { instanceUri: 'bm:inst:msr-1', thingUri: 'bm:measure:revenue', changes: { data: { value: 999 } } },
      }, model)

      expect(result.success).toBe(false)
      expect(result.error).toContain('immutable')
    })
  })

  describe('instance:delete', () => {
    it('deletes a Thing instance', () => {
      let m0 = createEmptyM0State()
      m0 = applyOk(m0, {
        type: 'instance:upsert',
        payload: { thingUri: 'bm:thing:customer', instance: makeInstance('bm:inst:cust-1', 'bm:thing:customer') },
      }, model)

      m0 = applyOk(m0, {
        type: 'instance:delete',
        payload: { instanceUri: 'bm:inst:cust-1', thingUri: 'bm:thing:customer' },
      }, model)

      expect(m0.instances['bm:thing:customer']?.['bm:inst:cust-1']).toBeUndefined()
    })

    it('rejects delete on immutable Event instance', () => {
      let m0 = createEmptyM0State()
      m0 = applyOk(m0, {
        type: 'instance:upsert',
        payload: { thingUri: 'bm:event:orderPlaced', instance: makeInstance('bm:inst:evt-1', 'bm:event:orderPlaced') },
      }, model)

      const result = applyM0Command(m0, {
        type: 'instance:delete',
        payload: { instanceUri: 'bm:inst:evt-1', thingUri: 'bm:event:orderPlaced' },
      }, model)

      expect(result.success).toBe(false)
      expect(result.error).toContain('immutable')
    })
  })

  describe('pipelineRun commands', () => {
    it('start → progress → complete round-trip', () => {
      let m0 = createEmptyM0State()
      const run: PipelineRun = {
        uri: 'bm:run:1', pipelineUri: 'bm:pipe:stripe',
        status: 'running', startedAt: '2026-04-10T00:00:00Z',
      }

      m0 = applyOk(m0, { type: 'pipelineRun:start', payload: { run } }, model)
      expect(m0.pipelineRuns['bm:run:1']?.status).toBe('running')

      m0 = applyOk(m0, { type: 'pipelineRun:progress', payload: { runUri: 'bm:run:1', processed: 50, failed: 2 } }, model)
      expect(m0.pipelineRuns['bm:run:1']?.recordsProcessed).toBe(50)

      m0 = applyOk(m0, { type: 'pipelineRun:complete', payload: { runUri: 'bm:run:1', status: 'completed' } }, model)
      expect(m0.pipelineRuns['bm:run:1']?.status).toBe('completed')
    })
  })

  describe('writebackQueue commands', () => {
    it('enqueue → fail → ack round-trip', () => {
      let m0 = createEmptyM0State()
      const item: WritebackQueueItem = {
        uri: 'bm:wb:1', pipelineUri: 'bm:pipe:stripe', instanceUri: 'bm:inst:cust-1',
        reverseMappedPayload: { name: 'Jane' }, idempotencyKey: 'key-1',
        attemptCount: 0, status: 'pending', enqueuedAt: '2026-04-10T00:00:00Z',
      }

      m0 = applyOk(m0, { type: 'writebackQueue:enqueue', payload: { item } }, model)
      expect(m0.writebackQueue['bm:wb:1']?.status).toBe('pending')

      m0 = applyOk(m0, { type: 'writebackQueue:fail', payload: { itemUri: 'bm:wb:1', error: 'timeout' } }, model)
      expect(m0.writebackQueue['bm:wb:1']?.status).toBe('failed')
      expect(m0.writebackQueue['bm:wb:1']?.attemptCount).toBe(1)

      m0 = applyOk(m0, { type: 'writebackQueue:ack', payload: { itemUri: 'bm:wb:1' } }, model)
      expect(m0.writebackQueue['bm:wb:1']?.status).toBe('acked')
    })
  })
})

describe('isM0Command', () => {
  it('identifies M0 commands', () => {
    expect(isM0Command({ type: 'instance:upsert' })).toBe(true)
    expect(isM0Command({ type: 'pipelineRun:start' })).toBe(true)
    expect(isM0Command({ type: 'writebackQueue:enqueue' })).toBe(true)
    expect(isM0Command({ type: 'simRun:complete' })).toBe(true)
  })

  it('rejects M1 commands', () => {
    expect(isM0Command({ type: 'context:add' })).toBe(false)
    expect(isM0Command({ type: 'facet:update' })).toBe(false)
    expect(isM0Command({ type: 'link:add' })).toBe(false)
  })
})

describe('M0_COMMAND_SCOPE', () => {
  it('has entries for all 28 M0 command types', () => {
    expect(Object.keys(M0_COMMAND_SCOPE)).toHaveLength(28)
  })

  it('marks in-progress operations as device-local', () => {
    expect(M0_COMMAND_SCOPE['pipelineRun:start']).toBe('device-local')
    expect(M0_COMMAND_SCOPE['simRun:start']).toBe('device-local')
    expect(M0_COMMAND_SCOPE['replayPoint:create']).toBe('device-local')
  })

  it('marks completed results and durable queue items as shared', () => {
    expect(M0_COMMAND_SCOPE['pipelineRun:complete']).toBe('shared')
    expect(M0_COMMAND_SCOPE['writebackQueue:enqueue']).toBe('shared')
    expect(M0_COMMAND_SCOPE['deployment:record']).toBe('shared')
    expect(M0_COMMAND_SCOPE['instance:upsert']).toBe('shared')
  })
})

describe('computeM0Inverse', () => {
  const model = makeModel()

  it('instance:upsert (create) → instance:delete', () => {
    const m0 = createEmptyM0State()
    const inst = makeInstance('bm:inst:cust-1', 'bm:thing:customer')
    const cmd: M0Command = { type: 'instance:upsert', payload: { thingUri: 'bm:thing:customer', instance: inst } }

    const after = applyOk(m0, cmd, model)
    const inv = computeM0Inverse(cmd, m0, after)

    expect(inv.type).toBe('instance:delete')
  })

  it('instance:upsert (overwrite) → instance:upsert with previous value', () => {
    let m0 = createEmptyM0State()
    const inst1 = makeInstance('bm:inst:cust-1', 'bm:thing:customer')
    m0 = applyOk(m0, {
      type: 'instance:upsert',
      payload: { thingUri: 'bm:thing:customer', instance: inst1 },
    }, model)

    const inst2 = { ...inst1, data: { name: 'Updated' } }
    const cmd: M0Command = { type: 'instance:upsert', payload: { thingUri: 'bm:thing:customer', instance: inst2 } }
    const after = applyOk(m0, cmd, model)
    const inv = computeM0Inverse(cmd, m0, after)

    expect(inv.type).toBe('instance:upsert')
    if (inv.type === 'instance:upsert') {
      expect(inv.payload.instance.data.name).toBe('Test')
    }
  })

  it('instance:delete → instance:upsert restoring the deleted instance', () => {
    let m0 = createEmptyM0State()
    const inst = makeInstance('bm:inst:cust-1', 'bm:thing:customer')
    m0 = applyOk(m0, {
      type: 'instance:upsert',
      payload: { thingUri: 'bm:thing:customer', instance: inst },
    }, model)

    const cmd: M0Command = { type: 'instance:delete', payload: { instanceUri: 'bm:inst:cust-1', thingUri: 'bm:thing:customer' } }
    const after = applyOk(m0, cmd, model)
    const inv = computeM0Inverse(cmd, m0, after)

    expect(inv.type).toBe('instance:upsert')
    if (inv.type === 'instance:upsert') {
      expect(inv.payload.instance.uri).toBe('bm:inst:cust-1')
    }
  })

  it('writebackQueue:enqueue → writebackQueue:drop', () => {
    const m0 = createEmptyM0State()
    const item: WritebackQueueItem = {
      uri: 'bm:wb:1', pipelineUri: 'p', instanceUri: 'i',
      reverseMappedPayload: {}, idempotencyKey: 'k',
      attemptCount: 0, status: 'pending', enqueuedAt: '2026-04-10T00:00:00Z',
    }
    const cmd: M0Command = { type: 'writebackQueue:enqueue', payload: { item } }
    const after = applyOk(m0, cmd, model)
    const inv = computeM0Inverse(cmd, m0, after)

    expect(inv.type).toBe('writebackQueue:drop')
  })

  it('instance:link ↔ instance:unlink are symmetric inverses', () => {
    const m0 = createEmptyM0State()
    const cmd: M0Command = { type: 'instance:link', payload: { sourceUri: 'a', targetUri: 'b', predicate: 'owns' } }
    const inv = computeM0Inverse(cmd, m0, m0)
    expect(inv.type).toBe('instance:unlink')

    const inv2 = computeM0Inverse(inv, m0, m0)
    expect(inv2.type).toBe('instance:link')
  })
})

describe('M0 entity classes in DSL registry', () => {
  it('registers 8 M0 entity classes', async () => {
    // Importing core/index registers all types including M0 entity classes
    await import('../../core/index')
    const { listFacetTypes } = await import('../../dsl/registry')

    const m0Types = listFacetTypes().filter(t => t.id.startsWith('m0:'))
    expect(m0Types).toHaveLength(8)

    const classIds = m0Types.map(t => t.entityClassId).sort()
    expect(classIds).toEqual([
      'DeploymentRecord',
      'Instance',
      'PipelineRun',
      'ReplayPoint',
      'RetryEntry',
      'SimulationRun',
      'SuppressionRecord',
      'WritebackQueueItem',
    ])
  })

  it('M0 entity classes have no facetKey', async () => {
    await import('../../core/index')
    const { listFacetTypes } = await import('../../dsl/registry')

    const m0Types = listFacetTypes().filter(t => t.id.startsWith('m0:'))
    for (const t of m0Types) {
      expect(t.facetKey).toBeUndefined()
    }
  })
})

describe('M0 operational predicates in DSL registry', () => {
  it('registers 10 operational predicates', async () => {
    await import('../../core/index')
    const { listPredicates } = await import('../../dsl/registry')

    const opPredicates = [
      'retried', 'suppressed', 'replayed', 'regenerated', 'runFor',
      'producedBy', 'deployedFrom', 'simulatedAgainst', 'pendingWriteback',
      'boundToEnvironment',
    ]

    for (const id of opPredicates) {
      const pred = listPredicates().find(p => p.id === id)
      expect(pred, `predicate '${id}' should be registered`).toBeDefined()
    }
  })
})

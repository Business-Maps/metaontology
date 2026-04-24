import { describe, it, expect, vi } from 'vitest'
import { processWriteback } from '../writebackRuntime'
import { reverseMap } from '../mappingEngine'
import type { WritebackDeps } from '../writebackRuntime'
import type { Pipeline } from '../../types/context'
import type { M0Command } from '../../types/commands'

// ── Helpers ───────────────────────────────────────────────────────────────

function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    uri: 'bm:pipe:stripe',
    name: 'Stripe Customer Sync',
    strategy: 'materialize',
    direction: 'two-way',
    sourceOfTruth: 'local',
    writeback: {
      enabled: true,
      mapping: {
        identity: { externalId: '$.externalId' },
        fields: { name: '$.name', email: '$.email' },
      },
      deleteMode: 'soft',
    },
    ...overrides,
  }
}

function makeDeps(overrides: Partial<WritebackDeps> = {}): WritebackDeps & { dispatched: M0Command[] } {
  const dispatched: M0Command[] = []
  return {
    dispatched,
    getPopulatingPipelines: overrides.getPopulatingPipelines ?? (() => ['bm:pipe:stripe']),
    resolvePipeline: overrides.resolvePipeline ?? (() => makePipeline()),
    dispatchM0: overrides.dispatchM0 ?? ((cmd: M0Command) => dispatched.push(cmd)),
    executeWriteback: overrides.executeWriteback ?? (async () => true),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('processWriteback', () => {
  it('returns null when Thing has no populating pipeline', async () => {
    const deps = makeDeps({ getPopulatingPipelines: () => [] })
    const result = await processWriteback(
      'bm:thing:customer', 'bm:inst:1', { name: 'Jane' }, 'cus_1', deps,
    )
    expect(result).toBeNull()
  })

  it('returns null when pipeline is not two-way', async () => {
    const deps = makeDeps({
      resolvePipeline: () => makePipeline({ direction: 'pull' }),
    })
    const result = await processWriteback(
      'bm:thing:customer', 'bm:inst:1', { name: 'Jane' }, 'cus_1', deps,
    )
    expect(result).toBeNull()
  })

  it('returns null when writeback is disabled', async () => {
    const deps = makeDeps({
      resolvePipeline: () => makePipeline({
        writeback: { enabled: false, mapping: { identity: { externalId: '$.id' }, fields: {} }, deleteMode: 'disabled' },
      }),
    })
    const result = await processWriteback(
      'bm:thing:customer', 'bm:inst:1', { name: 'Jane' }, 'cus_1', deps,
    )
    expect(result).toBeNull()
  })

  it('returns null when no externalId', async () => {
    const deps = makeDeps()
    const result = await processWriteback(
      'bm:thing:customer', 'bm:inst:1', { name: 'Jane' }, undefined, deps,
    )
    expect(result).toBeNull()
  })

  it('enqueues WritebackQueueItem then acks on success', async () => {
    const deps = makeDeps({ executeWriteback: async () => true })

    const result = await processWriteback(
      'bm:thing:customer', 'bm:inst:1', { name: 'Jane', email: 'jane@co.com' }, 'cus_1', deps,
    )

    expect(result).not.toBeNull()
    expect(result!.dispatched).toBe(true)

    // Should have dispatched enqueue then ack
    expect(deps.dispatched).toHaveLength(2)
    expect(deps.dispatched[0]!.type).toBe('writebackQueue:enqueue')
    expect(deps.dispatched[1]!.type).toBe('writebackQueue:ack')

    // The queue item should carry the reverse-mapped payload
    const enqueueCmd = deps.dispatched[0] as Extract<M0Command, { type: 'writebackQueue:enqueue' }>
    expect(enqueueCmd.payload.item.reverseMappedPayload).toEqual({ name: 'Jane', email: 'jane@co.com' })
    expect(enqueueCmd.payload.item.status).toBe('pending')
    expect(enqueueCmd.payload.item.pipelineUri).toBe('bm:pipe:stripe')
  })

  it('enqueues then fails on transport failure', async () => {
    const deps = makeDeps({ executeWriteback: async () => false })

    const result = await processWriteback(
      'bm:thing:customer', 'bm:inst:1', { name: 'Jane' }, 'cus_1', deps,
    )

    expect(result!.dispatched).toBe(false)
    expect(result!.error).toBeDefined()

    expect(deps.dispatched).toHaveLength(2)
    expect(deps.dispatched[0]!.type).toBe('writebackQueue:enqueue')
    expect(deps.dispatched[1]!.type).toBe('writebackQueue:fail')
  })

  it('enqueues then fails on transport exception', async () => {
    const deps = makeDeps({
      executeWriteback: async () => { throw new Error('network timeout') },
    })

    const result = await processWriteback(
      'bm:thing:customer', 'bm:inst:1', { name: 'Jane' }, 'cus_1', deps,
    )

    expect(result!.dispatched).toBe(false)
    expect(result!.error).toContain('network timeout')

    expect(deps.dispatched).toHaveLength(2)
    expect(deps.dispatched[1]!.type).toBe('writebackQueue:fail')
  })

  it('sourceOfTruth local - failure is a warning, not a rollback', async () => {
    const deps = makeDeps({
      resolvePipeline: () => makePipeline({ sourceOfTruth: 'local' }),
      executeWriteback: async () => false,
    })

    const result = await processWriteback(
      'bm:thing:customer', 'bm:inst:1', { name: 'Jane' }, 'cus_1', deps,
    )

    expect(result!.dispatched).toBe(false)
    expect(result!.error).toContain('local is authoritative')
  })

  it('sourceOfTruth remote - failure surfaces as unacknowledged', async () => {
    const deps = makeDeps({
      resolvePipeline: () => makePipeline({ sourceOfTruth: 'remote' }),
      executeWriteback: async () => false,
    })

    const result = await processWriteback(
      'bm:thing:customer', 'bm:inst:1', { name: 'Jane' }, 'cus_1', deps,
    )

    expect(result!.dispatched).toBe(false)
    expect(result!.error).toContain('remote did not acknowledge')
  })

  it('idempotency: each call produces a unique queue item URI', async () => {
    const deps = makeDeps()

    const r1 = await processWriteback('bm:thing:customer', 'bm:inst:1', { name: 'A' }, 'cus_1', deps)
    const r2 = await processWriteback('bm:thing:customer', 'bm:inst:1', { name: 'B' }, 'cus_1', deps)

    expect(r1!.queueItemUri).not.toBe(r2!.queueItemUri)
  })
})

describe('reverseMap', () => {
  it('maps instance fields back to source format', () => {
    const result = reverseMap(
      { name: 'Jane Doe', email: 'jane@co.com', age: 30 },
      'cus_1',
      {
        identity: { externalId: '$.externalId' },
        fields: { name: '$.name', email: '$.email' },
      },
    )

    expect(result.externalId).toBe('cus_1')
    expect(result.data).toEqual({ name: 'Jane Doe', email: 'jane@co.com' })
    // age is not in the mapping, so it's excluded
    expect(result.data).not.toHaveProperty('age')
  })

  it('applies transform functions during reverse mapping', () => {
    const result = reverseMap(
      { name: 'Jane Doe' },
      'cus_1',
      {
        identity: { externalId: '$.id' },
        fields: { name: { source: '$.name', transform: 'uppercase' } },
      },
      {
        invokeTransform: (_fnId, value) => String(value).toUpperCase(),
      },
    )

    expect(result.data.name).toBe('JANE DOE')
  })

  it('uses defaultValue when field is missing', () => {
    const result = reverseMap(
      {},
      'cus_1',
      {
        identity: { externalId: '$.id' },
        fields: { status: { source: '$.status', defaultValue: 'active' } },
      },
    )

    expect(result.data.status).toBe('active')
  })
})

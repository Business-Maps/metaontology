/**
 * PipelineRuntime tests - being called
 *   8. continuous - start() schedules + stop() halts
 *   9. Flow 1 (Stripe Customer Sync) - the canonical end-to-end test
 *      lives in pipelineFlow1.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPipelineRuntime, type PipelineBindings } from '../pipelineRuntime'
import { createFakeTransport } from '../transports/fakeTransport'
import { createLocalProvider } from '../providers/localProvider'
import type { Pipeline as BmPipeline, PipelineMapping } from '../../types/context'
import type { TransportDataSource } from '../transports/types'
import type { PipelineEvent } from '../pipelineEvents'

const STRIPE_DS: TransportDataSource = {
  id: 'ds-stripe',
  transport: 'http',
  endpoint: 'https://api.stripe.com',
  credentialRef: 'stripe_sk',
  authType: 'bearer',
}

function makePipeline(id: string, mapping: PipelineMapping, overrides: Partial<BmPipeline> = {}): BmPipeline {
  return {
    uri: id,
    name: id,
    tags: [],
    description: '',
    mapping,
    strategy: 'materialize',
    direction: 'pull',
    schedule: { kind: 'on-demand' },
    stereotype: 'import',
    ...overrides,
  } as BmPipeline
}

const CUSTOMER_MAPPING: PipelineMapping = {
  iterate: '$.data',
  identity: { externalId: '$.id' },
  fields: {
    email: '$.email',
    name: '$.name',
  },
}

function makeBindings(overrides: Partial<PipelineBindings> = {}): PipelineBindings {
  const transport = createFakeTransport()
  const provider = createLocalProvider({ thingId: 'thing-customer' })
  return {
    transport,
    provider,
    dataSource: {
      ...STRIPE_DS,
      config: { targetThingId: 'thing-customer' },
    },
    ...overrides,
  }
}

// Helper: collect all events into a typed array
function collectEvents(runtime: ReturnType<typeof createPipelineRuntime>): PipelineEvent[] {
  const events: PipelineEvent[] = []
  runtime.events.subscribe(e => events.push(e))
  return events
}

// ── 1. runOnce ─────────────────────────────────────────────────────────────

describe('PipelineRuntime - runOnce()', () => {
  it('executes a single run end-to-end and returns ok status', async () => {
    const runtime = createPipelineRuntime()
    const bindings = makeBindings()
    const transport = bindings.transport as ReturnType<typeof createFakeTransport>

    transport.setResponse(undefined, {
      success: true,
      data: {
        data: [
          { id: 'cus_1', email: 'a@b.com', name: 'Alice' },
          { id: 'cus_2', email: 'b@b.com', name: 'Bob' },
        ],
      },
    })

    const pipeline = makePipeline('pipe-1', CUSTOMER_MAPPING)
    runtime.register(pipeline, bindings)

    const result = await runtime.runOnce('pipe-1')
    expect(result.status).toBe('ok')
    expect(result.fetched).toBe(2)
    expect(result.mapped).toBe(2)
    expect(result.written).toBe(2)
    expect(result.errors).toBe(0)
  })

  it('writes mapped instances to the bound provider', async () => {
    const runtime = createPipelineRuntime()
    const bindings = makeBindings()
    const transport = bindings.transport as ReturnType<typeof createFakeTransport>

    transport.setResponse(undefined, {
      success: true,
      data: {
        data: [{ id: 'cus_1', email: 'a@b.com', name: 'Alice' }],
      },
    })

    const pipeline = makePipeline('pipe-1', CUSTOMER_MAPPING)
    runtime.register(pipeline, bindings)
    await runtime.runOnce('pipe-1')

    const stored = await bindings.provider.findByThing('thing-customer')
    expect(stored).toHaveLength(1)
    expect(stored[0]!.attributes.email?.value).toBe('a@b.com')
  })

  it('throws when running an unregistered pipeline', async () => {
    const runtime = createPipelineRuntime()
    await expect(runtime.runOnce('not-registered')).rejects.toThrow(/not registered/)
  })
})

// ── 5. errors + 6. events ─────────────────────────────────────────────────

describe('PipelineRuntime - errors + events', () => {
  it('emits started → fetched → mapped → written → completed for a happy run', async () => {
    const runtime = createPipelineRuntime()
    const events = collectEvents(runtime)
    const bindings = makeBindings()
    const transport = bindings.transport as ReturnType<typeof createFakeTransport>
    transport.setResponse(undefined, {
      success: true,
      data: { data: [{ id: 'cus_1', email: 'a@b.com', name: 'Alice' }] },
    })

    const pipeline = makePipeline('pipe-1', CUSTOMER_MAPPING)
    runtime.register(pipeline, bindings)
    await runtime.runOnce('pipe-1')

    const types = events.map(e => e.type)
    expect(types).toContain('pipeline.run.started')
    expect(types).toContain('pipeline.run.fetched')
    expect(types).toContain('pipeline.run.mapped')
    expect(types).toContain('pipeline.run.written')
    expect(types).toContain('pipeline.run.completed')
    // Verify ordering - started must come first, completed last
    expect(types[0]).toBe('pipeline.run.started')
    expect(types[types.length - 1]).toBe('pipeline.run.completed')
  })

  it('emits an error event + completed:failed when the transport fails', async () => {
    const runtime = createPipelineRuntime()
    const events = collectEvents(runtime)
    const bindings = makeBindings()
    const transport = bindings.transport as ReturnType<typeof createFakeTransport>
    transport.failNextN(1, 'Network down')

    const pipeline = makePipeline('pipe-1', CUSTOMER_MAPPING)
    runtime.register(pipeline, bindings)
    const result = await runtime.runOnce('pipe-1')

    expect(result.status).toBe('failed')
    const errorEvent = events.find(e => e.type === 'pipeline.run.error')
    expect(errorEvent).toBeDefined()
    expect((errorEvent as any).phase).toBe('fetch')

    const completed = events.find(e => e.type === 'pipeline.run.completed')
    expect(completed).toBeDefined()
    expect((completed as any).status).toBe('failed')
  })

  it('reports partial status when individual records fail mapping', async () => {
    const runtime = createPipelineRuntime()
    const bindings = makeBindings()
    const transport = bindings.transport as ReturnType<typeof createFakeTransport>
    transport.setResponse(undefined, {
      success: true,
      data: {
        data: [
          { id: 'cus_1', email: 'a@b.com', name: 'Alice' }, // ok
          { id: 'cus_2', email: 'b@b.com' }, // missing name → mapping error
        ],
      },
    })

    const pipeline = makePipeline('pipe-1', CUSTOMER_MAPPING)
    runtime.register(pipeline, bindings)
    const result = await runtime.runOnce('pipe-1')

    expect(result.status).toBe('partial')
    expect(result.mapped).toBe(1)
    expect(result.errors).toBe(1)
    expect(result.written).toBe(1)
  })
})

// ── 3. incremental sync via cursors ───────────────────────────────────────

describe('PipelineRuntime - incremental sync', () => {
  it('advances cursor after each successful run', async () => {
    const runtime = createPipelineRuntime()
    const bindings = makeBindings()
    const transport = bindings.transport as ReturnType<typeof createFakeTransport>
    transport.setResponse(undefined, {
      success: true,
      data: {
        data: [
          { id: 'cus_1', email: 'a@b.com', name: 'Alice' },
          { id: 'cus_2', email: 'b@b.com', name: 'Bob' },
        ],
      },
    })

    const pipeline = makePipeline('pipe-1', CUSTOMER_MAPPING)
    runtime.register(pipeline, bindings)

    expect(runtime.getCursor('pipe-1')).toBeNull()
    await runtime.runOnce('pipe-1')
    // Cursor advances to the externalId of the last instance
    expect(runtime.getCursor('pipe-1')).toBe('cus_2')
  })

  it('forwards the cursor as a `since` query param on subsequent runs', async () => {
    const runtime = createPipelineRuntime()
    const bindings = makeBindings()
    const transport = bindings.transport as ReturnType<typeof createFakeTransport>
    transport.setResponse(undefined, {
      success: true,
      data: { data: [{ id: 'cus_1', email: 'a@b.com', name: 'Alice' }] },
    })

    const pipeline = makePipeline('pipe-1', CUSTOMER_MAPPING)
    runtime.register(pipeline, bindings)

    await runtime.runOnce('pipe-1') // first run, no cursor yet
    expect(transport.calls[0]!.request.params).toBeUndefined()

    await runtime.runOnce('pipe-1') // second run, cursor now 'cus_1'
    expect(transport.calls[1]!.request.params).toEqual({ since: 'cus_1' })
  })

  it('emits a cursor.advanced event when the cursor changes', async () => {
    const runtime = createPipelineRuntime()
    const events = collectEvents(runtime)
    const bindings = makeBindings()
    const transport = bindings.transport as ReturnType<typeof createFakeTransport>
    transport.setResponse(undefined, {
      success: true,
      data: { data: [{ id: 'cus_1', email: 'a@b.com', name: 'Alice' }] },
    })

    const pipeline = makePipeline('pipe-1', CUSTOMER_MAPPING)
    runtime.register(pipeline, bindings)
    await runtime.runOnce('pipe-1')

    const cursorEvent = events.find(e => e.type === 'pipeline.cursor.advanced')
    expect(cursorEvent).toBeDefined()
    expect((cursorEvent as any).previous).toBeNull()
    expect((cursorEvent as any).current).toBe('cus_1')
  })

  it('respects custom cursorKey from DataSource config', async () => {
    const runtime = createPipelineRuntime()
    const transport = createFakeTransport()
    transport.setResponse(undefined, {
      success: true,
      data: { data: [{ id: 'cus_1', email: 'a@b.com', name: 'Alice' }] },
    })

    const pipeline = makePipeline('pipe-1', CUSTOMER_MAPPING)
    runtime.register(pipeline, {
      transport,
      provider: createLocalProvider({ thingId: 'thing-customer' }),
      dataSource: {
        ...STRIPE_DS,
        config: { targetThingId: 'thing-customer', cursorKey: 'after_id' },
      },
    })

    await runtime.runOnce('pipe-1')
    await runtime.runOnce('pipe-1')

    expect(transport.calls[1]!.request.params).toEqual({ after_id: 'cus_1' })
  })
})

// ── 4. rate limit (token bucket) ──────────────────────────────────────────

describe('PipelineRuntime - rate limiting', () => {
  it('emits rate-limited events when the bucket is empty', async () => {
    const runtime = createPipelineRuntime()
    const events = collectEvents(runtime)
    const bindings = makeBindings()
    const transport = bindings.transport as ReturnType<typeof createFakeTransport>
    transport.setResponse(undefined, {
      success: true,
      data: { data: [{ id: 'cus_1', email: 'a@b.com', name: 'Alice' }] },
    })

    // Token bucket: 100 req/sec, burst of 1 → second run must wait ~10ms
    const pipeline = makePipeline('pipe-1', CUSTOMER_MAPPING, {
      rateLimit: { requestsPerSecond: 100, burstSize: 1 },
    })
    runtime.register(pipeline, bindings)

    await runtime.runOnce('pipe-1')
    await runtime.runOnce('pipe-1')

    const rateLimited = events.find(e => e.type === 'pipeline.rate-limited')
    expect(rateLimited).toBeDefined()
    expect((rateLimited as any).waitMs).toBeGreaterThan(0)
  })

  it('does not emit rate-limited when burst size accommodates the run', async () => {
    const runtime = createPipelineRuntime()
    const events = collectEvents(runtime)
    const bindings = makeBindings()
    const transport = bindings.transport as ReturnType<typeof createFakeTransport>
    transport.setResponse(undefined, {
      success: true,
      data: { data: [{ id: 'cus_1', email: 'a@b.com', name: 'Alice' }] },
    })

    const pipeline = makePipeline('pipe-1', CUSTOMER_MAPPING, {
      rateLimit: { requestsPerSecond: 100, burstSize: 100 },
    })
    runtime.register(pipeline, bindings)

    await runtime.runOnce('pipe-1')
    const rateLimited = events.find(e => e.type === 'pipeline.rate-limited')
    expect(rateLimited).toBeUndefined()
  })
})

// ── 2 + 7 + 8. scheduling (on-demand / cron / continuous) ──────────────────

describe('PipelineRuntime - scheduling', () => {
  it('on-demand schedule does NOT auto-run when start() is called', async () => {
    const runtime = createPipelineRuntime()
    const bindings = makeBindings()
    const transport = bindings.transport as ReturnType<typeof createFakeTransport>
    transport.setResponse(undefined, { success: true, data: { data: [] } })

    const pipeline = makePipeline('pipe-1', CUSTOMER_MAPPING, {
      schedule: { kind: 'on-demand' },
    })
    runtime.register(pipeline, bindings)
    runtime.start()
    // Wait a tick - should NOT auto-run
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(transport.calls).toHaveLength(0)
    runtime.stop()
  })

  it('cron schedule fires runOnce on the timer interval', async () => {
    const fakeTimer = {
      handlers: [] as Array<{ fn: () => void; ms: number; cancelled: boolean }>,
      setTimer(fn: () => void, ms: number) {
        const handler = { fn, ms, cancelled: false }
        this.handlers.push(handler)
        return { clear: () => { handler.cancelled = true } }
      },
      tick() {
        const next = this.handlers.find(h => !h.cancelled)
        if (next) {
          next.cancelled = true
          next.fn()
        }
      },
    }

    const runtime = createPipelineRuntime({
      setTimer: (fn, ms) => fakeTimer.setTimer(fn, ms),
    })
    const bindings = makeBindings()
    const transport = bindings.transport as ReturnType<typeof createFakeTransport>
    transport.setResponse(undefined, { success: true, data: { data: [] } })

    const pipeline = makePipeline('pipe-1', CUSTOMER_MAPPING, {
      schedule: { kind: 'cron' as const, expression: 'every 5000ms' } as any,
    })
    runtime.register(pipeline, bindings)
    runtime.start()

    // The timer was scheduled with 5000ms
    expect(fakeTimer.handlers).toHaveLength(1)
    expect(fakeTimer.handlers[0]!.ms).toBe(5000)

    // Manually fire the timer
    fakeTimer.tick()
    // Wait for the async runOnce to complete
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(transport.calls).toHaveLength(1)

    runtime.stop()
  })

  it('stop() halts pending scheduled timers', async () => {
    const cancelled: Array<boolean> = []
    const fakeTimer = {
      setTimer(_fn: () => void, _ms: number) {
        const handler = { cancelled: false }
        cancelled.push(false)
        return {
          clear: () => {
            handler.cancelled = true
            cancelled[cancelled.length - 1] = true
          },
        }
      },
    }

    const runtime = createPipelineRuntime({
      setTimer: (fn, ms) => fakeTimer.setTimer(fn, ms),
    })
    const bindings = makeBindings()
    const pipeline = makePipeline('pipe-1', CUSTOMER_MAPPING, {
      schedule: { kind: 'continuous' },
    })
    runtime.register(pipeline, bindings)
    runtime.start()
    expect(cancelled).toHaveLength(1)

    runtime.stop()
    expect(cancelled[0]).toBe(true)
  })

  it('emits an error for an unparseable cron expression', () => {
    const runtime = createPipelineRuntime({
      setTimer: () => ({ clear: () => {} }),
    })
    const events = collectEvents(runtime)
    const bindings = makeBindings()
    const pipeline = makePipeline('pipe-1', CUSTOMER_MAPPING, {
      schedule: { kind: 'cron' as const, expression: 'every 6 hours' } as any,
    })
    runtime.register(pipeline, bindings)
    runtime.start()

    const errorEvent = events.find(e => e.type === 'pipeline.run.error')
    expect(errorEvent).toBeDefined()
    expect((errorEvent as any).phase).toBe('schedule')
    expect((errorEvent as any).reason).toMatch(/Unparseable cron/)
  })
})

// ── unregister + getCursor ────────────────────────────────────────────────

describe('PipelineRuntime - registration lifecycle', () => {
  it('unregister stops scheduled timers and removes the pipeline', async () => {
    const runtime = createPipelineRuntime()
    const bindings = makeBindings()
    const pipeline = makePipeline('pipe-1', CUSTOMER_MAPPING)
    runtime.register(pipeline, bindings)
    runtime.unregister('pipe-1')

    await expect(runtime.runOnce('pipe-1')).rejects.toThrow(/not registered/)
  })
})

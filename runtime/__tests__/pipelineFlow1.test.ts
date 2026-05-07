/**
 * Flow 1 - Stripe Customer Sync end-to-end
 * → Transport (Phase 9) → Pipeline (Phase 8)
 *     → mapping engine (Phase 8) → Provider (Phase 9)
 *     → PipelineRuntime (Phase 10) → events (Phase 10)
 *
 * The "fake Stripe API" is a FakeTransport seeded with realistic
 * Stripe response shapes. Everything else - runtime, mapping engine,
 * providers, event bus - is the real Phase 6-10 code.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createPipelineRuntime } from '../pipelineRuntime'
import { createFakeTransport, type FakeTransport } from '../transports/fakeTransport'
import { createLocalProvider } from '../providers/localProvider'
import { useSecretStore, resetSecretStore } from '../secretStore'
import type { TransportDataSource } from '../transports/types'
import type { Pipeline as BmPipeline, PipelineMapping } from '../../types/context'
import type { PipelineEvent } from '../pipelineEvents'

// ── The "Stripe API" fake ──────────────────────────────────────────────────

/**
 * Realistic Stripe customer list payload - matches what Stripe's
 * /v1/customers endpoint actually returns.
 */
function stripeCustomerListResponse(customers: Array<{
  id: string
  email: string
  name: string
  livemode?: boolean
  metadata?: Record<string, string>
}>) {
  return {
    object: 'list',
    has_more: false,
    url: '/v1/customers',
    data: customers.map(c => ({
      id: c.id,
      object: 'customer',
      email: c.email,
      name: c.name,
      created: 1700000000,
      livemode: c.livemode ?? true,
      metadata: c.metadata ?? {},
    })),
  }
}

/** Authoring-time Stripe DataSource. */
const STRIPE_DATASOURCE: TransportDataSource = {
  id: 'ds-stripe-prod',
  transport: 'http',
  endpoint: 'https://api.stripe.com/v1',
  credentialRef: 'stripe_prod_key',
  authType: 'bearer',
  config: {
    targetThingId: 'thing-customer',
    cursorKey: 'starting_after',
  },
}

/** The Pipeline mapping that turns Stripe customers into Customer instances. */
const STRIPE_CUSTOMER_MAPPING: PipelineMapping = {
  iterate: '$.data',
  identity: { externalId: '$.id' },
  fields: {
    email: '$.email',
    name: '$.name',
    isLive: '$.livemode',
  },
  filter: '$.livemode', // skip test-mode customers
}

/** The Pipeline definition. */
const STRIPE_CUSTOMER_PIPELINE: BmPipeline = {
  uri: 'pipe-stripe-customer-sync',
  name: 'StripeCustomerSync',
  tags: ['integration', 'stripe'],
  description: 'Pulls Stripe customers and populates the Customer Thing',
  mapping: STRIPE_CUSTOMER_MAPPING,
  strategy: 'materialize',
  direction: 'pull',
  schedule: { kind: 'on-demand' },
  stereotype: 'sync',
} as BmPipeline

beforeEach(() => {
  resetSecretStore()
})

// ── The Flow 1 test ───────────────────────────────────────────────────────

describe('Flow 1 - Stripe Customer Sync end-to-end', () => {
  function setupRuntime() {
    // 1. Bind the secret (simulating the user pasting their key into
    //    the DataSource UI). The secret never enters the model - it
    //    lives in the Phase 7 secret store.
    useSecretStore().set('stripe_prod_key', { apiKey: 'sk_live_FAKE_BUT_REALISTIC' })

    // 2. Create the FakeTransport that stands in for the real Stripe API.
    const transport = createFakeTransport({ kind: 'http' })

    // 3. Create the target provider for Customer instances. In a
    //    real deployment this would be IDB-backed via Phase 9.5.
    const customerProvider = createLocalProvider({ thingId: 'thing-customer' })

    // 4. Create the runtime and register the pipeline.
    const runtime = createPipelineRuntime()
    runtime.register(STRIPE_CUSTOMER_PIPELINE, {
      transport,
      provider: customerProvider,
      dataSource: STRIPE_DATASOURCE,
      getCredentials: () => useSecretStore().get('stripe_prod_key') ?? null,
    })

    // 5. Subscribe to all events for assertion.
    const events: PipelineEvent[] = []
    runtime.events.subscribe(e => events.push(e))

    return { runtime, transport, customerProvider, events }
  }

  it('pulls 3 customers from Stripe, filters test-mode, populates Customer Thing', async () => {
    const { runtime, transport, customerProvider, events } = setupRuntime()

    transport.setResponse(undefined, {
      success: true,
      statusCode: 200,
      data: stripeCustomerListResponse([
        { id: 'cus_001', email: 'alice@example.com', name: 'Alice Anderson' },
        { id: 'cus_002', email: 'bob@example.com', name: 'Bob Brown' },
        { id: 'cus_003', email: 'test@example.com', name: 'Test User', livemode: false },
      ]),
    })

    const result = await runtime.runOnce(STRIPE_CUSTOMER_PIPELINE.uri)

    // ── Result ──────────────────────────────────────────────────
    expect(result.status).toBe('ok')
    expect(result.fetched).toBe(3)
    expect(result.mapped).toBe(2) // test-mode customer filtered out
    expect(result.skipped).toBe(1)
    expect(result.errors).toBe(0)
    expect(result.written).toBe(2)

    // ── Provider state ──────────────────────────────────────────
    const stored = await customerProvider.findByThing('thing-customer')
    expect(stored).toHaveLength(2)
    const emails = stored.map(s => s.attributes.email?.value).sort()
    expect(emails).toEqual(['alice@example.com', 'bob@example.com'])

    // ── Cursor ──────────────────────────────────────────────────
    expect(runtime.getCursor(STRIPE_CUSTOMER_PIPELINE.uri)).toBe('cus_002')

    // ── Events ──────────────────────────────────────────────────
    const types = events.map(e => e.type)
    expect(types).toEqual([
      'pipeline.run.started',
      'pipeline.run.fetched',
      'pipeline.run.mapped',
      'pipeline.run.written',
      'pipeline.cursor.advanced',
      'pipeline.run.completed',
    ])

    const completed = events.find(e => e.type === 'pipeline.run.completed') as any
    expect(completed.status).toBe('ok')
    expect(completed.counts).toEqual({
      fetched: 3,
      mapped: 2,
      skipped: 1,
      errors: 0,
      written: 2,
    })
  })

  it('forwards credentials from the secret store to the transport', async () => {
    const { runtime, transport } = setupRuntime()
    transport.setResponse(undefined, {
      success: true,
      data: stripeCustomerListResponse([
        { id: 'cus_001', email: 'a@b.com', name: 'Alice' },
      ]),
    })

    await runtime.runOnce(STRIPE_CUSTOMER_PIPELINE.uri)

    // The transport saw the credentials from the secret store
    expect(transport.calls).toHaveLength(1)
    expect(transport.calls[0]!.credentials).toEqual({ apiKey: 'sk_live_FAKE_BUT_REALISTIC' })
  })

  it('incremental re-run forwards the cursor as starting_after', async () => {
    const { runtime, transport } = setupRuntime()

    // First batch
    transport.setResponse(undefined, {
      success: true,
      data: stripeCustomerListResponse([
        { id: 'cus_001', email: 'a@b.com', name: 'Alice' },
        { id: 'cus_002', email: 'b@b.com', name: 'Bob' },
      ]),
    })
    await runtime.runOnce(STRIPE_CUSTOMER_PIPELINE.uri)
    expect(runtime.getCursor(STRIPE_CUSTOMER_PIPELINE.uri)).toBe('cus_002')

    // Second run - cursor must be forwarded as `starting_after` per
    // the DataSource config (Stripe's actual cursor parameter name)
    transport.setResponse(undefined, {
      success: true,
      data: stripeCustomerListResponse([
        { id: 'cus_003', email: 'c@b.com', name: 'Carol' },
      ]),
    })
    await runtime.runOnce(STRIPE_CUSTOMER_PIPELINE.uri)

    // Verify the second call carried the cursor
    const secondCall = transport.calls[1]!
    expect(secondCall.request.params).toEqual({ starting_after: 'cus_002' })
    expect(runtime.getCursor(STRIPE_CUSTOMER_PIPELINE.uri)).toBe('cus_003')
  })

  it('handles a transient transport failure with a retry-friendly error event', async () => {
    const { runtime, transport, events } = setupRuntime()

    // First call fails (Stripe is down)
    transport.failNextN(1, 'Service unavailable')

    const result = await runtime.runOnce(STRIPE_CUSTOMER_PIPELINE.uri)
    expect(result.status).toBe('failed')

    const errorEvent = events.find(e => e.type === 'pipeline.run.error') as any
    expect(errorEvent.phase).toBe('fetch')
    expect(errorEvent.reason).toMatch(/Service unavailable/)

    // The cursor must NOT have advanced on a failed run
    expect(runtime.getCursor(STRIPE_CUSTOMER_PIPELINE.uri)).toBeNull()

    // Second call (after the user fixes the issue) succeeds - the
    // pipeline picks up where it left off (cursor still null because
    // the failed run never advanced it)
    transport.setResponse(undefined, {
      success: true,
      data: stripeCustomerListResponse([
        { id: 'cus_001', email: 'a@b.com', name: 'Alice' },
      ]),
    })
    const retry = await runtime.runOnce(STRIPE_CUSTOMER_PIPELINE.uri)
    expect(retry.status).toBe('ok')
    expect(retry.written).toBe(1)
  })

  it('emits the documented event payloads with the right field shapes', async () => {
    // This test asserts the EVENT SCHEMA - Phase 10 commits to these
    // field names, types, and ordering. Downstream consumers (Sub-epic
    // E ops console) rely on this contract.
    const { runtime, transport, events } = setupRuntime()
    transport.setResponse(undefined, {
      success: true,
      data: stripeCustomerListResponse([
        { id: 'cus_001', email: 'alice@x.com', name: 'Alice' },
      ]),
    })

    await runtime.runOnce(STRIPE_CUSTOMER_PIPELINE.uri, 'on-demand')

    const started = events.find(e => e.type === 'pipeline.run.started') as any
    expect(started).toMatchObject({
      type: 'pipeline.run.started',
      runId: expect.any(String),
      pipelineId: 'pipe-stripe-customer-sync',
      trigger: 'on-demand',
      startedAt: expect.any(String),
    })

    const fetched = events.find(e => e.type === 'pipeline.run.fetched') as any
    expect(fetched).toMatchObject({
      type: 'pipeline.run.fetched',
      runId: expect.any(String),
      pipelineId: 'pipe-stripe-customer-sync',
      recordCount: 1,
      durationMs: expect.any(Number),
      transportKind: 'http',
    })

    const mapped = events.find(e => e.type === 'pipeline.run.mapped') as any
    expect(mapped).toMatchObject({
      type: 'pipeline.run.mapped',
      mappedCount: 1,
      skippedCount: 0,
      errorCount: 0,
      durationMs: expect.any(Number),
    })

    const written = events.find(e => e.type === 'pipeline.run.written') as any
    expect(written).toMatchObject({
      type: 'pipeline.run.written',
      thingId: 'thing-customer',
      writtenCount: 1,
      durationMs: expect.any(Number),
    })

    const completed = events.find(e => e.type === 'pipeline.run.completed') as any
    expect(completed).toMatchObject({
      type: 'pipeline.run.completed',
      status: 'ok',
      completedAt: expect.any(String),
      durationMs: expect.any(Number),
      counts: {
        fetched: 1,
        mapped: 1,
        skipped: 0,
        errors: 0,
        written: 1,
      },
    })
  })

  it('all events for a single run share the same runId', async () => {
    const { runtime, transport, events } = setupRuntime()
    transport.setResponse(undefined, {
      success: true,
      data: stripeCustomerListResponse([{ id: 'cus_001', email: 'a@b.com', name: 'Alice' }]),
    })

    await runtime.runOnce(STRIPE_CUSTOMER_PIPELINE.uri)

    const runIds = new Set(events.map(e => (e as any).runId))
    expect(runIds.size).toBe(1)
  })
})

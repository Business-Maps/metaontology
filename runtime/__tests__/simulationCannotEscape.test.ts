/**
 * Red-team tests - prove that simulation mode CANNOT write to production
 * through any path, even if a caller constructs WritebackDeps manually.
 *
 * The structural guarantee: `processWriteback()` calls `assertWriteAllowed()`
 * internally, before the transport call. Even a hand-crafted `WritebackDeps`
 * with a direct `executeWriteback` cannot bypass the guard.
 */

import { describe, it, expect, vi } from 'vitest'
import { processWriteback } from '../writebackRuntime'
import { EnvironmentGuardError } from '../environmentGuard'
import type { WritebackDeps } from '../writebackRuntime'
import type { Pipeline } from '../../types/context'
import type { M0Command } from '../../types/commands'

// ── Helpers ──────────────────────────────────────────────────────────────

function makeProdPipeline(): Pipeline {
  return {
    uri: 'bm:pipe:stripe-prod',
    name: 'Stripe Prod Sync',
    strategy: 'materialize',
    direction: 'two-way',
    sourceOfTruth: 'local',
    environment: 'prod',
    writeback: {
      enabled: true,
      mapping: {
        identity: { externalId: '$.externalId' },
        fields: { name: '$.name' },
      },
      deleteMode: 'soft',
    },
  }
}

function makeSimPipeline(): Pipeline {
  return {
    ...makeProdPipeline(),
    uri: 'bm:pipe:stripe-sim',
    name: 'Stripe Sim Sync',
    environment: 'simulation',
  }
}

function makeSimDeps(overrides: Partial<WritebackDeps> = {}): WritebackDeps & { dispatched: M0Command[]; transportCalled: boolean } {
  const dispatched: M0Command[] = []
  let transportCalled = false

  return {
    dispatched,
    get transportCalled() { return transportCalled },
    getPopulatingPipelines: () => ['bm:pipe:stripe-prod'],
    resolvePipeline: () => makeProdPipeline(),
    dispatchM0: (cmd: M0Command) => dispatched.push(cmd),
    executeWriteback: async () => { transportCalled = true; return true },
    environment: 'simulation',
    ...overrides,
  }
}

// ── Red-team scenarios ───────────────────────────────────────────────────

describe('simulation cannot escape', () => {
  it('guard fires BEFORE transport call - transport spy confirms no call', async () => {
    const transportSpy = vi.fn(async () => true)
    const deps = makeSimDeps({
      executeWriteback: transportSpy,
    })

    await expect(processWriteback(
      'bm:thing:customer', 'bm:inst:1', { name: 'Jane' }, 'cus_1', deps,
    )).rejects.toThrow(EnvironmentGuardError)

    // The transport was NEVER called - the guard blocked before it
    expect(transportSpy).not.toHaveBeenCalled()
  })

  it('guard fires BEFORE local enqueue - no M0 commands dispatched', async () => {
    const deps = makeSimDeps()

    await expect(processWriteback(
      'bm:thing:customer', 'bm:inst:1', { name: 'Jane' }, 'cus_1', deps,
    )).rejects.toThrow(EnvironmentGuardError)

    // No M0 commands dispatched - not even the enqueue
    expect(deps.dispatched).toHaveLength(0)
  })

  it('hand-crafted WritebackDeps cannot bypass the guard', async () => {
    // Red team: construct deps directly, trying to skip the guard.
    // The guard is inside processWriteback, not in the caller.
    const directDeps: WritebackDeps = {
      getPopulatingPipelines: () => ['bm:pipe:prod'],
      resolvePipeline: () => makeProdPipeline(),
      dispatchM0: () => {},
      executeWriteback: async () => true,
      environment: 'simulation',
    }

    await expect(processWriteback(
      'bm:thing:customer', 'bm:inst:1', { name: 'Jane' }, 'cus_1', directDeps,
    )).rejects.toThrow(EnvironmentGuardError)
  })

  it('simulation CAN write to simulation pipelines', async () => {
    const deps = makeSimDeps({
      getPopulatingPipelines: () => ['bm:pipe:stripe-sim'],
      resolvePipeline: () => makeSimPipeline(),
    })

    const result = await processWriteback(
      'bm:thing:customer', 'bm:inst:1', { name: 'Jane' }, 'cus_1', deps,
    )

    expect(result).not.toBeNull()
    expect(result!.dispatched).toBe(true)
  })

  it('simulation CAN write when DataSource has acceptsSimulationTraffic', async () => {
    const prodPipelineWithSimTraffic = makeProdPipeline()
    const deps = makeSimDeps({
      resolvePipeline: () => prodPipelineWithSimTraffic,
      resolveDataSourceForPipeline: () => ({
        uri: 'bm:ds:stripe-sandbox',
        name: 'Stripe Sandbox',
        transport: 'http' as any,
        endpoint: 'https://api.stripe.com/v1',
        credentialRef: 'stripe-key',
        authType: 'bearer' as any,
        config: {},
        connectionStatus: 'connected' as any,
        stereotype: 'read-write' as any,
        environment: 'prod' as any,
        acceptsSimulationTraffic: true,
      }),
    })

    const result = await processWriteback(
      'bm:thing:customer', 'bm:inst:1', { name: 'Jane' }, 'cus_1', deps,
    )

    expect(result).not.toBeNull()
    expect(result!.dispatched).toBe(true)
  })

  it('non-simulation environment can write to prod without restriction', async () => {
    const deps = makeSimDeps({
      environment: 'prod',
    })

    const result = await processWriteback(
      'bm:thing:customer', 'bm:inst:1', { name: 'Jane' }, 'cus_1', deps,
    )

    expect(result).not.toBeNull()
    expect(result!.dispatched).toBe(true)
  })

  it('defaults to prod environment when not specified (fail-safe)', async () => {
    const deps = makeSimDeps({
      environment: undefined,
    })

    // Should succeed - defaults to prod environment writing to prod pipeline
    const result = await processWriteback(
      'bm:thing:customer', 'bm:inst:1', { name: 'Jane' }, 'cus_1', deps,
    )

    expect(result).not.toBeNull()
    expect(result!.dispatched).toBe(true)
  })
})

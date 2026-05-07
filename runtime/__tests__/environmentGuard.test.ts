import { describe, it, expect } from 'vitest'
import {
  checkWriteAllowed,
  assertWriteAllowed,
  resolveEnvironment,
  EnvironmentGuardError,
} from '../environmentGuard'
import type { EnvironmentGuardTarget, RuntimeEnvironment } from '../environmentGuard'

// ── Helpers ──────────────────────────────────────────────────────────────

function target(overrides: Partial<EnvironmentGuardTarget> = {}): EnvironmentGuardTarget {
  return {
    uri: 'bm:ds:stripe',
    environment: 'prod',
    acceptsSimulationTraffic: false,
    ...overrides,
  }
}

// ── Core guard tests ─────────────────────────────────────────────────────

describe('checkWriteAllowed', () => {
  it('allows non-simulation environments to write to any target', () => {
    const envs: RuntimeEnvironment[] = ['dev', 'staging', 'prod']
    for (const env of envs) {
      expect(checkWriteAllowed(env, target())).toBeNull()
      expect(checkWriteAllowed(env, target({ environment: 'simulation' }))).toBeNull()
    }
  })

  it('allows simulation to write to simulation targets', () => {
    expect(checkWriteAllowed('simulation', target({ environment: 'simulation' }))).toBeNull()
  })

  it('allows simulation to write to targets with acceptsSimulationTraffic', () => {
    expect(checkWriteAllowed('simulation', target({
      environment: 'dev',
      acceptsSimulationTraffic: true,
    }))).toBeNull()

    expect(checkWriteAllowed('simulation', target({
      environment: 'prod',
      acceptsSimulationTraffic: true,
    }))).toBeNull()
  })

  it('BLOCKS simulation writing to prod targets', () => {
    const violation = checkWriteAllowed('simulation', target({ environment: 'prod' }))

    expect(violation).not.toBeNull()
    expect(violation!.currentEnvironment).toBe('simulation')
    expect(violation!.targetEnvironment).toBe('prod')
    expect(violation!.reason).toContain('Simulation mode cannot write to prod')
  })

  it('BLOCKS simulation writing to dev targets (unless acceptsSimulationTraffic)', () => {
    const violation = checkWriteAllowed('simulation', target({ environment: 'dev' }))

    expect(violation).not.toBeNull()
    expect(violation!.targetEnvironment).toBe('dev')
  })

  it('BLOCKS simulation writing to staging targets', () => {
    const violation = checkWriteAllowed('simulation', target({ environment: 'staging' }))

    expect(violation).not.toBeNull()
    expect(violation!.targetEnvironment).toBe('staging')
  })
})

describe('assertWriteAllowed', () => {
  it('does not throw for allowed writes', () => {
    expect(() => assertWriteAllowed('prod', target())).not.toThrow()
    expect(() => assertWriteAllowed('simulation', target({ environment: 'simulation' }))).not.toThrow()
  })

  it('throws EnvironmentGuardError for blocked writes', () => {
    expect(() => assertWriteAllowed('simulation', target({ environment: 'prod' })))
      .toThrow(EnvironmentGuardError)
  })

  it('error contains the violation details', () => {
    try {
      assertWriteAllowed('simulation', target({ uri: 'bm:ds:stripe-prod' }))
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(EnvironmentGuardError)
      const guardErr = err as EnvironmentGuardError
      expect(guardErr.violation.currentEnvironment).toBe('simulation')
      expect(guardErr.violation.targetUri).toBe('bm:ds:stripe-prod')
      expect(guardErr.violation.targetEnvironment).toBe('prod')
    }
  })
})

// ── Environment resolution ───────────────────────────────────────────────

describe('resolveEnvironment', () => {
  it('uses pipeline environment when set', () => {
    expect(resolveEnvironment('staging', 'prod')).toBe('staging')
    expect(resolveEnvironment('simulation', 'dev')).toBe('simulation')
  })

  it('inherits from DataSource when pipeline environment is undefined', () => {
    expect(resolveEnvironment(undefined, 'prod')).toBe('prod')
    expect(resolveEnvironment(undefined, 'simulation')).toBe('simulation')
  })

  it('defaults to prod when both are undefined (fail-safe)', () => {
    expect(resolveEnvironment(undefined, undefined)).toBe('prod')
  })
})

/**
 * Environment Guard - Phase 17.
 *
 * Structural safety contract: simulation mode CANNOT write to production
 * data sources. This guard is called inside `processWriteback()` - the
 * only writeback path - so it cannot be bypassed by constructing deps
 * manually. The guard is on the path, not beside it.
 *
 * Rules:
 *   1. Simulation can READ from any DataSource (for federation).
 *   2. Simulation can WRITE BACK only to DataSources where:
 *      - `environment === 'simulation'`, OR
 *      - `acceptsSimulationTraffic === true`
 *   3. Non-simulation environments have no additional write restrictions
 *      from this guard (other guards may apply).
 *
 * The guard is a pure function - no side effects, no imports beyond types.
 */

import type { DataSourceEnvironment } from '../types/context'

// ── Types ────────────────────────────────────────────────────────────────

export type RuntimeEnvironment = DataSourceEnvironment

export interface EnvironmentGuardTarget {
  /** URI of the target DataSource or Pipeline. */
  uri: string
  /** Environment the target is configured for. */
  environment: DataSourceEnvironment
  /** Whether the target explicitly accepts simulation traffic. */
  acceptsSimulationTraffic: boolean
}

export interface EnvironmentGuardViolation {
  currentEnvironment: RuntimeEnvironment
  targetUri: string
  targetEnvironment: DataSourceEnvironment
  reason: string
}

// ── Core guard ───────────────────────────────────────────────────────────

/**
 * Check whether a write operation (writeback, mutation, transport call)
 * is allowed from the current runtime environment to the target.
 *
 * Returns `null` if allowed, or an `EnvironmentGuardViolation` if blocked.
 */
export function checkWriteAllowed(
  currentEnvironment: RuntimeEnvironment,
  target: EnvironmentGuardTarget,
): EnvironmentGuardViolation | null {
  // Only simulation has write restrictions
  if (currentEnvironment !== 'simulation') return null

  // Simulation can write to simulation targets
  if (target.environment === 'simulation') return null

  // Simulation can write to targets that explicitly accept simulation traffic
  if (target.acceptsSimulationTraffic) return null

  // BLOCKED: simulation trying to write to a non-simulation target
  return {
    currentEnvironment,
    targetUri: target.uri,
    targetEnvironment: target.environment,
    reason: `Simulation mode cannot write to ${target.environment} DataSource "${target.uri}". `
      + 'Either set the DataSource environment to "simulation" or enable acceptsSimulationTraffic.',
  }
}

/**
 * Throwing variant - for use in code paths where a violation is a hard error.
 * This is the function called inside `processWriteback()`.
 */
export function assertWriteAllowed(
  currentEnvironment: RuntimeEnvironment,
  target: EnvironmentGuardTarget,
): void {
  const violation = checkWriteAllowed(currentEnvironment, target)
  if (violation) {
    throw new EnvironmentGuardError(violation)
  }
}

// ── Error type ───────────────────────────────────────────────────────────

export class EnvironmentGuardError extends Error {
  readonly violation: EnvironmentGuardViolation

  constructor(violation: EnvironmentGuardViolation) {
    super(violation.reason)
    this.name = 'EnvironmentGuardError'
    this.violation = violation
  }
}

// ── Pipeline environment resolution ──────────────────────────────────────

/**
 * Resolve a Pipeline's effective environment. If the Pipeline has an
 * explicit `environment`, use it. Otherwise, inherit from its DataSource.
 *
 * Returns 'prod' if neither Pipeline nor DataSource specify an environment
 * (fail-safe: treat unknown as production).
 */
export function resolveEnvironment(
  pipelineEnvironment: DataSourceEnvironment | undefined,
  dataSourceEnvironment: DataSourceEnvironment | undefined,
): DataSourceEnvironment {
  return pipelineEnvironment ?? dataSourceEnvironment ?? 'prod'
}

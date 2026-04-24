// M0 state types - command-sourced runtime data.
//
// M0 entities are the runtime counterparts of M1 facets. They materialize
// from M0 commands in the shared commit log (ADR-001 Strategy A) and
// project into the same triple store as M1 entities.
//
// Two categories:
//   1. **Instances** - runtime records of user-defined M1 facets (Customer,
//      OrderPlaced, etc.). Keyed by `typeUri` (any instantiable M1 facet).
//   2. **Operational entities** - platform infrastructure (PipelineRun,
//      RetryEntry, etc.). Not user-modeled, but queryable via the same
//      triple store.

import type { SymbolUniversals } from '../dsl/handles'

// ── Instantiable entity classes ───────────────────────────────────────────
//
// Six M1 entity classes support M0 instantiation. Five do not (Port,
// Interface, Function, DataSource, Pipeline). See the documentation for
// mutation semantics per entity class.

/** Which entity classes support M0 instantiation. */
export const INSTANTIABLE_CLASSES = new Set([
  'Thing', 'Persona', 'Event', 'Measure', 'Workflow', 'Action',
] as const)

/** Entity classes whose instances are immutable after creation. */
export const IMMUTABLE_CLASSES = new Set([
  'Event', 'Measure',
] as const)

export type InstantiableClass = 'Thing' | 'Persona' | 'Event' | 'Measure' | 'Workflow' | 'Action'

// ── Instance ──────────────────────────────────────────────────────────────
//
// A single M0 record - a Customer, an OrderPlaced event, a running
// workflow instance. The `typeUri` references the M1 facet it instantiates.

export interface Instance extends SymbolUniversals {
  /** URI of the M1 facet this instantiates (Thing, Persona, Event, etc.) */
  typeUri: string
  /** Attribute values - validated against the M1 facet's schema at write time */
  data: Record<string, unknown>
  /** Identity in the source system (for Pipeline upsert matching) */
  externalId?: string
  /** URI of the PipelineRun that created/last-updated this instance */
  sourceUri?: string
  createdAt: string
  updatedAt: string
}

// ── Operational entities ──────────────────────────────────────────────────

export interface PipelineRun extends SymbolUniversals {
  pipelineUri: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: string
  completedAt?: string
  recordsProcessed?: number
  recordsFailed?: number
  error?: string
  cursorPosition?: string
}

export interface RetryEntry extends SymbolUniversals {
  targetUri: string
  targetType: 'pipelineRun' | 'writeback'
  attemptCount: number
  nextAttemptAt: string
  idempotencyKey: string
  lastError?: string
  status: 'pending' | 'resolved' | 'dropped'
}

export interface SuppressionRecord extends SymbolUniversals {
  pipelineUri: string
  reason: string
  suppressedAt: string
  liftedAt?: string
  consecutiveFailures: number
  status: 'active' | 'lifted'
}

export interface ReplayPoint extends SymbolUniversals {
  pipelineUri: string
  fromCursor: string
  status: 'created' | 'replaying' | 'completed' | 'aborted'
  createdAt: string
  completedAt?: string
}

export interface DeploymentRecord extends SymbolUniversals {
  modelVersion: string
  target: string
  environment: 'simulation' | 'dev' | 'staging' | 'prod'
  status: 'deploying' | 'live' | 'failed' | 'retracted'
  deployedAt: string
  previousDeploymentUri?: string
}

export interface SimulationRun extends SymbolUniversals {
  modelVersion: string
  scenarioUri?: string
  status: 'running' | 'completed' | 'discarded'
  startedAt: string
  completedAt?: string
  snapshotUri?: string
}

export interface WritebackQueueItem extends SymbolUniversals {
  pipelineUri: string
  instanceUri: string
  reverseMappedPayload: Record<string, unknown>
  idempotencyKey: string
  attemptCount: number
  status: 'pending' | 'acked' | 'failed' | 'dropped'
  enqueuedAt: string
  lastAttemptAt?: string
  lastError?: string
}

// ── M0 State container ────────────────────────────────────────────────────
//
// Materialized from M0 commands in the shared commit log. Stored in
// checkpoints alongside RootContext. Double-keyed instances for O(1)
// lookup by typeUri + instanceUri.

export interface M0State {
  /** Runtime instances of any instantiable M1 facet, keyed by typeUri then instanceUri */
  instances: Record<string, Record<string, Instance>>
  /** Pipeline execution records */
  pipelineRuns: Record<string, PipelineRun>
  /** Pending retries */
  retryEntries: Record<string, RetryEntry>
  /** Auto-disabled pipelines */
  suppressions: Record<string, SuppressionRecord>
  /** Manual replay checkpoints */
  replayPoints: Record<string, ReplayPoint>
  /** Deployed app instances */
  deployments: Record<string, DeploymentRecord>
  /** Simulation executions */
  simulationRuns: Record<string, SimulationRun>
  /** Pending writebacks */
  writebackQueue: Record<string, WritebackQueueItem>
}

export function createEmptyM0State(): M0State {
  return {
    instances: {},
    pipelineRuns: {},
    retryEntries: {},
    suppressions: {},
    replayPoints: {},
    deployments: {},
    simulationRuns: {},
    writebackQueue: {},
  }
}

// ── M0 Command Result ─────────────────────────────────────────────────────

export interface M0DomainEvent {
  type: string
  entityUri: string
}

export interface M0CommandResult {
  success: boolean
  state: M0State
  error?: string
  warnings: string[]
  events: M0DomainEvent[]
}

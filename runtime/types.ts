// Runtime contracts - interfaces that any Business Maps runtime must implement.
// These bridge the M1 model (design-time) and M0 instances (run-time).

import type { RootContext } from '../types/context'
import type { Command, CommandResult } from '../types/commands'
import type { SetExpr } from '../types/query'
import type {
  EntityInstance,
  RelationshipInstance,
  EventOccurrence,
} from '../types/instance'

// ── Contract 1: Model Store ────────────────────────────────────────────────
/** Persist and retrieve M1 models (business maps) */
export interface ModelStore {
  load(id: string): Promise<{ model: RootContext; layout?: unknown } | null>
  save(id: string, model: RootContext, layout?: unknown): Promise<void>
  list(): Promise<{ id: string; name: string; updatedAt: string }[]>
  delete(id: string): Promise<void>
}

// ── Contract 2: Command Executor ────────────────────────────────────────────
/** Pure, synchronous M1 mutation engine */
export interface CommandExecutor {
  execute(state: RootContext, cmd: Command): CommandResult
  computeInverse(cmd: Command, before: RootContext, after: RootContext): Command
}

// ── Contract 3: Instance Repository ─────────────────────────────────────────
/** Storage-agnostic CRUD + query for M0 entity instances */
export interface InstanceRepository {
  create(thingId: string, data: Record<string, unknown>): Promise<EntityInstance>
  findById(id: string): Promise<EntityInstance | null>
  findByThing(thingId: string, options?: QueryOptions): Promise<EntityInstance[]>
  update(id: string, changes: Record<string, unknown>): Promise<EntityInstance>
  delete(id: string): Promise<void>
  query(expr: SetExpr, model: RootContext): Promise<EntityInstance[]>

  createRelationship(
    predicate: string,
    sourceId: string,
    targetId: string,
  ): Promise<RelationshipInstance>
  findRelationships(
    entityId: string,
    options?: RelationshipQueryOptions,
  ): Promise<RelationshipInstance[]>
  deleteRelationship(id: string): Promise<void>
}

export interface QueryOptions {
  limit?: number
  offset?: number
}

export interface RelationshipQueryOptions {
  predicate?: string
  direction?: 'outgoing' | 'incoming'
}

// ── Phase 9.7: Type-decomposed repository interfaces ─────────────────────
//
// The composite repository routes per-typeUri to one of six provider
// flavors. The type decomposition forces consumers to acknowledge async
// coordination state for externally-sourced data. Write operations stay
// uniform - they all produce commands in the shared commit log.

/** Result wrapper for async providers - consumers must handle loading/error states. */
export interface AsyncResult<T> {
  status: 'loading' | 'ready' | 'error'
  data: T
  error?: string
  refreshing: boolean
}

/** Queryable runtime state for async providers. */
export interface RuntimeState {
  lastSyncAt?: string
  nextSyncAt?: string
  pendingWritebacks: number
  retryQueueDepth: number
  suppressionActive: boolean
}

/**
 * Synchronous repository - for Local + Computed providers.
 * Returns plain values. No async coordination state.
 */
export interface SyncTypedRepository<T> {
  find(query: QueryOptions): T[]
  get(uri: string): T | undefined
  findByType(typeUri: string): T[]
}

/**
 * Asynchronous repository - for Synced + Virtual + Hybrid + Synthetic providers.
 * Returns AsyncResult wrappers so consumers acknowledge loading/error states.
 */
export interface AsyncTypedRepository<T> {
  find(query: QueryOptions): AsyncResult<T[]>
  get(uri: string): AsyncResult<T | undefined>
  findByType(typeUri: string): AsyncResult<T[]>
  runtimeState(): RuntimeState
}

/**
 * Type-aware composite - routes by typeUri and returns the appropriate
 * sub-repository at the type level. Consumers cannot accidentally treat
 * async providers as sync.
 */
export interface TypedCompositeRepository<T> {
  sync(typeUri: string): SyncTypedRepository<T> | null
  async(typeUri: string): AsyncTypedRepository<T> | null
  requireSync(typeUri: string): SyncTypedRepository<T>
  requireAsync(typeUri: string): AsyncTypedRepository<T>
}

// ── Contract 4: Action Executor ─────────────────────────────────────────────
/** Execute M1-defined Actions against M0 instance data */
export interface ActionExecutor {
  execute(
    actionId: string,
    params: Record<string, unknown>,
    ctx: ActionContext,
  ): Promise<ActionResult>
}

export interface ActionContext {
  model: RootContext
  instances: InstanceRepository
  currentUser?: string
  eventBus?: EventEmitter
  /** Optional writeback deps - when present, Phase 4 mutations trigger writeback for two-way Pipelines. */
  writebackDeps?: import('./writebackRuntime').WritebackDeps
  /** Current runtime environment - writeback guard uses this. Defaults to 'prod' (fail-safe). */
  environment?: import('./environmentGuard').RuntimeEnvironment
}

export interface EventEmitter {
  emit(eventType: string, payload: Record<string, unknown>): void | Promise<void>
}

export interface ActionResult {
  success: boolean
  created: EntityInstance[]
  updated: EntityInstance[]
  deleted: string[]
  events: EventOccurrence[]
  errors: string[]
  /** Writeback warnings - non-fatal, mutation already committed for sourceOfTruth 'local'. */
  writebackWarnings?: string[]
}

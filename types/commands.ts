import type { Facet, FacetType, LinkPredicate, Symbol, RootContext, ContextMapPattern, Assertion, MediaRef } from './context'
import type {
  Instance, PipelineRun, RetryEntry, SuppressionRecord,
  ReplayPoint, DeploymentRecord, SimulationRun, WritebackQueueItem,
} from './m0'

export interface DomainEvent {
  type: string       // 'context.created', 'facet.removed', 'link.pruned', etc.
  entityUri: string
}

export interface CommandResult {
  success: boolean
  state: RootContext
  error?: string
  warnings: string[]
  events: DomainEvent[]
}

export type Command =
  | { type: 'context:add'; payload: { name: string; parentUri: string; uri?: string; metadata?: Record<string, unknown> } }
  | { type: 'context:remove'; payload: { contextUri: string } }
  | { type: 'context:rename'; payload: { contextUri: string; name: string } }
  | { type: 'context:update'; payload: { contextUri: string; description?: string; domainType?: 'core' | 'supporting' | 'generic'; tags?: string[]; aiInstructions?: string } }
  | { type: 'facet:add'; payload: { contextUri: string; facetType: FacetType | string; facet: Facet } }
  | { type: 'facet:update'; payload: { contextUri: string; facetType: FacetType | string; facetUri: string; changes: Partial<Facet> } }
  | { type: 'facet:remove'; payload: { contextUri: string; facetType: FacetType | string; facetUri: string } }
  | { type: 'symbol:add';      payload: { contextUri?: string; content: string; label?: string; uri?: string; attachment?: MediaRef } }
  | { type: 'symbol:update';   payload: { contextUri?: string; symbolUri: string; changes: Partial<Omit<Symbol, 'uri'>> } }
  | { type: 'symbol:remove';   payload: { contextUri?: string; symbolUri: string } }
  | { type: 'symbol:move';     payload: { sourceContextUri?: string; targetContextUri?: string; symbolUri: string } }
  | { type: 'symbol:classify'; payload: { contextUri?: string; symbolUri: string; to: 'context' | { targetContextUri: string; facetType: FacetType | string }; parentContextUri: string } }
  | { type: 'facet:retype'; payload: { contextUri: string; facetUri: string; fromType: FacetType | string; toType: FacetType | string } }
  | { type: 'facet:move'; payload: { sourceContextUri: string; targetContextUri: string; facetType: FacetType | string; facetUri: string } }
  | { type: 'link:add';    payload: { predicate: LinkPredicate; sourceUri: string; targetUri: string; uri?: string; label?: string; description?: string; pattern?: ContextMapPattern; metadata?: Record<string, unknown> } }
  | { type: 'link:remove'; payload: { linkUri: string } }
  | { type: 'link:update'; payload: { linkUri: string; label?: string; description?: string; pattern?: ContextMapPattern; metadata?: Record<string, unknown> } }
  | { type: 'assertion:add'; payload: { assertion: Assertion } }
  | { type: 'assertion:update'; payload: { assertionId: string; changes: Partial<Omit<Assertion, 'id'>> } }
  | { type: 'assertion:remove'; payload: { assertionId: string } }

/** M1 commands - model/schema mutations on RootContext. */
export type M1Command = Command

// ── M0 commands (28 types across 8 entity classes) ───────────────────────────
//
// Runtime instance data - materialized from the shared commit log
// alongside M1 commands (ADR-001 Strategy A). Each command has a defined
// inverse for undo support.

export type M0Command =
  // Instance - runtime records of any instantiable M1 facet (5)
  | { type: 'instance:upsert';  payload: { thingUri: string; instance: Instance } }
  | { type: 'instance:update';  payload: { instanceUri: string; thingUri: string; changes: Partial<Omit<Instance, 'uri' | 'typeUri'>> } }
  | { type: 'instance:delete';  payload: { instanceUri: string; thingUri: string } }
  | { type: 'instance:link';    payload: { sourceUri: string; targetUri: string; predicate: string } }
  | { type: 'instance:unlink';  payload: { sourceUri: string; targetUri: string; predicate: string } }
  // PipelineRun (4)
  | { type: 'pipelineRun:start';    payload: { run: PipelineRun } }
  | { type: 'pipelineRun:progress'; payload: { runUri: string; processed: number; failed: number } }
  | { type: 'pipelineRun:complete'; payload: { runUri: string; status: 'completed' | 'failed'; error?: string } }
  | { type: 'pipelineRun:cancel';   payload: { runUri: string } }
  // Retry (3)
  | { type: 'retry:enqueue'; payload: { entry: RetryEntry } }
  | { type: 'retry:resolve'; payload: { entryUri: string } }
  | { type: 'retry:drop';    payload: { entryUri: string } }
  // Suppression (2)
  | { type: 'suppression:add';  payload: { record: SuppressionRecord } }
  | { type: 'suppression:lift'; payload: { recordUri: string } }
  // ReplayPoint (3)
  | { type: 'replayPoint:create';   payload: { point: ReplayPoint } }
  | { type: 'replayPoint:complete'; payload: { pointUri: string } }
  | { type: 'replayPoint:abort';    payload: { pointUri: string } }
  // Deployment (3)
  | { type: 'deployment:record';  payload: { record: DeploymentRecord } }
  | { type: 'deployment:update';  payload: { recordUri: string; changes: Partial<Omit<DeploymentRecord, 'uri'>> } }
  | { type: 'deployment:retract'; payload: { recordUri: string } }
  // SimulationRun (4)
  | { type: 'simRun:start';    payload: { run: SimulationRun } }
  | { type: 'simRun:snapshot'; payload: { runUri: string; snapshotUri: string } }
  | { type: 'simRun:complete'; payload: { runUri: string } }
  | { type: 'simRun:discard';  payload: { runUri: string } }
  // WritebackQueue (4)
  | { type: 'writebackQueue:enqueue'; payload: { item: WritebackQueueItem } }
  | { type: 'writebackQueue:ack';     payload: { itemUri: string } }
  | { type: 'writebackQueue:fail';    payload: { itemUri: string; error: string } }
  | { type: 'writebackQueue:drop';    payload: { itemUri: string } }

/** Prefixes that identify M0 commands in the discriminated union. */
const M0_COMMAND_PREFIXES = [
  'instance:', 'pipelineRun:', 'retry:', 'suppression:',
  'replayPoint:', 'deployment:', 'simRun:', 'writebackQueue:',
] as const

/** Type guard - dispatch M0 commands to `applyM0Command`, not `applyCommand`. */
export function isM0Command(cmd: { type: string }): cmd is M0Command {
  return M0_COMMAND_PREFIXES.some(p => cmd.type.startsWith(p))
}

/**
 * Scope marker for sync filtering. Device-local commands are excluded
 * from the cross-device merge set; shared commands sync to collaborators.
 */
export const M0_COMMAND_SCOPE: Record<M0Command['type'], 'device-local' | 'shared'> = {
  'instance:upsert':          'shared',
  'instance:update':          'shared',
  'instance:delete':          'shared',
  'instance:link':            'shared',
  'instance:unlink':          'shared',
  'pipelineRun:start':        'device-local',
  'pipelineRun:progress':     'device-local',
  'pipelineRun:complete':     'shared',
  'pipelineRun:cancel':       'shared',
  'retry:enqueue':            'shared',
  'retry:resolve':            'shared',
  'retry:drop':               'shared',
  'suppression:add':          'shared',
  'suppression:lift':         'shared',
  'replayPoint:create':       'device-local',
  'replayPoint:complete':     'shared',
  'replayPoint:abort':        'shared',
  'deployment:record':        'shared',
  'deployment:update':        'shared',
  'deployment:retract':       'shared',
  'simRun:start':             'device-local',
  'simRun:snapshot':          'device-local',
  'simRun:complete':          'shared',
  'simRun:discard':           'shared',
  'writebackQueue:enqueue':   'shared',
  'writebackQueue:ack':       'shared',
  'writebackQueue:fail':      'shared',
  'writebackQueue:drop':      'shared',
}

// ── Batch & dispatch ─────────────────────────────────────────────────────────
//
// Pure domain commands only. No layout, no canvas, no presentation.
// Consumer layers that need mixed model+layout batches (e.g. a visual editor)
// build their own command union extending this one.

export interface BatchCommand {
  type: 'batch'
  payload: {
    commands: (Command | M0Command)[]
    label?: string
  }
}

export type DispatchableCommand = Command | M0Command | BatchCommand

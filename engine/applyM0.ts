/**
 * M0 command engine - pure, Immer-based apply function for M0 commands.
 *
 * Mirrors the M1 `applyCommand` pattern: validate → produce → return result.
 * Takes `RootContext` as read-only context for cross-tier validation
 * (validating instance data against M1 facet attribute schemas).
 *
 * No side effects, no async, no Vue imports.
 */

import { produce } from 'immer'
import type { RootContext } from '../types/context'
import type { M0Command } from '../types/commands'
import type {
  M0State, M0CommandResult, M0DomainEvent,
} from '../types/m0'
import { INSTANTIABLE_CLASSES, IMMUTABLE_CLASSES } from '../types/m0'
import { getRegisteredFacetKeys, facetKeyToClass } from '../dsl/engineBridge'

// ── Validation helpers ────────────────────────────────────────────────────

/**
 * Resolve the entity class id for a given type URI by scanning the M1
 * model's facets. Returns the entity class (e.g. 'Thing', 'Event') or
 * undefined if not found.
 */
function resolveEntityClassFromModel(typeUri: string, model: RootContext): string | undefined {
  // Check root context facets
  for (const key of getRegisteredFacetKeys()) {
    const facets = model.facets[key as keyof typeof model.facets] as Array<{ uri: string }> | undefined
    if (facets?.some(f => f.uri === typeUri)) {
      return facetKeyToClass(key)
    }
  }
  // Check sub-context facets
  for (const ctx of Object.values(model.contexts)) {
    for (const key of getRegisteredFacetKeys()) {
      const facets = ctx.facets[key as keyof typeof ctx.facets] as Array<{ uri: string }> | undefined
      if (facets?.some(f => f.uri === typeUri)) {
        return facetKeyToClass(key)
      }
    }
  }
  return undefined
}

function validateM0Command(m0: M0State, cmd: M0Command, model: RootContext): string | null {
  switch (cmd.type) {
    case 'instance:upsert': {
      const entityClass = resolveEntityClassFromModel(cmd.payload.thingUri, model)
      if (!entityClass) return `Unknown type URI: ${cmd.payload.thingUri}`
      if (!INSTANTIABLE_CLASSES.has(entityClass as never)) {
        return `${entityClass} does not support M0 instances`
      }
      if (!cmd.payload.instance.uri) return 'Instance must have a uri'
      return null
    }
    case 'instance:update': {
      const entityClass = resolveEntityClassFromModel(cmd.payload.thingUri, model)
      if (entityClass && IMMUTABLE_CLASSES.has(entityClass as never)) {
        return `${entityClass} instances are immutable - cannot update`
      }
      const bucket = m0.instances[cmd.payload.thingUri]
      if (!bucket?.[cmd.payload.instanceUri]) {
        return `Instance not found: ${cmd.payload.instanceUri}`
      }
      return null
    }
    case 'instance:delete': {
      const entityClass = resolveEntityClassFromModel(cmd.payload.thingUri, model)
      if (entityClass && IMMUTABLE_CLASSES.has(entityClass as never)) {
        return `${entityClass} instances are immutable - cannot delete`
      }
      const bucket = m0.instances[cmd.payload.thingUri]
      if (!bucket?.[cmd.payload.instanceUri]) {
        return `Instance not found: ${cmd.payload.instanceUri}`
      }
      return null
    }
    case 'instance:link':
    case 'instance:unlink':
      return null
    case 'pipelineRun:start':
      if (!cmd.payload.run.uri) return 'PipelineRun must have a uri'
      return null
    case 'pipelineRun:progress': {
      if (!m0.pipelineRuns[cmd.payload.runUri]) return `PipelineRun not found: ${cmd.payload.runUri}`
      return null
    }
    case 'pipelineRun:complete':
    case 'pipelineRun:cancel': {
      if (!m0.pipelineRuns[cmd.payload.runUri]) return `PipelineRun not found: ${cmd.payload.runUri}`
      return null
    }
    case 'retry:enqueue':
      if (!cmd.payload.entry.uri) return 'RetryEntry must have a uri'
      return null
    case 'retry:resolve':
    case 'retry:drop': {
      if (!m0.retryEntries[cmd.payload.entryUri]) return `RetryEntry not found: ${cmd.payload.entryUri}`
      return null
    }
    case 'suppression:add':
      if (!cmd.payload.record.uri) return 'SuppressionRecord must have a uri'
      return null
    case 'suppression:lift': {
      if (!m0.suppressions[cmd.payload.recordUri]) return `SuppressionRecord not found: ${cmd.payload.recordUri}`
      return null
    }
    case 'replayPoint:create':
      if (!cmd.payload.point.uri) return 'ReplayPoint must have a uri'
      return null
    case 'replayPoint:complete':
    case 'replayPoint:abort': {
      if (!m0.replayPoints[cmd.payload.pointUri]) return `ReplayPoint not found: ${cmd.payload.pointUri}`
      return null
    }
    case 'deployment:record':
      if (!cmd.payload.record.uri) return 'DeploymentRecord must have a uri'
      return null
    case 'deployment:update':
    case 'deployment:retract': {
      if (!m0.deployments[cmd.payload.recordUri]) return `DeploymentRecord not found: ${cmd.payload.recordUri}`
      return null
    }
    case 'simRun:start':
      if (!cmd.payload.run.uri) return 'SimulationRun must have a uri'
      return null
    case 'simRun:snapshot':
    case 'simRun:complete':
    case 'simRun:discard': {
      if (!m0.simulationRuns[cmd.payload.runUri]) return `SimulationRun not found: ${cmd.payload.runUri}`
      return null
    }
    case 'writebackQueue:enqueue':
      if (!cmd.payload.item.uri) return 'WritebackQueueItem must have a uri'
      return null
    case 'writebackQueue:ack':
    case 'writebackQueue:fail':
    case 'writebackQueue:drop': {
      if (!m0.writebackQueue[cmd.payload.itemUri]) return `WritebackQueueItem not found: ${cmd.payload.itemUri}`
      return null
    }
    default:
      return `Unknown M0 command type: ${(cmd as { type: string }).type}`
  }
}

// ── Apply to draft ────────────────────────────────────────────────────────

function applyM0ToDraft(draft: M0State, cmd: M0Command): M0DomainEvent[] {
  const events: M0DomainEvent[] = []

  switch (cmd.type) {
    // ── Instance ──────────────────────────────────────────────────────────
    case 'instance:upsert': {
      const { thingUri, instance } = cmd.payload
      if (!draft.instances[thingUri]) draft.instances[thingUri] = {}
      draft.instances[thingUri]![instance.uri] = instance
      events.push({ type: 'instance.upserted', entityUri: instance.uri })
      break
    }
    case 'instance:update': {
      const { instanceUri, thingUri, changes } = cmd.payload
      const inst = draft.instances[thingUri]?.[instanceUri]
      if (inst) {
        Object.assign(inst, changes)
        inst.updatedAt = new Date().toISOString()
        events.push({ type: 'instance.updated', entityUri: instanceUri })
      }
      break
    }
    case 'instance:delete': {
      const { instanceUri, thingUri } = cmd.payload
      const bucket = draft.instances[thingUri]
      if (bucket) {
        delete bucket[instanceUri]
        events.push({ type: 'instance.deleted', entityUri: instanceUri })
      }
      break
    }
    case 'instance:link':
      events.push({ type: 'instance.linked', entityUri: cmd.payload.sourceUri })
      break
    case 'instance:unlink':
      events.push({ type: 'instance.unlinked', entityUri: cmd.payload.sourceUri })
      break

    // ── PipelineRun ──────────────────────────────────────────────────────
    case 'pipelineRun:start':
      draft.pipelineRuns[cmd.payload.run.uri] = cmd.payload.run
      events.push({ type: 'pipelineRun.started', entityUri: cmd.payload.run.uri })
      break
    case 'pipelineRun:progress': {
      const run = draft.pipelineRuns[cmd.payload.runUri]
      if (run) {
        run.recordsProcessed = cmd.payload.processed
        run.recordsFailed = cmd.payload.failed
      }
      break
    }
    case 'pipelineRun:complete': {
      const run = draft.pipelineRuns[cmd.payload.runUri]
      if (run) {
        run.status = cmd.payload.status
        run.completedAt = new Date().toISOString()
        if (cmd.payload.error) run.error = cmd.payload.error
        events.push({ type: 'pipelineRun.completed', entityUri: cmd.payload.runUri })
      }
      break
    }
    case 'pipelineRun:cancel': {
      const run = draft.pipelineRuns[cmd.payload.runUri]
      if (run) {
        run.status = 'cancelled'
        run.completedAt = new Date().toISOString()
        events.push({ type: 'pipelineRun.cancelled', entityUri: cmd.payload.runUri })
      }
      break
    }

    // ── Retry ─────────────────────────────────────────────────────────────
    case 'retry:enqueue':
      draft.retryEntries[cmd.payload.entry.uri] = cmd.payload.entry
      events.push({ type: 'retry.enqueued', entityUri: cmd.payload.entry.uri })
      break
    case 'retry:resolve': {
      const entry = draft.retryEntries[cmd.payload.entryUri]
      if (entry) {
        entry.status = 'resolved'
        events.push({ type: 'retry.resolved', entityUri: cmd.payload.entryUri })
      }
      break
    }
    case 'retry:drop': {
      const entry = draft.retryEntries[cmd.payload.entryUri]
      if (entry) {
        entry.status = 'dropped'
        events.push({ type: 'retry.dropped', entityUri: cmd.payload.entryUri })
      }
      break
    }

    // ── Suppression ───────────────────────────────────────────────────────
    case 'suppression:add':
      draft.suppressions[cmd.payload.record.uri] = cmd.payload.record
      events.push({ type: 'suppression.added', entityUri: cmd.payload.record.uri })
      break
    case 'suppression:lift': {
      const rec = draft.suppressions[cmd.payload.recordUri]
      if (rec) {
        rec.status = 'lifted'
        rec.liftedAt = new Date().toISOString()
        events.push({ type: 'suppression.lifted', entityUri: cmd.payload.recordUri })
      }
      break
    }

    // ── ReplayPoint ───────────────────────────────────────────────────────
    case 'replayPoint:create':
      draft.replayPoints[cmd.payload.point.uri] = cmd.payload.point
      events.push({ type: 'replayPoint.created', entityUri: cmd.payload.point.uri })
      break
    case 'replayPoint:complete': {
      const pt = draft.replayPoints[cmd.payload.pointUri]
      if (pt) {
        pt.status = 'completed'
        pt.completedAt = new Date().toISOString()
        events.push({ type: 'replayPoint.completed', entityUri: cmd.payload.pointUri })
      }
      break
    }
    case 'replayPoint:abort': {
      const pt = draft.replayPoints[cmd.payload.pointUri]
      if (pt) {
        pt.status = 'aborted'
        pt.completedAt = new Date().toISOString()
        events.push({ type: 'replayPoint.aborted', entityUri: cmd.payload.pointUri })
      }
      break
    }

    // ── Deployment ────────────────────────────────────────────────────────
    case 'deployment:record':
      draft.deployments[cmd.payload.record.uri] = cmd.payload.record
      events.push({ type: 'deployment.recorded', entityUri: cmd.payload.record.uri })
      break
    case 'deployment:update': {
      const dep = draft.deployments[cmd.payload.recordUri]
      if (dep) {
        Object.assign(dep, cmd.payload.changes)
        events.push({ type: 'deployment.updated', entityUri: cmd.payload.recordUri })
      }
      break
    }
    case 'deployment:retract': {
      const dep = draft.deployments[cmd.payload.recordUri]
      if (dep) {
        dep.status = 'retracted'
        events.push({ type: 'deployment.retracted', entityUri: cmd.payload.recordUri })
      }
      break
    }

    // ── SimulationRun ─────────────────────────────────────────────────────
    case 'simRun:start':
      draft.simulationRuns[cmd.payload.run.uri] = cmd.payload.run
      events.push({ type: 'simRun.started', entityUri: cmd.payload.run.uri })
      break
    case 'simRun:snapshot': {
      const sim = draft.simulationRuns[cmd.payload.runUri]
      if (sim) sim.snapshotUri = cmd.payload.snapshotUri
      break
    }
    case 'simRun:complete': {
      const sim = draft.simulationRuns[cmd.payload.runUri]
      if (sim) {
        sim.status = 'completed'
        sim.completedAt = new Date().toISOString()
        events.push({ type: 'simRun.completed', entityUri: cmd.payload.runUri })
      }
      break
    }
    case 'simRun:discard': {
      const sim = draft.simulationRuns[cmd.payload.runUri]
      if (sim) {
        sim.status = 'discarded'
        sim.completedAt = new Date().toISOString()
        events.push({ type: 'simRun.discarded', entityUri: cmd.payload.runUri })
      }
      break
    }

    // ── WritebackQueue ────────────────────────────────────────────────────
    case 'writebackQueue:enqueue':
      draft.writebackQueue[cmd.payload.item.uri] = cmd.payload.item
      events.push({ type: 'writeback.enqueued', entityUri: cmd.payload.item.uri })
      break
    case 'writebackQueue:ack': {
      const item = draft.writebackQueue[cmd.payload.itemUri]
      if (item) {
        item.status = 'acked'
        events.push({ type: 'writeback.acked', entityUri: cmd.payload.itemUri })
      }
      break
    }
    case 'writebackQueue:fail': {
      const item = draft.writebackQueue[cmd.payload.itemUri]
      if (item) {
        item.status = 'failed'
        item.attemptCount += 1
        item.lastAttemptAt = new Date().toISOString()
        item.lastError = cmd.payload.error
        events.push({ type: 'writeback.failed', entityUri: cmd.payload.itemUri })
      }
      break
    }
    case 'writebackQueue:drop': {
      const item = draft.writebackQueue[cmd.payload.itemUri]
      if (item) {
        item.status = 'dropped'
        events.push({ type: 'writeback.dropped', entityUri: cmd.payload.itemUri })
      }
      break
    }
  }

  return events
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Apply a single M0 command to the M0 state. Pure: no side effects.
 * Takes `model` (RootContext) as read-only context for cross-tier
 * validation (e.g. resolving typeUri to entity class).
 */
export function applyM0Command(m0: M0State, cmd: M0Command, model: RootContext): M0CommandResult {
  const error = validateM0Command(m0, cmd, model)
  if (error) {
    return { success: false, state: m0, error, warnings: [], events: [] }
  }

  let events: M0DomainEvent[] = []
  const state = produce(m0, draft => {
    events = applyM0ToDraft(draft, cmd)
  })

  return { success: true, state, warnings: [], events }
}

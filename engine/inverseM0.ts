/**
 * M0 inverse computation - produces compensating commands for undo.
 *
 * Mirrors the M1 `computeInverse` pattern: given the command and the
 * state before/after application, compute the command that undoes it.
 */

import type { M0Command } from '../types/commands'
import type { M0State } from '../types/m0'

/**
 * Compute the inverse (undo) command for an M0 command.
 * Takes `before` state to capture the values needed for reversal.
 */
export function computeM0Inverse(cmd: M0Command, before: M0State, _after: M0State): M0Command {
  switch (cmd.type) {
    // ── Instance ──────────────────────────────────────────────────────────
    case 'instance:upsert': {
      const { thingUri, instance } = cmd.payload
      const prev = before.instances[thingUri]?.[instance.uri]
      if (prev) {
        // Was an update (upsert over existing) - inverse restores old value
        return { type: 'instance:upsert', payload: { thingUri, instance: structuredClone(prev) } }
      }
      // Was a create - inverse is delete
      return { type: 'instance:delete', payload: { instanceUri: instance.uri, thingUri } }
    }
    case 'instance:update': {
      const { instanceUri, thingUri, changes } = cmd.payload
      const prev = before.instances[thingUri]?.[instanceUri]
      if (!prev) return cmd // shouldn't happen - validation caught it
      const reverseChanges: Record<string, unknown> = {}
      for (const key of Object.keys(changes)) {
        reverseChanges[key] = (prev as any)[key]
      }
      return { type: 'instance:update', payload: { instanceUri, thingUri, changes: reverseChanges } }
    }
    case 'instance:delete': {
      const { instanceUri, thingUri } = cmd.payload
      const prev = before.instances[thingUri]?.[instanceUri]
      if (!prev) return cmd
      return { type: 'instance:upsert', payload: { thingUri, instance: structuredClone(prev) } }
    }
    case 'instance:link':
      return { type: 'instance:unlink', payload: cmd.payload }
    case 'instance:unlink':
      return { type: 'instance:link', payload: cmd.payload }

    // ── PipelineRun ──────────────────────────────────────────────────────
    case 'pipelineRun:start': {
      return { type: 'pipelineRun:cancel', payload: { runUri: cmd.payload.run.uri } }
    }
    case 'pipelineRun:progress': {
      const prev = before.pipelineRuns[cmd.payload.runUri]
      return {
        type: 'pipelineRun:progress',
        payload: {
          runUri: cmd.payload.runUri,
          processed: prev?.recordsProcessed ?? 0,
          failed: prev?.recordsFailed ?? 0,
        },
      }
    }
    case 'pipelineRun:complete': {
      const prev = before.pipelineRuns[cmd.payload.runUri]
      return {
        type: 'pipelineRun:complete',
        payload: {
          runUri: cmd.payload.runUri,
          status: (prev?.status === 'completed' || prev?.status === 'failed') ? prev.status : 'completed',
        },
      }
    }
    case 'pipelineRun:cancel': {
      const prev = before.pipelineRuns[cmd.payload.runUri]
      if (!prev) return cmd
      return { type: 'pipelineRun:start', payload: { run: structuredClone(prev) } }
    }

    // ── Retry ─────────────────────────────────────────────────────────────
    case 'retry:enqueue':
      return { type: 'retry:drop', payload: { entryUri: cmd.payload.entry.uri } }
    case 'retry:resolve': {
      const prev = before.retryEntries[cmd.payload.entryUri]
      if (!prev) return cmd
      return { type: 'retry:enqueue', payload: { entry: structuredClone(prev) } }
    }
    case 'retry:drop': {
      const prev = before.retryEntries[cmd.payload.entryUri]
      if (!prev) return cmd
      return { type: 'retry:enqueue', payload: { entry: structuredClone(prev) } }
    }

    // ── Suppression ───────────────────────────────────────────────────────
    case 'suppression:add':
      return { type: 'suppression:lift', payload: { recordUri: cmd.payload.record.uri } }
    case 'suppression:lift': {
      const prev = before.suppressions[cmd.payload.recordUri]
      if (!prev) return cmd
      return { type: 'suppression:add', payload: { record: structuredClone(prev) } }
    }

    // ── ReplayPoint ───────────────────────────────────────────────────────
    case 'replayPoint:create':
      return { type: 'replayPoint:abort', payload: { pointUri: cmd.payload.point.uri } }
    case 'replayPoint:complete': {
      const prev = before.replayPoints[cmd.payload.pointUri]
      if (!prev) return cmd
      return { type: 'replayPoint:create', payload: { point: structuredClone(prev) } }
    }
    case 'replayPoint:abort': {
      const prev = before.replayPoints[cmd.payload.pointUri]
      if (!prev) return cmd
      return { type: 'replayPoint:create', payload: { point: structuredClone(prev) } }
    }

    // ── Deployment ────────────────────────────────────────────────────────
    case 'deployment:record':
      return { type: 'deployment:retract', payload: { recordUri: cmd.payload.record.uri } }
    case 'deployment:update': {
      const prev = before.deployments[cmd.payload.recordUri]
      if (!prev) return cmd
      const reverseChanges: Record<string, unknown> = {}
      for (const key of Object.keys(cmd.payload.changes)) {
        reverseChanges[key] = (prev as any)[key]
      }
      return { type: 'deployment:update', payload: { recordUri: cmd.payload.recordUri, changes: reverseChanges } }
    }
    case 'deployment:retract': {
      const prev = before.deployments[cmd.payload.recordUri]
      if (!prev) return cmd
      return { type: 'deployment:record', payload: { record: structuredClone(prev) } }
    }

    // ── SimulationRun ─────────────────────────────────────────────────────
    case 'simRun:start':
      return { type: 'simRun:discard', payload: { runUri: cmd.payload.run.uri } }
    case 'simRun:snapshot': {
      const prev = before.simulationRuns[cmd.payload.runUri]
      return {
        type: 'simRun:snapshot',
        payload: { runUri: cmd.payload.runUri, snapshotUri: prev?.snapshotUri ?? '' },
      }
    }
    case 'simRun:complete': {
      const prev = before.simulationRuns[cmd.payload.runUri]
      if (!prev) return cmd
      return { type: 'simRun:start', payload: { run: structuredClone(prev) } }
    }
    case 'simRun:discard': {
      const prev = before.simulationRuns[cmd.payload.runUri]
      if (!prev) return cmd
      return { type: 'simRun:start', payload: { run: structuredClone(prev) } }
    }

    // ── WritebackQueue ────────────────────────────────────────────────────
    case 'writebackQueue:enqueue':
      return { type: 'writebackQueue:drop', payload: { itemUri: cmd.payload.item.uri } }
    case 'writebackQueue:ack': {
      const prev = before.writebackQueue[cmd.payload.itemUri]
      if (!prev) return cmd
      return { type: 'writebackQueue:enqueue', payload: { item: structuredClone(prev) } }
    }
    case 'writebackQueue:fail': {
      const prev = before.writebackQueue[cmd.payload.itemUri]
      if (!prev) return cmd
      return { type: 'writebackQueue:enqueue', payload: { item: structuredClone(prev) } }
    }
    case 'writebackQueue:drop': {
      const prev = before.writebackQueue[cmd.payload.itemUri]
      if (!prev) return cmd
      return { type: 'writebackQueue:enqueue', payload: { item: structuredClone(prev) } }
    }

    default:
      return cmd
  }
}

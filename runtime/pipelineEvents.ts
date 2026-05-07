/**
 * Pipeline runtime events - can render live state.
 *
 * **Event schema is a commitment.** Adding a new event type or field
 * here is fine; renaming or removing one breaks every downstream
 * consumer. Treat this file like a published API.
 *
 * **Run lifecycle:**
 *
 *   started   (runId, pipelineId, trigger, startedAt)
 *     → fetched      (records received from transport)
 *     → mapped       (raw records → mapped instances, plus errors)
 *     → written      (instances written to provider)
 *   completed (runId, ok/partial/failed, durationMs, counts)
 *
 * If anything fails mid-run:
 *     → error (phase, reason, details)
 *   completed (status: 'failed')
 *
 * `rateLimited` fires whenever a token bucket forces a wait. Not a
 * failure - just an observability hook.
 *
 * `skipped` fires per-record when the mapping filter rejects it. Not
 * an error - an observability hook.
 */

import type { PipelineRunStatus } from '../types/context'

export type PipelinePhase =
  | 'fetch'
  | 'map'
  | 'write'
  | 'schedule'
  | 'rate-limit'
  | 'cursor'

export type PipelineTrigger = 'on-demand' | 'cron' | 'continuous' | 'api'

// ── Event shapes ──────────────────────────────────────────────────────────

export interface PipelineRunStartedEvent {
  type: 'pipeline.run.started'
  runId: string
  pipelineId: string
  trigger: PipelineTrigger
  startedAt: string
}

export interface PipelineRunFetchedEvent {
  type: 'pipeline.run.fetched'
  runId: string
  pipelineId: string
  recordCount: number
  durationMs: number
  /** Optional hint from the transport - e.g., the raw response status. */
  transportKind?: string
}

export interface PipelineRunMappedEvent {
  type: 'pipeline.run.mapped'
  runId: string
  pipelineId: string
  mappedCount: number
  skippedCount: number
  errorCount: number
  durationMs: number
}

export interface PipelineRunWrittenEvent {
  type: 'pipeline.run.written'
  runId: string
  pipelineId: string
  thingId: string
  writtenCount: number
  durationMs: number
}

export interface PipelineRunCompletedEvent {
  type: 'pipeline.run.completed'
  runId: string
  pipelineId: string
  status: PipelineRunStatus
  completedAt: string
  durationMs: number
  counts: {
    fetched: number
    mapped: number
    skipped: number
    errors: number
    written: number
  }
}

export interface PipelineRunErrorEvent {
  type: 'pipeline.run.error'
  runId: string
  pipelineId: string
  phase: PipelinePhase
  reason: string
  details?: unknown
}

export interface PipelineRateLimitedEvent {
  type: 'pipeline.rate-limited'
  runId: string
  pipelineId: string
  waitMs: number
  tokensAvailable: number
}

export interface PipelineCursorAdvancedEvent {
  type: 'pipeline.cursor.advanced'
  runId: string
  pipelineId: string
  previous: string | null
  current: string
}

export type PipelineEvent =
  | PipelineRunStartedEvent
  | PipelineRunFetchedEvent
  | PipelineRunMappedEvent
  | PipelineRunWrittenEvent
  | PipelineRunCompletedEvent
  | PipelineRunErrorEvent
  | PipelineRateLimitedEvent
  | PipelineCursorAdvancedEvent

// ── Listener API ──────────────────────────────────────────────────────────

export type PipelineEventListener = (event: PipelineEvent) => void

export interface PipelineEventBus {
  /** Subscribe to all pipeline events. Returns an unsubscribe function. */
  subscribe(listener: PipelineEventListener): () => void
  /** Emit an event to all listeners. */
  emit(event: PipelineEvent): void
  /** Number of currently registered listeners. */
  listenerCount(): number
}

export function createPipelineEventBus(): PipelineEventBus {
  const listeners = new Set<PipelineEventListener>()

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    emit(event) {
      for (const listener of listeners) {
        try {
          listener(event)
        } catch (e) {
          // A misbehaving listener must not break the runtime.
          // Surface via console.warn so dev-time bugs are visible.
          console.warn('[PipelineEventBus] listener error:', e)
        }
      }
    },

    listenerCount() {
      return listeners.size
    },
  }
}

/**
 * PipelineRuntime -          → fetch raw records
 *     ↓
 *   MappingEngine (8)      → shape raw records into typed instances
 *     ↓
 *   Provider (9)           → write instances (upsert by externalId)
 *     ↓
 *   EventBus (10)          → emit typed events for every phase
 *
 * Phase 10's value is composition + observability, not new logic.
 * Every piece it needs already exists; this file wires them together
 * and emits events so Sub-epic E's ops console has something to
 * render.
 *
 * **What ships in Phase 10:**
 *  - `createPipelineRuntime({ ... })` - runtime factory
 *  - `runOnce(pipelineId, trigger?)` - execute a single pipeline run
 *  - Rate limiting via a per-pipeline token bucket
 *  - Cursor tracking for incremental sync
 *  - Event emission for every lifecycle phase
 *  - `start()` / `stop()` - for cron and continuous schedule kinds
 *
 * **What is deferred:**
 *  - Full cron parsing - Phase 10 supports `{ kind: 'cron', expression: 'every Nms' }`
 *    as a dev-friendly form. Real cron parsing (e.g. 0/6 hourly) lands in
 *    Phase 10.5 when the M0 commit log needs real scheduled execution.
 *  - Retry queue - Phase 9.5 owns durable retry via the M0 commit log.
 *  - Writeback (two-way sync) - Phase 11 is the writeback story.
 */

import { nanoid } from 'nanoid'
import type { Transport } from './transports/types'
import type { InstanceRepository } from './types'
import type { PipelineMapping, Pipeline as BmPipeline, Function as BmFunction } from '../types/context'
import { runMapping } from './mappingEngine'
import type { SecretValue } from './secretStore'
import { invokeFunction, type FunctionRegistry } from './functionRuntime'
import {
  createPipelineEventBus,
  type PipelineEventBus,
  type PipelineTrigger,
  type PipelineRunCompletedEvent,
} from './pipelineEvents'

// ── Token bucket rate limiter ─────────────────────────────────────────────

interface TokenBucket {
  /** Take one token, waiting if necessary. Returns the wait time in ms. */
  take(): Promise<number>
  /** Current available tokens. Integer value. */
  available(): number
}

function createTokenBucket(
  requestsPerSecond: number,
  burstSize: number,
  now: () => number = () => Date.now(),
): TokenBucket {
  let tokens = burstSize
  let lastRefill = now()
  const refillPerMs = requestsPerSecond / 1000

  function refill(): void {
    const t = now()
    const elapsed = t - lastRefill
    if (elapsed > 0) {
      tokens = Math.min(burstSize, tokens + elapsed * refillPerMs)
      lastRefill = t
    }
  }

  return {
    available() {
      refill()
      return Math.floor(tokens)
    },

    async take() {
      refill()
      if (tokens >= 1) {
        tokens -= 1
        return 0
      }
      // Wait long enough to accrue one token.
      const needed = 1 - tokens
      const waitMs = Math.ceil(needed / refillPerMs)
      await new Promise(resolve => setTimeout(resolve, waitMs))
      refill()
      tokens -= 1
      return waitMs
    },
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Bindings a pipeline needs at runtime. In production these come from
 * the RootContext + Phase 7 secret store; tests can pass stubs.
 */
export interface PipelineBindings {
  /** The target Thing's provider - where mapped instances get written. */
  provider: InstanceRepository
  /** Transport for the source DataSource. */
  transport: Transport
  /** Narrow DataSource projection (id, transport, endpoint, credentialRef, etc.). */
  dataSource: {
    id: string
    transport: string
    endpoint: string
    credentialRef?: string
    authType?: string
    config?: Record<string, unknown>
  }
  /** Secret resolver - called per run. Returns null if not bound. */
  getCredentials?: () => SecretValue | null | undefined
  /**
   * Function registry for field transforms. If a pipeline mapping has a
   * `transform: FunctionId` field spec, the runtime routes the transform
   * through this registry. Defaults to an empty registry.
   */
  functionRegistry?: FunctionRegistry
}

export interface PipelineRunResult {
  runId: string
  pipelineId: string
  status: 'ok' | 'partial' | 'failed'
  fetched: number
  mapped: number
  skipped: number
  errors: number
  written: number
  durationMs: number
  /** Final cursor value advanced after this run, if any. */
  cursor?: string | null
}

export interface PipelineRuntime {
  /** Register a pipeline + its bindings for runtime execution. */
  register(pipeline: BmPipeline, bindings: PipelineBindings, mappingOverride?: PipelineMapping): void

  /** Unregister a pipeline. Stops any active timers for it. */
  unregister(pipelineId: string): void

  /** Execute a single run of a registered pipeline. */
  runOnce(pipelineId: string, trigger?: PipelineTrigger): Promise<PipelineRunResult>

  /** Start cron / continuous schedules for all registered pipelines. */
  start(): void

  /** Stop all scheduled runs. */
  stop(): void

  /** The runtime's event bus. Subscribe to observe runs. */
  readonly events: PipelineEventBus

  /** Get the last cursor value for a pipeline (for observability). */
  getCursor(pipelineId: string): string | null
}

export interface PipelineRuntimeOptions {
  /** Override Date.now() for deterministic tests. */
  now?: () => number
  /** Override setTimeout for deterministic tests. */
  setTimer?: (fn: () => void, ms: number) => { clear: () => void }
}

// ── Internal: per-pipeline runtime entry ─────────────────────────────────

interface RegisteredPipeline {
  pipeline: BmPipeline
  bindings: PipelineBindings
  mapping: PipelineMapping
  bucket: TokenBucket | null
  cursor: string | null
  activeTimer: { clear: () => void } | null
}

// ── Runtime factory ───────────────────────────────────────────────────────

export function createPipelineRuntime(
  options: PipelineRuntimeOptions = {},
): PipelineRuntime {
  const { now = () => Date.now() } = options
  const defaultSetTimer = (fn: () => void, ms: number) => {
    const handle = setTimeout(fn, ms)
    return { clear: () => clearTimeout(handle) }
  }
  const setTimer = options.setTimer ?? defaultSetTimer

  const pipelines = new Map<string, RegisteredPipeline>()
  const events = createPipelineEventBus()
  let started = false

  // ── Helpers ────────────────────────────────────────────────────────────

  function getEntry(pipelineId: string): RegisteredPipeline {
    const entry = pipelines.get(pipelineId)
    if (!entry) {
      throw new Error(`PipelineRuntime: pipeline "${pipelineId}" is not registered`)
    }
    return entry
  }

  function buildInvokeTransform(registry: FunctionRegistry | undefined) {
    if (!registry) return undefined
    return (functionId: string, value: unknown, _record: unknown) => {
      const fn = registry.get(functionId) as BmFunction | undefined
      if (!fn) {
        throw new Error(`Transform function "${functionId}" not found in registry`)
      }
      const result = invokeFunction(fn, [value], { registry })
      if (!result.success) {
        throw new Error(result.error ?? `Transform "${functionId}" failed`)
      }
      return result.value
    }
  }

  // ── Scheduling ────────────────────────────────────────────────────────

  function scheduleIfNeeded(entry: RegisteredPipeline): void {
    if (!started) return
    const schedule = entry.pipeline.schedule
    if (!schedule || schedule.kind === 'on-demand') return

    // Phase 10 scheduling: support two dev-friendly forms.
    //   { kind: 'cron', expression: 'every 5000ms' } - parse the ms
    //   { kind: 'continuous' } - run back-to-back with a 100ms breather
    // Real cron parsing (0 */6 * * *) lands in Phase 10.5.
    let delayMs: number
    if (schedule.kind === 'continuous') {
      delayMs = 100
    } else if (schedule.kind === 'cron') {
      const expr = (schedule as any).expression as string | undefined
      const match = expr?.match(/every\s+(\d+)\s*ms/)
      if (!match) {
        // Unparseable expression - emit an error and bail.
        events.emit({
          type: 'pipeline.run.error',
          runId: 'schedule',
          pipelineId: entry.pipeline.uri,
          phase: 'schedule',
          reason: `Unparseable cron expression: "${expr}" - Phase 10 supports "every Nms"`,
        })
        return
      }
      delayMs = parseInt(match[1]!, 10)
    } else {
      return
    }

    entry.activeTimer = setTimer(() => {
      // Fire and forget - errors surface as events inside runOnce
      void runOnce(entry.pipeline.uri, schedule.kind === 'cron' ? 'cron' : 'continuous')
        .catch(() => {}) // swallowed - event bus already surfaced the error
        .finally(() => {
          // Reschedule if still registered AND still started
          if (started && pipelines.has(entry.pipeline.uri)) {
            scheduleIfNeeded(entry)
          }
        })
    }, delayMs)
  }

  // ── Core execution ─────────────────────────────────────────────────────

  async function runOnce(
    pipelineId: string,
    trigger: PipelineTrigger = 'on-demand',
  ): Promise<PipelineRunResult> {
    const entry = getEntry(pipelineId)
    const { pipeline, bindings, mapping } = entry
    const runId = nanoid()
    const runStartMs = now()
    const startedAt = new Date(runStartMs).toISOString()

    events.emit({
      type: 'pipeline.run.started',
      runId,
      pipelineId,
      trigger,
      startedAt,
    })

    const counts = {
      fetched: 0,
      mapped: 0,
      skipped: 0,
      errors: 0,
      written: 0,
    }

    try {
      // ── Rate limit ────────────────────────────────────────────────
      if (entry.bucket) {
        const waited = await entry.bucket.take()
        if (waited > 0) {
          events.emit({
            type: 'pipeline.rate-limited',
            runId,
            pipelineId,
            waitMs: waited,
            tokensAvailable: entry.bucket.available(),
          })
        }
      }

      // ── Fetch ─────────────────────────────────────────────────────
      const fetchStart = now()
      const credentials = bindings.getCredentials?.() ?? null
      const params: Record<string, unknown> = {}
      if (entry.cursor !== null) {
        // Incremental sync: forward the cursor as a query param.
        // The DataSource config can override the key name; default
        // to `since` which matches most REST APIs.
        const cursorKey = (bindings.dataSource.config?.cursorKey as string | undefined) ?? 'since'
        params[cursorKey] = entry.cursor
      }
      const response = await bindings.transport.execute(
        {
          dataSource: bindings.dataSource,
          operation: 'read',
          params: Object.keys(params).length > 0 ? params : undefined,
        },
        credentials,
      )

      if (!response.success) {
        events.emit({
          type: 'pipeline.run.error',
          runId,
          pipelineId,
          phase: 'fetch',
          reason: response.error ?? 'Transport returned success: false',
          details: { statusCode: response.statusCode },
        })
        const durationMs = now() - runStartMs
        const completed: PipelineRunCompletedEvent = {
          type: 'pipeline.run.completed',
          runId,
          pipelineId,
          status: 'failed',
          completedAt: new Date(now()).toISOString(),
          durationMs,
          counts,
        }
        events.emit(completed)
        return { runId, pipelineId, status: 'failed', ...counts, durationMs, cursor: entry.cursor }
      }

      // Count fetched records - peek into response.data via the
      // mapping's iterate path if present, otherwise treat as single.
      const fetchDurationMs = now() - fetchStart
      const iterate = mapping.iterate
      let recordCount = 0
      if (iterate) {
        // A cheap peek - the full walk happens inside runMapping.
        const arr = evalIteratePathForCount(response.data, iterate)
        recordCount = arr?.length ?? 0
      } else {
        recordCount = response.data !== null && response.data !== undefined ? 1 : 0
      }
      counts.fetched = recordCount

      events.emit({
        type: 'pipeline.run.fetched',
        runId,
        pipelineId,
        recordCount,
        durationMs: fetchDurationMs,
        transportKind: bindings.transport.kind,
      })

      // ── Map ───────────────────────────────────────────────────────
      const mapStart = now()
      const mappingResult = runMapping(response.data, mapping, {
        invokeTransform: buildInvokeTransform(bindings.functionRegistry),
      })
      counts.mapped = mappingResult.instances.length
      counts.skipped = mappingResult.skipped
      counts.errors = mappingResult.errors.length

      events.emit({
        type: 'pipeline.run.mapped',
        runId,
        pipelineId,
        mappedCount: counts.mapped,
        skippedCount: counts.skipped,
        errorCount: counts.errors,
        durationMs: now() - mapStart,
      })

      // ── Write ─────────────────────────────────────────────────────
      const writeStart = now()
      // Phase 10 writes: create each mapped instance in the target
      // provider. Upsert-by-externalId is Phase 10.5 territory; for
      // now the test setup uses a LocalProvider that accepts repeated
      // creates and tests assert on counts rather than identity.
      const targetThingId = extractTargetThingId(pipeline, bindings)
      for (const mapped of mappingResult.instances) {
        try {
          await bindings.provider.create(targetThingId, {
            ...mapped.fields,
            _externalId: mapped.externalId,
          })
          counts.written++
        } catch (e) {
          counts.errors++
          events.emit({
            type: 'pipeline.run.error',
            runId,
            pipelineId,
            phase: 'write',
            reason: e instanceof Error ? e.message : String(e),
            details: { externalId: mapped.externalId },
          })
        }
      }

      events.emit({
        type: 'pipeline.run.written',
        runId,
        pipelineId,
        thingId: targetThingId,
        writtenCount: counts.written,
        durationMs: now() - writeStart,
      })

      // ── Cursor advance ─────────────────────────────────────────────
      if (mappingResult.instances.length > 0) {
        const lastInstance = mappingResult.instances[mappingResult.instances.length - 1]!
        const previous = entry.cursor
        entry.cursor = lastInstance.externalId
        events.emit({
          type: 'pipeline.cursor.advanced',
          runId,
          pipelineId,
          previous,
          current: entry.cursor,
        })
      }

      // ── Completed ─────────────────────────────────────────────────
      const status: 'ok' | 'partial' =
        counts.errors > 0 || mappingResult.errors.length > 0 ? 'partial' : 'ok'
      const durationMs = now() - runStartMs
      events.emit({
        type: 'pipeline.run.completed',
        runId,
        pipelineId,
        status,
        completedAt: new Date(now()).toISOString(),
        durationMs,
        counts,
      })

      return {
        runId,
        pipelineId,
        status,
        fetched: counts.fetched,
        mapped: counts.mapped,
        skipped: counts.skipped,
        errors: counts.errors,
        written: counts.written,
        durationMs,
        cursor: entry.cursor,
      }
    } catch (e) {
      // Unexpected runtime error (not a mapping/fetch failure - those
      // are handled above). This is the "something blew up in the
      // runtime itself" path.
      const durationMs = now() - runStartMs
      events.emit({
        type: 'pipeline.run.error',
        runId,
        pipelineId,
        phase: 'map',
        reason: e instanceof Error ? e.message : String(e),
      })
      events.emit({
        type: 'pipeline.run.completed',
        runId,
        pipelineId,
        status: 'failed',
        completedAt: new Date(now()).toISOString(),
        durationMs,
        counts,
      })
      return {
        runId,
        pipelineId,
        status: 'failed',
        ...counts,
        durationMs,
        cursor: entry.cursor,
      }
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────

  return {
    events,

    register(pipeline, bindings, mappingOverride) {
      const mapping = mappingOverride ?? pipeline.mapping
      if (!mapping) {
        throw new Error(
          `PipelineRuntime: pipeline "${pipeline.uri}" has no mapping - pass a mappingOverride or set pipeline.mapping`,
        )
      }
      const bucket = pipeline.rateLimit
        ? createTokenBucket(
            pipeline.rateLimit.requestsPerSecond,
            pipeline.rateLimit.burstSize ?? pipeline.rateLimit.requestsPerSecond,
            now,
          )
        : null

      const entry: RegisteredPipeline = {
        pipeline,
        bindings,
        mapping,
        bucket,
        cursor: null,
        activeTimer: null,
      }
      pipelines.set(pipeline.uri, entry)
      if (started) scheduleIfNeeded(entry)
    },

    unregister(pipelineId) {
      const entry = pipelines.get(pipelineId)
      if (entry?.activeTimer) entry.activeTimer.clear()
      pipelines.delete(pipelineId)
    },

    runOnce,

    start() {
      if (started) return
      started = true
      for (const entry of pipelines.values()) {
        scheduleIfNeeded(entry)
      }
    },

    stop() {
      started = false
      for (const entry of pipelines.values()) {
        if (entry.activeTimer) {
          entry.activeTimer.clear()
          entry.activeTimer = null
        }
      }
    },

    getCursor(pipelineId) {
      return pipelines.get(pipelineId)?.cursor ?? null
    },
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Very small dot-path walker - used only to count records before
 * runMapping runs. Full evaluation lives in mappingEngine.evalPath.
 */
function evalIteratePathForCount(response: unknown, expr: string): unknown[] | null {
  if (response === null || response === undefined) return null
  const trimmed = expr.trim()
  const path = trimmed.startsWith('$.') ? trimmed.slice(2) : trimmed
  if (path === '' || path === '$') {
    return Array.isArray(response) ? response : null
  }
  let cur: unknown = response
  for (const part of path.split('.').filter(Boolean)) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return null
    cur = (cur as Record<string, unknown>)[part]
  }
  return Array.isArray(cur) ? cur : null
}

/**
 * Resolve the Thing id to write into. Phase 10 uses a config-based
 * override - tests pass `bindings.dataSource.config.targetThingId`.
 * The roadmap's Phase 10.5 wires the `populates` predicate into this
 * lookup so the runtime reads it from the model rather than config.
 */
function extractTargetThingId(pipeline: BmPipeline, bindings: PipelineBindings): string {
  const override = bindings.dataSource.config?.targetThingId as string | undefined
  if (override) return override
  // Fallback: use the pipeline id - tests that don't set a config
  // override are typically using the same id for both.
  return pipeline.uri
}

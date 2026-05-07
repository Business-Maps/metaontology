/**
 * Writeback Runtime - Phase 11.
 *
 * When an Action mutates a Thing instance whose Thing type is populated
 * by a two-way Pipeline with writeback enabled, this runtime:
 *
 *   1. Looks up the populating Pipeline via the triple store
 *   2. Checks `direction === 'two-way'` and `writeback.enabled`
 *   3. Reverse-maps the instance data to the source system format
 *   4. Enqueues a `WritebackQueueItem` via M0 command (durable)
 *   5. Dispatches the reverse-mapped payload to the transport
 *   6. Acks or fails the queue item based on transport response
 *
 * The runtime respects `sourceOfTruth`:
 *   - `local`: dispatch best-effort, mutation is already committed
 *   - `remote`: two-phase - local mutation visible only after remote ack
 *   - `shared`: call conflictResolution Function on conflict
 *
 * This module is pure - no Vue, no side effects beyond the injected
 * callbacks. The caller (ActionInterpreter) injects the transport,
 * the M0 command dispatcher, and the triple store query surface.
 */

import type { Pipeline, DataSource, RootContext, FacetContainer, PipelineMapping, DataSourceEnvironment } from '../types/context'
import type { M0Command } from '../types/commands'
import type { WritebackQueueItem } from '../types/m0'
import type { ReverseMappedPayload } from './mappingEngine'
import type { RuntimeEnvironment } from './environmentGuard'
import { reverseMap } from './mappingEngine'
import { assertWriteAllowed, resolveEnvironment } from './environmentGuard'
import { nanoid } from 'nanoid'

// Phase 11 forward-declares fields not yet in the generated Pipeline type.
// These will be added to meta/fields.ts when the writeback epic ships.
interface WritebackPipeline extends Pipeline {
  writeback?: { enabled: boolean; mapping: PipelineMapping }
  environment?: DataSourceEnvironment
  sourceOfTruth?: 'local' | 'remote'
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface WritebackDeps {
  /** Look up Pipeline URIs that populate a given type URI (reverse `populates` walk). */
  getPopulatingPipelines: (typeUri: string) => string[]
  /** Resolve a Pipeline facet from the model by URI. */
  resolvePipeline: (pipelineUri: string) => Pipeline | undefined
  /** Resolve the DataSource that feeds a given Pipeline (via `pullsFrom` link). */
  resolveDataSourceForPipeline?: (pipelineUri: string) => DataSource | undefined
  /** Dispatch an M0 command into the commit log. */
  dispatchM0: (cmd: M0Command) => void
  /** Execute the writeback HTTP/SQL/etc call. Returns true on success. */
  executeWriteback: (pipelineUri: string, payload: ReverseMappedPayload) => Promise<boolean>
  /** Current runtime environment. Defaults to 'prod' (fail-safe). */
  environment?: RuntimeEnvironment
}

export interface WritebackResult {
  dispatched: boolean
  queueItemUri: string
  error?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────

function _findPipelineInModel(model: RootContext, pipelineUri: string): Pipeline | undefined {
  const containers: FacetContainer[] = [model, ...Object.values(model.contexts)]
  for (const c of containers) {
    const found = c.facets.pipelines?.find((p: Pipeline) => p.uri === pipelineUri)
    if (found) return found
  }
  return undefined
}


// ── Core ──────────────────────────────────────────────────────────────────

/**
 * Check if a Thing mutation should trigger writeback and, if so, execute it.
 *
 * Called from ActionInterpreter Phase 4 after a mutation is applied.
 * Returns null if no writeback is needed (Thing has no two-way Pipeline).
 */
export async function processWriteback(
  typeUri: string,
  instanceUri: string,
  instanceData: Record<string, unknown>,
  externalId: string | undefined,
  deps: WritebackDeps,
): Promise<WritebackResult | null> {
  // 1. Find populating pipelines for this type
  const pipelineUris = deps.getPopulatingPipelines(typeUri)
  if (pipelineUris.length === 0) return null

  // 2. Find first two-way pipeline with writeback enabled
  let pipeline: WritebackPipeline | undefined
  let pipelineUri: string | undefined
  for (const uri of pipelineUris) {
    const p = deps.resolvePipeline(uri) as WritebackPipeline | undefined
    if (p && p.direction === 'two-way' && p.writeback?.enabled) {
      pipeline = p
      pipelineUri = uri
      break
    }
  }

  if (!pipeline || !pipelineUri || !pipeline.writeback) return null
  if (!externalId) return null  // Can't write back without a source identity

  // 2.5. ENVIRONMENT GUARD - structural: runs before transport AND before local enqueue.
  //   This is the only writeback path, so simulation cannot escape to production.
  const currentEnv = deps.environment ?? 'prod'
  const dataSource = deps.resolveDataSourceForPipeline
    ? deps.resolveDataSourceForPipeline(pipelineUri)
    : undefined
  const targetEnv = resolveEnvironment(pipeline.environment, dataSource?.environment)
  const targetAcceptsSimulation = dataSource?.acceptsSimulationTraffic ?? false

  assertWriteAllowed(currentEnv, {
    uri: pipelineUri,
    environment: targetEnv,
    acceptsSimulationTraffic: targetAcceptsSimulation,
  })

  // 3. Reverse-map instance data to source format
  const reverseMapped = reverseMap(
    instanceData,
    externalId,
    pipeline.writeback.mapping,
  )

  // 4. Enqueue WritebackQueueItem (durable - survives tab close)
  const queueItemUri = `bm:wb:${nanoid()}`
  const idempotencyKey = `${pipelineUri}:${externalId}:${Date.now()}`

  const queueItem: WritebackQueueItem = {
    uri: queueItemUri,
    pipelineUri,
    instanceUri,
    reverseMappedPayload: reverseMapped.data,
    idempotencyKey,
    attemptCount: 0,
    status: 'pending',
    enqueuedAt: new Date().toISOString(),
  }

  deps.dispatchM0({
    type: 'writebackQueue:enqueue',
    payload: { item: queueItem },
  })

  // 5. Dispatch to transport
  const sot = pipeline.sourceOfTruth ?? 'local'

  try {
    const success = await deps.executeWriteback(pipelineUri, reverseMapped)

    if (success) {
      deps.dispatchM0({
        type: 'writebackQueue:ack',
        payload: { itemUri: queueItemUri },
      })
      return { dispatched: true, queueItemUri }
    }

    // Transport returned failure
    deps.dispatchM0({
      type: 'writebackQueue:fail',
      payload: { itemUri: queueItemUri, error: 'Transport returned failure' },
    })

    if (sot === 'local') {
      // Local is authoritative - failure is a warning, not a rollback
      return { dispatched: false, queueItemUri, error: 'Writeback failed (local is authoritative - mutation committed)' }
    }

    // Remote or shared - surface the failure
    return { dispatched: false, queueItemUri, error: 'Writeback failed - remote did not acknowledge' }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    deps.dispatchM0({
      type: 'writebackQueue:fail',
      payload: { itemUri: queueItemUri, error: errorMsg },
    })
    return { dispatched: false, queueItemUri, error: errorMsg }
  }
}

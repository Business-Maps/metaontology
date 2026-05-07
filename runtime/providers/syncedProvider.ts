/**
 * SyncedProvider -`) or before first access, stores it locally, and serves
 * reads from the local mirror. Writes go to the local mirror
 * immediately and push to the remote Transport.
 *
 * **Read path:**
 *   findById/findByThing → local mirror (fast, may be stale)
 *   refresh() → transport.execute → mappingEngine → local mirror rebuild
 *
 * **Write path:**
 *   create/update/delete → local mirror updated immediately
 *                        → transport.execute(write) fired async
 *                        → on failure, marks the instance "dirty" for
 *                          the retry queue.
 *
 * This provider ships the read path + the initial local write behavior.
 * Push-to-remote and dirty tracking are structural stubs here and will
 * be fleshed out when the pipelineRuntime lands with its
 * retry + error handling.
 */

import { createLocalProvider } from './localProvider'
import type { LocalProvider } from './localProvider'
import type { Transport, TransportDataSource } from '../transports/types'
import type { SecretValue } from '../secretStore'
import { runMapping } from '../mappingEngine'
import type { PipelineMapping } from '../../types/context'
import type { InstanceRepository } from '../types'

export interface SyncedProviderOptions {
  /** The Thing this provider manages. */
  thingId: string
  /** Transport adapter for pulling/pushing. */
  transport: Transport
  /** DataSource config to pass to the transport. */
  dataSource: TransportDataSource
  /** Mapping spec applied to every pulled response. */
  mapping: PipelineMapping
  /**
   * Path on the DataSource endpoint to hit during refresh. For HTTP,
   * this is the URL suffix (e.g. '/customers'). Interpretation is
   * transport-specific.
   */
  path?: string
  /** Credential resolver - called once per refresh with the dataSource.credentialRef. */
  getCredentials?: () => SecretValue | null | undefined
  /** Deterministic ID generator for tests. */
  generateId?: () => string
}

export interface SyncedProvider extends InstanceRepository {
  /** The Thing this provider manages. */
  readonly thingId: string
  /** Explicit pull - fetches from the transport and rebuilds the local mirror. */
  refresh(): Promise<{ success: boolean; instancesImported: number; errors: number }>
  /** Last successful refresh timestamp (ISO 8601) or null if never refreshed. */
  readonly lastRefreshedAt: () => string | null
}

export function createSyncedProvider(options: SyncedProviderOptions): SyncedProvider {
  const { thingId, transport, dataSource, mapping, path, getCredentials, generateId } = options

  // Local mirror - a LocalProvider scoped to the same thingId. All
  // reads and the storage side of writes go through it.
  const local: LocalProvider = createLocalProvider({ thingId, generateId })
  let lastRefreshedAt: string | null = null

  async function refresh() {
    const credentials = getCredentials?.() ?? null
    const response = await transport.execute(
      { dataSource, operation: 'read', path },
      credentials,
    )
    if (!response.success) {
      return { success: false, instancesImported: 0, errors: 1 }
    }

     // Run the mapping engine over the transport response to produce
     // typed instances. SyncedProvider doesn't know about transforms -
     // mapping with a transform field is left as-is (the transform
     // Function id is dropped if no invokeTransform callback is wired).
    const result = runMapping(response.data, mapping)

     // Replace the local mirror with the refreshed instances. This is
     // the simplest possible reconciliation - could add incremental sync
     // with upsert-by-externalId + deletion detection.
    local._reset()
    for (const instance of result.instances) {
      await local.create(thingId, instance.fields)
    }

    lastRefreshedAt = new Date().toISOString()
    return {
      success: true,
      instancesImported: result.instances.length,
      errors: result.errors.length,
    }
  }

  return {
    thingId,
    lastRefreshedAt: () => lastRefreshedAt,
    refresh,

    // Delegate the InstanceRepository contract straight to the local
    // mirror. Phase 10's writeback logic will intercept the write
    // methods to push changes back to the transport, but for Phase 9
    // we just persist locally.
    create: (tid, data) => local.create(tid, data),
    findById: id => local.findById(id),
    findByThing: (tid, opts) => local.findByThing(tid, opts),
    update: (id, changes) => local.update(id, changes),
    delete: id => local.delete(id),
    query: (expr, model) => local.query(expr, model),
    createRelationship: (p, s, t) => local.createRelationship(p, s, t),
    findRelationships: (id, opts) => local.findRelationships(id, opts),
    deleteRelationship: id => local.deleteRelationship(id),
  }
}

/**
 * HybridProvider -
 *
 * **Read path:**
 *   findById → if cached AND fresh → local
 *            → else transport.execute(read) → update cache → return
 *   findByThing → if full-list cached AND fresh → local
 *               → else transport.execute(list) → replace cache → return
 *
 * **Write path:**
 *   Writes always go through the transport, then the cache is
 *   invalidated for the affected entity (or fully invalidated on
 *   bulk operations).
 *
 * HybridProvider composes a LocalProvider (for cache state) with the
 * Transport (for refreshes). The TTL is tracked separately - one
 * timestamp per cache scope.
 */

import { createLocalProvider } from './localProvider'
import type { LocalProvider } from './localProvider'
import type { Transport, TransportDataSource } from '../transports/types'
import type { SecretValue } from '../secretStore'
import { runMapping } from '../mappingEngine'
import type { PipelineMapping } from '../../types/context'
import type { InstanceRepository, QueryOptions } from '../types'

export interface HybridProviderOptions {
  thingId: string
  transport: Transport
  dataSource: TransportDataSource
  mapping: PipelineMapping
  /** Cache TTL in milliseconds. Default 60 * 1000 (one minute). */
  ttlMs?: number
  listPath?: string
  itemPath?: (id: string) => string
  getCredentials?: () => SecretValue | null | undefined
  generateId?: () => string
  /** Clock source - override for deterministic tests. */
  now?: () => number
}

export interface HybridProvider extends InstanceRepository {
  readonly thingId: string
  /** Force a cache refresh on the next read. */
  invalidate(): void
  /** How many times a read hit the cache since construction. */
  readonly cacheHits: () => number
  /** How many times a read went through to the transport. */
  readonly cacheMisses: () => number
}

export function createHybridProvider(options: HybridProviderOptions): HybridProvider {
  const {
    thingId,
    transport,
    dataSource,
    mapping,
    ttlMs = 60_000,
    listPath,
    getCredentials,
    generateId,
    now = () => Date.now(),
  } = options

  const cache: LocalProvider = createLocalProvider({ thingId, generateId })
  let cachedAt: number | null = null
  let hits = 0
  let misses = 0

  function creds(): SecretValue | null {
    return getCredentials?.() ?? null
  }

  function isFresh(): boolean {
    return cachedAt !== null && (now() - cachedAt) < ttlMs
  }

  async function repopulate(): Promise<void> {
    const response = await transport.execute(
      { dataSource, operation: 'list', path: listPath },
      creds(),
    )
    if (!response.success) {
      // Don't wipe the cache on a failed refresh - serve stale data.
      return
    }
    const mapped = runMapping(response.data, mapping)
    cache._reset()
    for (const instance of mapped.instances) {
      await cache.create(thingId, instance.fields)
    }
    cachedAt = now()
  }

  return {
    thingId,
    cacheHits: () => hits,
    cacheMisses: () => misses,

    invalidate() {
      cachedAt = null
    },

    async create(targetThingId, data) {
      const instance = await cache.create(targetThingId, data)
// Writes always go through the transport. Retry logic on failure could be added; 
// transport errors are surfaced as hard fails.
      const response = await transport.execute(
        { dataSource, operation: 'write', path: listPath, body: data },
        creds(),
      )
      if (!response.success) {
        throw new Error(
          `HybridProvider[${thingId}] create failed on transport: ${response.error}`,
        )
      }
      return instance
    },

    async findById(id) {
      if (isFresh()) {
        hits++
        return cache.findById(id)
      }
      misses++
      await repopulate()
      return cache.findById(id)
    },

    async findByThing(targetThingId, options?: QueryOptions) {
      if (isFresh()) {
        hits++
        return cache.findByThing(targetThingId, options)
      }
      misses++
      await repopulate()
      return cache.findByThing(targetThingId, options)
    },

    async update(id, changes) {
      const response = await transport.execute(
        { dataSource, operation: 'write', path: listPath, body: { id, ...changes } },
        creds(),
      )
      if (!response.success) {
        throw new Error(
          `HybridProvider[${thingId}] update failed on transport: ${response.error}`,
        )
      }
      const updated = await cache.update(id, changes)
      return updated
    },

    async delete(id) {
      const response = await transport.execute(
        { dataSource, operation: 'delete', path: listPath, body: { id } },
        creds(),
      )
      if (!response.success) {
        throw new Error(
          `HybridProvider[${thingId}] delete failed on transport: ${response.error}`,
        )
      }
      await cache.delete(id)
    },

    async query(expr, model) {
      if (!isFresh()) {
        misses++
        await repopulate()
      } else {
        hits++
      }
      return cache.query(expr, model)
    },

    createRelationship: (p, s, t) => cache.createRelationship(p, s, t),
    findRelationships: (id, opts) => cache.findRelationships(id, opts),
    deleteRelationship: id => cache.deleteRelationship(id),
  }
}

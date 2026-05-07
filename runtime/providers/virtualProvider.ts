/**
 * VirtualProvider -
 *  - Cached staleness is unacceptable (financial quotes, real-time
 *    inventory)
 *
 * **Read path:**
 *   findById     → transport.execute(read, path=`${id}`)
 *   findByThing  → transport.execute(list)
 *   query        → transport.execute(list) + local filter
 *
 * **Write path:**
 *   create/update/delete → transport.execute(write|delete) directly
 *
 * VirtualProvider has NO local state. The only thing it keeps is a
 * reference to its Transport, DataSource, and mapping spec.
 * Relationships are not supported in Phase 9 - they would require
 * either a local cache or a transport-native graph query, neither of
 * which ships in the initial version.
 */

import type {
  InstanceRepository,
  RelationshipQueryOptions,
  QueryOptions,
} from '../types'
import type { EntityInstance, RelationshipInstance } from '../../types/instance'
import type { SetExpr } from '../../types/query'
import type { RootContext, PipelineMapping } from '../../types/context'
import type { Transport, TransportDataSource } from '../transports/types'
import type { SecretValue } from '../secretStore'
import { runMapping } from '../mappingEngine'

export interface VirtualProviderOptions {
  thingId: string
  transport: Transport
  dataSource: TransportDataSource
  mapping: PipelineMapping
  /** Base path for list operations (e.g. '/customers'). */
  listPath?: string
  /** Function that derives the path for a single-record read given an id. */
  itemPath?: (id: string) => string
  getCredentials?: () => SecretValue | null | undefined
}

export interface VirtualProvider extends InstanceRepository {
  readonly thingId: string
}

function toEntityInstance(
  thingId: string,
  externalId: string,
  fields: Record<string, unknown>,
): EntityInstance {
  const attributes: Record<string, { type: string; value: unknown }> = {}
  for (const [key, value] of Object.entries(fields)) {
    attributes[key] = { type: 'text', value }
  }
  return {
    id: externalId,
    thingId,
    attributes,
    createdAt: new Date().toISOString(),
  }
}

export function createVirtualProvider(options: VirtualProviderOptions): VirtualProvider {
  const {
    thingId,
    transport,
    dataSource,
    mapping,
    listPath,
    itemPath,
    getCredentials,
  } = options

  function creds(): SecretValue | null {
    return getCredentials?.() ?? null
  }

  return {
    thingId,

    async create(targetThingId, data) {
      if (targetThingId !== thingId) {
        throw new Error(
          `VirtualProvider[${thingId}] cannot create instances for "${targetThingId}"`,
        )
      }
      const response = await transport.execute(
        { dataSource, operation: 'write', path: listPath, body: data },
        creds(),
      )
      if (!response.success) {
        throw new Error(`VirtualProvider[${thingId}] create failed: ${response.error}`)
      }
      // The response shape is transport-specific; we map it back through
      // the same mapping spec to extract the external id + fields.
      const mapped = runMapping(response.data, mapping)
      if (mapped.instances.length === 0) {
        throw new Error(`VirtualProvider[${thingId}] create succeeded but returned no mapped instance`)
      }
      const first = mapped.instances[0]!
      return toEntityInstance(thingId, first.externalId, first.fields)
    },

    async findById(id) {
      const path = itemPath ? itemPath(id) : `${listPath ?? ''}/${id}`
      const response = await transport.execute(
        { dataSource, operation: 'read', path },
        creds(),
      )
      if (!response.success) return null
      const mapped = runMapping(response.data, mapping)
      const first = mapped.instances[0]
      if (!first) return null
      return toEntityInstance(thingId, first.externalId, first.fields)
    },

    async findByThing(targetThingId, options?: QueryOptions) {
      if (targetThingId !== thingId) return []
      const response = await transport.execute(
        { dataSource, operation: 'list', path: listPath, params: options as Record<string, unknown> },
        creds(),
      )
      if (!response.success) return []
      const mapped = runMapping(response.data, mapping)
      return mapped.instances.map(i => toEntityInstance(thingId, i.externalId, i.fields))
    },

    async update(id, changes) {
      const path = itemPath ? itemPath(id) : `${listPath ?? ''}/${id}`
      const response = await transport.execute(
        { dataSource, operation: 'write', path, body: changes },
        creds(),
      )
      if (!response.success) {
        throw new Error(`VirtualProvider[${thingId}] update failed: ${response.error}`)
      }
      const mapped = runMapping(response.data, mapping)
      const first = mapped.instances[0]
      if (!first) {
        return toEntityInstance(thingId, id, changes)
      }
      return toEntityInstance(thingId, first.externalId, first.fields)
    },

    async delete(id) {
      const path = itemPath ? itemPath(id) : `${listPath ?? ''}/${id}`
      const response = await transport.execute(
        { dataSource, operation: 'delete', path },
        creds(),
      )
      if (!response.success) {
        throw new Error(`VirtualProvider[${thingId}] delete failed: ${response.error}`)
      }
    },

    async query(_expr: SetExpr, _model: RootContext) {
      // Baseline: query is "all instances" - same shape as findByThing.
      // Phase 9.7 will introduce set-algebra translation into native
      // transport queries (SQL WHERE clauses, GraphQL filters, etc.).
      const response = await transport.execute(
        { dataSource, operation: 'list', path: listPath },
        creds(),
      )
      if (!response.success) return []
      const mapped = runMapping(response.data, mapping)
      return mapped.instances.map(i => toEntityInstance(thingId, i.externalId, i.fields))
    },

    async createRelationship(_predicate, _sourceId, _targetId): Promise<RelationshipInstance> {
      throw new Error(
        `VirtualProvider[${thingId}] does not support relationships - use a SyncedProvider or LocalProvider for linked data`,
      )
    },

    async findRelationships(_entityId, _options?: RelationshipQueryOptions) {
      return []
    },

    async deleteRelationship(_id) {
      // No-op - no local relationship store
    },
  }
}

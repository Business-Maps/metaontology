/**
 * In-memory InstanceRepository - for generated apps and testing.
 *
 * A fully functional InstanceRepository that stores everything in memory.
 * No persistence, no IndexedDB - just a reactive Map. Generated apps use
 * this as the default storage backend. Production apps swap it for a
 * persistent implementation via the plugin.
 */

import type {
  InstanceRepository,
  QueryOptions,
  RelationshipQueryOptions,
} from './types'
import type {
  EntityInstance,
  RelationshipInstance,
} from '../types/instance'
import { nanoid } from 'nanoid'

export function createInMemoryRepository(): InstanceRepository {
  const entities = new Map<string, EntityInstance>()
  const relationships = new Map<string, RelationshipInstance>()

  return {
    async create(thingId: string, data: Record<string, unknown>): Promise<EntityInstance> {
      const id = nanoid()
      const now = new Date().toISOString()
      const instance: EntityInstance = {
        id,
        thingId,
        attributes: Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, { type: 'unknown', value: v }]),
        ),
        createdAt: now,
        updatedAt: now,
      }
      entities.set(id, instance)
      return instance
    },

    async findById(id: string): Promise<EntityInstance | null> {
      return entities.get(id) ?? null
    },

    async findByThing(thingId: string, options?: QueryOptions): Promise<EntityInstance[]> {
      let results = [...entities.values()].filter(e => e.thingId === thingId)
      if (options?.offset) results = results.slice(options.offset)
      if (options?.limit) results = results.slice(0, options.limit)
      return results
    },

    async update(id: string, changes: Record<string, unknown>): Promise<EntityInstance> {
      const existing = entities.get(id)
      if (!existing) throw new Error(`Entity ${id} not found`)
      const updated: EntityInstance = {
        ...existing,
        attributes: {
          ...existing.attributes,
          ...Object.fromEntries(
            Object.entries(changes).map(([k, v]) => [k, { type: 'unknown', value: v }]),
          ),
        },
        updatedAt: new Date().toISOString(),
      }
      entities.set(id, updated)
      return updated
    },

    async delete(id: string): Promise<void> {
      entities.delete(id)
    },

    async query(): Promise<EntityInstance[]> {
      return [...entities.values()]
    },

    async createRelationship(
      predicate: string,
      sourceId: string,
      targetId: string,
    ): Promise<RelationshipInstance> {
      const id = nanoid()
      const rel: RelationshipInstance = {
        id,
        predicate,
        sourceInstanceId: sourceId,
        targetInstanceId: targetId,
        createdAt: new Date().toISOString(),
      }
      relationships.set(id, rel)
      return rel
    },

    async findRelationships(
      entityId: string,
      options?: RelationshipQueryOptions,
    ): Promise<RelationshipInstance[]> {
      return [...relationships.values()].filter(r => {
        if (options?.predicate && r.predicate !== options.predicate) return false
        if (options?.direction === 'outgoing') return r.sourceInstanceId === entityId
        if (options?.direction === 'incoming') return r.targetInstanceId === entityId
        return r.sourceInstanceId === entityId || r.targetInstanceId === entityId
      })
    },

    async deleteRelationship(id: string): Promise<void> {
      relationships.delete(id)
    },
  }
}

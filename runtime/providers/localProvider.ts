/**
 * LocalProvider -
 *   - The user wants fast local CRUD for test/prototype scenarios
 *   - An M1 Thing has no Pipeline binding at all
 *
 * Phase 9.7 will split the composite repository at the type level; until
 * then, a LocalProvider is scoped to a specific thingId and the composite
 * repository (Phase 9 part 5) routes calls to the right LocalProvider
 * based on the Thing being accessed.
 *
 * **Design choices:**
 *   - In-memory only. IDB persistence is a separate concern.
 *   - No link storage here either - relationships flow through the same
 *     InstanceRepository interface but are scoped to the provider.
 *   - Generated IDs via a monotonic counter + the provider's thing prefix
 *     so IDs are stable across test runs within a provider instance but
 *     unique across different provider instances.
 */

import { nanoid } from 'nanoid'
import type {
  InstanceRepository,
  QueryOptions,
  RelationshipQueryOptions,
} from '../types'
import type {
  EntityInstance,
  RelationshipInstance,
} from '../../types/instance'
import type { SetExpr } from '../../types/query'
import type { RootContext } from '../../types/context'

export interface LocalProviderOptions {
  /** The Thing this provider manages. */
  thingId: string
  /**
   * Optional ID generator - useful for deterministic tests. Defaults
   * to nanoid(). Called with no arguments; must return a unique string.
   */
  generateId?: () => string
  /** Seed the provider with initial instances. */
  seed?: EntityInstance[]
}

export interface LocalProvider extends InstanceRepository {
  /** The Thing this provider manages. */
  readonly thingId: string
  /** Test-only: dump the internal state for assertions. */
  _debugDump(): { instances: EntityInstance[]; relationships: RelationshipInstance[] }
  /** Test-only: clear all data. */
  _reset(): void
}

export function createLocalProvider(options: LocalProviderOptions): LocalProvider {
  const { thingId, generateId = nanoid, seed = [] } = options

  const instances = new Map<string, EntityInstance>()
  for (const instance of seed) {
    instances.set(instance.id, instance)
  }
  const relationships = new Map<string, RelationshipInstance>()

  return {
    thingId,

    async create(targetThingId, data) {
      if (targetThingId !== thingId) {
        throw new Error(
          `LocalProvider[${thingId}] cannot create instances for "${targetThingId}"`,
        )
      }
      const id = generateId()
      const now = new Date().toISOString()
      const attributes: Record<string, { type: string; value: unknown }> = {}
      for (const [key, value] of Object.entries(data)) {
        attributes[key] = { type: 'text', value }
      }
      const instance: EntityInstance = {
        id,
        thingId,
        attributes,
        createdAt: now,
      }
      instances.set(id, instance)
      return instance
    },

    async findById(id) {
      return instances.get(id) ?? null
    },

    async findByThing(targetThingId, options?: QueryOptions) {
      if (targetThingId !== thingId) return []
      const all = Array.from(instances.values())
      const offset = options?.offset ?? 0
      const limit = options?.limit
      return limit === undefined ? all.slice(offset) : all.slice(offset, offset + limit)
    },

    async update(id, changes) {
      const existing = instances.get(id)
      if (!existing) {
        throw new Error(`LocalProvider[${thingId}] instance "${id}" not found`)
      }
      const updatedAttributes = { ...existing.attributes }
      for (const [key, value] of Object.entries(changes)) {
        updatedAttributes[key] = { type: 'text', value }
      }
      const updated: EntityInstance = {
        ...existing,
        attributes: updatedAttributes,
        updatedAt: new Date().toISOString(),
      }
      instances.set(id, updated)
      return updated
    },

    async delete(id) {
      instances.delete(id)
      // Cascade: drop any relationships that reference this instance.
      // A real implementation would emit events so the caller can
      // reconcile downstream views.
      for (const [relId, rel] of relationships.entries()) {
        if (rel.sourceInstanceId === id || rel.targetInstanceId === id) {
          relationships.delete(relId)
        }
      }
    },

    async query(_expr: SetExpr, _model: RootContext) {
      // Phase 9 ships a minimum-viable query: return all instances for
      // this provider's thing. A full set-algebra evaluation against
      // M0 data lives in queryAdapter.ts (evaluateSetExprM0) and will
      // be wired into the provider in Phase 9.7 when the composite
      // splits by type.
      return Array.from(instances.values())
    },

    async createRelationship(predicate, sourceId, targetId) {
      const id = generateId()
      const now = new Date().toISOString()
      const rel: RelationshipInstance = {
        id,
        predicate,
        sourceInstanceId: sourceId,
        targetInstanceId: targetId,
        createdAt: now,
      }
      relationships.set(id, rel)
      return rel
    },

    async findRelationships(entityId, options?: RelationshipQueryOptions) {
      const result: RelationshipInstance[] = []
      for (const rel of relationships.values()) {
        const directionMatches =
          !options?.direction ||
          (options.direction === 'outgoing' && rel.sourceInstanceId === entityId) ||
          (options.direction === 'incoming' && rel.targetInstanceId === entityId)
        const predicateMatches =
          !options?.predicate || rel.predicate === options.predicate
        const entityMatches =
          rel.sourceInstanceId === entityId || rel.targetInstanceId === entityId

        if (entityMatches && directionMatches && predicateMatches) {
          result.push(rel)
        }
      }
      return result
    },

    async deleteRelationship(id) {
      relationships.delete(id)
    },

    _debugDump() {
      return {
        instances: Array.from(instances.values()),
        relationships: Array.from(relationships.values()),
      }
    },

    _reset() {
      instances.clear()
      relationships.clear()
    },
  }
}

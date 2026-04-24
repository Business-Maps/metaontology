/**
 * CompositeRepository - composes multiple InstanceRepository providers into
 * a single logical repository.
 *
 * Routes calls by thingId (the ID of the Thing being accessed).
 *
 * **How it works:**
 *  - Every provider registers the thingId(s) it owns.
 *  - Lookup walks providers until one claims the thingId.
 *  - findByThing and query route directly via the thingId - O(1).
 *  - UI detail views.
 *  - findByThing and query route directly via the thingId - O(1).
 *  - Relationships are provider-scoped.
 *    The composite exposes a `findRelationships` that queries each
 *    provider and unions the results.
 *  - Writes (create/update/delete) are routed by thingId like reads.
 */

import type {
  InstanceRepository,
  QueryOptions,
  RelationshipQueryOptions,
} from './types'
import type { EntityInstance, RelationshipInstance } from '../types/instance'
import type { SetExpr } from '../types/query'
import type { RootContext } from '../types/context'

export interface ProviderRegistration {
  /** The Thing id this provider owns. */
  thingId: string
  /** The provider itself. */
  provider: InstanceRepository
}

export interface CompositeRepository extends InstanceRepository {
  /** Register a provider for a specific Thing. Throws on duplicate thingId. */
  register(registration: ProviderRegistration): void
  /** List all registered Thing ids. */
  registeredThings(): string[]
  /** Look up the provider for a Thing id. */
  getProvider(thingId: string): InstanceRepository | null
}

export function createCompositeRepository(): CompositeRepository {
  const providers = new Map<string, InstanceRepository>()

  return {
    register({ thingId, provider }) {
      if (providers.has(thingId)) {
        throw new Error(
          `CompositeRepository: provider for thingId "${thingId}" is already registered`,
        )
      }
      providers.set(thingId, provider)
    },

    registeredThings() {
      return Array.from(providers.keys())
    },

    getProvider(thingId) {
      return providers.get(thingId) ?? null
    },

    async create(thingId, data) {
      const provider = providers.get(thingId)
      if (!provider) {
        throw new Error(`CompositeRepository: no provider registered for thingId "${thingId}"`)
      }
      return provider.create(thingId, data)
    },

    async findById(id) {
// Walk providers until one returns a hit. O(n) in providers -
// acceptable for the typical <20-Thing map.
// This could be optimized with an ID → thingId index to make findById O(1).
      for (const provider of providers.values()) {
        const found = await provider.findById(id)
        if (found) return found
      }
      return null
    },

    async findByThing(thingId, options?: QueryOptions) {
      const provider = providers.get(thingId)
      if (!provider) return []
      return provider.findByThing(thingId, options)
    },

    async update(id, changes) {
      // Route via findById first to locate the right provider.
      for (const [thingId, provider] of providers.entries()) {
        const found = await provider.findById(id)
        if (found && found.thingId === thingId) {
          return provider.update(id, changes)
        }
      }
      throw new Error(`CompositeRepository: no provider owns instance "${id}"`)
    },

    async delete(id) {
      for (const [thingId, provider] of providers.entries()) {
        const found = await provider.findById(id)
        if (found && found.thingId === thingId) {
          await provider.delete(id)
          return
        }
      }
      throw new Error(`CompositeRepository: no provider owns instance "${id}"`)
    },

    async query(expr: SetExpr, model: RootContext) {
// Baseline: union the query across all providers.
// Could push down per-provider filters via the set-algebra translation.
      const results: EntityInstance[] = []
      for (const provider of providers.values()) {
        const providerResults = await provider.query(expr, model)
        results.push(...providerResults)
      }
      return results
    },

    async createRelationship(predicate, sourceId, targetId) {
// Relationships are owned by the source provider. The composite finds
// the source instance, identifies its provider, and creates the
// relationship there. Cross-provider relationships (where source and
// target are owned by different providers) still work - the
// relationship is stored in the source's provider and the target's
// existence is trust-based until a future consistency check.
      for (const [thingId, provider] of providers.entries()) {
        const found = await provider.findById(sourceId)
        if (found && found.thingId === thingId) {
          return provider.createRelationship(predicate, sourceId, targetId)
        }
      }
      throw new Error(
        `CompositeRepository: no provider owns source instance "${sourceId}" for relationship`,
      )
    },

    async findRelationships(entityId, options?: RelationshipQueryOptions) {
// Union across all providers. Correct-but-inefficient -
// Could optimize via an index.
      const results: RelationshipInstance[] = []
      for (const provider of providers.values()) {
        const rels = await provider.findRelationships(entityId, options)
        results.push(...rels)
      }
      return results
    },

    async deleteRelationship(id) {
      // Try each provider until one owns the relationship. A missing
      // id is silently ignored - matches the underlying provider
      // contract (Map.delete returns false for missing keys).
      for (const provider of providers.values()) {
        try {
          await provider.deleteRelationship(id)
        } catch {
          // Provider may or may not own this relationship - keep trying
        }
      }
    },
  }
}

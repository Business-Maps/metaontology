/**
 * In-memory `InstanceRepository` for tests.
 *
 * Promotes the `createMockRepository()` pattern that was duplicated in
 * `actionInterpreter.test.ts` and `typedCollection.test.ts`. Every new runtime
 * test introduced by the needs an
 * `InstanceRepository` mock; building yet another inline copy is what created
 * the previous duplication. This file is the single source of truth.
 *
 * Design notes:
 *   - The repo is *deliberately simple* - `query` returns all matching entities
 *     by `thingId` rather than evaluating the full SetExpr. Tests that need
 *     full query evaluation should compose this repo with the real
 *     `evaluateSetExprM0` adapter.
 *   - Mutations are reflected synchronously across all read methods. The
 *     async signatures are preserved to match the contract; nothing is
 *     actually deferred.
 *   - All entity/relationship access goes through `snapshot()` and `restore()`
 *     so survival tests (Phase 9.5) can simulate tab close → reopen.
 *   - The repo exposes `callLog` for spy-style assertions ("did the runtime
 *     call delete?"). The log is opt-in to keep happy-path tests clean.
 */

import type { SetExpr } from '../../../types/query'
import type { RootContext } from '../../../types/context'
import type {
  EntityInstance,
  RelationshipInstance,
} from '../../../types/instance'
import type {
  InstanceRepository,
  QueryOptions,
  RelationshipQueryOptions,
} from '../../types'

// ── Call log for spy-style assertions ──────────────────────────────────────

export type RepoCall =
  | { method: 'create'; thingId: string; data: Record<string, unknown> }
  | { method: 'findById'; id: string }
  | { method: 'findByThing'; thingId: string; options?: QueryOptions }
  | { method: 'update'; id: string; changes: Record<string, unknown> }
  | { method: 'delete'; id: string }
  | { method: 'query'; expr: SetExpr }
  | { method: 'createRelationship'; predicate: string; sourceId: string; targetId: string }
  | { method: 'findRelationships'; entityId: string; options?: RelationshipQueryOptions }
  | { method: 'deleteRelationship'; id: string }

// ── Snapshot type for survival tests ───────────────────────────────────────

export interface RepoSnapshot {
  entities: EntityInstance[]
  relationships: RelationshipInstance[]
  nextId: number
}

// ── Extended interface adds test-only affordances ──────────────────────────

export interface InMemoryInstanceRepository extends InstanceRepository {
  /** All API calls in order. Empty until `withCallLog: true` is passed. */
  readonly callLog: readonly RepoCall[]
  /** Direct (synchronous) access to the underlying entities array. */
  readonly entities: readonly EntityInstance[]
  /** Direct (synchronous) access to the underlying relationships array. */
  readonly relationships: readonly RelationshipInstance[]
  /** Number of stored entities. Equivalent to `entities.length`. */
  readonly entityCount: number
  /** Snapshot the current repo state for later `restore()`. Used by survival
   *  tests that simulate tab close → reopen by snapshotting before "crash"
   *  and restoring after. */
  snapshot(): RepoSnapshot
  /** Restore from a previously taken snapshot. Replaces all current state. */
  restore(snap: RepoSnapshot): void
  /** Clear all entities, relationships, and call log. Useful in `beforeEach`. */
  reset(): void
}

// ── Factory ────────────────────────────────────────────────────────────────

export interface InMemoryRepoOptions {
  /** Pre-populate with these entities. Default: empty. */
  entities?: EntityInstance[]
  /** Pre-populate with these relationships. Default: empty. */
  relationships?: RelationshipInstance[]
  /** Record every API call into `callLog`. Default: false (less noise). */
  withCallLog?: boolean
  /** Custom ID generator. Default: incrementing `inst-1`, `inst-2`, ... */
  generateId?: (kind: 'instance' | 'relationship') => string
}

/**
 * Create a fresh in-memory `InstanceRepository`.
 *
 * Each call returns a brand-new repo - there is no shared state between
 * factory invocations.
 *
 * @example
 * const repo = createInMemoryRepo()
 * await repo.create('thing-product', { name: 'Air Max' })
 * expect(repo.entityCount).toBe(1)
 */
export function createInMemoryRepo(opts: InMemoryRepoOptions = {}): InMemoryInstanceRepository {
  const entities: EntityInstance[] = opts.entities ? [...opts.entities] : []
  const relationships: RelationshipInstance[] = opts.relationships ? [...opts.relationships] : []
  const calls: RepoCall[] = []
  let nextId = 1

  const generateId = opts.generateId ?? ((kind) => {
    const prefix = kind === 'instance' ? 'inst' : 'rel'
    return `${prefix}-${nextId++}`
  })

  function logCall(call: RepoCall) {
    if (opts.withCallLog) calls.push(call)
  }

  // Build typed AttributeValues from a plain key/value bag. Mirrors the legacy
  // helper logic from `actionInterpreter.test.ts` so existing tests can swap
  // in this helper without behavior changes.
  function toAttributes(data: Record<string, unknown>): EntityInstance['attributes'] {
    const out: EntityInstance['attributes'] = {}
    for (const [k, v] of Object.entries(data)) {
      // Default to type 'text' to match the legacy mock. Tests that need a
      // different type should construct the EntityInstance directly via
      // `entities` option.
      out[k] = { type: 'text', value: v }
    }
    return out
  }

  const repo: InMemoryInstanceRepository = {
    get callLog() { return calls },
    get entities() { return entities },
    get relationships() { return relationships },
    get entityCount() { return entities.length },

    async create(thingId, data) {
      logCall({ method: 'create', thingId, data })
      const inst: EntityInstance = {
        id: generateId('instance'),
        thingId,
        attributes: toAttributes(data),
        createdAt: new Date().toISOString(),
      }
      entities.push(inst)
      return inst
    },

    async findById(id) {
      logCall({ method: 'findById', id })
      return entities.find(e => e.id === id) ?? null
    },

    async findByThing(thingId, options) {
      logCall({ method: 'findByThing', thingId, options })
      const matches = entities.filter(e => e.thingId === thingId)
      if (options?.offset || options?.limit) {
        const start = options.offset ?? 0
        const end = options.limit !== undefined ? start + options.limit : undefined
        return matches.slice(start, end)
      }
      return matches
    },

    async update(id, changes) {
      logCall({ method: 'update', id, changes })
      const inst = entities.find(e => e.id === id)
      if (!inst) throw new Error(`Instance not found: ${id}`)
      // Merge new attribute values, preserving the existing ones for fields
      // that aren't in `changes`. Matches the legacy mock semantics.
      for (const [k, v] of Object.entries(changes)) {
        inst.attributes[k] = { type: 'text', value: v }
      }
      inst.updatedAt = new Date().toISOString()
      return inst
    },

    async delete(id) {
      logCall({ method: 'delete', id })
      const idx = entities.findIndex(e => e.id === id)
      if (idx !== -1) entities.splice(idx, 1)
    },

    async query(expr: SetExpr, _model: RootContext) {
      logCall({ method: 'query', expr })
      // Simplified evaluator: handles `base` and `ids` directly; everything
      // else returns all entities. Tests that need full query semantics should
      // compose this repo with `evaluateSetExprM0`.
      if (expr.op === 'base') {
        return entities.filter(e => e.thingId === (expr as { op: 'base'; objectType: string }).objectType)
      }
      if (expr.op === 'ids') {
        const ids = (expr as { op: 'ids'; ids: string[] }).ids
        return entities.filter(e => ids.includes(e.id))
      }
      return [...entities]
    },

    async createRelationship(predicate, sourceId, targetId) {
      logCall({ method: 'createRelationship', predicate, sourceId, targetId })
      const rel: RelationshipInstance = {
        id: generateId('relationship'),
        predicate,
        sourceInstanceId: sourceId,
        targetInstanceId: targetId,
        createdAt: new Date().toISOString(),
      }
      relationships.push(rel)
      return rel
    },

    async findRelationships(entityId, options) {
      logCall({ method: 'findRelationships', entityId, options })
      let matches = relationships.filter(r =>
        r.sourceInstanceId === entityId || r.targetInstanceId === entityId,
      )
      if (options?.predicate) {
        matches = matches.filter(r => r.predicate === options.predicate)
      }
      if (options?.direction === 'outgoing') {
        matches = matches.filter(r => r.sourceInstanceId === entityId)
      } else if (options?.direction === 'incoming') {
        matches = matches.filter(r => r.targetInstanceId === entityId)
      }
      return matches
    },

    async deleteRelationship(id) {
      logCall({ method: 'deleteRelationship', id })
      const idx = relationships.findIndex(r => r.id === id)
      if (idx !== -1) relationships.splice(idx, 1)
    },

    snapshot(): RepoSnapshot {
      return {
        entities: structuredClone(entities),
        relationships: structuredClone(relationships),
        nextId,
      }
    },

    restore(snap: RepoSnapshot): void {
      entities.length = 0
      entities.push(...structuredClone(snap.entities))
      relationships.length = 0
      relationships.push(...structuredClone(snap.relationships))
      nextId = snap.nextId
    },

    reset(): void {
      entities.length = 0
      relationships.length = 0
      calls.length = 0
      nextId = 1
    },
  }

  return repo
}

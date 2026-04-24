/**
 * Tests for the in-memory `InstanceRepository` helper. These guard against
 * subtle drifts in the mock semantics - every runtime test in the codebase
 * depends on `createInMemoryRepo()` matching the contract that the real
 * `InstanceRepository` implementations satisfy.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createInMemoryRepo, type InMemoryInstanceRepository } from './inMemoryRepo'
import type { RootContext } from '../../../types/context'
import type { SetExpr } from '../../../types/query'

const STUB_MODEL = {
  id: 'root',
  name: 'Test',
  contexts: {},
  links: [],
  facets: { things: [], personas: [], ports: [], actions: [], workflows: [], interfaces: [], events: [], measures: [] },
} as unknown as RootContext

describe('createInMemoryRepo', () => {
  let repo: InMemoryInstanceRepository

  beforeEach(() => {
    repo = createInMemoryRepo()
  })

  describe('CRUD', () => {
    it('create assigns a fresh id and stores the entity', async () => {
      const inst = await repo.create('thing-product', { name: 'Air Max' })
      expect(inst.id).toBeTruthy()
      expect(inst.thingId).toBe('thing-product')
      expect(inst.attributes.name!.value).toBe('Air Max')
      expect(repo.entityCount).toBe(1)
    })

    it('findById returns null for unknown ids', async () => {
      const inst = await repo.findById('nope')
      expect(inst).toBeNull()
    })

    it('findById returns the stored entity', async () => {
      const created = await repo.create('thing-1', { name: 'A' })
      const found = await repo.findById(created.id)
      expect(found?.id).toBe(created.id)
    })

    it('findByThing returns all entities of a given Thing type', async () => {
      await repo.create('thing-a', { name: '1' })
      await repo.create('thing-a', { name: '2' })
      await repo.create('thing-b', { name: '3' })
      const a = await repo.findByThing('thing-a')
      const b = await repo.findByThing('thing-b')
      expect(a).toHaveLength(2)
      expect(b).toHaveLength(1)
    })

    it('findByThing respects offset and limit', async () => {
      for (let i = 0; i < 10; i++) await repo.create('thing-a', { n: i })
      const slice = await repo.findByThing('thing-a', { offset: 3, limit: 2 })
      expect(slice).toHaveLength(2)
    })

    it('update merges new attribute values', async () => {
      const created = await repo.create('thing-1', { name: 'A', count: '0' })
      await repo.update(created.id, { count: '5' })
      const reloaded = await repo.findById(created.id)
      // Existing attribute preserved
      expect(reloaded?.attributes.name!.value).toBe('A')
      // Updated attribute changed
      expect(reloaded?.attributes.count!.value).toBe('5')
      // updatedAt set
      expect(reloaded?.updatedAt).toBeTruthy()
    })

    it('update throws on unknown id', async () => {
      await expect(repo.update('nope', { x: 'y' })).rejects.toThrow(/not found/)
    })

    it('delete removes the entity', async () => {
      const created = await repo.create('thing-1', { name: 'A' })
      await repo.delete(created.id)
      expect(await repo.findById(created.id)).toBeNull()
      expect(repo.entityCount).toBe(0)
    })

    it('delete on unknown id is a no-op', async () => {
      await expect(repo.delete('nope')).resolves.toBeUndefined()
    })
  })

  describe('relationships', () => {
    it('createRelationship assigns an id and stores the rel', async () => {
      const rel = await repo.createRelationship('relatedTo', 'src', 'tgt')
      expect(rel.id).toBeTruthy()
      expect(rel.predicate).toBe('relatedTo')
      expect(rel.sourceInstanceId).toBe('src')
      expect(rel.targetInstanceId).toBe('tgt')
    })

    it('findRelationships returns relationships in either direction by default', async () => {
      await repo.createRelationship('relatedTo', 'a', 'b')
      await repo.createRelationship('relatedTo', 'b', 'a')
      const rels = await repo.findRelationships('a')
      expect(rels).toHaveLength(2)
    })

    it('findRelationships filters by direction', async () => {
      await repo.createRelationship('relatedTo', 'a', 'b')
      await repo.createRelationship('relatedTo', 'b', 'a')
      const out = await repo.findRelationships('a', { direction: 'outgoing' })
      const inc = await repo.findRelationships('a', { direction: 'incoming' })
      expect(out).toHaveLength(1)
      expect(out[0]!.targetInstanceId).toBe('b')
      expect(inc).toHaveLength(1)
      expect(inc[0]!.sourceInstanceId).toBe('b')
    })

    it('findRelationships filters by predicate', async () => {
      await repo.createRelationship('relatedTo', 'a', 'b')
      await repo.createRelationship('owns', 'a', 'c')
      const owns = await repo.findRelationships('a', { predicate: 'owns' })
      expect(owns).toHaveLength(1)
    })

    it('deleteRelationship removes by id', async () => {
      const rel = await repo.createRelationship('relatedTo', 'a', 'b')
      await repo.deleteRelationship(rel.id)
      expect(await repo.findRelationships('a')).toHaveLength(0)
    })
  })

  describe('query', () => {
    it('base op returns entities matching the objectType', async () => {
      await repo.create('thing-a', { name: '1' })
      await repo.create('thing-b', { name: '2' })
      const expr: SetExpr = { op: 'base', objectType: 'thing-a' }
      const out = await repo.query(expr, STUB_MODEL)
      expect(out).toHaveLength(1)
      expect(out[0]!.thingId).toBe('thing-a')
    })

    it('ids op returns only entities with matching ids', async () => {
      const a = await repo.create('thing-a', { name: '1' })
      await repo.create('thing-a', { name: '2' })
      const expr: SetExpr = { op: 'ids', ids: [a.id] }
      const out = await repo.query(expr, STUB_MODEL)
      expect(out).toHaveLength(1)
      expect(out[0]!.id).toBe(a.id)
    })
  })

  describe('snapshot/restore (survival simulation)', () => {
    it('snapshot captures entities and relationships', async () => {
      await repo.create('t1', { name: 'A' })
      await repo.createRelationship('rel', 'a', 'b')
      const snap = repo.snapshot()
      expect(snap.entities).toHaveLength(1)
      expect(snap.relationships).toHaveLength(1)
    })

    it('restore replaces current state with snapshot state', async () => {
      const a = await repo.create('t1', { name: 'A' })
      const snap = repo.snapshot()
      await repo.create('t1', { name: 'B' })
      expect(repo.entityCount).toBe(2)

      repo.restore(snap)
      expect(repo.entityCount).toBe(1)
      expect((await repo.findById(a.id))?.attributes.name!.value).toBe('A')
    })

    it('restore is independent of the original snapshot (deep clone)', async () => {
      await repo.create('t1', { name: 'A' })
      const snap = repo.snapshot()

      // Mutate the snapshot - restore should be unaffected
      snap.entities[0]!.attributes.name = { type: 'text', value: 'mutated' }

      repo.restore(snap)
      // The mutation lands because restore copies the snapshot at restore time...
      const e = repo.entities[0]!
      expect(e.attributes.name!.value).toBe('mutated')

      // But mutating the snapshot AFTER restore does NOT affect the repo
      snap.entities[0]!.attributes.name = { type: 'text', value: 'reverted' }
      expect(repo.entities[0]!.attributes.name!.value).toBe('mutated')
    })

    it('survives a "tab close" simulation: snapshot, reset, restore', async () => {
      await repo.create('t1', { name: 'persisted' })
      const snap = repo.snapshot()

      // Simulate tab close
      repo.reset()
      expect(repo.entityCount).toBe(0)

      // Simulate reopen
      repo.restore(snap)
      expect(repo.entityCount).toBe(1)
      expect(repo.entities[0]!.attributes.name!.value).toBe('persisted')
    })
  })

  describe('call log', () => {
    it('is empty by default', async () => {
      await repo.create('t1', { name: 'A' })
      expect(repo.callLog).toHaveLength(0)
    })

    it('records every call when withCallLog is true', async () => {
      const r = createInMemoryRepo({ withCallLog: true })
      await r.create('t1', { name: 'A' })
      await r.findById('whatever')
      await r.update((r.entities[0]!).id, { name: 'B' })
      expect(r.callLog).toHaveLength(3)
      expect(r.callLog[0]!.method).toBe('create')
      expect(r.callLog[1]!.method).toBe('findById')
      expect(r.callLog[2]!.method).toBe('update')
    })
  })

  describe('reset', () => {
    it('clears entities, relationships, and call log', async () => {
      const r = createInMemoryRepo({ withCallLog: true })
      await r.create('t1', { name: 'A' })
      await r.createRelationship('rel', 'a', 'b')
      r.reset()
      expect(r.entityCount).toBe(0)
      expect(r.relationships).toHaveLength(0)
      expect(r.callLog).toHaveLength(0)
    })

    it('resets the id sequence so next create returns inst-1', async () => {
      const r = createInMemoryRepo()
      const a = await r.create('t1', { name: 'A' })
      expect(a.id).toBe('inst-1')
      r.reset()
      const b = await r.create('t1', { name: 'B' })
      expect(b.id).toBe('inst-1')
    })
  })

  describe('options', () => {
    it('pre-populates entities', async () => {
      const r = createInMemoryRepo({
        entities: [
          { id: 'pre-1', thingId: 't1', attributes: { name: { type: 'text', value: 'preset' } }, createdAt: '2026-01-01' },
        ],
      })
      expect(r.entityCount).toBe(1)
      expect((await r.findById('pre-1'))?.attributes.name!.value).toBe('preset')
    })

    it('uses a custom id generator', async () => {
      let n = 0
      const r = createInMemoryRepo({ generateId: kind => `${kind}-x${++n}` })
      const inst = await r.create('t1', { name: 'A' })
      expect(inst.id).toBe('instance-x1')
    })
  })
})

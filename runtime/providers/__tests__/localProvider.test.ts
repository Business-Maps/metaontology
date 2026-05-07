/**
 * LocalProvider tests - against
 * an in-memory LocalProvider.
 *
 * // PHASE-9.7-WILL-REVISE
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createLocalProvider } from '../localProvider'
import { createEmptyRootContext } from '../../../engine/apply'

// Deterministic ID generator so test order is stable.
function seqIdGenerator() {
  let counter = 0
  return () => `id-${++counter}`
}

describe('LocalProvider - CRUD', () => {
  let provider: ReturnType<typeof createLocalProvider>

  beforeEach(() => {
    provider = createLocalProvider({
      thingId: 'thing-customer',
      generateId: seqIdGenerator(),
    })
  })

  it('create returns an EntityInstance with generated id and createdAt', async () => {
    const instance = await provider.create('thing-customer', { email: 'a@b.com', name: 'Alice' })
    expect(instance.id).toBe('id-1')
    expect(instance.thingId).toBe('thing-customer')
    expect(instance.attributes.email?.value).toBe('a@b.com')
    expect(instance.attributes.name?.value).toBe('Alice')
    expect(instance.createdAt).toBeTruthy()
  })

  it('create throws when called with a different thingId', async () => {
    await expect(provider.create('thing-order', { total: 100 })).rejects.toThrow(
      /cannot create instances for "thing-order"/,
    )
  })

  it('findById returns the instance when it exists', async () => {
    await provider.create('thing-customer', { email: 'a@b.com' })
    const found = await provider.findById('id-1')
    expect(found).not.toBeNull()
    expect(found!.attributes.email?.value).toBe('a@b.com')
  })

  it('findById returns null when not found', async () => {
    const found = await provider.findById('missing')
    expect(found).toBeNull()
  })

  it('findByThing returns all instances for the matching thingId', async () => {
    await provider.create('thing-customer', { email: 'a@b.com' })
    await provider.create('thing-customer', { email: 'b@b.com' })
    await provider.create('thing-customer', { email: 'c@b.com' })

    const all = await provider.findByThing('thing-customer')
    expect(all).toHaveLength(3)
  })

  it('findByThing returns empty array for a different thingId', async () => {
    await provider.create('thing-customer', { email: 'a@b.com' })
    const other = await provider.findByThing('thing-order')
    expect(other).toEqual([])
  })

  it('findByThing honors limit and offset', async () => {
    for (let i = 0; i < 5; i++) {
      await provider.create('thing-customer', { email: `u${i}@b.com` })
    }
    const page = await provider.findByThing('thing-customer', { limit: 2, offset: 1 })
    expect(page).toHaveLength(2)
    expect(page[0]!.attributes.email?.value).toBe('u1@b.com')
    expect(page[1]!.attributes.email?.value).toBe('u2@b.com')
  })

  it('update modifies fields and sets updatedAt', async () => {
    await provider.create('thing-customer', { email: 'a@b.com', name: 'Alice' })
    const updated = await provider.update('id-1', { name: 'Alice Renamed' })
    expect(updated.attributes.name?.value).toBe('Alice Renamed')
    expect(updated.attributes.email?.value).toBe('a@b.com') // unchanged
    expect(updated.updatedAt).toBeTruthy()
  })

  it('update throws for a missing id', async () => {
    await expect(provider.update('missing', { email: 'x@y.com' })).rejects.toThrow(
      /instance "missing" not found/,
    )
  })

  it('delete removes the instance', async () => {
    await provider.create('thing-customer', { email: 'a@b.com' })
    await provider.delete('id-1')
    expect(await provider.findById('id-1')).toBeNull()
  })
})

describe('LocalProvider - relationships', () => {
  let provider: ReturnType<typeof createLocalProvider>

  beforeEach(() => {
    provider = createLocalProvider({
      thingId: 'thing-customer',
      generateId: seqIdGenerator(),
    })
  })

  it('createRelationship stores a relationship with generated id', async () => {
    const rel = await provider.createRelationship('knows', 'cus-1', 'cus-2')
    expect(rel.id).toBe('id-1')
    expect(rel.predicate).toBe('knows')
    expect(rel.sourceInstanceId).toBe('cus-1')
    expect(rel.targetInstanceId).toBe('cus-2')
    expect(rel.createdAt).toBeTruthy()
  })

  it('findRelationships returns relationships touching an entity', async () => {
    await provider.createRelationship('knows', 'cus-1', 'cus-2')
    await provider.createRelationship('knows', 'cus-3', 'cus-1')

    const both = await provider.findRelationships('cus-1')
    expect(both).toHaveLength(2)
  })

  it('findRelationships filters by outgoing direction', async () => {
    await provider.createRelationship('knows', 'cus-1', 'cus-2')
    await provider.createRelationship('knows', 'cus-3', 'cus-1')

    const outgoing = await provider.findRelationships('cus-1', { direction: 'outgoing' })
    expect(outgoing).toHaveLength(1)
    expect(outgoing[0]!.targetInstanceId).toBe('cus-2')
  })

  it('findRelationships filters by incoming direction', async () => {
    await provider.createRelationship('knows', 'cus-1', 'cus-2')
    await provider.createRelationship('knows', 'cus-3', 'cus-1')

    const incoming = await provider.findRelationships('cus-1', { direction: 'incoming' })
    expect(incoming).toHaveLength(1)
    expect(incoming[0]!.sourceInstanceId).toBe('cus-3')
  })

  it('findRelationships filters by predicate', async () => {
    await provider.createRelationship('knows', 'cus-1', 'cus-2')
    await provider.createRelationship('stewards', 'cus-1', 'cus-3')

    const knows = await provider.findRelationships('cus-1', { predicate: 'knows' })
    expect(knows).toHaveLength(1)
    expect(knows[0]!.targetInstanceId).toBe('cus-2')
  })

  it('deleteRelationship removes a relationship by id', async () => {
    const rel = await provider.createRelationship('knows', 'cus-1', 'cus-2')
    await provider.deleteRelationship(rel.id)
    const remaining = await provider.findRelationships('cus-1')
    expect(remaining).toHaveLength(0)
  })

  it('deleting an instance cascades to its relationships', async () => {
    await provider.create('thing-customer', { name: 'Alice' }) // id-1
    await provider.create('thing-customer', { name: 'Bob' })   // id-2
    await provider.createRelationship('knows', 'id-1', 'id-2')
    await provider.createRelationship('knows', 'id-2', 'id-1')

    await provider.delete('id-1')
    const remaining = await provider.findRelationships('id-2')
    expect(remaining).toHaveLength(0) // both relationships touched id-1
  })
})

describe('LocalProvider - seed + reset', () => {
  it('seeds initial instances', async () => {
    const provider = createLocalProvider({
      thingId: 'thing-customer',
      seed: [
        {
          id: 'seed-1',
          thingId: 'thing-customer',
          attributes: { name: { type: 'text', value: 'Seeded' } },
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    })

    const found = await provider.findById('seed-1')
    expect(found).not.toBeNull()
    expect(found!.attributes.name?.value).toBe('Seeded')
  })

  it('_reset wipes all state', async () => {
    const provider = createLocalProvider({ thingId: 'thing-customer' })
    await provider.create('thing-customer', { email: 'a@b.com' })
    provider._reset()
    expect(provider._debugDump().instances).toHaveLength(0)
  })
})

describe('LocalProvider - query (baseline)', () => {
  it('returns all instances for the provider thingId', async () => {
    const provider = createLocalProvider({
      thingId: 'thing-customer',
      generateId: seqIdGenerator(),
    })
    await provider.create('thing-customer', { email: 'a@b.com' })
    await provider.create('thing-customer', { email: 'b@b.com' })

    const results = await provider.query(
      { op: 'base', objectType: 'thing-customer' } as any,
      createEmptyRootContext('Test'),
    )
    expect(results).toHaveLength(2)
  })
})

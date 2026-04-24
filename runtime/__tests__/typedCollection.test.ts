import { describe, it, expect } from 'vitest'
import { createTypedCollection } from '../typedCollection'
import type { SchemaValidator } from '../typedCollection'
import type { InstanceRepository } from '../types'
import type { EntityInstance, RelationshipInstance } from '../../types/instance'
import type { RootContext } from '../../types/context'
import type { SetExpr } from '../../types/query'

// ── Helpers ─────────────────────────────────────────────────────────────────

interface Product {
  name: string
  price: number
  category: string
}

const productSchema: SchemaValidator<Product> = {
  parse(data: unknown): Product {
    const d = data as Record<string, unknown>
    if (typeof d.name !== 'string') throw new Error('name must be string')
    if (typeof d.price !== 'number') throw new Error('price must be number')
    if (typeof d.category !== 'string') throw new Error('category must be string')
    return { name: d.name as string, price: d.price as number, category: d.category as string }
  },
  partial() {
    return {
      parse(data: unknown): Partial<Product> {
        return data as Partial<Product>
      },
    }
  },
}

function createMockRepo(): InstanceRepository {
  const entities: EntityInstance[] = []
  const relationships: RelationshipInstance[] = []
  let nextId = 1

  return {
    async create(thingId, data) {
      const inst: EntityInstance = {
        id: `inst-${nextId++}`,
        thingId,
        attributes: Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, { type: 'text', value: v }]),
        ),
        createdAt: new Date().toISOString(),
      }
      entities.push(inst)
      return inst
    },
    async findById(id) {
      return entities.find(e => e.id === id) ?? null
    },
    async findByThing(thingId) {
      return entities.filter(e => e.thingId === thingId)
    },
    async update(id, changes) {
      const inst = entities.find(e => e.id === id)
      if (!inst) throw new Error(`not found: ${id}`)
      for (const [k, v] of Object.entries(changes)) {
        inst.attributes[k] = { type: 'text', value: v }
      }
      inst.updatedAt = new Date().toISOString()
      return inst
    },
    async delete(id) {
      const idx = entities.findIndex(e => e.id === id)
      if (idx !== -1) entities.splice(idx, 1)
    },
    async query(_expr: SetExpr, _model: RootContext) {
      // Simplified: return all entities (real evaluator would interpret expr)
      return entities
    },
    async createRelationship(predicate, sourceId, targetId) {
      const rel: RelationshipInstance = {
        id: `rel-${nextId++}`,
        predicate,
        sourceInstanceId: sourceId,
        targetInstanceId: targetId,
        createdAt: new Date().toISOString(),
      }
      relationships.push(rel)
      return rel
    },
    async findRelationships(entityId) {
      return relationships.filter(r =>
        r.sourceInstanceId === entityId || r.targetInstanceId === entityId,
      )
    },
    async deleteRelationship(id) {
      const idx = relationships.findIndex(r => r.id === id)
      if (idx !== -1) relationships.splice(idx, 1)
    },
  }
}

const STUB_MODEL = { id: 'root', name: 'Test', contexts: {}, links: [], facets: { things: [], personas: [], ports: [], actions: [], workflows: [], interfaces: [], events: [], measures: [] } } as unknown as RootContext

// ── Tests ───────────────────────────────────────────────────────────────────

describe('TypedCollection', () => {
  function setup() {
    const repo = createMockRepo()
    const products = createTypedCollection<Product>({
      thingId: 'thing-product',
      schema: productSchema,
      repo,
      model: STUB_MODEL,
    })
    return { repo, products }
  }

  it('creates a validated instance', async () => {
    const { products } = setup()
    const result = await products.create({ name: 'Air Max', price: 199, category: 'shoes' })
    expect(result.id).toBeDefined()
    expect(result.data.name).toBe('Air Max')
    expect(result.data.price).toBe(199)
    expect(result.data.category).toBe('shoes')
    expect(result.createdAt).toBeDefined()
  })

  it('rejects invalid data on create', async () => {
    const { products } = setup()
    await expect(
      products.create({ name: 123 as any, price: 'bad' as any, category: 'shoes' }),
    ).rejects.toThrow()
  })

  it('finds by ID', async () => {
    const { products } = setup()
    const created = await products.create({ name: 'Zoom', price: 150, category: 'running' })
    const found = await products.findById(created.id)
    expect(found).not.toBeNull()
    expect(found!.data.name).toBe('Zoom')
  })

  it('returns null for missing ID', async () => {
    const { products } = setup()
    const found = await products.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('filters by thingId on findById', async () => {
    const { repo, products } = setup()
    // Create an instance with a different thingId directly in the repo
    await repo.create('thing-other', { name: 'NotAProduct' })
    const other = await repo.findByThing('thing-other')
    const found = await products.findById(other[0]!.id)
    expect(found).toBeNull()
  })

  it('finds all instances', async () => {
    const { products } = setup()
    await products.create({ name: 'A', price: 100, category: 'a' })
    await products.create({ name: 'B', price: 200, category: 'b' })
    const all = await products.findAll()
    expect(all).toHaveLength(2)
  })

  it('updates an instance', async () => {
    const { products } = setup()
    const created = await products.create({ name: 'Old', price: 100, category: 'x' })
    const updated = await products.update(created.id, { name: 'New' })
    expect(updated.data.name).toBe('New')
    expect(updated.updatedAt).toBeDefined()
  })

  it('deletes an instance', async () => {
    const { products } = setup()
    const created = await products.create({ name: 'Temp', price: 50, category: 'x' })
    await products.delete(created.id)
    const found = await products.findById(created.id)
    expect(found).toBeNull()
  })

  it('counts instances', async () => {
    const { products } = setup()
    expect(await products.count()).toBe(0)
    await products.create({ name: 'A', price: 100, category: 'a' })
    await products.create({ name: 'B', price: 200, category: 'b' })
    expect(await products.count()).toBe(2)
  })

  it('queries using SetExpr', async () => {
    const { products } = setup()
    await products.create({ name: 'A', price: 100, category: 'a' })
    const results = await products.query({ op: 'base', objectType: 'thing-product' })
    expect(results).toHaveLength(1)
    expect(results[0]!.data.name).toBe('A')
  })
})

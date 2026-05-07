import { describe, it, expect } from 'vitest'
import { createActionInterpreter } from '../actionInterpreter'
import type { RootContext } from '../../types/context'
import type { EntityInstance, RelationshipInstance } from '../../types/instance'
import type { InstanceRepository, ActionContext } from '../types'

function createMockRepository(): InstanceRepository {
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
    async findById(id) { return entities.find(e => e.id === id) ?? null },
    async findByThing(thingId) { return entities.filter(e => e.thingId === thingId) },
    async update(id, changes) {
      const idx = entities.findIndex(e => e.id === id)
      if (idx === -1) throw new Error('Not found')
      for (const [k, v] of Object.entries(changes)) {
        entities[idx]!.attributes[k] = { type: 'text', value: v }
      }
      return entities[idx]!
    },
    async delete(id) {
      const idx = entities.findIndex(e => e.id === id)
      if (idx !== -1) entities.splice(idx, 1)
    },
    async query() { return entities },
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

function makeModel(): RootContext {
  return {
    uri: 'test-map',
    name: 'Test',
    description: '',
    contexts: {},
    links: [],
    symbols: [],
    facets: {
      things: [
        {
          uri: 'thing-1',
          name: 'Item',
          definition: 'An item entity',
          attributes: [
            { name: 'name', type: 'text', required: true },
          ],
        },
      ],
      personas: [],
      ports: [],
      actions: [
        {
          uri: 'action-1',
          name: 'Create Item',
          description: 'Creates a new item',
          type: 'command',
          parameters: [
            { name: 'itemName', type: 'text', required: true },
          ],
          mutations: [
            {
              type: 'create',
              thingId: 'thing-1',
              fieldMappings: {
                name: { from: 'parameter', paramName: 'itemName' },
              },
            },
          ],
        },
      ],
      workflows: [],
      interfaces: [],
      events: [],
      measures: [],
    },
    meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  }
}

function makeCtx(repo?: InstanceRepository, model?: RootContext): ActionContext {
  return {
    model: model ?? makeModel(),
    instances: repo ?? createMockRepository(),
  }
}

describe('createActionInterpreter', () => {
  it('executes action with valid params and creates entity', async () => {
    const repo = createMockRepository()
    const model = makeModel()
    const interpreter = createActionInterpreter(model)
    const ctx = makeCtx(repo, model)

    const result = await interpreter.execute('action-1', { itemName: 'Widget' }, ctx)

    expect(result.success).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.created).toHaveLength(1)
    expect(result.created[0]!.thingId).toBe('thing-1')
    expect(result.created[0]!.attributes.name.value).toBe('Widget')
  })

  it('fails with missing required parameter', async () => {
    const model = makeModel()
    const interpreter = createActionInterpreter(model)
    const ctx = makeCtx(undefined, model)

    const result = await interpreter.execute('action-1', {}, ctx)

    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('Missing required parameter')
    expect(result.created).toHaveLength(0)
  })

  it('fails with nonexistent actionId', async () => {
    const model = makeModel()
    const interpreter = createActionInterpreter(model)
    const ctx = makeCtx(undefined, model)

    const result = await interpreter.execute('nonexistent', { itemName: 'X' }, ctx)

    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('not found in model')
    expect(result.created).toHaveLength(0)
  })
})

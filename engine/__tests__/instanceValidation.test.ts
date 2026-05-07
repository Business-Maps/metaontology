import { describe, it, expect } from 'vitest'
import { validateInstance } from '../instanceValidation'
import type { RootContext } from '../../types/context'
import type { EntityInstance } from '../../types/instance'

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
          name: 'Product',
          definition: 'A product entity',
          attributes: [
            { name: 'name', type: 'text', required: true },
            { name: 'price', type: 'decimal' },
            { name: 'status', type: 'enum', enumValues: ['active', 'inactive'] },
          ],
        },
      ],
      personas: [],
      ports: [],
      actions: [],
      workflows: [],
      interfaces: [],
      events: [],
      measures: [],
    },
    meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  }
}

describe('validateInstance', () => {
  it('succeeds with valid data', () => {
    const model = makeModel()
    const instance: EntityInstance = {
      id: 'inst-1',
      thingId: 'thing-1',
      attributes: {
        name: { type: 'text', value: 'Widget' },
        price: { type: 'decimal', value: 9.99 },
        status: { type: 'enum', value: 'active' },
      },
      createdAt: '2026-01-01',
    }

    const result = validateInstance(instance, model)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('reports missing required field', () => {
    const model = makeModel()
    const instance: EntityInstance = {
      id: 'inst-2',
      thingId: 'thing-1',
      attributes: {
        price: { type: 'decimal', value: 5.0 },
      },
      createdAt: '2026-01-01',
    }

    const result = validateInstance(instance, model)
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.code).toBe('missing-required')
    expect(result.errors[0]!.field).toBe('name')
  })

  it('warns about unknown attribute', () => {
    const model = makeModel()
    const instance: EntityInstance = {
      id: 'inst-3',
      thingId: 'thing-1',
      attributes: {
        name: { type: 'text', value: 'Widget' },
        color: { type: 'text', value: 'red' },
      },
      createdAt: '2026-01-01',
    }

    const result = validateInstance(instance, model)
    expect(result.valid).toBe(true)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]!.code).toBe('unknown-attribute')
    expect(result.warnings[0]!.field).toBe('color')
  })

  it('errors on nonexistent thingId', () => {
    const model = makeModel()
    const instance: EntityInstance = {
      id: 'inst-4',
      thingId: 'nonexistent',
      attributes: {},
      createdAt: '2026-01-01',
    }

    const result = validateInstance(instance, model)
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.code).toBe('thing-not-found')
  })

  it('reports type mismatch', () => {
    const model = makeModel()
    const instance: EntityInstance = {
      id: 'inst-5',
      thingId: 'thing-1',
      attributes: {
        name: { type: 'text', value: 'Widget' },
        price: { type: 'text', value: 'not a number' },
      },
      createdAt: '2026-01-01',
    }

    const result = validateInstance(instance, model)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.code === 'type-mismatch')).toBe(true)
    expect(result.errors.find(e => e.code === 'type-mismatch')!.field).toBe('price')
  })
})

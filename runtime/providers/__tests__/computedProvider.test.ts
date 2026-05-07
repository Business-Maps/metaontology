import { describe, it, expect, beforeEach } from 'vitest'
import { createComputedProvider } from '../computedProvider'
import { createLocalProvider } from '../localProvider'
import { createFunctionRegistry } from '../../functionRuntime'
import type { Function as BmFunction } from '../../../types/context'

function makeFn(id: string, body: any): BmFunction {
  return {
    uri: id,
    name: id,
    tags: [],
    description: '',
    signature: {
      parameters: [{ name: 'record', required: true, cardinality: 'scalar' }],
      returns: { cardinality: 'scalar' },
    },
    body,
    stereotype: 'calculator',
    purity: 'pure',
    cacheable: false,
    visibility: 'internal',
  } as any as BmFunction
}

function seqId() {
  let n = 0
  return () => `id-${++n}`
}

describe('ComputedProvider - read path', () => {
  it('findByThing applies the function to every source instance', async () => {
    const source = createLocalProvider({
      thingId: 'thing-customer',
      generateId: seqId(),
    })
    await source.create('thing-customer', { name: 'Alice', orderTotal: 100 })
    await source.create('thing-customer', { name: 'Bob', orderTotal: 250 })
    await source.create('thing-customer', { name: 'Carol', orderTotal: 500 })

    const calculateTier = makeFn('calculateTier', {
      kind: 'typescript',
      source: 'return { name: record.name, tier: record.orderTotal >= 300 ? "gold" : "silver" }',
    })
    const registry = createFunctionRegistry([calculateTier])

    const provider = createComputedProvider({
      thingId: 'thing-customer-tier',
      functionId: 'calculateTier',
      registry,
      source,
      sourceThingId: 'thing-customer',
    })

    const computed = await provider.findByThing('thing-customer-tier')
    expect(computed).toHaveLength(3)

    const names = computed.map(c => c.attributes.name?.value)
    expect(names).toContain('Alice')
    expect(names).toContain('Bob')
    expect(names).toContain('Carol')

    const carol = computed.find(c => c.attributes.name?.value === 'Carol')!
    expect(carol.attributes.tier?.value).toBe('gold')
    const alice = computed.find(c => c.attributes.name?.value === 'Alice')!
    expect(alice.attributes.tier?.value).toBe('silver')
  })

  it('findById looks up the source and runs the function on it', async () => {
    const source = createLocalProvider({
      thingId: 'thing-customer',
      generateId: seqId(),
    })
    await source.create('thing-customer', { name: 'Alice', orderTotal: 100 })

    const doubleTotal = makeFn('doubleTotal', {
      kind: 'typescript',
      source: 'return { doubled: record.orderTotal * 2 }',
    })
    const registry = createFunctionRegistry([doubleTotal])

    const provider = createComputedProvider({
      thingId: 'thing-doubled',
      functionId: 'doubleTotal',
      registry,
      source,
      sourceThingId: 'thing-customer',
    })

    const result = await provider.findById('id-1')
    expect(result).not.toBeNull()
    expect(result!.attributes.doubled?.value).toBe(200)
  })

  it('findById returns null when the source instance is missing', async () => {
    const source = createLocalProvider({ thingId: 'thing-customer' })
    const doubleTotal = makeFn('doubleTotal', { kind: 'expression', source: '$.orderTotal * 2' })
    const registry = createFunctionRegistry([doubleTotal])

    const provider = createComputedProvider({
      thingId: 'thing-doubled',
      functionId: 'doubleTotal',
      registry,
      source,
      sourceThingId: 'thing-customer',
    })

    expect(await provider.findById('missing')).toBeNull()
  })

  it('findById returns null when the source instance has the wrong thingId', async () => {
    // Create an upstream with a different thingId
    const source = createLocalProvider({ thingId: 'thing-order', generateId: seqId() })
    await source.create('thing-order', { total: 100 })

    const doubleTotal = makeFn('doubleTotal', { kind: 'expression', source: '$.total * 2' })
    const registry = createFunctionRegistry([doubleTotal])

    const provider = createComputedProvider({
      thingId: 'thing-doubled',
      functionId: 'doubleTotal',
      registry,
      source,
      sourceThingId: 'thing-customer', // ← mismatched
    })

    expect(await provider.findById('id-1')).toBeNull()
  })

  it('findByThing with mismatched targetThingId returns empty', async () => {
    const source = createLocalProvider({ thingId: 'thing-customer' })
    const fn = makeFn('fn', { kind: 'expression', source: '1' })
    const registry = createFunctionRegistry([fn])

    const provider = createComputedProvider({
      thingId: 'thing-doubled',
      functionId: 'fn',
      registry,
      source,
      sourceThingId: 'thing-customer',
    })

    expect(await provider.findByThing('thing-other')).toEqual([])
  })

  it('skips source instances whose function invocation fails', async () => {
    const source = createLocalProvider({
      thingId: 'thing-customer',
      generateId: seqId(),
    })
    await source.create('thing-customer', { name: 'Alice', orderTotal: 100 })
    await source.create('thing-customer', { name: 'Bob', orderTotal: 'not-a-number' })

    const dangerous = makeFn('dangerous', {
      kind: 'typescript',
      source: 'if (typeof record.orderTotal !== "number") { throw new Error("bad input") } return { total: record.orderTotal * 2 }',
    })
    const registry = createFunctionRegistry([dangerous])

    const provider = createComputedProvider({
      thingId: 'thing-computed',
      functionId: 'dangerous',
      registry,
      source,
      sourceThingId: 'thing-customer',
    })

    const result = await provider.findByThing('thing-computed')
    // Bob is dropped because his function invocation failed
    expect(result).toHaveLength(1)
    expect(result[0]!.attributes.total?.value).toBe(200)
  })
})

describe('ComputedProvider - read-only contract', () => {
  let provider: ReturnType<typeof createComputedProvider>

  beforeEach(() => {
    const source = createLocalProvider({ thingId: 'thing-customer' })
    const fn = makeFn('fn', { kind: 'expression', source: '1' })
    provider = createComputedProvider({
      thingId: 'thing-computed',
      functionId: 'fn',
      registry: createFunctionRegistry([fn]),
      source,
      sourceThingId: 'thing-customer',
    })
  })

  it('create throws', async () => {
    await expect(provider.create('thing-computed', {})).rejects.toThrow(/read-only/)
  })

  it('update throws', async () => {
    await expect(provider.update('id', {})).rejects.toThrow(/read-only/)
  })

  it('delete throws', async () => {
    await expect(provider.delete('id')).rejects.toThrow(/read-only/)
  })

  it('createRelationship throws', async () => {
    await expect(provider.createRelationship('knows', 'a', 'b')).rejects.toThrow(/read-only/)
  })

  it('findRelationships returns empty', async () => {
    expect(await provider.findRelationships('any')).toEqual([])
  })
})

describe('ComputedProvider - function registry errors', () => {
  it('throws when the function id is not in the registry', async () => {
    const source = createLocalProvider({ thingId: 'thing-customer', generateId: seqId() })
    await source.create('thing-customer', { name: 'Alice' })

    const registry = createFunctionRegistry([]) // empty
    const provider = createComputedProvider({
      thingId: 'thing-computed',
      functionId: 'missing',
      registry,
      source,
      sourceThingId: 'thing-customer',
    })

    await expect(provider.findById('id-1')).rejects.toThrow(/"missing" not found in registry/)
  })
})

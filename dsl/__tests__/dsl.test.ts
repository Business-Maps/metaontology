/**
 * DSL contract tests - Phase 1 chunk 1.1.
 *
 * These tests pin the behavior of the DSL primitives:
 *   - `defineFacetType` / `defineThing` / etc. register their declarations.
 *   - Registry lookups return the expected records.
 *   - Handle methods don't crash (runtime dispatch is stubbed in this chunk;
 *     those behaviors are tested in the runtime wiring chunk).
 *
 * The real typechecking validation lives in the compile-time spike
 * at `../_spike.ts`. These runtime tests complement it: the spike
 * proves the *types* work, these tests prove the *runtime* does
 * what the types claim.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  defineFacetType,
  defineThing,
  definePersona,
  defineAction,
  definePredicate,
  defineDatatype,
  defineValueType,
  defineStereotype,
  getFacetType,
  getActionType,
  getPredicate,
  getDatatype,
  getValueType,
  getStereotype,
  listFacetTypes,
  listFacetTypesByBaseType,
  resetRegistry,
  decimal,
  text,
  integer,
  reference,
  enumOf,
  list,
  object,
} from '../index'

beforeEach(() => {
  resetRegistry()
})

describe('defineFacetType', () => {
  it('registers a facet type with no base type', () => {
    defineFacetType('customThing', {
      attributes: { x: decimal, y: decimal },
    })

    const decl = getFacetType('customThing')
    expect(decl).toBeDefined()
    expect(decl!.id).toBe('customThing')
    expect(decl!.baseType).toBeNull()
    expect(decl!.attributes.x).toBeDefined()
    expect(decl!.attributes.y).toBeDefined()
  })

  it('carries tier, hidden, and label through to the declaration', () => {
    defineFacetType('advancedThing', {
      attributes: {},
      tier: 3,
      hidden: true,
      label: { en: 'Advanced Thing' },
    })

    const decl = getFacetType('advancedThing')
    expect(decl!.tier).toBe(3)
    expect(decl!.hidden).toBe(true)
    expect(decl!.label?.en).toBe('Advanced Thing')
  })

  it('returns a branded handle with the correct id', () => {
    const handle = defineFacetType('brandedThing', {})
    expect(handle.__brand).toBe('FacetHandle')
    expect(handle.__id).toBe('brandedThing')
    expect(handle.typeId).toBe('brandedThing')
  })
})

describe('defineThing', () => {
  it('registers the declaration with baseType="thing"', () => {
    defineThing('exampleNode', {
      attributes: { x: decimal, y: decimal },
    })

    const decl = getFacetType('exampleNode')
    expect(decl).toBeDefined()
    expect(decl!.baseType).toBe('thing')
  })

  it('handles composite attributes (list, object, enumOf)', () => {
    defineThing('complexThing', {
      attributes: {
        stage: enumOf('draft', 'active', 'archived'),
        fields: list(object({ name: text, type: text })),
      },
    })

    const decl = getFacetType('complexThing')
    expect(decl).toBeDefined()
    expect(decl!.attributes.stage).toBeDefined()
    expect(decl!.attributes.fields).toBeDefined()
  })

  it('supports reference attributes pointing at other handles', () => {
    const target = defineThing('target', { attributes: {} })
    defineThing('pointer', {
      attributes: { pointsAt: reference().to(target) },
    })

    const decl = getFacetType('pointer')
    expect(decl!.attributes.pointsAt).toBeDefined()
  })

  it('is idempotent on id - calling twice with the same id returns the first registration', () => {
    defineThing('onceThing', { attributes: { x: decimal } })
    defineThing('onceThing', { attributes: { y: decimal } })

    const decl = getFacetType('onceThing')
    // The first registration wins; the second call is a no-op on the registry.
    expect(decl).toBeDefined()
    expect(decl!.attributes.x).toBeDefined()
    expect(decl!.attributes.y).toBeUndefined()
  })
})

describe('definePersona, definePort, etc. - shared BM primitive behavior', () => {
  it('definePersona registers with baseType="persona"', () => {
    definePersona('customer', { attributes: {} })
    expect(getFacetType('customer')!.baseType).toBe('persona')
  })

  it('listFacetTypesByBaseType groups subtypes correctly', () => {
    defineThing('thingA', { attributes: {} })
    defineThing('thingB', { attributes: {} })
    definePersona('personaA', { attributes: {} })

    const things = listFacetTypesByBaseType('thing')
    const personas = listFacetTypesByBaseType('persona')

    expect(things.map(d => d.id).sort()).toEqual(['thingA', 'thingB'])
    expect(personas.map(d => d.id)).toEqual(['personaA'])
  })

  it('listFacetTypes returns every registered facet type', () => {
    defineThing('t1', { attributes: {} })
    definePersona('p1', { attributes: {} })
    defineFacetType('generic1', {})

    const all = listFacetTypes()
    expect(all.map(d => d.id).sort()).toEqual(['generic1', 'p1', 't1'])
  })
})

describe('defineAction', () => {
  it('registers an action with typed parameters', () => {
    const exampleNode = defineThing('exampleNode', {
      attributes: { x: decimal, y: decimal },
    })

    defineAction('dragNode', {
      type: 'command',
      description: 'Move a canvas node by (dx, dy) pixels',
      parameters: {
        node: reference().to(exampleNode),
        dx: decimal,
        dy: decimal,
      },
      mutations: [
        { type: 'modify', target: 'node', field: 'x', formula: 'node.x + $params.dx' },
        { type: 'modify', target: 'node', field: 'y', formula: 'node.y + $params.dy' },
      ],
      authorization: 'any-authenticated',
    })

    const decl = getActionType('dragNode')
    expect(decl).toBeDefined()
    expect(decl!.actionType).toBe('command')
    expect(decl!.description).toContain('canvas node')
    expect(decl!.parameters.node).toBeDefined()
    expect(decl!.mutations).toHaveLength(2)
    expect(decl!.mutations[0]!.target).toBe('node')
    expect(decl!.mutations[0]!.field).toBe('x')
    expect(decl!.authorization).toBe('any-authenticated')
  })

  it('returns an ActionHandle with a stubbed dispatch', async () => {
    const exampleNode = defineThing('exampleNode', { attributes: { x: decimal, y: decimal } })
    const drag = defineAction('drag', {
      type: 'command',
      description: 'stub',
      parameters: { node: reference().to(exampleNode), dx: decimal, dy: decimal },
    })

    expect(drag.__brand).toBe('ActionHandle')
    expect(drag.actionId).toBe('drag')

    const result = await drag.dispatch({ node: 'node-1', dx: 10, dy: 20 })
    expect(result.success).toBe(true)
  })
})

describe('definePredicate', () => {
  it('registers a predicate with domain/range handles', () => {
    const thing = defineThing('thing', { attributes: {} })
    const persona = definePersona('persona', { attributes: {} })

    definePredicate('performs', {
      domain: [persona],
      range: [thing],
      label: { en: 'performs' },
      inverseLabel: { en: 'performed by' },
    })

    const decl = getPredicate('performs')
    expect(decl).toBeDefined()
    expect(decl!.domain).toEqual([{ typeId: 'persona' }])
    expect(decl!.range).toEqual([{ typeId: 'thing' }])
    expect(decl!.label?.en).toBe('performs')
  })
})

describe('defineDatatype, defineValueType, defineStereotype', () => {
  it('defineDatatype registers', () => {
    defineDatatype('customNum', {
      xsd: 'xsd:decimal',
      baseType: 'number',
      tsType: 'number',
      label: { en: 'Custom Number' },
    })

    const decl = getDatatype('customNum')
    expect(decl).toBeDefined()
    expect(decl!.xsd).toBe('xsd:decimal')
  })

  it('defineValueType registers with constraints', () => {
    defineValueType('ratingOneToFive', {
      baseType: 'integer',
      constraints: [{ type: 'range', min: 1, max: 5 }],
    })

    const decl = getValueType('ratingOneToFive')
    expect(decl).toBeDefined()
    expect(decl!.constraints).toHaveLength(1)
    expect((decl!.constraints[0]! as { type: 'range'; min: number; max: number }).min).toBe(1)
  })

  it('defineStereotype registers', () => {
    defineStereotype('hypothetical', {
      description: 'A hypothesized entity not yet validated',
    })

    const decl = getStereotype('hypothetical')
    expect(decl).toBeDefined()
    expect(decl!.description).toContain('hypothesized')
  })
})

describe('resetRegistry', () => {
  it('clears all declarations', () => {
    defineThing('toBeCleared', { attributes: {} })
    expect(getFacetType('toBeCleared')).toBeDefined()

    resetRegistry()

    expect(getFacetType('toBeCleared')).toBeUndefined()
    expect(listFacetTypes()).toHaveLength(0)
  })
})

describe('handle runtime method stubs (Phase 1 chunk 1.1)', () => {
  it('FacetHandle.add returns a stub id without crashing', () => {
    const handle = defineThing('stubThing', { attributes: { x: decimal } })
    const id = handle.add({ name: 'one', definition: 'desc', x: 1 })
    expect(typeof id).toBe('string')
  })

  it('FacetHandle.findById returns undefined from the stub', () => {
    const handle = defineThing('stubThing2', { attributes: { x: decimal } })
    expect(handle.findByUri('nonexistent')).toBeUndefined()
  })

  it('FacetHandle.where returns an empty result from the stub', () => {
    const handle = defineThing('stubThing3', { attributes: { x: decimal } })
    const result = handle.where(() => true)
    expect(result.all()).toEqual([])
    expect(result.first()).toBeUndefined()
    expect(result.count()).toBe(0)
  })

  it('FacetHandle.update does not throw', () => {
    const handle = defineThing('stubThing4', { attributes: { x: decimal } })
    expect(() => handle.update('id', { x: 5 })).not.toThrow()
  })

  it('FacetHandle.remove does not throw', () => {
    const handle = defineThing('stubThing5', { attributes: { x: decimal } })
    expect(() => handle.remove('id')).not.toThrow()
  })
})

describe('integer and other primitive schemas', () => {
  it('integer is a valid primitive schema', () => {
    const handle = defineThing('intHolder', { attributes: { count: integer } })
    expect(getFacetType('intHolder')!.attributes.count).toBeDefined()
  })
})

/**
 * Core registration tests - verifies that importing the core barrel
 * populates the DSL registry with base types, datatypes, value types,
 * and stereotypes.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  listFacetTypes,
  listFacetTypesByBaseType,
  listDatatypes,
  listValueTypes,
  listStereotypes,
  listPredicates,
  getFacetType,
  getDatatype,
  getStereotype,
  getValueType,
  getPredicate,
  resetRegistry,
} from '../../dsl/registry'

// Import the core barrel - this triggers all registrations
import '../../core/index'

beforeEach(() => {
  // Reset + re-import. Since the registrations are idempotent on id
  // and run at import time (already executed), we need to re-run them.
  // For test isolation, re-importing would be ideal but ES modules
  // are cached. Instead, we accept that the registry carries the
  // core declarations across all tests in this file (since they're
  // the same declarations every time). Individual test suites that
  // need a clean registry should reset + re-register.
})

describe('core base types', () => {
  it('registers all 11 abstract base types', () => {
    const baseTypes = listFacetTypes().filter(d => d.baseType === null)
    expect(baseTypes.length).toBeGreaterThanOrEqual(11)
  })

  it('each base type has the expected id and tier', () => {
    const thing = getFacetType('thing')
    expect(thing).toBeDefined()
    expect(thing!.tier).toBe(1)
    expect(thing!.label?.en).toBe('Things')

    const persona = getFacetType('persona')
    expect(persona!.tier).toBe(1)

    const action = getFacetType('action')
    expect(action!.tier).toBe(2)

    const interfaceType = getFacetType('interface')
    expect(interfaceType!.tier).toBe(3)

    const pipeline = getFacetType('pipeline')
    expect(pipeline!.tier).toBe(3)
  })

  it('listFacetTypesByBaseType returns empty for abstract types (they have no subtypes yet)', () => {
    // Until a consumer calls defineThing('exampleNode', ...),
    // there are no Thing subtypes in the registry - only the base.
    const thingSubtypes = listFacetTypesByBaseType('thing')
    expect(thingSubtypes).toHaveLength(0)
  })
})

describe('core datatypes', () => {
  it('registers all 18 built-in datatypes', () => {
    const dts = listDatatypes()
    expect(dts.length).toBeGreaterThanOrEqual(18)
  })

  it('text datatype has the right shape', () => {
    const text = getDatatype('text')
    expect(text).toBeDefined()
    expect(text!.xsd).toBe('xsd:string')
    expect(text!.baseType).toBe('string')
    expect(text!.tsType).toBe('string')
  })

  it('money datatype has extraFields', () => {
    const money = getDatatype('money')
    expect(money).toBeDefined()
    expect(money!.extraFields).toContain('currencyCode')
  })

  it('identifier datatype has a pattern', () => {
    const id = getDatatype('identifier')
    expect(id).toBeDefined()
    expect(id!.pattern).toBe('\\S+')
  })
})

describe('core value types', () => {
  it('registers all 10 built-in value types', () => {
    const vts = listValueTypes()
    expect(vts.length).toBeGreaterThanOrEqual(10)
  })

  it('email value type has a regex constraint', () => {
    const email = getValueType('email')
    expect(email).toBeDefined()
    expect(email!.constraints.length).toBeGreaterThan(0)
    expect(email!.constraints[0]!.type).toBe('regex')
  })

  it('rating-5 value type has a range constraint', () => {
    const rating = getValueType('rating-5')
    expect(rating).toBeDefined()
    const rangeConstraint = rating!.constraints.find(c => c.type === 'range') as { type: 'range'; min: number; max: number }
    expect(rangeConstraint.min).toBe(1)
    expect(rangeConstraint.max).toBe(5)
  })
})

describe('core stereotypes', () => {
  it('registers thing, persona, and measure stereotypes', () => {
    const all = listStereotypes()
    // 8 thing stereotypes + 5 persona stereotypes + 3 measure stereotypes = 16
    expect(all.length).toBeGreaterThanOrEqual(16)
  })

  it('entity stereotype has a description', () => {
    const entity = getStereotype('entity')
    expect(entity).toBeDefined()
    expect(entity!.description).toContain('Mutable domain object')
  })

  it('human stereotype is registered', () => {
    const human = getStereotype('human')
    expect(human).toBeDefined()
    expect(human!.description).toContain('Individual person')
  })

  it('metric stereotype is registered', () => {
    const metric = getStereotype('metric')
    expect(metric).toBeDefined()
    expect(metric!.description).toContain('KPI')
  })
})

describe('core predicates', () => {
  it('registers at least 45 predicates', () => {
    const preds = listPredicates()
    expect(preds.length).toBeGreaterThanOrEqual(45)
  })

  it('performs predicate has Persona domain and Action range', () => {
    const p = getPredicate('performs')
    expect(p).toBeDefined()
    expect(p!.domain.map(d => d.typeId)).toContain('persona')
    expect(p!.range.map(r => r.typeId)).toContain('action')
    expect(p!.label?.en).toBe('performs')
    expect(p!.inverseLabel?.en).toBe('performed by')
  })

  it('valueStream predicate connects Context and Port', () => {
    const p = getPredicate('valueStream')
    expect(p).toBeDefined()
    expect(p!.domain.map(d => d.typeId)).toContain('context')
    expect(p!.domain.map(d => d.typeId)).toContain('port')
  })

  it('pullsFrom predicate connects Pipeline to DataSource', () => {
    const p = getPredicate('pullsFrom')
    expect(p).toBeDefined()
    expect(p!.domain.map(d => d.typeId)).toContain('pipeline')
    expect(p!.range.map(r => r.typeId)).toContain('dataSource')
  })

  it('custom predicate accepts all major types', () => {
    const p = getPredicate('custom')
    expect(p).toBeDefined()
    expect(p!.domain.length).toBeGreaterThanOrEqual(8)
    expect(p!.range.length).toBeGreaterThanOrEqual(8)
  })

  it('structural predicates are registered (childOf, memberOf, hasTag)', () => {
    expect(getPredicate('childOf')).toBeDefined()
    expect(getPredicate('memberOf')).toBeDefined()
    expect(getPredicate('hasTag')).toBeDefined()
  })
})

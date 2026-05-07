import { describe, it, expect } from 'vitest'
import { fromEntity, fromIds, fromContext, fromTag } from '../queryBuilder'
import type { SetExpr, FilterExpr } from '../../types/query'

describe('QueryBuilder', () => {
  describe('entry points', () => {
    it('fromEntity creates a base set expression', () => {
      const expr = fromEntity('Product').toExpr()
      expect(expr).toEqual({ op: 'base', objectType: 'Product' })
    })

    it('fromIds creates an ids set expression', () => {
      const expr = fromIds('a', 'b', 'c').toExpr()
      expect(expr).toEqual({ op: 'ids', ids: ['a', 'b', 'c'] })
    })

    it('fromContext creates a context set expression', () => {
      const expr = fromContext('ctx-1').toExpr()
      expect(expr).toEqual({ op: 'context', contextId: 'ctx-1' })
    })

    it('fromTag creates a tagged set expression', () => {
      const expr = fromTag('important').toExpr()
      expect(expr).toEqual({ op: 'tagged', tag: 'important' })
    })
  })

  describe('where (filtering)', () => {
    it('simple equality', () => {
      const expr = fromEntity('Product').where({ category: 'shoes' }).toExpr() as any
      expect(expr.op).toBe('filter')
      expect(expr.base).toEqual({ op: 'base', objectType: 'Product' })
      expect(expr.where).toEqual({ op: 'eq', field: 'category', value: 'shoes' })
    })

    it('comparison operator', () => {
      const expr = fromEntity('Product').where({ price: { gte: 200 } }).toExpr() as any
      expect(expr.where).toEqual({ op: 'gte', field: 'price', value: 200 })
    })

    it('contains operator', () => {
      const expr = fromEntity('Product').where({ name: { contains: 'air' } }).toExpr() as any
      expect(expr.where).toEqual({ op: 'contains', field: 'name', value: 'air' })
    })

    it('in operator', () => {
      const expr = fromEntity('Product').where({ status: { in: ['active', 'preorder'] } }).toExpr() as any
      expect(expr.where).toEqual({ op: 'in', field: 'status', values: ['active', 'preorder'] })
    })

    it('null value becomes isNull', () => {
      const expr = fromEntity('Product').where({ deletedAt: null }).toExpr() as any
      expect(expr.where).toEqual({ op: 'isNull', field: 'deletedAt' })
    })

    it('multiple fields AND together', () => {
      const expr = fromEntity('Product').where({ category: 'shoes', price: { gte: 100 } }).toExpr() as any
      expect(expr.where.op).toBe('and')
      expect(expr.where.conditions).toHaveLength(2)
    })

    it('chained where calls stack filters', () => {
      const expr = fromEntity('Product')
        .where({ category: 'shoes' })
        .where({ price: { gte: 200 } })
        .toExpr() as any

      // Outer filter wraps inner filter
      expect(expr.op).toBe('filter')
      expect(expr.base.op).toBe('filter')
      expect(expr.base.base.op).toBe('base')
    })

    it('multiple operators on same field AND together', () => {
      const expr = fromEntity('Product').where({ price: { gte: 100, lte: 500 } }).toExpr() as any
      expect(expr.where.op).toBe('and')
      expect(expr.where.conditions).toContainEqual({ op: 'gte', field: 'price', value: 100 })
      expect(expr.where.conditions).toContainEqual({ op: 'lte', field: 'price', value: 500 })
    })
  })

  describe('traverse', () => {
    it('traverses a predicate outward by default', () => {
      const expr = fromIds('persona-1').traverse('performs').toExpr() as any
      expect(expr).toEqual({
        op: 'traverse',
        from: { op: 'ids', ids: ['persona-1'] },
        predicate: 'performs',
        direction: 'out',
      })
    })

    it('traverses inward', () => {
      const expr = fromIds('action-1').traverse('performs', 'in').toExpr() as any
      expect(expr.direction).toBe('in')
    })
  })

  describe('set operations', () => {
    it('union combines sets', () => {
      const a = fromEntity('Product').where({ status: 'active' })
      const b = fromEntity('Product').where({ status: 'preorder' })
      const expr = a.union(b).toExpr() as any
      expect(expr.op).toBe('union')
      expect(expr.sets).toHaveLength(2)
    })

    it('intersect combines sets', () => {
      const a = fromEntity('Product').where({ category: 'shoes' })
      const b = fromTag('featured')
      const expr = a.intersect(b).toExpr() as any
      expect(expr.op).toBe('intersect')
      expect(expr.sets).toHaveLength(2)
    })

    it('subtract removes from set', () => {
      const all = fromEntity('Product')
      const discontinued = fromTag('discontinued')
      const expr = all.subtract(discontinued).toExpr() as any
      expect(expr.op).toBe('subtract')
      expect(expr.from).toEqual({ op: 'base', objectType: 'Product' })
      expect(expr.minus).toEqual({ op: 'tagged', tag: 'discontinued' })
    })
  })

  describe('composition', () => {
    it('complex query compiles correctly', () => {
      // "All active products in the shoes category that are NOT discontinued,
      //  PLUS all featured products"
      const activeShoes = fromEntity('Product')
        .where({ category: 'shoes', status: 'active' })
        .subtract(fromTag('discontinued'))
      const featured = fromTag('featured')
      const expr = activeShoes.union(featured).toExpr()

      expect(expr).toBeDefined()
      expect((expr as any).op).toBe('union')
    })
  })
})

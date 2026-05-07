/**
 * QueryBuilder - a chainable, typed query builder that compiles to SetExpr.
 *
 * Provides an ergonomic API for building queries while always allowing
 * drop-down to raw SetExpr for anything the builder doesn't cover.
 *
 * Usage:
 *   const shoes = fromEntity<Product>('Product').where({ category: 'shoes' })
 *   const expr = shoes.toExpr()  // → SetExpr ready for evaluation
 */

import type { SetExpr, FilterExpr } from '../types/query'

// ── Public types ────────────────────────────────────────────────────────────

/** Chainable typed query over a set of entities. */
export interface EntityQuery<T> {
  /** Filter by field conditions. Chainable - successive calls AND together. */
  where(conditions: WhereConditions<T>): EntityQuery<T>
  /** Traverse a predicate from this result set. */
  traverse(predicate: string, direction?: 'out' | 'in' | 'both'): EntityQuery<unknown>
  /** Union with other queries. */
  union(...others: EntityQuery<unknown>[]): EntityQuery<T>
  /** Intersect with other queries. */
  intersect(...others: EntityQuery<unknown>[]): EntityQuery<T>
  /** Subtract another query's results from this set. */
  subtract(other: EntityQuery<unknown>): EntityQuery<T>
  /** Compile to the raw SetExpr algebra. */
  toExpr(): SetExpr
}

/**
 * Filter conditions for a typed entity.
 * Simple values mean equality. Objects with operator keys mean comparison.
 *
 * Example:
 *   { category: 'shoes' }                    → eq
 *   { price: { gte: 200 } }                  → gte
 *   { name: { contains: 'air' } }            → contains
 *   { status: { in: ['active', 'preorder'] }} → in
 */
export type WhereConditions<T> = {
  [K in keyof T]?: T[K] | ComparisonOp
}

export type ComparisonOp = {
  eq?: unknown
  neq?: unknown
  gt?: unknown
  gte?: unknown
  lt?: unknown
  lte?: unknown
  contains?: string
  startsWith?: string
  regex?: string
  in?: unknown[]
  isNull?: true
  isNotNull?: true
}

// ── Entry points ────────────────────────────────────────────────────────────

/** Start a query from all entities of a given type. */
export function fromEntity<T = unknown>(objectType: string): EntityQuery<T> {
  return buildQuery<T>({ op: 'base', objectType })
}

/** Start a query from specific entity IDs. */
export function fromIds<T = unknown>(...ids: string[]): EntityQuery<T> {
  return buildQuery<T>({ op: 'ids', ids })
}

/** Start a query from entities in a context. */
export function fromContext<T = unknown>(contextId: string): EntityQuery<T> {
  return buildQuery<T>({ op: 'context', contextId })
}

/** Start a query from entities with a tag. */
export function fromTag<T = unknown>(tag: string): EntityQuery<T> {
  return buildQuery<T>({ op: 'tagged', tag })
}

// ── Builder implementation ──────────────────────────────────────────────────

function buildQuery<T>(expr: SetExpr): EntityQuery<T> {
  return {
    where(conditions) {
      const filters = Object.entries(conditions as Record<string, unknown>)
        .map(([field, value]) => toFilterExpr(field, value))
      const where: FilterExpr = filters.length === 1
        ? filters[0]!
        : { op: 'and', conditions: filters }
      return buildQuery<T>({ op: 'filter', base: expr, where })
    },

    traverse(predicate, direction = 'out') {
      return buildQuery<unknown>({
        op: 'traverse', from: expr, predicate, direction,
      })
    },

    union(...others) {
      return buildQuery<T>({
        op: 'union', sets: [expr, ...others.map(o => o.toExpr())],
      })
    },

    intersect(...others) {
      return buildQuery<T>({
        op: 'intersect', sets: [expr, ...others.map(o => o.toExpr())],
      })
    },

    subtract(other) {
      return buildQuery<T>({
        op: 'subtract', from: expr, minus: other.toExpr(),
      })
    },

    toExpr: () => expr,
  }
}

function toFilterExpr(field: string, value: unknown): FilterExpr {
  // Null means isNull
  if (value === null || value === undefined) {
    return { op: 'isNull', field }
  }

  // Plain value means equality
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { op: 'eq', field, value }
  }

  // Object with operator keys
  const ops = value as Record<string, unknown>
  const entries = Object.entries(ops)
  if (entries.length === 0) return { op: 'eq', field, value }

  // Single operator - common case
  if (entries.length === 1) {
    return singleOp(field, entries[0]![0], entries[0]![1])
  }

  // Multiple operators - AND them together
  return {
    op: 'and',
    conditions: entries.map(([k, v]) => singleOp(field, k, v)),
  }
}

function singleOp(field: string, operator: string, value: unknown): FilterExpr {
  switch (operator) {
    case 'eq': return { op: 'eq', field, value }
    case 'neq': return { op: 'neq', field, value }
    case 'gt': return { op: 'gt', field, value: value as number | string }
    case 'gte': return { op: 'gte', field, value: value as number | string }
    case 'lt': return { op: 'lt', field, value: value as number | string }
    case 'lte': return { op: 'lte', field, value: value as number | string }
    case 'contains': return { op: 'contains', field, value: value as string }
    case 'startsWith': return { op: 'startsWith', field, value: value as string }
    case 'regex': return { op: 'regex', field, pattern: value as string }
    case 'in': return { op: 'in', field, values: value as unknown[] }
    case 'isNull': return { op: 'isNull', field }
    case 'isNotNull': return { op: 'isNotNull', field }
    default: return { op: 'eq', field, value }
  }
}

/**
 * M0 Query Adapter - evaluates SetExpr queries against an InstanceRepository.
 * The same query algebra used for M1 model queries, adapted for M0 instance data.
 */

import type { SetExpr, FilterExpr } from '../types/query'
import type { RootContext } from '../types/context'
import type { EntityInstance } from '../types/instance'
import type { InstanceRepository } from './types'

/**
 * Evaluate a SetExpr against an M0 InstanceRepository.
 * Supports: base, ids, filter (eq, neq, gt, lt, gte, lte, contains, startsWith,
 * regex, in, isNull, isNotNull, and/or/not), union, intersect, subtract.
 */
export async function evaluateSetExprM0(
  expr: SetExpr,
  instances: InstanceRepository,
  model: RootContext,
): Promise<EntityInstance[]> {
  switch (expr.op) {
    case 'base':
      return instances.findByThing(expr.objectType)

    case 'ids': {
      const results: EntityInstance[] = []
      for (const id of expr.ids) {
        const inst = await instances.findById(id)
        if (inst) results.push(inst)
      }
      return results
    }

    case 'union': {
      const sets = await Promise.all(
        expr.sets.map(s => evaluateSetExprM0(s, instances, model)),
      )
      const seen = new Set<string>()
      const merged: EntityInstance[] = []
      for (const set of sets) {
        for (const inst of set) {
          if (!seen.has(inst.id)) {
            seen.add(inst.id)
            merged.push(inst)
          }
        }
      }
      return merged
    }

    case 'intersect': {
      const sets = await Promise.all(
        expr.sets.map(s => evaluateSetExprM0(s, instances, model)),
      )
      if (sets.length === 0) return []
      const idSets = sets.map(s => new Set(s.map(i => i.id)))
      return sets[0].filter(inst => idSets.every(ids => ids.has(inst.id)))
    }

    case 'subtract': {
      const [from, minus] = await Promise.all([
        evaluateSetExprM0(expr.from, instances, model),
        evaluateSetExprM0(expr.minus, instances, model),
      ])
      const minusIds = new Set(minus.map(i => i.id))
      return from.filter(inst => !minusIds.has(inst.id))
    }

    case 'filter': {
      const base = await evaluateSetExprM0(expr.base, instances, model)
      return base.filter(inst => matchesFilter(inst, expr.where))
    }

    // traverse, aggregate, context, tagged - not directly applicable to M0
    // instances without additional model resolution. Return empty for now.
    default:
      return []
  }
}

// ── Filter Matching ────────────────────────────────────────────────────────────

function getAttrValue(inst: EntityInstance, field: string): unknown {
  return inst.attributes[field]?.value
}

function matchesFilter(inst: EntityInstance, filter: FilterExpr): boolean {
  switch (filter.op) {
    case 'eq':
      return getAttrValue(inst, filter.field) === filter.value

    case 'neq':
      return getAttrValue(inst, filter.field) !== filter.value

    case 'gt':
      return (getAttrValue(inst, filter.field) as number) > (filter.value as number)

    case 'lt':
      return (getAttrValue(inst, filter.field) as number) < (filter.value as number)

    case 'gte':
      return (getAttrValue(inst, filter.field) as number) >= (filter.value as number)

    case 'lte':
      return (getAttrValue(inst, filter.field) as number) <= (filter.value as number)

    case 'contains':
      return String(getAttrValue(inst, filter.field) ?? '').includes(filter.value)

    case 'startsWith':
      return String(getAttrValue(inst, filter.field) ?? '').startsWith(filter.value)

    case 'regex': {
      const val = String(getAttrValue(inst, filter.field) ?? '')
      return new RegExp(filter.pattern).test(val)
    }

    case 'in':
      return filter.values.includes(getAttrValue(inst, filter.field))

    case 'isNull':
      return getAttrValue(inst, filter.field) == null

    case 'isNotNull':
      return getAttrValue(inst, filter.field) != null

    // Boolean combinators
    case 'and':
      return filter.conditions.every(c => matchesFilter(inst, c))

    case 'or':
      return filter.conditions.some(c => matchesFilter(inst, c))

    case 'not':
      return !matchesFilter(inst, filter.condition)

    // Structural filters (hasLink, hasTag, etc.) are model-level - not applicable to M0 instances
    default:
      return true
  }
}

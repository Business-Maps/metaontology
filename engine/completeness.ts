import type { FacetContainer, RootContext, Assertion, AssertionViolation, FacetType  } from '../types/context'
import type { TripleQueryIndex } from './triples'
import type { PredicateId, EntityClassId  } from '../meta/ontology'
import { PREDICATES } from '../meta/ontology'
import { getRegisteredFacetKeys, isRegisteredFacetKey, facetKeyToClass, resolveFacetSingular, getClassToFacetKeyMap } from '../dsl/engineBridge'

export type CompletenessLevel = 'sketched' | 'structured' | 'rich'

/** Derive a completeness level from violation counts. */
export function deriveCompletenessLevel(violations: AssertionViolation[]): CompletenessLevel {
  const errors = violations.filter(v => v.severity === 'error').length
  const warnings = violations.filter(v => v.severity === 'warning').length
  if (errors > 0 || warnings > 3) return 'sketched'
  if (warnings > 0 || violations.length > 5) return 'structured'
  return 'rich'
}

// ── Ontology-derived default assertions ─────────────────────────────────────

// Lazily compute the class → facet-key map from the DSL registry
function classToFacetKey(): Partial<Record<string, string>> {
  return getClassToFacetKeyMap()
}

let _cachedDefaults: Assertion[] | null = null

/** Generate default assertions from ontology predicates that have defaultAssertions defined. */
export function generateDefaultAssertions(): Assertion[] {
  if (_cachedDefaults) return _cachedDefaults

  const assertions: Assertion[] = []

  for (const pred of Object.values(PREDICATES) as import('../meta/ontology').PredicateDef[]) {
    if (!pred.defaultAssertions?.length) continue

    for (const da of pred.defaultAssertions) {
      const allClasses = da.direction === 'outgoing' ? pred.domain : pred.range
      const entityClasses = da.onlyFor ? allClasses.filter(c => da.onlyFor!.includes(c as EntityClassId)) : allClasses
      const ruleType = da.direction === 'outgoing' ? 'requires-outgoing-link' : 'requires-incoming-link'

      for (const cls of entityClasses) {
        const facetKey = classToFacetKey()[cls]
        if (!facetKey) continue // skip Context, Symbol, WorkflowStep

        const singular = resolveFacetSingular(facetKey) || cls
        const label = pred.labels.en
        const dirLabel = da.direction === 'outgoing' ? label : pred.inverseLabels.en

        assertions.push({
          id: `ontology:${pred.id}:${da.direction}:${cls}`,
          name: `${singular} should have "${dirLabel}" link`,
          description: `Ontology-derived: every ${singular} should have at least ${da.min ?? 1} ${da.direction} "${label}" link`,
          selector: { scope: 'entityType', entityTypes: [facetKey] },
          rule: { type: ruleType, predicate: pred.id, min: da.min ?? 1 },
          severity: 'info',
          enabled: true,
          origin: 'ontology',
        })
      }
    }
  }

  // Content quality defaults
  assertions.push({
    id: 'ontology:field:definition:Thing',
    name: 'Thing should have a definition',
    description: 'Ontology-derived: every Thing should have a non-empty definition',
    selector: { scope: 'entityType', entityTypes: ['things'] },
    rule: { type: 'requires-field', field: 'definition', facetTypes: ['things'] },
    severity: 'info',
    enabled: true,
    origin: 'ontology',
  })

  _cachedDefaults = assertions
  return assertions
}

// ── Assertion evaluation ─────────────────────────────────────────────────────

/** Collect all contexts that match an assertion's selector. */
function selectContexts(root: RootContext, selector: Assertion['selector']): { id: string; name: string; ctx: FacetContainer }[] {
  const all: { id: string; name: string; ctx: FacetContainer }[] = [
    { id: root.uri, name: root.name, ctx: root },
    ...Object.values(root.contexts).map(c => ({ id: c.uri, name: c.name, ctx: c })),
  ]

  switch (selector.scope) {
    case 'all':
      return all
    case 'tagged': {
      const requiredTags = selector.tags ?? []
      if (!requiredTags.length) return all
      return all.filter(({ ctx }) => {
        const ctxTags = (ctx as any).tags ?? []
        return requiredTags.some((t: string) => ctxTags.includes(t))
      })
    }
    case 'entityType':
      // entityType scope returns all contexts but evaluation focuses on specific facet types
      return all
    default:
      return all
  }
}

/** Evaluate all enabled assertions against the current model state. */
export function evaluateAssertions(root: RootContext, tripleIndex?: TripleQueryIndex): AssertionViolation[] {
  const assertions = root.assertions ?? []
  const violations: AssertionViolation[] = []

  for (const assertion of assertions) {
    if (!assertion.enabled) continue
    const contexts = selectContexts(root, assertion.selector)

    for (const { id, name, ctx } of contexts) {
      violations.push(...evaluateRule(assertion, ctx, id, name, root, tripleIndex))
    }
  }

  return violations
}

/**
 * Unified gap evaluation: combines user-defined assertions with ontology-derived defaults.
 * Deduplicates: if a user rule and a default rule check the same predicate+direction for
 * the same entity type, the user rule takes precedence.
 */
export function evaluateAllGaps(root: RootContext, tripleIndex?: TripleQueryIndex): AssertionViolation[] {
  // Evaluate user assertions
  const userViolations = evaluateAssertions(root, tripleIndex)

  // Evaluate ontology defaults
  const defaults = generateDefaultAssertions()
  const defaultViolations: AssertionViolation[] = []

  for (const assertion of defaults) {
    if (!assertion.enabled) continue
    const contexts = selectContexts(root, assertion.selector)
    for (const { id, name, ctx } of contexts) {
      defaultViolations.push(...evaluateRule(assertion, ctx, id, name, root, tripleIndex))
    }
  }

  // Deduplicate: user violations for the same entity+predicate suppress default ones
  const userKeys = new Set(userViolations.map(v => `${v.entityId}:${v.message}`))
  const dedupedDefaults = defaultViolations.filter(v => !userKeys.has(`${v.entityId}:${v.message}`))

  return [...userViolations, ...dedupedDefaults]
}

function evaluateRule(
  assertion: Assertion,
  ctx: FacetContainer,
  contextUri: string,
  contextName: string,
  root: RootContext,
  tripleIndex?: TripleQueryIndex,
): AssertionViolation[] {
  const rule = assertion.rule

  switch (rule.type) {
    case 'min-facet-count': {
      const ft = rule.facetType as FacetType
      if (!isRegisteredFacetKey(ft)) return []
      const count = (ctx.facets[ft] ?? []).length
      if (count < rule.min) {
        return [{
          assertionId: assertion.id,
          assertionName: assertion.name,
          entityId: contextUri,
          entityName: contextName,
          entityType: 'Context',
          message: `"${contextName}" has ${count} ${ft} (requires at least ${rule.min})`,
          severity: assertion.severity,
        }]
      }
      return []
    }

    case 'max-facet-count': {
      const ft = rule.facetType as FacetType
      if (!isRegisteredFacetKey(ft)) return []
      const count = (ctx.facets[ft] ?? []).length
      if (count > rule.max) {
        return [{
          assertionId: assertion.id,
          assertionName: assertion.name,
          entityId: contextUri,
          entityName: contextName,
          entityType: 'Context',
          message: `"${contextName}" has ${count} ${ft} (maximum ${rule.max})`,
          severity: assertion.severity,
        }]
      }
      return []
    }

    case 'requires-link': {
      const entityIds = new Set<string>()
      for (const ft of getRegisteredFacetKeys()) {
        for (const f of (ctx.facets[ft] ?? []) as any[]) entityIds.add(f.uri)
      }
      const hasLink = root.links.some(l =>
        l.predicate === rule.predicate && (entityIds.has(l.sourceUri) || entityIds.has(l.targetUri)),
      )
      if (!hasLink) {
        return [{
          assertionId: assertion.id,
          assertionName: assertion.name,
          entityId: contextUri,
          entityName: contextName,
          entityType: 'Context',
          message: `"${contextName}" has no "${rule.predicate}" links`,
          severity: assertion.severity,
        }]
      }
      return []
    }

    case 'requires-tag': {
      const ctxTags = (ctx as any).tags ?? []
      if (!ctxTags.includes(rule.tag)) {
        return [{
          assertionId: assertion.id,
          assertionName: assertion.name,
          entityId: contextUri,
          entityName: contextName,
          entityType: 'Context',
          message: `"${contextName}" is missing required tag "${rule.tag}"`,
          severity: assertion.severity,
        }]
      }
      return []
    }

    case 'requires-outgoing-link': {
      return evaluateEntityLinkRule(assertion, ctx, root, rule.predicate, 'outgoing', rule.min ?? 1, tripleIndex)
    }

    case 'requires-incoming-link': {
      return evaluateEntityLinkRule(assertion, ctx, root, rule.predicate, 'incoming', rule.min ?? 1, tripleIndex)
    }

    case 'requires-field': {
      return evaluateFieldRule(assertion, ctx, rule.field, rule.facetTypes)
    }

    default:
      return []
  }
}

/** Evaluate entity-level link requirements within a context's facets. */
function evaluateEntityLinkRule(
  assertion: Assertion,
  ctx: FacetContainer,
  root: RootContext,
  predicate: string,
  direction: 'outgoing' | 'incoming',
  min: number,
  tripleIndex?: TripleQueryIndex,
): AssertionViolation[] {
  const violations: AssertionViolation[] = []

  // Determine which facet types to check based on the predicate's domain/range
  const pred = PREDICATES[predicate as keyof typeof PREDICATES]
  const relevantClasses = pred
    ? (direction === 'outgoing' ? pred.domain : pred.range)
    : []

  // If the assertion selector targets specific entity types, restrict to those
  const selectorFacetTypes = assertion.selector.scope === 'entityType' && assertion.selector.entityTypes
    ? assertion.selector.entityTypes
    : null

  for (const ft of getRegisteredFacetKeys()) {
    if (selectorFacetTypes && !selectorFacetTypes.includes(ft)) continue
    const entityClass = facetKeyToClass(ft) ?? ''
    if (relevantClasses.length > 0 && !(relevantClasses as string[]).includes(entityClass)) continue

    for (const entity of (ctx.facets[ft] ?? []) as Array<{ uri: string; name: string }>) {
      let linkCount: number

      if (tripleIndex) {
        // O(1) lookup via triple index
        linkCount = direction === 'outgoing'
          ? tripleIndex.objectIds(entity.uri, predicate as PredicateId).length
          : tripleIndex.subjectIds(entity.uri, predicate as PredicateId).length
      } else {
        // Linear scan fallback
        linkCount = root.links.filter(l =>
          l.predicate === predicate &&
          (direction === 'outgoing' ? l.sourceUri === entity.uri : l.targetUri === entity.uri),
        ).length
      }

      if (linkCount < min) {
        const label = pred?.labels.en ?? predicate
        violations.push({
          assertionId: assertion.id,
          assertionName: assertion.name,
          entityId: entity.uri,
          entityName: entity.name,
          entityType: entityClass,
          message: `${entityClass} "${entity.name}" has no "${label}" links`,
          severity: assertion.severity,
        })
      }
    }
  }

  return violations
}

/** Evaluate entity-level field requirements within a context's facets. */
function evaluateFieldRule(
  assertion: Assertion,
  ctx: FacetContainer,
  field: string,
  facetTypes?: string[],
): AssertionViolation[] {
  const violations: AssertionViolation[] = []
  const allKeys = getRegisteredFacetKeys()
  const typesToCheck = facetTypes?.length
    ? allKeys.filter(ft => facetTypes.includes(ft))
    : allKeys

  for (const ft of typesToCheck) {
    const entityClass = facetKeyToClass(ft)

    for (const entity of (ctx.facets[ft] ?? []) as Array<Record<string, any>>) {
      const value = entity[field]
      const isEmpty = value === undefined || value === null ||
        (typeof value === 'string' && value.trim().length === 0) ||
        (Array.isArray(value) && value.length === 0)

      if (isEmpty) {
        violations.push({
          assertionId: assertion.id,
          assertionName: assertion.name,
          entityId: entity.uri,
          entityName: entity.name,
          entityType: entityClass,
          message: `${entityClass} "${entity.name}" is missing "${field}"`,
          severity: assertion.severity,
        })
      }
    }
  }

  return violations
}

import { getPredicateDef } from './ontology'
import { ACTION_SUBTYPE_LABELS, CONTEXT_MAP_PATTERN_LABELS } from './vocabularyLabels'
import type { ContextMapPattern } from '../types/context'

/** Resolve the display label for a predicate based on vocabulary mode. */
export function resolvePredicateLabel(predicateId: string, mode: 'business' | 'ddd'): string {
  const pred = getPredicateDef(predicateId)
  if (!pred) return predicateId
  if (mode === 'business' && pred.businessLabels) return pred.businessLabels.en
  return pred.labels.en
}

/** Resolve the inverse display label for a predicate. */
export function resolvePredicateInverseLabel(predicateId: string, mode: 'business' | 'ddd'): string {
  const pred = getPredicateDef(predicateId)
  if (!pred) return predicateId
  if (mode === 'business' && pred.businessInverseLabels) return pred.businessInverseLabels.en
  return pred.inverseLabels.en
}

/** Resolve the display label for an Action sub-type. */
export function resolveActionSubtypeLabel(subtype: string, mode: 'business' | 'ddd'): string {
  const entry = ACTION_SUBTYPE_LABELS[subtype as keyof typeof ACTION_SUBTYPE_LABELS]
  if (!entry) return subtype
  return mode === 'business' ? entry.default : entry.ddd
}

/** Resolve the display label for a Context Map pattern. */
export function resolvePatternLabel(pattern: string, mode: 'business' | 'ddd'): string {
  const entry = CONTEXT_MAP_PATTERN_LABELS[pattern as ContextMapPattern]
  if (!entry) return pattern
  return mode === 'business' ? entry.default : entry.ddd
}

// ── M1: Pure operations on the domain model ────────────────────────────────
// Command application, inverse computation, merge, diff, query evaluation,
// triple projection, completeness, inheritance, serialization, analysis.

export * from './apply'
export * from './inverse'
export * from './merge'
export * from './diff'
export { resolveContextId, getContextObj, linkTargets, linkSources, resolveEntityName, describeEntityLinks, describeContext, listContexts, searchEntities, evaluateSetExpr, findFacetOwner } from './query'
export * from './completeness'
export * from './inheritance'
export * from './serialize'
export * from './analyze'
export * from './grants'
export * from './instanceTriples'
export type * from './instanceTriples'
export * from './instanceValidation'
export type { InstanceValidationResult, InstanceValidationError, FormField, FormSchemaResult } from './instanceValidation'
export {
  type Triple as ModelTriple,
  type TripleIndexData,
  projectToTriples,
  buildIndexes,
  serialiseAsNTriples,
  serialiseAsTurtle,
  serialiseAsJsonLd,
  sp,
  po,
  spo,
} from './triples'

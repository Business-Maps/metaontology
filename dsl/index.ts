/**
 * The Business Maps Framework DSL - the developer-facing API for
 * declaring facet types, predicates, datatypes, value types,
 * stereotypes, contexts, and actions.
 *
 * Consumers import from this barrel:
 *
 *   import {
 *     defineThing, definePersona, defineAction, definePredicate,
 *     decimal, text, reference, enumOf, list, object,
 *     entity, valueObject, // built-in stereotype handles
 *   } from '@businessmaps/metaontology/dsl'
 *
 * This is the seam between the metaontology's internals and any
 * consumer layer (BM schema, Designer, generated businesses). All
 * public DSL surface flows through here.
 */

// ── Attribute schema combinators ──────────────────────────────────────────
export type {
  AttrSchema,
  Infer,
  OptionalAttrSchema,
  ListSchema,
  ObjectSchema,
  EnumSchema,
  BrandedHandle,
  ReferenceBuilder,
} from './schemaCombinators'

export {
  // Primitive schemas
  text,
  identifier,
  email,
  uri,
  markdown,
  richDoc,
  integer,
  decimal,
  percentage,
  date,
  dateTime,
  time,
  duration,
  boolean,
  // Composite combinators
  list,
  object,
  enumOf,
  reference,
  // Lightweight ref for predicate domain/range
  facetRef,
} from './schemaCombinators'

// ── Handles ───────────────────────────────────────────────────────────────
export type {
  FacetHandle,
  ActionHandle,
  PredicateHandle,
  ContextHandle,
  AttrsOf,
  RequiredKeys,
  OptionalKeys,
  QueryResult,
  ActionResult,
  // Universal attribute shapes - SymbolUniversals is the root
  SymbolUniversals,
  ThingUniversals,
  ThingStereotype,
  PersonaUniversals,
  PersonaStereotype,
  PortUniversals,
  ActionUniversals,
  WorkflowUniversals,
  InterfaceUniversals,
  InterfaceKind,
  EventUniversals,
  MeasureUniversals,
  FunctionUniversals,
  DataSourceUniversals,
  PipelineUniversals,
} from './handles'

// ── Registry (introspection surface - read side) ──────────────────────────
//
// The write side (`registerX` functions) is deliberately NOT
// re-exported. Consumers should always go through the `defineX`
// helpers rather than touching the registry directly so the type
// inference stays intact.
export type {
  FacetTypeDecl,
  ActionTypeDecl,
  PredicateDecl,
  DatatypeDecl,
  ValueTypeDecl,
  StereotypeDecl,
  ValueConstraintDecl,
  MutationRuleDecl,
  FacetTypeRef,
  AnyDecl,
} from './registry'

export {
  getFacetType,
  listFacetTypes,
  listFacetTypesByBaseType,
  getActionType,
  listActionTypes,
  getPredicate,
  listPredicates,
  getDatatype,
  listDatatypes,
  getValueType,
  listValueTypes,
  getStereotype,
  listStereotypes,
  resetRegistry,
} from './registry'

// ── defineFacetType - the low-level escape hatch ──────────────────────────
export type { FacetTypeConfig, BaseFacetAttrs } from './defineFacetType'
export { defineFacetType } from './defineFacetType'

// ── Primitive definers ─────────────────────────────────────────────────
export type { BmPrimitiveConfig } from './definePrimitives'
export {
  defineThing,
  definePersona,
  definePort,
  defineWorkflow,
  defineInterfaceType,
  defineEvent,
  defineMeasure,
  defineFunctionType,
  defineDataSource,
  definePipeline,
} from './definePrimitives'

// ── defineAction ──────────────────────────────────────────────────────────
export type { ActionConfig, MutationRule } from './defineAction'
export { defineAction } from './defineAction'

// ── Dispatcher bridge (consumer layer binds at init) ──────────────────────
export type { DispatchFn, RootAccessorFn, DispatchableCmd, DispatchResult } from './dispatcher'
export { bindDispatcher, bindRootAccessor, resetDispatcher } from './dispatcher'

// ── Engine bridge (registry-backed replacements for hardcoded constants) ──
export {
  getRegisteredFacetKeys,
  facetKeyToClass,
  getFacetKeyToClassMap,
  getClassToFacetKeyMap,
  resolveFacetSingular,
  isRegisteredFacetKey,
  getFacetDeclByKey,
} from './engineBridge'

// ── Generic definers ──────────────────────────────────────────────────────
export type {
  PredicateConfig,
  DatatypeConfig,
  DatatypeHandle,
  ValueTypeConfig,
  ValueTypeHandle,
  ValueConstraint,
  StereotypeConfig,
  StereotypeHandle,
  ContextConfig,
} from './defineGeneric'
export {
  definePredicate,
  defineDatatype,
  defineValueType,
  defineStereotype,
  defineContext,
} from './defineGeneric'

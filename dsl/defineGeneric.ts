/**
 * Generic DSL helpers - `definePredicate`, `defineDatatype`,
 * `defineValueType`, `defineStereotype`, `defineContext`.
 *
 * These cover the vocabulary types that aren't facet types. They're
 * thin wrappers over the registry: each takes a declaration, stores
 * it in the registry, and returns a handle the rest of the framework
 * can use for type-safe references.
 *
 * Phase 1 wires the typed surface. The runtime side effects (link
 * creation for predicates, context instantiation, etc.) arrive in a
 * later chunk along with the facet handle runtime wiring.
 */

import type {
  PredicateHandle,
  ContextHandle,
} from './handles'
import type { BrandedHandle } from './schemaCombinators'
import type {
  PredicateDecl,
  DatatypeDecl,
  ValueTypeDecl,
  ValueConstraintDecl,
  StereotypeDecl,
  FacetTypeRef,
} from './registry'
import {
  registerPredicate,
  registerDatatype,
  registerValueType,
  registerStereotype,
} from './registry'

// ── definePredicate ────────────────────────────────────────────────────────

/** Configuration accepted by `definePredicate`. */
export interface PredicateConfig {
  /** Facet types whose instances can appear as the source. Accepts full handles or lightweight refs via `facetRef()`. */
  domain: readonly BrandedHandle[]
  /** Facet types whose instances can appear as the target. Accepts full handles or lightweight refs. */
  range: readonly BrandedHandle[]
  cardinality?: { source: 'one' | 'many'; target: 'one' | 'many' }
  label?: { en: string; [lang: string]: string }
  inverseLabel?: { en: string; [lang: string]: string }
  businessLabel?: { en: string; [lang: string]: string }
  businessInverseLabel?: { en: string; [lang: string]: string }
  uri?: string
  structural?: boolean
  symmetric?: boolean
  tier?: 'framework' | 'domain' | 'custom'
  alternatives?: readonly string[]
  defaultAssertions?: readonly { direction: 'outgoing' | 'incoming'; min?: number; onlyFor?: readonly string[] }[]
}

/**
 * Declare a typed predicate (link kind). The returned handle can be
 * used to create links at runtime: `performs.link(personaId, actionId)`.
 * The declared domain/range constrains which facet types are valid
 * source/target pairs - Phase 2 wires the runtime validation check
 * into the command path.
 */
export function definePredicate<Id extends string>(
  id: Id,
  config: PredicateConfig,
): PredicateHandle<Id> {
  const decl: PredicateDecl = {
    kind: 'predicate',
    id,
    domain: config.domain.map((h): FacetTypeRef => ({ typeId: h.__id })),
    range: config.range.map((h): FacetTypeRef => ({ typeId: h.__id })),
    cardinality: config.cardinality,
    label: config.label,
    inverseLabel: config.inverseLabel,
    businessLabel: config.businessLabel,
    businessInverseLabel: config.businessInverseLabel,
    uri: config.uri,
    structural: config.structural,
    symmetric: config.symmetric,
    tier: config.tier,
    alternatives: config.alternatives,
    defaultAssertions: config.defaultAssertions,
  }
  registerPredicate(decl)

  const handle: PredicateHandle<Id> = {
    __brand: 'PredicateHandle',
    __id: id,
    predicateId: id,
    link(_sourceId, _targetId) {
      return '__stub-link-id__'
    },
    unlink(_linkId) {
      // stub
    },
  }
  return handle
}

// ── defineDatatype ─────────────────────────────────────────────────────────

/** Configuration accepted by `defineDatatype`. */
export interface DatatypeConfig {
  /** XSD URI mapping, e.g. `'xsd:string'`. */
  xsd: string
  /** Base TypeScript family this datatype serializes to. */
  baseType: 'string' | 'number' | 'boolean' | 'temporal' | 'complex'
  /** TypeScript type as a string (for codegen comments and tool schemas). */
  tsType: string
  label?: { en: string; [lang: string]: string }
  description?: string
  /** Regex constraint for primitive datatypes (e.g. identifier). */
  pattern?: string
  /** Extra field names for composite datatypes (e.g. money's `currencyCode`). */
  extraFields?: string[]
  /** Short-form label for compact rendering (badges, terminal output). */
  shortLabel?: string
}

/** Handle returned by `defineDatatype`. Carries only the id at runtime. */
export interface DatatypeHandle<Id extends string = string> {
  readonly __brand: 'DatatypeHandle'
  readonly __id: Id
  readonly datatypeId: Id
}

export function defineDatatype<Id extends string>(
  id: Id,
  config: DatatypeConfig,
): DatatypeHandle<Id> {
  const decl: DatatypeDecl = {
    kind: 'datatype',
    id,
    xsd: config.xsd,
    baseType: config.baseType,
    tsType: config.tsType,
    label: config.label,
    description: config.description,
    pattern: config.pattern,
    extraFields: config.extraFields,
    shortLabel: config.shortLabel,
  }
  registerDatatype(decl)
  return {
    __brand: 'DatatypeHandle',
    __id: id,
    datatypeId: id,
  }
}

// ── defineValueType ────────────────────────────────────────────────────────

/** Configuration accepted by `defineValueType`. */
export interface ValueTypeConfig {
  /** Base datatype id (e.g. `'text'`, `'decimal'`). */
  baseType: string
  /** Validation constraints applied to instances of this value type. */
  constraints: readonly ValueConstraint[]
  label?: { en: string; [lang: string]: string }
}

/** Union of supported value-type constraints. */
export type ValueConstraint =
  | { type: 'regex'; pattern: string; message?: string }
  | { type: 'range'; min?: number; max?: number; message?: string }
  | { type: 'length'; min?: number; max?: number; message?: string }
  | { type: 'enum'; values: readonly string[]; message?: string }

/** Handle returned by `defineValueType`. */
export interface ValueTypeHandle<Id extends string = string> {
  readonly __brand: 'ValueTypeHandle'
  readonly __id: Id
  readonly valueTypeId: Id
}

export function defineValueType<Id extends string>(
  id: Id,
  config: ValueTypeConfig,
): ValueTypeHandle<Id> {
  const decl: ValueTypeDecl = {
    kind: 'value-type',
    id,
    baseType: config.baseType,
    constraints: config.constraints.map((c): ValueConstraintDecl => ({ ...c })),
    label: config.label,
  }
  registerValueType(decl)
  return {
    __brand: 'ValueTypeHandle',
    __id: id,
    valueTypeId: id,
  }
}

// ── defineStereotype ───────────────────────────────────────────────────────

/** Configuration accepted by `defineStereotype`. */
export interface StereotypeConfig {
  description: string
}

/** Handle returned by `defineStereotype`. */
export interface StereotypeHandle<Id extends string = string> {
  readonly __brand: 'StereotypeHandle'
  readonly __id: Id
  readonly stereotypeId: Id
}

export function defineStereotype<Id extends string>(
  id: Id,
  config: StereotypeConfig,
): StereotypeHandle<Id> {
  const decl: StereotypeDecl = {
    kind: 'stereotype',
    id,
    description: config.description,
  }
  registerStereotype(decl)
  return {
    __brand: 'StereotypeHandle',
    __id: id,
    stereotypeId: id,
  }
}

// ── defineContext ──────────────────────────────────────────────────────────
//
// Unlike the other helpers, `defineContext` creates a runtime
// instance rather than a declaration: every call produces a new
// context node in the model (via the existing `context:add` command
// path). Phase 1 returns a typed stub handle; runtime dispatch wires
// through in a later chunk.

/** Configuration accepted by `defineContext`. */
export interface ContextConfig {
  parentId?: string
  description?: string
  tags?: string[]
}

export function defineContext<Id extends string>(
  id: Id,
  _config: ContextConfig = {},
): ContextHandle<Id> {
  const handle: ContextHandle<Id> = {
    __brand: 'ContextHandle',
    __id: id,
    contextId: id,
    rename(_newName) {
      // stub
    },
    remove() {
      // stub
    },
  }
  return handle
}

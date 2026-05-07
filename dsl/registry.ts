/**
 * DSL registry - the runtime collector for every `defineX` call.
 *
 * When a developer calls `defineThing('exampleNode', {...})`, the
 * resulting handle is also recorded here so the framework can walk
 * the registry at introspection time: the commit log, query engine,
 * sync engine, codegen pipeline, and the AI tool schema generator
 * all read from this registry to discover what types exist in the
 * current runtime.
 *
 * Phase 1 declares the registry and the declaration record types.
 * The `defineX` helpers (next chunk) write into it. Phase 2 migrates
 * the engine to read from it instead of the hardcoded meta constants
 * in `ontology.ts` / `fields.ts`.
 *
 * The registry is a module-level singleton - one instance per
 * JavaScript context. Tests that need isolation call `resetRegistry()`
 * between runs.
 */

import type { AttrSchema } from './schemaCombinators'

// ── Declaration records ────────────────────────────────────────────────────
//
// These are the serializable shapes the registry stores for each kind
// of declaration. They mirror the typed handle surface but keep only
// the data needed at runtime: the type id, the attribute schema, the
// parent base type (for subtype inheritance), the presentation flags
// (`hidden`, `tier`), and any constraints.

/** A reference to another facet type from the schema (for inheritance or from `reference()`). */
export interface FacetTypeRef {
  readonly typeId: string
}

/** Declaration record for any facet type (Thing subtype, Persona subtype, etc.). */
export interface FacetTypeDecl {
  readonly kind: 'facet-type'
  readonly id: string
  /** The base BM primitive this facet subtypes (e.g. 'thing', 'persona'). `null` for types declared via raw `defineFacetType`. */
  readonly baseType: string | null
  /** The declared attribute schema for this subtype (custom attributes only - universals live on the base type). */
  readonly attributes: Record<string, AttrSchema<unknown>>
  /** Progressive-disclosure tier (1 = core, 3 = advanced). Presentation concern but carried here for codegen. */
  readonly tier?: 1 | 2 | 3
  /** When true, the type is not shown in user-facing pickers (e.g. `exampleNode` in the UI layer). */
  readonly hidden?: boolean
  /**
   * The key used in `FacetContainer.facets` to store instances of this type.
   * For base types this is the plural form (e.g. `'things'` for `'thing'`).
   * For subtypes it defaults to the type id itself (e.g. `'exampleNode'`).
   * The engine iterates this set of keys when scanning for entities.
   */
  readonly facetKey?: string
  /**
   * The PascalCase entity class id used in `ENTITY_CLASSES` (e.g. `'DataSource'`).
   * Distinguished from `singular.en` ('Data Source') which has spaces and is
   * for display. This is the structural id that code references. Only set on
   * base types (baseType === null).
   */
  readonly entityClassId?: string
  /** Optional human label; if absent, consumers derive from the id. */
  readonly label?: { en: string; [lang: string]: string }
  /** Optional singular label for one-off references. */
  readonly singular?: { en: string; [lang: string]: string }
}

/** Declaration record for an action. */
export interface ActionTypeDecl {
  readonly kind: 'action-type'
  readonly id: string
  readonly actionType: 'command' | 'query' | 'intent'
  readonly description: string
  readonly parameters: Record<string, AttrSchema<unknown>>
  readonly mutations: readonly MutationRuleDecl[]
  readonly authorization?: 'performers-only' | 'any-authenticated' | 'custom'
}

/** Serialized form of a mutation rule on an action declaration. */
export interface MutationRuleDecl {
  readonly type: 'modify' | 'create' | 'delete' | 'transitionState' | 'createLink' | 'deleteLink'
  readonly target: string
  readonly field?: string
  readonly formula?: string
  readonly predicate?: string
  readonly sourceRef?: string
  readonly targetRef?: string
}

/** Declaration record for a predicate (typed link kind). */
export interface PredicateDecl {
  readonly kind: 'predicate'
  readonly id: string
  readonly domain: readonly FacetTypeRef[]
  readonly range: readonly FacetTypeRef[]
  readonly cardinality?: { source: 'one' | 'many'; target: 'one' | 'many' }
  readonly label?: { en: string; [lang: string]: string }
  readonly inverseLabel?: { en: string; [lang: string]: string }
  /** Business-friendly label: "is responsible for" instead of "stewards" */
  readonly businessLabel?: { en: string; [lang: string]: string }
  /** Business-friendly inverse label */
  readonly businessInverseLabel?: { en: string; [lang: string]: string }
  /** URI for RDF export */
  readonly uri?: string
  /** True if derived from structure, not stored as a Link */
  readonly structural?: boolean
  /** True if symmetric (A rel B ⟺ B rel A) */
  readonly symmetric?: boolean
  /** Predicate tier: framework (structural metamodel), domain (curated cross-cutting), custom (free-text) */
  readonly tier?: 'framework' | 'domain' | 'custom'
  /** IDs of more specific predicates that should be preferred when they also match */
  readonly alternatives?: readonly string[]
  /** Ontology-derived default assertions for this predicate */
  readonly defaultAssertions?: readonly {
    readonly direction: 'outgoing' | 'incoming'
    readonly min?: number
    readonly onlyFor?: readonly string[]
  }[]
}

/** Declaration record for a datatype extension. */
export interface DatatypeDecl {
  readonly kind: 'datatype'
  readonly id: string
  readonly xsd: string
  readonly baseType: 'string' | 'number' | 'boolean' | 'temporal' | 'complex'
  readonly tsType: string
  readonly label?: { en: string; [lang: string]: string }
  readonly description?: string
  readonly pattern?: string
  readonly extraFields?: string[]
  /** Short-form label for compact rendering (badges, terminal output, codegen comments) */
  readonly shortLabel?: string
}

/** Declaration record for a value type (semantic type with validation). */
export interface ValueTypeDecl {
  readonly kind: 'value-type'
  readonly id: string
  readonly baseType: string
  readonly constraints: readonly ValueConstraintDecl[]
  readonly label?: { en: string; [lang: string]: string }
}

export type ValueConstraintDecl =
  | { readonly type: 'regex'; readonly pattern: string; readonly message?: string }
  | { readonly type: 'range'; readonly min?: number; readonly max?: number; readonly message?: string }
  | { readonly type: 'length'; readonly min?: number; readonly max?: number; readonly message?: string }
  | { readonly type: 'enum'; readonly values: readonly string[]; readonly message?: string }

/** Declaration record for a stereotype. */
export interface StereotypeDecl {
  readonly kind: 'stereotype'
  readonly id: string
  readonly description: string
}

/** Union of every declaration kind the registry stores. */
export type AnyDecl =
  | FacetTypeDecl
  | ActionTypeDecl
  | PredicateDecl
  | DatatypeDecl
  | ValueTypeDecl
  | StereotypeDecl

// ── The singleton registry ─────────────────────────────────────────────────

/**
 * Internal state for the DSL registry. Exposed as a namespace of
 * accessor functions (below) rather than as a bare exported object so
 * tests can reset it cleanly and consumers don't mutate state
 * directly.
 */
interface RegistryState {
  facetTypes: Map<string, FacetTypeDecl>
  actionTypes: Map<string, ActionTypeDecl>
  predicates: Map<string, PredicateDecl>
  datatypes: Map<string, DatatypeDecl>
  valueTypes: Map<string, ValueTypeDecl>
  stereotypes: Map<string, StereotypeDecl>
}

function createEmptyState(): RegistryState {
  return {
    facetTypes: new Map(),
    actionTypes: new Map(),
    predicates: new Map(),
    datatypes: new Map(),
    valueTypes: new Map(),
    stereotypes: new Map(),
  }
}

let _state: RegistryState = createEmptyState()

// ── Registration (write side) ──────────────────────────────────────────────
//
// Each helper is idempotent on id: re-registering a declaration with
// the same id is a no-op after the first call, so the DSL is safe to
// invoke from module bodies that may be evaluated multiple times
// (HMR, test re-runs, repeat imports from different layers).

/** Register or retrieve a facet type declaration. */
export function registerFacetType(decl: FacetTypeDecl): FacetTypeDecl {
  const existing = _state.facetTypes.get(decl.id)
  if (existing) return existing
  _state.facetTypes.set(decl.id, decl)
  return decl
}

/** Register or retrieve an action declaration. */
export function registerActionType(decl: ActionTypeDecl): ActionTypeDecl {
  const existing = _state.actionTypes.get(decl.id)
  if (existing) return existing
  _state.actionTypes.set(decl.id, decl)
  return decl
}

/** Register or retrieve a predicate declaration. */
export function registerPredicate(decl: PredicateDecl): PredicateDecl {
  const existing = _state.predicates.get(decl.id)
  if (existing) return existing
  _state.predicates.set(decl.id, decl)
  return decl
}

/** Register or retrieve a datatype declaration. */
export function registerDatatype(decl: DatatypeDecl): DatatypeDecl {
  const existing = _state.datatypes.get(decl.id)
  if (existing) return existing
  _state.datatypes.set(decl.id, decl)
  return decl
}

/** Register or retrieve a value type declaration. */
export function registerValueType(decl: ValueTypeDecl): ValueTypeDecl {
  const existing = _state.valueTypes.get(decl.id)
  if (existing) return existing
  _state.valueTypes.set(decl.id, decl)
  return decl
}

/** Register or retrieve a stereotype declaration. */
export function registerStereotype(decl: StereotypeDecl): StereotypeDecl {
  const existing = _state.stereotypes.get(decl.id)
  if (existing) return existing
  _state.stereotypes.set(decl.id, decl)
  return decl
}

// ── Introspection (read side) ──────────────────────────────────────────────
//
// These are the accessor surfaces the engine, sync, codegen, and AI
// tool schema generators call to discover what's declared. Phase 2
// migrates every hardcoded `FACET_TYPES` / `PREDICATES` reference to
// call these helpers instead.

/** Look up a facet type declaration by id. */
export function getFacetType(id: string): FacetTypeDecl | undefined {
  return _state.facetTypes.get(id)
}

/** Enumerate every registered facet type. */
export function listFacetTypes(): FacetTypeDecl[] {
  return Array.from(_state.facetTypes.values())
}

/**
 * Enumerate every registered facet type that subtypes a given base
 * type. For example, `listFacetTypesByBaseType('thing')` returns every
 * Thing subtype declared anywhere in the runtime - including
 * `exampleNode` from a UI layer and `businessMap` from a domain layer.
 */
export function listFacetTypesByBaseType(baseType: string): FacetTypeDecl[] {
  return Array.from(_state.facetTypes.values()).filter(d => d.baseType === baseType)
}

/** Look up an action declaration by id. */
export function getActionType(id: string): ActionTypeDecl | undefined {
  return _state.actionTypes.get(id)
}

/** Enumerate every registered action. */
export function listActionTypes(): ActionTypeDecl[] {
  return Array.from(_state.actionTypes.values())
}

/** Look up a predicate by id. */
export function getPredicate(id: string): PredicateDecl | undefined {
  return _state.predicates.get(id)
}

/** Enumerate every registered predicate. */
export function listPredicates(): PredicateDecl[] {
  return Array.from(_state.predicates.values())
}

/** Look up a datatype by id. */
export function getDatatype(id: string): DatatypeDecl | undefined {
  return _state.datatypes.get(id)
}

/** Enumerate every registered datatype. */
export function listDatatypes(): DatatypeDecl[] {
  return Array.from(_state.datatypes.values())
}

/** Look up a value type by id. */
export function getValueType(id: string): ValueTypeDecl | undefined {
  return _state.valueTypes.get(id)
}

/** Enumerate every registered value type. */
export function listValueTypes(): ValueTypeDecl[] {
  return Array.from(_state.valueTypes.values())
}

/** Look up a stereotype by id. */
export function getStereotype(id: string): StereotypeDecl | undefined {
  return _state.stereotypes.get(id)
}

/** Enumerate every registered stereotype. */
export function listStereotypes(): StereotypeDecl[] {
  return Array.from(_state.stereotypes.values())
}

// ── Test-only utilities ────────────────────────────────────────────────────

/**
 * Reset the registry to its empty state. Intended for test isolation -
 * do NOT call this from production code. Production layers declare
 * their types at module load time and expect the declarations to
 * persist for the lifetime of the process.
 */
export function resetRegistry(): void {
  _state = createEmptyState()
}

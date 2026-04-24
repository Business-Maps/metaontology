/**
 * Typed handles returned by the DSL's `defineX` helpers.
 *
 * A handle is a branded object whose TypeScript type carries the
 * combined (universal + custom) attribute shape for a declared facet
 * type. Consumers call `.add(...)`, `.findById(...)`, `.where(...)`,
 * `.update(...)`, `.remove(...)` through the handle and every call
 * site is type-checked against the schema.
 *
 * The handles are structurally typed but tagged with a `__brand`
 * field so they can be recognized as valid `reference().to(...)`
 * targets by the schema combinators in `schemaCombinators.ts`.
 *
 * At runtime the handle's methods dispatch through the existing
 * framework command path (`store.dispatch({ type: 'facet:add', ...})`),
 * but the runtime wiring happens in a later chunk - this file
 * declares only the typed surface.
 */

import type { AttrSchema, OptionalAttrSchema, Infer, BrandedHandle } from './schemaCombinators'

// ── Schema-record → resolved attribute shape ────────────────────────────────
//
// Given a record like `{ x: decimal, y: decimal, width: decimal.default(200) }`,
// produce `{ x: number; y: number; width?: number }`. Optional keys are
// derived from the presence of `OptionalAttrSchema<unknown>` in the schema
// record, so `.default(v)` correctly makes a field optional.

/** Keys of the schema record whose values are required (non-optional). */
export type RequiredKeys<A extends Record<string, AttrSchema<unknown>>> = {
  [K in keyof A]: A[K] extends OptionalAttrSchema<unknown> ? never : K
}[keyof A]

/** Keys of the schema record whose values are optional (declared with `.default`). */
export type OptionalKeys<A extends Record<string, AttrSchema<unknown>>> = {
  [K in keyof A]: A[K] extends OptionalAttrSchema<unknown> ? K : never
}[keyof A]

/**
 * Resolve a schema record into the TypeScript shape of its instances.
 * Required fields become `K: T`; optional fields become `K?: T`.
 */
export type AttrsOf<A extends Record<string, AttrSchema<unknown>>> =
  & { [K in RequiredKeys<A>]: Infer<A[K]> }
  & { [K in OptionalKeys<A>]?: Infer<A[K]> }

// ── Universal attributes per BM base type ──────────────────────────────────
//
// Every facet subtype inherits the universal attributes of its parent
// base type. These intersections surface on the handle's attribute
// shape so consumers always see the full attribute list when calling
// `.add(...)`.
//
// The shapes here mirror the generated interfaces to keep dispatch
// round-trips compatible with the current engine.
// Phase 2 generalizes the engine so the types here can evolve
// independently of the generated types, but Phase 1 needs bit-for-bit
// parity so both paths dispatch identically.

export type ThingStereotype =
  | 'entity'
  | 'value-object'
  | 'aggregate-root'
  | 'reference-data'
  | 'goal'
  | 'risk'
  | 'assumption'
  | 'milestone'

// ── Symbol: the universal primitive ─────────────────────────────────────────
//
// Every entity in the framework IS a Symbol. A Symbol is just a URI
// that progressively takes shape as properties are added. When a Symbol
// gains `definition` + `stereotype`, it's recognizable as a Thing. When
// it gains `role` + `personaType`, it's a Persona. The framework
// classifies by shape, not by upfront type declaration.
//
// All other universal interfaces extend SymbolUniversals so every
// entity in the type system traces back to this root.

export interface SymbolUniversals {
  uri: string
  tags?: string[]
}

export interface ThingUniversals extends SymbolUniversals {
  name: string
  definition: string
  stereotype?: ThingStereotype
  thingRole?: 'root' | 'part' | 'descriptor'
}

export type PersonaStereotype = 'human' | 'team' | 'system' | 'external' | 'customer'

export interface PersonaUniversals extends SymbolUniversals {
  name: string
  description: string
  role: string
  personaType: PersonaStereotype
  topologyType?: 'stream-aligned' | 'platform' | 'enabling' | 'complicated-subsystem'
}

export interface PortUniversals extends SymbolUniversals {
  name: string
  description: string
  direction: 'produces' | 'consumes'
}

export interface ActionUniversals extends SymbolUniversals {
  name: string
  description: string
  type: 'command' | 'query' | 'intent'
}

export interface WorkflowUniversals extends SymbolUniversals {
  name: string
  description: string
}

export type InterfaceKind =
  | 'application'
  | 'page'
  | 'layout'
  | 'component'
  | 'form'
  | 'dashboard'
  | 'design-tokens'
  | 'api'
  | 'endpoint'
  | 'webhook'
  | 'notification'
  | 'report'

export interface InterfaceUniversals extends SymbolUniversals {
  name: string
  description: string
  kind: InterfaceKind
}

export interface EventUniversals extends SymbolUniversals {
  name: string
  description: string
  eventType: 'event' | 'delta'
}

export interface MeasureUniversals extends SymbolUniversals {
  name: string
  description: string
  measureType: 'metric' | 'aggregator' | 'financial'
  unit?: string
}

export interface FunctionUniversals extends SymbolUniversals {
  name: string
  description: string
}

export interface DataSourceUniversals extends SymbolUniversals {
  name: string
  description: string
  credentialRef?: string
}

export interface PipelineUniversals extends SymbolUniversals {
  name: string
  description: string
  direction: 'pull' | 'push' | 'two-way'
}

// ── Query surface ──────────────────────────────────────────────────────────
//
// Phase 1 exposes a minimal `.where(predicate).all()` shape that compiles
// to SetExpr under the hood (Phase 2 wires the SetExpr compilation).
// The predicate receives the full resolved attribute shape so callers
// get autocomplete and type checking.

export interface QueryResult<TAttrs> {
  all(): TAttrs[]
  first(): TAttrs | undefined
  count(): number
}

// ── Facet handle ───────────────────────────────────────────────────────────

/**
 * The typed handle returned by every facet-declaring DSL helper.
 *
 * `TAttrs` is the full resolved attribute shape (universal attributes
 * intersected with the subtype's own declared attributes). `TId` is the
 * literal-typed facet type id so references to this handle can be
 * distinguished at the type level from references to other handles.
 */
export interface FacetHandle<TAttrs, TId extends string = string> extends BrandedHandle {
  readonly __brand: 'FacetHandle'
  readonly __id: TId
  readonly typeId: TId

  /**
   * Add a new instance of this facet type. All required universal and
   * custom attributes must be present (except `uri`, which is generated
   * when omitted). Returns the new instance's URI.
   */
  add(input: Omit<TAttrs, 'uri'> & { uri?: string }): string

  /**
   * Look up an instance by URI. Returns `undefined` if no instance with
   * that URI exists.
   */
  findByUri(uri: string): TAttrs | undefined

  /**
   * Filter instances by a typed predicate. The predicate receives the
   * full resolved attribute shape.
   */
  where(predicate: (attrs: TAttrs) => boolean): QueryResult<TAttrs>

  /** List all instances. Equivalent to `.where(() => true).all()`. */
  all(): TAttrs[]

  /**
   * Update fields on an instance. `uri` is excluded from the updatable
   * set. Passing unknown fields is a type error.
   */
  update(uri: string, changes: Partial<Omit<TAttrs, 'uri'>>): void

  /** Remove an instance by URI. */
  remove(uri: string): void

  /**
   * Count instances matching an optional predicate. No argument counts
   * all instances of this type.
   */
  count(predicate?: (attrs: TAttrs) => boolean): number
}

// ── Action handle ──────────────────────────────────────────────────────────

/**
 * The typed handle returned by `defineAction`. Dispatching an action
 * through its handle type-checks the parameters and routes through the
 * framework's action interpreter.
 */
export interface ActionHandle<
  TId extends string,
  TParams extends Record<string, AttrSchema<unknown>>,
> {
  readonly __brand: 'ActionHandle'
  readonly __id: TId
  readonly actionId: TId

  dispatch(params: AttrsOf<TParams>): Promise<ActionResult>
}

/** Result of dispatching an action through its handle. */
export interface ActionResult {
  success: boolean
  created: string[]
  updated: string[]
  deleted: string[]
  errors: string[]
}

// ── Predicate handle ───────────────────────────────────────────────────────

/**
 * The typed handle returned by `definePredicate`. Used at schema
 * declaration time for domain/range constraints, and at runtime to
 * create typed links between entities.
 */
export interface PredicateHandle<TId extends string = string> {
  readonly __brand: 'PredicateHandle'
  readonly __id: TId
  readonly predicateId: TId

  link(sourceId: string, targetId: string): string
  unlink(linkId: string): void
}

// ── Context handle ─────────────────────────────────────────────────────────

/**
 * The typed handle returned by `defineContext`. A context is a bounded
 * region of the model that can hold facet instances; the handle
 * provides scoped CRUD against instances that live inside this
 * context specifically.
 *
 * Phase 1 declares the type but does not yet expose per-handle scoping
 * - that arrives with the runtime wiring in a later chunk.
 */
export interface ContextHandle<TId extends string = string> {
  readonly __brand: 'ContextHandle'
  readonly __id: TId
  readonly contextId: TId

  rename(newName: string): void
  remove(): void
}

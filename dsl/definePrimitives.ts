/**
 * BM primitive definers - `defineThing`, `definePersona`, etc.
 *
 * These are the typed helpers consumers call when declaring a facet
 * type that subtypes one of the 11 BM primitives. Each one wraps
 * `defineFacetType` / `createFacetHandle` with the corresponding base
 * type's universal attributes on the returned handle's type surface.
 *
 * Call site:
 *
 *   // Designer layer
 *   const exampleNode = defineThing('exampleNode', {
 *     attributes: { x: decimal, y: decimal },
 *   })
 *
 * The returned handle's `.add(...)` is type-checked against the
 * combined `ThingUniversals & { x: number; y: number }` shape. At
 * runtime the declaration registers with the DSL registry and the
 * runtime dispatches through the same commit log as any other
 * facet type.
 *
 * Phase 1 wires the types. Runtime dispatch arrives in a later chunk
 * (the handles' methods are typed stubs for now, same as
 * `defineFacetType`).
 */

import type { AttrSchema } from './schemaCombinators'
import type {
  FacetHandle,
  AttrsOf,
  ThingUniversals,
  PersonaUniversals,
  PortUniversals,
  WorkflowUniversals,
  InterfaceUniversals,
  EventUniversals,
  MeasureUniversals,
  FunctionUniversals,
  DataSourceUniversals,
  PipelineUniversals,
} from './handles'
// Note: Actions are declared via `defineAction` in its own file rather than
// through a `defineBmPrimitive` wrapper because they carry typed parameters
// and mutations instead of a passive attribute schema. `ActionUniversals`
// is imported by `defineAction.ts` where it's actually used.
import type { FacetTypeDecl } from './registry'
import { registerFacetType } from './registry'
import { createFacetHandle } from './defineFacetType'

// ── Shared configuration shape ─────────────────────────────────────────────

/** Configuration accepted by every BM-primitive definer. */
export interface BmPrimitiveConfig<A extends Record<string, AttrSchema<unknown>>> {
  /** Custom attributes the subtype adds on top of its base type's universals. */
  attributes?: A
  /** Progressive-disclosure tier. */
  tier?: 1 | 2 | 3
  /** When true, the type is not shown in user-facing pickers. */
  hidden?: boolean
  /** Human-readable label. */
  label?: { en: string; [lang: string]: string }
  /** Singular label for one-off references. */
  singular?: { en: string; [lang: string]: string }
}

// ── Internal shared helper ─────────────────────────────────────────────────
//
// All the definers share the same registration flow: build a
// `FacetTypeDecl` with the right `baseType`, register it, and return
// a typed handle. Each exported definer just calls this with its own
// base type id and universal type.

/** @internal */
function defineBmPrimitive<
  Id extends string,
  Universals,
  A extends Record<string, AttrSchema<unknown>>,
>(
  baseType: string,
  id: Id,
  config: BmPrimitiveConfig<A>,
): FacetHandle<Universals & AttrsOf<A>, Id> {
  const decl: FacetTypeDecl = {
    kind: 'facet-type',
    id,
    baseType,
    attributes: config.attributes ?? {},
    tier: config.tier,
    hidden: config.hidden,
    label: config.label,
    singular: config.singular,
  }
  registerFacetType(decl)
  return createFacetHandle<Universals & AttrsOf<A>, Id>(id)
}

// ── The 11 BM primitive definers ───────────────────────────────────────────

/** Declare a Thing subtype. Instances carry Thing universals plus any declared attributes. */
export function defineThing<
  Id extends string,
  A extends Record<string, AttrSchema<unknown>> = Record<string, never>,
>(id: Id, config: BmPrimitiveConfig<A> = {}): FacetHandle<ThingUniversals & AttrsOf<A>, Id> {
  return defineBmPrimitive<Id, ThingUniversals, A>('thing', id, config)
}

/** Declare a Persona subtype. */
export function definePersona<
  Id extends string,
  A extends Record<string, AttrSchema<unknown>> = Record<string, never>,
>(id: Id, config: BmPrimitiveConfig<A> = {}): FacetHandle<PersonaUniversals & AttrsOf<A>, Id> {
  return defineBmPrimitive<Id, PersonaUniversals, A>('persona', id, config)
}

/** Declare a Port subtype. */
export function definePort<
  Id extends string,
  A extends Record<string, AttrSchema<unknown>> = Record<string, never>,
>(id: Id, config: BmPrimitiveConfig<A> = {}): FacetHandle<PortUniversals & AttrsOf<A>, Id> {
  return defineBmPrimitive<Id, PortUniversals, A>('port', id, config)
}

/** Declare a Workflow subtype. */
export function defineWorkflow<
  Id extends string,
  A extends Record<string, AttrSchema<unknown>> = Record<string, never>,
>(id: Id, config: BmPrimitiveConfig<A> = {}): FacetHandle<WorkflowUniversals & AttrsOf<A>, Id> {
  return defineBmPrimitive<Id, WorkflowUniversals, A>('workflow', id, config)
}

/** Declare an Interface subtype. The `kind` enum comes from the Interface universals. */
export function defineInterfaceType<
  Id extends string,
  A extends Record<string, AttrSchema<unknown>> = Record<string, never>,
>(id: Id, config: BmPrimitiveConfig<A> = {}): FacetHandle<InterfaceUniversals & AttrsOf<A>, Id> {
  return defineBmPrimitive<Id, InterfaceUniversals, A>('interface', id, config)
}
// Note: exported as `defineInterfaceType` rather than `defineInterface` because
// `Interface` is a reserved TypeScript keyword in some lint configs. Barrel
// exports `defineInterfaceType` under the shorter alias.

/** Declare an Event subtype. */
export function defineEvent<
  Id extends string,
  A extends Record<string, AttrSchema<unknown>> = Record<string, never>,
>(id: Id, config: BmPrimitiveConfig<A> = {}): FacetHandle<EventUniversals & AttrsOf<A>, Id> {
  return defineBmPrimitive<Id, EventUniversals, A>('event', id, config)
}

/** Declare a Measure subtype. */
export function defineMeasure<
  Id extends string,
  A extends Record<string, AttrSchema<unknown>> = Record<string, never>,
>(id: Id, config: BmPrimitiveConfig<A> = {}): FacetHandle<MeasureUniversals & AttrsOf<A>, Id> {
  return defineBmPrimitive<Id, MeasureUniversals, A>('measure', id, config)
}

/** Declare a Function subtype. */
export function defineFunctionType<
  Id extends string,
  A extends Record<string, AttrSchema<unknown>> = Record<string, never>,
>(id: Id, config: BmPrimitiveConfig<A> = {}): FacetHandle<FunctionUniversals & AttrsOf<A>, Id> {
  return defineBmPrimitive<Id, FunctionUniversals, A>('function', id, config)
}
// Exported as `defineFunctionType` for the same reason as `defineInterfaceType`.

/** Declare a DataSource subtype. */
export function defineDataSource<
  Id extends string,
  A extends Record<string, AttrSchema<unknown>> = Record<string, never>,
>(id: Id, config: BmPrimitiveConfig<A> = {}): FacetHandle<DataSourceUniversals & AttrsOf<A>, Id> {
  return defineBmPrimitive<Id, DataSourceUniversals, A>('dataSource', id, config)
}

/** Declare a Pipeline subtype. */
export function definePipeline<
  Id extends string,
  A extends Record<string, AttrSchema<unknown>> = Record<string, never>,
>(id: Id, config: BmPrimitiveConfig<A> = {}): FacetHandle<PipelineUniversals & AttrsOf<A>, Id> {
  return defineBmPrimitive<Id, PipelineUniversals, A>('pipeline', id, config)
}

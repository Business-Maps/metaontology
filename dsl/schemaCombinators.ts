/**
 * Schema combinators - the type-safe building blocks of the DSL.
 *
 * Every facet type's `attributes` schema is declared as a record of
 * `AttrSchema<T>` values. Each combinator is a runtime object with a
 * phantom type field (`_tsType`) that carries the attribute's
 * TypeScript shape at compile time. At runtime the combinators are
 * just tagged objects the registry can serialize; all the type
 * information lives in the types.
 *
 * Call site:
 *
 *   defineThing('exampleNode', {
 *     attributes: {
 *       x: decimal,
 *       y: decimal,
 *       width: decimal.default(200),
 *       stage: enumOf('draft', 'active', 'archived'),
 *       fields: list(object({ name: text, type: text })),
 *     },
 *   })
 *
 * The resulting handle's `.add({...})` is type-checked against the
 * resolved attribute shape, with required/optional-key handling
 * driven by the presence or absence of `.default(v)`. See
 * `handles.ts` for the type algebra that converts a schema record
 * into a resolved attribute shape.
 *
 * Phase 0 spike validated this inference. Phase 1 lifts it into production.
 */

// ── Core primitive ──────────────────────────────────────────────────────────

/**
 * A phantom-typed schema combinator. The `_tsType` field is never set
 * at runtime - it exists purely to carry the attribute's resolved
 * TypeScript type through the inference chain.
 */
export interface AttrSchema<T> {
  readonly _tsType: T
  readonly kind: string
}

/** Extract the TypeScript type from a schema combinator. */
export type Infer<S> = S extends AttrSchema<infer T> ? T : never

/**
 * A schema combinator tagged as optional. Fields declared with
 * `.default(v)` carry this marker so `AttrsOf<A>` in `handles.ts` can
 * emit them as `?:` properties instead of required ones.
 */
export interface OptionalAttrSchema<T> extends AttrSchema<T> {
  readonly isOptional: true
  readonly defaultValue: T
}

/** Internal: primitive schema constructor with `.default()` attached. */
interface PrimitiveCombinator<T> extends AttrSchema<T> {
  default(value: T): OptionalAttrSchema<T>
}

function makePrimitive<T>(kind: string): PrimitiveCombinator<T> {
  return {
    kind,
    _tsType: null as unknown as T,
    default(value: T): OptionalAttrSchema<T> {
      return {
        kind: `${kind}.default`,
        _tsType: null as unknown as T,
        isOptional: true,
        defaultValue: value,
      }
    },
  }
}

// ── String family ────────────────────────────────────────────────────────────

/** Free-form text. Maps to xsd:string. */
export const text = makePrimitive<string>('text')

/** Short code or identifier (no whitespace). Maps to xsd:token. */
export const identifier = makePrimitive<string>('identifier')

/** Email address. Use `emailValueType` for validated emails. */
export const email = makePrimitive<string>('email')

/** URL or URI. Maps to xsd:anyURI. */
export const uri = makePrimitive<string>('uri')

/** Markdown-formatted rich text. */
export const markdown = makePrimitive<string>('markdown')

/** Structured rich content (ProseMirror-compatible doc). Inferred as
 *  `unknown` at the DSL level; consumers that need the concrete shape
 *  import `RichDoc` from the generated context types. Stored as a
 *  first-class complex datatype so the doc serializer can walk it and
 *  emit triples for mentions, todos, embeds, and block structure. */
export const richDoc = makePrimitive<unknown>('richDoc')

// ── Number family ────────────────────────────────────────────────────────────

/** Whole number (no decimals). Maps to xsd:integer. */
export const integer = makePrimitive<number>('integer')

/** Precise decimal number. Maps to xsd:decimal. */
export const decimal = makePrimitive<number>('decimal')

/** Percentage value. Maps to xsd:decimal. */
export const percentage = makePrimitive<number>('percentage')

// ── Temporal family ──────────────────────────────────────────────────────────

/** Calendar date with no time component. Maps to xsd:date. */
export const date = makePrimitive<Date>('date')

/** Date with time of day. Maps to xsd:dateTime. */
export const dateTime = makePrimitive<Date>('dateTime')

/** Time of day only. Maps to xsd:time. */
export const time = makePrimitive<string>('time')

/** Length of time (ISO 8601 duration string, e.g. `P2D`, `PT30M`). */
export const duration = makePrimitive<string>('duration')

// ── Boolean ──────────────────────────────────────────────────────────────────

/** True/false flag. Maps to xsd:boolean. */
export const boolean = makePrimitive<boolean>('boolean')

// ── Composite combinators ────────────────────────────────────────────────────

/**
 * A list schema carries its element schema on the returned object so
 * the registry can serialize it and the engine can validate instances
 * element-by-element.
 */
export interface ListSchema<S extends AttrSchema<unknown>> extends AttrSchema<Infer<S>[]> {
  readonly kind: 'list'
  readonly element: S
}

/**
 * An array of a given schema type. Inferred as `T[]` where `T` is the
 * element schema's inferred type.
 */
export function list<S extends AttrSchema<unknown>>(of: S): ListSchema<S> {
  return {
    kind: 'list',
    element: of,
    _tsType: null as unknown as Infer<S>[],
  }
}

/**
 * An object schema carries its field schemas on the returned object so
 * the registry can serialize it and the engine can walk the nested
 * fields during validation.
 */
export interface ObjectSchema<S extends Record<string, AttrSchema<unknown>>>
  extends AttrSchema<{ [K in keyof S]: Infer<S[K]> }> {
  readonly kind: 'object'
  readonly fields: S
}

/**
 * An inline object with its own typed fields. Inferred as a record
 * with each field's schema resolved to its TypeScript type.
 */
export function object<S extends Record<string, AttrSchema<unknown>>>(
  fields: S,
): ObjectSchema<S> {
  return {
    kind: 'object',
    fields,
    _tsType: null as unknown as { [K in keyof S]: Infer<S[K]> },
  }
}

/**
 * An enum schema carries its allowed values on the returned object so
 * the registry can serialize them and the engine can validate
 * instances against the allowed set at runtime.
 */
export interface EnumSchema<T extends readonly string[]> extends AttrSchema<T[number]> {
  readonly kind: 'enum'
  readonly values: T
}

/**
 * A string-valued enum constrained to one of the provided literal
 * values at the type level.
 *
 * Usage: `enumOf('draft', 'active', 'archived')` infers to
 * `'draft' | 'active' | 'archived'`.
 */
export function enumOf<const T extends readonly string[]>(...values: T): EnumSchema<T> {
  return {
    kind: 'enum',
    values,
    _tsType: null as unknown as T[number],
  }
}

// ── Reference combinator ─────────────────────────────────────────────────────

/**
 * Brand tag applied to handles returned by the `defineX` helpers. The
 * `reference()` combinator accepts either one of these handles (for
 * type-safe pointing at a specific facet type) or the sentinel
 * `'any'` (for polymorphic references that can point at any entity).
 *
 * The actual handle type lives in `handles.ts`; this brand is the
 * minimum surface the reference combinator needs to recognize a
 * handle as a valid target at compile time.
 */
export interface BrandedHandle {
  readonly __brand: 'FacetHandle'
  readonly __id: string
}

/**
 * A reference attribute - an opaque string id that points at another
 * entity. The inferred type is always `string` (the referenced id),
 * but the schema records which type(s) the reference is allowed to
 * point at for validation and query purposes.
 */
export interface ReferenceBuilder {
  to<H extends BrandedHandle>(handle: H): AttrSchema<string>
  to(kind: 'any'): AttrSchema<string>
}

/**
 * Create a lightweight facet-type reference for use in `definePredicate`
 * domain/range arrays when you need to reference a base type by string
 * id rather than importing a full `FacetHandle`. This is the idiomatic
 * way to reference base types in predicate declarations:
 *
 *   definePredicate('performs', {
 *     domain: [facetRef('persona')],
 *     range: [facetRef('action')],
 *   })
 */
export function facetRef(id: string): BrandedHandle {
  return { __brand: 'FacetHandle', __id: id }
}

export function reference(): ReferenceBuilder {
  return {
    to(_target: BrandedHandle | 'any'): AttrSchema<string> {
      return {
        kind: 'reference',
        _tsType: null as unknown as string,
      }
    },
  }
}

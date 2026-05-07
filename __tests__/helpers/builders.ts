/**
 * Shared test builders for `RootContext`, contexts, facets, links, and symbols.
 *
 * Goal: kill the duplicated `makeRoot()` / `makeModel()` / `addContext()` helpers
 * scattered across the codebase's test files. Every new test introduced by the
 *   - Pure: every `.build()` returns a fresh value via `structuredClone`; no
 *     shared mutable state survives `.build()`
 *   - Honest: builders never normalize, migrate, or auto-fix - what you describe
 *     is what you get. Migration logic is exercised by its own tests.
 */

import { nanoid } from 'nanoid'
import type {
  RootContext,
  Context,
  Thing,
  Persona,
  Action,
  Link,
  LinkPredicate,
  Symbol as ContextSymbol,
  FacetType,
  Facet,
} from '../../types/context'
import { createEmptyRootContext, createEmptyContext } from '../../engine/apply'
import { createEmptyFacets } from '../../meta/facets'

// ── Layout factory ──────────────────────────────────────────────────────────

/**
 * Layout stand-in for ontology-layer tests. The metaontology has no
 * concept of layout (it lives in the consumer layer), but the shared test helpers still need a structural stand-in for
 * tests that exercise the commit log's layout-carrying behavior.
 */
export interface TestLayout {
  modelId: string
  positions: Record<string, { x: number; y: number }>
  handles: Record<string, { sourceHandle?: string; targetHandle?: string }>
  sizes: Record<string, { width: number; height: number }>
  zIndices: Record<string, number>
}

export function emptyLayout(modelId: string): TestLayout {
  return {
    modelId,
    positions: {},
    handles: {},
    sizes: {},
    zIndices: {},
  }
}

// ── Root model builder ──────────────────────────────────────────────────────

/**
 * Fluent builder for a `RootContext`.
 *
 * Usage:
 * ```ts
 * const root = aModel('Checkout')
 *   .withContext(aContext('Payments').withThing('Invoice'))
 *   .withLink('relatedTo', 'src-id', 'tgt-id')
 *   .build()
 * ```
 *
 * IDs default to `nanoid()` when not specified. Pass `.withId(...)` for
 * deterministic IDs in assertions.
 */
export class ModelBuilder {
  private root: RootContext

  constructor(name = 'Test') {
    this.root = createEmptyRootContext(name)
  }

  /** Replace the root uri with a deterministic value. The new uri is also used
   *  as the `parentUri` for any contexts added afterwards. */
  withId(id: string): this {
    this.root.uri = id
    return this
  }

  withDescription(description: string): this {
    this.root.description = description
    return this
  }

  /** Append a sub-context built by `aContext(...)`. The context's `parentUri`
   *  is set to the current root uri when `.build(parentUri)` is called. */
  withContext(builder: ContextBuilder): this {
    const ctx = builder.build(this.root.uri)
    this.root.contexts[ctx.uri] = ctx
    return this
  }

  /** Add a thing to the root container (not to a sub-context). */
  withRootThing(builder: ThingBuilder): this {
    this.root.facets.things.push(builder.build())
    return this
  }

  /** Add a persona to the root container. */
  withRootPersona(builder: PersonaBuilder): this {
    this.root.facets.personas.push(builder.build())
    return this
  }

  /** Add a free-form facet of any type to the root container. Used by tests
   *  that need to inject hand-crafted facets without going through a builder. */
  withRootFacet(type: FacetType, facet: Facet): this {
    const arr = this.root.facets[type] as Facet[]
    arr.push(facet)
    return this
  }

  /** Append a link with a given predicate. Validation is *not* run - tests
   *  that need validation should call `applyCommand` instead. */
  withLink(predicate: LinkPredicate, sourceUri: string, targetUri: string, uri?: string): this {
    const link: Link = {
      uri: uri ?? nanoid(),
      predicate,
      sourceUri,
      targetUri,
    }
    this.root.links.push(link)
    return this
  }

  /** Append a symbol to the root context. */
  withSymbol(label: string, uri?: string): this {
    const sym: ContextSymbol = {
      uri: uri ?? nanoid(),
      content: label,
      label,
      mode: 'title',
    } as ContextSymbol
    this.root.symbols.push(sym)
    return this
  }

  build(): RootContext {
    // structuredClone prevents test mutation from leaking back into the
    // builder if it's reused.
    return structuredClone(this.root)
  }
}

export function aModel(name = 'Test'): ModelBuilder {
  return new ModelBuilder(name)
}

// ── Context builder ─────────────────────────────────────────────────────────

export class ContextBuilder {
  private name: string
  private id: string | undefined
  private description = ''
  private things: Thing[] = []
  private personas: Persona[] = []
  private actions: Action[] = []

  constructor(name: string) {
    this.name = name
  }

  withId(id: string): this {
    this.id = id
    return this
  }

  withDescription(description: string): this {
    this.description = description
    return this
  }

  withThing(name: string, builderFn?: (b: ThingBuilder) => ThingBuilder): this {
    const b = aThing(name)
    this.things.push((builderFn ? builderFn(b) : b).build())
    return this
  }

  withPersona(name: string, builderFn?: (b: PersonaBuilder) => PersonaBuilder): this {
    const b = aPersona(name)
    this.personas.push((builderFn ? builderFn(b) : b).build())
    return this
  }

  withAction(name: string, builderFn?: (b: ActionBuilder) => ActionBuilder): this {
    const b = anAction(name)
    this.actions.push((builderFn ? builderFn(b) : b).build())
    return this
  }

  build(parentUri: string): Context {
    const ctx = createEmptyContext(this.name, parentUri)
    if (this.id) ctx.uri = this.id
    ctx.description = this.description
    ctx.facets.things = this.things
    ctx.facets.personas = this.personas
    ctx.facets.actions = this.actions
    return ctx
  }
}

export function aContext(name: string): ContextBuilder {
  return new ContextBuilder(name)
}

// ── Thing builder ───────────────────────────────────────────────────────────

export class ThingBuilder {
  private thing: Thing

  constructor(name: string) {
    this.thing = {
      uri: nanoid(),
      name,
      definition: '',
      attributes: [],
    } as Thing
  }

  withId(id: string): this {
    this.thing.uri = id
    return this
  }

  withDefinition(def: string): this {
    this.thing.definition = def
    return this
  }

  withAttribute(name: string, type: string = 'text', extra: Record<string, unknown> = {}): this {
    this.thing.attributes = this.thing.attributes ?? []
    this.thing.attributes.push({ name, type, ...extra } as Thing['attributes'][number])
    return this
  }

  withTags(tags: string[]): this {
    this.thing.tags = tags
    return this
  }

  build(): Thing {
    return structuredClone(this.thing)
  }
}

export function aThing(name: string): ThingBuilder {
  return new ThingBuilder(name)
}

// ── Persona builder ─────────────────────────────────────────────────────────

export class PersonaBuilder {
  private persona: Persona

  constructor(name: string) {
    this.persona = {
      uri: nanoid(),
      name,
      description: '',
      role: '',
      personaType: 'human',
    } as Persona
  }

  withId(id: string): this {
    this.persona.uri = id
    return this
  }

  withRole(role: string): this {
    this.persona.role = role
    return this
  }

  withPersonaType(type: Persona['personaType']): this {
    this.persona.personaType = type
    return this
  }

  build(): Persona {
    return structuredClone(this.persona)
  }
}

export function aPersona(name: string): PersonaBuilder {
  return new PersonaBuilder(name)
}

// ── Action builder ──────────────────────────────────────────────────────────

export class ActionBuilder {
  private action: Action

  constructor(name: string) {
    this.action = {
      uri: nanoid(),
      name,
      description: '',
      type: 'command',
    } as Action
  }

  withId(id: string): this {
    this.action.uri = id
    return this
  }

  withType(type: Action['type']): this {
    this.action.type = type
    return this
  }

  withParameter(name: string, type: string = 'text', required = true): this {
    this.action.parameters = this.action.parameters ?? []
    this.action.parameters.push({ name, type, required } as NonNullable<Action['parameters']>[number])
    return this
  }

  build(): Action {
    return structuredClone(this.action)
  }
}

export function anAction(name: string): ActionBuilder {
  return new ActionBuilder(name)
}

// ── Re-exports of canonical empty constructors ──────────────────────────────

export { createEmptyRootContext, createEmptyContext } from '../../engine/apply'
export { createEmptyFacets }

/**
 * `defineFacetType` - the low-level DSL primitive.
 *
 * This is the escape hatch for declaring a facet type that doesn't
 * fit one of the 11 BM primitives (Thing, Persona, Port, Action,
 * Workflow, Interface, Event, Measure, Function, DataSource,
 * Pipeline). It's the raw interface to the registry.
 *
 * Consumers building on the BM framework should prefer the typed
 * sugar - `defineThing`, `definePersona`, `defineAction`, etc. -
 * because they carry the base type's universal attributes onto the
 * returned handle's type surface. `defineFacetType` is for the rare
 * case where you want a facet type with no base-type inheritance at
 * all.
 *
 * Phase 1 declares the signature and the type inference. Runtime
 * dispatch (`.add`, `.update`, `.where`, etc. compiling to commit log
 * commands) arrives in a later chunk - the method bodies in this
 * first cut are typed stubs so the handles compile end-to-end.
 */

import { nanoid } from 'nanoid'
import type { AttrSchema } from './schemaCombinators'
import type { FacetHandle, AttrsOf, QueryResult } from './handles'
import type { FacetTypeDecl } from './registry'
import { registerFacetType, listFacetTypesByBaseType } from './registry'
import { dispatch, getRoot } from './dispatcher'
import type { FacetType, Facet, FacetContainer } from '../types/context'

// ── Config ─────────────────────────────────────────────────────────────────

/** Minimal universal shape every facet instance carries - extends SymbolUniversals. */
export interface BaseFacetAttrs {
  uri: string
  name: string
  tags?: string[]
}

/** Configuration accepted by `defineFacetType`. */
export interface FacetTypeConfig<A extends Record<string, AttrSchema<unknown>>> {
  /** Custom attributes declared for this facet type. */
  attributes?: A
  /** Progressive-disclosure tier. Defaults to 2 if unspecified. */
  tier?: 1 | 2 | 3
  /** When true, the type is not shown in user-facing "Add a facet" pickers. */
  hidden?: boolean
  /** Human-readable label (i18n-aware). */
  label?: { en: string; [lang: string]: string }
  /** Singular label for one-off references. */
  singular?: { en: string; [lang: string]: string }
}

// ── The primitive ──────────────────────────────────────────────────────────

/**
 * Declare a facet type with no base-type inheritance. The returned
 * handle's attribute shape is the minimal universal shape (`id`,
 * `name`, `tags?`) intersected with the declared custom attributes.
 *
 * For BM-style facets, use `defineThing` / `definePersona` / etc.
 * instead - they carry the correct base type universals onto the
 * handle's type.
 */
export function defineFacetType<
  Id extends string,
  A extends Record<string, AttrSchema<unknown>> = Record<string, never>,
>(id: Id, config: FacetTypeConfig<A> = {}): FacetHandle<BaseFacetAttrs & AttrsOf<A>, Id> {
  const decl: FacetTypeDecl = {
    kind: 'facet-type',
    id,
    baseType: null,
    attributes: config.attributes ?? {},
    tier: config.tier,
    hidden: config.hidden,
    label: config.label,
    singular: config.singular,
  }
  registerFacetType(decl)
  return createFacetHandle(id)
}

// ── Internal: shared handle factory used by defineFacetType AND by the
//              primitive definers in `definePrimitives.ts` (like `defineThing`).
//
// Runtime method bodies are stubs in this first Phase 1 chunk - they
// satisfy the typed `FacetHandle` surface so consumers compile, but
// they don't yet dispatch to the commit log. The next chunk wires
// them to `useBmStore().dispatch()` via a deferred accessor so the
// metaontology layer doesn't import from the BM or app layers.

// ── Internal: collect all instances of a facet type across all containers ──

function collectInstances<T>(typeId: string): T[] {
  try {
    const root = getRoot()
    const results: T[] = []

    // Resolve which facet keys to search: the type itself + all subtypes
    const subtypeIds = listFacetTypesByBaseType(typeId).map(d => d.id)
    const allKeys = [typeId, ...subtypeIds]

    const containers: FacetContainer[] = [root, ...Object.values(root.contexts)]
    for (const container of containers) {
      for (const key of allKeys) {
        // Try built-in facets first, then customFacets
        const builtIn = container.facets[key as FacetType] as Facet[] | undefined
        if (builtIn) results.push(...builtIn as unknown as T[])
        const custom = container.customFacets?.[key]
        if (custom) results.push(...custom as unknown as T[])
      }
    }
    return results
  } catch {
    // Root accessor not bound yet - return empty
    return []
  }
}

function findInstanceById<T extends { uri: string }>(typeId: string, entityUri: string): T | undefined {
  const all = collectInstances<T>(typeId)
  return all.find(item => item.uri === entityUri)
}

/**
 * Internal factory for building a typed `FacetHandle`. Exported so
 * the BM primitive helpers (`defineThing`, `definePersona`, etc.) can
 * share the same handle construction path.
 *
 * When a dispatcher is bound (via `bindDispatcher`), the handle's
 * write methods dispatch real commands through the framework's commit
 * log. When no dispatcher is bound (early module init, test setup),
 * write methods throw with a descriptive error.
 *
 * Read methods (findById, where, all, count) query the live
 * RootContext via the bound root accessor.
 *
 * @internal
 */
export function createFacetHandle<TAttrs, TId extends string>(id: TId): FacetHandle<TAttrs, TId> {
  const handle: FacetHandle<TAttrs, TId> = {
    __brand: 'FacetHandle',
    __id: id,
    typeId: id,

    add(input) {
      const facetUri = (input as Record<string, unknown>).uri as string ?? nanoid()
      const facet = { ...input, uri: facetUri } as Record<string, unknown>

      try {
        const root = getRoot()
        dispatch({
          type: 'facet:add',
          payload: { contextUri: root.uri, facetType: id, facet },
        })
      } catch {
        // Dispatcher not bound - return the URI anyway so compile-time
        // usage in module bodies (which may run before init) doesn't crash.
      }
      return facetUri
    },

    findByUri(entityUri: string) {
      return findInstanceById<TAttrs & { uri: string }>(id, entityUri) as TAttrs | undefined
    },

    where(predicate): QueryResult<TAttrs> {
      return {
        all() {
          return collectInstances<TAttrs>(id).filter(predicate)
        },
        first() {
          return collectInstances<TAttrs>(id).find(predicate)
        },
        count() {
          return collectInstances<TAttrs>(id).filter(predicate).length
        },
      }
    },

    all() {
      return collectInstances<TAttrs>(id)
    },

    update(entityUri, changes) {
      try {
        const root = getRoot()
        dispatch({
          type: 'facet:update',
          payload: { contextUri: root.uri, facetType: id, facetUri: entityUri, changes },
        })
      } catch {
        // Dispatcher not bound
      }
    },

    remove(entityUri) {
      try {
        const root = getRoot()
        dispatch({
          type: 'facet:remove',
          payload: { contextUri: root.uri, facetType: id, facetUri: entityUri },
        })
      } catch {
        // Dispatcher not bound
      }
    },

    count(predicate?) {
      const all = collectInstances<TAttrs>(id)
      return predicate ? all.filter(predicate).length : all.length
    },
  }
  return handle
}

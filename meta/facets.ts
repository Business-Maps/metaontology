/**
 * Facet metadata - derived from the DSL registry.
 *
 * Phase 3 migrated this file from hardcoded constants to registry-derived
 * exports. The export shapes are identical so downstream consumers
 * keep working with zero changes.
 * The underlying data comes from the DSL registry's `core/baseTypes.ts`
 * declarations rather than inline constants.
 */

import type { FacetType, FacetArrays, Facet } from '../types/context'
import type { EntityClassId } from './ontology'
import type { I18nLiteral } from './i18n'
import { i18n } from './i18n'
import { getRegisteredFacetKeys, getFacetDeclByKey } from '../dsl/engineBridge'

// ── Structural metadata types ──────────────────────────────────────────────

export interface FacetMetaBase {
  key: FacetType
  label: I18nLiteral
  singular: I18nLiteral
  entityClass: EntityClassId
  tier: 1 | 2 | 3
}

export interface FacetMetaPresentation {
  color: string
  icon: string
  nodeType: string
  hint: string
}

export type FacetMetaItem = FacetMetaBase & FacetMetaPresentation

// ── Registry-derived BASE_FACET_REGISTRY ───────────────────────────────────
//
// Constructed lazily from the DSL registry's base type declarations.
// Each registered base type (baseType === null, with a facetKey) is
// mapped to the FacetMetaBase shape that downstream consumers expect.

function buildBaseRegistry(): Record<FacetType, FacetMetaBase> {
  const result = {} as Record<string, FacetMetaBase>
  for (const key of getRegisteredFacetKeys()) {
    const decl = getFacetDeclByKey(key)
    if (!decl) continue
    result[key] = {
      key: key as FacetType,
      label: decl.label ?? i18n(key),
      singular: decl.singular ?? i18n(key),
      entityClass: (decl.entityClassId ?? decl.id) as EntityClassId,
      tier: decl.tier ?? 2,
    }
  }
  return result as Record<FacetType, FacetMetaBase>
}

let _baseRegistry: Record<FacetType, FacetMetaBase> | null = null

/** @public Structural metadata for all registered base facet types. */
export function getBaseRegistry(): Record<FacetType, FacetMetaBase> {
  if (!_baseRegistry) _baseRegistry = buildBaseRegistry()
  return _baseRegistry
}

/**
 * @deprecated Phase 3 compatibility shim - use `getBaseRegistry()` instead.
 * This constant is lazily initialized from the DSL registry. Downstream
 * consumers that import `BASE_FACET_REGISTRY` get the registry-derived
 * value without code changes.
 */
export const BASE_FACET_REGISTRY: Record<FacetType, FacetMetaBase> = new Proxy(
  {} as Record<FacetType, FacetMetaBase>,
  {
    get(_target, prop) {
      return getBaseRegistry()[prop as FacetType]
    },
    ownKeys() {
      return Object.keys(getBaseRegistry())
    },
    getOwnPropertyDescriptor(_target, prop) {
      const reg = getBaseRegistry()
      if (prop in reg) {
        return { configurable: true, enumerable: true, value: reg[prop as FacetType] }
      }
      return undefined
    },
    has(_target, prop) {
      return prop in getBaseRegistry()
    },
  },
)

// ── Merge function ──────────────────────────────────────────────────────────

/** Merge structural base with consumer-provided presentation to create a full registry. */
export function createFacetRegistry(
  presentation: Record<FacetType, FacetMetaPresentation>,
): Record<FacetType, FacetMetaItem> {
  const base = getBaseRegistry()
  const merged = {} as Record<FacetType, FacetMetaItem>
  for (const key of Object.keys(base) as FacetType[]) {
    merged[key] = { ...base[key], ...presentation[key] }
  }
  return merged
}

// ── Derived constants ──────────────────────────────────────────────────────

/** Ordered list of all facet types - derived from the DSL registry. */
export const FACET_TYPES = getRegisteredFacetKeys() as FacetType[]

/** Create an empty FacetArrays object - one empty array per registered facet type. */
export function createEmptyFacets(): FacetArrays {
  const facets = {} as FacetArrays
  for (const ft of getRegisteredFacetKeys()) (facets as Record<string, Facet[]>)[ft] = []
  return facets
}

// ── Progressive Tiers ────────────────────────────────────────────────────────

export const FACET_TYPES_BY_TIER: Record<1 | 2 | 3, FacetType[]> = {
  1: FACET_TYPES.filter(t => getBaseRegistry()[t]?.tier === 1),
  2: FACET_TYPES.filter(t => getBaseRegistry()[t]?.tier === 2),
  3: FACET_TYPES.filter(t => getBaseRegistry()[t]?.tier === 3),
}

export const TIER_LABELS = {
  1: { label: 'What exists', hint: 'Nouns and actors - the first things you name' },
  2: { label: 'What happens', hint: 'Verbs, processes, and outcomes - how work gets done' },
  3: { label: 'How it\'s built', hint: 'Implementation surfaces - where interaction happens' },
} as const

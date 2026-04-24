/**
 * Engine bridge - registry-backed replacements for the hardcoded
 * constants the engine used to import from `meta/facets` and
 * `meta/ontology`.
 *
 * Phase 2 replaces `FACET_TYPES`, `FACET_KEY_TO_CLASS`, and related
 * constants with calls to these functions so the engine iterates
 * the DSL registry instead of a hardcoded list.
 *
 * These functions are intentionally thin wrappers over the registry's
 * introspection API. They exist as a named migration surface: once
 * Phase 3 deletes the old constants, the engine's imports remain
 * stable (they point here, not at the deleted files).
 */

import { listFacetTypes, getFacetType } from './registry'
import type { FacetTypeDecl } from './registry'

// The core base types register themselves as a side effect of being
// imported. But ES module imports only run once - if a test calls
// `resetRegistry()`, the registrations are lost and the side-effect
// import won't re-run. `ensureCoreRegistered()` lazily re-registers
// them via the explicit function that `baseTypes.ts` exports for
// exactly this case.
import { ensureBaseTypesRegistered } from '../core/baseTypes'

function ensureCoreRegistered(): void {
  // Check if the 'thing' base type is registered - if so, all base
  // types are present (they register atomically via ensureBaseTypesRegistered).
  if (getFacetType('thing')) return
  // Re-register (idempotent).
  ensureBaseTypesRegistered()
}

/**
 * Returns the facet-array keys the engine should iterate when scanning
 * `FacetContainer.facets`. Equivalent to the old `FACET_TYPES` constant
 * but driven by the DSL registry.
 *
 * Only returns base types (baseType === null) - subtypes don't get
 * their own top-level facet array; they're stored under their base
 * type's array. This matches the existing behavior where `things`
 * contains all Thing instances regardless of subtype.
 */
export function getRegisteredFacetKeys(): string[] {
  ensureCoreRegistered()
  return listFacetTypes()
    .filter(d => d.baseType === null && d.facetKey)
    .map(d => d.facetKey!)
}

/**
 * Maps a facet-array key (e.g. `'things'`) to its entity class id
 * (e.g. `'Thing'`). Equivalent to the old `FACET_KEY_TO_CLASS` constant.
 *
 * Returns undefined for unrecognized keys (custom facet types that
 * don't have a well-known entity class id).
 */
export function facetKeyToClass(facetKey: string): string | undefined {
  ensureCoreRegistered()
  const decl = listFacetTypes().find(d => d.facetKey === facetKey)
  if (!decl) return undefined
  // Use the explicit entityClassId (PascalCase, no space) if set;
  // otherwise fall back to the type id.
  return decl.entityClassId ?? decl.id
}

/**
 * Returns the full map of facet-array key → entity class id.
 * Equivalent to the old `FACET_KEY_TO_CLASS` record.
 */
export function getFacetKeyToClassMap(): Record<string, string> {
  ensureCoreRegistered()
  const map: Record<string, string> = {}
  for (const decl of listFacetTypes()) {
    if (decl.baseType === null && decl.facetKey) {
      map[decl.facetKey] = decl.entityClassId ?? decl.id
    }
  }
  return map
}

/**
 * Returns the reverse map: entity class id → facet-array key.
 * Equivalent to the old `CLASS_TO_FACET_KEY` that some engine files
 * computed inline.
 */
export function getClassToFacetKeyMap(): Record<string, string> {
  ensureCoreRegistered()
  const map: Record<string, string> = {}
  for (const decl of listFacetTypes()) {
    if (decl.baseType === null && decl.facetKey) {
      map[decl.entityClassId ?? decl.id] = decl.facetKey
    }
  }
  return map
}

/**
 * Resolve the singular display name for a facet-array key.
 * Equivalent to `BASE_FACET_REGISTRY[facetKey]?.singular`.
 */
export function resolveFacetSingular(facetKey: string): string {
  const decl = listFacetTypes().find(d => d.facetKey === facetKey)
  return decl?.singular?.en ?? facetKey
}

/**
 * Check whether a given string is a registered (built-in) facet type key.
 * Equivalent to the old `FACET_TYPES.includes(type)`.
 */
export function isRegisteredFacetKey(key: string): boolean {
  return listFacetTypes().some(d => d.facetKey === key)
}

/**
 * Look up a base type declaration by facet key. Returns the full
 * `FacetTypeDecl` so callers can read tier, label, attributes, etc.
 */
export function getFacetDeclByKey(facetKey: string): FacetTypeDecl | undefined {
  return listFacetTypes().find(d => d.facetKey === facetKey)
}

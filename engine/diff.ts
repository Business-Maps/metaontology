import type { RootContext, Facet, Link, Symbol } from '../types/context'
import type { ContextDiff } from '../types/branch'
import { getRegisteredFacetKeys } from '../dsl/engineBridge'

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compare two values by top-level field, returning the list of keys that differ.
 * Uses JSON.stringify per key for deep equality.
 */
export function diffFields(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  excludeKeys: Set<string> = new Set(),
): string[] {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)])
  const changed: string[] = []
  for (const key of allKeys) {
    if (excludeKeys.has(key)) continue
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      changed.push(key)
    }
  }
  return changed
}

interface FacetEntry {
  containerId: string
  facetType: string
  facet: Facet
}

/** Build a global index of all facets across root and all contexts, keyed by facet ID. */
export function collectAllFacets(root: RootContext): Map<string, FacetEntry> {
  const map = new Map<string, FacetEntry>()
  for (const ft of getRegisteredFacetKeys()) {
    for (const f of root.facets[ft] as Facet[]) {
      map.set(f.uri, { containerId: root.uri, facetType: ft, facet: f })
    }
    for (const ctx of Object.values(root.contexts)) {
      for (const f of ctx.facets[ft] as Facet[]) {
        map.set(f.uri, { containerId: ctx.uri, facetType: ft, facet: f })
      }
    }
  }
  return map
}

interface SymbolEntry {
  containerId: string
  symbol: Symbol
}

/** Build a global index of all symbols across root and all contexts, keyed by symbol ID. */
export function collectAllSymbols(root: RootContext): Map<string, SymbolEntry> {
  const map = new Map<string, SymbolEntry>()
  for (const symbol of root.symbols) {
    map.set(symbol.uri, { containerId: root.uri, symbol })
  }
  for (const ctx of Object.values(root.contexts)) {
    for (const symbol of ctx.symbols) {
      map.set(symbol.uri, { containerId: ctx.uri, symbol })
    }
  }
  return map
}

// ── Core diff ───────────────────────────────────────────────────────────────

/**
 * Compute a structural diff between two RootContext states.
 *
 * Pure function - does not mutate either input.
 * Compares entities by stable ID. Reports field-level changes for modified entities.
 */
export function diffRootContexts(base: RootContext, target: RootContext): ContextDiff {
  const diff: ContextDiff = {
    rootProps: [],
    contexts: [],
    facets: [],
    links: [],
    symbols: [],
  }

  diffRootProps(base, target, diff)
  diffContexts(base, target, diff)
  diffFacets(base, target, diff)
  diffLinks(base, target, diff)
  diffSymbols(base, target, diff)

  return diff
}

// ── Root properties ─────────────────────────────────────────────────────────

function diffRootProps(base: RootContext, target: RootContext, diff: ContextDiff): void {
  // Compare name and description only. Exclude: id (identity), meta (auto-managed),
  // contexts/links/symbols/facets (handled separately).
  const propsToCheck: (keyof RootContext)[] = ['name', 'description']
  const changed: string[] = []

  for (const prop of propsToCheck) {
    if (JSON.stringify(base[prop]) !== JSON.stringify(target[prop])) {
      changed.push(prop)
    }
  }

  if (changed.length > 0) {
    diff.rootProps.push({
      entityType: 'root-props',
      id: base.uri,
      changeType: 'modified',
      entityName: target.name,
      changedFields: changed,
      baseValue: { name: base.name, description: base.description },
      targetValue: { name: target.name, description: target.description },
    })
  }
}

// ── Contexts ────────────────────────────────────────────────────────────────

const CONTEXT_EXCLUDE_KEYS = new Set([
  // Facet arrays (under .facets) and symbols - tracked separately by their own diffs
  'facets', 'symbols',
  // Identity - stable, not a diff-able change
  'id',
])

function diffContexts(base: RootContext, target: RootContext, diff: ContextDiff): void {
  const baseIds = new Set(Object.keys(base.contexts))
  const targetIds = new Set(Object.keys(target.contexts))

  // Added
  for (const id of targetIds) {
    if (!baseIds.has(id)) {
      const ctx = target.contexts[id]!
      diff.contexts.push({
        entityType: 'context',
        id,
        changeType: 'added',
        entityName: ctx.name,
        targetValue: ctx,
      })
    }
  }

  // Removed
  for (const id of baseIds) {
    if (!targetIds.has(id)) {
      const ctx = base.contexts[id]!
      diff.contexts.push({
        entityType: 'context',
        id,
        changeType: 'removed',
        entityName: ctx.name,
        baseValue: ctx,
      })
    }
  }

  // Modified
  for (const id of baseIds) {
    if (!targetIds.has(id)) continue
    const baseCtx = base.contexts[id]!
    const targetCtx = target.contexts[id]!
    const changed = diffFields(
      baseCtx as unknown as Record<string, unknown>,
      targetCtx as unknown as Record<string, unknown>,
      CONTEXT_EXCLUDE_KEYS,
    )
    if (changed.length > 0) {
      diff.contexts.push({
        entityType: 'context',
        id,
        changeType: 'modified',
        entityName: targetCtx.name,
        changedFields: changed,
        baseValue: baseCtx,
        targetValue: targetCtx,
      })
    }
  }
}

// ── Facets (global by ID) ───────────────────────────────────────────────────

const _FACET_VIRTUAL_FIELDS = new Set(['containerId', 'facetType'])

function diffFacets(base: RootContext, target: RootContext, diff: ContextDiff): void {
  const baseIndex = collectAllFacets(base)
  const targetIndex = collectAllFacets(target)

  // Added
  for (const [id, entry] of targetIndex) {
    if (!baseIndex.has(id)) {
      diff.facets.push({
        entityType: 'facet',
        id,
        changeType: 'added',
        containerId: entry.containerId,
        facetType: entry.facetType,
        entityName: entry.facet.name,
        targetValue: entry.facet,
      })
    }
  }

  // Removed
  for (const [id, entry] of baseIndex) {
    if (!targetIndex.has(id)) {
      diff.facets.push({
        entityType: 'facet',
        id,
        changeType: 'removed',
        containerId: entry.containerId,
        facetType: entry.facetType,
        entityName: entry.facet.name,
        baseValue: entry.facet,
      })
    }
  }

  // Modified
  for (const [id, baseEntry] of baseIndex) {
    const targetEntry = targetIndex.get(id)
    if (!targetEntry) continue

    const changed: string[] = []

    // Check virtual fields (container move, type change)
    if (baseEntry.containerId !== targetEntry.containerId) changed.push('containerId')
    if (baseEntry.facetType !== targetEntry.facetType) changed.push('facetType')

    // Check facet data fields
    const dataChanged = diffFields(
      baseEntry.facet as unknown as Record<string, unknown>,
      targetEntry.facet as unknown as Record<string, unknown>,
      new Set(['id']), // exclude stable identity
    )
    changed.push(...dataChanged)

    if (changed.length > 0) {
      diff.facets.push({
        entityType: 'facet',
        id,
        changeType: 'modified',
        containerId: targetEntry.containerId,
        facetType: targetEntry.facetType,
        entityName: targetEntry.facet.name,
        changedFields: changed,
        baseValue: baseEntry.facet,
        targetValue: targetEntry.facet,
      })
    }
  }
}

// ── Links ───────────────────────────────────────────────────────────────────

function buildLinkIndex(root: RootContext): Map<string, Link> {
  const map = new Map<string, Link>()
  for (const link of root.links) {
    map.set(link.uri, link)
  }
  return map
}

function diffLinks(base: RootContext, target: RootContext, diff: ContextDiff): void {
  const baseIndex = buildLinkIndex(base)
  const targetIndex = buildLinkIndex(target)

  // Added
  for (const [id, link] of targetIndex) {
    if (!baseIndex.has(id)) {
      diff.links.push({
        entityType: 'link',
        id,
        changeType: 'added',
        entityName: link.label ?? `${link.predicate}`,
        targetValue: link,
      })
    }
  }

  // Removed
  for (const [id, link] of baseIndex) {
    if (!targetIndex.has(id)) {
      diff.links.push({
        entityType: 'link',
        id,
        changeType: 'removed',
        entityName: link.label ?? `${link.predicate}`,
        baseValue: link,
      })
    }
  }

  // Modified
  for (const [id, baseLink] of baseIndex) {
    const targetLink = targetIndex.get(id)
    if (!targetLink) continue

    const changed = diffFields(
      baseLink as unknown as Record<string, unknown>,
      targetLink as unknown as Record<string, unknown>,
      new Set(['id']), // exclude stable identity
    )

    if (changed.length > 0) {
      diff.links.push({
        entityType: 'link',
        id,
        changeType: 'modified',
        entityName: targetLink.label ?? `${targetLink.predicate}`,
        changedFields: changed,
        baseValue: baseLink,
        targetValue: targetLink,
      })
    }
  }
}

// ── Symbols (global by ID) ──────────────────────────────────────────────────

function diffSymbols(base: RootContext, target: RootContext, diff: ContextDiff): void {
  const baseIndex = collectAllSymbols(base)
  const targetIndex = collectAllSymbols(target)

  // Added
  for (const [id, entry] of targetIndex) {
    if (!baseIndex.has(id)) {
      diff.symbols.push({
        entityType: 'symbol',
        id,
        changeType: 'added',
        containerId: entry.containerId,
        entityName: entry.symbol.label ?? entry.symbol.content.slice(0, 60),
        targetValue: entry.symbol,
      })
    }
  }

  // Removed
  for (const [id, entry] of baseIndex) {
    if (!targetIndex.has(id)) {
      diff.symbols.push({
        entityType: 'symbol',
        id,
        changeType: 'removed',
        containerId: entry.containerId,
        entityName: entry.symbol.label ?? entry.symbol.content.slice(0, 60),
        baseValue: entry.symbol,
      })
    }
  }

  // Modified
  for (const [id, baseEntry] of baseIndex) {
    const targetEntry = targetIndex.get(id)
    if (!targetEntry) continue

    const changed: string[] = []

    // Check container move
    if (baseEntry.containerId !== targetEntry.containerId) changed.push('containerId')

    // Check symbol data fields
    const dataChanged = diffFields(
      baseEntry.symbol as unknown as Record<string, unknown>,
      targetEntry.symbol as unknown as Record<string, unknown>,
      new Set(['id']), // exclude stable identity
    )
    changed.push(...dataChanged)

    if (changed.length > 0) {
      diff.symbols.push({
        entityType: 'symbol',
        id,
        changeType: 'modified',
        containerId: targetEntry.containerId,
        entityName: targetEntry.symbol.label ?? targetEntry.symbol.content.slice(0, 60),
        changedFields: changed,
        baseValue: baseEntry.symbol,
        targetValue: targetEntry.symbol,
      })
    }
  }
}

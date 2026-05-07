import { klona } from 'klona'
import { nanoid } from 'nanoid'
import type { RootContext, Facet, Link, Symbol } from '../types/context'
import type {
  MergeOptions,
  MergeResult,
  MergeConflict,
  EntityChange,
  ContextDiff,
  ConflictSide,
  DiffEntityType,
} from '../types/branch'
import { diffRootContexts, collectAllFacets, collectAllSymbols } from './diff'
import { getRegisteredFacetKeys } from '../dsl/engineBridge'

// ── Three-way merge ─────────────────────────────────────────────────────────

/**
 * Perform a three-way merge of two divergent RootContext states.
 *
 * Pure function - does not mutate any input.`,
 * which callers invoke separately when they need it (branch merge does;
 * sync merge does not - layouts are view-state, not sync state).
 *
 * Algorithm:
 * 1. Diff base→ours and base→theirs
 * 2. Start with a deep clone of ours
 * 3. Apply theirs' non-conflicting changes
 * 4. Flag conflicts for manual resolution
 * 5. Post-merge: prune dangling links
 */
export function threeWayMerge(options: MergeOptions): MergeResult {
  const { base, ours, theirs } = options

  const oursDiff = diffRootContexts(base, ours)
  const theirsDiff = diffRootContexts(base, theirs)

  // Start with a deep clone of ours - ours is the default
  const merged = klona(ours)
  const conflicts: MergeConflict[] = []
  const autoMerged: EntityChange[] = []

  // Build lookup maps from ours diff for fast conflict detection
  const oursChangesById = buildChangeIndex(oursDiff)

  // Process each category of theirs' changes
  processRootProps(theirsDiff.rootProps, oursChangesById, merged, base, theirs, conflicts, autoMerged)
  processContexts(theirsDiff.contexts, oursChangesById, merged, base, theirs, conflicts, autoMerged)
  processFacets(theirsDiff.facets, oursChangesById, merged, base, theirs, conflicts, autoMerged)
  processLinks(theirsDiff.links, oursChangesById, merged, base, theirs, conflicts, autoMerged)
  processSymbols(theirsDiff.symbols, oursChangesById, merged, base, theirs, conflicts, autoMerged)

  // Post-merge: prune dangling links
  pruneDanglingLinks(merged)

  // Update timestamp
  merged.meta = { ...merged.meta, updatedAt: new Date().toISOString() }

  return {
    success: conflicts.length === 0,
    mergedModel: merged,
    conflicts,
    autoMerged,
  }
}

// ── Resolution application ──────────────────────────────────────────────────

/**
 * Apply user-chosen resolutions to a MergeResult.
 *
 * Returns a new MergeResult with resolved conflicts applied.
 * If all conflicts are resolved, success becomes true.
 */
export function applyResolutions(
  result: MergeResult,
  resolutions: Record<string, ConflictSide>,
): MergeResult {
  const merged = klona(result.mergedModel)
  const remaining: MergeConflict[] = []
  const newAutoMerged = [...result.autoMerged]

  for (const conflict of result.conflicts) {
    const side = resolutions[conflict.id] ?? conflict.resolution
    if (!side) {
      remaining.push(conflict)
      continue
    }

    if (side === 'theirs') {
      applyTheirsResolution(merged, conflict)
    }
    // 'ours' → merged already has ours' version (it started from ours)

    newAutoMerged.push(side === 'ours' ? conflict.oursChange : conflict.theirsChange)
  }

  // Re-prune after resolutions (deletions may create new danglers)
  pruneDanglingLinks(merged)

  return {
    success: remaining.length === 0,
    mergedModel: merged,
    conflicts: remaining,
    autoMerged: newAutoMerged,
  }
}

// ── Internal: change index ──────────────────────────────────────────────────

/** Key: `{entityType}:{entityId}` */
function changeKey(entityType: DiffEntityType, id: string): string {
  return `${entityType}:${id}`
}

function buildChangeIndex(diff: ContextDiff): Map<string, EntityChange> {
  const map = new Map<string, EntityChange>()
  for (const changes of [diff.rootProps, diff.contexts, diff.facets, diff.links, diff.symbols]) {
    for (const change of changes) {
      map.set(changeKey(change.entityType, change.id), change)
    }
  }
  return map
}

// ── Internal: merge processors ──────────────────────────────────────────────

function processRootProps(
  theirsChanges: EntityChange[],
  oursIndex: Map<string, EntityChange>,
  merged: RootContext,
  _base: RootContext,
  theirs: RootContext,
  conflicts: MergeConflict[],
  autoMerged: EntityChange[],
): void {
  for (const theirChange of theirsChanges) {
    const oursChange = oursIndex.get(changeKey(theirChange.entityType, theirChange.id))

    if (!oursChange) {
      // Only theirs changed root props - apply theirs
      if (theirChange.changedFields?.includes('name')) merged.name = theirs.name
      if (theirChange.changedFields?.includes('description')) merged.description = theirs.description
      autoMerged.push(theirChange)
      continue
    }

    // Both modified root props - check field overlap
    const oursFields = new Set(oursChange.changedFields ?? [])
    const theirsFields = theirChange.changedFields ?? []

    let hasConflict = false
    for (const field of theirsFields) {
      if (oursFields.has(field)) {
        // Both changed same field - check if to same value
        if (JSON.stringify((merged as any)[field]) !== JSON.stringify((theirs as any)[field])) {
          hasConflict = true
          break
        }
      }
    }

    if (hasConflict) {
      conflicts.push(makeConflict('root-props', merged.uri, merged.name, oursChange, theirChange))
    } else {
      // Disjoint or same-value - apply theirs' unique fields
      for (const field of theirsFields) {
        if (!oursFields.has(field)) {
          ;(merged as any)[field] = (theirs as any)[field]
        }
      }
      autoMerged.push(theirChange)
    }
  }
}

function processContexts(
  theirsChanges: EntityChange[],
  oursIndex: Map<string, EntityChange>,
  merged: RootContext,
  _base: RootContext,
  theirs: RootContext,
  conflicts: MergeConflict[],
  autoMerged: EntityChange[],
): void {
  for (const theirChange of theirsChanges) {
    const oursChange = oursIndex.get(changeKey('context', theirChange.id))

    if (!oursChange) {
      // Only theirs changed this context
      applyContextChange(merged, theirs, theirChange)
      autoMerged.push(theirChange)
      continue
    }

    // Both changed same context - classify conflict
    if (oursChange.changeType === 'removed' && theirChange.changeType === 'removed') {
      // Both deleted - no conflict (already removed in merged since it started from ours)
      autoMerged.push(theirChange)
      continue
    }

    if (oursChange.changeType === 'removed' || theirChange.changeType === 'removed') {
      // One deleted, other modified or added - conflict
      conflicts.push(makeConflict('context', theirChange.id, theirChange.entityName ?? theirChange.id, oursChange, theirChange))
      continue
    }

    if (oursChange.changeType === 'modified' && theirChange.changeType === 'modified') {
      // Both modified - field-level check
      const resolved = tryFieldMerge(merged.contexts[theirChange.id], theirs.contexts[theirChange.id], oursChange, theirChange)
      if (resolved) {
        autoMerged.push(theirChange)
      } else {
        conflicts.push(makeConflict('context', theirChange.id, theirChange.entityName ?? theirChange.id, oursChange, theirChange))
      }
      continue
    }

    // Both added (same ID - rare with nanoid, but possible when both clone the same state)
    if (oursChange.changeType === 'added' && theirChange.changeType === 'added') {
      // Check if they added identical content - convergent, not conflicting
      if (JSON.stringify(oursChange.targetValue) === JSON.stringify(theirChange.targetValue)) {
        autoMerged.push(theirChange)
      } else {
        conflicts.push(makeConflict('context', theirChange.id, theirChange.entityName ?? theirChange.id, oursChange, theirChange))
      }
    }
  }
}

function processFacets(
  theirsChanges: EntityChange[],
  oursIndex: Map<string, EntityChange>,
  merged: RootContext,
  _base: RootContext,
  theirs: RootContext,
  conflicts: MergeConflict[],
  autoMerged: EntityChange[],
): void {
  for (const theirChange of theirsChanges) {
    const oursChange = oursIndex.get(changeKey('facet', theirChange.id))

    if (!oursChange) {
      applyFacetChange(merged, theirs, theirChange)
      autoMerged.push(theirChange)
      continue
    }

    if (oursChange.changeType === 'removed' && theirChange.changeType === 'removed') {
      autoMerged.push(theirChange)
      continue
    }

    if (oursChange.changeType === 'removed' || theirChange.changeType === 'removed') {
      conflicts.push(makeConflict('facet', theirChange.id, theirChange.entityName ?? theirChange.id, oursChange, theirChange))
      continue
    }

    if (oursChange.changeType === 'modified' && theirChange.changeType === 'modified') {
      const oursFields = new Set(oursChange.changedFields ?? [])
      const theirsFields = theirChange.changedFields ?? []

      let hasConflict = false
      for (const field of theirsFields) {
        if (oursFields.has(field)) {
          // Both changed the same field - check value equality
          const oursVal = getNestedField(merged, 'facet', theirChange.id, field)
          const theirsVal = getNestedField(theirs, 'facet', theirChange.id, field)
          if (JSON.stringify(oursVal) !== JSON.stringify(theirsVal)) {
            hasConflict = true
            break
          }
        }
      }

      if (hasConflict) {
        conflicts.push(makeConflict('facet', theirChange.id, theirChange.entityName ?? theirChange.id, oursChange, theirChange))
      } else {
        // Apply theirs' non-overlapping field changes
        applyFacetFieldMerge(merged, theirs, theirChange, oursFields)
        autoMerged.push(theirChange)
      }
      continue
    }

    if (oursChange.changeType === 'added' && theirChange.changeType === 'added') {
      if (JSON.stringify(oursChange.targetValue) === JSON.stringify(theirChange.targetValue)) {
        autoMerged.push(theirChange)
      } else {
        conflicts.push(makeConflict('facet', theirChange.id, theirChange.entityName ?? theirChange.id, oursChange, theirChange))
      }
    }
  }
}

function processLinks(
  theirsChanges: EntityChange[],
  oursIndex: Map<string, EntityChange>,
  merged: RootContext,
  _base: RootContext,
  theirs: RootContext,
  conflicts: MergeConflict[],
  autoMerged: EntityChange[],
): void {
  for (const theirChange of theirsChanges) {
    const oursChange = oursIndex.get(changeKey('link', theirChange.id))

    if (!oursChange) {
      applyLinkChange(merged, theirs, theirChange)
      autoMerged.push(theirChange)
      continue
    }

    if (oursChange.changeType === 'removed' && theirChange.changeType === 'removed') {
      autoMerged.push(theirChange)
      continue
    }

    if (oursChange.changeType === 'removed' || theirChange.changeType === 'removed') {
      conflicts.push(makeConflict('link', theirChange.id, theirChange.entityName ?? theirChange.id, oursChange, theirChange))
      continue
    }

    if (oursChange.changeType === 'modified' && theirChange.changeType === 'modified') {
      const oursFields = new Set(oursChange.changedFields ?? [])
      const theirsFields = theirChange.changedFields ?? []

      let hasConflict = false
      for (const field of theirsFields) {
        if (oursFields.has(field)) {
          const oursLink = merged.links.find(l => l.uri === theirChange.id)
          const theirsLink = theirs.links.find(l => l.uri === theirChange.id)
          if (oursLink && theirsLink && JSON.stringify((oursLink as any)[field]) !== JSON.stringify((theirsLink as any)[field])) {
            hasConflict = true
            break
          }
        }
      }

      if (hasConflict) {
        conflicts.push(makeConflict('link', theirChange.id, theirChange.entityName ?? theirChange.id, oursChange, theirChange))
      } else {
        applyLinkFieldMerge(merged, theirs, theirChange, oursFields)
        autoMerged.push(theirChange)
      }
      continue
    }

    if (oursChange.changeType === 'added' && theirChange.changeType === 'added') {
      if (JSON.stringify(oursChange.targetValue) === JSON.stringify(theirChange.targetValue)) {
        autoMerged.push(theirChange)
      } else {
        conflicts.push(makeConflict('link', theirChange.id, theirChange.entityName ?? theirChange.id, oursChange, theirChange))
      }
    }
  }
}

function processSymbols(
  theirsChanges: EntityChange[],
  oursIndex: Map<string, EntityChange>,
  merged: RootContext,
  _base: RootContext,
  theirs: RootContext,
  conflicts: MergeConflict[],
  autoMerged: EntityChange[],
): void {
  for (const theirChange of theirsChanges) {
    const oursChange = oursIndex.get(changeKey('symbol', theirChange.id))

    if (!oursChange) {
      applySymbolChange(merged, theirs, theirChange)
      autoMerged.push(theirChange)
      continue
    }

    if (oursChange.changeType === 'removed' && theirChange.changeType === 'removed') {
      autoMerged.push(theirChange)
      continue
    }

    if (oursChange.changeType === 'removed' || theirChange.changeType === 'removed') {
      conflicts.push(makeConflict('symbol', theirChange.id, theirChange.entityName ?? theirChange.id, oursChange, theirChange))
      continue
    }

    if (oursChange.changeType === 'modified' && theirChange.changeType === 'modified') {
      const oursFields = new Set(oursChange.changedFields ?? [])
      const theirsFields = theirChange.changedFields ?? []

      let hasConflict = false
      for (const field of theirsFields) {
        if (oursFields.has(field)) {
          const oursSymbol = findSymbolGlobal(merged, theirChange.id)
          const theirsSymbol = findSymbolGlobal(theirs, theirChange.id)
          if (oursSymbol && theirsSymbol && JSON.stringify((oursSymbol as any)[field]) !== JSON.stringify((theirsSymbol as any)[field])) {
            hasConflict = true
            break
          }
        }
      }

      if (hasConflict) {
        conflicts.push(makeConflict('symbol', theirChange.id, theirChange.entityName ?? theirChange.id, oursChange, theirChange))
      } else {
        applySymbolFieldMerge(merged, theirs, theirChange, oursFields)
        autoMerged.push(theirChange)
      }
      continue
    }

    if (oursChange.changeType === 'added' && theirChange.changeType === 'added') {
      if (JSON.stringify(oursChange.targetValue) === JSON.stringify(theirChange.targetValue)) {
        autoMerged.push(theirChange)
      } else {
        conflicts.push(makeConflict('symbol', theirChange.id, theirChange.entityName ?? theirChange.id, oursChange, theirChange))
      }
    }
  }
}

// ── Internal: apply changes to merged state ─────────────────────────────────

function applyContextChange(merged: RootContext, theirs: RootContext, change: EntityChange): void {
  if (change.changeType === 'added') {
    const ctx = theirs.contexts[change.id]
    if (ctx) merged.contexts[change.id] = klona(ctx)
  } else if (change.changeType === 'removed') {
    delete merged.contexts[change.id]
  } else if (change.changeType === 'modified') {
    const theirsCtx = theirs.contexts[change.id]
    if (theirsCtx) merged.contexts[change.id] = klona(theirsCtx)
  }
}

/**
 * Push a facet onto its container's correct array.
 *
 * Standard facet types live under `container.facets[ft]`. Custom types
 * (canvasNode/canvasEdge/user-defined) live under `container.customFacets[type]`,
 * which is created lazily on first write. Without this branch, merge would
 * silently lose canvasNode position changes during sync conflicts.
 */
function pushFacetToContainer(
  container: RootContext | NonNullable<RootContext['contexts'][string]>,
  facetType: string,
  isCustom: boolean,
  facet: Facet,
): void {
  if (isCustom) {
    const c = container as { customFacets?: Record<string, Facet[]> }
    if (!c.customFacets) c.customFacets = {}
    if (!c.customFacets[facetType]) c.customFacets[facetType] = []
    c.customFacets[facetType]!.push(facet)
  } else {
    ;(container.facets[facetType as keyof typeof container.facets] as Facet[]).push(facet)
  }
}

function applyFacetChange(merged: RootContext, theirs: RootContext, change: EntityChange): void {
  if (change.changeType === 'added') {
    // Guard: facet may already exist if its parent context was added as a unit
    const existingIndex = collectAllFacets(merged)
    if (existingIndex.has(change.id)) return

    const theirsIndex = collectAllFacets(theirs)
    const entry = theirsIndex.get(change.id)
    if (!entry) return
    const container = change.containerId === merged.uri ? merged : merged.contexts[change.containerId!]
    if (container) {
      pushFacetToContainer(container, entry.facetType, entry.isCustom, klona(entry.facet))
    }
  } else if (change.changeType === 'removed') {
    removeFacetGlobal(merged, change.id)
  } else if (change.changeType === 'modified') {
    // Replace the facet entirely with theirs' version in theirs' container
    removeFacetGlobal(merged, change.id)
    const theirsIndex = collectAllFacets(theirs)
    const entry = theirsIndex.get(change.id)
    if (!entry) return
    const container = entry.containerId === merged.uri ? merged : merged.contexts[entry.containerId]
    if (container) {
      pushFacetToContainer(container, entry.facetType, entry.isCustom, klona(entry.facet))
    }
  }
}

function applyFacetFieldMerge(
  merged: RootContext,
  theirs: RootContext,
  theirChange: EntityChange,
  oursFields: Set<string>,
): void {
  const theirsIndex = collectAllFacets(theirs)
  const theirsEntry = theirsIndex.get(theirChange.id)
  if (!theirsEntry) return

  const mergedIndex = collectAllFacets(merged)
  const mergedEntry = mergedIndex.get(theirChange.id)
  if (!mergedEntry) return

  // Apply theirs' non-overlapping data fields
  for (const field of (theirChange.changedFields ?? [])) {
    if (oursFields.has(field)) continue // skip overlapping (same value, already verified)
    if (field === 'containerId') {
      // Move facet to theirs' container
      removeFacetGlobal(merged, theirChange.id)
      const container = theirsEntry.containerId === merged.uri ? merged : merged.contexts[theirsEntry.containerId]
      if (container) {
        pushFacetToContainer(container, mergedEntry.facetType, mergedEntry.isCustom, klona(mergedEntry.facet))
      }
    } else if (field === 'facetType') {
      // Type change - skip for now (complex, rarely non-conflicting)
    } else {
      ;(mergedEntry.facet as any)[field] = klona((theirsEntry.facet as any)[field])
    }
  }
}

function applyLinkChange(merged: RootContext, theirs: RootContext, change: EntityChange): void {
  if (change.changeType === 'added') {
    const link = theirs.links.find(l => l.uri === change.id)
    if (link) merged.links.push(klona(link))
  } else if (change.changeType === 'removed') {
    merged.links = merged.links.filter(l => l.uri !== change.id)
  } else if (change.changeType === 'modified') {
    const theirsLink = theirs.links.find(l => l.uri === change.id)
    if (theirsLink) {
      const idx = merged.links.findIndex(l => l.uri === change.id)
      if (idx !== -1) merged.links[idx] = klona(theirsLink)
    }
  }
}

function applyLinkFieldMerge(
  merged: RootContext,
  theirs: RootContext,
  theirChange: EntityChange,
  oursFields: Set<string>,
): void {
  const mergedLink = merged.links.find(l => l.uri === theirChange.id)
  const theirsLink = theirs.links.find(l => l.uri === theirChange.id)
  if (!mergedLink || !theirsLink) return

  for (const field of (theirChange.changedFields ?? [])) {
    if (oursFields.has(field)) continue
    ;(mergedLink as any)[field] = klona((theirsLink as any)[field])
  }
}

function applySymbolChange(merged: RootContext, theirs: RootContext, change: EntityChange): void {
  if (change.changeType === 'added') {
    // Guard: symbol may already exist if its parent context was added as a unit
    if (findSymbolGlobal(merged, change.id)) return

    const theirsIndex = collectAllSymbols(theirs)
    const entry = theirsIndex.get(change.id)
    if (!entry) return
    const container = entry.containerId === merged.uri ? merged : merged.contexts[entry.containerId]
    if (container) container.symbols.push(klona(entry.symbol))
  } else if (change.changeType === 'removed') {
    removeSymbolGlobal(merged, change.id)
  } else if (change.changeType === 'modified') {
    removeSymbolGlobal(merged, change.id)
    const theirsIndex = collectAllSymbols(theirs)
    const entry = theirsIndex.get(change.id)
    if (!entry) return
    const container = entry.containerId === merged.uri ? merged : merged.contexts[entry.containerId]
    if (container) container.symbols.push(klona(entry.symbol))
  }
}

function applySymbolFieldMerge(
  merged: RootContext,
  theirs: RootContext,
  theirChange: EntityChange,
  oursFields: Set<string>,
): void {
  const mergedSymbol = findSymbolGlobal(merged, theirChange.id)
  const theirsSymbol = findSymbolGlobal(theirs, theirChange.id)
  if (!mergedSymbol || !theirsSymbol) return

  for (const field of (theirChange.changedFields ?? [])) {
    if (oursFields.has(field)) continue
    if (field === 'containerId') {
      // Move symbol to theirs' container
      const theirsIndex = collectAllSymbols(theirs)
      const entry = theirsIndex.get(theirChange.id)
      if (!entry) continue
      removeSymbolGlobal(merged, theirChange.id)
      const container = entry.containerId === merged.uri ? merged : merged.contexts[entry.containerId]
      if (container) container.symbols.push(klona(mergedSymbol))
    } else {
      ;(mergedSymbol as any)[field] = klona((theirsSymbol as any)[field])
    }
  }
}


// ── Internal: apply theirs' resolution ──────────────────────────────────────

function applyTheirsResolution(merged: RootContext, conflict: MergeConflict): void {
  const change = conflict.theirsChange

  switch (conflict.entityType) {
    case 'root-props': {
      if (change.changeType === 'modified' && change.targetValue) {
        const tv = change.targetValue as Record<string, unknown>
        if (tv.name !== undefined) merged.name = tv.name as string
        if (tv.description !== undefined) merged.description = tv.description as string
      }
      break
    }
    case 'context': {
      if (change.changeType === 'removed') {
        delete merged.contexts[conflict.entityId]
      } else if (change.changeType === 'modified' || change.changeType === 'added') {
        if (change.targetValue) {
          merged.contexts[conflict.entityId] = klona(change.targetValue) as any
        }
      }
      break
    }
    case 'facet': {
      removeFacetGlobal(merged, conflict.entityId)
      if (change.changeType !== 'removed' && change.targetValue) {
        const containerId = change.containerId ?? merged.uri
        const container = containerId === merged.uri ? merged : merged.contexts[containerId]
        const ft = change.facetType
        if (container && ft) {
          ;(container.facets[ft] as Facet[]).push(klona(change.targetValue) as Facet)
        }
      }
      break
    }
    case 'link': {
      merged.links = merged.links.filter(l => l.uri !== conflict.entityId)
      if (change.changeType !== 'removed' && change.targetValue) {
        merged.links.push(klona(change.targetValue) as Link)
      }
      break
    }
    case 'symbol': {
      removeSymbolGlobal(merged, conflict.entityId)
      if (change.changeType !== 'removed' && change.targetValue) {
        const containerId = change.containerId ?? merged.uri
        const container = containerId === merged.uri ? merged : merged.contexts[containerId]
        if (container) container.symbols.push(klona(change.targetValue) as Symbol)
      }
      break
    }
  }
}

// ── Internal: field merge helper ────────────────────────────────────────────

/** Try field-level merge for two modified-modified contexts. Returns true if no conflict. */
function tryFieldMerge(
  mergedCtx: any,
  theirsCtx: any,
  oursChange: EntityChange,
  theirsChange: EntityChange,
): boolean {
  if (!mergedCtx || !theirsCtx) return false

  const oursFields = new Set(oursChange.changedFields ?? [])
  const theirsFields = theirsChange.changedFields ?? []

  // Check for overlapping fields with different values
  for (const field of theirsFields) {
    if (oursFields.has(field)) {
      if (JSON.stringify(mergedCtx[field]) !== JSON.stringify(theirsCtx[field])) {
        return false // conflict
      }
    }
  }

  // Apply theirs' non-overlapping fields
  for (const field of theirsFields) {
    if (!oursFields.has(field)) {
      mergedCtx[field] = klona(theirsCtx[field])
    }
  }

  return true
}

// ── Internal: global entity helpers ─────────────────────────────────────────

function removeFacetGlobal(root: RootContext, facetUri: string): void {
  for (const ft of getRegisteredFacetKeys()) {
    const idx = (root.facets[ft] as Facet[]).findIndex(f => f.uri === facetUri)
    if (idx !== -1) {
      ;(root.facets[ft] as Facet[]).splice(idx, 1)
      return
    }
    for (const ctx of Object.values(root.contexts)) {
      const cidx = (ctx.facets[ft] as Facet[]).findIndex(f => f.uri === facetUri)
      if (cidx !== -1) {
        ;(ctx.facets[ft] as Facet[]).splice(cidx, 1)
        return
      }
    }
  }
  // Custom facets — same scan pattern.
  for (const arr of Object.values(root.customFacets ?? {})) {
    const idx = arr.findIndex(f => f.uri === facetUri)
    if (idx !== -1) {
      arr.splice(idx, 1)
      return
    }
  }
  for (const ctx of Object.values(root.contexts)) {
    for (const arr of Object.values(ctx.customFacets ?? {})) {
      const idx = arr.findIndex(f => f.uri === facetUri)
      if (idx !== -1) {
        arr.splice(idx, 1)
        return
      }
    }
  }
}

function findSymbolGlobal(root: RootContext, symbolUri: string): Symbol | undefined {
  const found = root.symbols.find(s => s.uri === symbolUri)
  if (found) return found
  for (const ctx of Object.values(root.contexts)) {
    const found = ctx.symbols.find(s => s.uri === symbolUri)
    if (found) return found
  }
  return undefined
}

function removeSymbolGlobal(root: RootContext, symbolUri: string): void {
  const idx = root.symbols.findIndex(s => s.uri === symbolUri)
  if (idx !== -1) {
    root.symbols.splice(idx, 1)
    return
  }
  for (const ctx of Object.values(root.contexts)) {
    const cidx = ctx.symbols.findIndex(s => s.uri === symbolUri)
    if (cidx !== -1) {
      ctx.symbols.splice(cidx, 1)
      return
    }
  }
}

function getNestedField(root: RootContext, entityType: string, entityUri: string, field: string): unknown {
  if (entityType === 'facet') {
    const index = collectAllFacets(root)
    const entry = index.get(entityUri)
    if (!entry) return undefined
    if (field === 'containerId') return entry.containerId
    if (field === 'facetType') return entry.facetType
    return (entry.facet as any)[field]
  }
  return undefined
}

// ── Internal: dangling link pruning ─────────────────────────────────────────

/** Remove any links whose sourceId or targetId don't exist in the merged model. */
function pruneDanglingLinks(root: RootContext): void {
  const allIds = new Set<string>()

  // Collect all entity IDs
  allIds.add(root.uri)
  for (const ft of getRegisteredFacetKeys()) {
    for (const f of root.facets[ft] as Facet[]) allIds.add(f.uri)
  }
  for (const arr of Object.values(root.customFacets ?? {})) {
    for (const f of arr) allIds.add(f.uri)
  }
  for (const symbol of root.symbols) allIds.add(symbol.uri)

  for (const [id, ctx] of Object.entries(root.contexts)) {
    allIds.add(id)
    for (const ft of getRegisteredFacetKeys()) {
      for (const f of ctx.facets[ft] as Facet[]) allIds.add(f.uri)
    }
    for (const arr of Object.values(ctx.customFacets ?? {})) {
      for (const f of arr) allIds.add(f.uri)
    }
    for (const symbol of ctx.symbols) allIds.add(symbol.uri)
  }

  root.links = root.links.filter(l => allIds.has(l.sourceUri) && allIds.has(l.targetUri))
}

// Layout merge lives in the consumer layer. `threeWayMerge` above is
// model-only; branch merge callers invoke layout merge separately on
// their own layout state.

// ── Internal: conflict factory ──────────────────────────────────────────────

function makeConflict(
  entityType: DiffEntityType,
  entityId: string,
  entityName: string,
  oursChange: EntityChange,
  theirsChange: EntityChange,
): MergeConflict {
  return {
    id: nanoid(),
    entityType,
    entityId,
    entityName,
    oursChange,
    theirsChange,
    resolution: null,
  }
}

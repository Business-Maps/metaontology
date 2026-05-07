import type { RootContext } from './context'

// ── Diff types ──────────────────────────────────────────────────────────────

export type ChangeType = 'added' | 'removed' | 'modified'

export type DiffEntityType = 'root-props' | 'context' | 'facet' | 'link' | 'symbol'

export interface EntityChange {
  /** Which kind of entity */
  entityType: DiffEntityType
  /** The entity ID (for root-props, this is the root context id) */
  id: string
  /** What kind of change */
  changeType: ChangeType
  /** For facets and symbols: which container (root id or context id) they belong to */
  containerId?: string
  /** For facets: which facet type (string to support dynamic DSL-registered types) */
  facetType?: string
  /** Human-readable entity name (for display) */
  entityName?: string
  /** For 'modified': which top-level fields changed */
  changedFields?: readonly string[]
  /** The entity value in the base state. Undefined for 'added' */
  baseValue?: unknown
  /** The entity value in the target state. Undefined for 'removed' */
  targetValue?: unknown
}

/** The complete diff between two RootContext states */
export interface ContextDiff {
  /** Root-level property changes (name, description) */
  rootProps: EntityChange[]
  /** Context additions, removals, and modifications */
  contexts: EntityChange[]
  /** Facet changes (tracked globally by facet ID) */
  facets: EntityChange[]
  /** Link changes */
  links: EntityChange[]
  /** Symbol changes (tracked globally by symbol ID) */
  symbols: EntityChange[]
}

// ── Merge types ─────────────────────────────────────────────────────────────

export type ConflictSide = 'ours' | 'theirs'

export interface MergeConflict {
  /** Unique conflict id (nanoid) for UI tracking */
  id: string
  /** The entity type in conflict */
  entityType: DiffEntityType
  /** The entity ID in conflict */
  entityId: string
  /** Human-readable entity name for display */
  entityName: string
  /** What 'ours' (current branch / main) did relative to the base */
  oursChange: EntityChange
  /** What 'theirs' (incoming branch) did relative to the base */
  theirsChange: EntityChange
  /** The chosen resolution. Null until the user picks one. */
  resolution: ConflictSide | null
}

export interface MergeResult {
  /** True if the merge completed without unresolved conflicts */
  success: boolean
  /** The merged RootContext (partial if conflicts remain unresolved) */
  mergedModel: RootContext
  /** Conflicts that need resolution (empty if success is true) */
  conflicts: MergeConflict[]
  /** Informational: changes that were auto-merged without conflict */
  autoMerged: EntityChange[]
}

export interface MergeOptions {
  /** The common ancestor (fork point) */
  base: RootContext
  /** The current state (the branch you're merging INTO) */
  ours: RootContext
  /** The incoming state (the branch being merged) */
  theirs: RootContext
}

export type MergeStrategy = 'manual' | 'ours-wins' | 'theirs-wins'

// ── Branch manifest types ───────────────────────────────────────────────────

export interface BranchInfo {
  /** Stable branch identifier (nanoid). */
  id: string
  /** Human-readable name, e.g. "experiment-new-checkout" */
  name: string
  /** The root context ID this branch belongs to */
  mapId: string
  /** Branch this was forked from ('main' or another branch id) */
  parentBranchId: string
  /** ISO timestamp when the branch was created */
  createdAt: string
  /** Device nanoid (free tier) or user ID (authenticated). Identity-ready from day one. */
  createdBy?: string
}

/** Full branch state: metadata + model snapshots. */
export interface BranchState {
  info: BranchInfo
  /** Current branch head - the live model state */
  model: RootContext
  /** Model snapshot at the moment of fork (the merge base for three-way merge) */
  forkPointModel: RootContext
}

/**
 * The manifest stored per map, tracking all branches.
 *
 * Storage key: `businessmap:branches:{mapId}`
 *
 * The main document key (`businessmap:{mapId}`) always holds the ACTIVE
 * state - whether that's main or a branch. When a branch is active,
 * `mainSnapshot` preserves main's frozen state. When main is active,
 * `mainSnapshot` is undefined.
 */
export interface BranchManifest {
  /** The root context ID */
  mapId: string
  /** Currently active branch id, or 'main' */
  activeBranchId: string
  /** Main's frozen state - present ONLY when a non-main branch is active */
  mainSnapshot?: { model: RootContext }
  /** All branches (does NOT include main - main lives in the primary document) */
  branches: Record<string, BranchState>
}

/** True when the diff contains zero changes */
export function isEmptyDiff(diff: ContextDiff): boolean {
  return diff.rootProps.length === 0
    && diff.contexts.length === 0
    && diff.facets.length === 0
    && diff.links.length === 0
    && diff.symbols.length === 0
}

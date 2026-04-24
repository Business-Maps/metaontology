import type { DispatchableCommand } from './commands'
import type { RootContext } from './context'
import type { M0State } from './m0'

// ── Commit: the atomic unit of persistence ─────────────────────────────────
// Every dispatched command becomes a commit. The log is always append-only -
// undo appends a compensating (inverse) command, never rewinds.

export interface Commit {
  id: string
  mapId: string
  sequence: number                // monotonic per map+branch, for ordering
  command: DispatchableCommand
  inverse: DispatchableCommand    // compensating command for undo
  timestamp: string               // ISO 8601
  deviceId: string
  branchId: string                // 'main' or branch id
  parentId: string | null         // previous commit id (DAG lineage)
}

// ── Checkpoint: periodic materialized snapshot for fast replay ──────────────
// State is derived by replaying commits from the nearest checkpoint.
// Checkpoints are created every ~100 commits, on branch switch, and before unload.

export interface Checkpoint {
  id: string
  mapId: string
  commitId: string                // the commit this checkpoint represents
  sequence: number                // the sequence of that commit
  branchId: string
  model: RootContext
  m0?: M0State                    // M0 state - optional for backward compat with pre-M0 checkpoints
  timestamp: string
}

// ── Undo/redo session state ────────────────────────────────────────────────
// Tracks which commits can be undone/redone in the current editing session.
// Resets on page reload - the commit log persists, the undo stack does not.

export interface UndoEntry {
  commitId: string                 // the commit that was undone
  originalCommand: DispatchableCommand
  inverseCommand: DispatchableCommand
}

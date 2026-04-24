import { nanoid } from 'nanoid'
import type { Command, DispatchableCommand, BatchCommand } from '../types/commands'

/**
 * Normalize a command before dispatch so it is safe to replay.
 *
 * ## Why this exists
 *
 * Some command types (`context:add`, `symbol:add`, `link:add`) accept an
 * optional `id` in their payload; if the id is absent, `applyToDraft`
 * generates a fresh `nanoid()` inside the apply path. That is fine for a
 * single live dispatch, but it **violates the idempotent-replay contract**
 * the commit log depends on:
 *
 * ```
 *   Live session:     dispatch(symbol:add { content }) → model has symbol X
 *                     dispatch(layout:place { entityUri: X, ... })
 *                     dispatch(symbol:update { symbolId: X, changes: ... })
 *                     [commit log:  symbol:add, layout:place, symbol:update]
 *
 *   On reload:        replay(symbol:add)     → nanoid() generates Y ≠ X
 *                     replay(layout:place)   → orphan position for X
 *                     replay(symbol:update)  → validation fails: "X does not exist"
 * ```
 *
 * `normalizeCommand` closes the loop by injecting a stable `id` into the
 * command payload **before** the command is appended to the commit log.
 * Because the same normalized command is both applied live and persisted,
 * replay sees the explicit id and produces the same state every time.
 *
 * The layer is the right home for this because the commit log is the thing
 * that depends on replay stability. The canvas store calls it at the entry
 * point of `dispatch()`.
 *
 *
 */
export function normalizeCommand(cmd: DispatchableCommand): DispatchableCommand {
  if (cmd.type === 'batch') {
    const anyChanged = cmd.payload.commands.some(sub => needsNormalization(sub))
    if (!anyChanged) return cmd
    const normalizedSubs = cmd.payload.commands.map(sub => normalizeSubcommand(sub))
    const batch: BatchCommand = {
      type: 'batch',
      payload: { ...cmd.payload, commands: normalizedSubs },
    }
    return batch
  }
  return normalizeSubcommand(cmd as Command | BatchCommand['payload']['commands'][number])
}

function normalizeSubcommand<T extends BatchCommand['payload']['commands'][number]>(cmd: T): T {
  if (cmd.type === 'symbol:add') {
    if (cmd.payload.uri) return cmd
    return { ...cmd, payload: { ...cmd.payload, uri: nanoid() } } as T
  }
  if (cmd.type === 'context:add') {
    if (cmd.payload.uri) return cmd
    return { ...cmd, payload: { ...cmd.payload, uri: nanoid() } } as T
  }
  if (cmd.type === 'link:add') {
    if (cmd.payload.uri) return cmd
    return { ...cmd, payload: { ...cmd.payload, uri: nanoid() } } as T
  }
  return cmd
}

function needsNormalization(cmd: BatchCommand['payload']['commands'][number]): boolean {
  if (cmd.type === 'symbol:add' && !cmd.payload.uri) return true
  if (cmd.type === 'context:add' && !cmd.payload.uri) return true
  if (cmd.type === 'link:add' && !cmd.payload.uri) return true
  return false
}

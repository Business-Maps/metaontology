/**
 * Tests for `normalizeCommand` - command id injection before dispatch.
 *
 * The bug this guards against: `symbol:add`, `context:add`, and `link:add`
 * accept an optional `id` in their payload. When absent, `applyToDraft`
 * generates a fresh `nanoid()` inside the apply path, which breaks
 * idempotent replay - every reload generates a *different* id for the same
 * stored command, orphaning subsequent layout / update commands that
 * reference the original id.
 *
 *
 */

import { describe, it, expect } from 'vitest'
import { normalizeCommand } from '../normalize'
import { applyCommand, createEmptyRootContext } from '../apply'
import type { Command, BatchCommand, DispatchableCommand } from '../../types/commands'

describe('normalizeCommand - id injection', () => {
  it('injects an id into symbol:add when missing', () => {
    const cmd: DispatchableCommand = {
      type: 'symbol:add',
      payload: { content: 'hello', contextUri: 'ctx-1' },
    }
    const normalized = normalizeCommand(cmd)
    expect(normalized.type).toBe('symbol:add')
    if (normalized.type !== 'symbol:add') throw new Error('type narrowing')
    expect(normalized.payload.uri).toBeTypeOf('string')
    expect(normalized.payload.uri!.length).toBeGreaterThan(0)
    expect(normalized.payload.content).toBe('hello')
    expect(normalized.payload.contextUri).toBe('ctx-1')
  })

  it('preserves an explicit id on symbol:add', () => {
    const cmd: DispatchableCommand = {
      type: 'symbol:add',
      payload: { uri: 'fixed-sym-id', content: 'hello' },
    }
    const normalized = normalizeCommand(cmd)
    if (normalized.type !== 'symbol:add') throw new Error('type narrowing')
    expect(normalized.payload.uri).toBe('fixed-sym-id')
  })

  it('injects an id into context:add when missing', () => {
    const cmd: DispatchableCommand = {
      type: 'context:add',
      payload: { name: 'Orders', parentUri: 'root-id' },
    }
    const normalized = normalizeCommand(cmd)
    if (normalized.type !== 'context:add') throw new Error('type narrowing')
    expect(normalized.payload.uri).toBeTypeOf('string')
    expect(normalized.payload.uri!.length).toBeGreaterThan(0)
  })

  it('injects an id into link:add when missing', () => {
    const cmd: DispatchableCommand = {
      type: 'link:add',
      payload: { predicate: 'uses', sourceUri: 'a', targetUri: 'b' },
    }
    const normalized = normalizeCommand(cmd)
    if (normalized.type !== 'link:add') throw new Error('type narrowing')
    expect(normalized.payload.uri).toBeTypeOf('string')
  })

  it('does not mutate the original command object', () => {
    const cmd: DispatchableCommand = {
      type: 'symbol:add',
      payload: { content: 'hello' },
    }
    const normalized = normalizeCommand(cmd)
    if (cmd.type !== 'symbol:add') throw new Error('type narrowing')
    expect(cmd.payload.uri).toBeUndefined()
    expect(normalized).not.toBe(cmd)
  })

  it('passes other command types through unchanged', () => {
    const cmd: DispatchableCommand = {
      type: 'symbol:update',
      payload: { symbolUri: 'x', changes: { content: 'hi' } },
    }
    const normalized = normalizeCommand(cmd)
    expect(normalized).toBe(cmd)
  })

  it('recurses into batch commands', () => {
    const batch: DispatchableCommand = {
      type: 'batch',
      payload: {
        label: 'mixed',
        commands: [
          { type: 'symbol:add', payload: { content: 'A' } },
          { type: 'symbol:update', payload: { symbolUri: 'existing', changes: { content: 'B' } } },
          { type: 'link:add', payload: { predicate: 'uses', sourceUri: 's', targetUri: 't' } },
        ],
      },
    }
    const normalized = normalizeCommand(batch) as BatchCommand
    expect(normalized.type).toBe('batch')
    const subs = normalized.payload.commands
    expect(subs).toHaveLength(3)

    const added = subs[0]!
    if (added.type !== 'symbol:add') throw new Error('expected symbol:add')
    expect(added.payload.uri).toBeTypeOf('string')

    // Middle command is unchanged.
    expect(subs[1]).toEqual({
      type: 'symbol:update',
      payload: { symbolUri: 'existing', changes: { content: 'B' } },
    })

    const link = subs[2]!
    if (link.type !== 'link:add') throw new Error('expected link:add')
    expect(link.payload.uri).toBeTypeOf('string')
  })

  it('returns the same batch reference if no subcommand needs normalization', () => {
    const batch: DispatchableCommand = {
      type: 'batch',
      payload: {
        label: 'no-op',
        commands: [
          { type: 'symbol:update', payload: { symbolUri: 'x', changes: {} } },
          { type: 'layout:place', payload: { entityId: 'x', position: { x: 0, y: 0 } } },
        ],
      },
    }
    const normalized = normalizeCommand(batch)
    expect(normalized).toBe(batch)
  })
})

describe('normalizeCommand - replay idempotency (the real regression)', () => {
  it('produces the same symbol id on repeated apply of a normalized command', () => {
    // Simulates the canvas store's dispatch path: normalize once, then apply
    // repeatedly. The commit log stores the normalized command, so every
    // reload replays the same command and produces the same id.
    const cmd: DispatchableCommand = {
      type: 'symbol:add',
      payload: { content: 'Checkout' },
    }
    const normalized = normalizeCommand(cmd) as Command

    const r1 = createEmptyRootContext('Test')
    const s1 = applyCommand(r1, normalized)
    expect(s1.success).toBe(true)
    const id1 = s1.state.symbols[0]!.uri

    const r2 = createEmptyRootContext('Test')
    const s2 = applyCommand(r2, normalized)
    expect(s2.success).toBe(true)
    const id2 = s2.state.symbols[0]!.uri

    expect(id1).toBe(id2)
  })

  it('symbol:update after symbol:add round-trips through replay', () => {
    // This is the exact shape of the manual-smoke bug: create a symbol,
    // then update its content. Two commands, persisted and replayed.
    // After replay, the symbol must still exist with the updated content.
    const add: DispatchableCommand = normalizeCommand({
      type: 'symbol:add',
      payload: { content: '' },
    })
    if (add.type !== 'symbol:add') throw new Error('narrowing')
    const symbolId = add.payload.uri!

    const update: Command = {
      type: 'symbol:update',
      payload: { symbolUri: symbolId, changes: { content: 'typed by user' } },
    }

    // Replay twice, simulating two load-from-IDB cycles.
    for (let cycle = 0; cycle < 2; cycle++) {
      let root = createEmptyRootContext('Replay Test')
      const r1 = applyCommand(root, add as Command)
      expect(r1.success).toBe(true)
      root = r1.state

      const r2 = applyCommand(root, update)
      expect(r2.success).toBe(true)
      // No validation failure - the symbol exists.
      expect(r2.error).toBeUndefined()
      root = r2.state

      expect(root.symbols).toHaveLength(1)
      expect(root.symbols[0]!.uri).toBe(symbolId)
      expect(root.symbols[0]!.content).toBe('typed by user')
    }
  })
})

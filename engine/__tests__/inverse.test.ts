import { describe, it, expect } from 'vitest'
import { applyCommand, applyBatch, createEmptyRootContext, createDefaultFacet } from '../apply'
import { computeInverse } from '../inverse'
import type { RootContext } from '../../types/context'
import type { Command, BatchCommand, DispatchableCommand } from '../../types/commands'

function makeRoot(name = 'Test'): RootContext {
  return createEmptyRootContext(name)
}

/** Apply a command successfully, returning the new state. */
function apply(root: RootContext, cmd: Command): RootContext {
  const result = applyCommand(root, cmd)
  expect(result.success).toBe(true)
  return result.state
}

/** Apply a command, compute its inverse, apply the inverse, and verify the state matches the original. */
function roundTrip(root: RootContext, cmd: Command): void {
  const after = apply(root, cmd)
  const inverse = computeInverse(cmd, root, after)

  // Apply the inverse
  let restored: RootContext
  if (inverse.type === 'batch') {
    const batch = inverse as BatchCommand
    const cmds = batch.payload.commands
    if (cmds.length === 1) {
      restored = apply(after, cmds[0] as Command)
    } else if (cmds.length > 1) {
      const result = applyBatch(after, { type: 'batch', payload: { commands: cmds } })
      expect(result.success).toBe(true)
      restored = result.state
    } else {
      restored = after
    }
  } else {
    restored = apply(after, inverse as Command)
  }

  return restored as unknown as void
}

describe('computeInverse', () => {
  describe('context commands', () => {
    it('inverts context:add → context:remove', () => {
      const root = makeRoot()
      const cmd: Command = { type: 'context:add', payload: { name: 'Payments', parentUri: root.uri } }
      const after = apply(root, cmd)
      const inverse = computeInverse(cmd, root, after)

      expect(inverse.type).toBe('context:remove')
      const newCtxId = Object.keys(after.contexts)[0]!
      expect((inverse as any).payload.contextUri).toBe(newCtxId)
    })

    it('inverts context:remove → restores context with original ID', () => {
      const root = makeRoot()
      const s1 = apply(root, { type: 'context:add', payload: { name: 'Payments', parentUri: root.uri } })
      const ctxId = Object.keys(s1.contexts)[0]!

      const cmd: Command = { type: 'context:remove', payload: { contextUri: ctxId } }
      const after = apply(s1, cmd)
      const inverse = computeInverse(cmd, s1, after)

      // The inverse should restore the context
      let restored: RootContext
      if (inverse.type === 'batch') {
        const result = applyBatch(after, inverse as BatchCommand)
        expect(result.success).toBe(true)
        restored = result.state
      } else {
        restored = apply(after, inverse as Command)
      }

      expect(Object.keys(restored.contexts)).toHaveLength(1)
      // The context should have the original ID (ID-preserving add)
      expect(restored.contexts[ctxId]).toBeDefined()
      expect(restored.contexts[ctxId]!.name).toBe('Payments')
    })

    it('inverts context:rename', () => {
      const root = makeRoot()
      const s1 = apply(root, { type: 'context:add', payload: { name: 'Orders', parentUri: root.uri } })
      const ctxId = Object.keys(s1.contexts)[0]!

      const cmd: Command = { type: 'context:rename', payload: { contextUri: ctxId, name: 'Checkout' } }
      const after = apply(s1, cmd)
      const inverse = computeInverse(cmd, s1, after)

      const restored = apply(after, inverse as Command)
      expect(restored.contexts[ctxId]!.name).toBe('Orders')
    })

    it('inverts context:update', () => {
      const root = makeRoot()
      const s1 = apply(root, { type: 'context:add', payload: { name: 'Auth', parentUri: root.uri } })
      const ctxId = Object.keys(s1.contexts)[0]!
      const s2 = apply(s1, { type: 'context:update', payload: { contextUri: ctxId, description: 'Original desc' } })

      const cmd: Command = { type: 'context:update', payload: { contextUri: ctxId, description: 'Updated desc' } }
      const after = apply(s2, cmd)
      const inverse = computeInverse(cmd, s2, after)

      const restored = apply(after, inverse as Command)
      expect(restored.contexts[ctxId]!.description).toBe('Original desc')
    })
  })

  describe('facet commands', () => {
    it('inverts facet:add → facet:remove', () => {
      const root = makeRoot()
      const facet = createDefaultFacet('things', 'User')
      const cmd: Command = { type: 'facet:add', payload: { contextUri: root.uri, facetType: 'things', facet } }
      const after = apply(root, cmd)
      const inverse = computeInverse(cmd, root, after)

      expect(inverse.type).toBe('facet:remove')
      expect((inverse as any).payload.facetUri).toBe(facet.uri)
    })

    it('inverts facet:update', () => {
      const root = makeRoot()
      const facet = createDefaultFacet('things', 'User')
      const s1 = apply(root, { type: 'facet:add', payload: { contextUri: root.uri, facetType: 'things', facet } })

      const cmd: Command = {
        type: 'facet:update',
        payload: { contextUri: root.uri, facetType: 'things', facetUri: facet.uri, changes: { name: 'Customer' } },
      }
      const after = apply(s1, cmd)
      const inverse = computeInverse(cmd, s1, after)

      const restored = apply(after, inverse as Command)
      expect(restored.facets.things[0]!.name).toBe('User')
    })

    it('inverts facet:remove → restores facet with full state', () => {
      const root = makeRoot()
      const facet = createDefaultFacet('things', 'Product')
      const s1 = apply(root, { type: 'facet:add', payload: { contextUri: root.uri, facetType: 'things', facet } })

      const cmd: Command = { type: 'facet:remove', payload: { contextUri: root.uri, facetType: 'things', facetUri: facet.uri } }
      const after = apply(s1, cmd)
      const inverse = computeInverse(cmd, s1, after)

      let restored: RootContext
      if (inverse.type === 'batch') {
        const result = applyBatch(after, inverse as BatchCommand)
        expect(result.success).toBe(true)
        restored = result.state
      } else {
        restored = apply(after, inverse as Command)
      }

      expect(restored.facets.things).toHaveLength(1)
      expect(restored.facets.things[0]!.uri).toBe(facet.uri)
      expect(restored.facets.things[0]!.name).toBe('Product')
    })

    it('inverts facet:move → reverses source and target', () => {
      const root = makeRoot()
      const s1 = apply(root, { type: 'context:add', payload: { name: 'Ctx', parentUri: root.uri } })
      const ctxId = Object.keys(s1.contexts)[0]!
      const facet = createDefaultFacet('things', 'Widget')
      const s2 = apply(s1, { type: 'facet:add', payload: { contextUri: root.uri, facetType: 'things', facet } })

      const cmd: Command = {
        type: 'facet:move',
        payload: { sourceContextUri: root.uri, targetContextUri: ctxId, facetType: 'things', facetUri: facet.uri },
      }
      const after = apply(s2, cmd)
      const inverse = computeInverse(cmd, s2, after)

      expect(inverse.type).toBe('facet:move')
      expect((inverse as any).payload.sourceContextUri).toBe(ctxId)
      expect((inverse as any).payload.targetContextUri).toBe(root.uri)
    })
  })

  describe('link commands', () => {
    it('inverts link:add → link:remove', () => {
      const root = makeRoot()
      const thing = createDefaultFacet('things', 'Order')
      const persona = createDefaultFacet('personas', 'Buyer')
      const s1 = apply(root, { type: 'facet:add', payload: { contextUri: root.uri, facetType: 'things', facet: thing } })
      const s2 = apply(s1, { type: 'facet:add', payload: { contextUri: root.uri, facetType: 'personas', facet: persona } })

      const cmd: Command = {
        type: 'link:add',
        payload: { predicate: 'stewards', sourceUri: persona.uri, targetUri: thing.uri },
      }
      const after = apply(s2, cmd)
      const inverse = computeInverse(cmd, s2, after)

      expect(inverse.type).toBe('link:remove')
      expect((inverse as any).payload.linkUri).toBe(after.links[0]!.uri)
    })

    it('inverts link:remove → link:add with original ID', () => {
      const root = makeRoot()
      const thing = createDefaultFacet('things', 'Order')
      const persona = createDefaultFacet('personas', 'Buyer')
      const s1 = apply(root, { type: 'facet:add', payload: { contextUri: root.uri, facetType: 'things', facet: thing } })
      const s2 = apply(s1, { type: 'facet:add', payload: { contextUri: root.uri, facetType: 'personas', facet: persona } })
      const s3 = apply(s2, { type: 'link:add', payload: { predicate: 'stewards', sourceUri: persona.uri, targetUri: thing.uri } })

      const linkUri = s3.links[0]!.uri
      const cmd: Command = { type: 'link:remove', payload: { linkUri } }
      const after = apply(s3, cmd)
      const inverse = computeInverse(cmd, s3, after)

      expect(inverse.type).toBe('link:add')
      expect((inverse as any).payload.uri).toBe(linkUri)

      const restored = apply(after, inverse as Command)
      expect(restored.links).toHaveLength(1)
      expect(restored.links[0]!.uri).toBe(linkUri)
    })
  })

  describe('symbol commands', () => {
    it('inverts symbol:add → symbol:remove', () => {
      const root = makeRoot()
      const cmd: Command = { type: 'symbol:add', payload: { content: 'My symbol' } }
      const after = apply(root, cmd)
      const inverse = computeInverse(cmd, root, after)

      expect(inverse.type).toBe('symbol:remove')
      expect((inverse as any).payload.symbolUri).toBe(after.symbols[0]!.uri)
    })

    it('inverts symbol:update', () => {
      const root = makeRoot()
      const s1 = apply(root, { type: 'symbol:add', payload: { content: 'Original' } })
      const symbolId = s1.symbols[0]!.uri

      const cmd: Command = { type: 'symbol:update', payload: { symbolUri: symbolId, changes: { content: 'Renamed' } } }
      const after = apply(s1, cmd)
      const inverse = computeInverse(cmd, s1, after)

      const restored = apply(after, inverse as Command)
      expect(restored.symbols[0]!.content).toBe('Original')
    })
  })

  describe('assertion commands', () => {
    it('inverts assertion:add → assertion:remove', () => {
      const root = makeRoot()
      const assertion = {
        id: 'a1', name: 'Test rule', selector: { scope: 'all' as const },
        rule: { type: 'requires-tag' as const, tag: 'reviewed' },
        severity: 'warning' as const, enabled: true,
      }
      const cmd: Command = { type: 'assertion:add', payload: { assertion } }
      const after = apply(root, cmd)
      const inverse = computeInverse(cmd, root, after)

      expect(inverse.type).toBe('assertion:remove')
      expect((inverse as any).payload.assertionId).toBe('a1')
    })

    it('inverts assertion:remove → assertion:add', () => {
      const root = makeRoot()
      const assertion = {
        id: 'a1', name: 'Test rule', selector: { scope: 'all' as const },
        rule: { type: 'requires-tag' as const, tag: 'reviewed' },
        severity: 'warning' as const, enabled: true,
      }
      const s1 = apply(root, { type: 'assertion:add', payload: { assertion } })
      const cmd: Command = { type: 'assertion:remove', payload: { assertionId: 'a1' } }
      const after = apply(s1, cmd)
      const inverse = computeInverse(cmd, s1, after)

      expect(inverse.type).toBe('assertion:add')
      expect((inverse as any).payload.assertion.id).toBe('a1')
    })
  })

  describe('batch commands', () => {
    it('inverts a batch → reversed order of inverses', () => {
      const root = makeRoot()
      const facet = createDefaultFacet('things', 'Item')
      const batch: BatchCommand = {
        type: 'batch',
        payload: {
          commands: [
            { type: 'context:add', payload: { name: 'Shop', parentUri: root.uri } },
            { type: 'facet:add', payload: { contextUri: root.uri, facetType: 'things', facet } },
          ],
          label: 'Setup shop',
        },
      }

      const result = applyBatch(root, batch)
      expect(result.success).toBe(true)

      const inverse = computeInverse(batch, root, result.state)
      expect(inverse.type).toBe('batch')
      const cmds = (inverse as BatchCommand).payload.commands
      // Reversed: facet:remove first, then context:remove
      expect(cmds[0]!.type).toBe('facet:remove')
      expect(cmds[1]!.type).toBe('context:remove')
    })
  })

  describe('context:remove with cascading deletes', () => {
    it('restores child contexts and their facets', () => {
      const root = makeRoot()
      const s1 = apply(root, { type: 'context:add', payload: { name: 'Parent', parentUri: root.uri } })
      const parentId = Object.keys(s1.contexts)[0]!
      const s2 = apply(s1, { type: 'context:add', payload: { name: 'Child', parentUri: parentId } })
      const childId = Object.keys(s2.contexts).find(id => id !== parentId)!
      const facet = createDefaultFacet('things', 'ChildThing')
      const s3 = apply(s2, { type: 'facet:add', payload: { contextUri: childId, facetType: 'things', facet } })

      // Remove parent - cascades to child
      const cmd: Command = { type: 'context:remove', payload: { contextUri: parentId } }
      const after = apply(s3, cmd)
      expect(Object.keys(after.contexts)).toHaveLength(0)

      const inverse = computeInverse(cmd, s3, after)
      let restored: RootContext
      if (inverse.type === 'batch') {
        const result = applyBatch(after, inverse as BatchCommand)
        expect(result.success).toBe(true)
        restored = result.state
      } else {
        restored = apply(after, inverse as Command)
      }

      // Both contexts restored with original IDs
      expect(restored.contexts[parentId]).toBeDefined()
      expect(restored.contexts[childId]).toBeDefined()
      expect(restored.contexts[parentId]!.name).toBe('Parent')
      expect(restored.contexts[childId]!.name).toBe('Child')
      // Child's facet restored
      expect(restored.contexts[childId]!.facets.things).toHaveLength(1)
      expect(restored.contexts[childId]!.facets.things[0]!.name).toBe('ChildThing')
    })
  })
})

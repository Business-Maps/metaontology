import { describe, it, expect } from 'vitest'
import { diffRootContexts, diffFields, collectAllFacets, collectAllSymbols } from '../diff'
import { createEmptyRootContext, createEmptyContext, createDefaultFacet } from '../apply'
import type { RootContext, Context, Link, Symbol } from '../../types/context'
import type { EntityChange } from '../../types/branch'
import { isEmptyDiff } from '../../types/branch'

function makeRoot(name = 'Test'): RootContext {
  return createEmptyRootContext(name)
}

/** Add a sub-context and return the updated root + context id. */
function addContext(root: RootContext, name: string, parentUri?: string): { root: RootContext; contextId: string } {
  const ctx = createEmptyContext(name, parentUri ?? root.uri)
  const updated = { ...root, contexts: { ...root.contexts, [ctx.uri]: ctx } }
  return { root: updated, contextId: ctx.uri }
}

/** Find a change in a list by entity id. */
function findChange(changes: EntityChange[], id: string): EntityChange | undefined {
  return changes.find(c => c.id === id)
}

// ── diffFields helper ───────────────────────────────────────────────────────

describe('diffFields', () => {
  it('returns empty for identical objects', () => {
    expect(diffFields({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toEqual([])
  })

  it('detects changed fields', () => {
    expect(diffFields({ a: 1, b: 'x' }, { a: 2, b: 'x' })).toEqual(['a'])
  })

  it('detects added and removed fields', () => {
    const result = diffFields({ a: 1 }, { b: 2 })
    expect(result).toContain('a')
    expect(result).toContain('b')
  })

  it('respects excludeKeys', () => {
    expect(diffFields({ a: 1, b: 2 }, { a: 99, b: 2 }, new Set(['a']))).toEqual([])
  })

  it('uses deep equality via JSON.stringify', () => {
    expect(diffFields(
      { arr: [1, 2, 3] },
      { arr: [1, 2, 3] },
    )).toEqual([])
    expect(diffFields(
      { arr: [1, 2, 3] },
      { arr: [1, 2, 4] },
    )).toEqual(['arr'])
  })
})

// ── collectAllFacets / collectAllSymbols ──────────────────────────────────────

describe('collectAllFacets', () => {
  it('collects facets from root and sub-contexts', () => {
    const root = makeRoot()
    const thing = createDefaultFacet('things', 'Order')
    root.facets.things.push(thing)

    const { root: r2, contextId } = addContext(root, 'Sub')
    const persona = createDefaultFacet('personas', 'Admin')
    r2.contexts[contextId]!.facets.personas.push(persona)

    const index = collectAllFacets(r2)
    expect(index.size).toBe(2)
    expect(index.get(thing.uri)?.containerId).toBe(r2.uri)
    expect(index.get(persona.uri)?.containerId).toBe(contextId)
  })
})

describe('collectAllSymbols', () => {
  it('collects symbols from root and sub-contexts', () => {
    const root = makeRoot()
    root.symbols.push({ uri: 's1', content: 'Root Symbol' })

    const { root: r2, contextId } = addContext(root, 'Sub')
    r2.contexts[contextId]!.symbols.push({ uri: 's2', content: 'Sub Symbol' })

    const index = collectAllSymbols(r2)
    expect(index.size).toBe(2)
    expect(index.get('s1')?.containerId).toBe(r2.uri)
    expect(index.get('s2')?.containerId).toBe(contextId)
  })
})

// ── diffRootContexts ───────────────────────────────────────────────────────

describe('diffRootContexts', () => {
  describe('identical roots', () => {
    it('produces an empty diff', () => {
      const root = makeRoot()
      const diff = diffRootContexts(root, root)
      expect(isEmptyDiff(diff)).toBe(true)
    })

    it('produces an empty diff for deep-cloned roots', () => {
      const root = makeRoot()
      const clone = JSON.parse(JSON.stringify(root)) as RootContext
      const diff = diffRootContexts(root, clone)
      expect(isEmptyDiff(diff)).toBe(true)
    })
  })

  describe('root properties', () => {
    it('detects name change', () => {
      const base = makeRoot('Old')
      const target = { ...base, name: 'New' }
      const diff = diffRootContexts(base, target)
      expect(diff.rootProps).toHaveLength(1)
      expect(diff.rootProps[0]!.changedFields).toEqual(['name'])
    })

    it('detects description change', () => {
      const base = makeRoot()
      const target = { ...base, description: 'Updated desc' }
      const diff = diffRootContexts(base, target)
      expect(diff.rootProps).toHaveLength(1)
      expect(diff.rootProps[0]!.changedFields).toEqual(['description'])
    })

    it('detects both name and description changes', () => {
      const base = makeRoot('Old')
      const target = { ...base, name: 'New', description: 'Desc' }
      const diff = diffRootContexts(base, target)
      expect(diff.rootProps).toHaveLength(1)
      expect(diff.rootProps[0]!.changedFields).toContain('name')
      expect(diff.rootProps[0]!.changedFields).toContain('description')
    })

    it('ignores meta changes', () => {
      const base = makeRoot()
      const target = { ...base, meta: { createdAt: base.meta.createdAt, updatedAt: 'different' } }
      const diff = diffRootContexts(base, target)
      expect(diff.rootProps).toHaveLength(0)
    })
  })

  describe('contexts', () => {
    it('detects added context', () => {
      const base = makeRoot()
      const { root: target, contextId } = addContext(base, 'Checkout')
      const diff = diffRootContexts(base, target)
      expect(diff.contexts).toHaveLength(1)
      expect(diff.contexts[0]!.changeType).toBe('added')
      expect(diff.contexts[0]!.id).toBe(contextId)
      expect(diff.contexts[0]!.entityName).toBe('Checkout')
    })

    it('detects removed context', () => {
      const { root: base, contextId } = addContext(makeRoot(), 'Checkout')
      const target = { ...base, contexts: {} }
      const diff = diffRootContexts(base, target)
      expect(diff.contexts).toHaveLength(1)
      expect(diff.contexts[0]!.changeType).toBe('removed')
      expect(diff.contexts[0]!.id).toBe(contextId)
    })

    it('detects renamed context', () => {
      const { root: base, contextId } = addContext(makeRoot(), 'Old')
      const target = JSON.parse(JSON.stringify(base)) as RootContext
      target.contexts[contextId]!.name = 'New'
      const diff = diffRootContexts(base, target)
      expect(diff.contexts).toHaveLength(1)
      expect(diff.contexts[0]!.changeType).toBe('modified')
      expect(diff.contexts[0]!.changedFields).toEqual(['name'])
    })

    it('detects description change on context', () => {
      const { root: base, contextId } = addContext(makeRoot(), 'Ctx')
      const target = JSON.parse(JSON.stringify(base)) as RootContext
      target.contexts[contextId]!.description = 'New description'
      const diff = diffRootContexts(base, target)
      expect(diff.contexts).toHaveLength(1)
      expect(diff.contexts[0]!.changedFields).toEqual(['description'])
    })

    it('detects reparented context', () => {
      const root = makeRoot()
      const { root: r2, contextId: parentId } = addContext(root, 'Parent')
      const { root: base, contextId: childId } = addContext(r2, 'Child', parentId)

      const target = JSON.parse(JSON.stringify(base)) as RootContext
      target.contexts[childId]!.parentUri = root.uri // reparent to root

      const diff = diffRootContexts(base, target)
      const change = findChange(diff.contexts, childId)
      expect(change).toBeDefined()
      expect(change!.changedFields).toContain('parentUri')
    })

    it('detects domainType change', () => {
      const { root: base, contextId } = addContext(makeRoot(), 'Ctx')
      const target = JSON.parse(JSON.stringify(base)) as RootContext
      target.contexts[contextId]!.domainType = 'core'
      const diff = diffRootContexts(base, target)
      expect(diff.contexts).toHaveLength(1)
      expect(diff.contexts[0]!.changedFields).toContain('domainType')
    })

    it('handles multiple context changes simultaneously', () => {
      const root = makeRoot()
      const { root: r2, contextId: id1 } = addContext(root, 'A')
      const { root: base, contextId: id2 } = addContext(r2, 'B')

      const target = JSON.parse(JSON.stringify(base)) as RootContext
      // Remove A, modify B, add C
      delete target.contexts[id1]
      target.contexts[id2]!.name = 'B-modified'
      const cCtx = createEmptyContext('C', target.uri)
      target.contexts[cCtx.uri] = cCtx

      const diff = diffRootContexts(base, target)
      expect(diff.contexts).toHaveLength(3)
      expect(findChange(diff.contexts, id1)?.changeType).toBe('removed')
      expect(findChange(diff.contexts, id2)?.changeType).toBe('modified')
      expect(findChange(diff.contexts, cCtx.uri)?.changeType).toBe('added')
    })
  })

  describe('facets', () => {
    it('detects added facet on root', () => {
      const base = makeRoot()
      const target = JSON.parse(JSON.stringify(base)) as RootContext
      const thing = createDefaultFacet('things', 'Order')
      target.facets.things.push(thing)

      const diff = diffRootContexts(base, target)
      expect(diff.facets).toHaveLength(1)
      expect(diff.facets[0]!.changeType).toBe('added')
      expect(diff.facets[0]!.entityName).toBe('Order')
      expect(diff.facets[0]!.facetType).toBe('things')
    })

    it('detects added facet in sub-context', () => {
      const { root: base, contextId } = addContext(makeRoot(), 'Sub')
      const target = JSON.parse(JSON.stringify(base)) as RootContext
      const persona = createDefaultFacet('personas', 'Admin')
      target.contexts[contextId]!.facets.personas.push(persona)

      const diff = diffRootContexts(base, target)
      expect(diff.facets).toHaveLength(1)
      expect(diff.facets[0]!.containerId).toBe(contextId)
    })

    it('detects removed facet', () => {
      const base = makeRoot()
      const thing = createDefaultFacet('things', 'Order')
      base.facets.things.push(thing)

      const target = JSON.parse(JSON.stringify(base)) as RootContext
      target.facets.things = []

      const diff = diffRootContexts(base, target)
      expect(diff.facets).toHaveLength(1)
      expect(diff.facets[0]!.changeType).toBe('removed')
      expect(diff.facets[0]!.id).toBe(thing.uri)
    })

    it('detects modified facet (name change)', () => {
      const base = makeRoot()
      const thing = createDefaultFacet('things', 'Order')
      base.facets.things.push(thing)

      const target = JSON.parse(JSON.stringify(base)) as RootContext
      target.facets.things[0]!.name = 'Invoice'

      const diff = diffRootContexts(base, target)
      expect(diff.facets).toHaveLength(1)
      expect(diff.facets[0]!.changeType).toBe('modified')
      expect(diff.facets[0]!.changedFields).toContain('name')
    })

    it('detects facet moved between contexts', () => {
      const { root: r1, contextId: ctxA } = addContext(makeRoot(), 'A')
      const { root: base, contextId: ctxB } = addContext(r1, 'B')
      const thing = createDefaultFacet('things', 'Order')
      base.contexts[ctxA]!.facets.things.push(thing)

      const target = JSON.parse(JSON.stringify(base)) as RootContext
      // Move from A to B
      target.contexts[ctxA]!.facets.things = []
      target.contexts[ctxB]!.facets.things.push(JSON.parse(JSON.stringify(thing)))

      const diff = diffRootContexts(base, target)
      expect(diff.facets).toHaveLength(1)
      expect(diff.facets[0]!.changeType).toBe('modified')
      expect(diff.facets[0]!.changedFields).toContain('containerId')
      expect(diff.facets[0]!.containerId).toBe(ctxB) // target container
    })

    it('detects facet with multiple field changes', () => {
      const base = makeRoot()
      const action = createDefaultFacet('actions', 'Create Order')
      base.facets.actions.push(action)

      const target = JSON.parse(JSON.stringify(base)) as RootContext
      ;(target.facets.actions[0] as any).name = 'Submit Order'
      ;(target.facets.actions[0] as any).description = 'Submits the order to fulfillment'

      const diff = diffRootContexts(base, target)
      expect(diff.facets).toHaveLength(1)
      expect(diff.facets[0]!.changedFields).toContain('name')
      expect(diff.facets[0]!.changedFields).toContain('description')
    })
  })

  describe('links', () => {
    it('detects added link', () => {
      const base = makeRoot()
      const target = JSON.parse(JSON.stringify(base)) as RootContext
      const link: Link = {
        uri: 'link-1',
        predicate: 'valueStream',
        sourceUri: 'a',
        targetUri: 'b',
        label: 'Test link',
      }
      target.links.push(link)

      const diff = diffRootContexts(base, target)
      expect(diff.links).toHaveLength(1)
      expect(diff.links[0]!.changeType).toBe('added')
      expect(diff.links[0]!.id).toBe('link-1')
    })

    it('detects removed link', () => {
      const base = makeRoot()
      base.links.push({
        uri: 'link-1',
        predicate: 'valueStream',
        sourceUri: 'a',
        targetUri: 'b',
      })

      const target = JSON.parse(JSON.stringify(base)) as RootContext
      target.links = []

      const diff = diffRootContexts(base, target)
      expect(diff.links).toHaveLength(1)
      expect(diff.links[0]!.changeType).toBe('removed')
    })

    it('detects modified link (label change)', () => {
      const base = makeRoot()
      base.links.push({
        uri: 'link-1',
        predicate: 'valueStream',
        sourceUri: 'a',
        targetUri: 'b',
        label: 'Old label',
      })

      const target = JSON.parse(JSON.stringify(base)) as RootContext
      target.links[0]!.label = 'New label'

      const diff = diffRootContexts(base, target)
      expect(diff.links).toHaveLength(1)
      expect(diff.links[0]!.changeType).toBe('modified')
      expect(diff.links[0]!.changedFields).toEqual(['label'])
    })

    it('detects modified link (pattern change)', () => {
      const base = makeRoot()
      base.links.push({
        uri: 'link-1',
        predicate: 'valueStream',
        sourceUri: 'a',
        targetUri: 'b',
      })

      const target = JSON.parse(JSON.stringify(base)) as RootContext
      target.links[0]!.pattern = 'partnership'

      const diff = diffRootContexts(base, target)
      expect(diff.links).toHaveLength(1)
      expect(diff.links[0]!.changedFields).toContain('pattern')
    })

    it('handles multiple link changes simultaneously', () => {
      const base = makeRoot()
      base.links.push(
        { uri: 'l1', predicate: 'valueStream', sourceUri: 'a', targetUri: 'b' },
        { uri: 'l2', predicate: 'performs', sourceUri: 'c', targetUri: 'd' },
      )

      const target = JSON.parse(JSON.stringify(base)) as RootContext
      // Remove l1, modify l2, add l3
      target.links = [
        { ...target.links[1]!, label: 'Modified' },
        { uri: 'l3', predicate: 'uses', sourceUri: 'e', targetUri: 'f' },
      ]

      const diff = diffRootContexts(base, target)
      expect(diff.links).toHaveLength(3)
      expect(findChange(diff.links, 'l1')?.changeType).toBe('removed')
      expect(findChange(diff.links, 'l2')?.changeType).toBe('modified')
      expect(findChange(diff.links, 'l3')?.changeType).toBe('added')
    })
  })

  describe('symbols', () => {
    it('detects added symbol on root', () => {
      const base = makeRoot()
      const target = JSON.parse(JSON.stringify(base)) as RootContext
      target.symbols.push({ uri: 's1', content: 'New symbol' })

      const diff = diffRootContexts(base, target)
      expect(diff.symbols).toHaveLength(1)
      expect(diff.symbols[0]!.changeType).toBe('added')
      expect(diff.symbols[0]!.entityName).toBe('New symbol')
    })

    it('detects added symbol in sub-context', () => {
      const { root: base, contextId } = addContext(makeRoot(), 'Sub')
      const target = JSON.parse(JSON.stringify(base)) as RootContext
      target.contexts[contextId]!.symbols.push({ uri: 's1', content: 'Sub symbol' })

      const diff = diffRootContexts(base, target)
      expect(diff.symbols).toHaveLength(1)
      expect(diff.symbols[0]!.containerId).toBe(contextId)
    })

    it('detects removed symbol', () => {
      const base = makeRoot()
      base.symbols.push({ uri: 's1', content: 'Old symbol' })

      const target = JSON.parse(JSON.stringify(base)) as RootContext
      target.symbols = []

      const diff = diffRootContexts(base, target)
      expect(diff.symbols).toHaveLength(1)
      expect(diff.symbols[0]!.changeType).toBe('removed')
    })

    it('detects modified symbol (content change)', () => {
      const base = makeRoot()
      base.symbols.push({ uri: 's1', content: 'Old' })

      const target = JSON.parse(JSON.stringify(base)) as RootContext
      target.symbols[0]!.content = 'New'

      const diff = diffRootContexts(base, target)
      expect(diff.symbols).toHaveLength(1)
      expect(diff.symbols[0]!.changeType).toBe('modified')
      expect(diff.symbols[0]!.changedFields).toContain('content')
    })

    it('detects symbol moved between containers', () => {
      const { root: base, contextId } = addContext(makeRoot(), 'Sub')
      base.symbols.push({ uri: 's1', content: 'Moveable' })

      const target = JSON.parse(JSON.stringify(base)) as RootContext
      target.symbols = []
      target.contexts[contextId]!.symbols.push({ uri: 's1', content: 'Moveable' })

      const diff = diffRootContexts(base, target)
      expect(diff.symbols).toHaveLength(1)
      expect(diff.symbols[0]!.changeType).toBe('modified')
      expect(diff.symbols[0]!.changedFields).toContain('containerId')
    })
  })

  describe('edge cases', () => {
    it('empty root vs populated root reports all as added', () => {
      const base = makeRoot()
      const target = JSON.parse(JSON.stringify(base)) as RootContext
      target.name = 'Populated'
      const ctx = createEmptyContext('Sub', target.uri)
      target.contexts[ctx.uri] = ctx
      const thing = createDefaultFacet('things', 'Order')
      target.facets.things.push(thing)
      target.links.push({ uri: 'l1', predicate: 'valueStream', sourceUri: 'a', targetUri: 'b' })
      target.symbols.push({ uri: 's1', content: 'Symbol' })

      const diff = diffRootContexts(base, target)
      expect(diff.rootProps.length).toBeGreaterThan(0)
      expect(diff.contexts).toHaveLength(1)
      expect(diff.facets).toHaveLength(1)
      expect(diff.links).toHaveLength(1)
      expect(diff.symbols).toHaveLength(1)

      expect(diff.contexts[0]!.changeType).toBe('added')
      expect(diff.facets[0]!.changeType).toBe('added')
      expect(diff.links[0]!.changeType).toBe('added')
      expect(diff.symbols[0]!.changeType).toBe('added')
    })

    it('populated root vs empty root reports all as removed', () => {
      const target = makeRoot()
      const base = JSON.parse(JSON.stringify(target)) as RootContext
      const ctx = createEmptyContext('Sub', base.uri)
      base.contexts[ctx.uri] = ctx
      base.facets.things.push(createDefaultFacet('things', 'Order'))
      base.links.push({ uri: 'l1', predicate: 'valueStream', sourceUri: 'a', targetUri: 'b' })
      base.symbols.push({ uri: 's1', content: 'Symbol' })

      const diff = diffRootContexts(base, target)
      expect(diff.contexts[0]!.changeType).toBe('removed')
      expect(diff.facets[0]!.changeType).toBe('removed')
      expect(diff.links[0]!.changeType).toBe('removed')
      expect(diff.symbols[0]!.changeType).toBe('removed')
    })

    it('does not diff facet arrays on the context level (handled by global facet diff)', () => {
      const { root: base, contextId } = addContext(makeRoot(), 'Sub')
      const target = JSON.parse(JSON.stringify(base)) as RootContext
      // Add a facet to the sub-context - this should show up in facets, not contexts
      target.contexts[contextId]!.facets.things.push(createDefaultFacet('things', 'Order'))

      const diff = diffRootContexts(base, target)
      // Context itself should NOT be reported as modified (facets excluded from context diff)
      expect(diff.contexts).toHaveLength(0)
      // But the facet should be reported
      expect(diff.facets).toHaveLength(1)
    })

    it('does not report context as modified when only symbols change (handled by global symbol diff)', () => {
      const { root: base, contextId } = addContext(makeRoot(), 'Sub')
      const target = JSON.parse(JSON.stringify(base)) as RootContext
      target.contexts[contextId]!.symbols.push({ uri: 's1', content: 'Symbol' })

      const diff = diffRootContexts(base, target)
      expect(diff.contexts).toHaveLength(0)
      expect(diff.symbols).toHaveLength(1)
    })

    it('preserves baseValue and targetValue for inspection', () => {
      const base = makeRoot()
      base.facets.things.push(createDefaultFacet('things', 'Order'))

      const target = JSON.parse(JSON.stringify(base)) as RootContext
      target.facets.things[0]!.name = 'Invoice'

      const diff = diffRootContexts(base, target)
      expect(diff.facets[0]!.baseValue).toBeDefined()
      expect(diff.facets[0]!.targetValue).toBeDefined()
      expect((diff.facets[0]!.baseValue as any).name).toBe('Order')
      expect((diff.facets[0]!.targetValue as any).name).toBe('Invoice')
    })
  })
})

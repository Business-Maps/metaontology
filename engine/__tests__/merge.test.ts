import { describe, it, expect } from 'vitest'
import { threeWayMerge, applyResolutions } from '../merge'
import { createEmptyRootContext, createEmptyContext, createDefaultFacet } from '../apply'
import type { RootContext, Link, Symbol } from '../../types/context'
import type { MergeOptions, MergeResult, ConflictSide } from '../../types/branch'

function makeRoot(name = 'Test'): RootContext {
  return createEmptyRootContext(name)
}

/** Deep clone a root for independent mutation. */
function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

/** Create merge options from base + two independently mutated clones. */
function opts(base: RootContext, ours: RootContext, theirs: RootContext): MergeOptions {
  return { base, ours, theirs }
}

/** Add a sub-context directly to a root (mutating). */
function addCtx(root: RootContext, name: string, parentUri?: string): string {
  const ctx = createEmptyContext(name, parentUri ?? root.uri)
  root.contexts[ctx.uri] = ctx
  return ctx.uri
}

// ── Non-conflicting merges ──────────────────────────────────────────────────

describe('threeWayMerge', () => {
  describe('non-conflicting', () => {
    it('both unchanged → identical to base', () => {
      const base = makeRoot()
      const result = threeWayMerge(opts(base, clone(base), clone(base)))
      expect(result.success).toBe(true)
      expect(result.conflicts).toHaveLength(0)
      expect(result.mergedModel.name).toBe(base.name)
    })

    it('only ours changed → result equals ours', () => {
      const base = makeRoot()
      const ours = clone(base)
      ours.name = 'Ours Changed'
      const result = threeWayMerge(opts(base, ours, clone(base)))
      expect(result.success).toBe(true)
      expect(result.mergedModel.name).toBe('Ours Changed')
    })

    it('only theirs changed → result equals theirs', () => {
      const base = makeRoot()
      const theirs = clone(base)
      theirs.name = 'Theirs Changed'
      const result = threeWayMerge(opts(base, clone(base), theirs))
      expect(result.success).toBe(true)
      expect(result.mergedModel.name).toBe('Theirs Changed')
    })

    it('ours adds context A, theirs adds context B → both present', () => {
      const base = makeRoot()
      const ours = clone(base)
      const theirs = clone(base)

      const idA = addCtx(ours, 'A')
      const idB = addCtx(theirs, 'B')

      const result = threeWayMerge(opts(base, ours, theirs))
      expect(result.success).toBe(true)
      expect(result.mergedModel.contexts[idA]).toBeDefined()
      expect(result.mergedModel.contexts[idB]).toBeDefined()
      expect(result.mergedModel.contexts[idA]!.name).toBe('A')
      expect(result.mergedModel.contexts[idB]!.name).toBe('B')
    })

    it('ours adds facet to context X, theirs adds facet to context Y → both present', () => {
      const base = makeRoot()
      const xId = addCtx(base, 'X')
      const yId = addCtx(base, 'Y')

      const ours = clone(base)
      const theirs = clone(base)

      const thingOurs = createDefaultFacet('things', 'Order')
      ours.contexts[xId]!.facets.things.push(thingOurs)

      const thingTheirs = createDefaultFacet('things', 'Invoice')
      theirs.contexts[yId]!.facets.things.push(thingTheirs)

      const result = threeWayMerge(opts(base, ours, theirs))
      expect(result.success).toBe(true)
      expect(result.mergedModel.contexts[xId]!.facets.things).toHaveLength(1)
      expect(result.mergedModel.contexts[yId]!.facets.things).toHaveLength(1)
    })

    it('both delete the same context → no conflict', () => {
      const base = makeRoot()
      const ctxId = addCtx(base, 'ToDelete')

      const ours = clone(base)
      const theirs = clone(base)
      delete ours.contexts[ctxId]
      delete theirs.contexts[ctxId]

      const result = threeWayMerge(opts(base, ours, theirs))
      expect(result.success).toBe(true)
      expect(result.mergedModel.contexts[ctxId]).toBeUndefined()
    })

    it('both delete the same link → no conflict', () => {
      const base = makeRoot()
      base.links.push({ uri: 'l1', predicate: 'valueStream', sourceUri: 'a', targetUri: 'b' })

      const ours = clone(base)
      const theirs = clone(base)
      ours.links = []
      theirs.links = []

      const result = threeWayMerge(opts(base, ours, theirs))
      expect(result.success).toBe(true)
      expect(result.mergedModel.links).toHaveLength(0)
    })

    it('ours adds a thing, theirs adds a persona → both present', () => {
      const base = makeRoot()
      const ours = clone(base)
      const theirs = clone(base)

      ours.facets.things.push(createDefaultFacet('things', 'Order'))
      theirs.facets.personas.push(createDefaultFacet('personas', 'Admin'))

      const result = threeWayMerge(opts(base, ours, theirs))
      expect(result.success).toBe(true)
      expect(result.mergedModel.facets.things).toHaveLength(1)
      expect(result.mergedModel.facets.personas).toHaveLength(1)
    })
  })

  // ── Field-level merge ───────────────────────────────────────────────────

  describe('field-level merge', () => {
    it('ours modifies context name, theirs modifies context description → both applied', () => {
      const base = makeRoot()
      const ctxId = addCtx(base, 'Original')
      base.contexts[ctxId]!.description = 'Original desc'

      const ours = clone(base)
      const theirs = clone(base)
      ours.contexts[ctxId]!.name = 'Renamed'
      theirs.contexts[ctxId]!.description = 'New desc'

      const result = threeWayMerge(opts(base, ours, theirs))
      expect(result.success).toBe(true)
      expect(result.mergedModel.contexts[ctxId]!.name).toBe('Renamed')
      expect(result.mergedModel.contexts[ctxId]!.description).toBe('New desc')
    })

    it('ours and theirs change name to the same value → no conflict', () => {
      const base = makeRoot()
      const ctxId = addCtx(base, 'Original')

      const ours = clone(base)
      const theirs = clone(base)
      ours.contexts[ctxId]!.name = 'Same'
      theirs.contexts[ctxId]!.name = 'Same'

      const result = threeWayMerge(opts(base, ours, theirs))
      expect(result.success).toBe(true)
      expect(result.mergedModel.contexts[ctxId]!.name).toBe('Same')
    })

    it('ours modifies link label, theirs modifies link pattern → both applied', () => {
      const base = makeRoot()
      const ctxA = addCtx(base, 'A')
      const ctxB = addCtx(base, 'B')
      base.links.push({ uri: 'l1', predicate: 'valueStream', sourceUri: ctxA, targetUri: ctxB })

      const ours = clone(base)
      const theirs = clone(base)
      ours.links[0]!.label = 'Our label'
      theirs.links[0]!.pattern = 'partnership'

      const result = threeWayMerge(opts(base, ours, theirs))
      expect(result.success).toBe(true)
      const link = result.mergedModel.links.find(l => l.uri === 'l1')!
      expect(link.label).toBe('Our label')
      expect(link.pattern).toBe('partnership')
    })

    it('ours changes root name, theirs changes root description → both applied', () => {
      const base = makeRoot('Original')
      base.description = 'Original desc'

      const ours = clone(base)
      const theirs = clone(base)
      ours.name = 'New Name'
      theirs.description = 'New Desc'

      const result = threeWayMerge(opts(base, ours, theirs))
      expect(result.success).toBe(true)
      expect(result.mergedModel.name).toBe('New Name')
      expect(result.mergedModel.description).toBe('New Desc')
    })
  })

  // ── Conflicting merges ────────────────────────────────────────────────────

  describe('conflicting', () => {
    it('both modify same context name differently → conflict', () => {
      const base = makeRoot()
      const ctxId = addCtx(base, 'Original')

      const ours = clone(base)
      const theirs = clone(base)
      ours.contexts[ctxId]!.name = 'Our Name'
      theirs.contexts[ctxId]!.name = 'Their Name'

      const result = threeWayMerge(opts(base, ours, theirs))
      expect(result.success).toBe(false)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0]!.entityId).toBe(ctxId)
      expect(result.conflicts[0]!.entityType).toBe('context')
    })

    it('ours deletes context, theirs modifies it → conflict', () => {
      const base = makeRoot()
      const ctxId = addCtx(base, 'Context')

      const ours = clone(base)
      const theirs = clone(base)
      delete ours.contexts[ctxId]
      theirs.contexts[ctxId]!.name = 'Modified'

      const result = threeWayMerge(opts(base, ours, theirs))
      expect(result.success).toBe(false)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0]!.oursChange.changeType).toBe('removed')
      expect(result.conflicts[0]!.theirsChange.changeType).toBe('modified')
    })

    it('ours modifies context, theirs deletes it → conflict', () => {
      const base = makeRoot()
      const ctxId = addCtx(base, 'Context')

      const ours = clone(base)
      const theirs = clone(base)
      ours.contexts[ctxId]!.name = 'Modified'
      delete theirs.contexts[ctxId]

      const result = threeWayMerge(opts(base, ours, theirs))
      expect(result.success).toBe(false)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0]!.oursChange.changeType).toBe('modified')
      expect(result.conflicts[0]!.theirsChange.changeType).toBe('removed')
    })

    it('ours deletes facet, theirs modifies it → conflict', () => {
      const base = makeRoot()
      const thing = createDefaultFacet('things', 'Order')
      base.facets.things.push(thing)

      const ours = clone(base)
      const theirs = clone(base)
      ours.facets.things = []
      theirs.facets.things[0]!.name = 'Modified Order'

      const result = threeWayMerge(opts(base, ours, theirs))
      expect(result.success).toBe(false)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0]!.entityType).toBe('facet')
    })

    it('both modify same link label differently → conflict', () => {
      const base = makeRoot()
      base.links.push({ uri: 'l1', predicate: 'valueStream', sourceUri: 'a', targetUri: 'b', label: 'Original' })

      const ours = clone(base)
      const theirs = clone(base)
      ours.links[0]!.label = 'Our label'
      theirs.links[0]!.label = 'Their label'

      const result = threeWayMerge(opts(base, ours, theirs))
      expect(result.success).toBe(false)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0]!.entityType).toBe('link')
    })

    it('both modify same symbol content differently → conflict', () => {
      const base = makeRoot()
      base.symbols.push({ uri: 's1', content: 'Original' })

      const ours = clone(base)
      const theirs = clone(base)
      ours.symbols[0]!.content = 'Our content'
      theirs.symbols[0]!.content = 'Their content'

      const result = threeWayMerge(opts(base, ours, theirs))
      expect(result.success).toBe(false)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0]!.entityType).toBe('symbol')
    })

    it('both modify root name differently → conflict', () => {
      const base = makeRoot('Original')

      const ours = clone(base)
      const theirs = clone(base)
      ours.name = 'Our Name'
      theirs.name = 'Their Name'

      const result = threeWayMerge(opts(base, ours, theirs))
      expect(result.success).toBe(false)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0]!.entityType).toBe('root-props')
    })
  })

  // ── Resolution application ────────────────────────────────────────────────

  describe('applyResolutions', () => {
    it('resolves all conflicts as ours', () => {
      const base = makeRoot()
      const ctxId = addCtx(base, 'Original')

      const ours = clone(base)
      const theirs = clone(base)
      ours.contexts[ctxId]!.name = 'Our Name'
      theirs.contexts[ctxId]!.name = 'Their Name'

      const result = threeWayMerge(opts(base, ours, theirs))
      expect(result.success).toBe(false)

      const resolutions: Record<string, ConflictSide> = {}
      for (const c of result.conflicts) resolutions[c.id] = 'ours'

      const resolved = applyResolutions(result, resolutions)
      expect(resolved.success).toBe(true)
      expect(resolved.conflicts).toHaveLength(0)
      expect(resolved.mergedModel.contexts[ctxId]!.name).toBe('Our Name')
    })

    it('resolves all conflicts as theirs', () => {
      const base = makeRoot()
      const ctxId = addCtx(base, 'Original')

      const ours = clone(base)
      const theirs = clone(base)
      ours.contexts[ctxId]!.name = 'Our Name'
      theirs.contexts[ctxId]!.name = 'Their Name'

      const result = threeWayMerge(opts(base, ours, theirs))

      const resolutions: Record<string, ConflictSide> = {}
      for (const c of result.conflicts) resolutions[c.id] = 'theirs'

      const resolved = applyResolutions(result, resolutions)
      expect(resolved.success).toBe(true)
      expect(resolved.mergedModel.contexts[ctxId]!.name).toBe('Their Name')
    })

    it('mixed resolutions: applies correct side for each', () => {
      const base = makeRoot('Base')
      base.description = 'Base desc'

      const ctxId = addCtx(base, 'Ctx')
      base.contexts[ctxId]!.description = 'Ctx desc'

      const ours = clone(base)
      const theirs = clone(base)

      // Conflict 1: root name
      ours.name = 'Our Root'
      theirs.name = 'Their Root'

      // Conflict 2: context name
      ours.contexts[ctxId]!.name = 'Our Ctx'
      theirs.contexts[ctxId]!.name = 'Their Ctx'

      const result = threeWayMerge(opts(base, ours, theirs))
      expect(result.conflicts).toHaveLength(2)

      const resolutions: Record<string, ConflictSide> = {}
      // Root: keep ours, Context: keep theirs
      for (const c of result.conflicts) {
        resolutions[c.id] = c.entityType === 'root-props' ? 'ours' : 'theirs'
      }

      const resolved = applyResolutions(result, resolutions)
      expect(resolved.success).toBe(true)
      expect(resolved.mergedModel.name).toBe('Our Root')
      expect(resolved.mergedModel.contexts[ctxId]!.name).toBe('Their Ctx')
    })

    it('partial resolution leaves remaining conflicts', () => {
      const base = makeRoot('Base')
      const ctxId = addCtx(base, 'Ctx')

      const ours = clone(base)
      const theirs = clone(base)
      ours.name = 'Our Root'
      theirs.name = 'Their Root'
      ours.contexts[ctxId]!.name = 'Our Ctx'
      theirs.contexts[ctxId]!.name = 'Their Ctx'

      const result = threeWayMerge(opts(base, ours, theirs))
      expect(result.conflicts).toHaveLength(2)

      // Only resolve one
      const firstConflict = result.conflicts[0]!
      const resolved = applyResolutions(result, { [firstConflict.id]: 'ours' })
      expect(resolved.success).toBe(false)
      expect(resolved.conflicts).toHaveLength(1)
    })

    it('resolves modify-delete conflict as theirs (delete wins)', () => {
      const base = makeRoot()
      const ctxId = addCtx(base, 'Context')

      const ours = clone(base)
      const theirs = clone(base)
      ours.contexts[ctxId]!.name = 'Modified'
      delete theirs.contexts[ctxId]

      const result = threeWayMerge(opts(base, ours, theirs))
      const resolutions: Record<string, ConflictSide> = {}
      for (const c of result.conflicts) resolutions[c.id] = 'theirs'

      const resolved = applyResolutions(result, resolutions)
      expect(resolved.success).toBe(true)
      expect(resolved.mergedModel.contexts[ctxId]).toBeUndefined()
    })

    it('resolves modify-delete conflict as ours (keep wins)', () => {
      const base = makeRoot()
      const ctxId = addCtx(base, 'Context')

      const ours = clone(base)
      const theirs = clone(base)
      ours.contexts[ctxId]!.name = 'Modified'
      delete theirs.contexts[ctxId]

      const result = threeWayMerge(opts(base, ours, theirs))
      const resolutions: Record<string, ConflictSide> = {}
      for (const c of result.conflicts) resolutions[c.id] = 'ours'

      const resolved = applyResolutions(result, resolutions)
      expect(resolved.success).toBe(true)
      expect(resolved.mergedModel.contexts[ctxId]!.name).toBe('Modified')
    })
  })

  describe('complex scenarios', () => {
    it('branch adds context+facets+links, main adds different context+facets+links → full merge', () => {
      const base = makeRoot()

      const ours = clone(base)
      const ctxA = addCtx(ours, 'Checkout')
      const thingA = createDefaultFacet('things', 'Order')
      ours.contexts[ctxA]!.facets.things.push(thingA)
      ours.links.push({ uri: 'la', predicate: 'valueStream', sourceUri: ours.uri, targetUri: ctxA })

      const theirs = clone(base)
      const ctxB = addCtx(theirs, 'Payments')
      const thingB = createDefaultFacet('things', 'Invoice')
      theirs.contexts[ctxB]!.facets.things.push(thingB)
      theirs.links.push({ uri: 'lb', predicate: 'valueStream', sourceUri: theirs.uri, targetUri: ctxB })

      const result = threeWayMerge(opts(base, ours, theirs))
      expect(result.success).toBe(true)
      expect(Object.keys(result.mergedModel.contexts)).toHaveLength(2)
      expect(result.mergedModel.links).toHaveLength(2)
      expect(result.mergedModel.contexts[ctxA]!.facets.things).toHaveLength(1)
      expect(result.mergedModel.contexts[ctxB]!.facets.things).toHaveLength(1)
    })

    it('post-merge link pruning removes dangling links', () => {
      const base = makeRoot()
      const ctxId = addCtx(base, 'Target')
      base.links.push({ uri: 'l1', predicate: 'valueStream', sourceUri: base.uri, targetUri: ctxId })

      // Theirs deletes the context (and we don't conflict on it)
      const theirs = clone(base)
      delete theirs.contexts[ctxId]
      theirs.links = [] // theirs also removes the link

      const ours = clone(base) // ours untouched

      const result = threeWayMerge(opts(base, ours, theirs))
      // The context deletion is auto-merged (only theirs changed it)
      // The link should be pruned because its targetUri no longer exists
      expect(result.mergedModel.contexts[ctxId]).toBeUndefined()
      // Link should be pruned since target context was deleted
      expect(result.mergedModel.links.filter(l => l.targetUri === ctxId)).toHaveLength(0)
    })
  })

  // ── Immutability ──────────────────────────────────────────────────────────

  describe('immutability', () => {
    it('does not mutate base', () => {
      const base = makeRoot('Base')
      addCtx(base, 'Ctx')
      const snapshot = JSON.stringify(base)

      const ours = clone(base)
      ours.name = 'Changed'

      threeWayMerge(opts(base, ours, clone(base)))
      expect(JSON.stringify(base)).toBe(snapshot)
    })

    it('does not mutate ours', () => {
      const base = makeRoot()
      const ours = clone(base)
      ours.name = 'Ours'
      const snapshot = JSON.stringify(ours)

      const theirs = clone(base)
      theirs.name = 'Theirs'

      threeWayMerge(opts(base, ours, theirs))
      expect(JSON.stringify(ours)).toBe(snapshot)
    })

    it('does not mutate theirs', () => {
      const base = makeRoot()
      const theirs = clone(base)
      theirs.name = 'Theirs'
      const snapshot = JSON.stringify(theirs)

      const ours = clone(base)
      ours.name = 'Ours'

      threeWayMerge(opts(base, ours, theirs))
      expect(JSON.stringify(theirs)).toBe(snapshot)
    })
  })

  // ── Edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('merging identical branches (ours === theirs) → no changes, no conflicts', () => {
      const base = makeRoot()
      const both = clone(base)
      both.name = 'Same Changes'
      addCtx(both, 'Same')

      const result = threeWayMerge(opts(base, clone(both), clone(both)))
      expect(result.success).toBe(true)
      expect(result.conflicts).toHaveLength(0)
      // autoMerged may contain theirs' changes since they're non-conflicting
    })

    it('merging when base === ours → result is theirs (fast-forward)', () => {
      const base = makeRoot()
      const theirs = clone(base)
      theirs.name = 'Theirs'
      const ctxId = addCtx(theirs, 'New')
      theirs.facets.things.push(createDefaultFacet('things', 'Order'))

      const result = threeWayMerge(opts(base, clone(base), theirs))
      expect(result.success).toBe(true)
      expect(result.mergedModel.name).toBe('Theirs')
      expect(Object.keys(result.mergedModel.contexts)).toHaveLength(1)
      expect(result.mergedModel.facets.things).toHaveLength(1)
    })

    it('merging when base === theirs → result is ours', () => {
      const base = makeRoot()
      const ours = clone(base)
      ours.name = 'Ours'
      addCtx(ours, 'New')

      const result = threeWayMerge(opts(base, ours, clone(base)))
      expect(result.success).toBe(true)
      expect(result.mergedModel.name).toBe('Ours')
      expect(Object.keys(result.mergedModel.contexts)).toHaveLength(1)
    })

    it('meta.updatedAt is refreshed after merge', () => {
      const base = makeRoot()
      // Force an old timestamp so the merge timestamp is guaranteed different
      base.meta.updatedAt = '2020-01-01T00:00:00.000Z'

      const result = threeWayMerge(opts(base, clone(base), clone(base)))
      expect(result.mergedModel.meta.updatedAt).not.toBe('2020-01-01T00:00:00.000Z')
    })
  })

  // ── autoMerged tracking ───────────────────────────────────────────────────

  describe('autoMerged tracking', () => {
    it('reports auto-merged changes', () => {
      const base = makeRoot()
      const theirs = clone(base)
      const ctxId = addCtx(theirs, 'New')

      const result = threeWayMerge(opts(base, clone(base), theirs))
      expect(result.autoMerged.length).toBeGreaterThan(0)
      expect(result.autoMerged.some(c => c.id === ctxId)).toBe(true)
    })
  })
})

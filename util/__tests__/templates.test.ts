import { describe, it, expect } from 'vitest'
import { reIdWithMapping } from '../templates'
import { createEmptyRootContext, createEmptyContext, createDefaultFacet } from '../../engine/apply'
import type { RootContext, Facet } from '../../types/context'

function makeBareRoot(): RootContext {
  // Use the engine factory so all standard facet shapes are present (Thing
  // needs attributes:[], Workflow needs steps:[], etc — reIdWithMapping walks
  // those internals).
  const root = createEmptyRootContext('Test')
  root.uri = 'root-1'
  return root
}

describe('reIdWithMapping — customFacets fidelity', () => {
  it('regenerates canvasNode uri and remaps representedBy through idMap', () => {
    const root = makeBareRoot()
    const thing = createDefaultFacet('things', 'Customer', 'thing-1')
    ;(root.facets.things as Facet[]).push(thing)
    root.customFacets = {
      canvasNode: [{
        uri: 'cnode-1',
        name: 'node:thing-1',
        x: 100, y: 20,
        width: 240, height: 80,
        zIndex: 3,
        representedBy: 'thing-1',
      } as unknown as Facet],
    }

    const { model, idMap } = reIdWithMapping(root)

    const newThingUri = idMap.get('thing-1')
    expect(newThingUri).toBeDefined()

    const cnodes = model.customFacets!.canvasNode as Array<Facet & { x: number; y: number; width: number; height: number; zIndex: number; representedBy: string }>
    expect(cnodes).toHaveLength(1)
    expect(cnodes[0]!.representedBy).toBe(newThingUri)
    expect(cnodes[0]!.uri).not.toBe('cnode-1')

    // Position fields must round-trip byte-exact
    expect(cnodes[0]!.x).toBe(100)
    expect(cnodes[0]!.y).toBe(20)
    expect(cnodes[0]!.width).toBe(240)
    expect(cnodes[0]!.height).toBe(80)
    expect(cnodes[0]!.zIndex).toBe(3)
  })

  it('preserves canvasEdge handles and remaps representedBy to remapped link', () => {
    const root = makeBareRoot()
    root.links = [{ uri: 'link-1', predicate: 'related' as never, sourceUri: 'a', targetUri: 'b' }]
    root.customFacets = {
      canvasEdge: [{
        uri: 'cedge-1',
        name: 'edge:link-1',
        sourceHandle: 'right',
        targetHandle: 'left',
        representedBy: 'link-1',
      } as unknown as Facet],
    }

    const { model, idMap } = reIdWithMapping(root)
    const newLinkUri = idMap.get('link-1')

    const edges = model.customFacets!.canvasEdge as Array<Facet & { sourceHandle: string; targetHandle: string; representedBy: string }>
    expect(edges[0]!.representedBy).toBe(newLinkUri)
    expect(edges[0]!.sourceHandle).toBe('right')
    expect(edges[0]!.targetHandle).toBe('left')
  })

  it('handles fractional and negative coordinates without drift', () => {
    const root = makeBareRoot()
    const thing = createDefaultFacet('things', 'X', 'thing-1')
    ;(root.facets.things as Facet[]).push(thing)
    root.customFacets = {
      canvasNode: [{
        uri: 'cnode-1', name: 'node:thing-1',
        x: -123.456, y: 0.30000000000000004,
        width: 200.5, height: 100.25, zIndex: 0,
        representedBy: 'thing-1',
      } as unknown as Facet],
    }
    const { model } = reIdWithMapping(root)
    const cnode = (model.customFacets!.canvasNode as any[])[0]
    expect(cnode.x).toBe(-123.456)
    expect(cnode.y).toBe(0.30000000000000004)
    expect(cnode.width).toBe(200.5)
    expect(cnode.height).toBe(100.25)
  })

  it('keeps representedBy unchanged when target was not remapped (orphan)', () => {
    const root = makeBareRoot()
    root.customFacets = {
      canvasNode: [{
        uri: 'cnode-1', name: 'node:gone',
        x: 0, y: 0, width: 200, height: 100, zIndex: 0,
        representedBy: 'never-existed-in-model',
      } as unknown as Facet],
    }
    const { model } = reIdWithMapping(root)
    const cnode = (model.customFacets!.canvasNode as any[])[0]
    // Orphan reference is preserved verbatim — the bridge filters orphans
    // at read time, and rewriting to a fresh nanoid would create a phantom
    // entity ID nothing else points at.
    expect(cnode.representedBy).toBe('never-existed-in-model')
  })

  it('does not break when customFacets is absent', () => {
    const root = makeBareRoot()
    expect(() => reIdWithMapping(root)).not.toThrow()
  })

  it('walks customFacets on sub-contexts too', () => {
    const root = makeBareRoot()
    const subCtx = createEmptyContext('Sub', root.uri)
    subCtx.uri = 'ctx-1'
    ;(subCtx as any).customFacets = {
      canvasNode: [{
        uri: 'sub-cnode',
        name: 'node:thing-1',
        x: 50, y: 60, width: 200, height: 100, zIndex: 0,
        representedBy: 'thing-1',
      } as unknown as Facet],
    }
    root.contexts[subCtx.uri] = subCtx

    const thing = createDefaultFacet('things', 'X', 'thing-1')
    ;(root.facets.things as Facet[]).push(thing)

    const { model, idMap } = reIdWithMapping(root)
    const newThingUri = idMap.get('thing-1')
    const newCtxUri = idMap.get('ctx-1')!

    const ctxCnodes = (model.contexts[newCtxUri] as any).customFacets.canvasNode as any[]
    expect(ctxCnodes[0]!.representedBy).toBe(newThingUri)
    expect(ctxCnodes[0]!.x).toBe(50)
    expect(ctxCnodes[0]!.y).toBe(60)
  })
})

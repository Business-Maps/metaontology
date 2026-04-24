/**
 * Triple store projection tests - to the meta-registry automatically propagates
 * into the triple projection without code changes. The projection is
 * registry-driven via `FACET_TYPES` - if someone ever hardcodes the list,
 * these tests should catch it.
 *
 * Coverage:
 *
 *  1. A Function in the root facets projects `rdf:type` → Function URI
 *     and `memberOf` → root context id.
 *  2. A Function in a sub-context facets projects with the sub-context
 *     as its `memberOf` target.
 *  3. `computes` links (Function → Thing) project as `(subject, 'computes',
 *     object)` triples.
 *  4. `calls` links (Function → Function, Action → Function, etc.)
 *     project correctly across the multiple allowed domain classes.
 *  5. Tag triples propagate for Functions.
 */

import { describe, it, expect } from 'vitest'
import { projectToTriples } from '../triples'
import { createEmptyRootContext } from '../apply'
import { getBmNamespace } from '../../meta/ontology'
import type { RootContext } from '../../types/context'

function makeFunction(id: string, name: string, extras: Record<string, unknown> = {}) {
  return {
    uri: id,
    name,
    description: '',
    tags: [],
    signature: {
      parameters: [],
      returns: { cardinality: 'scalar' as const },
    },
    body: { kind: 'expression' as const, source: '1' },
    stereotype: 'calculator' as const,
    purity: 'pure' as const,
    cacheable: false,
    visibility: 'internal' as const,
    ...extras,
  }
}

function makeThing(id: string, name: string) {
  return {
    uri: id,
    name,
    definition: '',
    description: '',
    attributes: [],
    rules: [],
    states: [],
    tags: [],
  } as any
}

describe('triples projection - Function facet (Phase 6)', () => {
  it('projects a root-level Function with rdf:type and memberOf', () => {
    const root: RootContext = createEmptyRootContext('Fn Proj Test')
    root.facets.functions.push(makeFunction('fn-1', 'addOne') as any)

    const triples = projectToTriples(root)

    const fnTypeT = triples.find(
      t => t.subject === 'fn-1' && t.predicate === 'rdf:type',
    )
    expect(fnTypeT).toBeDefined()
    expect(fnTypeT!.object).toBe(`${getBmNamespace()}Function`)

    const memberT = triples.find(
      t => t.subject === 'fn-1' && t.predicate === 'memberOf',
    )
    expect(memberT).toBeDefined()
    expect(memberT!.object).toBe(root.uri)

    const labelT = triples.find(
      t => t.subject === 'fn-1' && t.predicate === 'rdfs:label',
    )
    expect(labelT).toBeDefined()
    expect(labelT!.object).toBe('addOne')
  })

  it('projects a Function in a sub-context with the sub-context as memberOf', () => {
    const root: RootContext = createEmptyRootContext('Sub Ctx Test')
    root.contexts['sub-1'] = {
      uri: 'sub-1',
      name: 'Sub Context',
      description: '',
      parentUri: root.uri,
      facets: {
        things: [], personas: [], ports: [], actions: [],
        workflows: [], interfaces: [], events: [], measures: [],
        functions: [makeFunction('fn-sub', 'subFn') as any],
        datasources: [],
        pipelines: [],
      },
      symbols: [],
    } as any

    const triples = projectToTriples(root)
    const memberT = triples.find(
      t => t.subject === 'fn-sub' && t.predicate === 'memberOf',
    )
    expect(memberT).toBeDefined()
    expect(memberT!.object).toBe('sub-1')
  })

  it('projects `computes` links between a Function and a Thing', () => {
    const root: RootContext = createEmptyRootContext('Computes Test')
    root.facets.things.push(makeThing('thing-customer', 'Customer'))
    root.facets.functions.push(makeFunction('fn-ltv', 'calculateLTV') as any)
    root.links.push({
      uri: 'link-1',
      predicate: 'computes',
      sourceUri: 'fn-ltv',
      targetUri: 'thing-customer',
    } as any)

    const triples = projectToTriples(root)
    const computesT = triples.find(
      t => t.subject === 'fn-ltv' && t.predicate === 'computes',
    )
    expect(computesT).toBeDefined()
    expect(computesT!.object).toBe('thing-customer')
  })

  it('projects `calls` links between Functions', () => {
    const root: RootContext = createEmptyRootContext('Calls Test')
    root.facets.functions.push(
      makeFunction('fn-a', 'A') as any,
      makeFunction('fn-b', 'B') as any,
    )
    root.links.push({
      uri: 'link-calls',
      predicate: 'calls',
      sourceUri: 'fn-a',
      targetUri: 'fn-b',
    } as any)

    const triples = projectToTriples(root)
    const callsT = triples.find(
      t => t.subject === 'fn-a' && t.predicate === 'calls',
    )
    expect(callsT).toBeDefined()
    expect(callsT!.object).toBe('fn-b')
  })

  it('projects `calls` links from non-Function domain classes (Action)', () => {
    const root: RootContext = createEmptyRootContext('Action Calls Fn')
    root.facets.functions.push(makeFunction('fn-validate', 'validate') as any)
    root.facets.actions.push({
      uri: 'action-submit',
      name: 'Submit',
      type: 'command',
      description: '',
      tags: [],
    } as any)
    root.links.push({
      uri: 'link-action-calls',
      predicate: 'calls',
      sourceUri: 'action-submit',
      targetUri: 'fn-validate',
    } as any)

    const triples = projectToTriples(root)
    const callsT = triples.find(
      t => t.subject === 'action-submit' && t.predicate === 'calls',
    )
    expect(callsT).toBeDefined()
    expect(callsT!.object).toBe('fn-validate')
  })

  it('projects tags attached to Functions', () => {
    const root: RootContext = createEmptyRootContext('Function Tags')
    root.facets.functions.push(
      makeFunction('fn-tagged', 'taggedFn', { tags: ['financial', 'reviewed'] }) as any,
    )

    const triples = projectToTriples(root)
    const tags = triples
      .filter(t => t.subject === 'fn-tagged' && t.predicate === 'hasTag')
      .map(t => t.object)
      .sort()
    expect(tags).toEqual(['financial', 'reviewed'])
  })
})

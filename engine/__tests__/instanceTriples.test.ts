import { describe, it, expect } from 'vitest'
import { projectInstancesToTriples } from '../instanceTriples'
import { getBmNamespace } from '../../meta/ontology'
import type { RootContext } from '../../types/context'
import type { InstanceDataset } from '../../types/instance'

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

function makeModel(): RootContext {
  return {
    id: 'test-map',
    name: 'Test',
    description: '',
    contexts: {},
    links: [],
    symbols: [],
    facets: {
      things: [],
      personas: [],
      ports: [],
      actions: [],
      workflows: [],
      interfaces: [],
      events: [],
      measures: [],
    },
    meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  }
}

function makeEmptyDataset(): InstanceDataset {
  return {
    mapId: 'test-map',
    entities: [],
    relationships: [],
    events: [],
    workflows: [],
    measures: [],
  }
}

describe('projectInstancesToTriples', () => {
  it('produces rdf:type triple for entity', () => {
    const bmNamespace = getBmNamespace()
    const ds: InstanceDataset = {
      ...makeEmptyDataset(),
      entities: [
        {
          id: 'inst-1',
          thingId: 'thing-1',
          attributes: {},
          createdAt: '2026-01-01',
        },
      ],
    }

    const triples = projectInstancesToTriples(ds, makeModel())
    const typeTriple = triples.find(t => t.predicate === RDF_TYPE)
    expect(typeTriple).toBeDefined()
    expect(typeTriple!.subject).toBe(`${bmNamespace}instance/inst-1`)
    expect(typeTriple!.object).toBe(`${bmNamespace}thing/thing-1`)
  })

  it('produces attribute triples', () => {
    const bmNamespace = getBmNamespace()
    const ds: InstanceDataset = {
      ...makeEmptyDataset(),
      entities: [
        {
          id: 'inst-1',
          thingId: 'thing-1',
          attributes: {
            name: { type: 'text', value: 'Widget' },
            price: { type: 'decimal', value: 9.99 },
          },
          createdAt: '2026-01-01',
        },
      ],
    }

    const triples = projectInstancesToTriples(ds, makeModel())
    const nameTriple = triples.find(t => t.predicate === `${bmNamespace}attr/name`)
    const priceTriple = triples.find(t => t.predicate === `${bmNamespace}attr/price`)
    expect(nameTriple).toBeDefined()
    expect(nameTriple!.object).toBe('Widget')
    expect(priceTriple).toBeDefined()
    expect(priceTriple!.object).toBe('9.99')
  })

  it('produces relationship triple', () => {
    const bmNamespace = getBmNamespace()
    const ds: InstanceDataset = {
      ...makeEmptyDataset(),
      relationships: [
        {
          id: 'rel-1',
          predicate: 'relatedTo',
          sourceInstanceId: 'inst-1',
          targetInstanceId: 'inst-2',
          createdAt: '2026-01-01',
        },
      ],
    }

    const triples = projectInstancesToTriples(ds, makeModel())
    expect(triples).toHaveLength(1)
    expect(triples[0]!.subject).toBe(`${bmNamespace}instance/inst-1`)
    expect(triples[0]!.predicate).toBe(`${bmNamespace}relatedTo`)
    expect(triples[0]!.object).toBe(`${bmNamespace}instance/inst-2`)
  })

  it('returns empty array for empty dataset', () => {
    const triples = projectInstancesToTriples(makeEmptyDataset(), makeModel())
    expect(triples).toHaveLength(0)
  })
})

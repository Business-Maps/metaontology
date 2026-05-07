/**
 * M0 instance triple projection - project runtime data instances
 * into (S, P, O) triples alongside the M1 model triples.
 */

import type { RootContext } from '../types/context'
import type {
  InstanceDataset,
} from '../types/instance'
import { getBmNamespace } from '../meta/ontology'

export interface Triple {
  subject: string
  predicate: string
  object: string
}

/**
 * Project M0 instances to (S, P, O) triples.
 *
 * Each EntityInstance produces:
 *   (instance.id, rdf:type, thing.uri)
 *   (instance.id, bm:instanceOf, thingId)
 *   (instance.id, bm:attr/{attrName}, value) for each attribute
 *
 * Each RelationshipInstance produces:
 *   (sourceInstanceId, predicate, targetInstanceId)
 *
 * Each EventOccurrence produces:
 *   (event.id, rdf:type, bm:EventOccurrence)
 *   (event.id, bm:instanceOf, eventId)
 *   (event.id, bm:occurredAt, timestamp)
 *
 * Each MeasureDataPoint produces:
 *   (datapoint-id, rdf:type, bm:MeasureDataPoint)
 *   (datapoint-id, bm:measureOf, measureId)
 *   (datapoint-id, bm:value, value)
 */
export function projectInstancesToTriples(
  instances: InstanceDataset,
  _model: RootContext,
): Triple[] {
  const bmNamespace = getBmNamespace()
  const triples: Triple[] = []
  const rdfType = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

  // Entity instances
  for (const inst of instances.entities) {
    const instUri = `${bmNamespace}instance/${inst.id}`
    const thingUri = `${bmNamespace}thing/${inst.thingId}`

    triples.push({ subject: instUri, predicate: rdfType, object: thingUri })
    triples.push({ subject: instUri, predicate: `${bmNamespace}instanceOf`, object: inst.thingId })
    triples.push({ subject: instUri, predicate: `${bmNamespace}createdAt`, object: inst.createdAt })

    if (inst.contextId) {
      triples.push({ subject: instUri, predicate: `${bmNamespace}inContext`, object: inst.contextId })
    }

    for (const [attrName, attrValue] of Object.entries(inst.attributes)) {
      const value = typeof attrValue.value === 'object'
        ? JSON.stringify(attrValue.value)
        : String(attrValue.value)
      triples.push({ subject: instUri, predicate: `${bmNamespace}attr/${attrName}`, object: value })
    }
  }

  // Relationship instances
  for (const rel of instances.relationships) {
    const sourceUri = `${bmNamespace}instance/${rel.sourceInstanceId}`
    const targetUri = `${bmNamespace}instance/${rel.targetInstanceId}`
    triples.push({ subject: sourceUri, predicate: `${bmNamespace}${rel.predicate}`, object: targetUri })
  }

  // Event occurrences
  for (const evt of instances.events) {
    const evtUri = `${bmNamespace}event-occurrence/${evt.id}`
    triples.push({ subject: evtUri, predicate: rdfType, object: `${bmNamespace}EventOccurrence` })
    triples.push({ subject: evtUri, predicate: `${bmNamespace}instanceOf`, object: evt.eventId })
    triples.push({ subject: evtUri, predicate: `${bmNamespace}occurredAt`, object: evt.occurredAt })
    if (evt.sourceActionId) {
      triples.push({ subject: evtUri, predicate: `${bmNamespace}triggeredBy`, object: evt.sourceActionId })
    }
  }

  // Measure data points
  for (const mp of instances.measures) {
    const mpUri = `${bmNamespace}measure-point/${mp.measureId}/${mp.timestamp}`
    triples.push({ subject: mpUri, predicate: rdfType, object: `${bmNamespace}MeasureDataPoint` })
    triples.push({ subject: mpUri, predicate: `${bmNamespace}measureOf`, object: mp.measureId })
    triples.push({ subject: mpUri, predicate: `${bmNamespace}value`, object: String(mp.value) })
    triples.push({ subject: mpUri, predicate: `${bmNamespace}timestamp`, object: mp.timestamp })
    if (mp.dimensions) {
      for (const [dim, val] of Object.entries(mp.dimensions)) {
        triples.push({ subject: mpUri, predicate: `${bmNamespace}dimension/${dim}`, object: val })
      }
    }
  }

  return triples
}

/**
 * M0 triple projection - projects M0State into (S, P, O) triples
 * that merge with M1 triples in the same triple store.
 *
 * Every M0 entity (Instance, PipelineRun, RetryEntry, etc.) projects
 * as triples alongside M1 entities. The same query algebra operates
 * over both. This is the load-bearing claim of "the ontology is the bus."
 *
 * Dangling references (an M0 entity pointing at an M1 entity that was
 * removed) produce no triple - silent drop, same as M1's pruneDanglingLinks.
 */

import type { RootContext } from '../types/context'
import type { M0State } from '../types/m0'
import type { Triple } from './triples'

/**
 * Project all M0 entities into triples. Pure - no side effects.
 * Takes `model` for dangling-reference checks against M1 state.
 */
export function projectM0Triples(m0: M0State, _model: RootContext): Triple[] {
  const triples: Triple[] = []

  // ── Instances ──────────────────────────────────────────────────────────
  for (const [typeUri, instances] of Object.entries(m0.instances)) {
    for (const inst of Object.values(instances)) {
      triples.push({ subject: inst.uri, predicate: 'rdf:type', object: typeUri })
      const label = typeof inst.data?.name === 'string' ? inst.data.name : inst.uri
      triples.push({ subject: inst.uri, predicate: 'rdfs:label', object: label })
      if (inst.sourceUri) {
        triples.push({ subject: inst.uri, predicate: 'producedBy' as Triple['predicate'], object: inst.sourceUri })
      }
    }
  }

  // ── PipelineRuns ───────────────────────────────────────────────────────
  for (const run of Object.values(m0.pipelineRuns)) {
    triples.push({ subject: run.uri, predicate: 'rdf:type', object: 'PipelineRun' })
    triples.push({ subject: run.uri, predicate: 'rdfs:label', object: `Run ${run.uri}` })
    triples.push({ subject: run.uri, predicate: 'runFor' as Triple['predicate'], object: run.pipelineUri })
  }

  // ── RetryEntries ───────────────────────────────────────────────────────
  for (const entry of Object.values(m0.retryEntries)) {
    triples.push({ subject: entry.uri, predicate: 'rdf:type', object: 'RetryEntry' })
    triples.push({ subject: entry.targetUri, predicate: 'retried' as Triple['predicate'], object: entry.uri })
  }

  // ── Suppressions ───────────────────────────────────────────────────────
  for (const rec of Object.values(m0.suppressions)) {
    triples.push({ subject: rec.uri, predicate: 'rdf:type', object: 'SuppressionRecord' })
    triples.push({ subject: rec.pipelineUri, predicate: 'suppressed' as Triple['predicate'], object: rec.uri })
  }

  // ── ReplayPoints ───────────────────────────────────────────────────────
  for (const pt of Object.values(m0.replayPoints)) {
    triples.push({ subject: pt.uri, predicate: 'rdf:type', object: 'ReplayPoint' })
    triples.push({ subject: pt.pipelineUri, predicate: 'replayed' as Triple['predicate'], object: pt.uri })
  }

  // ── Deployments ────────────────────────────────────────────────────────
  for (const dep of Object.values(m0.deployments)) {
    triples.push({ subject: dep.uri, predicate: 'rdf:type', object: 'DeploymentRecord' })
    triples.push({ subject: dep.uri, predicate: 'rdfs:label', object: `Deployment ${dep.target}` })
    if (dep.previousDeploymentUri) {
      triples.push({ subject: dep.uri, predicate: 'regenerated' as Triple['predicate'], object: dep.previousDeploymentUri })
    }
  }

  // ── SimulationRuns ─────────────────────────────────────────────────────
  for (const sim of Object.values(m0.simulationRuns)) {
    triples.push({ subject: sim.uri, predicate: 'rdf:type', object: 'SimulationRun' })
    triples.push({ subject: sim.uri, predicate: 'rdfs:label', object: `Simulation ${sim.uri}` })
  }

  // ── WritebackQueue ─────────────────────────────────────────────────────
  for (const item of Object.values(m0.writebackQueue)) {
    triples.push({ subject: item.uri, predicate: 'rdf:type', object: 'WritebackQueueItem' })
    triples.push({ subject: item.pipelineUri, predicate: 'pendingWriteback' as Triple['predicate'], object: item.uri })
  }

  return triples
}

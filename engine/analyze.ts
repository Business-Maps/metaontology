/**
 * Pure analysis functions for gap detection, impact analysis, and pattern detection.
 * No Vue, no Pinia, no browser APIs.
 */
import type { RootContext } from '../types/context'
import type { EntityClassId } from '../meta/ontology'
import { getRegisteredFacetKeys, facetKeyToClass } from '../dsl/engineBridge'
import { resolveEntityName, resolveEntityType, findFacetOwner } from './query'

// ── Re-export the core gap evaluation ─────────────────────────────────────────

export { evaluateAllGaps } from './completeness'
export { deriveCompletenessLevel } from './completeness'
export type { CompletenessLevel } from './completeness'

// ── Impact analysis ───────────────────────────────────────────────────────────

export interface ImpactResult {
  entityUri: string
  entityName: string
  entityType: EntityClassId
  directDependents: Array<{ id: string, name: string, type: EntityClassId, predicate: string }>
  transitiveDependents: Array<{ id: string, name: string, type: EntityClassId, depth: number }>
  affectedContexts: string[]
  totalAffected: number
}

/** Compute the impact of changing or removing an entity by traversing all links. */
export function impactAnalysis(root: RootContext, entityUri: string): ImpactResult {
  const entityName = resolveEntityName(root, entityUri)
  const entityType = resolveEntityType(root, entityUri)

  // Direct dependents: entities that link TO this entity
  const directDependents: ImpactResult['directDependents'] = []
  for (const link of root.links) {
    if (link.targetUri === entityUri) {
      directDependents.push({
        id: link.sourceUri,
        name: resolveEntityName(root, link.sourceUri),
        type: resolveEntityType(root, link.sourceUri),
        predicate: link.predicate,
      })
    }
    if (link.sourceUri === entityUri) {
      directDependents.push({
        id: link.targetUri,
        name: resolveEntityName(root, link.targetUri),
        type: resolveEntityType(root, link.targetUri),
        predicate: link.predicate,
      })
    }
  }

  // Transitive dependents: BFS from direct dependents
  const visited = new Set<string>([entityUri])
  const queue: Array<{ id: string, depth: number }> = directDependents.map(d => ({ id: d.id, depth: 1 }))
  const transitiveDependents: ImpactResult['transitiveDependents'] = []

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    transitiveDependents.push({
      id,
      name: resolveEntityName(root, id),
      type: resolveEntityType(root, id),
      depth,
    })
    // Find next level
    for (const link of root.links) {
      if (link.sourceUri === id && !visited.has(link.targetUri)) {
        queue.push({ id: link.targetUri, depth: depth + 1 })
      }
      if (link.targetUri === id && !visited.has(link.sourceUri)) {
        queue.push({ id: link.sourceUri, depth: depth + 1 })
      }
    }
  }

  // Affected contexts
  const affectedContextIds = new Set<string>()
  for (const dep of transitiveDependents) {
    if (dep.type === 'Context') {
      affectedContextIds.add(dep.id)
    } else {
      // Find the owning context of this facet
      for (const c of [root, ...Object.values(root.contexts)] as any[]) {
        for (const key of getRegisteredFacetKeys()) {
          if ((c[key] ?? []).some((x: any) => x.id === dep.id)) {
            affectedContextIds.add(c.uri)
          }
        }
      }
    }
  }

  return {
    entityUri,
    entityName,
    entityType,
    directDependents,
    transitiveDependents,
    affectedContexts: [...affectedContextIds].map(id => resolveEntityName(root, id)),
    totalAffected: transitiveDependents.length,
  }
}

// ── Pattern detection ─────────────────────────────────────────────────────────

export interface DetectedPattern {
  pattern: string
  severity: 'error' | 'warning' | 'info'
  message: string
  entityIds: string[]
}

/** Detect common DDD patterns and anti-patterns in the model. */
export function detectPatterns(root: RootContext): DetectedPattern[] {
  const patterns: DetectedPattern[] = []
  const contexts = Object.values(root.contexts)

  // God context: more than 20 facets
  for (const c of contexts) {
    let facetCount = 0
    for (const key of getRegisteredFacetKeys()) {
      facetCount += ((c as any)[key] ?? []).length
    }
    if (facetCount > 20) {
      patterns.push({
        pattern: 'god-context',
        severity: 'warning',
        message: `Context "${c.name}" has ${facetCount} facets - consider splitting into smaller bounded contexts`,
        entityIds: [c.uri],
      })
    }
  }

  // Shared kernel: same Thing name in 2+ contexts
  const thingNames = new Map<string, string[]>()
  for (const c of [root, ...contexts] as any[]) {
    for (const t of (c.things ?? []) as any[]) {
      const lower = t.name.toLowerCase()
      if (!thingNames.has(lower)) thingNames.set(lower, [])
      thingNames.get(lower)!.push(c.uri)
    }
  }
  for (const [name, ctxIds] of thingNames) {
    if (ctxIds.length >= 2) {
      patterns.push({
        pattern: 'shared-kernel',
        severity: 'info',
        message: `Thing "${name}" appears in ${ctxIds.length} contexts - potential shared kernel or polysemous term requiring separate definitions`,
        entityIds: ctxIds,
      })
    }
  }

  // Orphan entities: facets with no links at all
  const linkedIds = new Set<string>()
  for (const link of root.links) {
    linkedIds.add(link.sourceUri)
    linkedIds.add(link.targetUri)
  }
  for (const c of [root, ...contexts] as any[]) {
    for (const key of getRegisteredFacetKeys()) {
      for (const facet of (c[key] ?? []) as any[]) {
        if (!linkedIds.has(facet.uri)) {
          const cls = facetKeyToClass(key) as EntityClassId
          patterns.push({
            pattern: 'orphan-entity',
            severity: 'info',
            message: `${cls} "${facet.name}" has no links - consider connecting it to other entities`,
            entityIds: [facet.uri],
          })
        }
      }
    }
  }

  // Circular value streams
  const vsLinks = root.links.filter(l => l.predicate === 'valueStream')
  const vsGraph = new Map<string, string[]>()
  for (const l of vsLinks) {
    if (!vsGraph.has(l.sourceUri)) vsGraph.set(l.sourceUri, [])
    vsGraph.get(l.sourceUri)!.push(l.targetUri)
  }
  // Simple cycle detection via DFS
  const visited = new Set<string>()
  const inStack = new Set<string>()
  function hasCycle(node: string, path: string[]): string[] | null {
    if (inStack.has(node)) return [...path, node]
    if (visited.has(node)) return null
    visited.add(node)
    inStack.add(node)
    for (const next of (vsGraph.get(node) ?? [])) {
      const cycle = hasCycle(next, [...path, node])
      if (cycle) return cycle
    }
    inStack.delete(node)
    return null
  }
  for (const startNode of vsGraph.keys()) {
    if (!visited.has(startNode)) {
      const cycle = hasCycle(startNode, [])
      if (cycle) {
        patterns.push({
          pattern: 'circular-value-stream',
          severity: 'warning',
          message: `Circular value stream detected: ${cycle.map(id => resolveEntityName(root, id)).join(' → ')}`,
          entityIds: cycle,
        })
        break
      }
    }
  }

  // Orphan port: a port with no valueStream link connecting it to another port or context
  const allPorts: Array<{ id: string, name: string, contextId: string }> = []
  for (const c of [root, ...contexts] as any[]) {
    for (const port of (c.ports ?? []) as any[]) {
      allPorts.push({ id: port.id, name: port.name, contextId: c.uri })
    }
  }
  for (const port of allPorts) {
    const hasValueStream = root.links.some(
      l => l.predicate === 'valueStream' && (l.sourceUri === port.id || l.targetUri === port.id),
    )
    if (!hasValueStream) {
      patterns.push({
        pattern: 'orphan-port',
        severity: 'warning',
        message: `Port "${port.name}" has no value stream link - boundary contract goes nowhere`,
        entityIds: [port.id],
      })
    }
  }

  // Empty port: a port with no produces or consumes links
  for (const port of allPorts) {
    const hasContent = root.links.some(
      l => (l.predicate === 'produces' || l.predicate === 'consumes') && l.sourceUri === port.id,
    )
    if (!hasContent) {
      patterns.push({
        pattern: 'empty-port',
        severity: 'info',
        message: `Port "${port.name}" has no produces or consumes links - boundary declaration with no content`,
        entityIds: [port.id],
      })
    }
  }

  // Bypassed port: cross-context facet links that bypass existing ports
  const excludedPredicates = new Set(['valueStream', 'sameConceptAs', 'extends', 'custom', 'dependsOn'])
  const contextsWithPorts = new Set<string>(allPorts.map(p => p.contextId))
  for (const link of root.links) {
    if (excludedPredicates.has(link.predicate)) continue
    const sourceOwner = findFacetOwner(root, link.sourceUri)
    const targetOwner = findFacetOwner(root, link.targetUri)
    if (!sourceOwner || !targetOwner) continue
    if (sourceOwner.context.uri === targetOwner.context.uri) continue
    if (contextsWithPorts.has(sourceOwner.context.uri)) {
      patterns.push({
        pattern: 'bypassed-port',
        severity: 'warning',
        message: `Link "${link.predicate}" from "${resolveEntityName(root, link.sourceUri)}" to "${resolveEntityName(root, link.targetUri)}" crosses context boundary bypassing ports in "${sourceOwner.context.name}"`,
        entityIds: [link.sourceUri, link.targetUri],
      })
    }
  }

  return patterns
}

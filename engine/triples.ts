/**
 * Pure Triple Store - projects the typed RootContext model into
 * (subject, predicate, object) triples for O(1) lookups on any axis.
 *
 * The typed model remains the write layer (safe, ergonomic, backward-compatible).
 * This module contains the pure projection, indexing, and RDF serialisation logic
 * with no Vue dependency. The reactive wrapper lives in the consumer layer.
 *
 * Structural predicates (childOf, memberOf) are derived from the typed model.
 * Stored predicates (performs, owns, etc.) are mapped from Link objects.
 * Reference attributes on Things produce additional `references` triples.
 *
 * Enables: unified query API, RDF/Turtle export, vector embedding, validation.
 */

import type { RootContext, Context, Facet, Symbol } from '../types/context'
import type { PredicateId } from '../meta/ontology'
import { ENTITY_CLASSES, getBmNamespace } from '../meta/ontology'
import { getRegisteredFacetKeys, facetKeyToClass } from '../dsl/engineBridge'

// ── Triple type ──────────────────────────────────────────────────────────────

export interface Triple {
  subject: string
  predicate: PredicateId | 'rdf:type' | 'rdfs:label'
  object: string
}

// ── Composite key helpers ────────────────────────────────────────────────────

const SEP = '\0'
export function sp(s: string, p: string): string { return `${s}${SEP}${p}` }
export function po(p: string, o: string): string { return `${p}${SEP}${o}` }
export function spo(s: string, p: string, o: string): string { return `${s}${SEP}${p}${SEP}${o}` }

// ── Pure query interface (no Vue) ───────────────────────────────────────────
// Used by ontology engine functions as a parameter type. The reactive
// The consumer's reactive triple index satisfies this interface.

export interface TripleQueryIndex {
  objectIds: (s: string, p: PredicateId) => string[]
  subjectIds: (o: string, p: PredicateId) => string[]
}

// ── Index type (plain, no Vue) ──────────────────────────────────────────────

export interface TripleIndexData {
  byS: Map<string, Triple[]>
  byP: Map<string, Triple[]>
  byO: Map<string, Triple[]>
  bySP: Map<string, Triple[]>
  byPO: Map<string, Triple[]>
  bySPO: Set<string>
  typeOf: Map<string, string>
}

// ── Projection: RootContext → Triple[] ───────────────────────────────────────

export function projectToTriples(root: Readonly<RootContext>): Triple[] {
  const triples: Triple[] = []

  // ── Root context ────────────────────────────────────────────────────────
  triples.push(
    { subject: root.uri, predicate: 'rdf:type', object: ENTITY_CLASSES.Context.uri },
    { subject: root.uri, predicate: 'rdfs:label', object: root.name },
  )
  for (const tag of root.tags ?? []) {
    triples.push({ subject: root.uri, predicate: 'hasTag', object: tag })
  }

  // Root-level facets
  emitFacetTriples(root, root.uri, triples)
  emitWorkflowStepTriples(root, triples)
  emitThingStateTriples(root, triples)
  emitCustomFacetTriples(root, root.uri, root.customTypes ?? [], triples)

  // Root-level symbols
  for (const symbol of root.symbols) {
    emitSymbolTriples(symbol, root.uri, triples)
  }

  // ── Sub-contexts ────────────────────────────────────────────────────────
  for (const ctx of Object.values(root.contexts)) {
    triples.push(
      { subject: ctx.uri, predicate: 'rdf:type', object: ENTITY_CLASSES.Context.uri },
      { subject: ctx.uri, predicate: 'rdfs:label', object: ctx.name },
      { subject: ctx.uri, predicate: 'childOf', object: ctx.parentUri },
    )
    for (const tag of ctx.tags ?? []) {
      triples.push({ subject: ctx.uri, predicate: 'hasTag', object: tag })
    }

    emitFacetTriples(ctx, ctx.uri, triples)
    emitWorkflowStepTriples(ctx, triples)
    emitThingStateTriples(ctx, triples)
    emitCustomFacetTriples(ctx, ctx.uri, root.customTypes ?? [], triples)

    // Context-level symbols
    for (const symbol of ctx.symbols) {
      emitSymbolTriples(symbol, ctx.uri, triples)
    }
  }

  // ── Stored links → triples ──────────────────────────────────────────────
  for (const link of root.links) {
    triples.push({
      subject: link.sourceUri,
      predicate: link.predicate as PredicateId,
      object: link.targetUri,
    })
  }

  // ── Computed workflow-level triples ──────────────────────────────────────
  emitComputedWorkflowTriples(root, triples)

  // ── Reference attributes → triples ──────────────────────────────────────
  // (These are data, not stored as Links - but semantically they're triples)
  emitReferenceTriples(root, triples)
  for (const ctx of Object.values(root.contexts)) {
    emitReferenceTriples(ctx, triples)
  }

  // ── Inherited attributes → triples ─────────────────────────────────────
  emitInheritedAttributeTriples(root, triples)

  return triples
}

/** Emit triples for user-defined entity type instances stored in customFacets. */
function emitCustomFacetTriples(
  container: Readonly<RootContext> | Readonly<Context>,
  contextId: string,
  customTypes: readonly { id: string; pluralKey: string }[],
  triples: Triple[],
): void {
  const bmNamespace = getBmNamespace()
  if (!container.customFacets) return
  for (const ct of customTypes) {
    const arr = container.customFacets[ct.pluralKey]
    if (!arr?.length) continue
    const classUri = `${bmNamespace}custom/${ct.id}`
    for (const entity of arr) {
      triples.push(
        { subject: (entity as any).uri, predicate: 'rdf:type', object: classUri },
        { subject: (entity as any).uri, predicate: 'memberOf', object: contextId },
        { subject: (entity as any).uri, predicate: 'rdfs:label', object: (entity as any).name ?? (entity as any).uri },
      )
      // Tag triples
      for (const tag of (entity as any).tags ?? []) {
        triples.push({ subject: (entity as any).uri, predicate: 'hasTag', object: tag })
      }
    }
  }
}

function emitFacetTriples(
  container: Readonly<RootContext> | Readonly<Context>,
  contextId: string,
  triples: Triple[],
): void {
  for (const ft of getRegisteredFacetKeys()) {
    const entityClass = facetKeyToClass(ft)
    if (!entityClass) continue
    const classDef = ENTITY_CLASSES[entityClass as keyof typeof ENTITY_CLASSES]
    if (!classDef) continue
    const classUri = classDef.uri
    const arr = container.facets[ft] as readonly Facet[]
    for (const facet of arr) {
      triples.push(
        { subject: facet.uri, predicate: 'rdf:type', object: classUri },
        { subject: facet.uri, predicate: 'memberOf', object: contextId },
        { subject: facet.uri, predicate: 'rdfs:label', object: (facet as any).name ?? facet.uri },
      )
      // Tag triples
      for (const tag of (facet as any).tags ?? []) {
        triples.push({ subject: facet.uri, predicate: 'hasTag', object: tag })
      }
      // Payload/schema → Thing derivation triples
      for (const field of (facet as any).payload ?? []) {
        if (field.sourceThingId) {
          triples.push({ subject: facet.uri, predicate: 'derivedPayloadFrom' as any, object: field.sourceThingId })
        }
      }
      for (const field of [...((facet as any).requestSchema ?? []), ...((facet as any).responseSchema ?? [])]) {
        if (field.sourceThingId) {
          triples.push({ subject: facet.uri, predicate: 'derivedPayloadFrom' as any, object: field.sourceThingId })
        }
      }
    }
  }
}

function emitWorkflowStepTriples(
  container: Readonly<RootContext> | Readonly<Context>,
  triples: Triple[],
): void {
  for (const workflow of container.facets.workflows) {
    for (const step of workflow.steps) {
      triples.push(
        { subject: step.id, predicate: 'rdf:type', object: ENTITY_CLASSES.WorkflowStep.uri },
        { subject: step.id, predicate: 'memberOf', object: workflow.uri },
        { subject: step.id, predicate: 'rdfs:label', object: step.name ?? step.id },
      )
    }
  }
}

function emitThingStateTriples(
  container: Readonly<RootContext> | Readonly<Context>,
  triples: Triple[],
): void {
  for (const thing of container.facets.things) {
    for (const state of thing.states ?? []) {
      triples.push(
        { subject: state.id, predicate: 'rdf:type', object: ENTITY_CLASSES.ThingState.uri },
        { subject: state.id, predicate: 'state:memberOf', object: thing.uri },
        { subject: state.id, predicate: 'rdfs:label', object: state.name },
      )
      for (const tr of state.transitions ?? []) {
        triples.push({
          subject: state.id,
          predicate: 'state:transitionsTo',
          object: tr.targetStateId,
        })
      }
    }
  }
}

function emitComputedWorkflowTriples(
  root: Readonly<RootContext>,
  triples: Triple[],
): void {
  // Build step → workflow map from root and all contexts
  const stepToWorkflow = new Map<string, string>()
  for (const workflow of root.facets.workflows) {
    for (const step of workflow.steps) {
      stepToWorkflow.set(step.id, workflow.uri)
    }
  }
  for (const ctx of Object.values(root.contexts)) {
    for (const workflow of ctx.facets.workflows) {
      for (const step of workflow.steps) {
        stepToWorkflow.set(step.id, workflow.uri)
      }
    }
  }

  // Deduplicate: track emitted (workflowId, predicate, targetId) combos
  const seen = new Set<string>()

  for (const link of root.links) {
    if (link.predicate === 'step:performer' || link.predicate === 'step:action') {
      const workflowId = stepToWorkflow.get(link.sourceUri)
      if (!workflowId) continue

      const predicate: PredicateId = link.predicate === 'step:performer'
        ? 'workflow:involvesPersona'
        : 'workflow:involvesAction'
      const key = `${workflowId}\0${predicate}\0${link.targetUri}`
      if (seen.has(key)) continue
      seen.add(key)

      triples.push({
        subject: workflowId,
        predicate,
        object: link.targetUri,
      })
    }
  }
}

function emitReferenceTriples(
  container: Readonly<RootContext> | Readonly<Context>,
  triples: Triple[],
): void {
  for (const thing of container.facets.things) {
    for (const attr of thing.attributes) {
      if (attr.type === 'reference' && attr.referencedThingId) {
        triples.push({
          subject: thing.uri,
          predicate: 'references',
          object: attr.referencedThingId,
        })
      }
    }
  }
}

/**
 * Emit triples for attributes inherited via `extends` links.
 * Each inherited attribute produces a triple: childThing → bm:inheritedAttribute → "attrName:attrType:parentId"
 * Only attributes not overridden by the child (by name) are emitted.
 */
function emitInheritedAttributeTriples(
  root: Readonly<RootContext>,
  triples: Triple[],
): void {
  const extendsLinks = root.links.filter(l => l.predicate === 'extends')
  if (!extendsLinks.length) return

  // Build a quick lookup: thingId → Thing
  const thingById = new Map<string, Readonly<{ uri: string; name: string; attributes: readonly any[] }>>()
  for (const t of root.facets.things) thingById.set(t.uri, t)
  for (const ctx of Object.values(root.contexts)) {
    for (const t of ctx.facets.things) thingById.set(t.uri, t)
  }

  for (const link of extendsLinks) {
    const child = thingById.get(link.sourceUri)
    const parent = thingById.get(link.targetUri)
    if (!child || !parent) continue

    const ownNames = new Set((child.attributes ?? []).map((a: any) => a.name))

    for (const attr of parent.attributes ?? []) {
      if (!ownNames.has(attr.name)) {
        triples.push({
          subject: child.uri,
          predicate: 'inheritedAttribute',
          object: `${attr.name}:${attr.type}:${parent.uri}`,
        })
      }
    }
  }
}

/** Emit triples for a Symbol: type, membership, label, tags, and @mention links. */
const MENTION_RE = /@\[[^\]]*\]\(entity:([^)]+)\)/g

function emitSymbolTriples(
  symbol: Readonly<Symbol>,
  containerId: string,
  triples: Triple[],
): void {
  triples.push(
    { subject: symbol.uri, predicate: 'rdf:type', object: ENTITY_CLASSES.Symbol.uri },
    { subject: symbol.uri, predicate: 'memberOf', object: containerId },
    { subject: symbol.uri, predicate: 'rdfs:label', object: symbol.label ?? symbol.content.slice(0, 100) },
  )
  for (const tag of symbol.tags ?? []) {
    triples.push({ subject: symbol.uri, predicate: 'hasTag', object: tag })
  }
  // Scan content for @[Name](entity:id) mention patterns
  let match: RegExpExecArray | null
  MENTION_RE.lastIndex = 0
  while ((match = MENTION_RE.exec(symbol.content)) !== null) {
    const entityId = match[1]
    if (entityId) {
      triples.push({
        subject: symbol.uri,
        predicate: 'mentions' as PredicateId,
        object: entityId,
      })
    }
  }
}

// ── Index builder ────────────────────────────────────────────────────────────

export function buildIndexes(triples: Triple[]): TripleIndexData {
  const byS = new Map<string, Triple[]>()
  const byP = new Map<string, Triple[]>()
  const byO = new Map<string, Triple[]>()
  const bySP = new Map<string, Triple[]>()
  const byPO = new Map<string, Triple[]>()
  const bySPO = new Set<string>()
  const typeOf = new Map<string, string>()

  for (const t of triples) {
    // bySubject
    const sArr = byS.get(t.subject)
    if (sArr) sArr.push(t)
    else byS.set(t.subject, [t])

    // byPredicate
    const pArr = byP.get(t.predicate)
    if (pArr) pArr.push(t)
    else byP.set(t.predicate, [t])

    // byObject
    const oArr = byO.get(t.object)
    if (oArr) oArr.push(t)
    else byO.set(t.object, [t])

    // bySP
    const spKey = sp(t.subject, t.predicate)
    const spArr = bySP.get(spKey)
    if (spArr) spArr.push(t)
    else bySP.set(spKey, [t])

    // byPO
    const poKey = po(t.predicate, t.object)
    const poArr = byPO.get(poKey)
    if (poArr) poArr.push(t)
    else byPO.set(poKey, [t])

    // bySPO
    bySPO.add(spo(t.subject, t.predicate, t.object))

    // Type index
    if (t.predicate === 'rdf:type') {
      // Map URI back to EntityClassId
      for (const [key, cls] of Object.entries(ENTITY_CLASSES)) {
        if (cls.uri === t.object) {
          typeOf.set(t.subject, key)
          break
        }
      }
    }
  }

  return { byS, byP, byO, bySP, byPO, bySPO, typeOf }
}

// ── RDF Export ────────────────────────────────────────────────────────────────

/** Escape for N-Triples string literal. */
function escNT(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')
}

/** Resolve a predicate id to its full URI. */
function predicateURI(p: string): string {
  const bmNamespace = getBmNamespace()
  if (p === 'rdf:type') return 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
  if (p === 'rdfs:label') return 'http://www.w3.org/2000/01/rdf-schema#label'
  return `${bmNamespace}${p.replace(':', '_')}`
}

/** Resolve an object to a URI or literal. */
function objectValue(t: Triple): string {
  const bmNamespace = getBmNamespace()
  // Labels are literals
  if (t.predicate === 'rdfs:label') return `"${escNT(t.object)}"`
  // Type objects are already URIs
  if (t.predicate === 'rdf:type') return `<${t.object}>`
  // Everything else is a resource reference
  return `<${bmNamespace}entity/${encodeURIComponent(t.object)}>`
}

/**
 * Serialise triples as N-Triples (simplest RDF format, one triple per line).
 * Suitable for import into any triple store, SPARQL endpoint, or graph database.
 *
 * Pass optional `instanceTriples` to include M0 data in the same output.
 */
export function serialiseAsNTriples(
  triples: Triple[],
  instanceTriples?: { subject: string, predicate: string, object: string }[],
): string {
  const bmNamespace = getBmNamespace()
  const m1 = triples.map(t =>
    `<${bmNamespace}entity/${encodeURIComponent(t.subject)}> <${predicateURI(t.predicate)}> ${objectValue(t)} .`,
  )
  const m0 = (instanceTriples ?? []).map(t => {
    const subj = t.subject.startsWith('http') ? `<${t.subject}>` : `<${bmNamespace}entity/${encodeURIComponent(t.subject)}>`
    const pred = t.predicate.startsWith('http') ? `<${t.predicate}>` : `<${predicateURI(t.predicate)}>`
    const obj = t.object.startsWith('http') ? `<${t.object}>` : `"${t.object}"`
    return `${subj} ${pred} ${obj} .`
  })
  return [...m1, ...m0].join('\n')
}

/**
 * Serialise triples as Turtle (human-readable RDF).
 * Groups by subject for readability.
 *
 * Pass optional `instanceTriples` to include M0 data in a separate section.
 */
export function serialiseAsTurtle(
  triples: Triple[],
  instanceTriples?: { subject: string, predicate: string, object: string }[],
): string {
  const bmNamespace = getBmNamespace()
  const lines: string[] = [
    `@prefix bm: <${bmNamespace}> .`,
    `@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .`,
    `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`,
    '',
  ]

  // Group by subject
  const grouped = new Map<string, Triple[]>()
  for (const t of triples) {
    const arr = grouped.get(t.subject)
    if (arr) arr.push(t)
    else grouped.set(t.subject, [t])
  }

  for (const [subject, subTriples] of grouped) {
    lines.push(`bm:entity/${encodeURIComponent(subject)}`)
    for (let i = 0; i < subTriples.length; i++) {
      const t = subTriples[i]!
      const pred = t.predicate === 'rdf:type' ? 'a'
        : t.predicate === 'rdfs:label' ? 'rdfs:label'
        : `bm:${t.predicate.replace(':', '_')}`
      const obj = objectValue(t)
      const sep = i < subTriples.length - 1 ? ' ;' : ' .'
      lines.push(`  ${pred} ${obj}${sep}`)
    }
    lines.push('')
  }

  // M0 instance triples (if provided)
  if (instanceTriples && instanceTriples.length > 0) {
    lines.push('# ── M0 instance data ─────────────────────────────────────────────────────', '')
    const m0Grouped = new Map<string, typeof instanceTriples>()
    for (const t of instanceTriples) {
      const arr = m0Grouped.get(t.subject)
      if (arr) arr.push(t)
      else m0Grouped.set(t.subject, [t])
    }
    for (const [subject, subTriples] of m0Grouped) {
      const subj = subject.startsWith('http') ? `<${subject}>` : `bm:entity/${encodeURIComponent(subject)}`
      lines.push(subj)
      for (let i = 0; i < subTriples.length; i++) {
        const t = subTriples[i]!
        const pred = t.predicate.startsWith('http')
          ? `<${t.predicate}>`
          : `bm:${t.predicate.replace(':', '_')}`
        const obj = t.object.startsWith('http') ? `<${t.object}>` : `"${t.object}"`
        const sep = i < subTriples.length - 1 ? ' ;' : ' .'
        lines.push(`  ${pred} ${obj}${sep}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}

/**
 * Serialise triples as JSON-LD (for web APIs and semantic tooling).
 *
 * Pass optional `instanceTriples` to include M0 data in the `@graph`.
 */
export function serialiseAsJsonLd(
  triples: Triple[],
  instanceTriples?: { subject: string, predicate: string, object: string }[],
): string {
  const bmNamespace = getBmNamespace()
  const context: Record<string, string> = {
    bm: bmNamespace,
    rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  }

  // Group by subject
  const nodes: Record<string, any>[] = []
  const grouped = new Map<string, Triple[]>()
  for (const t of triples) {
    const arr = grouped.get(t.subject)
    if (arr) arr.push(t)
    else grouped.set(t.subject, [t])
  }

  for (const [subject, subTriples] of grouped) {
    const node: Record<string, any> = { '@id': `bm:entity/${subject}` }
    for (const t of subTriples) {
      if (t.predicate === 'rdf:type') {
        node['@type'] = t.object
      } else if (t.predicate === 'rdfs:label') {
        node['rdfs:label'] = t.object
      } else {
        const key = `bm:${t.predicate.replace(':', '_')}`
        const existing = node[key]
        const value = { '@id': `bm:entity/${t.object}` }
        if (existing) {
          node[key] = Array.isArray(existing) ? [...existing, value] : [existing, value]
        } else {
          node[key] = value
        }
      }
    }
    nodes.push(node)
  }

  // M0 instance triples (if provided)
  if (instanceTriples && instanceTriples.length > 0) {
    const m0Grouped = new Map<string, typeof instanceTriples>()
    for (const t of instanceTriples) {
      const arr = m0Grouped.get(t.subject)
      if (arr) arr.push(t)
      else m0Grouped.set(t.subject, [t])
    }
    for (const [subject, subTriples] of m0Grouped) {
      const node: Record<string, any> = { '@id': subject }
      for (const t of subTriples) {
        const rdfType = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
        if (t.predicate === rdfType || t.predicate === 'rdf:type') {
          node['@type'] = t.object
        } else {
          const key = t.predicate.startsWith('http') ? t.predicate : `bm:${t.predicate}`
          const existing = node[key]
          const value = t.object.startsWith('http') ? { '@id': t.object } : t.object
          if (existing) {
            node[key] = Array.isArray(existing) ? [...existing, value] : [existing, value]
          } else {
            node[key] = value
          }
        }
      }
      nodes.push(node)
    }
  }

  return JSON.stringify({ '@context': context, '@graph': nodes }, null, 2)
}

/**
 * Pure query functions that operate on a plain RootContext.
 * No Vue, no Pinia, no browser APIs - importable by both the Nuxt app and the MCP server.
 */
import type { RootContext, Context, FacetContainer, ActionCondition } from '../types/context'
import type { SetExpr, FilterExpr, AggregateExpr, SetResult } from '../types/query'
import type { EntityClassId } from '../meta/ontology'
import { getStoredPredicates } from '../meta/ontology'
import { getRegisteredFacetKeys, facetKeyToClass, getClassToFacetKeyMap } from '../dsl/engineBridge'
import { resolvePredicateLabel, resolvePredicateInverseLabel } from '../meta/vocabulary'

/** Extract human-readable text from an ActionCondition (typed or legacy string). */
function conditionText(c: ActionCondition | string): string {
  if (typeof c === 'string') return c
  return c.description ?? `${c.type} condition`
}

// ── Entity resolution ─────────────────────────────────────────────────────────

/** Find a context by ID or name (case-insensitive name fallback). Accepts root ID. */
export function resolveContextId(root: RootContext, idOrName: string): string | null {
  if (idOrName === root.uri) return idOrName
  if (root.contexts[idOrName]) return idOrName
  const found = Object.values(root.contexts).find(
    c => c.name.toLowerCase() === idOrName.toLowerCase(),
  )
  return found?.uri ?? null
}

/** Get a context object (including root-as-context) by resolved ID. */
export function getContextObj(root: RootContext, id: string): RootContext | Context | null {
  if (id === root.uri) return root
  return root.contexts[id] ?? null
}

/** Query link target IDs for a given source and predicate. */
export function linkTargets(root: RootContext, sourceId: string, predicate: string): string[] {
  return root.links.filter(l => l.predicate === predicate && l.sourceUri === sourceId).map(l => l.targetUri)
}

/** Query link source IDs for a given target and predicate. */
export function linkSources(root: RootContext, targetId: string, predicate: string): string[] {
  return root.links.filter(l => l.predicate === predicate && l.targetUri === targetId).map(l => l.sourceUri)
}

/** Resolve any entity name by ID across all contexts. Returns the ID itself if not found. */
export function resolveEntityName(root: RootContext, id: string): string {
  if (id === root.uri) return root.name
  const ctx = root.contexts[id]
  if (ctx) return ctx.name
  for (const c of [root, ...Object.values(root.contexts)] as any[]) {
    for (const key of getRegisteredFacetKeys()) {
      const item = (c.facets[key] ?? []).find((x: any) => x.uri === id)
      if (item) return item.name ?? item.label ?? id
    }
    const symbol = (c.symbols ?? []).find((x: any) => x.uri === id)
    if (symbol) return symbol.label ?? symbol.content?.slice(0, 80) ?? id
  }
  return id
}

/** Resolve the entity class (Thing, Persona, Context, etc.) for an entity ID. */
export function resolveEntityType(root: RootContext, id: string): EntityClassId {
  if (getContextObj(root, id)) return 'Context'
  for (const c of [root, ...Object.values(root.contexts)] as any[]) {
    for (const key of getRegisteredFacetKeys()) {
      if ((c.facets[key] ?? []).some((x: any) => x.uri === id)) {
        return facetKeyToClass(key) as EntityClassId
      }
    }
    if ((c.symbols ?? []).some((x: any) => x.uri === id)) return 'Symbol'
  }
  return 'Context'
}

/** Find the context that owns a facet by ID. Returns { context, facetType } or null. */
export function findFacetOwner(root: RootContext, facetUri: string): { context: RootContext | Context, facetType: string } | null {
  for (const c of [root, ...Object.values(root.contexts)] as (RootContext | Context)[]) {
    for (const key of getRegisteredFacetKeys()) {
      if ((c.facets[key] as any[] ?? []).some((x: any) => x.uri === facetUri)) {
        return { context: c, facetType: key }
      }
    }
  }
  return null
}

/** Find a link by ID. */
export function resolveLinkId(root: RootContext, id: string): string | null {
  return root.links.find(l => l.uri === id) ? id : null
}

// ── Entity link description ───────────────────────────────────────────────────

const _linkablePredicates = getStoredPredicates().filter(p => !p.uri.startsWith('step:'))

/** Describe all links connected to an entity, using human-friendly predicate labels. */
export function describeEntityLinks(root: RootContext, entityUri: string, entityType: EntityClassId): string[] {
  const lines: string[] = []
  for (const pred of _linkablePredicates) {
    if (pred.domain.includes(entityType)) {
      const targets = linkTargets(root, entityUri, pred.id)
      if (targets.length) {
        const label = resolvePredicateLabel(pred.id, 'business')
        lines.push(`${label}: ${targets.map(id => resolveEntityName(root, id)).join(', ')}`)
      }
    }
    if (pred.range.includes(entityType)) {
      const sources = linkSources(root, entityUri, pred.id)
      if (sources.length) {
        const label = resolvePredicateInverseLabel(pred.id, 'business')
        lines.push(`${label}: ${sources.map(id => resolveEntityName(root, id)).join(', ')}`)
      }
    }
  }
  return lines
}

// ── High-level query functions ────────────────────────────────────────────────

/** List all contexts as a hierarchical tree string. */
export function listContexts(root: RootContext): string {
  const contexts = Object.values(root.contexts)
  const lines: string[] = []
  lines.push(`Root context: "${root.name}" (id: ${root.uri})${root.description ? ` - ${root.description}` : ''}`)
  if (contexts.length === 0) {
    lines.push('Sub-contexts: (none yet)')
    return lines.join('\n')
  }

  const topLevel = contexts.filter(c => c.parentUri === root.uri)
  const childrenOf = (parentId: string) => contexts.filter(c => c.parentUri === parentId)

  function renderTree(ctxList: Context[], indent: number): void {
    for (const c of ctxList) {
      const prefix = '  '.repeat(indent) + '- '
      const parentNote = c.parentUri ? ` (child of: ${c.parentUri})` : ''
      const tagsNote = (c as any).tags?.length ? ` [tags: ${(c as any).tags.join(', ')}]` : ''
      lines.push(`${prefix}"${c.name}" (id: ${c.uri})${parentNote}${tagsNote}${c.description ? ` - ${c.description}` : ''}`)
      const children = childrenOf(c.uri)
      if (children.length > 0) renderTree(children, indent + 1)
    }
  }

  lines.push(`Top-level contexts (${topLevel.length}):`)
  renderTree(topLevel, 0)

  const allIds = new Set([root.uri, ...contexts.map(c => c.uri)])
  const orphans = contexts.filter(c => c.parentUri && !allIds.has(c.parentUri))
  if (orphans.length > 0) {
    lines.push(`\nOrphaned contexts (parent not found):`)
    for (const c of orphans) {
      lines.push(`- "${c.name}" (id: ${c.uri}, parentId: ${c.parentUri})`)
    }
  }
  return lines.join('\n')
}

/** Describe a single context with all its facets and links. */
export function describeContext(root: RootContext, contextUri: string): string {
  const ctx = getContextObj(root, contextUri)
  if (!ctx) return `Context "${contextUri}" not found.`
  const isRoot = contextUri === root.uri
  const lines: string[] = []
  lines.push(`${isRoot ? 'Root workspace' : 'Context'}: "${ctx.name}" (id: ${ctx.uri})`)
  if (!isRoot && (ctx as Context).domainType) {
    lines.push(`Domain type: ${(ctx as Context).domainType}`)
  }
  if (!isRoot && (ctx as Context).parentUri) {
    const parentName = (ctx as Context).parentUri === root.uri
      ? root.name
      : (root.contexts[(ctx as Context).parentUri]?.name ?? 'unknown')
    lines.push(`Parent: "${parentName}" (id: ${(ctx as Context).parentUri})`)
  }
  const children = Object.values(root.contexts).filter(c => c.parentUri === (isRoot ? root.uri : contextUri))
  if (children.length > 0) {
    lines.push(`Sub-contexts (${children.length}): ${children.map(c => `"${c.name}" (id: ${c.uri})`).join(', ')}`)
  }
  if (ctx.description) {
    lines.push('Description (markdown):')
    lines.push('---')
    lines.push(ctx.description)
    lines.push('---')
  }
  if (ctx.facets.things?.length) {
    lines.push(`Things (${ctx.facets.things.length}):`)
    for (const t of ctx.facets.things) {
      const role = t.thingRole && t.thingRole !== 'root' ? ` [${t.thingRole}]` : ''
      const attrs = t.attributes?.map((a: any) => {
        let s = `${a.name}:${a.type}`
        if (a.type === 'reference' && a.referencedThingId) {
          s += `→${resolveEntityName(root, a.referencedThingId)}`
          if (a.referenceType === 'composition') s += '(composition)'
        }
        if (a.type === 'enum' && a.enumValues?.length) s += `[${a.enumValues.join('|')}]`
        return s
      }).join(', ') || 'none'
      let thingLine = `  - "${t.name}"${role} (id: ${t.uri}) attrs: ${attrs}`
      if (t.rules?.length) thingLine += ` rules: [${t.rules.join('; ')}]`
      if (t.states?.length) {
        const stateNames = t.states.map((s: any) => {
          const flags: string[] = []
          if (s.initial) flags.push('initial')
          if (s.terminal) flags.push('terminal')
          return flags.length ? `${s.name}(${flags.join(',')})` : s.name
        })
        thingLine += ` states: [${stateNames.join(' → ')}]`
      }
      const entityLinks = describeEntityLinks(root, t.uri, 'Thing')
      if (entityLinks.length) thingLine += ` ${entityLinks.join(', ')}`
      lines.push(thingLine)
    }
  }
  if (ctx.facets.personas?.length) {
    lines.push(`Personas (${ctx.facets.personas.length}):`)
    for (const p of ctx.facets.personas) {
      let personaLine = `  - "${p.name}" (id: ${p.uri}) role: ${p.role || 'not set'} type: ${p.personaType || 'human'}`
      const entityLinks = describeEntityLinks(root, p.uri, 'Persona')
      if (entityLinks.length) personaLine += ` ${entityLinks.join(', ')}`
      lines.push(personaLine)
    }
  }
  if (ctx.facets.ports?.length) {
    lines.push(`Ports (${ctx.facets.ports.length}):`)
    for (const p of ctx.facets.ports) {
      let portLine = `  - "${p.name}" [${p.direction}] (id: ${p.uri})`
      if (p.description) portLine += ` - ${p.description}`
      const entityLinks = describeEntityLinks(root, p.uri, 'Port')
      if (entityLinks.length) portLine += ` ${entityLinks.join(', ')}`
      lines.push(portLine)
    }
  }
  if (ctx.facets.actions?.length) {
    lines.push(`Actions (${ctx.facets.actions.length}):`)
    for (const a of ctx.facets.actions) {
      let actionLine = `  - "${a.name}" [${a.type}] (id: ${a.uri})`
      if (a.preconditions?.length) actionLine += ` pre: [${a.preconditions.map(conditionText).join('; ')}]`
      if (a.postconditions?.length) actionLine += ` post: [${a.postconditions.map(conditionText).join('; ')}]`
      lines.push(actionLine)
      const entityLinks = describeEntityLinks(root, a.uri, 'Action')
      for (const linkLine of entityLinks) lines.push(`      ${linkLine}`)
    }
  }
  if (ctx.facets.workflows?.length) {
    lines.push(`Workflows (${ctx.facets.workflows.length}):`)
    for (const w of ctx.facets.workflows) {
      const trig = w.trigger
      const trigStr = !trig || trig.type === 'manual'
        ? 'trigger: manual'
        : `trigger: ${trig.type}${trig.refId ? ` (ref: ${trig.refId})` : ''}${trig.description ? ` - "${trig.description}"` : ''}`
      const trigStepName = w.triggerStepId && w.steps?.length
        ? (w.steps.find((s: any) => s.uri === w.triggerStepId)?.name ?? w.triggerStepId)
        : null
      lines.push(`  - "${w.name}" (id: ${w.uri}) ${trigStr}${trigStepName ? ` triggerStepId: ${w.triggerStepId} ("${trigStepName}")` : ''}`)
      if (w.steps?.length) {
        for (let si = 0; si < w.steps.length; si++) {
          const step = w.steps[si]!
          const stepName = step.name ?? 'Step'
          const stepActionId = linkTargets(root, step.id, 'step:action')[0]
          const actionName = stepActionId ? resolveEntityName(root, stepActionId) : null
          const stepPerformerId = linkTargets(root, step.id, 'step:performer')[0]
          const performerName = stepPerformerId ? resolveEntityName(root, stepPerformerId) : null
          let stepLine = `    ${si + 1}. "${stepName}"`
          if (actionName) stepLine += ` - action: ${actionName}`
          if (performerName) stepLine += `, performer: ${performerName}`
          lines.push(stepLine)
          if (step.transitions?.length) {
            for (const tr of step.transitions) {
              const tgt = w.steps.find((s: any) => s.uri === tr.targetStepId)
              const tgtName = tgt ? (tgt.name ?? 'Step') : tr.targetStepId
              let trLine = `       → "${tr.label}": go to "${tgtName}"`
              if (tr.guard) trLine += ` [guard: ${tr.guard}]`
              lines.push(trLine)
            }
          }
        }
      }
      const workflowLinks = describeEntityLinks(root, w.uri, 'Workflow')
      for (const linkLine of workflowLinks) lines.push(`      ${linkLine}`)
    }
  }
  if (ctx.facets.interfaces?.length) {
    lines.push(`Interfaces (${ctx.facets.interfaces.length}):`)
    for (const i of ctx.facets.interfaces) {
      let ifaceLine = `  - "${i.name}" [${i.kind}] (id: ${i.uri})`
      const entityLinks = describeEntityLinks(root, i.uri, 'Interface')
      if (entityLinks.length) ifaceLine += ` ${entityLinks.join(', ')}`
      lines.push(ifaceLine)
    }
  }
  if (ctx.facets.events?.length) {
    lines.push(`Events (${ctx.facets.events.length}):`)
    for (const ev of ctx.facets.events) {
      let evLine = `  - "${ev.name}" [${ev.eventType}] (id: ${ev.uri})`
      const entityLinks = describeEntityLinks(root, ev.uri, 'Event')
      if (entityLinks.length) evLine += ` ${entityLinks.join(', ')}`
      lines.push(evLine)
    }
  }
  if (ctx.facets.measures?.length) {
    lines.push(`Measures (${ctx.facets.measures.length}):`)
    for (const m of ctx.facets.measures) {
      let mLine = `  - "${m.name}" [${m.measureType}] (id: ${m.uri})${m.unit ? ` unit: ${m.unit}` : ''}`
      const entityLinks = describeEntityLinks(root, m.uri, 'Measure')
      if (entityLinks.length) mLine += ` ${entityLinks.join(', ')}`
      lines.push(mLine)
    }
  }
  if (ctx.symbols?.length) {
    lines.push(`Symbols (${ctx.symbols.length}):`)
    for (const sym of ctx.symbols) {
      const displayName = sym.label ?? sym.content.split('\n')[0]?.slice(0, 80) ?? ''
      const preview = sym.content.length > 50 ? sym.content.slice(0, 50) + '...' : sym.content
      lines.push(`  - "${displayName}" (id: ${sym.uri}${sym.mode ? `, mode: ${sym.mode}` : ''}) - ${preview}`)
    }
  }
  return lines.join('\n')
}

/** Full-text search across all entity names, descriptions, and definitions. */
export function searchEntities(root: RootContext, query: string, entityTypes?: EntityClassId[]): Array<{ id: string, name: string, type: EntityClassId, contextName: string, snippet: string }> {
  const results: Array<{ id: string, name: string, type: EntityClassId, contextName: string, snippet: string }> = []
  const q = query.toLowerCase()
  const typeFilter = entityTypes ? new Set(entityTypes) : null

  // Search contexts
  if (!typeFilter || typeFilter.has('Context')) {
    for (const c of Object.values(root.contexts)) {
      if (c.name.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q)) {
        const parentName = c.parentUri === root.uri ? root.name : (root.contexts[c.parentUri]?.name ?? 'root')
        results.push({ id: c.uri, name: c.name, type: 'Context', contextName: parentName, snippet: c.description?.slice(0, 100) ?? '' })
      }
    }
  }

  // Search facets within each context
  for (const c of [root, ...Object.values(root.contexts)] as any[]) {
    const contextName = c.name ?? root.name
    for (const key of getRegisteredFacetKeys()) {
      const cls = facetKeyToClass(key) as EntityClassId
      if (typeFilter && !typeFilter.has(cls)) continue
      for (const facet of (c.facets[key] ?? []) as any[]) {
        const searchable = [
          facet.name,
          facet.definition,
          facet.description,
          facet.role,
          ...(facet.attributes ?? []).map((a: any) => a.name),
          ...(facet.rules ?? []),
        ].filter(Boolean).join(' ').toLowerCase()
        if (searchable.includes(q)) {
          const snippet = facet.definition || facet.description || facet.role || ''
          results.push({ id: facet.uri, name: facet.name ?? facet.label, type: cls, contextName, snippet: snippet.slice(0, 100) })
        }
      }
    }

    // Search symbols
    if (!typeFilter || typeFilter.has('Symbol')) {
      for (const sym of (c.symbols ?? []) as any[]) {
        const searchable = [sym.label, sym.content].filter(Boolean).join(' ').toLowerCase()
        if (searchable.includes(q)) {
          const name = sym.label ?? sym.content?.slice(0, 80) ?? ''
          results.push({ id: sym.uri, name, type: 'Symbol', contextName, snippet: sym.content?.slice(0, 100) ?? '' })
        }
      }
    }
  }

  return results
}

// ── Set-theoretic query algebra evaluator ────────────────────────────────────

/** All FacetContainers in the model: root + every sub-context. */
function allContainers(root: RootContext): FacetContainer[] {
  return [root, ...Object.values(root.contexts)]
}

/** Resolve an objectType string to a facet key, accepting both facet keys and entity class IDs. */
function resolveFacetKey(objectType: string): string | null {
  // If it's already a registered facet key (e.g. 'things'), return as-is
  if (getRegisteredFacetKeys().includes(objectType)) return objectType
  // If it's an entity class id (e.g. 'Thing'), map to the facet key
  const classToKey = getClassToFacetKeyMap()
  if (classToKey[objectType]) return classToKey[objectType]!
  return null
}

/** Collect all entity IDs of a given type across root and all contexts. */
function collectByType(root: RootContext, objectType: string): string[] {
  // Handle 'Context' - return all sub-context IDs
  if (objectType === 'Context') {
    return Object.keys(root.contexts)
  }

  // Handle 'Symbol' - return all symbol IDs
  if (objectType === 'Symbol') {
    const ids: string[] = []
    for (const c of allContainers(root)) {
      for (const sym of c.symbols ?? []) ids.push(sym.uri)
    }
    return ids
  }

  // Handle facet types (by key or class name)
  const facetKey = resolveFacetKey(objectType)
  if (!facetKey) return []

  const ids: string[] = []
  for (const c of allContainers(root)) {
    const arr = c.facets[facetKey] as { uri: string }[] | undefined
    if (Array.isArray(arr)) {
      for (const item of arr) ids.push(item.uri)
    }
  }
  return ids
}

/** Collect all entity IDs within a specific context (its facets and symbols, not the context itself). */
function collectByContext(root: RootContext, contextUri: string): string[] {
  const ctx: FacetContainer | undefined = contextUri === root.uri ? root : root.contexts[contextUri]
  if (!ctx) return []
  const ids: string[] = []
  for (const ft of getRegisteredFacetKeys()) {
    const arr = ctx.facets[ft] as { uri: string }[] | undefined
    if (Array.isArray(arr)) {
      for (const item of arr) ids.push(item.uri)
    }
  }
  for (const sym of ctx.symbols ?? []) ids.push(sym.uri)
  return ids
}

/** Collect all entity IDs that have a specific tag. */
function collectByTag(root: RootContext, tag: string): string[] {
  const ids: string[] = []

  // Contexts can have tags
  for (const c of Object.values(root.contexts)) {
    if ((c as Context).tags?.includes(tag)) ids.push(c.uri)
  }

  // Facets can have tags
  for (const c of allContainers(root)) {
    for (const ft of getRegisteredFacetKeys()) {
      const arr = c.facets[ft] as { uri: string; tags?: readonly string[] }[] | undefined
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item.tags?.includes(tag)) ids.push(item.uri)
        }
      }
    }
  }

  // Symbols can have tags
  for (const c of allContainers(root)) {
    for (const sym of c.symbols ?? []) {
      if (sym.tags?.includes(tag)) ids.push(sym.uri)
    }
  }

  return ids
}

/** Traverse links from a set of starting IDs. Returns discovered IDs excluding the start set. */
function traverseLinks(
  root: RootContext,
  startIds: string[],
  predicate: string,
  direction: 'out' | 'in' | 'both',
  maxDepth: number,
): string[] {
  const startSet = new Set(startIds)
  const visited = new Set<string>(startIds)
  let frontier = [...startIds]

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const link of root.links) {
        if (predicate !== '*' && link.predicate !== predicate) continue

        if ((direction === 'out' || direction === 'both') && link.sourceUri === id && !visited.has(link.targetUri)) {
          visited.add(link.targetUri)
          next.push(link.targetUri)
        }
        if ((direction === 'in' || direction === 'both') && link.targetUri === id && !visited.has(link.sourceUri)) {
          visited.add(link.sourceUri)
          next.push(link.sourceUri)
        }
      }
    }
    frontier = next
  }

  return [...visited].filter(id => !startSet.has(id))
}

/** Find any entity by ID across all containers (contexts, facets, symbols). */
function findEntityById(root: RootContext, id: string): unknown {
  // Check root itself
  if (id === root.uri) return root

  // Check sub-contexts
  if (root.contexts[id]) return root.contexts[id]

  // Check facets and symbols across all containers
  for (const c of allContainers(root)) {
    for (const ft of getRegisteredFacetKeys()) {
      const arr = c.facets[ft] as { uri: string }[] | undefined
      if (Array.isArray(arr)) {
        const found = arr.find(item => item.uri === id)
        if (found) return found
      }
    }
    const sym = (c.symbols ?? []).find(s => s.uri === id)
    if (sym) return sym
  }

  return null
}

/** Evaluate a field-level filter against an entity's property value. */
function matchFieldFilter(val: unknown, filter: FilterExpr): boolean {
  switch (filter.op) {
    case 'eq': return val === filter.value
    case 'neq': return val !== filter.value
    case 'gt': return typeof val === 'number' && typeof filter.value === 'number' ? val > filter.value : String(val ?? '') > String(filter.value)
    case 'lt': return typeof val === 'number' && typeof filter.value === 'number' ? val < filter.value : String(val ?? '') < String(filter.value)
    case 'gte': return typeof val === 'number' && typeof filter.value === 'number' ? val >= filter.value : String(val ?? '') >= String(filter.value)
    case 'lte': return typeof val === 'number' && typeof filter.value === 'number' ? val <= filter.value : String(val ?? '') <= String(filter.value)
    case 'contains': return typeof val === 'string' && val.includes(filter.value)
    case 'startsWith': return typeof val === 'string' && val.startsWith(filter.value)
    case 'regex': return typeof val === 'string' && new RegExp(filter.pattern).test(val)
    case 'in': return Array.isArray(filter.values) && filter.values.includes(val)
    case 'isNull': return val === null || val === undefined
    case 'isNotNull': return val !== null && val !== undefined
    default: return false
  }
}

/** Check if an entity matches a filter expression. */
function matchesFilter(root: RootContext, entityUri: string, filter: FilterExpr): boolean {
  switch (filter.op) {
    case 'and': return filter.conditions.every(c => matchesFilter(root, entityUri, c))
    case 'or': return filter.conditions.some(c => matchesFilter(root, entityUri, c))
    case 'not': return !matchesFilter(root, entityUri, filter.condition)

    case 'hasLink': {
      const count = root.links.filter(l => {
        if (l.predicate !== filter.predicate) return false
        return filter.direction === 'out' ? l.sourceUri === entityUri : l.targetUri === entityUri
      }).length
      if (filter.min !== undefined && count < filter.min) return false
      if (filter.max !== undefined && count > filter.max) return false
      return count > 0 || (filter.min === 0)
    }

    case 'hasTag': {
      const entity = findEntityById(root, entityUri) as Record<string, unknown> | null
      return Array.isArray(entity?.tags) && (entity.tags as string[]).includes(filter.tag)
    }

    case 'hasStereotype': {
      const entity = findEntityById(root, entityUri) as Record<string, unknown> | null
      if (!entity) return false
      return entity.stereotype === filter.value
        || entity.personaType === filter.value
        || entity.measureType === filter.value
    }

    case 'hasKind': {
      const entity = findEntityById(root, entityUri) as Record<string, unknown> | null
      return entity?.kind === filter.value
    }

    case 'facetCount': {
      const ctx: FacetContainer | undefined = entityUri === root.uri ? root : root.contexts[entityUri]
      if (!ctx) return false
      const facetKey = resolveFacetKey(filter.facetType)
      if (!facetKey) return false
      const arr = ctx.facets[facetKey] as unknown[]
      const count = Array.isArray(arr) ? arr.length : 0
      switch (filter.cmp) {
        case 'eq': return count === filter.value
        case 'gt': return count > filter.value
        case 'lt': return count < filter.value
        case 'gte': return count >= filter.value
        case 'lte': return count <= filter.value
      }
      return false
    }

    // Field-level filters
    case 'eq': case 'neq': case 'gt': case 'lt': case 'gte': case 'lte':
    case 'contains': case 'startsWith': case 'regex': case 'in':
    case 'isNull': case 'isNotNull': {
      const entity = findEntityById(root, entityUri) as Record<string, unknown> | null
      if (!entity) return false
      const field = 'field' in filter ? (filter as { field: string }).field : undefined
      if (!field) return false
      const val = entity[field]
      return matchFieldFilter(val, filter)
    }
  }
}

/** Compute an aggregate over a set of entity IDs (model-level). */
function computeAggregate(root: RootContext, ids: string[], fn: AggregateExpr): number | Record<string, number> {
  switch (fn.fn) {
    case 'count': return ids.length

    case 'countDistinct': {
      const values = new Set(
        ids.map(id => {
          const entity = findEntityById(root, id) as Record<string, unknown> | null
          return entity?.[fn.field]
        }).filter(v => v !== undefined),
      )
      return values.size
    }

    case 'groupBy': {
      const groups: Record<string, string[]> = {}
      for (const id of ids) {
        const entity = findEntityById(root, id) as Record<string, unknown> | null
        const key = String(entity?.[fn.field] ?? 'unknown')
        if (!groups[key]) groups[key] = []
        groups[key]!.push(id)
      }
      const result: Record<string, number> = {}
      for (const [key, groupIds] of Object.entries(groups)) {
        const subResult = computeAggregate(root, groupIds, fn.agg)
        result[key] = typeof subResult === 'number' ? subResult : 0
      }
      return result
    }

    case 'sum': {
      let total = 0
      for (const id of ids) {
        const entity = findEntityById(root, id) as Record<string, unknown> | null
        const val = entity?.[fn.field]
        if (typeof val === 'number') total += val
      }
      return total
    }

    case 'avg': {
      let total = 0
      let count = 0
      for (const id of ids) {
        const entity = findEntityById(root, id) as Record<string, unknown> | null
        const val = entity?.[fn.field]
        if (typeof val === 'number') { total += val; count++ }
      }
      return count > 0 ? total / count : 0
    }

    case 'min': {
      let result = Infinity
      for (const id of ids) {
        const entity = findEntityById(root, id) as Record<string, unknown> | null
        const val = entity?.[fn.field]
        if (typeof val === 'number' && val < result) result = val
      }
      return result === Infinity ? 0 : result
    }

    case 'max': {
      let result = -Infinity
      for (const id of ids) {
        const entity = findEntityById(root, id) as Record<string, unknown> | null
        const val = entity?.[fn.field]
        if (typeof val === 'number' && val > result) result = val
      }
      return result === -Infinity ? 0 : result
    }
  }
}

/**
 * Evaluate a SetExpr against the model graph.
 * Returns entity IDs matching the expression.
 *
 * This is the MODEL evaluator - it queries the ontology structure (entities, links, tags).
 * The DATA evaluator (SQL compilation) is separate and uses the same algebra.
 */
export function evaluateSetExpr(root: RootContext, expr: SetExpr): SetResult {
  switch (expr.op) {
    case 'base': return { ids: collectByType(root, expr.objectType) }
    case 'context': return { ids: collectByContext(root, expr.contextId) }
    case 'tagged': return { ids: collectByTag(root, expr.tag) }
    case 'ids': return { ids: [...expr.ids] }

    case 'union': {
      const all = new Set<string>()
      for (const sub of expr.sets) {
        for (const id of evaluateSetExpr(root, sub).ids) all.add(id)
      }
      return { ids: [...all] }
    }

    case 'intersect': {
      if (!expr.sets.length) return { ids: [] }
      let result = new Set(evaluateSetExpr(root, expr.sets[0]!).ids)
      for (let i = 1; i < expr.sets.length; i++) {
        const next = new Set(evaluateSetExpr(root, expr.sets[i]!).ids)
        result = new Set([...result].filter(id => next.has(id)))
      }
      return { ids: [...result] }
    }

    case 'subtract': {
      const base = new Set(evaluateSetExpr(root, expr.from).ids)
      const minus = new Set(evaluateSetExpr(root, expr.minus).ids)
      return { ids: [...base].filter(id => !minus.has(id)) }
    }

    case 'traverse': {
      const from = evaluateSetExpr(root, expr.from).ids
      return { ids: traverseLinks(root, from, expr.predicate, expr.direction, expr.depth ?? 1) }
    }

    case 'filter': {
      const base = evaluateSetExpr(root, expr.base).ids
      return { ids: base.filter(id => matchesFilter(root, id, expr.where)) }
    }

    case 'aggregate': {
      const base = evaluateSetExpr(root, expr.base)
      return { ids: base.ids, aggregateValue: computeAggregate(root, base.ids, expr.fn) }
    }
  }
}

/**
 * Pure serialization functions for converting RootContext to text representations.
 * Used by the MCP server for resources and by the in-app AI for system prompts.
 */
import type { RootContext, Context, ActionCondition } from '../types/context'
import type { TripleQueryIndex } from './triples'
import { getStoredPredicates } from '../meta/ontology'
import { resolvePredicateLabel } from '../meta/vocabulary'
import { evaluateAllGaps } from './completeness'

function esc(s: string): string {
  return s.replace(/"/g, '\\"')
}

/** Extract human-readable text from an ActionCondition (typed or legacy string). */
function conditionText(c: ActionCondition | string): string {
  if (typeof c === 'string') return c
  return c.description ?? `${c.type} condition`
}

/** Serialize a context's facets as compact summary lines. */
export function serializeContextFacets(ctx: Context): string[] {
  const lines: string[] = []
  if ((ctx as any).tags?.length)
    lines.push(`Tags: ${(ctx as any).tags.join(', ')}`)
  if (ctx.facets.things?.length)
    lines.push(`Things: ${ctx.facets.things.map(t => {
      const role = t.thingRole && t.thingRole !== 'root' ? ` [${t.thingRole}]` : ''
      return `"${esc(t.name)}"${role} (id: ${t.uri})`
    }).join(', ')}`)
  if (ctx.facets.personas?.length)
    lines.push(`Personas: ${ctx.facets.personas.map(p => {
      const pType = p.personaType && p.personaType !== 'human' ? ` [${p.personaType}]` : ''
      return `"${esc(p.name)}"${pType} (id: ${p.uri})`
    }).join(', ')}`)
  if (ctx.facets.ports?.length)
    lines.push(`Ports: ${ctx.facets.ports.map(p => `"${esc(p.name)}" [${p.direction}] (id: ${p.uri})`).join(', ')}`)
  if (ctx.facets.actions?.length)
    lines.push(`Actions: ${ctx.facets.actions.map(a => {
      let s = `"${esc(a.name)}" [${a.type}] (id: ${a.uri})`
      if (a.preconditions?.length) s += ` pre: [${a.preconditions.map(p => esc(conditionText(p))).join('; ')}]`
      if (a.postconditions?.length) s += ` post: [${a.postconditions.map(p => esc(conditionText(p))).join('; ')}]`
      return s
    }).join(', ')}`)
  if (ctx.facets.workflows?.length)
    lines.push(`Workflows: ${ctx.facets.workflows.map(w => `"${esc(w.name)}" (id: ${w.uri}, trigger: ${w.trigger?.type ?? 'manual'}, steps: ${w.steps?.length ?? 0})`).join(', ')}`)
  if (ctx.facets.interfaces?.length)
    lines.push(`Interfaces: ${ctx.facets.interfaces.map(i => `"${esc(i.name)}" [${i.kind}] (id: ${i.uri})`).join(', ')}`)
  if (ctx.facets.events?.length)
    lines.push(`Events: ${ctx.facets.events.map(ev => `"${esc(ev.name)}" [${ev.eventType}] (id: ${ev.uri})`).join(', ')}`)
  if (ctx.facets.measures?.length)
    lines.push(`Measures: ${ctx.facets.measures.map(m => `"${esc(m.name)}" [${m.measureType}] (id: ${m.uri})`).join(', ')}`)
  if (ctx.symbols?.length)
    lines.push(`Symbols: ${ctx.symbols.map(s => {
      const displayName = s.label ?? s.content.split('\n')[0]?.slice(0, 80) ?? ''
      const preview = s.content.length > 50 ? s.content.slice(0, 50) + '...' : s.content
      return `"${esc(displayName)}" (id: ${s.uri}${s.mode ? `, mode: ${s.mode}` : ''}) - ${esc(preview)}`
    }).join(', ')}`)
  return lines
}

/** Serialize a context in full detail (name + all facets). */
export function serializeContextFull(ctx: Context): string {
  const lines: string[] = []
  const domainTag = ctx.domainType ? ` [${ctx.domainType}]` : ''
  lines.push(
    `- "${esc(ctx.name)}"${domainTag} (id: ${ctx.uri})${
      ctx.description ? ` - "${esc(ctx.description)}"` : ''
    }`,
  )
  for (const l of serializeContextFacets(ctx)) lines.push(`    ${l}`)
  return lines.join('\n')
}

/** Serialize the full map to a compact text representation suitable for LLM context. */
export function serializeMap(map: RootContext, activeContextId?: string): string {
  const lines: string[] = []
  lines.push(`WORKSPACE: "${esc(map.name)}" (id: ${map.uri})`)
  if (map.description) lines.push(`  Description: "${esc(map.description)}"`)

  const rootFacetLines = serializeContextFacets(map as unknown as Context)
  if (rootFacetLines.length > 0) {
    lines.push('  (workspace-level facets)')
    for (const l of rootFacetLines) lines.push(`  ${l}`)
  }

  const contexts = Object.values(map.contexts)
  if (contexts.length === 0) {
    lines.push('SUB-CONTEXTS: (none yet)')
    return lines.join('\n')
  }

  lines.push('SUB-CONTEXTS:')

  const topLevel = contexts.filter(c => c.parentUri === map.uri)
  const childrenOf = (parentId: string) => contexts.filter(c => c.parentUri === parentId)

  function renderContextTree(ctxList: Context[], depth: number): void {
    const indent = '  '.repeat(depth + 1)
    for (const ctx of ctxList) {
      const isActive = ctx.uri === activeContextId
      if (isActive) {
        lines.push(`${indent}[ACTIVE] ${serializeContextFull(ctx)}`)
      } else if (activeContextId) {
        const dtTag = ctx.domainType ? ` [${ctx.domainType}]` : ''
        lines.push(
          `${indent}- "${esc(ctx.name)}"${dtTag} (id: ${ctx.uri})${
            ctx.parentUri ? ` (child of: ${ctx.parentUri})` : ''
          }${ctx.description ? ` - "${esc(ctx.description)}"` : ''}`,
        )
      } else {
        lines.push(`${indent}${serializeContextFull(ctx)}`)
      }
      const children = childrenOf(ctx.uri)
      if (children.length > 0) renderContextTree(children, depth + 1)
    }
  }

  renderContextTree(topLevel, 0)

  const storedPreds = getStoredPredicates().filter(p => !p.id.startsWith('step:'))
  for (const pred of storedPreds) {
    const predLinks = map.links.filter(l => l.predicate === pred.id)
    if (!predLinks.length) continue
    const sectionLabel = resolvePredicateLabel(pred.id, 'business')
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
    lines.push(`${cap(sectionLabel).toUpperCase()}S:`)
    for (const l of predLinks) {
      const srcName = map.contexts[l.sourceUri]?.name ?? l.sourceUri
      const tgtName = map.contexts[l.targetUri]?.name ?? l.targetUri
      const pattern = l.pattern ?? ''
      lines.push(
        `  - "${esc(srcName)}" → "${esc(tgtName)}" (id: ${l.uri})${
          l.label ? ` label: "${esc(l.label)}"` : ''
        }${pattern ? ` [${pattern}]` : ''}`,
      )
    }
  }

  if (map.symbols && map.symbols.length > 0) {
    lines.push(`WORKSPACE-LEVEL SYMBOLS: ${map.symbols.map(s => {
      const displayName = s.label ?? s.content.split('\n')[0]?.slice(0, 80) ?? ''
      const preview = s.content.length > 50 ? s.content.slice(0, 50) + '...' : s.content
      return `"${esc(displayName)}" (id: ${s.uri}${s.mode ? `, mode: ${s.mode}` : ''}) - ${esc(preview)}`
    }).join(', ')}`)
  }

  return lines.join('\n')
}

/** Build a summary of structural gaps for LLM awareness. */
export function buildGapSummary(map: RootContext, tripleIndex?: TripleQueryIndex): string | null {
  const violations = evaluateAllGaps(map, tripleIndex)
  if (violations.length === 0) return null

  const topGaps = violations.slice(0, 5)
  const lines: string[] = ['STRUCTURAL QUESTIONS (top gaps in the model):']
  for (const v of topGaps) {
    const severity = v.severity === 'error' ? '[!]' : v.severity === 'warning' ? '[?]' : '[i]'
    lines.push(`  ${severity} ${v.message} (entity: ${v.entityId}, type: ${v.entityType})`)
  }
  if (violations.length > 5) {
    lines.push(`  ... and ${violations.length - 5} more. Use analyze_completeness for the full list.`)
  }
  return lines.join('\n')
}

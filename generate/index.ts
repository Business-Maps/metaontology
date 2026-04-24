/**
 * Pure generation functions for producing code artifacts from the domain model.
 * Pure generators for markdown, glossaries, CLAUDE.md, and engineering schemas.
 */
import type { RootContext } from '../types/context'
import { resolveEntityName } from '../engine/query'

// ── Re-export existing pure generators ────────────────────────────────────────

export { generateTypeScriptTypes } from './export'
export { generateZodSchemas } from './export'
export { generateEventSchemas } from './export'
export { generateGuardFunctions } from './export'
export { generateTestSkeletons } from './export'
export { generateServiceBoundaries } from './export'
export { exportMarkdownContent } from './export'
export { generateActionFunctions } from './export'
export { generateDomainModelLayer } from './domainLayer'
export type { DomainLayerOptions, DomainLayerFile } from './domainLayer'
export { generateApp } from './app'
export type { AppGeneratorOptions } from './app'
export { projectMetaontologyAsContext } from './selfProjection'
export type { MetaontologyProjection } from './selfProjection'

// ── New: CLAUDE.md domain section generator ───────────────────────────────────

/** Generate a domain model section suitable for inclusion in a project's CLAUDE.md. */
export function generateClaudeMd(map: RootContext): string {
  const lines: string[] = []
  lines.push(`## Domain Model: ${map.name}`)
  lines.push('')
  if (map.description) {
    lines.push(map.description)
    lines.push('')
  }

  // Contexts overview
  const contexts = Object.values(map.contexts)
  if (contexts.length > 0) {
    lines.push('### Bounded Contexts')
    lines.push('')
    const topLevel = contexts.filter(c => c.parentUri === map.uri)
    for (const c of topLevel) {
      const dt = c.domainType ? ` (${c.domainType})` : ''
      lines.push(`- **${c.name}**${dt}${c.description ? ` - ${c.description}` : ''}`)
      const children = contexts.filter(ch => ch.parentUri === c.uri)
      for (const child of children) {
        const cdt = child.domainType ? ` (${child.domainType})` : ''
        lines.push(`  - **${child.name}**${cdt}${child.description ? ` - ${child.description}` : ''}`)
      }
    }
    lines.push('')
  }

  // Glossary (Things with definitions)
  const allThings: Array<{ name: string, definition: string, contextName: string }> = []
  for (const c of [map, ...contexts] as any[]) {
    for (const t of (c.things ?? []) as any[]) {
      if (t.definition) {
        allThings.push({ name: t.name, definition: t.definition, contextName: c.name })
      }
    }
  }
  if (allThings.length > 0) {
    lines.push('### Domain Glossary')
    lines.push('')
    lines.push('| Term | Definition | Context |')
    lines.push('|------|-----------|---------|')
    for (const t of allThings.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`| ${t.name} | ${t.definition.replace(/\n/g, ' ').slice(0, 120)} | ${t.contextName} |`)
    }
    lines.push('')
  }

  // Value streams
  const vsLinks = map.links.filter(l => l.predicate === 'valueStream')
  if (vsLinks.length > 0) {
    lines.push('### Value Streams')
    lines.push('')
    for (const l of vsLinks) {
      const src = resolveEntityName(map, l.sourceUri)
      const tgt = resolveEntityName(map, l.targetUri)
      const label = l.label ? ` (${l.label})` : ''
      lines.push(`- ${src} → ${tgt}${label}`)
    }
    lines.push('')
  }

  // Key personas
  const allPersonas: Array<{ name: string, role: string, type: string, contextName: string }> = []
  for (const c of [map, ...contexts] as any[]) {
    for (const p of (c.personas ?? []) as any[]) {
      allPersonas.push({ name: p.name, role: p.role || '', type: p.personaType || 'human', contextName: c.name })
    }
  }
  if (allPersonas.length > 0) {
    lines.push('### Actors')
    lines.push('')
    for (const p of allPersonas) {
      lines.push(`- **${p.name}** [${p.type}]${p.role ? ` - ${p.role}` : ''} (${p.contextName})`)
    }
    lines.push('')
  }

  // Key domain events
  const allEvents: Array<{ name: string, type: string, contextName: string }> = []
  for (const c of [map, ...contexts] as any[]) {
    for (const ev of (c.events ?? []) as any[]) {
      allEvents.push({ name: ev.name, type: ev.eventType, contextName: c.name })
    }
  }
  if (allEvents.length > 0) {
    lines.push('### Domain Events')
    lines.push('')
    for (const ev of allEvents) {
      lines.push(`- **${ev.name}** [${ev.type}] (${ev.contextName})`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/** Generate a domain glossary document. */
export function generateGlossary(map: RootContext): string {
  const lines: string[] = []
  lines.push(`# Domain Glossary: ${map.name}`)
  lines.push('')

  const contexts = Object.values(map.contexts)
  const allContexts = [map, ...contexts] as any[]

  for (const c of allContexts) {
    const things = (c.things ?? []) as any[]
    if (things.length === 0) continue

    lines.push(`## ${c.name}`)
    lines.push('')
    for (const t of things.sort((a: any, b: any) => a.name.localeCompare(b.name))) {
      lines.push(`### ${t.name}`)
      if (t.definition) lines.push(`${t.definition}`)
      lines.push('')
      if (t.attributes?.length) {
        lines.push('**Attributes:**')
        for (const a of t.attributes) {
          let attrLine = `- \`${a.name}\` (${a.type})`
          if (a.type === 'reference' && a.referencedThingId) {
            attrLine += ` → ${resolveEntityName(map, a.referencedThingId)}`
          }
          if (a.type === 'enum' && a.enumValues?.length) {
            attrLine += `: ${a.enumValues.join(' | ')}`
          }
          if (a.description) attrLine += ` - ${a.description}`
          lines.push(attrLine)
        }
        lines.push('')
      }
      if (t.states?.length) {
        const stateNames = t.states.map((s: any) => {
          const flags = []
          if (s.initial) flags.push('initial')
          if (s.terminal) flags.push('terminal')
          return flags.length ? `${s.name} (${flags.join(', ')})` : s.name
        })
        lines.push(`**States:** ${stateNames.join(' → ')}`)
        lines.push('')
      }
      if (t.rules?.length) {
        lines.push('**Rules:**')
        for (const r of t.rules) lines.push(`- ${r}`)
        lines.push('')
      }
    }
  }

  return lines.join('\n')
}

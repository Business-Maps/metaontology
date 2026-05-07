import type { RootContext, LinkPredicate, FacetType, Thing, Action, Event, Port, FacetContainer, AssertionViolation, ActionCondition, ThingAttribute, ValueConstraint, ValueTypeDef, ActionParameter, FieldSource } from '../types/context'
import { BASE_FACET_REGISTRY, FACET_TYPES } from '../meta/facets'
import { resolveI18n } from '../meta/i18n'
import { getStoredPredicates, PREDICATES, FACET_KEY_TO_CLASS, inferThingRole, getDatatypeDef, resolveValueType } from '../meta/ontology'
import type { EntityClassId } from '../meta/ontology'
import { resolvePredicateLabel, resolvePredicateInverseLabel } from '../meta/vocabulary'
import { evaluateAllGaps } from '../engine/completeness'

/** Extract human-readable text from an ActionCondition (typed or legacy string). */
function conditionText(c: ActionCondition | string): string {
  if (typeof c === 'string') return c
  return c.description ?? `${c.type} condition`
}

/** Generate the full markdown content for a business map. */
export function exportMarkdownContent(map: RootContext): string {
  const lines: string[] = [`# ${map.name}`, '']
  if (map.description) lines.push(`> ${map.description}`, '')

  // Pre-compute all gaps for annotation
  const allViolations = evaluateAllGaps(map)
  // Build a lookup: entityId → violations for that entity
  const violationsByEntity = new Map<string, AssertionViolation[]>()
  for (const v of allViolations) {
    const list = violationsByEntity.get(v.entityId) ?? []
    list.push(v)
    violationsByEntity.set(v.entityId, list)
  }

  // Model-level summary
  if (allViolations.length > 0) {
    const contexts = new Set(allViolations.map(v => v.entityId))
    lines.push(`> **Structural questions:** ${allViolations.length} across ${contexts.size} entities`, '')
  }

  // Derive export-specific metadata from BASE_FACET_REGISTRY, adding tag + subKey
  const EXPORT_TAG: Record<FacetType, string> = {
    things: 'THG', personas: 'PER', ports: 'PRT', actions: 'ACT',
    workflows: 'WKF', interfaces: 'INT', events: 'EVT', measures: 'MSR',
    functions: 'FUN', datasources: 'DSR', pipelines: 'PIP',
  }
  const EXPORT_SUBKEY: Record<FacetType, string> = {
    things: 'definition', personas: 'description', ports: 'description', actions: 'description',
    workflows: 'description', interfaces: 'description', events: 'description', measures: 'description',
    functions: 'description', datasources: 'description', pipelines: 'description',
  }
  const FACET_EXPORT_META: Record<string, { label: string; tag: string; subKey: string }> = Object.fromEntries(
    Object.entries(BASE_FACET_REGISTRY).map(([key, meta]) => [
      key,
      { label: resolveI18n(meta.label), tag: EXPORT_TAG[key as FacetType], subKey: EXPORT_SUBKEY[key as FacetType] },
    ]),
  )

  // Build a name lookup map once - O(1) per lookup instead of O(n*m)
  const nameById = new Map<string, string>()
  for (const ctx of [map as any, ...Object.values(map.contexts)]) {
    for (const key of FACET_TYPES) {
      for (const item of (ctx.facets[key] ?? [])) nameById.set(item.uri, item.name)
    }
  }
  for (const ctx of Object.values(map.contexts)) {
    nameById.set(ctx.uri, ctx.name)
  }
  nameById.set(map.uri, map.name)
  const lookupName = (id: string) => nameById.get(id) ?? id

  // Link query helpers
  function lTargets(sourceId: string, predicate: LinkPredicate): string[] {
    return map.links.filter(l => l.predicate === predicate && l.sourceUri === sourceId).map(l => l.targetUri)
  }
  function lSources(targetId: string, predicate: LinkPredicate): string[] {
    return map.links.filter(l => l.predicate === predicate && l.targetUri === targetId).map(l => l.sourceUri)
  }

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const linkablePredicates = getStoredPredicates().filter(p => !p.id.startsWith('step:'))

  // Generic link rendering driven by ontology predicates
  function renderLinksForEntity(entityId: string, entityType: EntityClassId): void {
    for (const pred of linkablePredicates) {
      // Custom predicate - group links by their individual labels
      if (pred.id === 'custom') {
        const customOut = map.links.filter(l =>
          l.predicate === 'custom' && l.sourceUri === entityId && l.label,
        )
        const byLabelOut = new Map<string, string[]>()
        for (const l of customOut) {
          const group = byLabelOut.get(l.label!) ?? []
          group.push(l.targetUri)
          byLabelOut.set(l.label!, group)
        }
        for (const [label, targets] of byLabelOut) {
          lines.push(`  ${cap(label)}: ${targets.map(lookupName).join(', ')}`)
        }
        const customIn = map.links.filter(l =>
          l.predicate === 'custom' && l.targetUri === entityId && l.label,
        )
        const byLabelIn = new Map<string, string[]>()
        for (const l of customIn) {
          const group = byLabelIn.get(l.label!) ?? []
          group.push(l.sourceUri)
          byLabelIn.set(l.label!, group)
        }
        for (const [label, sources] of byLabelIn) {
          lines.push(`  ${cap(label)} (inverse): ${sources.map(lookupName).join(', ')}`)
        }
        continue
      }
      if (pred.domain.includes(entityType)) {
        const targets = lTargets(entityId, pred.id as LinkPredicate)
        if (targets.length) {
          const label = resolvePredicateLabel(pred.id, 'business')
          lines.push(`  ${cap(label)}: ${targets.map(lookupName).join(', ')}`)
        }
      }
      if (pred.range.includes(entityType)) {
        const sources = lSources(entityId, pred.id as LinkPredicate)
        if (sources.length) {
          const label = resolvePredicateInverseLabel(pred.id, 'business')
          lines.push(`  ${cap(label)}: ${sources.map(lookupName).join(', ')}`)
        }
      }
    }
  }

  // Render enriched details for a facet (appended after the main line)
  function renderFacetDetails(key: string, facet: any): void {
    // Tags (all facet types)
    if (facet.tags?.length) {
      lines.push(`  - **Tags:** ${facet.tags.join(', ')}`)
    }
    // Entity-specific non-link properties
    if (key === 'things') {
      const linksCompat = map.links.map(l => ({ predicate: l.predicate, sourceId: l.sourceUri, targetId: l.targetUri }))
      const role = facet.thingRole ?? inferThingRole(facet.uri, linksCompat)
      if (role !== 'root') {
        lines.push(`  - _Role: ${role}_`)
      } else if (facet.thingRole !== 'root' && !facet.thingRole) {
        // Show inferred role when it differs from what might be expected
        const inferred = inferThingRole(facet.uri, linksCompat)
        if (inferred !== 'root') lines.push(`  - _Role: ${inferred} (inferred)_`)
      }
      if (facet.attributes?.length) {
        for (const attr of facet.attributes) {
          let suffix = ''
          if (attr.type === 'reference' && attr.referencedThingId) {
            const compTag = attr.referenceType === 'composition' ? ' (composition)' : ''
            suffix = ` → ${lookupName(attr.referencedThingId)}${compTag}`
          } else if (attr.type === 'enum' && attr.enumValues?.length) {
            suffix = `: ${attr.enumValues.join(' | ')}`
          } else if (attr.type === 'money' && attr.currencyCode) {
            suffix = ` [${attr.currencyCode}]`
          } else if (attr.type === 'quantity' && attr.unit) {
            suffix = ` [${attr.unit}]`
          }
          const dt = getDatatypeDef(attr.type)
          const typeLabel = dt?.label ?? attr.type
          lines.push(`  - \`${attr.name}\` (${typeLabel}${suffix})`)
        }
      }
      if (facet.states?.length) {
        const sorted = [...facet.states].sort((a: any, b: any) => {
          if (a.initial) return -1
          if (b.initial) return 1
          if (a.terminal && !b.terminal) return 1
          if (b.terminal && !a.terminal) return -1
          return 0
        })
        const stateLabels = sorted.map((s: any) => s.terminal ? `${s.name} (terminal)` : s.name)
        lines.push(`  - **States:** ${stateLabels.join(' → ')}`)
      }
    }
    if (key === 'actions') {
      if (facet.type) lines.push(`  - _Type: ${facet.type}_`)
      if (facet.preconditions?.length) {
        lines.push('  - **Preconditions:**')
        for (const pre of facet.preconditions) lines.push(`    - ${conditionText(pre)}`)
      }
      if (facet.postconditions?.length) {
        lines.push('  - **Postconditions:**')
        for (const post of facet.postconditions) lines.push(`    - ${conditionText(post)}`)
      }
    }
    if (key === 'events') {
      if (facet.eventType) lines.push(`  - _Type: ${facet.eventType}_`)
      if (facet.payload?.length) {
        lines.push('  - **Payload:**')
        for (const field of facet.payload) {
          const source = field.sourceThingId ? ` → ${lookupName(field.sourceThingId)}${field.sourceAttributeName ? `.${field.sourceAttributeName}` : ''}` : ''
          const type = field.type && !field.sourceThingId ? ` (${field.type})` : ''
          lines.push(`    - \`${field.name}\`${type}${source}${field.description ? ` - ${field.description}` : ''}`)
        }
      }
    }
    if (key === 'measures') {
      if (facet.measureType) lines.push(`  - _Type: ${facet.measureType}_`)
      if (facet.target) {
        const t = facet.target
        const parts: string[] = [t.direction]
        if (t.min !== undefined) parts.push(`min: ${t.min}`)
        if (t.max !== undefined) parts.push(`max: ${t.max}`)
        lines.push(`  - **Target:** ${parts.join(', ')}`)
      }
    }
    if (key === 'workflows' && facet.steps?.length) {
      if (facet.trigger && facet.trigger.type !== 'manual') {
        const triggerDesc = facet.trigger.description ? ` "${facet.trigger.description}"` : ''
        lines.push(`  *(trigger: ${facet.trigger.type}${triggerDesc})*`)
      }
      for (let si = 0; si < facet.steps.length; si++) {
        const step = facet.steps[si]
        const stepName = step.name ?? 'Step'
        const actionId = lTargets(step.id, PREDICATES['step:action'].id as LinkPredicate)[0]
        const actionName = actionId ? lookupName(actionId) : null
        const performerId = lTargets(step.id, PREDICATES['step:performer'].id as LinkPredicate)[0]
        const performerName = performerId ? lookupName(performerId) : null
        let stepLine = `  ${si + 1}. ${stepName}`
        const meta = [actionName, performerName].filter(Boolean)
        if (meta.length) stepLine += ` (${meta.join(' / ')})`
        if (step.transitions?.length) {
          const trParts = step.transitions.map((tr: any) => {
            const tgt = facet.steps.find((s: any) => s.id === tr.targetStepId)
            const tgtName = tgt ? (tgt.name ?? tgt.label ?? 'Step') : '?'
            return `${tr.label}: ${tgtName}${tr.guard ? ` [guard: ${tr.guard}]` : ''}`
          })
          stepLine += ` → ${trParts.join(', ')}`
        }
        lines.push(stepLine)
      }
    }
    // Generic link rendering for all facet types
    renderLinksForEntity(facet.uri, FACET_KEY_TO_CLASS[key as keyof typeof FACET_KEY_TO_CLASS])
  }

  // Root-level facets (workspace itself may have Things, Personas, etc.)
  let hasRootFacets = false
  for (const [key, meta] of Object.entries(FACET_EXPORT_META)) {
    const facets = (map as any).facets[key] ?? []
    if (facets.length === 0) continue
    if (!hasRootFacets) {
      lines.push('## (Workspace level)', '')
      hasRootFacets = true
    }
    lines.push(`### [${meta.tag}] ${meta.label}`)
    for (const facet of facets) {
      const sub: string = facet[meta.subKey] || ''
      lines.push(`- **${facet.name}**${sub ? `: ${sub}` : ''}`)
      renderFacetDetails(key, facet)
    }
    lines.push('')
  }

  // Render Symbols
  const rootSymbols = (map as any).symbols ?? []
  if (rootSymbols.length > 0) {
    if (!hasRootFacets) {
      lines.push('## (Workspace level)', '')
      hasRootFacets = true
    }
    lines.push('### [SYM] Symbols')
    for (const sym of rootSymbols) {
      const displayName = sym.label ?? sym.content?.split('\n')[0]?.slice(0, 80) ?? ''
      const preview = sym.content && sym.content.length > 100 ? sym.content.slice(0, 100) + '...' : sym.content ?? ''
      lines.push(`- **${displayName}**${preview !== displayName ? `: ${preview}` : ''}`)
    }
    lines.push('')
  }

  for (const ctx of Object.values(map.contexts)) {
    lines.push(`## ${ctx.name}`)
    if (ctx.description) lines.push(`> ${ctx.description}`, '')
    if (ctx.tags?.length) lines.push(`**Tags:** ${ctx.tags.join(', ')}`, '')

    for (const [key, meta] of Object.entries(FACET_EXPORT_META)) {
      const facets = (ctx as any).facets[key] ?? []
      if (facets.length === 0) continue
      lines.push(`### [${meta.tag}] ${meta.label}`)
      for (const facet of facets) {
        const sub: string = facet[meta.subKey] || ''
        lines.push(`- **${facet.name}**${sub ? `: ${sub}` : ''}`)
        renderFacetDetails(key, facet)
      }
      lines.push('')
    }

    const ctxSymbols = ctx.symbols ?? []
    if (ctxSymbols.length > 0) {
      lines.push('### [SYM] Symbols')
      for (const sym of ctxSymbols) {
        const displayName = sym.label ?? sym.content?.split('\n')[0]?.slice(0, 80) ?? ''
        const preview = sym.content && sym.content.length > 100 ? sym.content.slice(0, 100) + '...' : sym.content ?? ''
        lines.push(`- **${displayName}**${preview !== displayName ? `: ${preview}` : ''}`)
      }
      lines.push('')
    }

    // Structural questions for this context's entities
    const ctxEntityIds = new Set<string>([ctx.uri])
    for (const ft of FACET_TYPES) {
      for (const f of ((ctx as any).facets[ft] ?? []) as Array<{ uri: string }>) ctxEntityIds.add(f.uri)
    }
    const ctxViolations = allViolations.filter(v => ctxEntityIds.has(v.entityId))
    if (ctxViolations.length > 0) {
      lines.push('### Structural Questions')
      for (const v of ctxViolations) {
        lines.push(`- ${v.message}`)
      }
      lines.push('')
    }
  }

  let hasConnections = false
  for (const pred of linkablePredicates) {
    const predLinks = map.links.filter(l => l.predicate === pred.id)
    if (!predLinks.length) continue
    if (!hasConnections) { lines.push('## Connections'); hasConnections = true }
    for (const link of predLinks) {
      const src = lookupName(link.sourceUri)
      const tgt = lookupName(link.targetUri)
      // For custom predicates, use the link's label as the relationship name
      const relName = pred.id === 'custom' && link.label
        ? ` _${link.label}_`
        : ''
      const label = pred.id !== 'custom' && link.label ? ` - _${link.label}_` : ''
      const pattern = link.pattern ? ` [${link.pattern}]` : ''
      lines.push(`- **${src}** →${relName} **${tgt}**${label}${pattern}`)
    }
  }
  if (hasConnections) lines.push('')

  return lines.join('\n')
}

// ── Phase E: Engineer, Founder & Investor Exports ─────────────────────────────

// ── Helpers ───────────────────────────────────────────────────────────────────

function allContainers(map: RootContext): FacetContainer[] {
  return [map as FacetContainer, ...Object.values(map.contexts)]
}

function allThings(map: RootContext): Thing[] {
  return allContainers(map).flatMap(c => c.facets.things)
}

function allActions(map: RootContext): Action[] {
  return allContainers(map).flatMap(c => c.facets.actions)
}

function allEvents(map: RootContext): Event[] {
  return allContainers(map).flatMap(c => c.facets.events)
}

function allPorts(map: RootContext): Port[] {
  return allContainers(map).flatMap(c => c.facets.ports)
}

function linkTargets(map: RootContext, sourceId: string, predicate: LinkPredicate): string[] {
  return map.links.filter(l => l.predicate === predicate && l.sourceUri === sourceId).map(l => l.targetUri)
}

function linkSources(map: RootContext, targetId: string, predicate: LinkPredicate): string[] {
  return map.links.filter(l => l.predicate === predicate && l.targetUri === targetId).map(l => l.sourceUri)
}

function toPascalCase(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
}

function toCamelCase(name: string): string {
  const pascal = toPascalCase(name)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

function buildNameLookup(map: RootContext): (id: string) => string {
  const nameById = new Map<string, string>()
  for (const ctx of allContainers(map)) {
    for (const key of FACET_TYPES) {
      for (const item of (ctx as any).facets[key] ?? []) {
        nameById.set(item.uri, item.name)
      }
    }
  }
  for (const ctx of allContainers(map)) {
    for (const sym of ctx.symbols ?? []) {
      nameById.set(sym.uri, sym.label ?? sym.content?.slice(0, 80) ?? sym.uri)
    }
  }
  for (const ctx of Object.values(map.contexts)) {
    nameById.set(ctx.uri, ctx.name)
  }
  return (id: string) => nameById.get(id) ?? id
}

// ── E.1 Engineer Export ───────────────────────────────────────────────────────

// E.1.1
export function generateTypeScriptTypes(map: RootContext): string {
  const lines: string[] = [
    '// ── TypeScript Types (generated from Business Map) ──────────────────────────',
    '',
  ]
  const lookup = buildNameLookup(map)

  for (const thing of allThings(map)) {
    const interfaceName = toPascalCase(thing.name)

    // JSDoc from rules
    if (thing.rules?.length) {
      lines.push('/**')
      for (const rule of thing.rules) {
        lines.push(` * @rule ${rule}`)
      }
      lines.push(' */')
    }

    if (thing.attributes.length === 0) {
      lines.push(`// ${interfaceName} - no attributes defined yet`)
      lines.push(`export interface ${interfaceName} {}`)
      lines.push('')
      continue
    }

    lines.push(`export interface ${interfaceName} {`)

    for (const attr of thing.attributes) {
      // Special cases that need custom handling
      if (attr.type === 'enum') {
        const tsType = attr.enumValues?.length
          ? attr.enumValues.map(v => `'${v}'`).join(' | ')
          : 'string'
        lines.push(`  ${toCamelCase(attr.name)}: ${tsType}`)
        continue
      }
      if (attr.type === 'reference') {
        const refName = attr.referencedThingId
          ? toPascalCase(lookup(attr.referencedThingId))
          : 'unknown'
        lines.push(`  ${toCamelCase(refName)}Id: string`)
        continue
      }
      if (attr.type === 'money') {
        // Money generates a structured type
        const cur = attr.currencyCode ? ` // ${attr.currencyCode}` : ''
        lines.push(`  ${toCamelCase(attr.name)}: { amount: number; currency: string }${cur}`)
        continue
      }
      if (attr.type === 'quantity') {
        const unit = attr.unit ? ` // ${attr.unit}` : ''
        lines.push(`  ${toCamelCase(attr.name)}: { value: number; unit: string }${unit}`)
        continue
      }
      // All other types: look up tsType from registry
      const dt = getDatatypeDef(attr.type)
      const tsType = dt?.tsType ?? 'unknown'
      lines.push(`  ${toCamelCase(attr.name)}: ${tsType}`)
    }

    lines.push('}')
    lines.push('')
  }

  // Port types - boundary contracts with produces/consumes comments
  for (const port of allPorts(map)) {
    const interfaceName = toPascalCase(port.name) + 'Port'
    const portLinks = map.links
      .filter(l =>
        (l.predicate === 'produces' || l.predicate === 'consumes')
        && l.sourceUri === port.uri,
      )
    const targetNames = portLinks.map(l => lookup(l.targetUri))

    lines.push(`export interface ${interfaceName} {`)
    lines.push(`  direction: '${port.direction}'`)
    if (targetNames.length) {
      lines.push(`  // ${port.direction}: ${targetNames.join(', ')}`)
    }
    lines.push('}')
    lines.push('')
  }

  return lines.join('\n')
}

// E.1.1b
function attributeToZod(
  attr: ThingAttribute,
  valueTypes: ValueTypeDef[],
): string {
  // If the attribute has a ValueType, merge its constraints
  let constraints: ValueConstraint[] = [...(attr.constraints ?? [])]
  if (attr.valueTypeId) {
    const vt = resolveValueType(attr.valueTypeId, valueTypes)
    if (vt) constraints = [...vt.constraints, ...constraints]
  }

  // Special types
  if (attr.type === 'enum' && attr.enumValues?.length) {
    return `z.enum([${attr.enumValues.map(v => `'${v}'`).join(', ')}])`
  }
  if (attr.type === 'reference') {
    return 'z.string().uuid()'
  }

  // Built-in Zod validators for known ValueTypes
  if (attr.valueTypeId === 'email') return 'z.string().email()'
  if (attr.valueTypeId === 'url') return 'z.string().url()'

  // Base Zod type from datatype
  let base = 'z.string()'
  const dt = getDatatypeDef(attr.type)
  if (dt) {
    switch (dt.baseType) {
      case 'number': base = 'z.number()'; break
      case 'boolean': base = 'z.boolean()'; break
      case 'temporal': base = attr.type === 'duration' ? 'z.string()' : 'z.coerce.date()'; break
      default: base = 'z.string()'; break
    }
  }

  // Apply constraints
  let chain = base
  for (const c of constraints) {
    switch (c.type) {
      case 'regex':
        if (c.pattern) chain += `.regex(/${c.pattern}/)`
        break
      case 'range':
        if (c.min !== undefined) chain += `.min(${c.min})`
        if (c.max !== undefined) chain += `.max(${c.max})`
        break
      case 'length':
        if (c.minLength !== undefined) chain += `.min(${c.minLength})`
        if (c.maxLength !== undefined) chain += `.max(${c.maxLength})`
        break
      case 'enum':
        if (c.allowedValues?.length) {
          return `z.enum([${c.allowedValues.map((v: string) => `'${v}'`).join(', ')}])`
        }
        break
    }
  }

  return chain
}

/** Generate Zod validation schemas from Thing attributes with ValueType constraints. */
export function generateZodSchemas(map: RootContext): string {
  const lines: string[] = [
    "import { z } from 'zod'",
    '',
  ]

  const things = allThings(map)

  for (const thing of things) {
    const schemaName = thing.name.replace(/[^a-zA-Z0-9]/g, '') + 'Schema'
    lines.push(`export const ${schemaName} = z.object({`)

    for (const attr of thing.attributes) {
      const zodType = attributeToZod(attr, map.valueTypes ?? [])
      const opt = attr.required ? '' : '.optional()'
      lines.push(`  ${attr.name}: ${zodType}${opt},`)
    }

    lines.push('})')
    lines.push('')
  }

  return lines.join('\n')
}

// E.1.2
export function generateEventSchemas(map: RootContext): string {
  const lines: string[] = [
    '// ── Event Schemas (generated from Business Map) ─────────────────────────────',
    '',
  ]
  const lookup = buildNameLookup(map)

  const events = allEvents(map)

  for (const event of events) {
    const interfaceName = toPascalCase(event.name) + 'Event'

    // Find source action via `emits` links (action emits event)
    const sourceActionIds = linkSources(map, event.uri, PREDICATES.emits.id as LinkPredicate)
    const sourceActions = sourceActionIds.map(id => lookup(id))

    // Events don't have measures links - skip thing lookup
    const relatedThings: string[] = []

    if (sourceActions.length) {
      lines.push(`/** Emitted by: ${sourceActions.join(', ')} */`)
    }

    lines.push(`export interface ${interfaceName} {`)
    lines.push(`  type: '${event.name}'`)
    lines.push(`  timestamp: Date`)

    for (const thingName of relatedThings) {
      lines.push(`  ${toCamelCase(thingName)}?: ${toPascalCase(thingName)}`)
    }

    lines.push('}')
    lines.push('')
  }

  return lines.join('\n')
}

// E.1.3
export function generateGuardFunctions(map: RootContext): string {
  const lines: string[] = [
    '// ── Guard Functions (generated from Business Map) ───────────────────────────',
    '',
  ]

  const thingsWithRules = allThings(map).filter(t => t.rules?.length)

  for (const thing of thingsWithRules) {
    const pascalName = toPascalCase(thing.name)
    const paramName = toCamelCase(thing.name)

    lines.push(`export function can${pascalName}(${paramName}: ${pascalName}): boolean {`)

    for (const rule of thing.rules!) {
      lines.push(`  // TODO: implement - ${rule}`)
    }

    lines.push('  return true')
    lines.push('}')
    lines.push('')
  }

  return lines.join('\n')
}

// E.1.4
export function generateTestSkeletons(map: RootContext): string {
  const lines: string[] = [
    '// ── Test Skeletons (generated from Business Map) ────────────────────────────',
    '',
  ]
  const lookup = buildNameLookup(map)

  for (const action of allActions(map)) {
    lines.push(`describe('${action.name}', () => {`)

    // Find related entities via links
    const performerIds = linkSources(map, action.uri, PREDICATES.performs.id as LinkPredicate)
    const performers = performerIds.map(id => lookup(id))
    const readIds = linkTargets(map, action.uri, PREDICATES.reads.id as LinkPredicate)
    const reads = readIds.map(id => lookup(id))
    const writeIds = linkTargets(map, action.uri, PREDICATES.writes.id as LinkPredicate)
    const writes = writeIds.map(id => lookup(id))
    const emitIds = linkTargets(map, action.uri, PREDICATES.emits.id as LinkPredicate)
    const emits = emitIds.map(id => lookup(id))

    lines.push(`  it('should execute ${action.name}', () => {`)

    if (performers.length || reads.length) {
      const arrangeItems = [
        ...performers.map(p => `${p} (performer)`),
        ...reads.map(r => `${r} (input)`),
      ]
      lines.push(`    // Arrange: ${arrangeItems.join(', ')}`)
    } else {
      lines.push('    // Arrange: set up preconditions')
    }

    if (action.preconditions?.length) {
      for (const pre of action.preconditions) {
        lines.push(`    // Precondition: ${conditionText(pre)}`)
      }
    }

    lines.push(`    // Act: ${action.name}`)

    if (action.postconditions?.length) {
      for (const post of action.postconditions) {
        lines.push(`    // Postcondition: ${conditionText(post)}`)
      }
    }

    if (writes.length || emits.length) {
      const assertItems = [
        ...writes.map(w => `${w} updated`),
        ...emits.map(e => `${e} emitted`),
      ]
      lines.push(`    // Assert: ${assertItems.join(', ')}`)
    } else {
      lines.push('    // Assert: verify expected outcome')
    }

    lines.push('  })')

    // Guard condition tests from related things with rules
    const relatedThingIds = [...readIds, ...writeIds]
    const relatedThings = allThings(map).filter(t => relatedThingIds.includes(t.uri) && t.rules?.length)

    for (const thing of relatedThings) {
      for (const rule of thing.rules!) {
        lines.push('')
        lines.push(`  it('should validate ${thing.name}: ${rule}', () => {`)
        lines.push(`    // Arrange: set up ${thing.name} violating rule`)
        lines.push(`    // Act: attempt ${action.name}`)
        lines.push(`    // Assert: validation rejects`)
        lines.push('  })')
      }
    }

    lines.push('})')
    lines.push('')
  }

  return lines.join('\n')
}

// E.1.5
export function generateServiceBoundaries(map: RootContext): string {
  const lines: string[] = [
    '# Service Boundaries',
    '',
    '_Generated from Business Map_',
    '',
  ]
  const lookup = buildNameLookup(map)
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const linkablePredicates = getStoredPredicates().filter(p => !p.id.startsWith('step:'))

  for (const ctx of Object.values(map.contexts)) {
    lines.push(`## ${ctx.name}`)
    if (ctx.description) lines.push(`> ${ctx.description}`)
    lines.push('')

    if (ctx.facets.things.length) {
      lines.push('### Things')
      for (const t of ctx.facets.things) {
        lines.push(`- ${t.name}${t.definition ? `: ${t.definition}` : ''}`)
      }
      lines.push('')
    }

    const commands = ctx.facets.actions.filter(a => a.type === 'command')
    const queries = ctx.facets.actions.filter(a => a.type === 'query')
    const intents = ctx.facets.actions.filter(a => a.type === 'intent')

    if (commands.length) {
      lines.push('### Commands')
      for (const a of commands) lines.push(`- ${a.name}`)
      lines.push('')
    }
    if (queries.length) {
      lines.push('### Queries')
      for (const a of queries) lines.push(`- ${a.name}`)
      lines.push('')
    }
    if (intents.length) {
      lines.push('### Intents')
      for (const a of intents) lines.push(`- ${a.name}`)
      lines.push('')
    }

    if (ctx.facets.events.length) {
      lines.push('### Events')
      for (const e of ctx.facets.events) lines.push(`- ${e.name}`)
      lines.push('')
    }
    if (ctx.facets.measures.length) {
      lines.push('### Measures')
      for (const m of ctx.facets.measures) lines.push(`- ${m.name}${m.unit ? ` (${m.unit})` : ''}`)
      lines.push('')
    }

    if (ctx.facets.interfaces.length) {
      lines.push('### Interfaces')
      for (const i of ctx.facets.interfaces) lines.push(`- ${i.name} (${i.kind})`)
      lines.push('')
    }

    if (ctx.facets.ports.length) {
      lines.push('### Boundary Contracts')
      for (const port of ctx.facets.ports) {
        const portLinks = map.links
          .filter(l =>
            (l.predicate === 'produces' || l.predicate === 'consumes')
            && l.sourceUri === port.uri,
          )
        const targetNames = portLinks.map(l => lookup(l.targetUri))
        const suffix = targetNames.length ? `: ${targetNames.join(', ')}` : ''
        lines.push(`- [${port.direction}] ${port.name}${suffix}`)
      }
      lines.push('')
    }

    // Cross-context links for this context
    for (const pred of linkablePredicates) {
      const incoming = map.links
        .filter(l => l.predicate === pred.id && l.targetUri === ctx.uri)
        .map(l => {
          const name = lookup(l.sourceUri)
          return l.label ? `${name} (${l.label})` : name
        })
      const outgoing = map.links
        .filter(l => l.predicate === pred.id && l.sourceUri === ctx.uri)
        .map(l => {
          const name = lookup(l.targetUri)
          return l.label ? `${name} (${l.label})` : name
        })
      const predLabel = resolvePredicateLabel(pred.id, 'business')
      const inversePredLabel = resolvePredicateInverseLabel(pred.id, 'business')
      if (incoming.length) {
        lines.push(`**${cap(inversePredLabel)}:** ${incoming.join(', ')}`)
        lines.push('')
      }
      if (outgoing.length) {
        lines.push(`**${cap(predLabel)}:** ${outgoing.join(', ')}`)
        lines.push('')
      }
    }

    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}

// ── Phase D: Action Function Code Generation ────────────────────────────────

function paramToZod(param: ActionParameter, map: RootContext): string {
  if (param.sourceThingId && param.sourceAttribute) {
    const things = allThings(map)
    const thing = things.find(t => t.uri === param.sourceThingId)
    const attr = thing?.attributes.find(a => a.name === param.sourceAttribute)
    if (attr) {
      const dt = getDatatypeDef(attr.type)
      if (dt?.baseType === 'number') return 'z.number()'
      if (dt?.baseType === 'boolean') return 'z.boolean()'
      return 'z.string()'
    }
  }
  if (param.type) {
    const dt = getDatatypeDef(param.type)
    if (dt?.baseType === 'number') return 'z.number()'
    if (dt?.baseType === 'boolean') return 'z.boolean()'
  }
  return 'z.string()'
}

function fieldSourceToCode(source: FieldSource): string {
  switch (source.from) {
    case 'parameter': return `input.${source.paramName}`
    case 'attribute': return `${source.thingRef}.${source.attribute}`
    case 'static': return JSON.stringify(source.value)
    case 'computed': return `/* computed: ${source.expression} */ undefined`
    case 'currentUser': return 'ctx.userId'
    case 'currentTime': return 'new Date()'
    default: return 'undefined'
  }
}

/** Generate executable Action functions from Actions with structured rules. */
export function generateActionFunctions(map: RootContext): string {
  const lines: string[] = [
    '// Generated Action functions',
    '// Each function implements the mutation rules, preconditions, and side effects',
    '// defined in the Business Map model.',
    '',
    "import { z } from 'zod'",
    '',
  ]

  const actions = allActions(map)

  for (const action of actions) {
    // Only generate for actions that have parameters or mutations defined
    if (!action.parameters?.length && !action.mutations?.length) continue

    const fnName = toCamelCase(action.name)
    const typeName = toPascalCase(action.name)

    // Generate input schema from parameters
    if (action.parameters?.length) {
      lines.push(`// ── ${action.name} ─────────────────────────────────`)
      lines.push(`export const ${typeName}InputSchema = z.object({`)
      for (const param of action.parameters) {
        const zodType = paramToZod(param, map)
        const opt = param.required ? '' : '.optional()'
        lines.push(`  ${param.name}: ${zodType}${opt},`)
      }
      lines.push('})')
      lines.push(`export type ${typeName}Input = z.infer<typeof ${typeName}InputSchema>`)
      lines.push('')
    }

    // Generate the function
    lines.push(`export async function ${fnName}(`)
    if (action.parameters?.length) {
      lines.push(`  params: ${typeName}Input,`)
    }
    lines.push('  ctx: { userId: string; db: any; eventBus?: any }')
    lines.push(') {')

    // 1. Validate input
    if (action.parameters?.length) {
      lines.push('  // 1. Validate input')
      lines.push(`  const input = ${typeName}InputSchema.parse(params)`)
      lines.push('')
    }

    // 2. Authorization
    if (action.authorization) {
      lines.push('  // 2. Authorization')
      if (action.authorization.mode === 'performers-only') {
        lines.push(`  // TODO: Check ctx.userId against performers of "${action.name}"`)
      } else if (action.authorization.mode === 'custom' && action.authorization.customCondition) {
        lines.push(`  // Authorization: ${action.authorization.customCondition}`)
      }
      lines.push('')
    }

    // 3. Preconditions
    if (action.preconditions?.length) {
      lines.push('  // 3. Preconditions')
      for (const pre of action.preconditions) {
        if (pre.type === 'text') {
          lines.push(`  // Precondition: ${pre.description}`)
        } else if (pre.type === 'state') {
          lines.push(`  // Precondition: Thing "${pre.thingId}" must be in state "${pre.stateId}"`)
        } else if (pre.type === 'field') {
          lines.push(`  // Precondition: Thing "${pre.thingId}".${pre.attribute} ${pre.operator} ${pre.value ?? ''}`)
        }
      }
      lines.push('')
    }

    // 4. Mutations
    if (action.mutations?.length) {
      lines.push('  // 4. Mutations')
      lines.push('  const result = await ctx.db.$transaction(async (tx: any) => {')

      for (const rule of action.mutations) {
        switch (rule.type) {
          case 'create':
            lines.push(`    // Create ${rule.thingId ?? 'entity'}`)
            if (rule.fieldMappings) {
              const fields = Object.entries(rule.fieldMappings)
                .map(([k, v]) => `${k}: ${fieldSourceToCode(v)}`)
                .join(', ')
              lines.push(`    const created = await tx.create({ ${fields} })`)
            } else {
              lines.push('    const created = await tx.create({})')
            }
            break
          case 'modify':
            lines.push(`    // Modify ${rule.thingId ?? 'entity'}`)
            lines.push('    await tx.update({ /* field mappings */ })')
            break
          case 'delete':
            lines.push(`    // Delete ${rule.thingId ?? 'entity'}`)
            lines.push('    await tx.delete({})')
            break
          case 'transitionState':
            lines.push(`    // Transition state to "${rule.targetStateId}"`)
            lines.push(`    await tx.update({ state: '${rule.targetStateId ?? ''}' })`)
            break
          case 'createLink':
            lines.push(`    // Create link: ${rule.predicate ?? '?'} from ${rule.sourceRef ?? '?'} to ${rule.targetRef ?? '?'}`)
            break
          case 'deleteLink':
            lines.push(`    // Delete link: ${rule.predicate ?? '?'}`)
            break
        }
      }

      lines.push('    return created')
      lines.push('  })')
      lines.push('')
    }

    // 5. Side effects
    if (action.sideEffects?.length) {
      lines.push('  // 5. Side effects')
      for (const effect of action.sideEffects) {
        switch (effect.type) {
          case 'emit':
            lines.push(`  await ctx.eventBus?.emit('${effect.eventId ?? action.name}', { /* payload */ })`)
            break
          case 'notify':
            lines.push(`  // Notify via ${effect.channel ?? 'unknown'}: ${effect.template ?? ''}`)
            break
          case 'webhook':
            lines.push(`  // Webhook: ${effect.method ?? 'POST'} ${effect.url ?? ''}`)
            break
          case 'invoke':
            lines.push(`  // Invoke action: ${effect.actionId ?? '?'}`)
            break
        }
      }
      lines.push('')
    }

    // Return
    if (action.mutations?.length) {
      lines.push('  return result')
    }

    lines.push('}')
    lines.push('')
  }

  return lines.join('\n')
}

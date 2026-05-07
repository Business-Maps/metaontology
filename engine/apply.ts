import { produce, setAutoFreeze } from 'immer'
import { nanoid } from 'nanoid'
import type { RootContext, Context, Facet, FacetType, Symbol, Link, FacetContainer, Thing, Persona, Port, Action, Workflow, Interface, Event, Measure, ActionCondition  } from '../types/context'
import type { Command, CommandResult, DomainEvent, BatchCommand } from '../types/commands'
import { isM0Command } from '../types/commands'
import { PREDICATES, validateLink } from '../meta/ontology'
import type { EntityClassId, PredicateDef } from '../meta/ontology'
import { createEmptyFacets } from '../meta/facets'
import { getRegisteredFacetKeys, isRegisteredFacetKey, facetKeyToClass } from '../dsl/engineBridge'
import { buildFacetFromArgs } from '../meta/fields'
import { parseStringToDoc } from '../content/parseStringToDoc'

setAutoFreeze(false)

/** Normalize legacy string[] preconditions/postconditions to ActionCondition[]. @public */
export function normalizeConditions(conditions: unknown[] | undefined): ActionCondition[] | undefined {
  if (!conditions?.length) return conditions as ActionCondition[] | undefined
  return conditions.map(c =>
    typeof c === 'string' ? { type: 'text' as const, description: c } : c as ActionCondition,
  )
}

/** Create a default facet with minimal required fields for any facet type.
 *  Each facet type has a unique default shape - this switch is intentional. */
export function createDefaultFacet(type: 'things', name: string, uri?: string): Thing
export function createDefaultFacet(type: 'personas', name: string, uri?: string): Persona
export function createDefaultFacet(type: 'actions', name: string, uri?: string): Action
export function createDefaultFacet(type: 'workflows', name: string, uri?: string): Workflow
export function createDefaultFacet(type: 'interfaces', name: string, uri?: string): Interface
export function createDefaultFacet(type: 'events', name: string, uri?: string): Event
export function createDefaultFacet(type: 'measures', name: string, uri?: string): Measure
export function createDefaultFacet(type: 'ports', name: string, uri?: string): Port
export function createDefaultFacet(type: FacetType, name: string, uri?: string): Facet
export function createDefaultFacet(type: FacetType, name: string, uri = nanoid()): Facet {
  return buildFacetFromArgs(type, { name }, uri).facet as unknown as Facet
}

/** Type-safe accessor for facet arrays on a context or root.
 *  Falls back to customFacets for user-defined entity types. */
function getFacetArray(ctx: RootContext | Context, type: FacetType | string): Facet[] {
  // Built-in facet types
  if (type in ctx.facets) return ctx.facets[type as FacetType] as Facet[]
  // Custom types - stored in customFacets
  if (ctx.customFacets?.[type]) return ctx.customFacets[type]!
  return []
}

/** Check if a type key refers to a registered facet type. */
function isBuiltInFacetType(type: string): type is FacetType {
  return isRegisteredFacetKey(type)
}

/** Ensure custom facet array exists for a given type key - creates it if missing.
 *  Used by write paths (facet:add, facet:move) that push into custom facet arrays. */
function ensureCustomFacetArray(ctx: RootContext | Context, type: string): Facet[] {
  if (!ctx.customFacets) ctx.customFacets = {}
  if (!ctx.customFacets[type]) ctx.customFacets[type] = []
  return ctx.customFacets[type]!
}

/** Get a mutable facet array for writes. For built-in types, returns the existing
 *  array from ctx.facets. For custom types, ensures the customFacets entry exists. */
function getMutableFacetArray(ctx: RootContext | Context, type: FacetType | string): Facet[] {
  if (isBuiltInFacetType(type)) return ctx.facets[type] as Facet[]
  return ensureCustomFacetArray(ctx, type)
}

export function createEmptyRootContext(name = 'Untitled Context'): RootContext {
  const now = new Date().toISOString()
  return {
    uri: nanoid(),
    name,
    description: '',
    facets: createEmptyFacets(),
    contexts: {},
    links: [],
    symbols: [],
    meta: { createdAt: now, updatedAt: now },
  }
}


export function createEmptyContext(name: string, parentUri: string): Context {
  return {
    uri: nanoid(),
    name,
    description: '',
    parentUri,
    facets: createEmptyFacets(),
    symbols: [],
  }
}

/**
 * Resolves the mutation target: the root map if contextId matches the map ID,
 * otherwise the named sub-context.
 */
function resolveTarget(draft: RootContext, contextUri: string): RootContext | Context | null {
  return contextUri === draft.uri ? draft : (draft.contexts[contextUri] ?? null)
}


/** Helper: find a symbol anywhere in the model. Checks the targeted container
 *  first, then falls back to scanning all containers (handles stale contextUri). */
function findSymbol(root: RootContext, symbolUri: string, contextUri?: string): boolean {
  if (contextUri && contextUri !== root.uri) {
    const ctx = root.contexts[contextUri]
    if ((ctx?.symbols ?? []).some(s => s.uri === symbolUri)) return true
  } else if ((root.symbols ?? []).some(s => s.uri === symbolUri)) {
    return true
  }
  // Fallback: scan all containers
  if ((root.symbols ?? []).some(s => s.uri === symbolUri)) return true
  for (const ctx of Object.values(root.contexts)) {
    if ((ctx.symbols ?? []).some(s => s.uri === symbolUri)) return true
  }
  return false
}

/**
 * Scan the RootContext state tree to determine what entity class an ID belongs to.
 * Returns the EntityClassId or null if the ID is not found.
 */
export function resolveEntityType(root: RootContext, id: string): EntityClassId | null {
  // Check if it's the root context or a sub-context
  if (id === root.uri) return 'Context'
  if (root.contexts[id]) return 'Context'

  // Check if it's a symbol (root or any sub-context)
  if ((root.symbols ?? []).some(s => s.uri === id)) return 'Symbol'
  for (const ctx of Object.values(root.contexts)) {
    if ((ctx.symbols ?? []).some(s => s.uri === id)) return 'Symbol'
  }

  // Check each registered facet type on root and all contexts
  for (const ft of getRegisteredFacetKeys()) {
    if ((root.facets[ft] as Facet[]).some((f: Facet) => f.uri === id)) return (facetKeyToClass(ft) as EntityClassId) ?? null
    for (const ctx of Object.values(root.contexts)) {
      if ((ctx.facets[ft] as Facet[]).some((f: Facet) => f.uri === id)) return (facetKeyToClass(ft) as EntityClassId) ?? null
    }
  }

  // Check custom facets on root and all contexts
  for (const arr of Object.values(root.customFacets ?? {})) {
    if (arr.some((f: Facet) => f.uri === id)) return null // Custom types don't map to EntityClassId
  }
  for (const ctx of Object.values(root.contexts)) {
    for (const arr of Object.values(ctx.customFacets ?? {})) {
      if (arr.some((f: Facet) => f.uri === id)) return null
    }
  }

  // Check workflow steps: iterate all workflows on root and contexts
  for (const wf of root.facets.workflows) {
    if (wf.steps.some(s => s.id === id)) return 'WorkflowStep'
  }
  for (const ctx of Object.values(root.contexts)) {
    for (const wf of ctx.facets.workflows) {
      if (wf.steps.some(s => s.id === id)) return 'WorkflowStep'
    }
  }

  return null
}

/**
 * Validates a command against the current state.
 * Returns null if valid, or an error message string if the command would be invalid.
 */
export function validateCommand(root: RootContext, cmd: Command): string | null {
  switch (cmd.type) {
    case 'context:remove': {
      if (!root.contexts[cmd.payload.contextUri]) {
        return `context:remove - contextId "${cmd.payload.contextUri}" does not exist`
      }
      return null
    }

    case 'context:rename': {
      const { contextUri } = cmd.payload
      if (contextUri !== root.uri && !root.contexts[contextUri]) {
        return `context:rename - contextUri "${contextUri}" does not exist`
      }
      return null
    }

    case 'context:update': {
      const { contextUri } = cmd.payload
      if (contextUri !== root.uri && !root.contexts[contextUri]) {
        return `context:update - contextUri "${contextUri}" does not exist`
      }
      return null
    }

    case 'facet:add': {
      const { contextUri } = cmd.payload
      if (contextUri !== root.uri && !root.contexts[contextUri]) {
        return `facet:add - contextUri "${contextUri}" does not exist`
      }
      if (!cmd.payload.facet.name || cmd.payload.facet.name.trim() === '') {
        return `facet:add - facet name must be non-empty`
      }
      // Reject facets without a uri — they materialize as VueFlow nodes
      // with `id: undefined` and crash the entire canvas mount via
      // `node.id.toString()`. Callers must use `createDefaultFacet`
      // (which assigns a nanoid uri) or supply one explicitly.
      if (!cmd.payload.facet.uri || typeof cmd.payload.facet.uri !== 'string' || cmd.payload.facet.uri.trim() === '') {
        return `facet:add - facet uri must be a non-empty string`
      }
      // Pipeline-specific: sourceOfTruth = 'shared' requires conflictResolution
      if (cmd.payload.facetType === 'pipelines') {
        const pipeline = cmd.payload.facet as unknown as { sourceOfTruth?: string; conflictResolution?: string }
        if (pipeline.sourceOfTruth === 'shared' && !pipeline.conflictResolution) {
          return `facet:add - Pipeline with sourceOfTruth 'shared' requires a conflictResolution Function reference`
        }
      }
      return null
    }

    case 'facet:update': {
      const { contextUri, facetType, facetUri } = cmd.payload
      const target = contextUri === root.uri ? root : root.contexts[contextUri]
      if (!target) {
        return `facet:update - contextUri "${contextUri}" does not exist`
      }
      if (!getFacetArray(target, facetType).some(f => f.uri === facetUri)) {
        return `facet:update - facetUri "${facetUri}" does not exist in ${facetType}`
      }
      // Pipeline-specific: if updating sourceOfTruth to 'shared', conflictResolution must be present
      if (facetType === 'pipelines' && cmd.payload.changes) {
        const changes = cmd.payload.changes as unknown as { sourceOfTruth?: string; conflictResolution?: string }
        const existing = getFacetArray(target, facetType).find(f => f.uri === facetUri) as unknown as { sourceOfTruth?: string; conflictResolution?: string } | undefined
        const sot = changes.sourceOfTruth ?? existing?.sourceOfTruth
        const cr = changes.conflictResolution ?? existing?.conflictResolution
        if (sot === 'shared' && !cr) {
          return `facet:update - Pipeline with sourceOfTruth 'shared' requires a conflictResolution Function reference`
        }
      }
      return null
    }

    case 'facet:remove': {
      const { contextUri, facetType, facetUri } = cmd.payload
      const target = contextUri === root.uri ? root : root.contexts[contextUri]
      if (!target) {
        return `facet:remove - contextUri "${contextUri}" does not exist`
      }
      if (!getFacetArray(target, facetType).some(f => f.uri === facetUri)) {
        return `facet:remove - facetUri "${facetUri}" does not exist in ${facetType}`
      }
      return null
    }

    case 'facet:retype': {
      const { contextUri, facetUri, fromType, toType } = cmd.payload
      if (fromType === toType) return `facet:retype - fromType and toType are the same ("${fromType}")`
      const target = contextUri === root.uri ? root : root.contexts[contextUri]
      if (!target) return `facet:retype - contextUri "${contextUri}" does not exist`
      if (!getFacetArray(target, fromType).some(f => f.uri === facetUri)) {
        return `facet:retype - facetUri "${facetUri}" does not exist in ${fromType}`
      }
      return null
    }

    case 'facet:move': {
      const { sourceContextUri, targetContextUri, facetType, facetUri } = cmd.payload
      const source = sourceContextUri === root.uri ? root : root.contexts[sourceContextUri]
      if (!source) {
        return `facet:move - sourceContextUri "${sourceContextUri}" does not exist`
      }
      const target = targetContextUri === root.uri ? root : root.contexts[targetContextUri]
      if (!target) {
        return `facet:move - targetContextUri "${targetContextUri}" does not exist`
      }
      if (!getFacetArray(source, facetType).some(f => f.uri === facetUri)) {
        return `facet:move - facetUri "${facetUri}" does not exist in source ${facetType}`
      }
      return null
    }

    case 'link:add': {
      if (cmd.payload.sourceUri === cmd.payload.targetUri) {
        return `link:add - sourceUri and targetUri must not be the same ("${cmd.payload.sourceUri}")`
      }
      const sourceType = resolveEntityType(root, cmd.payload.sourceUri)
      const targetType = resolveEntityType(root, cmd.payload.targetUri)
      if (!sourceType) return `link:add - source entity "${cmd.payload.sourceUri}" not found`
      if (!targetType) return `link:add - target entity "${cmd.payload.targetUri}" not found`
      // Symbols bypass ontology validation - they link freely during exploration.
      // On classification, links reroute and pruneInvalidLinks removes violations.
      if (sourceType === 'Symbol' || targetType === 'Symbol') return null
      const err = validateLink(
        cmd.payload.predicate,
        sourceType as EntityClassId,
        targetType as EntityClassId,
        cmd.payload.sourceUri,
        cmd.payload.targetUri,
      )
      if (err) return `link:add - ${err.message}`
      if (cmd.payload.pattern) {
        const validPatterns = [
          'partnership', 'customer-supplier', 'conformist',
          'anticorruption-layer', 'open-host-service', 'published-language',
          'shared-kernel', 'separate-ways',
        ]
        if (!validPatterns.includes(cmd.payload.pattern)) {
          return `link:add - invalid context map pattern: "${cmd.payload.pattern}"`
        }
      }
      return null
    }

    case 'link:remove': {
      if (!root.links.some(l => l.uri === cmd.payload.linkUri)) {
        return `link:remove - linkId "${cmd.payload.linkUri}" does not exist`
      }
      return null
    }

    case 'link:update': {
      if (!root.links.some(l => l.uri === cmd.payload.linkUri)) {
        return `link:update - linkId "${cmd.payload.linkUri}" does not exist`
      }
      if (cmd.payload.pattern) {
        const validPatterns = [
          'partnership', 'customer-supplier', 'conformist',
          'anticorruption-layer', 'open-host-service', 'published-language',
          'shared-kernel', 'separate-ways',
        ]
        if (!validPatterns.includes(cmd.payload.pattern)) {
          return `link:update - invalid context map pattern: "${cmd.payload.pattern}"`
        }
      }
      return null
    }

    case 'symbol:add': {
      // Allow empty content - nascent mode creates with '' then fills via update.
      return null
    }

    case 'symbol:update': {
      if (!findSymbol(root, cmd.payload.symbolUri, cmd.payload.contextUri)) {
        return `symbol:update - symbolId "${cmd.payload.symbolUri}" does not exist`
      }
      return null
    }

    case 'symbol:remove': {
      if (!findSymbol(root, cmd.payload.symbolUri, cmd.payload.contextUri)) {
        return `symbol:remove - symbolId "${cmd.payload.symbolUri}" does not exist`
      }
      return null
    }

    case 'symbol:move': {
      if (!findSymbol(root, cmd.payload.symbolUri, cmd.payload.sourceContextUri)) {
        return `symbol:move - symbolId "${cmd.payload.symbolUri}" does not exist`
      }
      return null
    }

    case 'symbol:classify': {
      if (!findSymbol(root, cmd.payload.symbolUri, cmd.payload.contextUri)) {
        return `symbol:classify - symbolId "${cmd.payload.symbolUri}" does not exist`
      }
      return null
    }

    case 'assertion:add': {
      if (!cmd.payload.assertion.name?.trim()) {
        return 'assertion:add - assertion name must be non-empty'
      }
      return null
    }

    case 'assertion:update': {
      if (!(root.assertions ?? []).some(a => a.id === cmd.payload.assertionId)) {
        return `assertion:update - assertionId "${cmd.payload.assertionId}" does not exist`
      }
      return null
    }

    case 'assertion:remove': {
      if (!(root.assertions ?? []).some(a => a.id === cmd.payload.assertionId)) {
        return `assertion:remove - assertionId "${cmd.payload.assertionId}" does not exist`
      }
      return null
    }

    default:
      return null
  }
}

/**
 * Remove links that are no longer valid after an entity changes type.
 * Checks each link where the entity is source or target against the
 * predicate's domain/range constraints for the new entity class.
 */
function pruneInvalidLinks(draft: RootContext, entityUri: string, newEntityClassId: EntityClassId): void {
  draft.links = draft.links.filter(l => {
    if (l.sourceUri !== entityUri && l.targetUri !== entityUri) return true
    const predDef = (PREDICATES as Record<string, { domain: string[]; range: string[] }>)[l.predicate]
    if (!predDef) return true
    if (l.sourceUri === entityUri && !predDef.domain.includes(newEntityClassId)) return false
    if (l.targetUri === entityUri && !predDef.range.includes(newEntityClassId)) return false
    return true
  })
}

/** Internal: apply a single leaf command to an Immer draft, returning domain events. */
function applyToDraft(draft: RootContext, cmd: Command): DomainEvent[] {
  const events: DomainEvent[] = []

  switch (cmd.type) {
    case 'context:add': {
      const ctx = createEmptyContext(cmd.payload.name, cmd.payload.parentUri)
      if (cmd.payload.uri) ctx.uri = cmd.payload.uri
      if (cmd.payload.metadata) ctx.metadata = cmd.payload.metadata
      draft.contexts[ctx.uri] = ctx
      events.push({ type: 'context.created', entityUri: ctx.uri })
      break
    }

    case 'context:remove': {
      // BFS to collect the removed context and all its descendants
      const toRemove = new Set<string>([cmd.payload.contextUri])
      const queue = [cmd.payload.contextUri]
      while (queue.length) {
        const id = queue.shift()!
        for (const ctx of Object.values(draft.contexts)) {
          if (toRemove.has(ctx.uri)) continue
          if (ctx.parentUri === id) {
            toRemove.add(ctx.uri)
            queue.push(ctx.uri)
          }
        }
      }
      for (const id of toRemove) {
        delete draft.contexts[id]
        events.push({ type: 'context.removed', entityUri: id })
      }
      const prunedLinks = draft.links.filter(l => toRemove.has(l.sourceUri) || toRemove.has(l.targetUri))
      for (const l of prunedLinks) events.push({ type: 'link.pruned', entityUri: l.uri })
      draft.links = draft.links.filter(l => !toRemove.has(l.sourceUri) && !toRemove.has(l.targetUri))
      break
    }

    case 'context:rename': {
      if (cmd.payload.contextUri === draft.uri) {
        draft.name = cmd.payload.name
      }
      else {
        const ctx = draft.contexts[cmd.payload.contextUri]
        if (ctx) ctx.name = cmd.payload.name
      }
      events.push({ type: 'context.renamed', entityUri: cmd.payload.contextUri })
      break
    }

    case 'context:update': {
      if (cmd.payload.contextUri === draft.uri) {
        if (cmd.payload.description !== undefined) draft.description = cmd.payload.description
        if (cmd.payload.tags !== undefined) draft.tags = cmd.payload.tags
        if (cmd.payload.aiInstructions !== undefined) draft.aiInstructions = cmd.payload.aiInstructions
      }
      else {
        const ctx = draft.contexts[cmd.payload.contextUri]
        if (ctx) {
          if (cmd.payload.description !== undefined) ctx.description = cmd.payload.description
          if (cmd.payload.domainType !== undefined) ctx.domainType = cmd.payload.domainType
          if (cmd.payload.tags !== undefined) ctx.tags = cmd.payload.tags
          if (cmd.payload.aiInstructions !== undefined) ctx.aiInstructions = cmd.payload.aiInstructions
        }
      }
      events.push({ type: 'context.updated', entityUri: cmd.payload.contextUri })
      break
    }

    case 'facet:add': {
      const target = resolveTarget(draft, cmd.payload.contextUri)
      if (target) {
        getMutableFacetArray(target, cmd.payload.facetType).push(cmd.payload.facet)
        events.push({ type: 'facet.added', entityUri: cmd.payload.facet.uri })
      }
      break
    }

    case 'facet:update': {
      const target = resolveTarget(draft, cmd.payload.contextUri)
      if (target) {
        const arr = getFacetArray(target, cmd.payload.facetType)
        const idx = arr.findIndex(f => f.uri === cmd.payload.facetUri)
        if (idx !== -1) Object.assign(arr[idx]!, cmd.payload.changes)
        events.push({ type: 'facet.updated', entityUri: cmd.payload.facetUri })
      }
      break
    }

    case 'facet:remove': {
      const target = resolveTarget(draft, cmd.payload.contextUri)
      if (target) {
        const arr = getFacetArray(target, cmd.payload.facetType)
        const idx = arr.findIndex(f => f.uri === cmd.payload.facetUri)
        if (idx !== -1) {
          const removedUri = arr[idx]!.uri
          arr.splice(idx, 1)
          events.push({ type: 'facet.removed', entityUri: removedUri })
          const prunedLinks = draft.links.filter(l => l.sourceUri === removedUri || l.targetUri === removedUri)
          for (const l of prunedLinks) events.push({ type: 'link.pruned', entityUri: l.uri })
          draft.links = draft.links.filter(l => l.sourceUri !== removedUri && l.targetUri !== removedUri)
        }
      }
      break
    }

    case 'symbol:add': {
      // Auto-populate contentDoc from the plaintext content so every
      // new symbol is structurally complete from the moment it's
      // created. Dual-write invariant: content + contentDoc always
      // stay in sync. AI tools can keep sending plain content; the
      // parser turns it into a structured doc that the editor, the
      // triple serializer, and downstream consumers can all walk.
      // The command payload still accepts a single `attachment` (MediaRef) for
      // ergonomics — most callers create a symbol with at most one attachment.
      // We wrap it into the `attachments` array shape with a minted stable id
      // so annotations can anchor to it via `metadata.attachmentId`.
      const sym: Symbol = {
        uri: cmd.payload.uri ?? nanoid(),
        content: cmd.payload.content,
        contentDoc: parseStringToDoc(cmd.payload.content ?? ''),
        label: cmd.payload.label,
        attachments: cmd.payload.attachment
          ? [{ ...cmd.payload.attachment, attachmentId: nanoid() }]
          : undefined,
      }
      const ctxId = cmd.payload.contextUri
      if (ctxId && ctxId !== draft.uri) {
        const ctx = draft.contexts[ctxId]
        if (ctx) {
          if (!ctx.symbols) ctx.symbols = []
          ctx.symbols.push(sym)
        }
      }
      else {
        if (!draft.symbols) (draft as any).symbols = []
        draft.symbols.push(sym)
      }
      events.push({ type: 'symbol.added', entityUri: sym.uri })
      break
    }

    case 'symbol:update': {
      const { symbolUri, contextUri, changes } = cmd.payload
      const ctxUri = contextUri && contextUri !== draft.uri ? contextUri : undefined
      const arr = ctxUri
        ? (draft.contexts[ctxUri]?.symbols ?? [])
        : (draft.symbols ?? [])
      const sym = arr.find(s => s.uri === symbolUri)
      if (sym) {
        Object.assign(sym, changes)
        // Dual-write invariant: if the caller wrote `content` without
        // also writing `contentDoc` (e.g. AI tools sending plaintext),
        // derive `contentDoc` from the new content so both stay in
        // sync. The editor writes both explicitly and short-circuits
        // this branch because `changes.contentDoc` is already set.
        if (changes.content !== undefined && changes.contentDoc === undefined) {
          sym.contentDoc = parseStringToDoc(changes.content ?? '')
        }
      }
      events.push({ type: 'symbol.updated', entityUri: symbolUri })
      break
    }

    case 'symbol:remove': {
      const { symbolUri, contextUri } = cmd.payload
      if (contextUri && contextUri !== draft.uri) {
        const ctx = draft.contexts[contextUri]
        if (ctx) ctx.symbols = (ctx.symbols ?? []).filter(s => s.uri !== symbolUri)
      }
      else {
        draft.symbols = (draft.symbols ?? []).filter(s => s.uri !== symbolUri)
      }
      events.push({ type: 'symbol.removed', entityUri: symbolUri })
      const prunedLinks = draft.links.filter(l => l.sourceUri === symbolUri || l.targetUri === symbolUri)
      for (const l of prunedLinks) events.push({ type: 'link.pruned', entityUri: l.uri })
      draft.links = draft.links.filter(l => l.sourceUri !== symbolUri && l.targetUri !== symbolUri)
      break
    }

    case 'facet:retype': {
      const { contextUri, facetUri, fromType, toType } = cmd.payload
      const target = resolveTarget(draft, contextUri)
      if (!target) break
      const srcArr = getFacetArray(target, fromType)
      const idx = srcArr.findIndex(f => f.uri === facetUri)
      if (idx === -1) break
      const oldFacet = srcArr[idx]!
      srcArr.splice(idx, 1)
      // For built-in types, create a proper default facet; for custom types, create a minimal {id, name} facet
      const newFacet = isBuiltInFacetType(toType)
        ? createDefaultFacet(toType, oldFacet.name, oldFacet.uri)
        : { uri: oldFacet.uri, name: oldFacet.name } as Facet
      // Map description/definition between types (Thing uses 'definition', others use 'description')
      const srcText = 'definition' in oldFacet ? (oldFacet as any).definition : (oldFacet as any).description
      if (srcText) {
        if ('definition' in newFacet) (newFacet as any).definition = srcText
        else (newFacet as any).description = srcText
      }
      getMutableFacetArray(target, toType).push(newFacet)
      events.push({ type: 'facet.retyped', entityUri: facetUri })
      // Only prune links for built-in types where we have ontology constraints
      if (isBuiltInFacetType(toType)) {
        const linksBefore = draft.links.length
        pruneInvalidLinks(draft, facetUri, facetKeyToClass(toType) as EntityClassId)
        if (draft.links.length < linksBefore) {
          events.push({ type: 'link.pruned', entityUri: facetUri })
        }
      }
      break
    }

    case 'facet:move': {
      const { sourceContextUri, targetContextUri, facetType, facetUri } = cmd.payload
      const source = resolveTarget(draft, sourceContextUri)
      const target = resolveTarget(draft, targetContextUri)
      if (source && target) {
        const srcArr = getFacetArray(source, facetType)
        const idx = srcArr.findIndex(f => f.uri === facetUri)
        if (idx !== -1) {
          const [facet] = srcArr.splice(idx, 1) as [Facet]
          getMutableFacetArray(target, facetType).push(facet)
          events.push({ type: 'facet.moved', entityUri: facetUri })
        }
      }
      break
    }

    case 'link:add': {
      const link: Link = {
        uri: cmd.payload.uri ?? nanoid(),
        predicate: cmd.payload.predicate,
        sourceUri: cmd.payload.sourceUri,
        targetUri: cmd.payload.targetUri,
        label: cmd.payload.label,
        description: cmd.payload.description,
        pattern: cmd.payload.pattern,
        metadata: cmd.payload.metadata,
      }
      draft.links.push(link)
      events.push({ type: 'link.added', entityUri: link.uri })
      break
    }

    case 'link:remove': {
      events.push({ type: 'link.removed', entityUri: cmd.payload.linkUri })
      draft.links = draft.links.filter(l => l.uri !== cmd.payload.linkUri)
      break
    }

    case 'link:update': {
      const link = draft.links.find(l => l.uri === cmd.payload.linkUri)
      if (link) {
        if (cmd.payload.label        !== undefined) link.label        = cmd.payload.label
        if (cmd.payload.description  !== undefined) link.description  = cmd.payload.description
        if (cmd.payload.pattern      !== undefined) link.pattern      = cmd.payload.pattern
        if (cmd.payload.metadata     !== undefined) link.metadata     = cmd.payload.metadata
        events.push({ type: 'link.updated', entityUri: cmd.payload.linkUri })
      }
      break
    }

    case 'assertion:add': {
      if (!draft.assertions) draft.assertions = []
      draft.assertions.push(cmd.payload.assertion)
      events.push({ type: 'assertion.added', entityUri: cmd.payload.assertion.id })
      break
    }

    case 'assertion:update': {
      if (!draft.assertions) break
      const idx = draft.assertions.findIndex(a => a.id === cmd.payload.assertionId)
      if (idx !== -1) {
        Object.assign(draft.assertions[idx]!, cmd.payload.changes)
        events.push({ type: 'assertion.updated', entityUri: cmd.payload.assertionId })
      }
      break
    }

    case 'assertion:remove': {
      if (!draft.assertions) break
      draft.assertions = draft.assertions.filter(a => a.id !== cmd.payload.assertionId)
      events.push({ type: 'assertion.removed', entityUri: cmd.payload.assertionId })
      break
    }

    case 'symbol:move': {
      const { symbolUri, sourceContextUri, targetContextUri } = cmd.payload
      const srcCtxId = sourceContextUri && sourceContextUri !== draft.uri ? sourceContextUri : undefined
      const tgtCtxId = targetContextUri && targetContextUri !== draft.uri ? targetContextUri : undefined
      const sourceArr = srcCtxId
        ? (draft.contexts[srcCtxId]?.symbols ?? [])
        : (draft.symbols ?? [])
      const symIdx = sourceArr.findIndex(s => s.uri === symbolUri)
      if (symIdx === -1) break
      const [sym] = sourceArr.splice(symIdx, 1) as [Symbol]
      if (tgtCtxId) {
        const tgtCtx = draft.contexts[tgtCtxId]
        if (!tgtCtx) break
        if (!tgtCtx.symbols) tgtCtx.symbols = []
        tgtCtx.symbols.push(sym)
      } else {
        if (!draft.symbols) (draft as any).symbols = []
        draft.symbols.push(sym)
      }
      events.push({ type: 'symbol.moved', entityUri: symbolUri })
      break
    }

    case 'symbol:classify': {
      const { symbolUri, contextUri, to } = cmd.payload
      const ctxId = contextUri && contextUri !== draft.uri ? contextUri : undefined
      const sourceArr = ctxId
        ? (draft.contexts[ctxId]?.symbols ?? [])
        : (draft.symbols ?? [])
      const symIdx = sourceArr.findIndex(s => s.uri === symbolUri)
      if (symIdx === -1) break
      const sym = sourceArr[symIdx]!
      // Derive name: explicit label, or first line of content
      const displayName = sym.label || sym.content.split('\n')[0]?.slice(0, 80) || 'Untitled'
      // Derive description: content beyond the first line (or full content if label is set)
      const description = sym.label
        ? sym.content
        : sym.content.split('\n').slice(1).join('\n').trim()

      if (to === 'context') {
        const newCtx = createEmptyContext(displayName, cmd.payload.parentContextUri)
        newCtx.description = description
        draft.contexts[newCtx.uri] = newCtx
        sourceArr.splice(symIdx, 1)
        const prunedLinks = draft.links.filter(l => l.sourceUri === symbolUri || l.targetUri === symbolUri)
        for (const l of prunedLinks) events.push({ type: 'link.pruned', entityUri: l.uri })
        draft.links = draft.links.filter(l => l.sourceUri !== symbolUri && l.targetUri !== symbolUri)
        events.push({ type: 'symbol.classified', entityUri: symbolUri })
        events.push({ type: 'context.created', entityUri: newCtx.uri })
      }
      else {
        const { targetContextUri, facetType } = to
        const targetCtx = resolveTarget(draft, targetContextUri)
        if (!targetCtx) break
        // For built-in types, create a proper default facet; for custom types, create a minimal {id, name} facet
        const newFacet = isBuiltInFacetType(facetType)
          ? createDefaultFacet(facetType, displayName)
          : { uri: nanoid(), name: displayName } as Facet
        // Carry description into the new facet
        if ('definition' in newFacet) (newFacet as any).definition = description
        else if ('description' in newFacet) (newFacet as any).description = description
        getMutableFacetArray(targetCtx, facetType).push(newFacet)
        // Reroute any links that referenced the symbol to the new facet id
        for (const link of draft.links) {
          if (link.sourceUri === symbolUri) link.sourceUri = newFacet.uri
          if (link.targetUri === symbolUri) link.targetUri = newFacet.uri
        }
        // Only prune links for built-in types where we have ontology constraints
        if (isBuiltInFacetType(facetType)) {
          pruneInvalidLinks(draft, newFacet.uri, facetKeyToClass(facetType) as EntityClassId)
        }
        sourceArr.splice(symIdx, 1)
        events.push({ type: 'symbol.classified', entityUri: symbolUri })
        events.push({ type: 'facet.added', entityUri: newFacet.uri })
      }
      break
    }
  }

  return events
}

export function applyCommand(root: RootContext, cmd: Command): CommandResult {
  const error = validateCommand(root, cmd)
  if (error) {
    console.warn(`[applyCommand] Validation failed: ${error}`)
    return { success: false, state: root, error, warnings: [], events: [] }
  }

  let events: DomainEvent[] = []
  const state = produce(root, draft => {
    draft.meta.updatedAt = new Date().toISOString()
    events = applyToDraft(draft, cmd)
  })

  const warnings = computePostCommandWarnings(state, events)
  return { success: true, state, warnings, events }
}

export function applyBatch(root: RootContext, batch: BatchCommand): CommandResult {
  const allEvents: DomainEvent[] = []
  let validationError: string | null = null

  const state = produce(root, draft => {
    draft.meta.updatedAt = new Date().toISOString()
    for (let i = 0; i < batch.payload.commands.length; i++) {
      const cmd = batch.payload.commands[i]!
      // Layout commands are handled separately - skip them in the domain batch.
      if (cmd.type.startsWith('layout:')) continue
      // M0 commands are handled by applyM0Command - skip in the M1 batch.
      if (isM0Command(cmd)) continue
      // Safe cast: validateCommand only reads, never mutates.
      const err = validateCommand(draft as unknown as RootContext, cmd as Command)
      if (err) {
        validationError = `Command ${i} (${cmd.type}) failed: ${err}`
        return  // exit recipe - produced state is discarded in error path below
      }
      allEvents.push(...applyToDraft(draft, cmd as Command))
    }
  })

  if (validationError) {
    return { success: false, state: root, error: validationError, warnings: [], events: [] }
  }
  const warnings = computePostCommandWarnings(state, allEvents)
  return { success: true, state, warnings, events: allEvents }
}

// ── Post-command warnings ──────────────────────────────────────────────────

/** Lightweight gap check for newly created entities. Pure: reads only from state. */
function computePostCommandWarnings(state: RootContext, events: DomainEvent[]): string[] {
  const warnings: string[] = []

  // Only check creation events - updates and deletes don't need warnings
  const createdIds = new Set<string>()
  for (const ev of events) {
    if (ev.type === 'facet.added' || ev.type === 'context.created') {
      createdIds.add(ev.entityUri)
    }
  }
  if (createdIds.size === 0) return warnings

  // Resolve each created entity's type and name, then check ontology defaults
  const allContainers: FacetContainer[] = [state, ...Object.values(state.contexts)]

  for (const entityUri of createdIds) {
    // Find the entity and its type
    let entityName: string | undefined
    let entityClass: EntityClassId | undefined

    // Check if it's a context
    if (entityUri === state.uri || state.contexts[entityUri]) {
      continue // Skip context creation warnings - too noisy during modeling
    }

    // Find in facet arrays
    for (const container of allContainers) {
      for (const ft of getRegisteredFacetKeys()) {
        const arr = (container.facets[ft] ?? []) as Array<{ uri: string; name: string }>
        const entity = arr.find(f => f.uri === entityUri)
        if (entity) {
          entityName = entity.name
          entityClass = (facetKeyToClass(ft) as EntityClassId) ?? undefined
          break
        }
      }
      if (entityClass) break
    }

    if (!entityClass || !entityName) continue

    // Check ontology-derived defaults for this entity type
    for (const pred of Object.values(PREDICATES) as PredicateDef[]) {
      if (!pred.defaultAssertions?.length) continue

      for (const da of pred.defaultAssertions) {
        const relevantClasses = da.direction === 'outgoing' ? pred.domain : pred.range
        if (!(relevantClasses as string[]).includes(entityClass)) continue

        const min = da.min ?? 1
        const linkCount = state.links.filter(l =>
          l.predicate === pred.id &&
          (da.direction === 'outgoing' ? l.sourceUri === entityUri : l.targetUri === entityUri),
        ).length

        if (linkCount < min) {
          const label = pred.labels.en
          warnings.push(`${entityClass} "${entityName}" has no "${label}" links`)
        }
      }
    }
  }

  return warnings
}

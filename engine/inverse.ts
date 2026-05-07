import type { RootContext, Context, Facet, FacetType, Link, Symbol, Assertion } from '../types/context'
import type { Command, DispatchableCommand, BatchCommand } from '../types/commands'
import { isM0Command } from '../types/commands'
import { getRegisteredFacetKeys } from '../dsl/engineBridge'

/** Read a facet array from a container - handles both built-in and custom types. */
function getFacetArray(ctx: RootContext | Context, type: FacetType | string): Facet[] {
  if (type in ctx.facets) return ctx.facets[type as FacetType] as Facet[]
  if (ctx.customFacets?.[type]) return ctx.customFacets[type]!
  return []
}

// ── Inverse command generation ─────────────────────────────────────────────
// Pure function: given a command and the before/after state, returns the
// compensating command that reverses the effect. Used for append-only undo.
//
// For destructive commands (remove, retype, classify), the inverse may be
// a BatchCommand that restores multiple entities and their links.
//
// Pure domain - no layout, no canvas, no presentation. The metaontology's
// inverse engine handles only framework commands (Command | BatchCommand).

export function computeInverse(
  cmd: DispatchableCommand,
  before: RootContext,
  after: RootContext,
): DispatchableCommand {
  if (cmd.type === 'batch') {
    return computeBatchInverse(cmd, before, after)
  }

  return computeDomainInverse(cmd as Command, before, after)
}

// ── Domain command inverses ────────────────────────────────────────────────

function computeDomainInverse(cmd: Command, before: RootContext, after: RootContext): DispatchableCommand {
  switch (cmd.type) {
    case 'context:add':
      return inverseContextAdd(before, after)

    case 'context:remove':
      return inverseContextRemove(cmd.payload.contextUri, before, after)

    case 'context:rename':
      return inverseContextRename(cmd.payload.contextUri, before)

    case 'context:update':
      return inverseContextUpdate(cmd, before)

    case 'facet:add':
      return inverseFacetAdd(cmd)

    case 'facet:update':
      return inverseFacetUpdate(cmd, before)

    case 'facet:remove':
      return inverseFacetRemove(cmd, before, after)

    case 'facet:retype':
      return inverseFacetRetype(cmd, before, after)

    case 'facet:move':
      return inverseFacetMove(cmd)

    case 'symbol:add':
      return inverseSymbolAdd(cmd, before, after)

    case 'symbol:update':
      return inverseSymbolUpdate(cmd, before)

    case 'symbol:remove':
      return inverseSymbolRemove(cmd, before, after)

    case 'symbol:move':
      return inverseSymbolMove(cmd)

    case 'symbol:classify':
      return inverseSymbolClassify(cmd, before, after)

    case 'link:add':
      return inverseLinkAdd(before, after)

    case 'link:remove':
      return inverseLinkRemove(cmd.payload.linkUri, before)

    case 'link:update':
      return inverseLinkUpdate(cmd, before)

    case 'assertion:add':
      return inverseAssertionAdd(cmd)

    case 'assertion:update':
      return inverseAssertionUpdate(cmd, before)

    case 'assertion:remove':
      return inverseAssertionRemove(cmd.payload.assertionId, before)

    default: {
      const exhaustive: never = cmd as never
      throw new Error(`computeDomainInverse: no inverse for command type "${(exhaustive as any).type}"`)
    }
  }
}

// ── Context inverses ───────────────────────────────────────────────────────

function inverseContextAdd(before: RootContext, after: RootContext): Command {
  // Find the newly created context by diffing keys
  const newId = Object.keys(after.contexts).find(id => !(id in before.contexts))!
  return { type: 'context:remove', payload: { contextUri: newId } }
}

function inverseContextRemove(contextUri: string, before: RootContext, after: RootContext): DispatchableCommand {
  // Collect the full subtree that was removed (BFS, same as applyToDraft)
  const toRestore = new Set<string>([contextUri])
  const queue = [contextUri]
  while (queue.length) {
    const id = queue.shift()!
    for (const ctx of Object.values(before.contexts)) {
      if (toRestore.has(ctx.uri)) continue
      if (ctx.parentUri === id) {
        toRestore.add(ctx.uri)
        queue.push(ctx.uri)
      }
    }
  }

  // Collect all pruned links
  const prunedLinks = before.links.filter(
    bl => !after.links.some(al => al.uri === bl.uri),
  )

  // Build restore commands with ID-preserving adds (parent before child)
  const restoreCommands: Command[] = []
  const bfsOrder = Array.from(toRestore)

  for (const id of bfsOrder) {
    const ctx = before.contexts[id]!
    restoreCommands.push({
      type: 'context:add',
      payload: { uri: id, name: ctx.name, parentUri: ctx.parentUri, metadata: ctx.metadata },
    })

    // Also update context fields that context:add doesn't set
    if (ctx.description || ctx.domainType || ctx.tags?.length || ctx.aiInstructions) {
      restoreCommands.push({
        type: 'context:update',
        payload: {
          contextUri: id,
          description: ctx.description || undefined,
          domainType: ctx.domainType,
          tags: ctx.tags,
          aiInstructions: ctx.aiInstructions,
        },
      })
    }
  }

  // Restore facets for each context (built-in + custom types)
  for (const id of bfsOrder) {
    const ctx = before.contexts[id]!
    for (const ft of getRegisteredFacetKeys()) {
      for (const facet of ctx.facets[ft] as Facet[]) {
        restoreCommands.push({
          type: 'facet:add',
          payload: { contextUri: id, facetType: ft, facet: structuredClone(facet) },
        })
      }
    }
    // Restore custom facets
    for (const [customType, facets] of Object.entries(ctx.customFacets ?? {})) {
      for (const facet of facets) {
        restoreCommands.push({
          type: 'facet:add',
          payload: { contextUri: id, facetType: customType, facet: structuredClone(facet) },
        })
      }
    }
  }

  // Restore pruned links with original IDs
  for (const link of prunedLinks) {
    restoreCommands.push(restoreLinkCommand(link))
  }

  if (restoreCommands.length === 1) return restoreCommands[0]!
  return { type: 'batch', payload: { commands: restoreCommands, label: 'Undo delete context' } }
}

function inverseContextRename(contextUri: string, before: RootContext): Command {
  const prevName = contextUri === before.uri ? before.name : before.contexts[contextUri]!.name
  return { type: 'context:rename', payload: { contextUri, name: prevName } }
}

function inverseContextUpdate(
  cmd: Extract<Command, { type: 'context:update' }>,
  before: RootContext,
): Command {
  const target = cmd.payload.contextUri === before.uri
    ? before
    : before.contexts[cmd.payload.contextUri]!

  const prevValues: Record<string, unknown> = {}
  if (cmd.payload.description !== undefined) prevValues.description = target.description
  if (cmd.payload.tags !== undefined) prevValues.tags = target.tags
  if (cmd.payload.aiInstructions !== undefined) prevValues.aiInstructions = target.aiInstructions
  if (cmd.payload.domainType !== undefined && 'domainType' in target) {
    prevValues.domainType = (target as Context).domainType
  }

  return {
    type: 'context:update',
    payload: {
      contextUri: cmd.payload.contextUri,
      ...prevValues,
    },
  } as Extract<Command, { type: 'context:update' }>
}

// ── Facet inverses ─────────────────────────────────────────────────────────

function inverseFacetAdd(cmd: Extract<Command, { type: 'facet:add' }>): Command {
  return {
    type: 'facet:remove',
    payload: {
      contextUri: cmd.payload.contextUri,
      facetType: cmd.payload.facetType,
      facetUri: cmd.payload.facet.uri,
    },
  }
}

function inverseFacetUpdate(
  cmd: Extract<Command, { type: 'facet:update' }>,
  before: RootContext,
): Command {
  const { contextUri, facetType, facetUri, changes } = cmd.payload
  const target = contextUri === before.uri ? before : before.contexts[contextUri]!
  const facet = getFacetArray(target, facetType).find(f => f.uri === facetUri)!

  // Capture previous values for each changed field
  const prevChanges: Record<string, unknown> = {}
  for (const key of Object.keys(changes)) {
    prevChanges[key] = (facet as unknown as Record<string, unknown>)[key]
  }

  return {
    type: 'facet:update',
    payload: { contextUri, facetType, facetUri, changes: prevChanges as Partial<Facet> },
  }
}

function inverseFacetRemove(
  cmd: Extract<Command, { type: 'facet:remove' }>,
  before: RootContext,
  after: RootContext,
): DispatchableCommand {
  const { contextUri, facetType, facetUri } = cmd.payload
  const target = contextUri === before.uri ? before : before.contexts[contextUri]!
  const facet = getFacetArray(target, facetType).find(f => f.uri === facetUri)!

  const commands: Command[] = [
    {
      type: 'facet:add',
      payload: { contextUri, facetType, facet: structuredClone(facet) },
    },
  ]

  // Restore pruned links with original IDs
  const prunedLinks = before.links.filter(
    bl => !after.links.some(al => al.uri === bl.uri),
  )
  for (const link of prunedLinks) {
    commands.push(restoreLinkCommand(link))
  }

  if (commands.length === 1) return commands[0]!
  return { type: 'batch', payload: { commands, label: 'Undo delete element' } }
}

function inverseFacetRetype(
  cmd: Extract<Command, { type: 'facet:retype' }>,
  before: RootContext,
  after: RootContext,
): DispatchableCommand {
  const { contextUri, facetUri, fromType, toType } = cmd.payload
  const target = contextUri === before.uri ? before : before.contexts[contextUri]!
  const originalFacet = getFacetArray(target, fromType).find(f => f.uri === facetUri)!

  const commands: Command[] = [
    // Remove the retyped facet from the new type
    { type: 'facet:remove', payload: { contextUri, facetType: toType, facetUri } },
    // Restore the original facet in the old type
    { type: 'facet:add', payload: { contextUri, facetType: fromType, facet: structuredClone(originalFacet) } },
  ]

  // Restore pruned links with original IDs
  const prunedLinks = before.links.filter(
    bl => !after.links.some(al => al.uri === bl.uri),
  )
  for (const link of prunedLinks) {
    commands.push(restoreLinkCommand(link))
  }

  return { type: 'batch', payload: { commands, label: 'Undo retype element' } }
}

function inverseFacetMove(cmd: Extract<Command, { type: 'facet:move' }>): Command {
  return {
    type: 'facet:move',
    payload: {
      sourceContextUri: cmd.payload.targetContextUri,
      targetContextUri: cmd.payload.sourceContextUri,
      facetType: cmd.payload.facetType,
      facetUri: cmd.payload.facetUri,
    },
  }
}

// ── Symbol inverses ───────────────────────────────────────────────────────

function inverseSymbolAdd(
  cmd: Extract<Command, { type: 'symbol:add' }>,
  before: RootContext,
  after: RootContext,
): Command {
  // Find the new symbol by diffing
  const beforeIds = collectSymbolIds(before, cmd.payload.contextUri)
  const afterIds = collectSymbolIds(after, cmd.payload.contextUri)
  const newId = afterIds.find(id => !beforeIds.includes(id))!

  return {
    type: 'symbol:remove',
    payload: { contextUri: cmd.payload.contextUri, symbolUri: newId },
  }
}

function inverseSymbolUpdate(
  cmd: Extract<Command, { type: 'symbol:update' }>,
  before: RootContext,
): Command {
  const sym = findSymbolById(before, cmd.payload.symbolUri, cmd.payload.contextUri)!
  const prevChanges: Record<string, unknown> = {}
  for (const key of Object.keys(cmd.payload.changes)) {
    prevChanges[key] = (sym as unknown as Record<string, unknown>)[key]
  }

  return {
    type: 'symbol:update',
    payload: {
      contextUri: cmd.payload.contextUri,
      symbolUri: cmd.payload.symbolUri,
      changes: prevChanges as Partial<Omit<Symbol, 'uri'>>,
    },
  }
}

function inverseSymbolRemove(
  cmd: Extract<Command, { type: 'symbol:remove' }>,
  before: RootContext,
  after: RootContext,
): DispatchableCommand {
  const sym = findSymbolById(before, cmd.payload.symbolUri, cmd.payload.contextUri)!
  const commands: Command[] = [
    {
      type: 'symbol:add',
      payload: {
        contextUri: cmd.payload.contextUri,
        content: sym.content,
        label: sym.label,
        uri: sym.uri,
      },
    },
  ]

  // Restore extra fields if present
  const extraFields: Record<string, unknown> = {}
  if (sym.mode) extraFields.mode = sym.mode
  if (sym.modePinned) extraFields.modePinned = sym.modePinned
  if (sym.style) extraFields.style = sym.style
  if (sym.language) extraFields.language = sym.language
  if (sym.collapsed) extraFields.collapsed = sym.collapsed
  if (sym.tags?.length) extraFields.tags = sym.tags
  if (Object.keys(extraFields).length > 0) {
    commands.push({
      type: 'symbol:update',
      payload: {
        contextUri: cmd.payload.contextUri,
        symbolUri: sym.uri,
        changes: extraFields as Partial<Omit<Symbol, 'uri'>>,
      },
    })
  }

  // Restore pruned links with original IDs
  const prunedLinks = before.links.filter(
    bl => !after.links.some(al => al.uri === bl.uri),
  )
  for (const link of prunedLinks) {
    commands.push(restoreLinkCommand(link))
  }

  if (commands.length === 1) return commands[0]!
  return { type: 'batch', payload: { commands, label: 'Undo delete symbol' } }
}

function inverseSymbolMove(
  cmd: Extract<Command, { type: 'symbol:move' }>,
): Command {
  return {
    type: 'symbol:move',
    payload: {
      symbolUri: cmd.payload.symbolUri,
      sourceContextUri: cmd.payload.targetContextUri,
      targetContextUri: cmd.payload.sourceContextUri,
    },
  }
}

function inverseSymbolClassify(
  cmd: Extract<Command, { type: 'symbol:classify' }>,
  before: RootContext,
  after: RootContext,
): DispatchableCommand {
  const sym = findSymbolById(before, cmd.payload.symbolUri, cmd.payload.contextUri)!
  const commands: Command[] = []

  if (cmd.payload.to === 'context') {
    // Find the newly created context
    const newCtxId = Object.keys(after.contexts).find(id => !(id in before.contexts))!
    commands.push({ type: 'context:remove', payload: { contextUri: newCtxId } })
  } else {
    // Find the newly created facet
    const { targetContextUri, facetType } = cmd.payload.to
    const targetBefore = targetContextUri === before.uri ? before : before.contexts[targetContextUri]!
    const targetAfter = targetContextUri === after.uri ? after : after.contexts[targetContextUri]!
    const beforeFacetIds = getFacetArray(targetBefore, facetType).map(f => f.uri)
    const newFacet = getFacetArray(targetAfter, facetType).find(f => !beforeFacetIds.includes(f.uri))!
    commands.push({
      type: 'facet:remove',
      payload: { contextUri: targetContextUri, facetType, facetUri: newFacet.uri },
    })
  }

  // Restore the original symbol with its original ID
  commands.push({
    type: 'symbol:add',
    payload: { contextUri: cmd.payload.contextUri, uri: sym.uri, content: sym.content, label: sym.label },
  })

  // Restore extra fields if present
  const extraFields: Record<string, unknown> = {}
  if (sym.mode) extraFields.mode = sym.mode
  if (sym.modePinned) extraFields.modePinned = sym.modePinned
  if (sym.style) extraFields.style = sym.style
  if (sym.language) extraFields.language = sym.language
  if (sym.collapsed) extraFields.collapsed = sym.collapsed
  if (sym.tags?.length) extraFields.tags = sym.tags
  if (Object.keys(extraFields).length > 0) {
    commands.push({
      type: 'symbol:update',
      payload: {
        contextUri: cmd.payload.contextUri,
        symbolUri: sym.uri,
        changes: extraFields as Partial<Omit<Symbol, 'uri'>>,
      },
    })
  }

  // Restore pruned links with original IDs
  const prunedLinks = before.links.filter(
    bl => !after.links.some(al => al.uri === bl.uri),
  )
  for (const link of prunedLinks) {
    commands.push(restoreLinkCommand(link))
  }

  // Restore links that were rerouted (sourceUri or targetUri changed by classify)
  // These links still exist but point to the new facet instead of the symbol.
  // We remove the rerouted version and restore the original.
  const rerouted = after.links.filter(al => {
    const bl = before.links.find(l => l.uri === al.uri)
    return bl && (bl.sourceUri !== al.sourceUri || bl.targetUri !== al.targetUri)
  })
  for (const al of rerouted) {
    const bl = before.links.find(l => l.uri === al.uri)!
    commands.push({ type: 'link:remove', payload: { linkUri: al.uri } })
    commands.push(restoreLinkCommand(bl))
  }

  return { type: 'batch', payload: { commands, label: 'Undo classify symbol' } }
}

// ── Link inverses ──────────────────────────────────────────────────────────

function inverseLinkAdd(before: RootContext, after: RootContext): Command {
  const newLink = after.links.find(al => !before.links.some(bl => bl.uri === al.uri))!
  return { type: 'link:remove', payload: { linkUri: newLink.uri } }
}

function inverseLinkRemove(linkUri: string, before: RootContext): Command {
  const link = before.links.find(l => l.uri === linkUri)!
  return restoreLinkCommand(link)
}

function inverseLinkUpdate(
  cmd: Extract<Command, { type: 'link:update' }>,
  before: RootContext,
): Command {
  const link = before.links.find(l => l.uri === cmd.payload.linkUri)!
  const prevValues: Record<string, unknown> = {}
  if (cmd.payload.label !== undefined) prevValues.label = link.label
  if (cmd.payload.description !== undefined) prevValues.description = link.description
  if (cmd.payload.pattern !== undefined) prevValues.pattern = link.pattern
  if (cmd.payload.metadata !== undefined) prevValues.metadata = link.metadata

  return { type: 'link:update', payload: { linkUri: cmd.payload.linkUri, ...prevValues } } as Command
}

// ── Assertion inverses ─────────────────────────────────────────────────────

function inverseAssertionAdd(cmd: Extract<Command, { type: 'assertion:add' }>): Command {
  return { type: 'assertion:remove', payload: { assertionId: cmd.payload.assertion.id } }
}

function inverseAssertionUpdate(
  cmd: Extract<Command, { type: 'assertion:update' }>,
  before: RootContext,
): Command {
  const assertion = (before.assertions ?? []).find(a => a.id === cmd.payload.assertionId)!
  const prevChanges: Record<string, unknown> = {}
  for (const key of Object.keys(cmd.payload.changes)) {
    prevChanges[key] = (assertion as unknown as Record<string, unknown>)[key]
  }
  return {
    type: 'assertion:update',
    payload: { assertionId: cmd.payload.assertionId, changes: prevChanges as Partial<Omit<Assertion, 'id'>> },
  }
}

function inverseAssertionRemove(assertionId: string, before: RootContext): Command {
  const assertion = (before.assertions ?? []).find(a => a.id === assertionId)!
  return { type: 'assertion:add', payload: { assertion: structuredClone(assertion) } }
}

// ── Batch command inverse ──────────────────────────────────────────────────

function computeBatchInverse(
  batch: BatchCommand,
  before: RootContext,
  after: RootContext,
): BatchCommand {
  const inverses: (Command)[] = []
  for (const subcmd of [...batch.payload.commands].reverse()) {
    // M0 commands in mixed batches are handled by computeM0Inverse separately
    if (isM0Command(subcmd)) continue
    const inv = computeDomainInverse(subcmd as Command, before, after)
    if (inv.type === 'batch') {
      inverses.push(...inv.payload.commands as Command[])
    } else {
      inverses.push(inv as Command)
    }
  }

  return {
    type: 'batch',
    payload: { commands: inverses, label: `Undo ${batch.payload.label ?? 'batch'}` },
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function restoreLinkCommand(link: Link): Command {
  return {
    type: 'link:add',
    payload: {
      uri: link.uri,
      predicate: link.predicate,
      sourceUri: link.sourceUri,
      targetUri: link.targetUri,
      label: link.label,
      description: link.description,
      pattern: link.pattern,
      metadata: link.metadata,
    },
  }
}

function collectSymbolIds(root: RootContext, contextUri?: string): string[] {
  if (contextUri && contextUri !== root.uri) {
    return (root.contexts[contextUri]?.symbols ?? []).map(s => s.uri)
  }
  return (root.symbols ?? []).map(s => s.uri)
}

function findSymbolById(root: RootContext, symbolUri: string, contextUri?: string): Symbol | undefined {
  if (contextUri && contextUri !== root.uri) {
    return (root.contexts[contextUri]?.symbols ?? []).find(s => s.uri === symbolUri)
  }
  return (root.symbols ?? []).find(s => s.uri === symbolUri)
}

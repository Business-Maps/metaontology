/**
 * Template system - lets users start from a pre-built map instead of a blank canvas.
 *
 * Templates are static RootContext snapshots with placeholder IDs. On load,
 * every ID is regenerated via nanoid() and a consistent mapping preserves
 * all link/parent references.
 */

import { nanoid } from 'nanoid'
import { klona } from 'klona'
import type { RootContext, Thing, Workflow, Facet, FacetType  } from '../types/context'
import { FACET_TYPES } from '../meta/facets'

// ── Template definition ──────────────────────────────────────────────────────

export interface TemplateDefinition {
  /** Unique template key (kebab-case). */
  id: string
  /** Display name shown in the picker. */
  name: string
  /** One-line description. */
  description: string
  /** Factory that returns a fresh RootContext snapshot with placeholder IDs. */
  build: () => RootContext
}

// ── ID regeneration ──────────────────────────────────────────────────────────

/**
 * Remap internal IDs inside a facet (attributes, workflow steps, transitions).
 * Must be called after the facet's own `id` has already been remapped.
 */
function remapFacetInternals(ft: FacetType, facet: any, fresh: (id: string) => string): void {
  if (ft === 'things') {
    const thing = facet as Thing
    for (const a of thing.attributes) {
      if (a.referencedThingId) a.referencedThingId = fresh(a.referencedThingId)
    }
    // State + transition remapping
    for (const state of thing.states ?? []) {
      state.id = fresh(state.id)
      for (const tr of state.transitions ?? []) {
        tr.id = fresh(tr.id)
        tr.targetStateId = fresh(tr.targetStateId)
        if (tr.triggerActionId) tr.triggerActionId = fresh(tr.triggerActionId)
        if (tr.triggerEventId) tr.triggerEventId = fresh(tr.triggerEventId)
      }
    }
  }
  if (ft === 'workflows') {
    const wf = facet as Workflow
    if (wf.triggerStepId) wf.triggerStepId = fresh(wf.triggerStepId)
    if (wf.trigger?.refId) wf.trigger.refId = fresh(wf.trigger.refId)
    for (const s of wf.steps) {
      s.id = fresh(s.id)
      if (s.transitions) {
        for (const t of s.transitions) {
          t.id = fresh(t.id)
          t.targetStepId = fresh(t.targetStepId)
        }
      }
    }
  }
}

/**
 * Deep-clone a RootContext, regenerate all IDs, and return both the
 * remapped model and the old→new ID mapping. Used by import to remap layout keys.
 */
export function reIdWithMapping(source: RootContext): { model: RootContext; idMap: Map<string, string> } {
  const result = reIdInternal(source)
  return { model: result.model, idMap: result.idMap }
}

export function reId(source: RootContext): RootContext {
  return reIdInternal(source).model
}

function reIdInternal(source: RootContext): { model: RootContext; idMap: Map<string, string> } {
  const draft = klona<RootContext>(source)
  const map = new Map<string, string>()

  function fresh(oldId: string): string {
    let newId = map.get(oldId)
    if (!newId) {
      newId = nanoid()
      map.set(oldId, newId)
    }
    return newId
  }

  // Root
  draft.uri = fresh(draft.uri)
  const now = new Date().toISOString()
  draft.meta = { createdAt: now, updatedAt: now }

  // Root-level facets
  for (const ft of FACET_TYPES) {
    for (const f of draft.facets[ft]) {
      f.uri = fresh(f.uri)
      remapFacetInternals(ft, f, fresh)
    }
  }
  // Strip blob attachments from root-level interfaces (blobs don't travel with template).
  // URL and storybook attachments travel safely (just stringly-typed references).
  for (const iface of draft.facets.interfaces) {
    if (iface.attachments) {
      iface.attachments = iface.attachments.filter(a => a.kind !== 'blob')
      if (iface.attachments.length === 0) delete (iface as { attachments?: unknown }).attachments
    }
  }
  for (const sym of draft.symbols ?? []) {
    sym.uri = fresh(sym.uri)
  }

  // Sub-contexts
  const newContexts: Record<string, typeof draft.contexts[string]> = {}
  for (const [oldCtxId, ctx] of Object.entries(draft.contexts)) {
    const newCtxId = fresh(oldCtxId)
    ctx.uri = newCtxId
    ctx.parentUri = fresh(ctx.parentUri)
    for (const ft of FACET_TYPES) {
      for (const f of (ctx as any).facets[ft]) {
        f.uri = fresh(f.uri)
        remapFacetInternals(ft, f, fresh)
      }
    }
    for (const sym of ctx.symbols ?? []) {
      sym.uri = fresh(sym.uri)
    }
    // Blob attachments point to blobs the cloned map doesn't own - strip them.
    // URL and storybook attachments travel safely (just stringly-typed references).
    for (const iface of ctx.facets.interfaces) {
      if (iface.attachments) {
        iface.attachments = iface.attachments.filter(a => a.kind !== 'blob')
        if (iface.attachments.length === 0) delete (iface as { attachments?: unknown }).attachments
      }
    }
    newContexts[newCtxId] = ctx
  }
  draft.contexts = newContexts

  // Links - remap source/target IDs
  for (const link of draft.links) {
    link.uri = fresh(link.uri)
    link.sourceUri = fresh(link.sourceUri)
    link.targetUri = fresh(link.targetUri)
  }

  // Custom facets (canvasNode, canvasEdge, user-defined types). Walked AFTER
  // standard facets and links so any URI referenced via `representedBy` is
  // already in `map`. Position fidelity depends on this: canvasNode's
  // `representedBy` points at the entity it visualizes; without remapping it,
  // imported maps would render every entity at the default position.
  remapCustomFacets(draft, fresh, map)
  for (const ctx of Object.values(draft.contexts)) {
    remapCustomFacets(ctx as { customFacets?: Record<string, Facet[]> }, fresh, map)
  }

  return { model: draft, idMap: map }
}

/**
 * Walk a container's `customFacets` and remap stored URIs.
 *
 * - `uri` is regenerated unconditionally (custom facets have their own ids).
 * - `representedBy` (used by canvasNode/canvasEdge) is translated through the
 *   id map. If the referenced entity wasn't remapped (e.g. unresolved cross-
 *   reference), the original value is kept rather than minting a stray nanoid.
 *   That mirrors what the bridge does — orphaned canvas nodes are filtered
 *   out at read time, not at import time.
 */
function remapCustomFacets(
  container: { customFacets?: Record<string, Facet[]> },
  fresh: (id: string) => string,
  map: Map<string, string>,
): void {
  if (!container.customFacets) return
  for (const arr of Object.values(container.customFacets)) {
    for (const facet of arr as Array<Facet & Record<string, unknown>>) {
      if (typeof facet.uri === 'string' && facet.uri.length > 0) {
        facet.uri = fresh(facet.uri)
      }
      const refKey = 'representedBy'
      const ref = facet[refKey]
      if (typeof ref === 'string' && ref.length > 0) {
        const remapped = map.get(ref)
        if (remapped) facet[refKey] = remapped
      }
    }
  }
}

// ── Template registry ────────────────────────────────────────────────────────

const registry = new Map<string, TemplateDefinition>()

export function registerTemplate(def: TemplateDefinition): void {
  registry.set(def.id, def)
}

export function getTemplate(id: string): TemplateDefinition | undefined {
  return registry.get(id)
}

export function listTemplates(): TemplateDefinition[] {
  return [...registry.values()]
}

/**
 * Instantiate a template: build the snapshot, regenerate all IDs,
 * and optionally rename the root context.
 */
export function instantiateTemplate(templateId: string, name?: string): RootContext | null {
  const def = registry.get(templateId)
  if (!def) return null
  const snapshot = def.build()
  const fresh = reId(snapshot)
  if (name) fresh.name = name
  return fresh
}

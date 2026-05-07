/**
 * Abstract base type registrations for the 11 BM primitives.
 *
 * Importing this module registers the base types in the DSL registry
 * so the engine can discover them via `listFacetTypes()` and
 * `getFacetType('thing')`. Each entry mirrors the corresponding
 * row in `BASE_FACET_REGISTRY` (in `meta/facets.ts`) - same id, label,
 * singular, tier - but lives in the DSL's registry format rather than
 * the hardcoded constant.
 *
 * These registrations use `baseType: null` because they ARE the base
 * types. Consumer subtypes created via `defineThing('exampleNode', ...)`
 * set `baseType: 'thing'` and point back here.
 *
 * Universal attribute schemas (what fields every Thing/Persona/etc.
 * inherits) are expressed in the handles in `handles.ts` via
 * TypeScript interfaces (`ThingUniversals`, etc.).
 */

import { registerFacetType } from '../dsl/registry'
import type { FacetTypeDecl } from '../dsl/registry'

// ── Helper for readable registrations ──────────────────────────────────────

function registerBaseType(spec: {
  id: string
  facetKey: string
  entityClassId: string
  label: string
  singular: string
  tier: 1 | 2 | 3
}): FacetTypeDecl {
  return registerFacetType({
    kind: 'facet-type',
    id: spec.id,
    baseType: null,
    attributes: {},
    facetKey: spec.facetKey,
    entityClassId: spec.entityClassId,
    label: { en: spec.label },
    singular: { en: spec.singular },
    tier: spec.tier,
  })
}

// ── Tier 0 - The universal primitive ──────────────────────────────────────
//
// Symbol is the root of the type hierarchy but does NOT have a facetKey
// because symbols are stored at `FacetContainer.symbols`, not inside
// `FacetContainer.facets`. The engine iterates symbols separately.
// Registering it without a facetKey keeps it in the DSL registry for
// introspection without adding it to the facet iteration set.

export const symbolBase = registerFacetType({
  kind: 'facet-type',
  id: 'symbol',
  baseType: null,
  attributes: {},
  entityClassId: 'Symbol',
  label: { en: 'Symbols' },
  singular: { en: 'Symbol' },
  tier: 1,
  // No facetKey - symbols are stored separately from facets
})

// ── Tier 1 - What exists ───────────────────────────────────────────────────

export const thingBase = registerBaseType({
  id: 'thing',       facetKey: 'things',       entityClassId: 'Thing',
  label: 'Things',   singular: 'Thing',        tier: 1,
})

export const personaBase = registerBaseType({
  id: 'persona',     facetKey: 'personas',     entityClassId: 'Persona',
  label: 'Personas', singular: 'Persona',      tier: 1,
})

// ── Tier 2 - What happens ──────────────────────────────────────────────────

export const portBase = registerBaseType({
  id: 'port',         facetKey: 'ports',        entityClassId: 'Port',
  label: 'Ports',     singular: 'Port',         tier: 2,
})

export const actionBase = registerBaseType({
  id: 'action',       facetKey: 'actions',      entityClassId: 'Action',
  label: 'Actions',   singular: 'Action',       tier: 2,
})

export const workflowBase = registerBaseType({
  id: 'workflow',     facetKey: 'workflows',    entityClassId: 'Workflow',
  label: 'Workflows', singular: 'Workflow',     tier: 2,
})

export const eventBase = registerBaseType({
  id: 'event',        facetKey: 'events',       entityClassId: 'Event',
  label: 'Events',    singular: 'Event',        tier: 2,
})

export const measureBase = registerBaseType({
  id: 'measure',      facetKey: 'measures',     entityClassId: 'Measure',
  label: 'Measures',  singular: 'Measure',      tier: 2,
})

// ── Tier 3 - How it's built ────────────────────────────────────────────────

export const interfaceBase = registerBaseType({
  id: 'interface',      facetKey: 'interfaces',   entityClassId: 'Interface',
  label: 'Interfaces',  singular: 'Interface',    tier: 3,
})

export const functionBase = registerBaseType({
  id: 'function',       facetKey: 'functions',    entityClassId: 'Function',
  label: 'Functions',   singular: 'Function',     tier: 3,
})

export const dataSourceBase = registerBaseType({
  id: 'dataSource',     facetKey: 'datasources',  entityClassId: 'DataSource',
  label: 'Data Sources', singular: 'Data Source',  tier: 3,
})

export const pipelineBase = registerBaseType({
  id: 'pipeline',       facetKey: 'pipelines',    entityClassId: 'Pipeline',
  label: 'Pipelines',   singular: 'Pipeline',     tier: 3,
})

/**
 * Re-register all base types. Called by the engine bridge after a
 * `resetRegistry()` to ensure the base types are present even when
 * the module-level side-effect import has already been cached by the
 * ES module system. All `registerFacetType` calls are idempotent on
 * id, so calling this when the registry is already populated is a
 * no-op.
 */
export function ensureBaseTypesRegistered(): void {
  registerFacetType({ kind: 'facet-type', id: 'symbol', baseType: null, attributes: {}, entityClassId: 'Symbol', label: { en: 'Symbols' }, singular: { en: 'Symbol' }, tier: 1 })
  registerBaseType({ id: 'thing',       facetKey: 'things',       entityClassId: 'Thing',       label: 'Things',       singular: 'Thing',        tier: 1 })
  registerBaseType({ id: 'persona',     facetKey: 'personas',     entityClassId: 'Persona',     label: 'Personas',     singular: 'Persona',      tier: 1 })
  registerBaseType({ id: 'port',        facetKey: 'ports',        entityClassId: 'Port',        label: 'Ports',        singular: 'Port',         tier: 2 })
  registerBaseType({ id: 'action',      facetKey: 'actions',      entityClassId: 'Action',      label: 'Actions',      singular: 'Action',       tier: 2 })
  registerBaseType({ id: 'workflow',    facetKey: 'workflows',    entityClassId: 'Workflow',    label: 'Workflows',    singular: 'Workflow',     tier: 2 })
  registerBaseType({ id: 'event',       facetKey: 'events',       entityClassId: 'Event',       label: 'Events',       singular: 'Event',        tier: 2 })
  registerBaseType({ id: 'measure',     facetKey: 'measures',     entityClassId: 'Measure',     label: 'Measures',     singular: 'Measure',      tier: 2 })
  registerBaseType({ id: 'interface',   facetKey: 'interfaces',   entityClassId: 'Interface',   label: 'Interfaces',   singular: 'Interface',    tier: 3 })
  registerBaseType({ id: 'function',    facetKey: 'functions',    entityClassId: 'Function',    label: 'Functions',    singular: 'Function',     tier: 3 })
  registerBaseType({ id: 'dataSource',  facetKey: 'datasources',  entityClassId: 'DataSource',  label: 'Data Sources', singular: 'Data Source',  tier: 3 })
  registerBaseType({ id: 'pipeline',    facetKey: 'pipelines',    entityClassId: 'Pipeline',    label: 'Pipelines',    singular: 'Pipeline',     tier: 3 })
}

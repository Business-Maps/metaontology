/**
 * Self-Projection - materializes the metaontology registries as Context data.
 *
 * Reads ENTITY_CLASSES, PREDICATES, DATATYPE_REGISTRY, and BUILTIN_VALUE_TYPES
 * and returns a flat context tree (5 contexts) plus sparse `references` links.
 * Used by the BM self-model template to embed a live view of the metaontology
 * inside the comprehensive business map.
 */

import type { Thing, ThingAttribute, Link } from '../types/context'
import { ENTITY_CLASSES, PREDICATES, DATATYPE_REGISTRY, BUILTIN_VALUE_TYPES } from '../meta/ontology'

// ── Stable placeholder IDs ──────────────────────────────────────────────────
// All prefixed with 'meta-' to avoid collisions with other template IDs.
// reId() regenerates everything on instantiation.

const CTX_META_ROOT = 'meta-root'
const CTX_ENTITY_CLASSES = 'meta-ctx-entity-classes'
const CTX_PREDICATES = 'meta-ctx-predicates'
const CTX_DATATYPES = 'meta-ctx-datatypes'
const CTX_VALUE_TYPES = 'meta-ctx-value-types'

function ecId(classId: string): string { return `meta-ec-${classId}` }
function predId(predicate: string): string { return `meta-pred-${predicate}` }
function dtId(datatypeId: string): string { return `meta-dt-${datatypeId}` }
function vtId(valueTypeId: string): string { return `meta-vt-${valueTypeId}` }

// ── Helpers ─────────────────────────────────────────────────────────────────

function emptyFacets() {
  return {
    things: [] as Thing[],
    personas: [],
    ports: [],
    actions: [],
    workflows: [],
    interfaces: [],
    events: [],
    measures: [],
    functions: [],
    datasources: [],
    pipelines: [],
  }
}

function attr(name: string, type: string, extra?: Partial<ThingAttribute>): ThingAttribute {
  return { name, type, ...extra } as ThingAttribute
}

// ── Projection ──────────────────────────────────────────────────────────────

export interface MetaontologyProjection {
  contexts: Record<string, any>
  links: Link[]
}

/**
 * Project the metaontology registries as a context tree.
 *
 * Returns 5 contexts (1 root + 4 children) with Things in their facets,
 * plus sparse `references` links connecting predicates to their domain/range
 * entity classes and value types to their base datatypes.
 *
 * @param parentId - the context ID this metaontology tree hangs under
 */
export function projectMetaontologyAsContext(parentId: string): MetaontologyProjection {
  const links: Link[] = []
  let linkSeq = 0
  function nextLinkId(): string { return `meta-link-${++linkSeq}` }

  // ── Entity Classes ──────────────────────────────────────────────────────
  const entityClassThings: Thing[] = Object.values(ENTITY_CLASSES).map(ec => ({
    uri: ecId(ec.id),
    name: ec.id,
    definition: ec.descriptions.en,
    attributes: [
      attr('uri', 'uri'),
      ...('facetKey' in ec && ec.facetKey ? [attr('facetKey', 'text')] : []),
    ],
    rules: [],
    states: [],
    stereotype: 'reference-data' as const,
  })) as Thing[]

  // ── Predicates ──────────────────────────────────────────────────────────
  const predicateThings: Thing[] = Object.values(PREDICATES).map(p => {
    const pred = p as { structural?: boolean; symmetric?: boolean } & typeof p
    const domainStr = p.domain.join(', ')
    const rangeStr = p.range.join(', ')
    const flags = [
      pred.structural ? 'structural' : null,
      pred.symmetric ? 'symmetric' : null,
    ].filter(Boolean).join(', ')

    const definition = `${p.labels.en}: ${domainStr} → ${rangeStr}. ` +
      `Cardinality: ${p.cardinality}. Tier: ${p.tier}.` +
      (flags ? ` ${flags}.` : '')

    // Link to first domain and first range entity class
    if (p.domain.length > 0) {
      links.push({
        uri: nextLinkId(),
        predicate: 'references',
        sourceUri: predId(p.id),
        targetUri: ecId(p.domain[0]),
      } as Link)
    }
    if (p.range.length > 0 && p.range[0] !== p.domain[0]) {
      links.push({
        uri: nextLinkId(),
        predicate: 'references',
        sourceUri: predId(p.id),
        targetUri: ecId(p.range[0]),
      } as Link)
    }

    return {
      uri: predId(p.id),
      name: p.labels.en,
      definition,
      attributes: [
        attr('uri', 'uri'),
        attr('tier', 'text'),
        attr('cardinality', 'text'),
        attr('domain', 'text'),
        attr('range', 'text'),
        attr('structural', 'boolean'),
      ],
      rules: [],
      states: [],
      stereotype: 'reference-data' as const,
    }
  }) as Thing[]

  // ── Datatypes ───────────────────────────────────────────────────────────
  const datatypeThings: Thing[] = DATATYPE_REGISTRY.map(dt => ({
    uri: dtId(dt.id),
    name: dt.label,
    definition: dt.description,
    attributes: [
      attr('xsd', 'uri'),
      attr('baseType', 'text'),
      attr('tsType', 'text'),
      attr('shortLabel', 'text'),
    ],
    rules: [],
    states: [],
    stereotype: 'reference-data' as const,
  })) as Thing[]

  // ── Value Types ─────────────────────────────────────────────────────────
  const valueTypeThings = BUILTIN_VALUE_TYPES.map(vt => {
    const constraintDesc = vt.constraints
      .map((c): string => {
        if (c.type === 'regex') return `regex: ${c.pattern}`
        if (c.type === 'range') {
          const rc = c as { min?: number; max?: number }
          return `range: ${rc.min ?? ''}..${rc.max ?? ''}`
        }
        const lc = c as { minLength?: number; maxLength?: number }
        return `length: ${lc.minLength ?? ''}..${lc.maxLength ?? ''}`
      })
      .join('; ')

    // Link to base datatype
    const baseDt = DATATYPE_REGISTRY.find(dt => dt.id === vt.baseType)
    if (baseDt) {
      links.push({
        uri: nextLinkId(),
        predicate: 'references',
        sourceUri: vtId(vt.id),
        targetUri: dtId(baseDt.id),
      } as Link)
    }

    return {
      uri: vtId(vt.id),
      name: vt.label,
      definition: `Constrained ${vt.baseType}: ${constraintDesc}`,
      attributes: [
        attr('baseType', 'text'),
        attr('constraintCount', 'integer'),
      ],
      rules: [],
      states: [],
      stereotype: 'value-object' as const,
    }
  }) as unknown as Thing[]

  // ── Assemble contexts ─────────────────────────────────────────────────
  const contexts: Record<string, any> = {
    [CTX_META_ROOT]: {
      uri: CTX_META_ROOT,
      name: 'Metaontology',
      description: 'The domain-agnostic metaontology - universal primitives for business modeling. Entity classes, predicates, datatypes, and value types.',
      parentUri: parentId,
      facets: emptyFacets(),
      symbols: [],
    },
    [CTX_ENTITY_CLASSES]: {
      uri: CTX_ENTITY_CLASSES,
      name: 'Entity Classes',
      description: `The ${entityClassThings.length} entity types that make up the modeling vocabulary.`,
      parentUri: CTX_META_ROOT,
      facets: { ...emptyFacets(), things: entityClassThings },
      symbols: [],
    },
    [CTX_PREDICATES]: {
      uri: CTX_PREDICATES,
      name: 'Predicates',
      description: `The ${predicateThings.length} relationship types that connect entities.`,
      parentUri: CTX_META_ROOT,
      facets: { ...emptyFacets(), things: predicateThings },
      symbols: [],
    },
    [CTX_DATATYPES]: {
      uri: CTX_DATATYPES,
      name: 'Datatypes',
      description: `The ${datatypeThings.length} XSD-grounded attribute types.`,
      parentUri: CTX_META_ROOT,
      facets: { ...emptyFacets(), things: datatypeThings },
      symbols: [],
    },
    [CTX_VALUE_TYPES]: {
      uri: CTX_VALUE_TYPES,
      name: 'Value Types',
      description: `The ${valueTypeThings.length} built-in constrained value types.`,
      parentUri: CTX_META_ROOT,
      facets: { ...emptyFacets(), things: valueTypeThings },
      symbols: [],
    },
  }

  return { contexts, links }
}

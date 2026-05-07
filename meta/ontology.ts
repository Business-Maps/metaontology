/**
 * Business Maps Ontology - the single source of truth for entity types,
 * predicates, and their constraints.
 *
 * Like colors.ts is for visual identity, this file is for knowledge structure.
 * Every relationship rule, validation constraint, export vocabulary, AI tool
 * schema, and UI relationship picker derives from this file.
 *
 * FAIR-compliant: every term has a persistent URI, language-tagged labels,
 * and machine-readable domain/range constraints. Export to Turtle, JSON-LD,
 * or N-Triples is a direct serialisation of these definitions.
 */

// ── Namespace ────────────────────────────────────────────────────────────────

// ── Facet key → Entity class mapping ─────────────────────────────────────────
// Self-derived from ENTITY_CLASSES below - each entity class declares its facetKey.
// No dependency on facetMeta.ts, breaking the circular import.

import type { ValueTypeDef, ValueConstraint } from './valueTypes'
import { getFacetKeyToClassMap } from '../dsl/engineBridge'

let BM_NS = 'https://ontology.businessmaps.io/'
let BM_PREFIX = 'bm'

export function getBmNamespace() {
  return BM_NS
}

export function getBmPrefix() {
  return BM_PREFIX
}

/**
 * Configure the base namespace URI and prefix for the ontology.
 * Updates the structural URIs for all entities and predicates.
 */
export function configureOntologyNamespace(uri: string, prefix: string = 'bm') {
  BM_NS = uri.endsWith('/') ? uri : uri + '/'
  BM_PREFIX = prefix

  for (const def of Object.values(ENTITY_CLASSES)) {
    // @ts-expect-error Update runtime URIs even though objects are cast as const
    def.uri = `${BM_NS}${def.id}`
  }

  for (const def of Object.values(PREDICATES)) {
    // @ts-expect-error Update runtime URIs even though objects are cast as const
    def.uri = `${BM_NS}${def.id.replace(/:([a-z])/g, (_, g) => g.toUpperCase())}`
  }
}

// ── Localisation ─────────────────────────────────────────────────────────────

/** Language-tagged literal - English is required, others optional.
 *  Mirrors RDF language tags: "Context"@en, "Contexte"@fr, "سياق"@ar */
export type I18nLiteral = { en: string } & { [lang: string]: string }

// ── Entity Types (Classes) ───────────────────────────────────────────────────

export interface EntityClassDef {
  /** Programmatic key - matches the runtime type discriminant. */
  id: string
  /** Persistent URI for RDF export. */
  uri: string
  /** Human-readable name in each locale. */
  labels: I18nLiteral
  /** Short definition per locale. */
  descriptions: I18nLiteral
  /** If this entity lives in a facet array, which key? */
  facetKey?: string
  /** OWL superclass id, if any. */
  parent?: string
}

export const ENTITY_CLASSES = {
  Context: {
    id: 'Context',
    uri: `${BM_NS}Context`,
    labels: { en: 'Context' },
    descriptions: { en: 'A bounded domain area with its own language and responsibilities.' },
  },
  Thing: {
    id: 'Thing',
    uri: `${BM_NS}Thing`,
    labels: { en: 'Thing' },
    descriptions: { en: 'A data object or record that a context stores or processes.' },
    facetKey: 'things',
  },
  Persona: {
    id: 'Persona',
    uri: `${BM_NS}Persona`,
    labels: { en: 'Persona' },
    descriptions: { en: 'A person, role, or system that takes actions within a context.' },
    facetKey: 'personas',
  },
  Action: {
    id: 'Action',
    uri: `${BM_NS}Action`,
    labels: { en: 'Action' },
    descriptions: { en: 'A command, query, or intent - an operation that can be performed.' },
    facetKey: 'actions',
  },
  Workflow: {
    id: 'Workflow',
    uri: `${BM_NS}Workflow`,
    labels: { en: 'Workflow' },
    descriptions: { en: 'A step-by-step process with triggers, steps, and transitions.' },
    facetKey: 'workflows',
  },
  Interface: {
    id: 'Interface',
    uri: `${BM_NS}Interface`,
    labels: { en: 'Interface' },
    descriptions: { en: 'A screen, API, dashboard, or channel through which interaction happens.' },
    facetKey: 'interfaces',
  },
  Event: {
    id: 'Event',
    uri: `${BM_NS}Event`,
    labels: { en: 'Event' },
    descriptions: { en: 'A domain event or state change - an immutable fact that a context produces.' },
    facetKey: 'events',
  },
  Measure: {
    id: 'Measure',
    uri: `${BM_NS}Measure`,
    labels: { en: 'Measure' },
    descriptions: { en: 'A metric, KPI, or aggregated summary - a tracked quantity a context reports.' },
    facetKey: 'measures',
  },
  Port: {
    id: 'Port',
    uri: `${BM_NS}Port`,
    labels: { en: 'Port' },
    descriptions: { en: 'A named boundary contract declaring what value a context produces or consumes.' },
    facetKey: 'ports',
  },
  Function: {
    id: 'Function',
    uri: `${BM_NS}Function`,
    labels: { en: 'Function' },
    descriptions: { en: 'A pure, composable computation over the ontology - invoked from Actions, Interfaces, Pipelines, Measures, and other Functions.' },
    facetKey: 'functions',
  },
  DataSource: {
    id: 'DataSource',
    uri: `${BM_NS}DataSource`,
    labels: { en: 'Data Source' },
    descriptions: { en: 'A connection to an external system - transport configuration, credential reference, and environment binding. Reusable across Pipelines.' },
    facetKey: 'datasources',
  },
  Pipeline: {
    id: 'Pipeline',
    uri: `${BM_NS}Pipeline`,
    labels: { en: 'Pipeline' },
    descriptions: { en: 'A declarative data flow from a DataSource to a target Thing - mapping, scheduling, direction, and strategy. Each Pipeline has exactly one source DataSource and populates one or more Things.' },
    facetKey: 'pipelines',
  },
  Symbol: {
    id: 'Symbol',
    uri: `${BM_NS}Symbol`,
    labels: { en: 'Symbol' },
    descriptions: { en: 'A freeform mark - name it, describe it, link it, or promote it to a typed entity when ready.' },
  },
  WorkflowStep: {
    id: 'WorkflowStep',
    uri: `${BM_NS}WorkflowStep`,
    labels: { en: 'Workflow Step' },
    descriptions: { en: 'A single step within a workflow process.' },
    parent: 'Workflow',
  },
  ThingState: {
    id: 'ThingState',
    uri: `${BM_NS}ThingState`,
    labels: { en: 'Thing State' },
    descriptions: { en: 'A lifecycle state within a Thing\'s state machine.' },
    parent: 'Thing',
  },
} as const satisfies Record<string, EntityClassDef>

export type EntityClassId = keyof typeof ENTITY_CLASSES

/**
 * @deprecated Phase 3 - now derived from the DSL registry via engineBridge.
 * Downstream consumers that import FACET_KEY_TO_CLASS from this file get
 * the registry-derived value. Prefer importing from the DSL directly:
 *   import { getFacetKeyToClassMap } from '../dsl/engineBridge'
 */
export const FACET_KEY_TO_CLASS = getFacetKeyToClassMap() as Record<FacetKey, EntityClassId>

/** The canonical set of facet keys, derived from the registry. */
export type FacetKey = 'things' | 'personas' | 'ports' | 'actions' | 'workflows' | 'interfaces' | 'events' | 'measures' | 'functions' | 'datasources' | 'pipelines'

// ── Predicates ───────────────────────────────────────────────────────────────

/**
 * Relationship multiplicity - advisory metadata for documentation and export.
 * NOT enforced at the command layer. The domain model stores all links as flat
 * entries in RootContext.links[]. Enforcement would require checking existing
 * links on every link:add, which adds complexity without proportional value
 * at the current product phase. Consider enforcement for Phase IV (Generate).
 */
export type Cardinality = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many'

export interface PredicateDef {
  /** Programmatic key - matches LinkPredicate for stored predicates. */
  id: string
  /** Persistent URI for RDF export. */
  uri: string
  /** Human-readable label per locale: "performs" */
  labels: I18nLiteral
  /** Inverse label per locale: "performed by" */
  inverseLabels: I18nLiteral
  /** Business-friendly label: "is responsible for" instead of "stewards" */
  businessLabels?: I18nLiteral
  /** Business-friendly inverse label */
  businessInverseLabels?: I18nLiteral
  /** Entity types that can be the source (subject). */
  domain: EntityClassId[]
  /** Entity types that can be the target (object). */
  range: EntityClassId[]
  /** Relationship multiplicity. */
  cardinality: Cardinality
  /** True if this predicate is derived from structure, not stored as a Link. */
  structural?: boolean
  /** True if the predicate is symmetric (A rel B ⟺ B rel A). */
  symmetric?: boolean
  /**
   * Predicate tier - separates structural metamodel from user-domain vocabulary.
   * - `framework`: structural metamodel relationships (Persona performs Action, etc.)
   * - `domain`: curated cross-cutting relationships (dependsOn, flowsTo, etc.)
   * - `custom`: free-text fallback - the Link's `label` field carries the name
   */
  tier: 'framework' | 'domain' | 'custom'
  /**
   * Ontology-derived default assertions for this predicate.
   * 'outgoing': each entity in domain[] should have ≥ min links with this predicate.
   * 'incoming': each entity in range[] should have ≥ min incoming links with this predicate.
   */
  defaultAssertions?: Array<{
    direction: 'outgoing' | 'incoming'
    min?: number
    /** When set, restrict the assertion to only these entity classes instead of all domain/range types. */
    onlyFor?: EntityClassId[]
  }>
  /**
   * IDs of more specific predicates that should be preferred when they also
   * match the source/target types. Used by the AI prompt and ConnectionPicker
   * to guide users toward precise predicates over vague ones.
   *
   * Example: flowsTo.alternatives = ['triggers', 'notifies', 'invokes']
   * means "if triggers/notifies/invokes also match, prefer those over flowsTo."
   */
  alternatives?: string[]
}

/**
 * All predicates in the Business Maps ontology.
 *
 * Stored predicates map 1:1 to `Link.predicate` values in the data model.
 * Structural predicates are derived from the typed model (parentId, facet
 * array membership) and appear only in the triple projection.
 */
export const PREDICATES = {
  // ── Stored predicates (persisted as Links) ───────────────────────────────

  valueStream: {
    id: 'valueStream',
    uri: `${BM_NS}valueStream`,
    labels: { en: 'value stream' },
    inverseLabels: { en: 'receives value from' },
    businessLabels: { en: 'sends value to' },
    businessInverseLabels: { en: 'receives value from' },
    domain: ['Context', 'Port'],
    range: ['Context', 'Port'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
  },
  performs: {
    id: 'performs',
    uri: `${BM_NS}performs`,
    labels: { en: 'performs' },
    inverseLabels: { en: 'performed by' },
    businessLabels: { en: 'does' },
    businessInverseLabels: { en: 'done by' },
    domain: ['Persona'],
    range: ['Action'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
    defaultAssertions: [{ direction: 'outgoing' }, { direction: 'incoming' }],
  },
  stewards: {
    id: 'stewards',
    uri: `${BM_NS}stewards`,
    labels: { en: 'stewards' },
    inverseLabels: { en: 'stewarded by' },
    businessLabels: { en: 'is responsible for' },
    businessInverseLabels: { en: 'responsibility of' },
    domain: ['Persona'],
    range: ['Thing', 'Context', 'Workflow', 'Port'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
  },
  observes: {
    id: 'observes',
    uri: `${BM_NS}observes`,
    labels: { en: 'observes' },
    inverseLabels: { en: 'observed by' },
    businessLabels: { en: 'watches' },
    businessInverseLabels: { en: 'watched by' },
    domain: ['Persona'],
    range: ['Event', 'Measure', 'Port'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
  },
  uses: {
    id: 'uses',
    uri: `${BM_NS}uses`,
    labels: { en: 'uses' },
    inverseLabels: { en: 'used by' },
    businessLabels: { en: 'uses' },
    businessInverseLabels: { en: 'used by' },
    domain: ['Persona'],
    range: ['Interface'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
    defaultAssertions: [{ direction: 'incoming' }],
  },
  reads: {
    id: 'reads',
    uri: `${BM_NS}reads`,
    labels: { en: 'reads' },
    inverseLabels: { en: 'read by' },
    businessLabels: { en: 'uses data from' },
    businessInverseLabels: { en: 'data used by' },
    domain: ['Action'],
    range: ['Thing'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
    defaultAssertions: [{ direction: 'outgoing' }],
  },
  writes: {
    id: 'writes',
    uri: `${BM_NS}writes`,
    labels: { en: 'writes' },
    inverseLabels: { en: 'written by' },
    businessLabels: { en: 'changes' },
    businessInverseLabels: { en: 'changed by' },
    domain: ['Action'],
    range: ['Thing'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
  },
  emits: {
    id: 'emits',
    uri: `${BM_NS}emits`,
    labels: { en: 'emits' },
    inverseLabels: { en: 'emitted by' },
    businessLabels: { en: 'produces' },
    businessInverseLabels: { en: 'produced by' },
    domain: ['Action'],
    range: ['Event'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
    defaultAssertions: [{ direction: 'outgoing' }],
  },
  exposes: {
    id: 'exposes',
    uri: `${BM_NS}exposes`,
    labels: { en: 'exposes' },
    inverseLabels: { en: 'exposed by' },
    businessLabels: { en: 'offers' },
    businessInverseLabels: { en: 'offered by' },
    domain: ['Interface'],
    range: ['Action'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
    defaultAssertions: [{ direction: 'outgoing' }],
  },
  displays: {
    id: 'displays',
    uri: `${BM_NS}displays`,
    labels: { en: 'displays' },
    inverseLabels: { en: 'displayed by' },
    businessLabels: { en: 'shows' },
    businessInverseLabels: { en: 'shown by' },
    domain: ['Interface'],
    range: ['Thing', 'Measure'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
  },
  measures: {
    id: 'measures',
    uri: `${BM_NS}measures`,
    labels: { en: 'measures' },
    inverseLabels: { en: 'measured by' },
    businessLabels: { en: 'tracks' },
    businessInverseLabels: { en: 'tracked by' },
    domain: ['Measure'],
    range: ['Thing', 'Action', 'Workflow', 'Event', 'Context', 'Port'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
    defaultAssertions: [{ direction: 'outgoing' }],
  },
  derivedFrom: {
    id: 'derivedFrom',
    uri: `${BM_NS}derivedFrom`,
    labels: { en: 'derived from' },
    inverseLabels: { en: 'source of' },
    businessLabels: { en: 'is based on' },
    businessInverseLabels: { en: 'feeds into' },
    domain: ['Measure'],
    range: ['Measure'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
  },
  owns: {
    id: 'owns',
    uri: `${BM_NS}owns`,
    labels: { en: 'owns' },
    inverseLabels: { en: 'owned by' },
    businessLabels: { en: 'contains' },
    businessInverseLabels: { en: 'contained by' },
    domain: ['Thing'],
    range: ['Thing'],
    cardinality: 'one-to-many' as Cardinality,
    tier: 'framework',
  },
  references: {
    id: 'references',
    uri: `${BM_NS}references`,
    labels: { en: 'references' },
    inverseLabels: { en: 'referenced by' },
    businessLabels: { en: 'relates to' },
    businessInverseLabels: { en: 'related to' },
    domain: ['Thing'],
    range: ['Thing'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
  },
  'step:action': {
    id: 'step:action',
    uri: `${BM_NS}stepAction`,
    labels: { en: 'step uses action' },
    inverseLabels: { en: 'used in step' },
    businessLabels: { en: 'step uses action' },
    businessInverseLabels: { en: 'used in step' },
    domain: ['WorkflowStep'],
    range: ['Action'],
    cardinality: 'many-to-one' as Cardinality,
    tier: 'framework',
  },
  'step:performer': {
    id: 'step:performer',
    uri: `${BM_NS}stepPerformer`,
    labels: { en: 'step performed by' },
    inverseLabels: { en: 'performs step' },
    businessLabels: { en: 'step performed by' },
    businessInverseLabels: { en: 'performs step' },
    domain: ['WorkflowStep'],
    range: ['Persona'],
    cardinality: 'many-to-one' as Cardinality,
    tier: 'framework',
  },
  'step:interface': {
    id: 'step:interface',
    uri: `${BM_NS}stepInterface`,
    labels: { en: 'step uses interface' },
    inverseLabels: { en: 'used in step' },
    businessLabels: { en: 'step uses interface' },
    businessInverseLabels: { en: 'used in step' },
    domain: ['WorkflowStep'],
    range: ['Interface'],
    cardinality: 'many-to-one' as Cardinality,
    tier: 'framework',
  },

  triggers: {
    id: 'triggers',
    uri: `${BM_NS}triggers`,
    labels: { en: 'triggers' },
    inverseLabels: { en: 'triggered by' },
    businessLabels: { en: 'starts' },
    businessInverseLabels: { en: 'started by' },
    domain: ['Event', 'Action', 'Port'],
    range: ['Workflow', 'Action'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
    defaultAssertions: [{ direction: 'incoming', onlyFor: ['Workflow'] }],
  },
  collaboratesWith: {
    id: 'collaboratesWith',
    uri: `${BM_NS}collaboratesWith`,
    labels: { en: 'collaborates with' },
    inverseLabels: { en: 'collaborates with' },
    businessLabels: { en: 'works with' },
    businessInverseLabels: { en: 'works with' },
    domain: ['Persona'],
    range: ['Persona'],
    cardinality: 'many-to-many' as Cardinality,
    symmetric: true,
    tier: 'framework',
  },
  delegatesTo: {
    id: 'delegatesTo',
    uri: `${BM_NS}delegatesTo`,
    labels: { en: 'delegates to' },
    inverseLabels: { en: 'delegated from' },
    businessLabels: { en: 'assigns work to' },
    businessInverseLabels: { en: 'receives work from' },
    domain: ['Persona'],
    range: ['Persona'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
  },
  invokes: {
    id: 'invokes',
    uri: `${BM_NS}invokes`,
    labels: { en: 'invokes' },
    inverseLabels: { en: 'invoked by' },
    businessLabels: { en: 'calls' },
    businessInverseLabels: { en: 'called by' },
    domain: ['Action', 'Workflow'],
    range: ['Action', 'Workflow'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
  },
  causedBy: {
    id: 'causedBy',
    uri: `${BM_NS}causedBy`,
    labels: { en: 'caused by' },
    inverseLabels: { en: 'causes' },
    businessLabels: { en: 'resulted from' },
    businessInverseLabels: { en: 'led to' },
    domain: ['Event'],
    range: ['Event'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
  },
  computedFrom: {
    id: 'computedFrom',
    uri: `${BM_NS}computedFrom`,
    labels: { en: 'computed from' },
    inverseLabels: { en: 'feeds into' },
    businessLabels: { en: 'is calculated from' },
    businessInverseLabels: { en: 'contributes to' },
    domain: ['Measure'],
    range: ['Event'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
  },
  notifies: {
    id: 'notifies',
    uri: `${BM_NS}notifies`,
    labels: { en: 'notifies' },
    inverseLabels: { en: 'notified by' },
    businessLabels: { en: 'alerts' },
    businessInverseLabels: { en: 'alerted by' },
    domain: ['Event'],
    range: ['Persona'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
  },

  // ── Domain predicates (curated cross-cutting relationships) ──────────────

  dependsOn: {
    id: 'dependsOn',
    uri: `${BM_NS}dependsOn`,
    labels: { en: 'depends on' },
    inverseLabels: { en: 'depended on by' },
    businessLabels: { en: 'requires' },
    businessInverseLabels: { en: 'required by' },
    domain: ['Context', 'Action', 'Workflow', 'Interface'],
    range: ['Context', 'Action', 'Thing', 'Interface', 'Event', 'Measure'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'domain',
    alternatives: ['valueStream'],
  },
  flowsTo: {
    id: 'flowsTo',
    uri: `${BM_NS}flowsTo`,
    labels: { en: 'flows to' },
    inverseLabels: { en: 'receives flow from' },
    businessLabels: { en: 'sends to' },
    businessInverseLabels: { en: 'receives from' },
    domain: ['Thing', 'Event', 'Action'],
    range: ['Context', 'Persona', 'Interface', 'Action'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'domain',
    alternatives: ['triggers', 'notifies', 'invokes'],
  },
  implements: {
    id: 'implements',
    uri: `${BM_NS}implements`,
    labels: { en: 'implements' },
    inverseLabels: { en: 'implemented by' },
    businessLabels: { en: 'realizes' },
    businessInverseLabels: { en: 'realized by' },
    domain: ['Action', 'Workflow', 'Interface'],
    range: ['Action', 'Port'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'domain',
  },
  extends: {
    id: 'extends',
    uri: `${BM_NS}extends`,
    labels: { en: 'extends' },
    inverseLabels: { en: 'extended by' },
    businessLabels: { en: 'specializes' },
    businessInverseLabels: { en: 'specialized by' },
    domain: ['Thing', 'Action', 'Context', 'Persona'],
    range: ['Thing', 'Action', 'Context', 'Persona'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'domain',
  },
  produces: {
    id: 'produces',
    uri: `${BM_NS}produces`,
    labels: { en: 'produces' },
    inverseLabels: { en: 'produced by' },
    businessLabels: { en: 'creates' },
    businessInverseLabels: { en: 'created by' },
    domain: ['Action', 'Workflow', 'Context', 'Port'],
    range: ['Thing', 'Event', 'Measure'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'domain',
    alternatives: ['writes', 'emits'],
  },
  consumes: {
    id: 'consumes',
    uri: `${BM_NS}consumes`,
    labels: { en: 'consumes' },
    inverseLabels: { en: 'consumed by' },
    businessLabels: { en: 'takes from' },
    businessInverseLabels: { en: 'supplied by' },
    domain: ['Action', 'Workflow', 'Persona', 'Context', 'Port'],
    range: ['Thing', 'Event', 'Measure'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'domain',
    alternatives: ['reads', 'observes'],
  },
  sameConceptAs: {
    id: 'sameConceptAs',
    uri: `${BM_NS}sameConceptAs`,
    labels: { en: 'same concept as' },
    inverseLabels: { en: 'same concept as' },
    businessLabels: { en: 'also known as' },
    businessInverseLabels: { en: 'also known as' },
    domain: ['Thing', 'Persona', 'Action', 'Workflow', 'Interface', 'Event', 'Measure'],
    range: ['Thing', 'Persona', 'Action', 'Workflow', 'Interface', 'Event', 'Measure'],
    cardinality: 'many-to-many' as Cardinality,
    symmetric: true,
    tier: 'domain',
  },

  // ── Custom predicate (free-text fallback) ────────────────────────────────

  custom: {
    id: 'custom',
    uri: `${BM_NS}custom`,
    labels: { en: 'custom relationship' },
    inverseLabels: { en: 'custom relationship' },
    businessLabels: { en: 'relates to' },
    businessInverseLabels: { en: 'related to' },
    domain: ['Thing', 'Context', 'Action', 'Workflow', 'Interface', 'Event', 'Measure', 'Persona', 'Symbol'],
    range: ['Thing', 'Context', 'Action', 'Workflow', 'Interface', 'Event', 'Measure', 'Persona', 'Symbol'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'custom',
  },

  // ── Symbol predicates ──────────────────────────────────────────────────────

  annotates: {
    id: 'annotates',
    uri: `${BM_NS}annotates`,
    labels: { en: 'annotates' },
    inverseLabels: { en: 'annotated by' },
    businessLabels: { en: 'explains' },
    businessInverseLabels: { en: 'explained by' },
    // Both Symbols (attachment) and Interfaces (media) can host a screenshot
    // and therefore carry annotations. Keeping Interface in the domain is
    // what lets annotations survive a symbol→interface promotion without
    // `pruneInvalidLinks` (engine/apply.ts) treating them as invalid.
    domain: ['Symbol', 'Interface'],
    range: ['Context', 'Thing', 'Persona', 'Port', 'Action', 'Workflow', 'Interface', 'Event', 'Measure', 'Symbol'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
  },
  documents: {
    id: 'documents',
    uri: `${BM_NS}documents`,
    labels: { en: 'documents' },
    inverseLabels: { en: 'documented by' },
    businessLabels: { en: 'is a doc for' },
    businessInverseLabels: { en: 'has documentation' },
    domain: ['Symbol'],
    range: ['Context', 'Thing', 'Persona', 'Port', 'Action', 'Workflow', 'Interface', 'Event', 'Measure'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
  },
  composes: {
    id: 'composes',
    uri: `${BM_NS}composes`,
    labels: { en: 'composes' },
    inverseLabels: { en: 'composed by' },
    businessLabels: { en: 'contains' },
    businessInverseLabels: { en: 'contained by' },
    domain: ['Interface'],
    range: ['Interface'],
    cardinality: 'one-to-many' as Cardinality,
    tier: 'framework',
  },

  // ── Structural predicates (derived, not stored as Links) ─────────────────

  derivedPayloadFrom: {
    id: 'derivedPayloadFrom',
    uri: `${BM_NS}derivedPayloadFrom`,
    labels: { en: 'derived payload from' },
    inverseLabels: { en: 'payload used by' },
    domain: ['Event', 'Interface'],
    range: ['Thing'],
    cardinality: 'many-to-many' as Cardinality,
    structural: true,
    tier: 'framework',
  },
  hasTag: {
    id: 'hasTag',
    uri: `${BM_NS}hasTag`,
    labels: { en: 'has tag' },
    inverseLabels: { en: 'tag of' },
    domain: ['Context', 'Thing', 'Persona', 'Action', 'Workflow', 'Interface', 'Event', 'Measure', 'Symbol'],
    range: ['Context', 'Thing', 'Persona', 'Action', 'Workflow', 'Interface', 'Event', 'Measure', 'Symbol'],
    cardinality: 'many-to-many' as Cardinality,
    structural: true,
    tier: 'framework',
  },
  childOf: {
    id: 'childOf',
    uri: `${BM_NS}childOf`,
    labels: { en: 'child of' },
    inverseLabels: { en: 'parent of' },
    domain: ['Context'],
    range: ['Context'],
    cardinality: 'many-to-one' as Cardinality,
    structural: true,
    tier: 'framework',
  },
  mentions: {
    id: 'mentions',
    uri: `${BM_NS}mentions`,
    labels: { en: 'mentions' },
    inverseLabels: { en: 'mentioned in' },
    domain: ['Symbol'],
    range: ['Context', 'Thing', 'Persona', 'Port', 'Action', 'Workflow', 'Interface', 'Event', 'Measure', 'Symbol'],
    cardinality: 'many-to-many' as Cardinality,
    structural: true,
    tier: 'framework',
  },
  memberOf: {
    id: 'memberOf',
    uri: `${BM_NS}memberOf`,
    labels: { en: 'member of' },
    inverseLabels: { en: 'contains' },
    domain: ['Thing', 'Persona', 'Action', 'Workflow', 'Interface', 'Event', 'Measure', 'Symbol'],
    range: ['Context'],
    cardinality: 'many-to-one' as Cardinality,
    structural: true,
    tier: 'framework',
  },
  'workflow:involvesPersona': {
    id: 'workflow:involvesPersona',
    uri: `${BM_NS}workflowInvolvesPersona`,
    labels: { en: 'involves persona' },
    inverseLabels: { en: 'participates in' },
    domain: ['Workflow'],
    range: ['Persona'],
    cardinality: 'many-to-many' as Cardinality,
    structural: true,
    tier: 'framework',
  },
  'workflow:involvesAction': {
    id: 'workflow:involvesAction',
    uri: `${BM_NS}workflowInvolvesAction`,
    labels: { en: 'involves action' },
    inverseLabels: { en: 'used in workflow' },
    domain: ['Workflow'],
    range: ['Action'],
    cardinality: 'many-to-many' as Cardinality,
    structural: true,
    tier: 'framework',
  },
  'state:transitionsTo': {
    id: 'state:transitionsTo',
    uri: `${BM_NS}stateTransitionsTo`,
    labels: { en: 'transitions to' },
    inverseLabels: { en: 'transitioned from' },
    domain: ['ThingState'],
    range: ['ThingState'],
    cardinality: 'many-to-many' as Cardinality,
    structural: true,
    tier: 'framework',
  },
  'state:memberOf': {
    id: 'state:memberOf',
    uri: `${BM_NS}stateMemberOf`,
    labels: { en: 'state of' },
    inverseLabels: { en: 'has state' },
    domain: ['ThingState'],
    range: ['Thing'],
    cardinality: 'many-to-one' as Cardinality,
    structural: true,
    tier: 'framework',
  },
  inheritedAttribute: {
    id: 'inheritedAttribute',
    uri: `${BM_NS}inheritedAttribute`,
    labels: { en: 'inherited attribute' },
    inverseLabels: { en: 'attribute inherited by' },
    domain: ['Thing'],
    range: ['Thing'],
    cardinality: 'many-to-many' as Cardinality,
    structural: true,
    tier: 'framework',
  },

  // ── Function predicates ─────────────────────
  //
  // `computes` - A Function computes a value for a specific Thing attribute.
  // Used by derived attributes: `calculateLTV` computes `Customer.lifetimeValue`.
  // Range is technically scoped to `Thing` (attribute-level scoping is enforced
  // at runtime via the function body's signature, not at the predicate level).
  computes: {
    id: 'computes',
    uri: `${BM_NS}computes`,
    labels: { en: 'computes' },
    inverseLabels: { en: 'computed by' },
    domain: ['Function'],
    range: ['Thing'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
  },
  // `calls` - A Function (or Action, Interface, Pipeline, Measure, Workflow)
  // invokes another Function. Used by the dependency graph and the
  // function-call boundary discipline check (Functions cannot transitively
  // invoke a Pipeline; enforced at runtime).
  calls: {
    id: 'calls',
    uri: `${BM_NS}calls`,
    labels: { en: 'calls' },
    inverseLabels: { en: 'called by' },
    domain: ['Function', 'Action', 'Interface', 'Measure', 'Workflow'],
    range: ['Function'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
  },

  // ── DataSource predicates ───────────────────
  //
  // `boundTo` - A DataSource binds to a Port. This ties the connection
  // (transport + credential + environment) to the context boundary that
  // owns the flow. A Port can be bound by multiple DataSources (e.g., a
  // `customers-in` port could accept both a Stripe DataSource and a
  // Shopify DataSource during a migration). A DataSource typically binds
  // to a single Port but the schema permits many for federation patterns.
  boundTo: {
    id: 'boundTo',
    uri: `${BM_NS}boundTo`,
    labels: { en: 'bound to' },
    inverseLabels: { en: 'binds' },
    domain: ['DataSource'],
    range: ['Port'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
  },

  // ── Pipeline predicates ────────
  //
  // **ADR-003: The flow-predicate enumeration is frozen at three stored
  // predicates** - `pullsFrom`, `pushesTo`, `populates`. The `feeds`
  // label is preserved via `inverseLabels` on `pullsFrom` so the UI can
  // still render "Stripe feeds Stripe Customer Sync" from a stored
  // `(pipeline, pullsFrom, datasource)` triple. No separate `feeds`
  // stored predicate.
  //
  // Cardinality: a Pipeline has exactly ONE source DataSource (many-to-one),
  // but a DataSource may be consumed by many Pipelines. Same for pushesTo.
  // `populates` is many-to-many - one Pipeline can populate multiple Things
  // (e.g., a Stripe pipeline populating Customer AND Subscription).

  // `pullsFrom` - A Pipeline pulls data from a DataSource. Used for
  // import/sync flows. The inverse label "feeds" is what the UI renders
  // when walking this edge from the DataSource side.
  pullsFrom: {
    id: 'pullsFrom',
    uri: `${BM_NS}pullsFrom`,
    labels: { en: 'pulls from' },
    inverseLabels: { en: 'feeds' },
    domain: ['Pipeline'],
    range: ['DataSource'],
    cardinality: 'many-to-one' as Cardinality,
    tier: 'framework',
  },
  // `pushesTo` - A Pipeline pushes data to a DataSource. Used for export
  // and writeback flows.
  pushesTo: {
    id: 'pushesTo',
    uri: `${BM_NS}pushesTo`,
    labels: { en: 'pushes to' },
    inverseLabels: { en: 'pushed by' },
    domain: ['Pipeline'],
    range: ['DataSource'],
    cardinality: 'many-to-one' as Cardinality,
    tier: 'framework',
  },
  // `populates` - A Pipeline populates instances of a Thing. The target
  // side of a pull flow: StripeCustomerSync populates Customer.
  populates: {
    id: 'populates',
    uri: `${BM_NS}populates`,
    labels: { en: 'populates' },
    inverseLabels: { en: 'populated by' },
    domain: ['Pipeline'],
    range: ['Thing'],
    cardinality: 'many-to-many' as Cardinality,
    tier: 'framework',
  },
} as const satisfies Record<string, PredicateDef>

export type PredicateId = keyof typeof PREDICATES

/** Only the predicates that are stored as Link objects (non-structural). */
export type StoredPredicateId = {
  [K in PredicateId]: (typeof PREDICATES)[K] extends { structural: true } ? never : K
}[PredicateId]

/** The structural predicates derived from the typed model. */
export type StructuralPredicateId = Exclude<PredicateId, StoredPredicateId>

// ── Datatype Registry ────────────────────────────────────────────────────────
//
// XSD-grounded attribute types. Every attribute type in the system derives from
// this registry. Consumers (AI tool schemas, code generation, RDF export, UI
// pickers) read from it - never hardcode type lists.
//
// Design principle: attribute types are leaf values (scalars with semantic
// meaning). When a value needs its own attributes, rules, or states, promote
// it to a descriptor Thing instead.

export interface OntologyDatatype {
  /** Programmatic key - stored in ThingAttribute.type */
  id: string
  /** Human-friendly label for UI pickers */
  label: string
  /** XSD datatype URI for RDF export */
  xsd: string
  /** Grouping key for UI picker sections */
  baseType: 'string' | 'number' | 'boolean' | 'temporal' | 'complex'
  /** One-line description for AI tool schemas and tooltips */
  description: string
  /** TypeScript type for code generation */
  tsType: string
  /** Abbreviated label for canvas node badges */
  shortLabel: string
  /** Optional regex constraint for validation */
  pattern?: string
  /** Extra fields required on ThingAttribute for this type */
  extraFields?: readonly string[]
}

export const DATATYPE_REGISTRY: readonly OntologyDatatype[] = [
  // ── String family ──────────────────────────────────────────────────────────
  { id: 'text',       label: 'Text',        xsd: 'xsd:string',   baseType: 'string',   description: 'Free-form text',                          tsType: 'string',   shortLabel: 'str' },
  { id: 'identifier', label: 'Identifier',  xsd: 'xsd:token',    baseType: 'string',   description: 'Short code or ID (no whitespace)',         tsType: 'string',   shortLabel: 'id',   pattern: '\\S+' },
  { id: 'email',      label: 'Email',       xsd: 'xsd:string',   baseType: 'string',   description: 'Email address',                            tsType: 'string',   shortLabel: 'email' },
  { id: 'uri',        label: 'URI',         xsd: 'xsd:anyURI',   baseType: 'string',   description: 'URL or URI',                               tsType: 'string',   shortLabel: 'uri' },
  { id: 'markdown',   label: 'Rich Text',   xsd: 'xsd:string',   baseType: 'string',   description: 'Markdown-formatted text',                  tsType: 'string',   shortLabel: 'md' },
  { id: 'richDoc',    label: 'Rich Content', xsd: 'rdf:JSON',    baseType: 'complex',  description: 'Structured content doc (headings, lists, todos, mentions, embeds)', tsType: 'RichDoc', shortLabel: 'doc' },

  // ── Number family ──────────────────────────────────────────────────────────
  { id: 'integer',    label: 'Whole Number', xsd: 'xsd:integer',  baseType: 'number',   description: 'Whole number (no decimals)',               tsType: 'number',   shortLabel: 'int' },
  { id: 'decimal',    label: 'Decimal',      xsd: 'xsd:decimal',  baseType: 'number',   description: 'Precise decimal number',                   tsType: 'number',   shortLabel: 'dec' },
  { id: 'percentage', label: 'Percentage',   xsd: 'xsd:decimal',  baseType: 'number',   description: 'Value expressed as a percentage',          tsType: 'number',   shortLabel: '%' },
  { id: 'money',      label: 'Money',        xsd: 'xsd:decimal',  baseType: 'number',   description: 'Monetary amount with currency',            tsType: 'number',   shortLabel: '$',    extraFields: ['currencyCode'] },
  { id: 'quantity',   label: 'Quantity',     xsd: 'xsd:decimal',  baseType: 'number',   description: 'Measured value with unit',                 tsType: 'number',   shortLabel: 'qty',  extraFields: ['unit'] },

  // ── Temporal family ────────────────────────────────────────────────────────
  { id: 'date',       label: 'Date',         xsd: 'xsd:date',     baseType: 'temporal', description: 'Calendar date (no time)',                  tsType: 'Date',     shortLabel: 'date' },
  { id: 'dateTime',   label: 'Date & Time',  xsd: 'xsd:dateTime', baseType: 'temporal', description: 'Date with time of day',                   tsType: 'Date',     shortLabel: 'dt' },
  { id: 'time',       label: 'Time',         xsd: 'xsd:time',     baseType: 'temporal', description: 'Time of day only',                        tsType: 'string',   shortLabel: 'time' },
  { id: 'duration',   label: 'Duration',     xsd: 'xsd:duration', baseType: 'temporal', description: 'Length of time (e.g., P2D, PT30M)',       tsType: 'string',   shortLabel: 'dur' },

  // ── Boolean ────────────────────────────────────────────────────────────────
  { id: 'boolean',    label: 'Yes / No',     xsd: 'xsd:boolean',  baseType: 'boolean',  description: 'True or false flag',                      tsType: 'boolean',  shortLabel: 'bool' },

  // ── Complex (existing structural types) ────────────────────────────────────
  { id: 'reference',  label: 'Reference',    xsd: 'owl:ObjectProperty', baseType: 'complex', description: 'Link to another Thing',               tsType: 'string',   shortLabel: 'ref' },
  { id: 'enum',       label: 'Choice',       xsd: 'xsd:string',        baseType: 'complex', description: 'One of a fixed set of values',        tsType: 'string',   shortLabel: 'enum' },
  { id: 'list',       label: 'List',         xsd: 'rdf:List',          baseType: 'complex', description: 'Ordered collection of values',         tsType: 'string[]', shortLabel: 'list' },
] as const

// ── Datatype lookup helpers ──────────────────────────────────────────────────

const _datatypeById = new Map<string, OntologyDatatype>(
  DATATYPE_REGISTRY.map(dt => [dt.id, dt]),
)

/** Look up a datatype definition by id. */
export function getDatatypeDef(id: string): OntologyDatatype | undefined {
  return _datatypeById.get(id)
}

/** All datatype IDs, for enum validation in JSON schemas. */
export const DATATYPE_IDS = DATATYPE_REGISTRY.map(dt => dt.id)

/** Datatypes grouped by baseType, for UI picker sections. */
export function getDatatypesByBase(): Record<string, OntologyDatatype[]> {
  const groups: Record<string, OntologyDatatype[]> = {}
  for (const dt of DATATYPE_REGISTRY) {
    ;(groups[dt.baseType] ??= []).push(dt)
  }
  return groups
}

/**
 * Migrate a legacy attribute type to a registry-valid one.
 * Old 'number' → 'decimal', old 'other' → 'text'. Known types pass through.
 */
export function migrateAttributeType(type: string): string {
  if (_datatypeById.has(type)) return type
  switch (type) {
    case 'number': return 'decimal'
    case 'other':  return 'text'
    default:       return 'text'
  }
}

// ── Stereotype Registries ───────────────────────────────────────────────────
// Stereotypes are semantic classifications on uniform field sets.
// They guide AI heuristics, canvas visuals, and Phase IV code generation.

export interface StereotypeDef {
  id: string
  label: string
  description: string
  /** Icon override for canvas rendering (SVG string or null to use facet default) */
  icon?: string
}

/** @public */
export const THING_STEREOTYPES: readonly StereotypeDef[] = [
  { id: 'entity', label: 'Entity', description: 'Mutable domain object identified by ID (default)' },
  { id: 'value-object', label: 'Value Object', description: 'Immutable value identified by attributes, not ID' },
  { id: 'aggregate-root', label: 'Aggregate Root', description: 'Consistency boundary - owns and protects invariants of child entities' },
  { id: 'reference-data', label: 'Reference Data', description: 'Shared lookup data (countries, currencies, categories)' },
  { id: 'goal', label: 'Goal', description: 'Strategic objective with target date and success criteria' },
  { id: 'risk', label: 'Risk', description: 'Identified threat with probability, impact, and mitigation' },
  { id: 'assumption', label: 'Assumption', description: 'Unvalidated belief that the business model depends on' },
  { id: 'milestone', label: 'Milestone', description: 'Time-bound deliverable or achievement marker' },
]

/** @public */
export const PERSONA_STEREOTYPES: readonly StereotypeDef[] = [
  { id: 'human', label: 'Human', description: 'Individual person (default)' },
  { id: 'team', label: 'Team', description: 'Group of people working together' },
  { id: 'system', label: 'System', description: 'Internal automated system or service' },
  { id: 'external', label: 'External', description: 'Third-party service or integration partner' },
  { id: 'customer', label: 'Customer', description: 'End user who is both an actor and a data entity - stewards a companion Thing' },
]

/** @public */
export const MEASURE_STEREOTYPES: readonly StereotypeDef[] = [
  { id: 'metric', label: 'Metric', description: 'KPI or tracked quantity (default)' },
  { id: 'aggregator', label: 'Aggregator', description: 'Rolled-up summary derived from other measures' },
  { id: 'financial', label: 'Financial', description: 'Revenue, cost, margin, or other monetary measure' },
]

// ── Interface Kind Registry ─────────────────────────────────────────────────
// Unlike stereotypes, `kind` is a structural discriminant - it determines
// which fields are available on an Interface. See types/context.ts.

export type InterfaceLayer = 'presentation' | 'integration'

export interface InterfaceKindDef {
  id: string
  label: string
  layer: InterfaceLayer
  description: string
  /** Icon SVG string for canvas rendering */
  icon?: string
}

/** @public */
export const INTERFACE_KIND_REGISTRY: readonly InterfaceKindDef[] = [
  // Presentation layer
  { id: 'application', label: 'Application', layer: 'presentation', description: 'Top-level app shell (e.g., Storefront, Admin Panel)' },
  { id: 'page', label: 'Page', layer: 'presentation', description: 'A route/screen (e.g., /products/:id)' },
  { id: 'layout', label: 'Layout', layer: 'presentation', description: 'Structural template with named regions (header, sidebar, content)' },
  { id: 'component', label: 'Component', layer: 'presentation', description: 'Reusable UI building block with props and slots' },
  { id: 'form', label: 'Form', layer: 'presentation', description: 'Data entry surface derived from Thing attributes' },
  { id: 'dashboard', label: 'Dashboard', layer: 'presentation', description: 'Metric composition displaying Measures' },
  { id: 'design-tokens', label: 'Design Tokens', layer: 'presentation', description: 'Design system primitives (colors, typography, spacing)' },
  // Integration layer
  { id: 'api', label: 'API', layer: 'integration', description: 'API surface - collection of endpoints' },
  { id: 'endpoint', label: 'Endpoint', layer: 'integration', description: 'Single HTTP route (method + path)' },
  { id: 'webhook', label: 'Webhook', layer: 'integration', description: 'Inbound event endpoint' },
  { id: 'notification', label: 'Notification', layer: 'integration', description: 'Outbound channel (email, SMS, push)' },
  { id: 'report', label: 'Report', layer: 'integration', description: 'Generated document (PDF, CSV, HTML)' },
]

// ── Built-in Value Types ────────────────────────────────────────────────────
// Shipped with the product. Users can define additional ValueTypes on RootContext.

export const BUILTIN_VALUE_TYPES = [
  { id: 'email', label: 'Email Address', baseType: 'text', constraints: [{ type: 'regex' as const, pattern: '^[^@]+@[^@]+\\.[^@]+$', message: 'Must be a valid email' }], renderHint: 'email-link' },
  { id: 'url', label: 'URL', baseType: 'uri', constraints: [{ type: 'regex' as const, pattern: '^https?://', message: 'Must be a valid URL' }], renderHint: 'url-link' },
  { id: 'phone', label: 'Phone Number', baseType: 'text', constraints: [{ type: 'regex' as const, pattern: '^\\+?[0-9\\s\\-()]+$' }] },
  { id: 'country-code', label: 'Country Code', baseType: 'text', constraints: [{ type: 'length' as const, minLength: 2, maxLength: 2 }, { type: 'regex' as const, pattern: '^[A-Z]{2}$' }] },
  { id: 'currency-code', label: 'Currency Code', baseType: 'text', constraints: [{ type: 'length' as const, minLength: 3, maxLength: 3 }, { type: 'regex' as const, pattern: '^[A-Z]{3}$' }] },
  { id: 'hex-color', label: 'Hex Color', baseType: 'text', constraints: [{ type: 'regex' as const, pattern: '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' }], renderHint: 'color-swatch' },
  { id: 'slug', label: 'URL Slug', baseType: 'identifier', constraints: [{ type: 'regex' as const, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' }] },
  { id: 'percentage-0-100', label: 'Percentage (0-100)', baseType: 'percentage', constraints: [{ type: 'range' as const, min: 0, max: 100 }], renderHint: 'progress' },
  { id: 'positive-integer', label: 'Positive Integer', baseType: 'integer', constraints: [{ type: 'range' as const, min: 0 }] },
  { id: 'rating-5', label: 'Rating (1-5)', baseType: 'integer', constraints: [{ type: 'range' as const, min: 1, max: 5 }], renderHint: 'badge' },
] as const

// ── Value Type runtime helpers ──────────────────────────────────────────────

export interface AttributeValidationError {
  field: string
  constraint: string
  message: string
}

/** Resolve a ValueType by ID - checks built-in types first, then model-level custom types. */
export function resolveValueType(id: string, customTypes?: readonly ValueTypeDef[]): ValueTypeDef | undefined {
  const builtin = BUILTIN_VALUE_TYPES.find(vt => vt.id === id)
  if (builtin) return { ...builtin, constraints: [...builtin.constraints] }
  return customTypes?.find(vt => vt.id === id)
}

/** Validate a value against a ValueType's constraints. Returns errors or empty array. */
export function validateAttributeValue(
  value: unknown,
  constraints: readonly ValueConstraint[],
  fieldName = 'value',
): AttributeValidationError[] {
  const errors: AttributeValidationError[] = []
  if (value === null || value === undefined) return errors

  for (const c of constraints) {
    switch (c.type) {
      case 'regex': {
        if (typeof value === 'string' && c.pattern && !new RegExp(c.pattern).test(value)) {
          errors.push({ field: fieldName, constraint: 'regex', message: c.message ?? `Does not match pattern ${c.pattern}` })
        }
        break
      }
      case 'enum': {
        if (c.allowedValues && !c.allowedValues.includes(String(value))) {
          errors.push({ field: fieldName, constraint: 'enum', message: c.message ?? `Must be one of: ${c.allowedValues.join(', ')}` })
        }
        break
      }
      case 'range': {
        const num = Number(value)
        if (!isNaN(num)) {
          if (c.min !== undefined && num < c.min) errors.push({ field: fieldName, constraint: 'range', message: c.message ?? `Must be >= ${c.min}` })
          if (c.max !== undefined && num > c.max) errors.push({ field: fieldName, constraint: 'range', message: c.message ?? `Must be <= ${c.max}` })
        }
        break
      }
      case 'length': {
        if (typeof value === 'string') {
          if (c.minLength !== undefined && value.length < c.minLength) errors.push({ field: fieldName, constraint: 'length', message: c.message ?? `Must be at least ${c.minLength} characters` })
          if (c.maxLength !== undefined && value.length > c.maxLength) errors.push({ field: fieldName, constraint: 'length', message: c.message ?? `Must be at most ${c.maxLength} characters` })
        }
        break
      }
    }
  }
  return errors
}

// ── Lookup helpers ───────────────────────────────────────────────────────────

const _predicateById = new Map<string, PredicateDef>(
  Object.values(PREDICATES).map(p => [p.id, p]),
)

const _entityById = new Map<string, EntityClassDef>(
  Object.values(ENTITY_CLASSES).map(e => [e.id, e]),
)

export function getPredicateDef(id: string): PredicateDef | undefined {
  return _predicateById.get(id)
}

export function getEntityClassDef(id: string): EntityClassDef | undefined {
  return _entityById.get(id)
}

/** All stored (non-structural) predicate definitions. */
export function getStoredPredicates(): PredicateDef[] {
  return (Object.values(PREDICATES) as PredicateDef[]).filter(p => !p.structural)
}

/** All structural predicate definitions. */
export function getStructuralPredicates(): PredicateDef[] {
  return (Object.values(PREDICATES) as PredicateDef[]).filter(p => p.structural)
}

/** All non-structural predicate definitions for a given tier. */
export function getPredicatesByTier(tier: PredicateDef['tier']): PredicateDef[] {
  return (Object.values(PREDICATES) as PredicateDef[]).filter(p => !p.structural && p.tier === tier)
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface ValidationError {
  code: 'INVALID_PREDICATE' | 'DOMAIN_VIOLATION' | 'RANGE_VIOLATION' | 'SELF_REFERENCE'
  message: string
  predicate?: string
  sourceType?: string
  targetType?: string
}

/**
 * Validate that a predicate can connect the given source and target types.
 * Returns null if valid, or a ValidationError if not.
 */
export function validateLink(
  predicateId: string,
  sourceEntityType: EntityClassId,
  targetEntityType: EntityClassId,
  sourceId?: string,
  targetId?: string,
): ValidationError | null {
  const pred = _predicateById.get(predicateId)
  if (!pred) {
    return { code: 'INVALID_PREDICATE', message: `Unknown predicate: "${predicateId}"`, predicate: predicateId }
  }
  if (sourceId && targetId && sourceId === targetId) {
    return { code: 'SELF_REFERENCE', message: `Cannot link an entity to itself via "${predicateId}"`, predicate: predicateId }
  }
  // Symbols bypass domain/range validation intentionally. The Symbol lifecycle is:
  // create → link freely (brainstorm) → classify into typed facet → pruneInvalidLinks
  // removes any links that violate the new type's constraints.
  // See apply.ts:pruneInvalidLinks for the safety net.
  if (sourceEntityType === 'Symbol' || targetEntityType === 'Symbol') return null
  if (!pred.domain.includes(sourceEntityType)) {
    return {
      code: 'DOMAIN_VIOLATION',
      message: `"${predicateId}" requires source to be ${pred.domain.join(' | ')}, got ${sourceEntityType}`,
      predicate: predicateId,
      sourceType: sourceEntityType,
    }
  }
  if (!pred.range.includes(targetEntityType)) {
    return {
      code: 'RANGE_VIOLATION',
      message: `"${predicateId}" requires target to be ${pred.range.join(' | ')}, got ${targetEntityType}`,
      predicate: predicateId,
      targetType: targetEntityType,
    }
  }
  // Predicate-specific constraints beyond flat domain/range
  if (predicateId === 'extends' && sourceEntityType !== targetEntityType) {
    return {
      code: 'RANGE_VIOLATION',
      message: `"extends" requires same-type specialization: ${sourceEntityType} can only extend another ${sourceEntityType}`,
      predicate: predicateId,
      sourceType: sourceEntityType,
      targetType: targetEntityType,
    }
  }
  return null
}

// ── Thing role inference ─────────────────────────────────────────────────────

/**
 * Infer a Thing's role from its position in the ownership graph.
 * Explicit thingRole takes precedence - this provides a computed default.
 */
export function inferThingRole(
  thingId: string,
  links: readonly { predicate: string; sourceId: string; targetId: string }[],
): 'root' | 'part' | 'descriptor' {
  const isOwned = links.some(l => l.predicate === 'owns' && l.targetId === thingId)
  const ownsOthers = links.some(l => l.predicate === 'owns' && l.sourceId === thingId)

  if (isOwned) return 'part'
  if (ownsOthers) return 'root'
  return 'root'  // default to root - descriptor inference requires attribute analysis
}

// ── RDF Serialisation helpers ────────────────────────────────────────────────

/** Escape a string for N-Triples / Turtle literal output. */
function escapeNT(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')
}

/** Serialise the ontology itself as Turtle (the T-Box). */
export function serialiseOntologyAsTurtle(): string {
  const lines: string[] = [
    `@prefix bm: <${BM_NS}> .`,
    `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`,
    `@prefix owl: <http://www.w3.org/2002/07/owl#> .`,
    `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`,
    '',
    '# ── Entity Classes ──────────────────────────────────────────────────────',
    '',
  ]

  for (const cls of Object.values(ENTITY_CLASSES) as EntityClassDef[]) {
    lines.push(`bm:${cls.id} a owl:Class ;`)
    for (const [lang, label] of Object.entries(cls.labels)) {
      lines.push(`  rdfs:label "${escapeNT(label)}"@${lang} ;`)
    }
    for (const [lang, desc] of Object.entries(cls.descriptions)) {
      lines.push(`  rdfs:comment "${escapeNT(desc)}"@${lang} ;`)
    }
    if (cls.parent) {
      lines.push(`  rdfs:subClassOf bm:${cls.parent} ;`)
    }
    // Replace trailing " ;" with " ."
    lines[lines.length - 1] = lines[lines.length - 1]!.replace(/ ;$/, ' .')
    lines.push('')
  }

  lines.push('# ── Predicates ─────────────────────────────────────────────────────────', '')

  for (const pred of Object.values(PREDICATES) as PredicateDef[]) {
    const rdfType = pred.structural ? 'owl:ObjectProperty' : 'owl:ObjectProperty'
    lines.push(`bm:${pred.id.replace(':', '_')} a ${rdfType} ;`)
    for (const [lang, label] of Object.entries(pred.labels)) {
      lines.push(`  rdfs:label "${escapeNT(label)}"@${lang} ;`)
    }
    for (const [lang, label] of Object.entries(pred.inverseLabels)) {
      lines.push(`  bm:inverseLabel "${escapeNT(label)}"@${lang} ;`)
    }
    lines.push(`  rdfs:domain [ owl:unionOf (${pred.domain.map(d => `bm:${d}`).join(' ')}) ] ;`)
    lines.push(`  rdfs:range [ owl:unionOf (${pred.range.map(r => `bm:${r}`).join(' ')}) ] ;`)
    lines[lines.length - 1] = lines[lines.length - 1]!.replace(/ ;$/, ' .')
    lines.push('')
  }

  return lines.join('\n')
}

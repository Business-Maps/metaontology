/**
 * Built-in predicates - the 45 canonical link predicates in the BM
 * framework. Registered via `definePredicate` so the DSL registry
 * can enumerate them at runtime.
 *
 * Organized by category:
 *   - framework: structural metamodel relationships (Persona performs Action, etc.)
 *   - domain: curated cross-cutting relationships (dependsOn, flowsTo, etc.)
 *   - custom: free-text fallback
 *
 * The `domain`/`range` arrays use `facetRef(id)` to create
 * lightweight references to the base types declared in `baseTypes.ts`.
 */

import { definePredicate } from '../dsl/defineGeneric'
import { facetRef } from '../dsl/schemaCombinators'

// ── Convenient refs ────────────────────────────────────────────────────────

const Context      = facetRef('context')
const Thing        = facetRef('thing')
const Persona      = facetRef('persona')
const Port         = facetRef('port')
const Action       = facetRef('action')
const Workflow     = facetRef('workflow')
const Interface    = facetRef('interface')
const Event        = facetRef('event')
const Measure      = facetRef('measure')
const Fn           = facetRef('function')
const DataSource   = facetRef('dataSource')
const Pipeline     = facetRef('pipeline')
const Symbol       = facetRef('symbol')
const WorkflowStep = facetRef('workflowStep')
const ThingState   = facetRef('thingState')

// ═══════════════════════════════════════════════════════════════════════════
// Stored predicates (persisted as Links)
// ═══════════════════════════════════════════════════════════════════════════

export const valueStream = definePredicate('valueStream', {
  domain: [Context, Port], range: [Context, Port],
  label: { en: 'value stream' }, inverseLabel: { en: 'receives value from' },
})

export const performs = definePredicate('performs', {
  domain: [Persona], range: [Action],
  label: { en: 'performs' }, inverseLabel: { en: 'performed by' },
})

export const stewards = definePredicate('stewards', {
  domain: [Persona], range: [Thing, Context, Workflow, Port],
  label: { en: 'stewards' }, inverseLabel: { en: 'stewarded by' },
})

export const observes = definePredicate('observes', {
  domain: [Persona], range: [Event, Measure, Port],
  label: { en: 'observes' }, inverseLabel: { en: 'observed by' },
})

export const uses = definePredicate('uses', {
  domain: [Persona], range: [Interface],
  label: { en: 'uses' }, inverseLabel: { en: 'used by' },
})

export const reads = definePredicate('reads', {
  domain: [Action], range: [Thing],
  label: { en: 'reads' }, inverseLabel: { en: 'read by' },
})

export const writes = definePredicate('writes', {
  domain: [Action], range: [Thing],
  label: { en: 'writes' }, inverseLabel: { en: 'written by' },
})

export const emits = definePredicate('emits', {
  domain: [Action], range: [Event],
  label: { en: 'emits' }, inverseLabel: { en: 'emitted by' },
})

export const exposes = definePredicate('exposes', {
  domain: [Interface], range: [Action],
  label: { en: 'exposes' }, inverseLabel: { en: 'exposed by' },
})

export const displays = definePredicate('displays', {
  domain: [Interface], range: [Thing, Measure],
  label: { en: 'displays' }, inverseLabel: { en: 'displayed by' },
})

export const measuresPred = definePredicate('measures', {
  domain: [Measure], range: [Thing, Action, Workflow, Event, Context, Port],
  label: { en: 'measures' }, inverseLabel: { en: 'measured by' },
})

export const derivedFrom = definePredicate('derivedFrom', {
  domain: [Measure], range: [Measure],
  label: { en: 'derived from' }, inverseLabel: { en: 'source of' },
})

export const owns = definePredicate('owns', {
  domain: [Thing], range: [Thing],
  cardinality: { source: 'one', target: 'many' },
  label: { en: 'owns' }, inverseLabel: { en: 'owned by' },
})

export const references = definePredicate('references', {
  domain: [Thing], range: [Thing],
  label: { en: 'references' }, inverseLabel: { en: 'referenced by' },
})

export const stepAction = definePredicate('step:action', {
  domain: [WorkflowStep], range: [Action],
  cardinality: { source: 'many', target: 'one' },
  label: { en: 'step uses action' }, inverseLabel: { en: 'used in step' },
})

export const stepPerformer = definePredicate('step:performer', {
  domain: [WorkflowStep], range: [Persona],
  cardinality: { source: 'many', target: 'one' },
  label: { en: 'step performed by' }, inverseLabel: { en: 'performs step' },
})

export const stepInterface = definePredicate('step:interface', {
  domain: [WorkflowStep], range: [Interface],
  cardinality: { source: 'many', target: 'one' },
  label: { en: 'step uses interface' }, inverseLabel: { en: 'used in step' },
})

export const triggers = definePredicate('triggers', {
  domain: [Event, Action, Port], range: [Workflow, Action],
  label: { en: 'triggers' }, inverseLabel: { en: 'triggered by' },
})

export const collaboratesWith = definePredicate('collaboratesWith', {
  domain: [Persona], range: [Persona],
  label: { en: 'collaborates with' }, inverseLabel: { en: 'collaborates with' },
})

export const delegatesTo = definePredicate('delegatesTo', {
  domain: [Persona], range: [Persona],
  label: { en: 'delegates to' }, inverseLabel: { en: 'delegated from' },
})

export const invokes = definePredicate('invokes', {
  domain: [Action, Workflow], range: [Action, Workflow],
  label: { en: 'invokes' }, inverseLabel: { en: 'invoked by' },
})

export const causedBy = definePredicate('causedBy', {
  domain: [Event], range: [Event],
  label: { en: 'caused by' }, inverseLabel: { en: 'causes' },
})

export const computedFrom = definePredicate('computedFrom', {
  domain: [Measure], range: [Event],
  label: { en: 'computed from' }, inverseLabel: { en: 'feeds into' },
})

export const notifies = definePredicate('notifies', {
  domain: [Event], range: [Persona],
  label: { en: 'notifies' }, inverseLabel: { en: 'notified by' },
})

export const annotates = definePredicate('annotates', {
  // Symbols and Interfaces can both host a screenshot (Symbol.attachment,
  // Interface.media), and either can be the anchor of an annotation. Keeping
  // Interface in the domain is what lets annotations survive a
  // symbol→interface promotion without `pruneInvalidLinks` stripping them.
  domain: [Symbol, Interface], range: [Context, Thing, Persona, Port, Action, Workflow, Interface, Event, Measure, Symbol],
  label: { en: 'annotates' }, inverseLabel: { en: 'annotated by' },
})

export const documents = definePredicate('documents', {
  domain: [Symbol], range: [Context, Thing, Persona, Port, Action, Workflow, Interface, Event, Measure],
  label: { en: 'documents' }, inverseLabel: { en: 'documented by' },
})

export const composes = definePredicate('composes', {
  domain: [Interface], range: [Interface],
  cardinality: { source: 'one', target: 'many' },
  label: { en: 'composes' }, inverseLabel: { en: 'composed by' },
})

// ── M0 operational predicates ───────────────────────
//
// These predicates connect M0 entity classes to M1 facets and to each other.
// They are stored predicates - M0 triples use them for operational queries.
// The domain/range reference M0 entity class IDs registered in
// `m0EntityClasses.ts` (without facetKey, so they don't appear in facet
// iteration).

const M0Instance       = facetRef('m0:instance')
const M0PipelineRun    = facetRef('m0:pipelineRun')
const M0RetryEntry     = facetRef('m0:retryEntry')
const M0Suppression    = facetRef('m0:suppressionRecord')
const M0ReplayPoint    = facetRef('m0:replayPoint')
const M0Deployment     = facetRef('m0:deploymentRecord')
const M0SimRun         = facetRef('m0:simulationRun')
const M0WritebackItem  = facetRef('m0:writebackQueueItem')

export const retried = definePredicate('retried', {
  domain: [M0PipelineRun], range: [M0RetryEntry],
  cardinality: { source: 'one', target: 'many' },
  label: { en: 'retried' }, inverseLabel: { en: 'retry of' },
})

export const suppressed = definePredicate('suppressed', {
  domain: [Pipeline], range: [M0Suppression],
  cardinality: { source: 'one', target: 'many' },
  label: { en: 'suppressed' }, inverseLabel: { en: 'suppression of' },
})

export const replayed = definePredicate('replayed', {
  domain: [Pipeline], range: [M0ReplayPoint],
  cardinality: { source: 'one', target: 'many' },
  label: { en: 'replayed' }, inverseLabel: { en: 'replay of' },
})

export const regenerated = definePredicate('regenerated', {
  domain: [M0Deployment], range: [M0Deployment],
  cardinality: { source: 'one', target: 'one' },
  label: { en: 'regenerated' }, inverseLabel: { en: 'regenerated from' },
})

export const runFor = definePredicate('runFor', {
  domain: [M0PipelineRun], range: [Pipeline],
  cardinality: { source: 'many', target: 'one' },
  label: { en: 'run for' }, inverseLabel: { en: 'has run' },
})

export const producedBy = definePredicate('producedBy', {
  domain: [M0Instance], range: [M0PipelineRun],
  cardinality: { source: 'one', target: 'one' },
  label: { en: 'produced by' }, inverseLabel: { en: 'produced' },
})

export const deployedFrom = definePredicate('deployedFrom', {
  domain: [M0Deployment], range: [Context],
  cardinality: { source: 'one', target: 'one' },
  label: { en: 'deployed from' }, inverseLabel: { en: 'deployed as' },
})

export const simulatedAgainst = definePredicate('simulatedAgainst', {
  domain: [M0SimRun], range: [Context],
  cardinality: { source: 'one', target: 'one' },
  label: { en: 'simulated against' }, inverseLabel: { en: 'simulated by' },
})

export const pendingWriteback = definePredicate('pendingWriteback', {
  domain: [Action], range: [M0WritebackItem],
  cardinality: { source: 'one', target: 'many' },
  label: { en: 'pending writeback' }, inverseLabel: { en: 'writeback for' },
})

export const boundToEnvironment = definePredicate('boundToEnvironment', {
  domain: [Pipeline, DataSource], range: [Context],
  cardinality: { source: 'many', target: 'one' },
  label: { en: 'bound to environment' }, inverseLabel: { en: 'environment of' },
})

// ── Function / DataSource / Pipeline predicates ───────────────

export const computes = definePredicate('computes', {
  domain: [Fn], range: [Thing],
  label: { en: 'computes' }, inverseLabel: { en: 'computed by' },
})

export const calls = definePredicate('calls', {
  domain: [Fn, Action, Interface, Measure, Workflow], range: [Fn],
  label: { en: 'calls' }, inverseLabel: { en: 'called by' },
})

export const boundTo = definePredicate('boundTo', {
  domain: [DataSource], range: [Port],
  label: { en: 'bound to' }, inverseLabel: { en: 'binds' },
})

export const pullsFrom = definePredicate('pullsFrom', {
  domain: [Pipeline], range: [DataSource],
  cardinality: { source: 'many', target: 'one' },
  label: { en: 'pulls from' }, inverseLabel: { en: 'feeds' },
})

export const pushesTo = definePredicate('pushesTo', {
  domain: [Pipeline], range: [DataSource],
  cardinality: { source: 'many', target: 'one' },
  label: { en: 'pushes to' }, inverseLabel: { en: 'pushed by' },
})

export const populates = definePredicate('populates', {
  domain: [Pipeline], range: [Thing],
  label: { en: 'populates' }, inverseLabel: { en: 'populated by' },
})

// ═══════════════════════════════════════════════════════════════════════════
// Domain predicates (curated cross-cutting relationships)
// ═══════════════════════════════════════════════════════════════════════════

export const dependsOn = definePredicate('dependsOn', {
  domain: [Context, Action, Workflow, Interface], range: [Context, Action, Thing, Interface, Event, Measure],
  label: { en: 'depends on' }, inverseLabel: { en: 'depended on by' },
})

export const flowsTo = definePredicate('flowsTo', {
  domain: [Thing, Event, Action], range: [Context, Persona, Interface, Action],
  label: { en: 'flows to' }, inverseLabel: { en: 'receives flow from' },
})

export const implementsPred = definePredicate('implements', {
  domain: [Action, Workflow, Interface], range: [Action, Port],
  label: { en: 'implements' }, inverseLabel: { en: 'implemented by' },
})

export const extendsPred = definePredicate('extends', {
  domain: [Thing, Action, Context, Persona], range: [Thing, Action, Context, Persona],
  label: { en: 'extends' }, inverseLabel: { en: 'extended by' },
})

export const producesPred = definePredicate('produces', {
  domain: [Action, Workflow, Context, Port], range: [Thing, Event, Measure],
  label: { en: 'produces' }, inverseLabel: { en: 'produced by' },
})

export const consumesPred = definePredicate('consumes', {
  domain: [Action, Workflow, Persona, Context, Port], range: [Thing, Event, Measure],
  label: { en: 'consumes' }, inverseLabel: { en: 'consumed by' },
})

export const sameConceptAs = definePredicate('sameConceptAs', {
  domain: [Thing, Persona, Action, Workflow, Interface, Event, Measure],
  range: [Thing, Persona, Action, Workflow, Interface, Event, Measure],
  label: { en: 'same concept as' }, inverseLabel: { en: 'same concept as' },
})

// ═══════════════════════════════════════════════════════════════════════════
// Custom predicate (free-text fallback)
// ═══════════════════════════════════════════════════════════════════════════

export const custom = definePredicate('custom', {
  domain: [Thing, Context, Action, Workflow, Interface, Event, Measure, Persona, Symbol],
  range: [Thing, Context, Action, Workflow, Interface, Event, Measure, Persona, Symbol],
  label: { en: 'custom relationship' }, inverseLabel: { en: 'custom relationship' },
})

// ═══════════════════════════════════════════════════════════════════════════
// Structural predicates (derived from the model, not stored as Links)
// ═══════════════════════════════════════════════════════════════════════════

export const derivedPayloadFrom = definePredicate('derivedPayloadFrom', {
  domain: [Event, Interface], range: [Thing],
  label: { en: 'derived payload from' }, inverseLabel: { en: 'payload used by' },
})

export const hasTag = definePredicate('hasTag', {
  domain: [Context, Thing, Persona, Action, Workflow, Interface, Event, Measure, Symbol],
  range: [Context, Thing, Persona, Action, Workflow, Interface, Event, Measure, Symbol],
  label: { en: 'has tag' }, inverseLabel: { en: 'tag of' },
})

export const childOf = definePredicate('childOf', {
  domain: [Context], range: [Context],
  cardinality: { source: 'many', target: 'one' },
  label: { en: 'child of' }, inverseLabel: { en: 'parent of' },
})

export const mentions = definePredicate('mentions', {
  domain: [Symbol], range: [Context, Thing, Persona, Port, Action, Workflow, Interface, Event, Measure, Symbol],
  label: { en: 'mentions' }, inverseLabel: { en: 'mentioned in' },
})

export const memberOf = definePredicate('memberOf', {
  domain: [Thing, Persona, Action, Workflow, Interface, Event, Measure, Symbol],
  range: [Context],
  cardinality: { source: 'many', target: 'one' },
  label: { en: 'member of' }, inverseLabel: { en: 'contains' },
})

export const workflowInvolvesPersona = definePredicate('workflow:involvesPersona', {
  domain: [Workflow], range: [Persona],
  label: { en: 'involves persona' }, inverseLabel: { en: 'participates in' },
})

export const workflowInvolvesAction = definePredicate('workflow:involvesAction', {
  domain: [Workflow], range: [Action],
  label: { en: 'involves action' }, inverseLabel: { en: 'used in workflow' },
})

export const stateTransitionsTo = definePredicate('state:transitionsTo', {
  domain: [ThingState], range: [ThingState],
  label: { en: 'transitions to' }, inverseLabel: { en: 'transitioned from' },
})

export const stateMemberOf = definePredicate('state:memberOf', {
  domain: [ThingState], range: [Thing],
  cardinality: { source: 'many', target: 'one' },
  label: { en: 'state of' }, inverseLabel: { en: 'has state' },
})

export const inheritedAttribute = definePredicate('inheritedAttribute', {
  domain: [Thing], range: [Thing],
  label: { en: 'inherited attribute' }, inverseLabel: { en: 'attribute inherited by' },
})

/**
 * Facet Field Registry - declarative description of every field on every facet
 * type, plus the link-creation mappings that connect AI tool parameters to
 * ontology predicates.
 *
 * This is Phase A of the Ontology-Driven Architecture.
 * The registry is the single source of truth for per-facet-type field knowledge.
 * Consumers (AI tool schema generation, form builders, export) derive from it
 * rather than hardcoding per-type knowledge.
 */

import type { FacetType } from '../types/context'
import type { StoredPredicateId } from './ontology'
import { PREDICATES, DATATYPE_IDS } from './ontology'
import { FACET_TYPES, BASE_FACET_REGISTRY } from './facets'
import { resolveI18n } from './i18n'

// ── Widget types ─────────────────────────────────────────────────────────────

export type FieldWidget = 'text' | 'textarea' | 'select' | 'chips-string' | 'array-string' | 'array-object' | 'object' | 'duration' | 'endpoint-path' | 'hidden'

// ── JSON Schema types ─────────────────────────────────────────────────────────

export type JsonSchemaType = 'string' | 'number' | 'boolean' | 'array' | 'object'

export interface FieldSchema {
  type: JsonSchemaType
  enum?: readonly string[]
  items?: FieldSchema
  properties?: Record<string, FieldSchema>
  required?: readonly string[]
  description?: string
}

// ── Facet field definition ────────────────────────────────────────────────────

export interface FacetFieldDef {
  /** AI tool parameter name - what appears in the JSON Schema */
  paramName: string
  /** TypeScript interface field name (if different from paramName) */
  fieldName?: string
  /** JSON Schema for this parameter */
  schema: FieldSchema
  /** Which facet types this field applies to */
  facetTypes: readonly FacetType[]
  /** When present, field only applies when the Interface `kind` matches one of these values */
  forKinds?: readonly string[]
  /** Default value when not provided */
  defaultValue?: unknown
  /** Description for the LLM tool schema */
  aiDescription: string
  /** Widget hint for form rendering */
  widget?: FieldWidget
  /** Human-readable label for form display */
  label?: string
}

// ── Link creation mapping ─────────────────────────────────────────────────────

/**
 * Declares that an AI tool parameter creates links with a given predicate.
 *
 * `direction` determines which end is the newly-created facet:
 * - 'outgoing': newFacetId → paramValue  (e.g., Action reads Thing)
 * - 'incoming': paramValue → newFacetId  (e.g., Persona performs Action)
 */
export interface LinkParamMapping {
  /** AI tool parameter name */
  paramName: string
  /** Predicate to create */
  predicate: StoredPredicateId
  /** Which end is the new facet */
  direction: 'outgoing' | 'incoming'
  /** Which facet types this applies to */
  facetTypes: readonly FacetType[]
  /** JSON Schema for the parameter */
  schema: FieldSchema
  /** Description for the LLM */
  aiDescription: string
  /** True if this is a single ID, not an array */
  singular?: boolean
}

// ── Shared sub-schemas ────────────────────────────────────────────────────────

/** Derived from DATATYPE_REGISTRY - the single source of truth for attribute types. */
const ATTRIBUTE_TYPE_ENUM = DATATYPE_IDS

const ATTRIBUTE_SCHEMA: FieldSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    type: { type: 'string', enum: ATTRIBUTE_TYPE_ENUM, description: 'Datatype - string family: text, identifier, email, uri, markdown; number family: integer, decimal, percentage, money, quantity; temporal: date, dateTime, time, duration; boolean; complex: reference, enum, list' },
    referencedThingId: { type: 'string', description: 'Required when type is "reference": the ID of the Thing this attribute points to' },
    referenceType: { type: 'string', enum: ['association', 'composition'], description: 'For reference-type: "association" (loose link, default) or "composition" (strong ownership)' },
    enumValues: { type: 'array', items: { type: 'string' }, description: 'Required when type is "enum": the allowed values' },
    unit: { type: 'string', description: 'For "quantity" type: the unit of measurement (e.g., "kg", "ms", "items")' },
    currencyCode: { type: 'string', description: 'For "money" type: ISO 4217 currency code (e.g., "USD", "EUR")' },
  },
  required: ['name', 'type'],
}

const STATE_SCHEMA: FieldSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    initial: { type: 'boolean' },
    terminal: { type: 'boolean' },
  },
  required: ['id', 'name'],
}

const TRANSITION_SCHEMA: FieldSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Transition ID (auto-generated if omitted)' },
    targetStepId: { type: 'string', description: 'ID of the step to transition to' },
    label: { type: 'string', description: 'Label describing the transition, e.g. "approved", "payment failed"' },
    guard: { type: 'string', description: 'Optional business-language condition, e.g. "order.total > 500"' },
  },
  required: ['targetStepId', 'label'],
}

const STEP_SCHEMA: FieldSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Unique step ID (will be auto-generated if omitted)' },
    name: { type: 'string', description: 'Step name, e.g. "Validate Order"' },
    actionId: { type: 'string', description: 'ID of the Action this step performs (reference an existing Action)' },
    performerId: { type: 'string', description: 'ID of the Persona who performs this step - must be one of the action\'s performers (linked via "performs" predicate)' },
    interfaceId: { type: 'string', description: 'ID of the Interface used in this step (optional - not every step uses an interface)' },
    description: { type: 'string', description: 'Optional description of what happens in this step' },
    transitions: {
      type: 'array',
      description: 'Where to go next. Each transition points to another step by ID.',
      items: TRANSITION_SCHEMA,
    },
  },
  required: ['name'],
}

const SCHEMA_FIELD_SCHEMA: FieldSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    sourceThingId: { type: 'string', description: 'ID of the Thing this field derives from' },
    sourceAttributeName: { type: 'string', description: 'Specific attribute name from the source Thing' },
    type: { type: 'string', enum: ATTRIBUTE_TYPE_ENUM, description: 'Standalone datatype (when not referencing a Thing)' },
    description: { type: 'string' },
  },
  required: ['name'],
}

const TARGET_SCHEMA: FieldSchema = {
  type: 'object',
  description: 'For Measures: target range',
  properties: {
    min: { type: 'number' },
    max: { type: 'number' },
    direction: { type: 'string', enum: ['higher-is-better', 'lower-is-better', 'range'] },
  },
  required: ['direction'],
}

// ── Field definitions ─────────────────────────────────────────────────────────

export const FACET_FIELD_DEFS: readonly FacetFieldDef[] = [
  // ── Shared fields ───────────────────────────────────────────────────────────

  {
    paramName: 'tags',
    schema: { type: 'array', items: { type: 'string' } },
    facetTypes: [...FACET_TYPES],
    aiDescription: 'Classification labels for any facet type, e.g. ["compliance-sensitive", "revenue-bearing"]',
    widget: 'chips-string',
    label: 'Tags',
  },
  {
    paramName: 'description',
    schema: { type: 'string' },
    facetTypes: ['personas', 'ports', 'actions', 'workflows', 'interfaces', 'events', 'measures', 'functions'],
    aiDescription: 'Description for Personas, Ports, Actions, Workflows, Interfaces, Events, Measures, Functions',
    defaultValue: '',
    widget: 'textarea',
    label: 'Description',
  },
  {
    paramName: 'stereotype',
    schema: { type: 'string', enum: ['entity', 'value-object', 'aggregate-root', 'reference-data', 'goal', 'risk', 'assumption', 'milestone'] },
    facetTypes: ['things'],
    aiDescription: 'For Things: semantic classification. "entity" (mutable, identified by ID, default), "value-object" (immutable, identified by attributes), "aggregate-root" (consistency boundary), "reference-data" (shared lookups), "goal" (strategic objective), "risk" (identified threat), "assumption" (unvalidated belief), "milestone" (time-bound marker)',
    widget: 'select',
    label: 'Stereotype',
  },

  // ── Thing fields ────────────────────────────────────────────────────────────

  {
    paramName: 'definition',
    schema: { type: 'string' },
    facetTypes: ['things'],
    aiDescription: 'Definition/description (for Things)',
    defaultValue: '',
    widget: 'textarea',
    label: 'Definition',
  },
  {
    paramName: 'thingRole',
    schema: { type: 'string', enum: ['root', 'part', 'descriptor'] },
    facetTypes: ['things'],
    aiDescription: 'For Things: "root" (independent entity, default), "part" (owned by another Thing), "descriptor" (reusable value object)',
    widget: 'select',
    label: 'Role',
  },
  {
    paramName: 'attributes',
    schema: {
      type: 'array',
      description: 'Attributes for Things. For reference-type attributes, set referencedThingId to the ID of the Thing being referenced.',
      items: ATTRIBUTE_SCHEMA,
    },
    facetTypes: ['things'],
    aiDescription: 'Attributes for Things. For reference-type attributes, set referencedThingId to the ID of the Thing being referenced.',
    defaultValue: [],
    widget: 'array-object',
    label: 'Attributes',
  },
  {
    paramName: 'rules',
    schema: { type: 'array', items: { type: 'string' } },
    facetTypes: ['things'],
    aiDescription: 'For Things (especially root): plain-language business rules, e.g. "An order must have at least one line item"',
    widget: 'array-string',
    label: 'Rules',
  },
  {
    paramName: 'states',
    schema: {
      type: 'array',
      items: STATE_SCHEMA,
      description: 'Lifecycle states for this Thing (e.g., draft → submitted → approved → shipped).',
    },
    facetTypes: ['things'],
    aiDescription: 'Lifecycle states for this Thing (e.g., draft → submitted → approved → shipped).',
    widget: 'array-object',
    label: 'States',
  },

  // ── Temporal fields ────────────────────────────────────────────────────────

  {
    paramName: 'expectedDuration',
    schema: {
      type: 'object',
      properties: {
        value: { type: 'number' },
        unit: { type: 'string', enum: ['seconds', 'minutes', 'hours', 'days', 'weeks'] },
      },
      required: ['value', 'unit'],
    },
    facetTypes: ['actions'],
    aiDescription: 'For Actions: expected duration, e.g. { value: 2, unit: "hours" }',
    widget: 'duration',
    label: 'Expected Duration',
  },
  {
    paramName: 'aggregation',
    schema: { type: 'string', enum: ['count', 'sum', 'average', 'min', 'max', 'rate', 'ratio', 'percentile'] },
    facetTypes: ['measures'],
    aiDescription: 'For Measures: aggregation function - how the measure is computed',
    widget: 'select',
    label: 'Aggregation',
  },
  {
    paramName: 'timeWindow',
    schema: {
      type: 'object',
      properties: {
        value: { type: 'number' },
        unit: { type: 'string', enum: ['seconds', 'minutes', 'hours', 'days', 'weeks'] },
      },
      required: ['value', 'unit'],
    },
    facetTypes: ['measures'],
    aiDescription: 'For Measures: time window over which the measure is tracked, e.g. { value: 7, unit: "days" } for weekly',
    widget: 'duration',
    label: 'Time Window',
  },

  // ── Persona fields ──────────────────────────────────────────────────────────

  {
    paramName: 'role',
    schema: { type: 'string' },
    facetTypes: ['personas'],
    aiDescription: 'Role description for Personas',
    defaultValue: '',
    widget: 'text',
    label: 'Role',
  },
  {
    paramName: 'personaType',
    schema: { type: 'string', enum: ['human', 'team', 'system', 'external', 'customer'] },
    facetTypes: ['personas'],
    aiDescription: 'For Personas: "human" (individual person, default), "team" (group of people), "system" (internal automated system), "external" (third-party service or integration), "customer" (end user who is both actor and data entity)',
    defaultValue: 'human',
    widget: 'select',
    label: 'Persona Type',
  },
  {
    paramName: 'topologyType',
    schema: { type: 'string', enum: ['stream-aligned', 'platform', 'enabling', 'complicated-subsystem'] },
    facetTypes: ['personas'],
    aiDescription: 'For team Personas only (personaType === "team"): Team Topologies type - "stream-aligned" (delivers end-to-end value), "platform" (provides internal services), "enabling" (helps other teams adopt new skills), "complicated-subsystem" (owns complex domain requiring specialist knowledge)',
    widget: 'select',
    label: 'Topology Type',
  },

  // ── Port fields ────────────────────────────────────────────────────────────

  {
    paramName: 'direction',
    schema: { type: 'string', enum: ['produces', 'consumes'] },
    facetTypes: ['ports'],
    aiDescription: 'For Ports: "produces" (this context outputs value through this port) or "consumes" (this context receives value through this port)',
    defaultValue: 'produces',
    widget: 'select',
    label: 'Direction',
  },

  // ── Action fields ───────────────────────────────────────────────────────────

  {
    paramName: 'actionType',
    fieldName: 'type',
    schema: { type: 'string', enum: ['command', 'query', 'intent'] },
    facetTypes: ['actions'],
    aiDescription: 'Type for Actions',
    defaultValue: 'command',
    widget: 'select',
    label: 'Type',
  },
  {
    paramName: 'preconditions',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['state', 'field', 'text'], description: '"state" (Thing must be in state), "field" (attribute condition), or "text" (plain-language, default)' },
          thingId: { type: 'string', description: 'For state/field conditions: ID of the Thing to check' },
          stateId: { type: 'string', description: 'For state conditions: ID of the required state' },
          attribute: { type: 'string', description: 'For field conditions: attribute name to check' },
          operator: { type: 'string', enum: ['exists', 'equals', 'gt', 'lt'], description: 'For field conditions: comparison operator' },
          value: { type: 'string', description: 'For field/equals/gt/lt conditions: value to compare against' },
          description: { type: 'string', description: 'Human-readable description (required for text type, optional for others)' },
        },
        required: ['type'],
      },
    },
    facetTypes: ['actions'],
    aiDescription: 'For Actions: conditions that must hold before execution. Use type "text" for plain language (e.g. "Cart must have at least one item"), "state" to require a Thing be in a specific state, or "field" for attribute conditions.',
    defaultValue: [],
    widget: 'array-object',
    label: 'Preconditions',
  },
  {
    paramName: 'postconditions',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['state', 'field', 'text'], description: '"state" (Thing must be in state), "field" (attribute condition), or "text" (plain-language, default)' },
          thingId: { type: 'string', description: 'For state/field conditions: ID of the Thing to check' },
          stateId: { type: 'string', description: 'For state conditions: ID of the required state' },
          attribute: { type: 'string', description: 'For field conditions: attribute name to check' },
          operator: { type: 'string', enum: ['exists', 'equals', 'gt', 'lt'], description: 'For field conditions: comparison operator' },
          value: { type: 'string', description: 'For field/equals/gt/lt conditions: value to compare against' },
          description: { type: 'string', description: 'Human-readable description (required for text type, optional for others)' },
        },
        required: ['type'],
      },
    },
    facetTypes: ['actions'],
    aiDescription: 'For Actions: outcomes true after execution. Use type "text" for plain language (e.g. "Order record exists with status pending"), "state" to assert a Thing is in a specific state, or "field" for attribute conditions.',
    defaultValue: [],
    widget: 'array-object',
    label: 'Postconditions',
  },

  // ── Action rule fields ──────────────────────────────────────────────────────

  {
    paramName: 'parameters',
    schema: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, sourceThingId: { type: 'string' }, sourceAttribute: { type: 'string' }, type: { type: 'string' }, valueTypeId: { type: 'string' }, required: { type: 'boolean' }, description: { type: 'string' } }, required: ['name'] } },
    facetTypes: ['actions'],
    aiDescription: 'For Actions: typed input parameters. Each can reference a Thing attribute (sourceThingId + sourceAttribute) or have a standalone type.',
    widget: 'array-object',
    label: 'Parameters',
  },
  {
    paramName: 'mutations',
    schema: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: ['create', 'modify', 'delete', 'transitionState', 'createLink', 'deleteLink'] }, thingId: { type: 'string' }, targetStateId: { type: 'string' }, predicate: { type: 'string' } }, required: ['type'] } },
    facetTypes: ['actions'],
    aiDescription: 'For Actions: structured mutation rules defining what the action creates, modifies, deletes, or transitions. Each rule specifies the target Thing and field mappings.',
    widget: 'array-object',
    label: 'Mutation Rules',
  },
  {
    paramName: 'sideEffects',
    schema: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: ['emit', 'notify', 'webhook', 'invoke'] }, eventId: { type: 'string' }, channel: { type: 'string' }, actionId: { type: 'string' } }, required: ['type'] } },
    facetTypes: ['actions'],
    aiDescription: 'For Actions: side effects fired after mutations complete. Emit events, send notifications, call webhooks, or invoke other actions.',
    widget: 'array-object',
    label: 'Side Effects',
  },
  {
    paramName: 'authorization',
    schema: { type: 'object', properties: { mode: { type: 'string', enum: ['performers-only', 'any-authenticated', 'custom'] }, customCondition: { type: 'string' } }, required: ['mode'] },
    facetTypes: ['actions'],
    aiDescription: 'For Actions: authorization mode. "performers-only" restricts to linked Personas, "any-authenticated" allows all, "custom" uses a plain-language condition.',
    widget: 'object',
    label: 'Authorization',
  },

  // ── Workflow fields ─────────────────────────────────────────────────────────

  {
    paramName: 'triggerType',
    schema: { type: 'string', enum: ['manual', 'event', 'action', 'schedule'] },
    facetTypes: ['workflows'],
    aiDescription: 'For Workflows: what triggers this workflow (default: manual)',
    widget: 'hidden',
    label: 'Trigger Type',
  },
  {
    paramName: 'triggerRefId',
    schema: { type: 'string' },
    facetTypes: ['workflows'],
    aiDescription: 'For Workflows: ID of triggering Action (action trigger) or Event (event trigger)',
    widget: 'hidden',
  },
  {
    paramName: 'triggerDescription',
    schema: { type: 'string' },
    facetTypes: ['workflows'],
    aiDescription: 'For Workflows: human-readable trigger description, e.g. "When a new order arrives"',
    widget: 'hidden',
  },
  {
    paramName: 'steps',
    schema: {
      type: 'array',
      description: 'For Workflows: the steps in this workflow. Always provide steps when creating a workflow.',
      items: STEP_SCHEMA,
    },
    facetTypes: ['workflows'],
    aiDescription: 'For Workflows: the steps in this workflow. Always provide steps when creating a workflow.',
    defaultValue: [],
    widget: 'array-object',
    label: 'Steps',
  },
  {
    paramName: 'triggerStepId',
    schema: { type: 'string' },
    facetTypes: ['workflows'],
    aiDescription: 'For Workflows: ID of the first step connected from the trigger node',
    widget: 'hidden',
  },

  // ── Interface fields ────────────────────────────────────────────────────────

  {
    paramName: 'interfaceKind',
    fieldName: 'kind',
    schema: { type: 'string', enum: ['application', 'page', 'layout', 'component', 'form', 'dashboard', 'design-tokens', 'api', 'endpoint', 'webhook', 'notification', 'report'] },
    facetTypes: ['interfaces'],
    aiDescription: 'Kind of Interface - determines available fields. Presentation: application (app shell), page (route), layout (template), component (building block), form (data entry), dashboard (metrics), design-tokens (design system). Integration: api (endpoint collection), endpoint (HTTP route), webhook (inbound), notification (outbound channel), report (generated doc)',
    defaultValue: 'page',
    widget: 'select',
    label: 'Kind',
  },
  {
    paramName: 'route',
    schema: { type: 'string' },
    facetTypes: ['interfaces'],
    forKinds: ['page'],
    aiDescription: 'For page Interfaces: route pattern, e.g. "/orders/:id"',
    widget: 'text',
    label: 'Route',
  },
  {
    paramName: 'regions',
    schema: { type: 'array', items: { type: 'string' } },
    facetTypes: ['interfaces'],
    forKinds: ['layout'],
    aiDescription: 'For layout Interfaces: named slots, e.g. ["header", "sidebar", "content", "footer"]',
    widget: 'array-string',
    label: 'Regions',
  },
  {
    paramName: 'props',
    schema: { type: 'array', items: SCHEMA_FIELD_SCHEMA },
    facetTypes: ['interfaces'],
    forKinds: ['component'],
    aiDescription: 'For component Interfaces: input properties (schema-by-reference)',
    widget: 'array-object',
    label: 'Props',
  },
  {
    paramName: 'slots',
    schema: { type: 'array', items: { type: 'string' } },
    facetTypes: ['interfaces'],
    forKinds: ['component'],
    aiDescription: 'For component Interfaces: named composition slots',
    widget: 'array-string',
    label: 'Slots',
  },
  {
    paramName: 'interfaceEmits',
    fieldName: 'emits',
    schema: { type: 'array', items: { type: 'string' } },
    facetTypes: ['interfaces'],
    forKinds: ['component'],
    aiDescription: 'For component Interfaces: event names emitted',
    widget: 'array-string',
    label: 'Emits',
  },
  {
    paramName: 'sourceThingId',
    schema: { type: 'string' },
    facetTypes: ['interfaces'],
    forKinds: ['form'],
    aiDescription: 'For form Interfaces: ID of the Thing whose attributes derive form fields',
    widget: 'text',
    label: 'Source Thing ID',
  },
  {
    paramName: 'basePath',
    schema: { type: 'string' },
    facetTypes: ['interfaces'],
    forKinds: ['api'],
    aiDescription: 'For api Interfaces: base URL path, e.g. "/api/v1"',
    widget: 'text',
    label: 'Base Path',
  },
  {
    paramName: 'auth',
    schema: { type: 'string', enum: ['none', 'api-key', 'bearer', 'oauth'] },
    facetTypes: ['interfaces'],
    forKinds: ['api', 'endpoint'],
    aiDescription: 'For api/endpoint Interfaces: authentication method',
    widget: 'select',
    label: 'Auth',
  },
  {
    paramName: 'httpMethod',
    schema: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
    facetTypes: ['interfaces'],
    forKinds: ['endpoint'],
    aiDescription: 'For endpoint Interfaces: HTTP method',
    widget: 'select',
    label: 'HTTP Method',
  },
  {
    paramName: 'path',
    schema: { type: 'string' },
    facetTypes: ['interfaces'],
    forKinds: ['endpoint'],
    aiDescription: 'For endpoint Interfaces: URL path, e.g. "/api/v1/orders/:id"',
    widget: 'endpoint-path',
    label: 'Path',
  },
  {
    paramName: 'requestSchema',
    schema: { type: 'array', items: SCHEMA_FIELD_SCHEMA },
    facetTypes: ['interfaces'],
    forKinds: ['endpoint', 'webhook'],
    aiDescription: 'For endpoint/webhook Interfaces: request body schema fields (schema-by-reference)',
    widget: 'array-object',
    label: 'Request Schema',
  },
  {
    paramName: 'responseSchema',
    schema: { type: 'array', items: SCHEMA_FIELD_SCHEMA },
    facetTypes: ['interfaces'],
    forKinds: ['endpoint'],
    aiDescription: 'For endpoint Interfaces: response body schema fields (schema-by-reference)',
    widget: 'array-object',
    label: 'Response Schema',
  },
  {
    paramName: 'channel',
    schema: { type: 'string', enum: ['email', 'sms', 'push', 'in-app'] },
    facetTypes: ['interfaces'],
    forKinds: ['notification'],
    aiDescription: 'For notification Interfaces: delivery channel',
    widget: 'select',
    label: 'Channel',
  },
  {
    paramName: 'template',
    schema: { type: 'string' },
    facetTypes: ['interfaces'],
    forKinds: ['notification'],
    aiDescription: 'For notification Interfaces: template content or reference',
    widget: 'textarea',
    label: 'Template',
  },
  {
    paramName: 'format',
    schema: { type: 'string', enum: ['pdf', 'csv', 'html', 'excel'] },
    facetTypes: ['interfaces'],
    forKinds: ['report'],
    aiDescription: 'For report Interfaces: output format',
    widget: 'select',
    label: 'Format',
  },

  // ── Event fields ────────────────────────────────────────────────────────────

  {
    paramName: 'eventType',
    schema: { type: 'string', enum: ['event', 'delta'] },
    facetTypes: ['events'],
    aiDescription: 'Type for Events: "event" for domain events, "delta" for state changes',
    defaultValue: 'event',
    widget: 'select',
    label: 'Event Type',
  },
  {
    paramName: 'payload',
    schema: {
      type: 'array',
      description: 'For Events: payload schema fields. Each can reference a Thing attribute (sourceThingId + sourceAttributeName) or be standalone (type).',
      items: SCHEMA_FIELD_SCHEMA,
    },
    facetTypes: ['events'],
    aiDescription: 'For Events: payload schema fields. Each can reference a Thing attribute (sourceThingId + sourceAttributeName) or be standalone (type).',
    widget: 'array-object',
    label: 'Payload',
  },

  // ── Measure fields ──────────────────────────────────────────────────────────

  {
    paramName: 'measureType',
    schema: { type: 'string', enum: ['metric', 'aggregator', 'financial'] },
    facetTypes: ['measures'],
    aiDescription: 'Type for Measures: "metric" for KPIs, "aggregator" for rolled-up totals, "financial" for revenue, cost, margin, or other monetary measures',
    defaultValue: 'metric',
    widget: 'select',
    label: 'Measure Type',
  },
  {
    paramName: 'unit',
    schema: { type: 'string' },
    facetTypes: ['measures'],
    aiDescription: 'Unit for Measures (e.g. "USD", "ms", "%")',
    defaultValue: '',
    widget: 'text',
    label: 'Unit',
  },
  {
    paramName: 'target',
    schema: TARGET_SCHEMA,
    facetTypes: ['measures'],
    aiDescription: 'For Measures: target range',
    widget: 'object',
    label: 'Target',
  },

  // ── Function fields ────────────────────────

  {
    paramName: 'signature',
    schema: {
      type: 'object',
      description: 'Function signature: typed parameters and return type',
      properties: {
        parameters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              sourceThingId: { type: 'string', description: 'Derive type from a Thing attribute' },
              sourceAttribute: { type: 'string' },
              type: { type: 'string', enum: ATTRIBUTE_TYPE_ENUM, description: 'Standalone datatype' },
              required: { type: 'boolean' },
              cardinality: { type: 'string', enum: ['scalar', 'array'] },
              description: { type: 'string' },
            },
            required: ['name', 'required', 'cardinality'],
          },
        },
        returns: {
          type: 'object',
          properties: {
            sourceThingId: { type: 'string', description: 'Returns a Thing instance' },
            type: { type: 'string', enum: ATTRIBUTE_TYPE_ENUM, description: 'Standalone datatype' },
            cardinality: { type: 'string', enum: ['scalar', 'array'] },
            description: { type: 'string' },
          },
          required: ['cardinality'],
        },
      },
      required: ['parameters', 'returns'],
    },
    facetTypes: ['functions'],
    aiDescription: 'Typed inputs and output for the Function. Each parameter has a name, a type (either a standalone datatype or sourceThingId/sourceAttribute), required flag, and cardinality (scalar or array). Returns has cardinality and either sourceThingId or type.',
    widget: 'object',
    label: 'Signature',
  },
  {
    paramName: 'body',
    schema: {
      type: 'object',
      description: 'Function body - JSONata expression or TypeScript source',
      properties: {
        kind: { type: 'string', enum: ['expression', 'typescript'], description: '"expression" for JSONata, "typescript" for TS function source' },
        source: { type: 'string', description: 'The expression or function body source' },
        dependencies: { type: 'array', items: { type: 'string' }, description: 'IDs of other Functions this body invokes' },
      },
      required: ['kind', 'source'],
    },
    facetTypes: ['functions'],
    aiDescription: 'The Function implementation. kind="expression" for a JSONata expression like "$.amount * 0.1", kind="typescript" for a function body. dependencies lists Function IDs this body calls.',
    widget: 'object',
    label: 'Body',
  },
  {
    paramName: 'functionStereotype',
    fieldName: 'stereotype',
    schema: { type: 'string', enum: ['formatter', 'calculator', 'predicate', 'transformer', 'lookup', 'validator'] },
    facetTypes: ['functions'],
    aiDescription: 'Function stereotype: "formatter" (stringifies for display), "calculator" (derives numbers), "predicate" (returns boolean), "transformer" (maps shape), "lookup" (resolves references), "validator" (validation result)',
    widget: 'select',
    label: 'Stereotype',
  },
  {
    paramName: 'purity',
    schema: { type: 'string', enum: ['pure'] },
    facetTypes: ['functions'],
    aiDescription: 'Always "pure" - Functions are read-only with no side effects. Enforced at runtime.',
    defaultValue: 'pure',
    widget: 'select',
    label: 'Purity',
  },
  {
    paramName: 'cacheable',
    schema: { type: 'boolean' },
    facetTypes: ['functions'],
    aiDescription: 'Whether the runtime may memoize this Function. Pure functions over stable inputs are typically cacheable.',
    defaultValue: false,
    widget: 'select',
    label: 'Cacheable',
  },
  {
    paramName: 'visibility',
    schema: { type: 'string', enum: ['public', 'internal'] },
    facetTypes: ['functions'],
    aiDescription: '"public" - callable from generated apps and APIs. "internal" - only callable from other ontology elements (other Functions, Pipelines, Actions, Measures, Interfaces).',
    defaultValue: 'internal',
    widget: 'select',
    label: 'Visibility',
  },

  // ── DataSource fields ──────────────────────

  {
    paramName: 'transport',
    schema: { type: 'string', enum: ['http', 'graphql', 'sql', 'file', 'object-storage', 'mcp', 'webhook-in', 'email', 'synthetic'] },
    facetTypes: ['datasources'],
    aiDescription: 'Protocol/connection kind. "http" (REST APIs like Stripe, Notion, custom), "graphql" (Shopify, GitHub v4, Hasura), "sql" (Postgres, MySQL, BigQuery), "file" (CSV/Parquet/Excel/JSON), "object-storage" (S3/R2/GCS), "mcp" (Model Context Protocol), "webhook-in" (inbound events), "email" (IMAP/SMTP), "synthetic" (simulation-mode generator).',
    widget: 'select',
    label: 'Transport',
  },
  {
    paramName: 'endpoint',
    schema: { type: 'string' },
    facetTypes: ['datasources'],
    aiDescription: 'Base URL or connection string. Example: "https://api.stripe.com/v1", "postgres://db.internal:5432/orders", "file:///data/inventory.csv".',
    defaultValue: '',
    widget: 'text',
    label: 'Endpoint',
  },
  {
    paramName: 'credentialRef',
    schema: { type: 'string' },
    facetTypes: ['datasources'],
    aiDescription: 'Key into the runtime secret store - NEVER the actual credential value. The secret is stored separately at runtime and retrieved by this reference at execution time. Example: "stripe_live_sk" or "env:STRIPE_API_KEY".',
    defaultValue: '',
    widget: 'text',
    label: 'Credential Ref',
  },
  {
    paramName: 'authType',
    schema: { type: 'string', enum: ['none', 'bearer', 'basic', 'oauth2', 'api-key', 'sasl'] },
    facetTypes: ['datasources'],
    aiDescription: 'Authentication mechanism. "none" (public endpoint), "bearer" (Bearer token header), "basic" (HTTP Basic), "oauth2" (OAuth 2.0 flow), "api-key" (custom header/query param), "sasl" (SQL/Kafka).',
    defaultValue: 'none',
    widget: 'select',
    label: 'Auth Type',
  },
  {
    paramName: 'config',
    schema: { type: 'object', description: 'Transport-specific configuration - headers, query params, TLS options, pool size, etc. Free-form JSON.' },
    facetTypes: ['datasources'],
    aiDescription: 'Free-form JSON object for transport-specific config: HTTP headers, query params, TLS options, connection pool size, etc. Never put credentials here - use credentialRef instead.',
    defaultValue: {},
    widget: 'object',
    label: 'Config',
  },
  {
    paramName: 'connectionStatus',
    schema: { type: 'string', enum: ['untested', 'connected', 'error', 'expired'] },
    facetTypes: ['datasources'],
    aiDescription: 'Last known connection state. Set by the runtime after a test-connection attempt.',
    defaultValue: 'untested',
    widget: 'select',
    label: 'Connection Status',
  },
  {
    paramName: 'dataSourceStereotype',
    fieldName: 'stereotype',
    schema: { type: 'string', enum: ['read-only', 'read-write', 'write-only', 'event-stream'] },
    facetTypes: ['datasources'],
    aiDescription: 'DataSource stereotype. "read-only" (pull only, e.g. a BI warehouse), "read-write" (bidirectional sync), "write-only" (sink, e.g. a logging endpoint), "event-stream" (push-based, e.g. webhooks).',
    widget: 'select',
    label: 'Stereotype',
  },
  {
    paramName: 'environment',
    schema: { type: 'string', enum: ['simulation', 'dev', 'staging', 'prod'] },
    facetTypes: ['datasources'],
    aiDescription: 'Runtime environment. Simulation-mode DataSources hard-block writeback to non-simulation transports - this is the structural firewall between simulated and real traffic.',
    defaultValue: 'dev',
    widget: 'select',
    label: 'Environment',
  },
  {
    paramName: 'acceptsSimulationTraffic',
    schema: { type: 'boolean' },
    facetTypes: ['datasources'],
    aiDescription: 'Opt-in flag - explicit acknowledgement that this DataSource may receive synthetic (simulation) mutations. Almost always false for production sources; only true for synthetic mirrors.',
    defaultValue: false,
    widget: 'select',
    label: 'Accepts Simulation Traffic',
  },

  // ── Pipeline fields ────────────────────────

  {
    paramName: 'mapping',
    schema: {
      type: 'object',
      description: 'Declarative source→target mapping',
      properties: {
        iterate: { type: 'string', description: 'JSONata path to the record array (e.g., "$.data"). Omit for single-record responses.' },
        identity: {
          type: 'object',
          description: 'Upsert key - field whose value identifies records across runs.',
          properties: { externalId: { type: 'string' } },
          required: ['externalId'],
        },
        fields: {
          type: 'object',
          description: 'Field mappings. Values can be a JSONata path string, or a FieldMapping object with { source, transform?, defaultValue? }.',
        },
        links: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              predicate: { type: 'string' },
              targetThingId: { type: 'string' },
              match: { type: 'string' },
            },
            required: ['predicate', 'targetThingId', 'match'],
          },
        },
        filter: { type: 'string', description: 'JSONata predicate - records evaluating to false are skipped' },
      },
      required: ['identity', 'fields'],
    },
    facetTypes: ['pipelines'],
    aiDescription: 'Declarative mapping spec: identity for upsert key, fields for source→target mapping, optional links for relationship creation, optional filter for record-level skipping.',
    widget: 'object',
    label: 'Mapping',
  },
  {
    paramName: 'strategy',
    schema: { type: 'string', enum: ['materialize', 'federate', 'hybrid'] },
    facetTypes: ['pipelines'],
    aiDescription: 'Where the data physically lives. "materialize" - pulled and stored locally (fast reads, may be stale). "federate" - proxied live at read time (always fresh, slower). "hybrid" - local cache with TTL.',
    defaultValue: 'materialize',
    widget: 'select',
    label: 'Strategy',
  },
  {
    paramName: 'pipelineDirection',
    fieldName: 'direction',
    schema: { type: 'string', enum: ['pull', 'push', 'two-way'] },
    facetTypes: ['pipelines'],
    aiDescription: 'Flow direction. "pull" (import from source), "push" (export to sink), "two-way" (bidirectional sync with writeback).',
    defaultValue: 'pull',
    widget: 'select',
    label: 'Direction',
  },
  {
    paramName: 'schedule',
    schema: {
      type: 'object',
      description: 'When this pipeline runs',
      properties: {
        kind: { type: 'string', enum: ['cron', 'on-demand', 'continuous'] },
        expression: { type: 'string', description: 'Cron expression when kind === "cron"' },
      },
      required: ['kind'],
    },
    facetTypes: ['pipelines'],
    aiDescription: 'Scheduling. { kind: "cron", expression: "0 */6 * * *" } for scheduled runs, { kind: "on-demand" } for manual, { kind: "continuous" } for stream transports.',
    widget: 'object',
    label: 'Schedule',
  },
  {
    paramName: 'rateLimit',
    schema: {
      type: 'object',
      description: 'Token-bucket rate limit',
      properties: {
        requestsPerSecond: { type: 'number' },
        burstSize: { type: 'number' },
      },
      required: ['requestsPerSecond'],
    },
    facetTypes: ['pipelines'],
    aiDescription: 'Rate limit for source API calls. { requestsPerSecond: 10, burstSize: 25 }.',
    widget: 'object',
    label: 'Rate Limit',
  },
  {
    paramName: 'pipelineStereotype',
    fieldName: 'stereotype',
    schema: { type: 'string', enum: ['import', 'export', 'sync', 'stream', 'batch'] },
    facetTypes: ['pipelines'],
    aiDescription: 'Semantic role. "import" (one-way pull), "export" (one-way push), "sync" (two-way), "stream" (continuous event flow), "batch" (large scheduled transfer).',
    widget: 'select',
    label: 'Stereotype',
  },
  {
    paramName: 'lastRunAt',
    schema: { type: 'string', description: 'ISO 8601 timestamp' },
    facetTypes: ['pipelines'],
    aiDescription: 'When this pipeline last executed. Set by the runtime.',
    widget: 'text',
    label: 'Last Run At',
  },
  {
    paramName: 'lastRunStatus',
    schema: { type: 'string', enum: ['ok', 'partial', 'failed', 'running'] },
    facetTypes: ['pipelines'],
    aiDescription: 'Status of the last execution. Set by the runtime.',
    widget: 'select',
    label: 'Last Run Status',
  },
]

// ── Link parameter mappings ───────────────────────────────────────────────────

export const LINK_PARAM_DEFS: readonly LinkParamMapping[] = [
  // Thing links
  {
    paramName: 'ownerThingId',
    predicate: 'owns',
    direction: 'incoming',
    facetTypes: ['things'],
    schema: { type: 'string' },
    aiDescription: 'For Things with role "part": the ID of the root Thing that owns this part',
    singular: true,
  },

  // Persona links
  {
    paramName: 'stewardThingIds',
    predicate: 'stewards',
    direction: 'outgoing',
    facetTypes: ['personas'],
    schema: { type: 'array', items: { type: 'string' } },
    aiDescription: 'For Personas: array of Thing or Context IDs this persona governs',
  },

  // Action links
  {
    paramName: 'performerIds',
    predicate: 'performs',
    direction: 'incoming',
    facetTypes: ['actions'],
    schema: { type: 'array', items: { type: 'string' } },
    aiDescription: 'For Actions: array of persona IDs who can perform this',
  },
  {
    paramName: 'inputThingIds',
    predicate: 'reads',
    direction: 'outgoing',
    facetTypes: ['actions'],
    schema: { type: 'array', items: { type: 'string' } },
    aiDescription: 'For Actions: array of Thing IDs consumed as input',
  },
  {
    paramName: 'outputThingIds',
    predicate: 'writes',
    direction: 'outgoing',
    facetTypes: ['actions'],
    schema: { type: 'array', items: { type: 'string' } },
    aiDescription: 'For Actions: array of Thing IDs produced as output',
  },
  {
    paramName: 'emittedEventIds',
    predicate: 'emits',
    direction: 'outgoing',
    facetTypes: ['actions'],
    schema: { type: 'array', items: { type: 'string' } },
    aiDescription: 'For command-type Actions: array of Event IDs representing domain events emitted by this command',
  },

  // Interface links
  {
    paramName: 'personaIds',
    predicate: 'uses',
    direction: 'incoming',
    facetTypes: ['interfaces'],
    schema: { type: 'array', items: { type: 'string' } },
    aiDescription: 'For Interfaces: array of Persona IDs who use this interface',
  },
  {
    paramName: 'actionIds',
    predicate: 'exposes',
    direction: 'outgoing',
    facetTypes: ['interfaces'],
    schema: { type: 'array', items: { type: 'string' } },
    aiDescription: 'For Interfaces: array of Action IDs exposed through this interface',
  },
  {
    paramName: 'displayedThingIds',
    predicate: 'displays',
    direction: 'outgoing',
    facetTypes: ['interfaces'],
    schema: { type: 'array', items: { type: 'string' } },
    aiDescription: 'For Interfaces: array of Thing IDs this interface displays',
  },

  // Port links
  {
    paramName: 'producedEntityIds',
    predicate: 'produces',
    direction: 'outgoing',
    facetTypes: ['ports'],
    schema: { type: 'array', items: { type: 'string' } },
    aiDescription: 'For produces-direction Ports: array of Thing/Event/Measure IDs that this port exports across the boundary',
  },
  {
    paramName: 'consumedEntityIds',
    predicate: 'consumes',
    direction: 'outgoing',
    facetTypes: ['ports'],
    schema: { type: 'array', items: { type: 'string' } },
    aiDescription: 'For consumes-direction Ports: array of Thing/Event/Measure IDs that this port expects from outside',
  },
  {
    paramName: 'triggeredActionIds',
    predicate: 'triggers',
    direction: 'outgoing',
    facetTypes: ['ports'],
    schema: { type: 'array', items: { type: 'string' } },
    aiDescription: 'For consumes-direction Ports: array of Action or Workflow IDs triggered when value arrives at this port (anti-corruption layer entry point)',
  },

  // Event + Measure links (shared param name)
  {
    paramName: 'audienceIds',
    predicate: 'observes',
    direction: 'incoming',
    facetTypes: ['events', 'measures'],
    schema: { type: 'array', items: { type: 'string' } },
    aiDescription: 'For Events/Measures: array of Persona IDs who monitor this',
  },

  // Measure-specific links
  {
    paramName: 'thingIds',
    predicate: 'measures',
    direction: 'outgoing',
    facetTypes: ['measures'],
    schema: { type: 'array', items: { type: 'string' } },
    aiDescription: 'For Measures: array of Thing IDs being tracked',
  },
  {
    paramName: 'sourceMeasureIds',
    predicate: 'derivedFrom',
    direction: 'outgoing',
    facetTypes: ['measures'],
    schema: { type: 'array', items: { type: 'string' } },
    aiDescription: 'For Measures: array of Measure IDs this derives from',
  },

  // Interface composition
  {
    paramName: 'composedInterfaceIds',
    predicate: 'composes',
    direction: 'outgoing',
    facetTypes: ['interfaces'],
    schema: { type: 'array', items: { type: 'string' } },
    aiDescription: 'For Interfaces: array of child Interface IDs this composes (Application→Pages, API→Endpoints, Page→Components)',
  },

  // ── Function links ─────────────────────────

  {
    paramName: 'computesThingIds',
    predicate: 'computes',
    direction: 'outgoing',
    facetTypes: ['functions'],
    schema: { type: 'array', items: { type: 'string' } },
    aiDescription: 'For Functions: array of Thing IDs whose attributes this Function computes (e.g., a calculateLTV Function computes the Customer Thing).',
  },
  {
    paramName: 'callsFunctionIds',
    predicate: 'calls',
    direction: 'outgoing',
    facetTypes: ['functions', 'actions', 'interfaces', 'measures', 'workflows'],
    schema: { type: 'array', items: { type: 'string' } },
    aiDescription: 'IDs of Functions invoked by this entity. Functions can call other Functions but the runtime forbids transitive Pipeline invocation (boundary discipline).',
  },

  // ── DataSource links ───────────────────────

  {
    paramName: 'boundPortIds',
    predicate: 'boundTo',
    direction: 'outgoing',
    facetTypes: ['datasources'],
    schema: { type: 'array', items: { type: 'string' } },
    aiDescription: 'For DataSources: array of Port IDs this DataSource binds to. The binding ties the connection to a context boundary - a Stripe DataSource bound to a "customers-in" Port marks that Port as the anti-corruption layer entry point for Stripe customer data.',
  },

  // ── Pipeline links ─────────────────────────

  {
    paramName: 'pullsFromDataSourceId',
    predicate: 'pullsFrom',
    direction: 'outgoing',
    facetTypes: ['pipelines'],
    schema: { type: 'string' },
    singular: true,
    aiDescription: 'For Pipelines: the ID of the DataSource this pipeline pulls from. Exactly one per pipeline (many-to-one cardinality). The inverse edge "feeds" is what the UI renders when walking from the DataSource side.',
  },
  {
    paramName: 'pushesToDataSourceId',
    predicate: 'pushesTo',
    direction: 'outgoing',
    facetTypes: ['pipelines'],
    schema: { type: 'string' },
    singular: true,
    aiDescription: 'For Pipelines with direction "push" or "two-way": the ID of the DataSource this pipeline writes to.',
  },
  {
    paramName: 'populatesThingIds',
    predicate: 'populates',
    direction: 'outgoing',
    facetTypes: ['pipelines'],
    schema: { type: 'array', items: { type: 'string' } },
    aiDescription: 'For Pipelines: array of Thing IDs whose instances this pipeline populates. A pipeline can populate multiple Things (e.g., Stripe pulling both Customer and Subscription into their respective Things).',
  },
]

// ── Lookup helpers ────────────────────────────────────────────────────────────

/** All field definitions for a given facet type. */
export function getFieldsForFacetType(facetType: FacetType): FacetFieldDef[] {
  return FACET_FIELD_DEFS.filter(f => f.facetTypes.includes(facetType))
}

/** All link param mappings for a given facet type. */
export function getLinkParamsForFacetType(facetType: FacetType): LinkParamMapping[] {
  return LINK_PARAM_DEFS.filter(lp => lp.facetTypes.includes(facetType))
}

/** Get all renderable fields for a facet type, ordered for form layout.
 *  Excludes hidden fields and fields gated by forKinds that don't match. */
export function getRenderableFields(facetType: FacetType, kind?: string): FacetFieldDef[] {
  return FACET_FIELD_DEFS.filter(f => {
    if (!f.facetTypes.includes(facetType)) return false
    if (f.widget === 'hidden') return false
    if (f.forKinds && kind && !f.forKinds.includes(kind)) return false
    if (f.forKinds && !kind) return false
    return true
  })
}

// ── Schema generators ─────────────────────────────────────────────────────────

/** Generate the flat JSON Schema `properties` for `add_facet` tool parameters. */
export function generateAddFacetProperties(): Record<string, FieldSchema> {
  const props: Record<string, FieldSchema> = {}

  // Add all field definitions
  for (const field of FACET_FIELD_DEFS) {
    props[field.paramName] = {
      ...field.schema,
      description: field.aiDescription,
    }
  }

  // Add all link param definitions
  for (const lp of LINK_PARAM_DEFS) {
    props[lp.paramName] = {
      ...lp.schema,
      description: lp.aiDescription,
    }
  }

  return props
}

/**
 * Generate the description string for `add_facet` tool.
 *
 * Optionally accepts a presentation-merged facet registry from the caller's
 * domain layer. When provided, the rich domain-specific `hint` strings are
 * included in the AI tool description; otherwise the function falls back to
 * the structural `singular` label, keeping the metaontology free of branding.
 */
export function generateAddFacetDescription(
  presentationRegistry?: Record<FacetType, { hint?: string }>,
): string {
  const lines: string[] = [
    'Add a facet to a Context (or the root workspace). Use facetType to pick which kind:',
  ]

  for (const ft of FACET_TYPES) {
    const meta = BASE_FACET_REGISTRY[ft]
    const hint = presentationRegistry?.[ft]?.hint
    const description = hint ? hint.split(' - ')[0] : resolveI18n(meta.singular)
    const fields = getFieldsForFacetType(ft)
    const linkParams = getLinkParamsForFacetType(ft)

    const fieldParts: string[] = []
    for (const f of fields) {
      if (f.paramName === 'tags') continue // tags is universal, mentioned separately
      const enumStr = f.schema.enum ? ` (${f.schema.enum.map(e => `"${e}"`).join('|')})` : ''
      const defaultStr = f.defaultValue !== undefined && f.defaultValue !== '' ? `, default ${JSON.stringify(f.defaultValue)}` : ''
      const kindsStr = f.forKinds ? ` [only for kind: ${f.forKinds.join('/')}]` : ''
      fieldParts.push(`${f.paramName}${enumStr}${defaultStr}${kindsStr}`)
    }

    for (const lp of linkParams) {
      fieldParts.push(`${lp.paramName} (creates ${lp.predicate} links)`)
    }

    lines.push(`- "${ft}": ${description}. Requires: name. Optional: ${fieldParts.join(', ')}, tags.`)
  }

  lines.push('Returns the new facet\'s ID.')
  return lines.join('\n')
}

/** Generate the description string for `update_facet` tool. */
export function generateUpdateFacetDescription(): string {
  const lines: string[] = [
    'Update fields on an existing facet. Pass a "changes" object with the fields to update.',
    '',
    'Valid fields per facet type:',
  ]

  for (const ft of FACET_TYPES) {
    const fields = getFieldsForFacetType(ft)
    const fieldNames = fields
      .filter(f => f.paramName !== 'tags')
      .map(f => f.fieldName ?? f.paramName)
    fieldNames.push('tags')
    lines.push(`- ${ft}: {${fieldNames.join(', ')}}`)
  }

  lines.push('')
  lines.push('For workflows, provide the full steps array (not a diff). Each step must have id, name, and transitions.')
  return lines.join('\n')
}

// ── Facet builder ─────────────────────────────────────────────────────────────

interface BuildResult {
  facet: Record<string, unknown>
  linksToCreate: Array<{ predicate: string; sourceId: string; targetId: string }>
}

/**
 * Build a facet object and link-creation list from AI tool arguments.
 * Replaces the per-type switch statement in tools.ts.
 *
 * NOTE: For workflows, the caller must run normalizeWorkflowChanges() on the
 * args BEFORE calling this function.
 */
export function buildFacetFromArgs(
  facetType: FacetType,
  args: Record<string, unknown>,
  id: string,
): BuildResult {
  const facet: Record<string, unknown> = { uri: id, name: args.name }
  const linksToCreate: BuildResult['linksToCreate'] = []

  // Apply field definitions for this facet type
  const fields = getFieldsForFacetType(facetType)
  for (const field of fields) {
    const paramValue = args[field.paramName]
    const targetField = field.fieldName ?? field.paramName

    // Workflow trigger is assembled from three flat params
    if (facetType === 'workflows' && field.paramName === 'triggerType') {
      facet.trigger = args.triggerType
        ? { type: args.triggerType, refId: args.triggerRefId, description: args.triggerDescription }
        : { type: 'manual' }
      continue
    }
    // Skip the other trigger sub-params (already handled above)
    if (field.paramName === 'triggerRefId' || field.paramName === 'triggerDescription') continue

    if (paramValue !== undefined && paramValue !== null) {
      // For arrays, only include if non-empty
      if (Array.isArray(paramValue)) {
        if (paramValue.length > 0) {
          facet[targetField] = paramValue
        } else if (field.defaultValue !== undefined) {
          facet[targetField] = field.defaultValue
        }
      } else {
        facet[targetField] = paramValue
      }
    } else if (field.defaultValue !== undefined) {
      facet[targetField] = field.defaultValue
    }
  }

  // Apply link param mappings for this facet type
  const linkParams = getLinkParamsForFacetType(facetType)
  for (const lp of linkParams) {
    const paramValue = args[lp.paramName]
    if (!paramValue) continue

    if (lp.singular) {
      // Single ID (e.g., ownerThingId)
      if (lp.direction === 'incoming') {
        linksToCreate.push({ predicate: PREDICATES[lp.predicate].id, sourceId: paramValue as string, targetId: id })
      } else {
        linksToCreate.push({ predicate: PREDICATES[lp.predicate].id, sourceId: id, targetId: paramValue as string })
      }
    } else {
      // Array of IDs
      for (const targetOrSourceId of (paramValue ?? []) as string[]) {
        if (lp.direction === 'incoming') {
          linksToCreate.push({ predicate: PREDICATES[lp.predicate].id, sourceId: targetOrSourceId, targetId: id })
        } else {
          linksToCreate.push({ predicate: PREDICATES[lp.predicate].id, sourceId: id, targetId: targetOrSourceId })
        }
      }
    }
  }

  // Workflow-specific: extract step-level link params
  if (facetType === 'workflows' && Array.isArray(facet.steps)) {
    for (const step of facet.steps as Record<string, unknown>[]) {
      if (step.actionId) {
        linksToCreate.push({ predicate: PREDICATES['step:action'].id, sourceId: step.id as string, targetId: step.actionId as string })
        delete step.actionId
      }
      if (step.performerId) {
        linksToCreate.push({ predicate: PREDICATES['step:performer'].id, sourceId: step.id as string, targetId: step.performerId as string })
        delete step.performerId
      }
      if (step.interfaceId) {
        linksToCreate.push({ predicate: PREDICATES['step:interface'].id, sourceId: step.id as string, targetId: step.interfaceId as string })
        delete step.interfaceId
      }
    }
  }

  return { facet, linksToCreate }
}

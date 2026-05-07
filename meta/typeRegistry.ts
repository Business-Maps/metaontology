// Declarative definitions of all non-facet TypeScript types in the domain model.
// The codegen script reads this registry to generate types/context.ts.
// Facet interfaces (Thing, Persona, Port, Action, Workflow, Interface, Event, Measure)
// and derived types (FacetTypeMap, FacetArrays, Facet) come from FACET_FIELD_DEFS - not here.

// ── Meta-types ──────────────────────────────────────────────────────────────

export interface TypeField {
  name: string
  type: string              // TS type as string: 'string', 'number', 'boolean', 'ThingAttribute[]', etc.
  optional?: boolean
  readonly?: boolean
  description?: string
}

export interface InterfaceDef {
  name: string
  description?: string
  extends?: string          // parent interface name
  fields: TypeField[]
}

export interface UnionDef {
  name: string
  description?: string
  variants: string[]        // each variant is a TS type literal string
}

export interface EnumDef {
  name: string
  description?: string
  type: 'string-union'      // we use string literal unions, not TS enums
  values: string[]
}

export interface TypeAliasDef {
  name: string
  type: string              // the aliased type as a string
  description?: string
}

// ── Enum / Union type definitions ───────────────────────────────────────────

export const ENUM_TYPES: readonly (EnumDef | UnionDef | TypeAliasDef)[] = [
  // ── Simple string-literal unions ──

  {
    name: 'SymbolMode',
    type: 'string-union',
    values: ['title', 'card'],
  } satisfies EnumDef,

  {
    name: 'DurationUnit',
    type: 'string-union',
    values: ['seconds', 'minutes', 'hours', 'days', 'weeks'],
  } satisfies EnumDef,

  {
    name: 'ScheduleFrequency',
    type: 'string-union',
    values: ['hourly', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
  } satisfies EnumDef,

  {
    name: 'ThingStereotype',
    type: 'string-union',
    values: ['entity', 'value-object', 'aggregate-root', 'reference-data', 'goal', 'risk', 'assumption', 'milestone'],
  } satisfies EnumDef,

  {
    name: 'PersonaStereotype',
    type: 'string-union',
    values: ['human', 'team', 'system', 'external', 'customer'],
  } satisfies EnumDef,

  {
    name: 'MeasureStereotype',
    type: 'string-union',
    values: ['metric', 'aggregator', 'financial'],
  } satisfies EnumDef,

  {
    name: 'FunctionStereotype',
    description: 'Semantic role of a Function - drives UI hints and codegen but does not change runtime behavior',
    type: 'string-union',
    values: ['formatter', 'calculator', 'predicate', 'transformer', 'lookup', 'validator'],
  } satisfies EnumDef,

  {
    name: 'FunctionPurity',
    description: 'Purity contract enforced by the runtime - Functions are always pure for now',
    type: 'string-union',
    values: ['pure'],
  } satisfies EnumDef,

  {
    name: 'FunctionVisibility',
    description: 'Whether a Function is callable from generated apps/APIs (public) or only from other ontology elements (internal)',
    type: 'string-union',
    values: ['public', 'internal'],
  } satisfies EnumDef,

  {
    name: 'FunctionBodyKind',
    description: 'Implementation kind for a Function body - JSONata expression or TypeScript function',
    type: 'string-union',
    values: ['expression', 'typescript'],
  } satisfies EnumDef,

  {
    name: 'FunctionCardinality',
    description: 'Cardinality of a Function parameter or return value',
    type: 'string-union',
    values: ['scalar', 'array'],
  } satisfies EnumDef,

  // ── DataSource enums ──────────────────────

  {
    name: 'DataSourceTransport',
    description: 'Protocol / connection kind for a DataSource - each has a hand-coded Layer 1 transport adapter',
    type: 'string-union',
    values: [
      'http',             // REST APIs (Stripe, Notion, Linear, custom)
      'graphql',          // GraphQL endpoints (Shopify, GitHub v4, Hasura)
      'sql',              // JDBC-style databases
      'file',             // Tabular files (CSV, Parquet, Excel, JSON)
      'object-storage',   // S3-compatible
      'mcp',              // Model Context Protocol
      'webhook-in',       // Inbound webhooks
      'email',            // IMAP/SMTP
      'synthetic',        // Sub-epic E: synthetic generator for simulation mode
    ],
  } satisfies EnumDef,

  {
    name: 'DataSourceAuthType',
    description: 'Authentication mechanism for a DataSource',
    type: 'string-union',
    values: ['none', 'bearer', 'basic', 'oauth2', 'api-key', 'sasl'],
  } satisfies EnumDef,

  {
    name: 'DataSourceStereotype',
    description: 'Semantic role of a DataSource',
    type: 'string-union',
    values: ['read-only', 'read-write', 'write-only', 'event-stream'],
  } satisfies EnumDef,

  {
    name: 'DataSourceConnectionStatus',
    description: 'Last known connection state for a DataSource',
    type: 'string-union',
    values: ['untested', 'connected', 'error', 'expired'],
  } satisfies EnumDef,

  {
    name: 'DataSourceEnvironment',
    description: 'Runtime environment binding - simulation mode hard-blocks writeback to non-simulation transports',
    type: 'string-union',
    values: ['simulation', 'dev', 'staging', 'prod'],
  } satisfies EnumDef,

  // ── Pipeline enums ────────────────────────

  {
    name: 'PipelineStrategy',
    description: 'Where the Pipeline data physically lives - materialize stores locally, federate proxies live, hybrid caches with TTL',
    type: 'string-union',
    values: ['materialize', 'federate', 'hybrid'],
  } satisfies EnumDef,

  {
    name: 'PipelineDirection',
    description: 'Flow direction for a Pipeline',
    type: 'string-union',
    values: ['pull', 'push', 'two-way'],
  } satisfies EnumDef,

  {
    name: 'PipelineStereotype',
    description: 'Semantic role of a Pipeline',
    type: 'string-union',
    values: ['import', 'export', 'sync', 'stream', 'batch'],
  } satisfies EnumDef,

  {
    name: 'PipelineRunStatus',
    description: 'Last known status of a Pipeline execution',
    type: 'string-union',
    values: ['ok', 'partial', 'failed', 'running'],
  } satisfies EnumDef,

  {
    name: 'PipelineSchedule',
    description: 'When a Pipeline runs - cron expression, on-demand, or continuous',
    variants: [
      "{ kind: 'cron'; expression: string }",
      "{ kind: 'on-demand' }",
      "{ kind: 'continuous' }",
    ],
  } satisfies UnionDef,

  {
    name: 'InterfaceKind',
    description: 'Structural discriminant for Interface - determines the entire field model',
    type: 'string-union',
    values: [
      'application', 'page', 'layout', 'component', 'form', 'dashboard', 'design-tokens',
      'api', 'endpoint', 'webhook', 'notification', 'report',
    ],
  } satisfies EnumDef,

  {
    name: 'AssertionScope',
    type: 'string-union',
    values: ['all', 'tagged', 'entityType'],
  } satisfies EnumDef,

  {
    name: 'ContextMapPattern',
    type: 'string-union',
    values: [
      'partnership', 'customer-supplier', 'conformist',
      'anticorruption-layer', 'open-host-service', 'published-language',
      'shared-kernel', 'separate-ways',
    ],
  } satisfies EnumDef,

  // ── Type aliases ──

  {
    name: 'FacetType',
    type: 'FacetKey',
    description: 'Alias for FacetKey - the canonical set of facet type keys',
  } satisfies TypeAliasDef,

  {
    name: 'LinkPredicate',
    type: 'StoredPredicateId',
    description: 'Alias for StoredPredicateId - the set of predicates that can be stored on a Link',
  } satisfies TypeAliasDef,

  // ── Tagged / discriminated unions ──

  {
    name: 'StorybookViewport',
    description: 'Viewport hint for an embedded Storybook story - rendered as a query param at iframe build time, never mutates the stored URL',
    type: 'string-union',
    values: ['mobile', 'tablet', 'desktop', 'fluid'],
  } satisfies EnumDef,

  {
    name: 'MediaRef',
    description: 'Media attachment - uploaded blob, external URL, or a Storybook story embedded as a live iframe',
    variants: [
      "{ kind: 'blob'; id: string; mimeType: string }",
      "{ kind: 'url'; href: string; mimeType?: string }",
      "{ kind: 'storybook'; url: string; storyId?: string; viewport?: StorybookViewport }",
    ],
  } satisfies UnionDef,

  {
    name: 'AttachmentEntry',
    type: 'MediaRef & { attachmentId: string }',
    description: 'MediaRef plus a stable attachment id. A Symbol or Interface can hold multiple attachments; annotations anchor to one of them via metadata.attachmentId so dots stay tied to the screenshot they were drawn on, even after a Storybook embed is added alongside.',
  } satisfies TypeAliasDef,

  {
    name: 'ActionCondition',
    description: 'Typed precondition/postcondition variant',
    variants: [
      "{ type: 'state'; thingId: string; stateId: string; description?: string }",
      "{ type: 'field'; thingId: string; attribute: string; operator: 'exists' | 'equals' | 'gt' | 'lt'; value?: string; description?: string }",
      "{ type: 'text'; description: string }",
    ],
  } satisfies UnionDef,

  {
    name: 'AssertionRule',
    description: 'Discriminated union of assertion rule types',
    variants: [
      "{ type: 'min-facet-count'; facetType: string; min: number }",
      "{ type: 'max-facet-count'; facetType: string; max: number }",
      "{ type: 'requires-link'; predicate: string }",
      "{ type: 'requires-tag'; tag: string }",
      "{ type: 'requires-outgoing-link'; predicate: string; min?: number }",
      "{ type: 'requires-incoming-link'; predicate: string; min?: number }",
      "{ type: 'requires-field'; field: string; facetTypes?: string[] }",
    ],
  } satisfies UnionDef,

  {
    name: 'FieldSource',
    description: 'Where a mutation field value comes from',
    variants: [
      "{ from: 'parameter'; paramName: string }",
      "{ from: 'attribute'; thingRef: string; attribute: string }",
      "{ from: 'static'; value: unknown }",
      "{ from: 'computed'; expression: string }",
      "{ from: 'currentUser' }",
      "{ from: 'currentTime' }",
    ],
  } satisfies UnionDef,
] as const

// ── Interface definitions ───────────────────────────────────────────────────

export const INTERFACE_TYPES: readonly InterfaceDef[] = [
  {
    name: 'SymbolStyle',
    fields: [
      { name: 'fontSize', type: "'sm' | 'base' | 'lg' | 'xl' | '2xl'", optional: true },
      { name: 'fontWeight', type: "'normal' | 'medium' | 'bold'", optional: true },
      { name: 'textAlign', type: "'left' | 'center' | 'right'", optional: true },
      { name: 'colorToken', type: 'string', optional: true },
    ],
  },

  {
    name: 'RichDocMark',
    description: 'Inline formatting or reference mark applied to a run of text inside a RichDocNode',
    fields: [
      { name: 'type', type: 'string', description: "Mark kind - e.g. 'bold', 'italic', 'code', 'link'" },
      { name: 'attrs', type: 'Record<string, unknown>', optional: true, description: 'Mark-type-specific attributes (e.g. href for link)' },
    ],
  },

  {
    name: 'RichDocNode',
    description: 'One node in a ProseMirror-compatible rich content tree. Block types are declared in the content block registry; all carry a stable id for cross-document references.',
    fields: [
      { name: 'type', type: 'string', description: "Block type id from the block registry (e.g. 'paragraph', 'heading', 'mention', 'todo')" },
      { name: 'id', type: 'string', optional: true, description: 'Stable block identifier - preserved across edits so external systems can link into this block' },
      { name: 'attrs', type: 'Record<string, unknown>', optional: true, description: 'Block-type-specific attributes (e.g. level for heading, checked for todo, entityUri for mention)' },
      { name: 'content', type: 'RichDocNode[]', optional: true, description: 'Nested child nodes (block or inline)' },
      { name: 'marks', type: 'RichDocMark[]', optional: true, description: 'Inline marks applied to this node (only meaningful for text nodes)' },
      { name: 'text', type: 'string', optional: true, description: 'Literal text content (only for text nodes)' },
    ],
  },

  {
    name: 'RichDoc',
    description: 'Structured rich content document - the value of Symbol.contentDoc. Walkable by the doc serializer to produce RDF triples and AI-readable structure.',
    fields: [
      { name: 'type', type: "'doc'", description: "Always 'doc' for the top-level node" },
      { name: 'content', type: 'RichDocNode[]', description: 'Ordered list of top-level blocks' },
    ],
  },

  {
    name: 'Symbol',
    description: 'Universal primitive - a URI that progressively takes shape as properties are added',
    fields: [
      { name: 'uri', type: 'string' },
      { name: 'label', type: 'string', optional: true },
      { name: 'content', type: 'string', description: 'Legacy plaintext-with-mention-tokens content; kept during migration. New writes populate contentDoc; renderer prefers contentDoc when present.' },
      { name: 'contentDoc', type: 'RichDoc', optional: true, description: 'Structured rich content (preferred). Populated by migration on first load of legacy symbols and on every subsequent edit.' },
      { name: 'mode', type: 'SymbolMode', optional: true },
      { name: 'modePinned', type: 'boolean', optional: true },
      { name: 'style', type: 'SymbolStyle', optional: true },
      { name: 'language', type: 'string', optional: true },
      { name: 'collapsed', type: 'boolean', optional: true },
      { name: 'tags', type: 'readonly string[]', optional: true },
      { name: 'attachments', type: 'readonly AttachmentEntry[]', optional: true, description: 'Ordered media attachments. A symbol may carry multiple — typically a screenshot snapshot plus a live Storybook embed of the same UI. Annotations are anchored to a specific entry by attachmentId.' },
    ],
  },

  {
    name: 'UserDefinedFieldDef',
    fields: [
      { name: 'name', type: 'string' },
      { name: 'type', type: "'string' | 'number' | 'boolean' | 'text' | 'select' | 'array-string'" },
      { name: 'label', type: 'string', optional: true },
      { name: 'description', type: 'string', optional: true },
      { name: 'required', type: 'boolean', optional: true },
      { name: 'defaultValue', type: 'unknown', optional: true },
      { name: 'enumValues', type: 'string[]', optional: true, description: "for type 'select'" },
    ],
  },

  {
    name: 'UserDefinedEntityType',
    fields: [
      { name: 'id', type: 'string', description: "unique key, e.g. 'clinical-protocol'" },
      { name: 'label', type: 'string', description: "display name, e.g. 'Clinical Protocol'" },
      { name: 'singular', type: 'string', description: "singular form, e.g. 'Clinical Protocol'" },
      { name: 'pluralKey', type: 'string', description: "key for the facets record, e.g. 'clinicalProtocols'" },
      { name: 'description', type: 'string' },
      { name: 'fields', type: 'UserDefinedFieldDef[]' },
      { name: 'color', type: 'string', description: 'hex color for canvas nodes' },
      { name: 'icon', type: 'string', optional: true, description: 'SVG icon string (optional, uses default if omitted)' },
      { name: 'tier', type: '1 | 2 | 3', description: 'progressive disclosure tier' },
    ],
  },

  {
    name: 'ThingAttribute',
    fields: [
      { name: 'name', type: 'string' },
      { name: 'type', type: 'string', description: 'Datatype id - validated against DATATYPE_REGISTRY in ontology.ts' },
      { name: 'referencedThingId', type: 'string', optional: true, description: "required when type === 'reference'" },
      { name: 'referenceType', type: "'association' | 'composition'", optional: true, description: "defaults to 'association'" },
      { name: 'enumValues', type: 'string[]', optional: true, description: "required when type === 'enum'" },
      { name: 'unit', type: 'string', optional: true, description: "for 'quantity' type (e.g., 'kg', 'ms', 'items')" },
      { name: 'currencyCode', type: 'string', optional: true, description: "for 'money' type (ISO 4217, e.g., 'USD', 'EUR')" },
      { name: 'valueTypeId', type: 'string', optional: true, description: 'Semantic type from ValueType registry' },
      { name: 'constraints', type: 'ValueConstraint[]', optional: true, description: 'Inline validation constraints' },
      { name: 'required', type: 'boolean', optional: true, description: 'Is this attribute mandatory on instances?' },
      { name: 'unique', type: 'boolean', optional: true, description: 'Must values be unique across instances?' },
      { name: 'indexed', type: 'boolean', optional: true, description: 'Should generated DB index this column?' },
      { name: 'defaultValue', type: 'unknown', optional: true, description: 'Default for form generation' },
    ],
  },

  {
    name: 'Duration',
    fields: [
      { name: 'value', type: 'number' },
      { name: 'unit', type: 'DurationUnit' },
    ],
  },

  {
    name: 'Schedule',
    fields: [
      { name: 'frequency', type: 'ScheduleFrequency' },
      { name: 'interval', type: 'number', optional: true, description: '"every 2 weeks" = { frequency: \'weekly\', interval: 2 }' },
      { name: 'description', type: 'string', optional: true, description: 'human-readable override' },
    ],
  },

  {
    name: 'WorkflowSla',
    fields: [
      { name: 'maxDuration', type: 'Duration' },
      { name: 'escalation', type: 'string', optional: true, description: '"notify operations manager"' },
    ],
  },

  {
    name: 'ThingStateTransition',
    fields: [
      { name: 'id', type: 'string' },
      { name: 'targetStateId', type: 'string', description: 'which state this leads to' },
      { name: 'label', type: 'string', optional: true, description: '"payment clears", "manager approves"' },
      { name: 'guard', type: 'string', optional: true, description: 'business-language condition' },
      { name: 'triggerActionId', type: 'string', optional: true, description: 'Action that causes this transition' },
      { name: 'triggerEventId', type: 'string', optional: true, description: 'Event that causes this transition' },
    ],
  },

  {
    name: 'ThingState',
    fields: [
      { name: 'id', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string', optional: true },
      { name: 'initial', type: 'boolean', optional: true, description: 'true for the starting state' },
      { name: 'terminal', type: 'boolean', optional: true, description: 'true for end states' },
      { name: 'transitions', type: 'ThingStateTransition[]', optional: true },
    ],
  },

  {
    name: 'WorkflowTrigger',
    fields: [
      { name: 'type', type: "'manual' | 'event' | 'action' | 'schedule'" },
      { name: 'refId', type: 'string', optional: true, description: "ID of the triggering Action (type 'action') or Event (type 'event')" },
      { name: 'description', type: 'string', optional: true, description: 'Human language: "When a new order arrives"' },
      { name: 'schedule', type: 'Schedule', optional: true, description: 'For schedule triggers: recurrence pattern' },
    ],
  },

  {
    name: 'WorkflowTransition',
    fields: [
      { name: 'id', type: 'string' },
      { name: 'targetStepId', type: 'string' },
      { name: 'label', type: 'string', description: '"approved", "payment failed", "timeout"' },
      { name: 'guard', type: 'string', optional: true, description: 'Business-language condition: "order.total > 500"' },
    ],
  },

  {
    name: 'WorkflowStepFacetRef',
    description: 'Pointer from a WorkflowStep to a first-class facet (symbol, action, event, interface, etc.) that represents the step on canvas',
    fields: [
      { name: 'facetType', type: 'string', description: "Facet registry key: 'actions' | 'events' | 'interfaces' | 'things' | 'personas' | 'symbols' | ..." },
      { name: 'facetUri', type: 'string', description: 'URI of the target facet instance' },
      { name: 'contextUri', type: 'string', optional: true, description: 'Which context the facet lives in (omit for root)' },
    ],
  },

  {
    name: 'WorkflowStep',
    fields: [
      { name: 'id', type: 'string' },
      { name: 'name', type: 'string', optional: true },
      { name: 'description', type: 'string', optional: true },
      { name: 'transitions', type: 'WorkflowTransition[]', optional: true },
      { name: 'sla', type: 'WorkflowSla', optional: true },
      { name: 'expectedDuration', type: 'Duration', optional: true },
      { name: 'facetRef', type: 'WorkflowStepFacetRef', optional: true, description: 'Link to the canvas entity representing this step. When set, the journey overlay draws the arrow through the referenced entity instead of a placeholder.' },
    ],
  },

  {
    name: 'SchemaField',
    description: 'Schema-by-reference field - references Thing attributes without duplicating definitions',
    fields: [
      { name: 'name', type: 'string' },
      { name: 'sourceThingId', type: 'string', optional: true, description: 'reference to the Thing this derives from' },
      { name: 'sourceAttributeName', type: 'string', optional: true, description: 'specific attribute from that Thing' },
      { name: 'type', type: 'string', optional: true, description: 'standalone type - datatype id from DATATYPE_REGISTRY' },
      { name: 'description', type: 'string', optional: true },
    ],
  },

  // ── Function composite types ──────────────

  {
    name: 'FunctionParameter',
    description: 'A typed input parameter for a Function',
    fields: [
      { name: 'name', type: 'string' },
      { name: 'sourceThingId', type: 'string', optional: true, description: 'Derive type from Thing attribute' },
      { name: 'sourceAttribute', type: 'string', optional: true },
      { name: 'type', type: 'string', optional: true, description: 'Standalone datatype id from DATATYPE_REGISTRY' },
      { name: 'required', type: 'boolean' },
      { name: 'cardinality', type: 'FunctionCardinality' },
      { name: 'description', type: 'string', optional: true },
    ],
  },

  {
    name: 'FunctionReturnType',
    description: 'A typed return value for a Function',
    fields: [
      { name: 'sourceThingId', type: 'string', optional: true, description: 'Returns a Thing instance' },
      { name: 'type', type: 'string', optional: true, description: 'Standalone datatype id from DATATYPE_REGISTRY' },
      { name: 'cardinality', type: 'FunctionCardinality' },
      { name: 'description', type: 'string', optional: true },
    ],
  },

  {
    name: 'FunctionSignature',
    description: 'A Function signature: typed inputs + typed output',
    fields: [
      { name: 'parameters', type: 'FunctionParameter[]' },
      { name: 'returns', type: 'FunctionReturnType' },
    ],
  },

  {
    name: 'FunctionBody',
    description: 'A Function body: JSONata expression or TypeScript source',
    fields: [
      { name: 'kind', type: 'FunctionBodyKind' },
      { name: 'source', type: 'string', description: 'JSONata expression or TS function body' },
      { name: 'dependencies', type: 'string[]', optional: true, description: 'IDs of other Functions this body invokes' },
    ],
  },

  // ── Pipeline composite types ──────────────

  {
    name: 'FieldMapping',
    description: 'Declarative mapping from a source field to a target field - optionally transformed via a Function',
    fields: [
      { name: 'source', type: 'string', description: 'JSONata path or field name in the source record' },
      { name: 'transform', type: 'string', optional: true, description: 'Function ID to apply to the source value (e.g., "formatPhoneNumber")' },
      { name: 'defaultValue', type: 'unknown', optional: true, description: 'Value to use when the source field is absent' },
    ],
  },

  {
    name: 'LinkMapping',
    description: 'Declarative mapping that creates a link on the target entity when ingesting',
    fields: [
      { name: 'predicate', type: 'string', description: 'Ontology predicate to create (e.g., "hasSubscription")' },
      { name: 'targetThingId', type: 'string', description: 'Thing type the link resolves to' },
      { name: 'match', type: 'string', description: 'JSONata expression resolving the target instance by externalId' },
    ],
  },

  {
    name: 'PipelineMapping',
    description: 'Full declarative mapping spec for a Pipeline - iterate, identity, fields, links, filter',
    fields: [
      { name: 'iterate', type: 'string', optional: true, description: 'JSONata path to the record array in the source response (e.g., "$.data")' },
      { name: 'identity', type: '{ externalId: string }', description: 'JSONata path (or field name) whose value is the upsert key' },
      { name: 'fields', type: 'Record<string, string | FieldMapping>', description: 'Map from target field name → source path or FieldMapping object' },
      { name: 'links', type: 'LinkMapping[]', optional: true },
      { name: 'filter', type: 'string', optional: true, description: 'JSONata predicate - records that evaluate to false are skipped' },
    ],
  },

  {
    name: 'RateLimitConfig',
    description: 'Token-bucket rate limit for a Pipeline',
    fields: [
      { name: 'requestsPerSecond', type: 'number' },
      { name: 'burstSize', type: 'number', optional: true },
    ],
  },

  {
    name: 'MeasureTarget',
    fields: [
      { name: 'min', type: 'number', optional: true },
      { name: 'max', type: 'number', optional: true },
      { name: 'direction', type: "'higher-is-better' | 'lower-is-better' | 'range'" },
    ],
  },

  {
    name: 'AssertionSelector',
    fields: [
      { name: 'scope', type: 'AssertionScope' },
      { name: 'tags', type: 'string[]', optional: true, description: "when scope === 'tagged'" },
      { name: 'entityTypes', type: 'string[]', optional: true, description: "facet type keys when scope === 'entityType'" },
    ],
  },

  {
    name: 'Assertion',
    fields: [
      { name: 'id', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string', optional: true },
      { name: 'selector', type: 'AssertionSelector' },
      { name: 'rule', type: 'AssertionRule' },
      { name: 'severity', type: "'error' | 'warning' | 'info'" },
      { name: 'enabled', type: 'boolean' },
      { name: 'origin', type: "'ontology' | 'user'", optional: true },
    ],
  },

  {
    name: 'AssertionViolation',
    fields: [
      { name: 'assertionId', type: 'string' },
      { name: 'assertionName', type: 'string' },
      { name: 'entityId', type: 'string' },
      { name: 'entityName', type: 'string' },
      { name: 'entityType', type: 'string', optional: true },
      { name: 'message', type: 'string' },
      { name: 'severity', type: "'error' | 'warning' | 'info'" },
    ],
  },

  {
    name: 'Link',
    fields: [
      { name: 'uri', type: 'string' },
      { name: 'predicate', type: 'LinkPredicate' },
      { name: 'sourceUri', type: 'string' },
      { name: 'targetUri', type: 'string' },
      { name: 'label', type: 'string', optional: true },
      { name: 'description', type: 'string', optional: true },
      { name: 'pattern', type: 'ContextMapPattern', optional: true, description: 'Only meaningful for valueStream predicate' },
      { name: 'metadata', type: 'Record<string, unknown>', optional: true },
    ],
  },

  {
    name: 'SubtreeFacet',
    fields: [
      { name: 'item', type: 'Facet' },
      { name: 'sourceContextUri', type: 'string' },
      { name: 'sourceContextName', type: 'string' },
      { name: 'isOwn', type: 'boolean' },
    ],
  },

  // ── ValueType types ──────────────────────────────────────────────────────

  // ValueConstraint and ValueTypeDef are defined in meta/valueTypes.ts (M2 concepts).
  // They are re-exported in the generated context.ts via codegen, not generated here.

  // ── Action Rule types ────────────────────────────────────────────────────

  {
    name: 'ActionParameter',
    description: 'Typed input parameter for an Action',
    fields: [
      { name: 'name', type: 'string' },
      { name: 'sourceThingId', type: 'string', optional: true, description: 'Derive type from Thing attribute' },
      { name: 'sourceAttribute', type: 'string', optional: true },
      { name: 'type', type: 'string', optional: true, description: 'Standalone datatype when not referencing a Thing' },
      { name: 'valueTypeId', type: 'string', optional: true, description: 'Semantic type with constraints' },
      { name: 'required', type: 'boolean', optional: true },
      { name: 'defaultValue', type: 'unknown', optional: true },
      { name: 'description', type: 'string', optional: true },
    ],
  },
  {
    name: 'MutationRule',
    description: 'Declarative mutation specification for an Action',
    fields: [
      { name: 'type', type: "'create' | 'modify' | 'delete' | 'transitionState' | 'createLink' | 'deleteLink'" },
      { name: 'thingId', type: 'string', optional: true, description: 'Target Thing type for create/modify/delete' },
      { name: 'fieldMappings', type: 'Record<string, FieldSource>', optional: true },
      { name: 'targetStateId', type: 'string', optional: true, description: 'For transitionState' },
      { name: 'predicate', type: 'string', optional: true, description: 'For createLink/deleteLink' },
      { name: 'sourceRef', type: 'string', optional: true },
      { name: 'targetRef', type: 'string', optional: true },
    ],
  },
  {
    name: 'SideEffectRule',
    description: 'Side effect triggered after Action mutations complete',
    fields: [
      { name: 'type', type: "'emit' | 'notify' | 'webhook' | 'invoke'" },
      { name: 'eventId', type: 'string', optional: true, description: 'For emit: which Event to publish' },
      { name: 'payloadMappings', type: 'Record<string, FieldSource>', optional: true },
      { name: 'channel', type: 'string', optional: true, description: 'For notify: email/sms/push' },
      { name: 'recipientRef', type: 'string', optional: true },
      { name: 'template', type: 'string', optional: true },
      { name: 'url', type: 'string', optional: true, description: 'For webhook' },
      { name: 'method', type: 'string', optional: true },
      { name: 'bodyMappings', type: 'Record<string, FieldSource>', optional: true },
      { name: 'actionId', type: 'string', optional: true, description: 'For invoke: call another action' },
      { name: 'inputMappings', type: 'Record<string, FieldSource>', optional: true },
    ],
  },
  {
    name: 'ActionAuthorization',
    description: 'Authorization configuration for an Action',
    fields: [
      { name: 'mode', type: "'performers-only' | 'any-authenticated' | 'custom'" },
      { name: 'customCondition', type: 'string', optional: true, description: 'Plain-language for AI generation' },
    ],
  },
] as const

// ── Container interface definitions ─────────────────────────────────────────

export const CONTAINER_TYPES: readonly InterfaceDef[] = [
  {
    name: 'FacetContainer',
    description: 'Shared shape for any context-like node that holds facets',
    fields: [
      { name: 'uri', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'facets', type: 'FacetArrays' },
      { name: 'customFacets', type: 'Record<string, Facet[]>', optional: true, description: 'Storage for user-defined entity type instances. Keyed by UserDefinedEntityType.pluralKey.' },
      { name: 'symbols', type: 'Symbol[]' },
    ],
  },

  {
    name: 'RootContext',
    extends: 'FacetContainer',
    fields: [
      { name: 'contexts', type: 'Record<string, Context>' },
      { name: 'links', type: 'Link[]' },
      { name: 'assertions', type: 'Assertion[]', optional: true },
      { name: 'customTypes', type: 'UserDefinedEntityType[]', optional: true },
      { name: 'valueTypes', type: 'ValueTypeDef[]', optional: true },
      { name: 'meta', type: '{ createdAt: string; updatedAt: string }' },
      { name: 'tags', type: 'string[]', optional: true },
      { name: 'aiInstructions', type: 'string', optional: true },
      { name: 'schemaVersion', type: 'number', optional: true, description: 'Client schema migration version - absent means pre-migration (version 0)' },
    ],
  },

  {
    name: 'Context',
    extends: 'FacetContainer',
    fields: [
      { name: 'parentUri', type: 'string' },
      { name: 'domainType', type: "'core' | 'supporting' | 'generic'", optional: true },
      { name: 'metadata', type: 'Record<string, unknown>', optional: true },
      { name: 'tags', type: 'string[]', optional: true },
      { name: 'aiInstructions', type: 'string', optional: true },
    ],
  },
] as const

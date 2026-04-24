# Business Maps Metaontology Specification

## Scope

This document specifies the data model, behavioral contracts, and interoperability requirements of the `@businessmaps/metaontology` package.

A conforming implementation in another language must be able to:
- read and write the same `RootContext` JSON without data loss
- validate the same entity and link rules
- apply the same command stream and derive the same state
- project the same model to RDF triples
- execute the same query algebra
- run the same pipeline mapping contract over external data

This spec does not cover UI, canvas layout, persistence backends, or any presentation-layer behavior.

## Conceptual Model

The framework uses a three-level model inspired by MOF (Meta-Object Facility):

**M2 (metaontology)** defines the vocabulary: entity classes (Thing, Persona, Action, ...), predicates (performs, owns, triggers, ...), datatypes (text, decimal, date, ...), and validation rules. M2 is shared across all domains. It lives in the `meta/`, `core/`, and `dsl/` directories.

**M1 (domain model)** is the user's business model stored as a `RootContext`. It contains concrete entities (an Order, a Customer), relationships (Customer owns Order), and assertions (every Action should have a performer). M1 is specific to one business. The engine (`engine/`) operates purely on M1 data.

**M0 (runtime instances)** contains live data derived from M1 types. A specific order placed by a specific customer at 14:32 on Tuesday. M0 state is materialized through the runtime layer (`runtime/`) and stored in `M0State`, which is separate from `RootContext`.

The separation matters because M2 changes rarely (new predicate definitions, new entity classes), M1 changes during modeling sessions (adding Things, drawing links), and M0 changes during operation (new customer records arriving from Stripe). Each layer has its own mutation contract, its own persistence strategy, and its own merge semantics.

## Canonical Document Shape

### RootContext

`RootContext` is the canonical persisted model document. It is a plain JSON object.

Required fields:
- `uri: string` - stable identifier for this model
- `name: string`
- `description: string`
- `facets: FacetArrays` - typed entity arrays (see Built-In Facet Types)
- `contexts: Record<string, Context>` - sub-contexts keyed by URI
- `links: Link[]` - persisted relationships
- `symbols: Symbol[]` - untyped freeform items
- `meta.createdAt: string` - ISO 8601 timestamp
- `meta.updatedAt: string` - ISO 8601 timestamp

Optional fields:
- `assertions: Assertion[]` - model quality rules
- `customTypes: UserDefinedEntityType[]` - user-defined entity type declarations
- `valueTypes: ValueTypeDef[]` - custom semantic value types
- `tags: string[]` - cross-cutting classification labels
- `aiInstructions: string` - guidance for LLM-based tooling
- `schemaVersion: number` - migration version marker

Design rationale: `contexts` is a flat map (not a nested tree) because flat maps allow O(1) lookup by URI and simplify merge. The tree structure is expressed through `parentUri` on each context. Links are stored at the root level (not nested inside contexts) so that cross-context relationships don't break when contexts are moved or deleted.

### Context

`Context` is a nested bounded context inside `RootContext.contexts`.

Required fields:
- `uri: string`
- `name: string`
- `description: string`
- `parentUri: string` - must point to the root's URI or another context's URI
- `facets: FacetArrays`
- `symbols: Symbol[]`

Optional fields:
- `domainType: 'core' | 'supporting' | 'generic'` - DDD classification
- `metadata: Record<string, unknown>`
- `tags: string[]`
- `aiInstructions: string`

### FacetContainer

Both `RootContext` and `Context` implement the `FacetContainer` contract:
- `uri`
- `name`
- `description`
- `facets: FacetArrays`
- `customFacets?: Record<string, Facet[]>`
- `symbols: Symbol[]`

This shared contract means the engine can operate on any container uniformly, whether it's the root or a nested context.

## Built-In Facet Types

The built-in facet keys are:
- `things`, `personas`, `ports`, `actions`, `workflows`, `interfaces`, `events`, `measures`, `functions`, `datasources`, `pipelines`

Every facet instance must carry at minimum:
- `uri: string`
- `name: string`

Additional required fields by type:

| Facet type | Required fields beyond `uri` and `name` |
|---|---|
| `things` | `definition`, `attributes` |
| `personas` | `description`, `role`, `personaType` |
| `ports` | `description`, `direction` |
| `actions` | `description`, `type` |
| `workflows` | `description`, `steps` |
| `interfaces` | `description`, `kind` |
| `events` | `description`, `eventType` |
| `measures` | `description`, `measureType` |
| `functions` | `purity`, `cacheable`, `visibility` |
| `datasources` | `endpoint`, `credentialRef`, `authType`, `config`, `connectionStatus`, `environment` |
| `pipelines` | `strategy`, `direction` |

## Symbols

`Symbol` is an untyped freeform item for early-stage modeling. Symbols can be "classified" (promoted) into typed facets via the `symbol:classify` command.

Required fields:
- `uri: string`
- `content: string`

Optional fields: `label`, `mode`, `modePinned`, `style`, `language`, `collapsed`, `tags`, `attachment`

## Links

`Link` is the only persisted relationship record at the M1 level.

Required fields:
- `uri: string`
- `predicate: LinkPredicate` - must be a valid predicate ID from the registry
- `sourceUri: string`
- `targetUri: string`

Optional fields: `label`, `description`, `pattern`, `metadata`

`sourceUri` and `targetUri` may reference any entity: the root context, a sub-context, a facet, or a symbol.

Design rationale: links are stored as a flat array at the root level rather than nested inside entities. This avoids the fan-out problem (entity A links to entities in 5 different contexts) and makes cross-context relationships first-class citizens rather than special cases.

## Entity Classes and Predicate Registry

### Entity classes

The entity class registry is defined in [ontology.ts](./meta/ontology.ts).

Built-in entity classes: `Context`, `Thing`, `Persona`, `Action`, `Workflow`, `Interface`, `Event`, `Measure`, `Port`, `Function`, `DataSource`, `Pipeline`, `Symbol`, `WorkflowStep`, `ThingState`

The `facetKey` on each entity class determines which facet array stores instances of that class.

### Predicates

The predicate registry is the source of truth for link validation.

Each predicate definition contains:
- `id` - unique string identifier
- `uri` - persistent namespace URI
- `labels` / `inverseLabels` - i18n display names
- `domain[]` - entity classes valid as source
- `range[]` - entity classes valid as target
- `cardinality` - relationship multiplicity
- `tier` - framework, domain, or custom

Optional: `businessLabels`, `businessInverseLabels`, `structural`, `symmetric`, `defaultAssertions`, `alternatives`

**Validation rules:**
- `link:add` must reject links where `sourceUri` resolves to an entity class outside the predicate's `domain`
- `link:add` must reject links where `targetUri` resolves to an entity class outside the predicate's `range`
- Symbols are intentionally permissive during early modeling and may bypass strict domain/range validation

Structural predicates (e.g., `childOf`, `memberOf`) are not stored in `RootContext.links`. They only appear in triple projection as derived triples.

## Root JSON Semantics

### Identity
- `uri` is the stable identifier for every entity
- `contexts` is keyed by context `uri`
- Links are flat, not nested

### Tree semantics
- The root is implicit, identified by `RootContext.uri`
- Every `Context.parentUri` must point to either the root `uri` or another context `uri`

### Custom types
- `customTypes` declares user-defined entity types
- Instances of user-defined types are stored in `customFacets[pluralKey]`
- A conforming implementation must preserve unknown custom facet instances losslessly

## Commands

The canonical M1 command union is defined in [commands.ts](./types/commands.ts).

Supported M1 commands:

| Command | Payload |
|---|---|
| `context:add` | `{ name, parentUri?, ... }` |
| `context:remove` | `{ contextUri }` |
| `context:rename` | `{ contextUri, name }` |
| `context:update` | `{ contextUri, changes }` |
| `facet:add` | `{ contextUri, facetType, facet }` |
| `facet:update` | `{ contextUri, facetType, facetUri, changes }` |
| `facet:remove` | `{ contextUri, facetType, facetUri }` |
| `facet:retype` | `{ contextUri, oldType, newType, facetUri }` |
| `facet:move` | `{ sourceContextUri, targetContextUri, facetType, facetUri }` |
| `symbol:add` | `{ contextUri, symbol }` |
| `symbol:update` | `{ contextUri, symbolUri, changes }` |
| `symbol:remove` | `{ contextUri, symbolUri }` |
| `symbol:classify` | `{ contextUri, symbolUri, targetType, facet }` |
| `link:add` | `{ predicate, sourceUri, targetUri, ... }` |
| `link:remove` | `{ linkUri }` |
| `link:update` | `{ linkUri, ... }` |
| `assertion:add` | `{ assertion }` |
| `assertion:update` | `{ assertionId, changes }` |
| `assertion:remove` | `{ assertionId }` |

Batch: `{ type: 'batch', payload: { label, commands[] } }` applies multiple commands atomically.

### Execution rules

- Command application must be pure: no side effects, no async, no external state
- Must return `{ success: boolean, state: RootContext, error?: string, warnings: string[], events: DomainEvent[] }`
- Failed commands must return `success: false` and leave state unchanged
- Batch application is all-or-nothing: if any command fails, the entire batch fails
- Every command must have a computable inverse for undo

### Required behavioral guarantees

- Deleting a context must also delete its descendants and prune any links that referenced deleted entities
- Deleting a facet must prune any links that referenced it
- Retyping a facet must move the entity instance from one facet array to another without changing its URI
- Symbol classification must remove the symbol and create a new typed facet in its place

### Domain events

Commands may emit `DomainEvent` objects in the result's `events` array. Events are informational and do not affect state. They enable consumers to react to model changes (e.g., updating a UI, triggering sync).

## Commit Log

The canonical append-only persistence unit is `Commit`, defined in [commits.ts](./types/commits.ts).

Fields: `id`, `mapId`, `sequence`, `command`, `inverse`, `timestamp`, `deviceId`, `branchId`, `parentId`

Rules:
- Commits are append-only. History is never rewritten.
- Undo appends the inverse command as a new commit.
- Checkpoints store materialized `RootContext` snapshots for efficient replay.
- Loading a model = load latest checkpoint + replay commits since that checkpoint.

## Query Algebra

The query language is defined in [query.ts](./types/query.ts). It is a composable set algebra over model entities.

**Set operations:** `base`, `context`, `tagged`, `ids`, `union`, `intersect`, `subtract`, `traverse`, `filter`, `aggregate`

**Filter operations (18):** `eq`, `neq`, `gt`, `lt`, `gte`, `lte`, `contains`, `startsWith`, `regex`, `in`, `isNull`, `isNotNull`, `hasLink`, `hasTag`, `hasStereotype`, `hasKind`, `facetCount`, `and`, `or`, `not`

**Aggregate operations:** `count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `groupBy`

Expressions compose: a `filter` expression contains a `base` expression and a `where` predicate. A `traverse` walks the link graph from a starting set. An `aggregate` reduces a set to a scalar or grouped result.

Two evaluators exist: `evaluateSetExpr()` for M1 (sync, in-memory) and `evaluateSetExprM0()` for M0 (async, repository-backed).

## Triple Projection

The model must be projectable to `(subject, predicate, object)` triples. See [triples.ts](./engine/triples.ts).

Required properties:
- Every entity must project to a stable subject URI
- Every entity must emit an `rdf:type` triple
- Stored links must project using the predicate URI from the registry
- Structural relationships (childOf, memberOf, hasTag) appear as derived triples even though they are not stored as `Link` records

The namespace is configurable through [ontology.ts](./meta/ontology.ts). Consumers must not hardcode the default namespace.

Serialization formats: Turtle, JSON-LD, N-Triples, TriG (named graphs per context).

## Assertions and Completeness

Assertions are structural rules stored in `RootContext.assertions`. Each assertion has:
- `id`, `name` - identity
- `selector` - which entities the rule applies to (by entity type, context, or custom filter)
- `rule` - what to check (e.g., `requires-field`, `requires-link`, `min-count`)
- `severity` - `error`, `warning`, or `info`
- `enabled` - toggle

The completeness engine (`evaluateAllGaps`) evaluates all enabled assertions against the live model and returns typed violations: `{ entityId, entityName, message, severity }`.

`generateDefaultAssertions()` produces ontology-derived defaults (e.g., "every Action should have a performer via the `performs` predicate").

## M0 Runtime Contract

M0 state is defined in [m0.ts](./types/m0.ts). It is separate from `RootContext` (M1).

Top-level stores: `instances`, `pipelineRuns`, `retryEntries`, `suppressions`, `replayPoints`, `deployments`, `simulationRuns`, `writebackQueue`

Instantiable M1 classes: `Thing`, `Persona`, `Event`, `Measure`, `Workflow`, `Action`

Immutable M0 classes (append-only, no updates): `Event`, `Measure`

M0 commands follow the same pure-function contract as M1 commands. They have their own inverse computations and participate in the same commit log.

## Pipeline Mapping Contract

The mapping contract is defined by `Pipeline.mapping` and executed by [mappingEngine.ts](./runtime/mappingEngine.ts).

`PipelineMapping` fields:
- `iterate?: string` - path expression to select the source array
- `identity.externalId: string` - path expression for the upsert key
- `fields: Record<string, string | FieldMapping>` - field mappings
- `links?: LinkMapping[]` - relationship mappings
- `filter?: string` - per-record filter expression

`FieldMapping`: `{ source: string, transform?: string, defaultValue?: unknown }`

`LinkMapping`: `{ predicate: string, targetThingId: string, match: string }`

### Expression semantics
- The engine supports a JSONata-style path subset, not full JSONata
- Supported forms: `$`, `$.a.b.c`, `a.b.c`, numeric literals, string literals, `true`/`false`/`null`
- `iterate` selects the array inside a transport response
- `identity.externalId` extracts the upsert key per record
- Bare string field mappings are shorthand for `{ source: <expr> }`
- `transform` is an opaque function identifier resolved by the host runtime

### Output contract

Each mapped record must produce:
- `externalId: string`
- `fields: Record<string, unknown>`
- `links: Array<{ predicate, targetThingId, targetExternalId }>`

The engine also returns: `errors: MappingError[]` and `skipped: number`

**Idempotency**: same input + same mapping + same transform behavior must produce the same ordered output.

### Minimal example

Input:
```json
{ "data": [{ "id": "cust_1", "email": "a@example.com", "name": "Alice" }] }
```

Mapping:
```json
{ "iterate": "$.data", "identity": { "externalId": "$.id" }, "fields": { "email": "$.email", "name": "$.name" } }
```

Output:
```json
{ "instances": [{ "externalId": "cust_1", "fields": { "email": "a@example.com", "name": "Alice" }, "links": [] }], "errors": [], "skipped": 0 }
```

## Interoperability Requirements

A connector, LLM toolchain, or non-TypeScript port must:
- Preserve all unknown fields on entities unless a command explicitly removes them
- Treat expression strings as data, not as executable code
- Keep M1 structure and M0 runtime state in separate stores
- Validate links against the predicate registry, not against UI heuristics
- Preserve `customTypes`, `customFacets`, and `valueTypes` losslessly
- Not inject layout, canvas, or presentation data into the metaontology format

### LLM profile

- An LLM may generate `RootContext`, `Command`, `PipelineMapping`, or `SetExpr` values
- The host system must validate all LLM-generated structures against this spec before execution
- Interoperability depends on matching the contracts above, not on sharing the same implementation language

## Conformance Checklist

An independent implementation is conformant if it can:

1. Parse and serialize `RootContext` without data loss
2. Execute the M1 command union and produce equivalent state
3. Compute inverse commands for undo
4. Validate links against the entity-class and predicate registries
5. Project the model to triples with the configured namespace
6. Execute the query algebra (set operations, filters, aggregates)
7. Evaluate assertion rules and return violations
8. Materialize and mutate M0 state via M0 commands
9. Run the pipeline mapping contract over external JSON

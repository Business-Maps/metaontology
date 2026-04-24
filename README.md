# @businessmaps/metaontology

A typed domain modeling framework for TypeScript. Define your business entities, relationships, and processes once; get an immutable command engine, a triple store, set-theoretic queries, three-way merge, completeness checking, and RDF export.

If you've built TypeScript applications around a domain model, you've probably written something like `type Order = { id: string; items: OrderItem[]; status: string }`. That works until you need to know which status transitions are valid, who can perform them, which downstream systems care, and whether your model actually covers everything. You end up with validation logic scattered across three layers, a state machine in a separate file, and a data dictionary in a document nobody keeps current. This framework treats the domain model itself as a structured artifact: typed, queryable, versioned, and projectable to linked data.

```ts
import { defineThing, definePredicate, decimal, enumOf }
  from '@businessmaps/metaontology'

const product = defineThing('Product', {
  attributes: { price: decimal, category: enumOf('electronics', 'clothing', 'food') },
})
const warehouse = defineThing('Warehouse', { attributes: { capacity: decimal } })
const stocks = definePredicate('stocks', { domain: [warehouse], range: [product] })
```

Every `defineThing` call registers a typed entity in a runtime registry. Every `definePredicate` call declares a validated relationship with `domain` and `range` constraints. Both sides carry full TypeScript inference; no codegen step required. The engine enforces the constraints, computes inverses for undo, and projects everything to triples.

---

## Getting started

```bash
npm install @businessmaps/metaontology
```

### 1. Define your domain

```ts
// domain.ts
import { defineThing, definePersona, definePredicate,
         text, decimal, markdown, enumOf } from '@businessmaps/metaontology'

export const product = defineThing('Product', {
  attributes: {
    sku:         text,
    price:       decimal,
    description: markdown,
    category:    enumOf('electronics', 'clothing', 'food', 'other'),
  },
})

export const warehouse = definePersona('Warehouse', {
  attributes: {
    location: text,
    capacity: decimal,
  },
})

export const stocks = definePredicate('stocks', {
  domain: [warehouse],
  range:  [product],
  label:        { en: 'stocks' },
  inverseLabel: { en: 'stocked by' },
})
```

### 2. Wire the dispatcher

`applyCommand` is a pure function: model in, result out. It has no idea where your state lives. The dispatcher binding is the seam that connects the two; set it up once at startup, then the typed handles on `product`, `warehouse`, and `stocks` route commands through it automatically.

```ts
// app.ts
import { bindDispatcher, bindRootAccessor } from '@businessmaps/metaontology'
import { createEmptyRootContext, applyCommand } from '@businessmaps/metaontology/engine'

let model = createEmptyRootContext('My Business')

bindDispatcher((cmd) => {
  const result = applyCommand(model, cmd)
  if (result.success) model = result.state
  return result
})

bindRootAccessor(() => model)
```

Your state can live anywhere: a plain variable, a Pinia store, Redux, a database. The framework has no opinion.

### 3. Create entities and relationships

```ts
import { product, warehouse, stocks } from './domain'

const widgetId = product.add({
  name: 'Widget', sku: 'W-001',
  price: 9.99, category: 'electronics',
})

const dcId = warehouse.add({
  name: 'Main Distribution Center',
  location: 'Denver', capacity: 50000,
})

// The framework checks that dcId resolves to a Warehouse (domain)
// and widgetId resolves to a Product (range) before creating the link.
stocks.link(dcId, widgetId)

// Direct lookup
product.findByUri(widgetId)
```

For set-theoretic queries across the model (filtering by attributes, traversing the relationship graph, aggregating) see the [Query algebra](#query-algebra) section.

---

## What is a metaontology?

An ontology describes a domain: "an Order has line items, a Customer places Orders." A *meta*ontology describes how to describe domains: there are Things with attributes, Personas that act, Events that happen, and typed predicates that connect them.

This package is the metaontology: the M2 layer. It doesn't know about your business. Your domain declarations (`defineThing('Order', {...})`) are the M1 layer. The live data those types produce at runtime are M0.

```
M2  @businessmaps/metaontology     DSL, engine, triple store, query algebra
    ────────────────────────────   entity classes, predicates, datatypes
M1  Your Domain Ontology            defineThing('Order', {...})
    ────────────────────────────   defineAction('PlaceOrder', {...})
M0  Runtime Instances               a specific order placed at 14:32 on Tuesday
```

The separation is not academic. M2 changes rarely: when a new entity class or predicate is added to the framework. M1 changes during modeling sessions: when a team adds a new bounded context or redefines a relationship. M0 changes continuously during operation: when customer records arrive from Stripe, when orders are placed, when inventory moves. Each layer has its own mutation contract, its own persistence strategy, and its own merge semantics. Keeping them distinct means you can evolve one without breaking the others.

Different businesses share the framework (M2) but declare different ontologies (M1). A logistics company and a healthcare company both use `defineThing`, `defineAction`, and `definePredicate`, but their entities, actions, and relationships differ. Each domain can have multiple applications on top (a visual modeler, an admin panel, a CLI, a monitoring dashboard), all reading from the same M1 model.

---

## The model

Everything lives in a single `RootContext`, a plain JSON-serializable object that is the complete, portable state of your domain model.

**Contexts** are bounded contexts in the DDD sense. `RootContext.contexts` is a flat map of `Context` objects; `parentUri` on each context forms the tree. Each context is a `FacetContainer` that holds its own entities, symbols, and any user-defined entity instances. The flat map (rather than nested objects) enables O(1) lookup by URI and simplifies merge: context tree shape is expressed through data, not through nesting.

**Facets** are the typed entities. The framework ships 11 built-in facet types (see [The 11 primitives](#the-11-primitives)); each lives in a typed array inside its container. User-defined entity types declared via `customTypes` are stored in `customFacets`. Every facet carries at minimum a `uri` and `name`.

**Links** are the persisted relationships. They live in a flat array at the root, not nested inside the entities they connect. This means a link between a Customer in `ctx-sales` and an Order in `ctx-fulfillment` doesn't break if either context is reorganized. Links are validated against the predicate registry on creation.

**Symbols** are free-form notes: sticky-note stubs with an `id` and `content`, useful during early modeling when you know something exists but haven't decided what type it is. A `symbol:classify` command promotes a symbol to a typed facet without changing its URI.

---

## The 11 primitives

Eleven abstract entity types organized into three tiers. Start with what exists; add what happens; add how it's built.

**Tier 1: What exists**

| Primitive | What it models |
|---|---|
| **Thing** | Domain entities: Order, Customer, Product, Invoice. The nouns of your business. |
| **Persona** | Actors: humans, teams, systems, external services. Who (or what) does things. |

**Tier 2: What happens**

| Primitive | What it models |
|---|---|
| **Port** | Boundary contracts: what a context produces or consumes. |
| **Action** | Operations: commands that change state, queries that read it, intents that represent goals. |
| **Workflow** | Processes: multi-step sequences with triggers, SLAs, and step-level assignment. |
| **Event** | Things that happened: domain events, state changes, signals with typed payloads. |
| **Measure** | What you track: KPIs, aggregations, financial metrics with units and time windows. |

**Tier 3: How it's built**

| Primitive | What it models |
|---|---|
| **Interface** | Surfaces: pages, APIs, dashboards, forms, webhooks, reports. 12 interface kinds. |
| **Function** | Pure computations: validators, formatters, calculators. |
| **DataSource** | External connections: Stripe, Postgres, S3, CSV. Carries auth config and connection status. |
| **Pipeline** | Data flows: pull from a DataSource, map fields, populate Things. |

Your domain declares subtypes of these primitives via `defineThing('Order', {...})`, `defineAction('PlaceOrder', {...})`, and so on. The engine, query algebra, and triple projection work uniformly across all 11 types without needing to know which specific subtype you declared.

---

## Commands

The model is immutable. All mutations flow through commands: `applyCommand(root, cmd)` takes a `RootContext` and returns a new one, or an error. The original state is always unchanged.

```ts
import { createEmptyRootContext, applyCommand, applyBatch }
  from '@businessmaps/metaontology/engine'
import { computeInverse } from '@businessmaps/metaontology/engine'

const root = createEmptyRootContext('My Business')

// Apply a single command
const result = applyCommand(root, {
  type: 'facet:add',
  payload: {
    contextUri: root.uri,
    facetType: 'things',
    facet: { uri: 'thing-1', name: 'Order', attributes: [], tags: [] },
  },
})
// result: { success, state, error?, warnings, events }

// Compute the inverse (for undo)
const undoCmd = computeInverse(result.command, root, result.state)
const { state: restored } = applyCommand(result.state, undoCmd)

// Batch: multiple commands, all-or-nothing
const batchResult = applyBatch(root, {
  type: 'batch',
  payload: {
    label: 'Setup initial model',
    commands: [
      { type: 'facet:add', payload: { contextUri: root.uri, facetType: 'things',
          facet: { uri: 't1', name: 'Order', attributes: [], tags: [] } } },
      { type: 'facet:add', payload: { contextUri: root.uri, facetType: 'personas',
          facet: { uri: 'p1', name: 'Customer', tags: [] } } },
      { type: 'link:add', payload: { predicate: 'owns', sourceUri: 'p1', targetUri: 't1' } },
    ],
  },
})
```

Every command has a computed inverse. Undo appends the inverse as a new commit; the log never rewinds. This means undo, redo, branching, collaborative sync, and conflict resolution all compose from the same primitive without special-casing any of them.

### Command types

| Command | Purpose |
|---|---|
| `context:add/remove/rename/update` | Manage sub-contexts (bounded-context modeling) |
| `facet:add/update/remove/move/retype` | Create, modify, delete, relocate, or reclassify entities |
| `link:add/remove/update` | Typed relationships between entities |
| `symbol:add/update/remove/classify` | Free-form notes, promotable to typed entities |
| `assertion:add/update/remove` | Model quality assertions |

---

## Triple store

The engine projects the typed model into `(subject, predicate, object)` triples for O(1) lookups on any axis. This is a read-only projection of the model; triples are not the storage format.

```ts
import { projectToTriples, buildIndexes, sp, po, spo }
  from '@businessmaps/metaontology/engine/triples'

const triples = projectToTriples(model)
const idx = buildIndexes(triples)

// What type is entity X?
idx.typeOf.get('thing-order')                         // 'Thing'

// All triples about entity X
idx.byS.get('thing-order')                            // Triple[]

// Who performs action Y?
idx.bySP.get(sp('action-place', 'performs'))           // Triple[]

// What entities are Things?
idx.byPO.get(po('rdf:type', 'https://ontology.businessmaps.io/Thing'))

// Existence check in O(1)
idx.bySPO.has(spo('p1', 'performs', 'a1'))             // boolean
```

Structural relationships (`childOf`, `memberOf`, `hasTag`) appear as derived triples even though they are not stored as `Link` records. A link between a context and its parent doesn't need a `Link` entry; the tree structure already expresses it. The triple index makes both stored and structural relationships queryable through the same interface.

### RDF serialization

```ts
import { serialiseAsTurtle, serialiseAsJsonLd, serialiseAsNTriples }
  from '@businessmaps/metaontology/engine/triples'

const turtle = serialiseAsTurtle(triples)
const jsonld = serialiseAsJsonLd(triples)
const nt     = serialiseAsNTriples(triples)
```

Actual Turtle output for a `Product` entity named "Widget" in a model with URI `my-map`:

```turtle
@prefix bm:   <https://ontology.businessmaps.io/> .
@prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .

bm:entity/thing-1
  a bm:Thing ;
  rdfs:label "Widget"^^xsd:string ;
  bm:memberOf bm:entity/my-map .

bm:entity/my-map
  bm:stocks bm:entity/thing-1 .
```

Every entity has a stable URI formed from the namespace and the entity's `uri` field. Predicates in stored links use the registered predicate URI. The namespace is configurable (see [Namespace configuration](#namespace-configuration)); Turtle, JSON-LD, N-Triples, and TriG (named graphs per context) are supported. The framework does not generate OWL axioms or support SPARQL directly; the triple projection is a standard RDF serialization for export and interoperability.

---

## Query algebra

Set-theoretic expressions over the model graph, composable from primitives:

```ts
import { evaluateSetExpr } from '@businessmaps/metaontology/engine/query'

// All Things
evaluateSetExpr(model, { op: 'base', objectType: 'Thing' })

// All entities in a bounded context
evaluateSetExpr(model, { op: 'context', contextId: 'ctx-checkout' })

// Things that are targets of at least one 'performs' link
evaluateSetExpr(model, {
  op: 'filter',
  base:  { op: 'base', objectType: 'Thing' },
  where: { op: 'hasLink', predicate: 'performs', direction: 'in' },
})

// Graph traversal: everything within 2 hops of an action
evaluateSetExpr(model, {
  op:        'traverse',
  from:      { op: 'ids', ids: ['action-place-order'] },
  predicate: '*',
  direction: 'both',
  depth:     2,
})

// Set composition: Things also tagged 'revenue-bearing'
evaluateSetExpr(model, {
  op:   'intersect',
  sets: [
    { op: 'base',   objectType: 'Thing' },
    { op: 'tagged', tag: 'revenue-bearing' },
  ],
})
```

Supported operations: `base`, `context`, `tagged`, `ids`, `union`, `intersect`, `subtract`, `traverse`, `filter`, `aggregate`. Filter predicates: 18 variants including `eq`, `neq`, `contains`, `regex`, `hasLink`, `hasTag`, `hasStereotype`, `facetCount`, and boolean combinators `and`/`or`/`not`. Aggregate operations: `count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `groupBy`.

Higher-level helpers for common operations:

```ts
import { searchEntities, describeContext, listContexts }
  from '@businessmaps/metaontology/engine/query'

searchEntities(model, 'order')         // full-text search across names and definitions
describeContext(model, model.uri)       // context with all its facets and links
listContexts(model)                    // hierarchical context tree
```

An async evaluator, `evaluateSetExprM0`, runs the same algebra against M0 runtime instances via a `InstanceRepository` interface for queries against live data rather than the model schema.

---

## Branching and three-way merge

```ts
import { mergeRootContexts } from '@businessmaps/metaontology/engine/merge'
import { diffRootContexts }  from '@businessmaps/metaontology/engine/diff'

// Fork: snapshot the current model
const base = structuredClone(model)

// Both sides edit independently
const ours   = applyCommand(base, ourCmd).state
const theirs = applyCommand(base, theirCmd).state

// Diff: what changed between base and theirs?
const diff = diffRootContexts(base, theirs)
// diff.facets, diff.links, diff.contexts, each with changeType: 'added' | 'removed' | 'modified'

// Three-way merge with conflict detection
const result = mergeRootContexts({ base, ours, theirs })

if (result.success) {
  model = result.mergedModel
} else {
  for (const conflict of result.conflicts) {
    conflict.resolution = 'ours'  // or 'theirs'
  }
}
```

---

## Completeness engine

Declare structural assertions about model quality. The engine evaluates them against the live model and returns typed violations.

```ts
import { evaluateAllGaps, generateDefaultAssertions }
  from '@businessmaps/metaontology/engine/completeness'

// Ontology-derived defaults: "every Action should have a performer", etc.
const defaults = generateDefaultAssertions()

// Custom assertions
const assertion = {
  id:       'require-attributes',
  name:     'Every Thing should have at least one attribute',
  selector: { scope: 'entityType', entityTypes: ['things'] },
  rule:     { type: 'requires-field', field: 'attributes', facetTypes: ['things'] },
  severity: 'warning',
  enabled:  true,
}

const violations = evaluateAllGaps(model)
// [{ entityName: 'Order', message: 'Thing "Order" has no "performs" links', severity: 'info' }]
```

Seven rule types: `requires-field`, `requires-link`, `min-count`, `max-count`, `requires-tag`, `requires-stereotype`, `custom`. Assertions are stored in `RootContext.assertions` and can be added, updated, or removed via commands, so they participate in the same undo/redo/sync flow as the rest of the model.

---

## Persistence

`RootContext` is a plain JSON-serializable object. Store it however you want:

```ts
// File system
await fs.writeFile('model.json', JSON.stringify(model, null, 2))
const loaded = JSON.parse(await fs.readFile('model.json', 'utf8')) as RootContext

// localStorage
localStorage.setItem('my-model', JSON.stringify(model))

// Any database
await db.put('model', JSON.stringify(model))
```

For versioned persistence with undo history, implement a commit log on top of the command engine:

```ts
interface Commit {
  id:        string
  command:   DispatchableCommand
  inverse:   DispatchableCommand
  timestamp: string
}

const commits: Commit[] = []

function commitCommand(cmd) {
  const before = model
  const result = applyCommand(model, cmd)
  if (!result.success) return result

  model = result.state
  commits.push({
    id:        nanoid(),
    command:   cmd,
    inverse:   computeInverse(cmd, before, model),
    timestamp: new Date().toISOString(),
  })
  return result
}

function undo() {
  const last = commits.pop()
  if (!last) return
  const result = applyCommand(model, last.inverse)
  if (result.success) model = result.state
}
```

Loading a model is loading the latest checkpoint and replaying commits since. The `@businessmaps/metaontology` package defines the `Commit` type and `computeInverse`; the storage layer is yours to choose.

---

## Pipeline runtime

Pull data from external systems, map fields, and populate model entities:

```ts
import { createPipelineRuntime } from '@businessmaps/metaontology/runtime/pipelineRuntime'
import { createFakeTransport }   from '@businessmaps/metaontology/runtime/transports/fakeTransport'
import { createLocalProvider }   from '@businessmaps/metaontology/runtime/providers/localProvider'

const runtime   = createPipelineRuntime()
const transport = createFakeTransport()
const provider  = createLocalProvider({ thingId: 'thing-customer' })

runtime.register(pipeline, { transport, provider, dataSource: stripeDs })

const result = await runtime.runOnce('pipe-stripe-customers')
// { status: 'ok', fetched: 100, mapped: 100, written: 100, errors: 0 }
```

Mapping is declarative JSON: an `iterate` path expression selects the source array, `identity.externalId` extracts the upsert key, and `fields` maps source paths to entity attribute names. The mapping engine uses a JSONata-style path subset (`$`, `$.a.b.c`, literals). Same input + same mapping + same transform always produces the same output.

---

## Predicates and relationships

The framework ships 45 predicates in three tiers.

**Framework tier** covers the structural metamodel: who performs what, who owns what, what triggers what, what is composed of what. Examples: `performs`, `stewards`, `owns`, `triggers`, `uses`, `emits`, `exposes`, `composes`, `extends`, `derivedFrom`. These are validated against the 11 entity types: a link using `performs` where the source is not a Persona will be rejected.

**Domain tier** covers cross-cutting relationships useful across many business domains: `dependsOn`, `flowsTo`, `implements`, `produces`, `consumes`, `sameConceptAs`.

**Structural predicates** (`childOf`, `memberOf`, `hasTag`, and others) are derived from model structure and projected as triples without being stored as `Link` records.

When the curated set doesn't fit, add your own:

```ts
import { definePredicate } from '@businessmaps/metaontology'

const assignedTo = definePredicate('assignedTo', {
  domain: [order],
  range:  [customer],
  label:        { en: 'assigned to' },
  inverseLabel: { en: 'has assignment' },
  cardinality:  { source: 'many', target: 'one' },
})

assignedTo.link(orderId, customerId)
```

Custom predicates participate in the same validation, triple projection, and query algebra as built-in predicates.

---

## Datatypes

18 XSD-grounded attribute types with TypeScript mappings:

| Family | Types |
|---|---|
| **String** | `text`, `identifier`, `email`, `uri`, `markdown` |
| **Number** | `integer`, `decimal`, `percentage`, `money` (+ `currencyCode`), `quantity` (+ `unit`) |
| **Temporal** | `date`, `dateTime`, `time`, `duration` |
| **Boolean** | `boolean` |
| **Complex** | `reference`, `enum`, `list` |

Add semantic value types with validation constraints:

```ts
import { defineValueType } from '@businessmaps/metaontology'

const rating = defineValueType('rating', {
  baseType:    'integer',
  constraints: [{ type: 'range', min: 1, max: 5 }],
})
```

---

## Namespace configuration

By default, entity classes, predicates, and datatypes use `https://ontology.businessmaps.io/` as their namespace. To use your own:

```ts
import { configureOntologyNamespace } from '@businessmaps/metaontology'

configureOntologyNamespace({
  namespace: 'https://ontology.example.com/',
  prefix:    'ex',
})
```

Call this once at startup, before any `defineX` calls.

---

## Code generation

The `generate/` module produces source code from a `RootContext`. All generators are pure functions: `(RootContext) => string`.

Available: TypeScript types, Zod schemas, event schemas, guard functions, test skeletons, service boundary documentation, Nuxt domain layers, and Vue application scaffolds. The framework itself has no Vue or Nuxt runtime dependency; these are output formats produced by the generators, not dependencies of the package.

---

## Directory structure

```
dsl/        Schema combinators, typed handles, dispatcher bridge, DSL registry
core/       Built-in declarations: 11 base types, 18 datatypes, 10 value types, 45 predicates
engine/     Pure operations: apply, inverse, merge, diff, triples, query, completeness, inheritance
runtime/    M0 instance layer: providers, transports, pipeline runtime, action interpreter
types/      Generated (context.ts) and hand-authored types: commands, query, branch, commits
meta/       Metaontology registries: entity classes, predicates, fields, vocabulary
migrations/ Schema migrations for forward compatibility
generate/   Code generators: TS types, Zod schemas, Nuxt apps, domain layers
export/     Bundle and scaffold generation
util/       Template helpers
```

---

## FAIR compliance

The framework supports the [FAIR principles](https://www.go-fair.org/fair-principles/):

- **Findable**: every entity class, predicate, and datatype has a persistent, configurable URI.
- **Accessible**: the model is a plain JSON document. No proprietary format, no binary encoding, no runtime dependency to read it.
- **Interoperable**: the triple store projects to standard RDF. Labels are language-tagged (`{ en: string; [lang: string]: string }`). Datatypes map to XSD. Predicates follow RDFS conventions where applicable.
- **Reusable**: the SPEC defines a conformance checklist. Any language can implement a compatible reader/writer. The model carries its own vocabulary.

---

## Design decisions

**Immutable state, command-sourced.** The model is never mutated directly. Every change goes through a command that produces a new state. This makes undo, redo, branching, merge, and sync possible without special-casing any of them; they all compose from the same `applyCommand` primitive.

**Append-only log.** Undo doesn't rewind history. It appends the inverse command. The commit log is a complete linear record of everything that happened, which makes collaboration and conflict resolution tractable without distributed coordination at the command level.

**Pure engine.** `applyCommand` has no side effects, no async, no framework dependency. It takes a model and a command, returns a result. This makes it testable in isolation, portable across environments, and safe to call from any context including service workers, background threads, and server-side code.

**Registry-driven.** Entity classes, predicates, datatypes, and validation rules live in a runtime registry populated by `defineX()` calls at module load time. The engine reads from the registry rather than from hardcoded constants. Consumer layers can extend the vocabulary (new entity types, new predicates, new datatypes) without forking the engine or modifying package internals.

**Persistence-agnostic.** `RootContext` is a plain JSON object. The framework has no opinion about IndexedDB, Postgres, S3, or any storage backend. The same model can be stored in a browser, a server database, a file, or memory, without any adapter layer in the framework itself.

---

## License

Apache License 2.0

Copyright 2025 Business Maps

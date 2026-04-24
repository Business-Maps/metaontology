// ── Business Maps Ontology - Public API ─────────────────────────────────────
//
// Three-tier platform:
//   M2 (meta/)    - Entity classes, predicates, datatypes, validation rules
//   M1 (types/)   - Domain model types (RootContext, facets, commands, queries)
//   M1 (engine/)  - Pure operations (apply, query, validate, serialize, analyze)
//   M0 (generate/)- Code generation from M1 model (TS types, Zod, actions)
//
// Everything here is pure TypeScript - no Vue, no Pinia, no browser APIs.
// Any consumer (Designer, MCP server, CLI, generated app) can import from here.

// M2: Metaontology registries
export * from './meta'

// M1: Domain model types
export * from './types'

// M1: Engine (pure operations)
export * from './engine'

// M1→M0: Code generation
export * from './generate'

// Runtime contracts
export * from './runtime'
export type * from './runtime'

// Export pipeline
export * from './export'
export type * from './export'

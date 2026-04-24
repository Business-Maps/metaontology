// Set-theoretic query algebra for Business Maps.
// Used for model queries (structural, over RootContext) and data queries (runtime, over instance data).
// ONE algebra, MULTIPLE evaluators (browser model evaluator, SQL compiler, API query builder).

// ── Set Expressions ─────────────────────────────────────────────────────────

export type SetExpr =
  // Base sets
  | { op: 'base'; objectType: string }
  | { op: 'context'; contextId: string }
  | { op: 'tagged'; tag: string }
  | { op: 'ids'; ids: string[] }
  // Set operations
  | { op: 'union'; sets: SetExpr[] }
  | { op: 'intersect'; sets: SetExpr[] }
  | { op: 'subtract'; from: SetExpr; minus: SetExpr }
  // Graph traversal
  | { op: 'traverse'; from: SetExpr; predicate: string; direction: 'out' | 'in' | 'both'; depth?: number }
  // Filtering
  | { op: 'filter'; base: SetExpr; where: FilterExpr }
  // Aggregation
  | { op: 'aggregate'; base: SetExpr; fn: AggregateExpr }

// ── Filter Expressions ──────────────────────────────────────────────────────

export type FilterExpr =
  // Attribute filters (data-level - for runtime queries over instance data)
  | { op: 'eq'; field: string; value: unknown }
  | { op: 'neq'; field: string; value: unknown }
  | { op: 'gt'; field: string; value: number | string }
  | { op: 'lt'; field: string; value: number | string }
  | { op: 'gte'; field: string; value: number | string }
  | { op: 'lte'; field: string; value: number | string }
  | { op: 'contains'; field: string; value: string }
  | { op: 'startsWith'; field: string; value: string }
  | { op: 'regex'; field: string; pattern: string }
  | { op: 'in'; field: string; values: unknown[] }
  | { op: 'isNull'; field: string }
  | { op: 'isNotNull'; field: string }
  // Structural filters (model-level - for queries over the ontology graph)
  | { op: 'hasLink'; predicate: string; direction: 'out' | 'in'; min?: number; max?: number }
  | { op: 'hasTag'; tag: string }
  | { op: 'hasStereotype'; value: string }
  | { op: 'hasKind'; value: string }
  | { op: 'facetCount'; facetType: string; cmp: 'eq' | 'gt' | 'lt' | 'gte' | 'lte'; value: number }
  // Boolean combinators
  | { op: 'and'; conditions: FilterExpr[] }
  | { op: 'or'; conditions: FilterExpr[] }
  | { op: 'not'; condition: FilterExpr }

// ── Aggregate Expressions ───────────────────────────────────────────────────

export type AggregateExpr =
  | { fn: 'count' }
  | { fn: 'sum'; field: string }
  | { fn: 'avg'; field: string }
  | { fn: 'min'; field: string }
  | { fn: 'max'; field: string }
  | { fn: 'countDistinct'; field: string }
  | { fn: 'groupBy'; field: string; agg: AggregateExpr }

// ── Query Result ────────────────────────────────────────────────────────────

export interface SetResult {
  /** Entity IDs matching the query. */
  ids: string[]
  /** For aggregate queries: the computed value(s). */
  aggregateValue?: number | Record<string, number>
}

// ── Named Query ─────────────────────────────────────────────────────────────
// Saved queries stored on RootContext for dashboards, assertions, presentations.

export interface NamedQuery {
  id: string
  name: string
  description?: string
  expression: SetExpr
  /** Where this query is used: assertion selector, dashboard widget, filter, etc. */
  usage?: 'assertion' | 'dashboard' | 'filter' | 'measure' | 'custom'
}

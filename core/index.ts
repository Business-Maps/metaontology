/**
 * Core built-in declarations barrel.
 *
 * Importing this module registers all 11 abstract base types, all 18
 * datatypes, all 10 value types, and all stereotypes in the DSL
 * registry. Built-in predicates are in `builtinPredicates.ts`.
 *
 * Test files import this to populate the registry before
 * exercising base-type-dependent behavior.
 *
 * The consumer application imports this so the registry
 * is populated at module load time.
 */

// Register the 11 abstract base types
export * from './baseTypes'

// Register the 18 built-in datatypes
export * from './builtinDatatypes'

// Register the 10 built-in value types
export * from './builtinValueTypes'

// Register the stereotypes (Thing, Persona, Measure)
export * from './builtinStereotypes'

// Register the 45+ built-in predicates (including 10 M0 operational predicates)
export * from './builtinPredicates'

// Register the 8 M0 entity classes (no facetKey - stored in M0State, not FacetArrays)
export * from './m0EntityClasses'

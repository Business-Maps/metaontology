/**
 * Built-in stereotypes - semantic classifications for BM facets.
 *
 * Each stereotype is registered via `defineStereotype` so the DSL
 * registry can enumerate them at runtime.
 */

import { defineStereotype } from '../dsl/defineGeneric'

// ── Thing stereotypes ────────────────────────────────────────────────────────

export const entity = defineStereotype('entity', {
  description: 'Mutable domain object identified by ID (default)',
})

export const valueObject = defineStereotype('value-object', {
  description: 'Immutable value identified by attributes, not ID',
})

export const aggregateRoot = defineStereotype('aggregate-root', {
  description: 'Consistency boundary - owns and protects invariants of child entities',
})

export const referenceData = defineStereotype('reference-data', {
  description: 'Shared lookup data (countries, currencies, categories)',
})

export const goal = defineStereotype('goal', {
  description: 'Strategic objective with target date and success criteria',
})

export const risk = defineStereotype('risk', {
  description: 'Identified threat with probability, impact, and mitigation',
})

export const assumption = defineStereotype('assumption', {
  description: 'Unvalidated belief that the business model depends on',
})

export const milestone = defineStereotype('milestone', {
  description: 'Time-bound deliverable or achievement marker',
})

// ── Persona stereotypes ──────────────────────────────────────────────────────

export const human = defineStereotype('human', {
  description: 'Individual person (default)',
})

export const team = defineStereotype('team', {
  description: 'Group of people working together',
})

export const system = defineStereotype('system', {
  description: 'Internal automated system or service',
})

export const external = defineStereotype('external', {
  description: 'Third-party service or integration partner',
})

export const customer = defineStereotype('customer', {
  description: 'End user who is both an actor and a data entity - stewards a companion Thing',
})

// ── Measure stereotypes ──────────────────────────────────────────────────────

export const metric = defineStereotype('metric', {
  description: 'KPI or tracked quantity (default)',
})

export const aggregator = defineStereotype('aggregator', {
  description: 'Rolled-up summary derived from other measures',
})

export const financial = defineStereotype('financial', {
  description: 'Revenue, cost, margin, or other monetary measure',
})

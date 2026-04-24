#!/usr/bin/env tsx
/**
 * Codegen: generate the COMPLETE types/context.ts from ontology registries.
 *
 * Sources of truth:
 *   meta/typeRegistry.ts  - all non-facet types (interfaces, enums, unions, containers)
 *   meta/ontology.ts      - entity classes, FACET_KEY_TO_CLASS
 *   meta/fields.ts        - facet field definitions
 *
 * Run: npm run codegen
 */

import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENTITY_CLASSES } from '../meta/ontology'
import { FACET_FIELD_DEFS } from '../meta/fields'
import { ENUM_TYPES, INTERFACE_TYPES, CONTAINER_TYPES } from '../meta/typeRegistry'
import type { FieldSchema, FacetFieldDef } from '../meta/fields'
import type { EnumDef, UnionDef, TypeAliasDef, InterfaceDef } from '../meta/typeRegistry'

// Use FacetKey from ontology - we cannot import from context.ts since it IS what we generate.
type FacetKey = 'things' | 'personas' | 'ports' | 'actions' | 'workflows' | 'interfaces' | 'events' | 'measures' | 'functions' | 'datasources' | 'pipelines'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const outPath = join(scriptDir, '..', 'types', 'context.ts')

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a JSON Schema FieldSchema to a TypeScript type string. */
function schemaToTs(schema: FieldSchema, indent = 0): string {
  // Enum - literal union
  if (schema.enum) {
    return schema.enum.map(v => `'${v}'`).join(' | ')
  }

  // Array
  if (schema.type === 'array' && schema.items) {
    const inner = schemaToTs(schema.items, indent)
    // Wrap unions in parens to avoid ambiguity: (A | B)[]
    const needsParens = inner.includes(' | ') && !inner.startsWith('(')
    return needsParens ? `(${inner})[]` : `${inner}[]`
  }

  // Object with properties - inline interface
  if (schema.type === 'object' && schema.properties) {
    const requiredSet = new Set(schema.required ?? [])
    const pad = '  '.repeat(indent + 1)
    const closePad = '  '.repeat(indent)
    const lines: string[] = ['{']
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const opt = requiredSet.has(key) ? '' : '?'
      const tsType = schemaToTs(propSchema, indent + 1)
      lines.push(`${pad}${key}${opt}: ${tsType}`)
    }
    lines.push(`${closePad}}`)
    return lines.join('\n')
  }

  // Primitives
  if (schema.type === 'string') return 'string'
  if (schema.type === 'number') return 'number'
  if (schema.type === 'boolean') return 'boolean'
  if (schema.type === 'object') return 'Record<string, unknown>'

  return 'unknown'
}

/**
 * Fields that have a defaultValue in the registry but are marked optional (?)
 * in the hand-written context.ts. This set bridges the gap until the registry
 * gains an explicit `optional` flag.
 */
const OPTIONAL_OVERRIDES = new Set([
  'preconditions',
  'postconditions',
  'unit',        // Measure.unit is optional in context.ts despite defaultValue ''
])

/**
 * Determine whether a facet field should be optional (?) on the generated interface.
 *
 * Matching the hand-written context.ts conventions:
 * - Fields with a defaultValue → required (always present on the object)
 * - Fields with no defaultValue → optional
 * - Exception: fields in OPTIONAL_OVERRIDES are always optional
 */
function isRequired(field: FacetFieldDef): boolean {
  if (OPTIONAL_OVERRIDES.has(field.paramName)) return false
  return field.defaultValue !== undefined
}

// ── Named type overrides ─────────────────────────────────────────────────────
// Maps field paramName → the named TypeScript type to use instead of inlining.

const NAMED_TYPE_OVERRIDES: Record<string, string> = {
  attributes: 'ThingAttribute[]',
  states: 'ThingState[]',
  expectedDuration: 'Duration',
  timeWindow: 'Duration',
  preconditions: 'ActionCondition[]',
  postconditions: 'ActionCondition[]',
  steps: 'WorkflowStep[]',
  payload: 'SchemaField[]',
  props: 'SchemaField[]',
  requestSchema: 'SchemaField[]',
  responseSchema: 'SchemaField[]',
  target: 'MeasureTarget',
  interfaceKind: 'InterfaceKind',
  stereotype: 'ThingStereotype',
  personaType: 'PersonaStereotype',
  measureType: 'MeasureStereotype',
  eventType: "'event' | 'delta'",
  parameters: 'ActionParameter[]',
  mutations: 'MutationRule[]',
  sideEffects: 'SideEffectRule[]',
  authorization: 'ActionAuthorization',
  // Function (Phase 6) - composite types live in typeRegistry.ts
  signature: 'FunctionSignature',
  body: 'FunctionBody',
  functionStereotype: 'FunctionStereotype',
  purity: 'FunctionPurity',
  visibility: 'FunctionVisibility',
  // DataSource (Phase 7)
  transport: 'DataSourceTransport',
  authType: 'DataSourceAuthType',
  dataSourceStereotype: 'DataSourceStereotype',
  connectionStatus: 'DataSourceConnectionStatus',
  environment: 'DataSourceEnvironment',
  // Pipeline (Phase 8)
  mapping: 'PipelineMapping',
  strategy: 'PipelineStrategy',
  pipelineDirection: 'PipelineDirection',
  schedule: 'PipelineSchedule',
  rateLimit: 'RateLimitConfig',
  pipelineStereotype: 'PipelineStereotype',
  lastRunStatus: 'PipelineRunStatus',
}

// ── Extra facet fields ──────────────────────────────────────────────────────
// Fields present on facet interfaces in context.ts but NOT in FACET_FIELD_DEFS
// (because they're structural/UI-only - not exposed as AI tool parameters).
// Keyed by facetKey → array of field definitions to inject.

const EXTRA_FACET_FIELDS: Record<string, Array<{ name: string; type: string; optional: boolean; insertAfter?: string }>> = {
  workflows: [
    { name: 'trigger', type: 'WorkflowTrigger', optional: true, insertAfter: 'description' },
    { name: 'sla', type: 'WorkflowSla', optional: true, insertAfter: 'triggerStepId' },
  ],
  interfaces: [
    { name: 'media', type: 'MediaRef', optional: true, insertAfter: 'description' },
  ],
}

// ── Facet interface generation ───────────────────────────────────────────────

/** Ordered facet keys - matches context.ts ordering. */
const FACET_ORDER: FacetKey[] = [
  'things', 'personas', 'ports', 'actions',
  'workflows', 'interfaces', 'events', 'measures',
  'functions', 'datasources', 'pipelines',
]

/** Ordered facet keys with entity class IDs. */
const facetEntries = Object.values(ENTITY_CLASSES)
  .filter((ec): ec is typeof ec & { facetKey: string } => 'facetKey' in ec && !!ec.facetKey)
  .map(ec => ({ classId: ec.id, facetKey: ec.facetKey as FacetKey }))

interface GeneratedField {
  name: string
  tsType: string
  optional: boolean
}

function generateFieldsForFacet(facetKey: FacetKey): GeneratedField[] {
  const fields: GeneratedField[] = []
  const defs = FACET_FIELD_DEFS.filter(f => f.facetTypes.includes(facetKey))

  for (const def of defs) {
    const fieldName = def.fieldName ?? def.paramName

    // Workflow trigger is assembled from three flat params - skip individual ones
    if (facetKey === 'workflows') {
      if (def.paramName === 'triggerType' || def.paramName === 'triggerRefId' || def.paramName === 'triggerDescription') {
        continue
      }
    }

    // Use named type override if available
    const tsType = NAMED_TYPE_OVERRIDES[def.paramName]
      ? NAMED_TYPE_OVERRIDES[def.paramName]
      : schemaToTs(def.schema, 1)

    fields.push({
      name: fieldName,
      tsType,
      optional: !isRequired(def),
    })
  }

  // Inject extra fields (media, sla, trigger) at the correct positions
  const extras = EXTRA_FACET_FIELDS[facetKey]
  if (extras) {
    for (const extra of extras) {
      const insertIdx = extra.insertAfter
        ? fields.findIndex(f => f.name === extra.insertAfter) + 1
        : fields.length
      fields.splice(insertIdx >= 0 ? insertIdx : fields.length, 0, {
        name: extra.name,
        tsType: extra.type,
        optional: extra.optional,
      })
    }
  }

  return fields
}

// ── Type guards for registry entries ─────────────────────────────────────────

function isEnumDef(def: EnumDef | UnionDef | TypeAliasDef): def is EnumDef {
  return 'type' in def && (def as EnumDef).type === 'string-union'
}

function isUnionDef(def: EnumDef | UnionDef | TypeAliasDef): def is UnionDef {
  return 'variants' in def
}

function isTypeAlias(def: EnumDef | UnionDef | TypeAliasDef): def is TypeAliasDef {
  return 'type' in def && !('values' in def) && !('variants' in def)
}

// ── Build output ─────────────────────────────────────────────────────────────

const lines: string[] = []

function emit(line: string = '') {
  lines.push(line)
}

// ── 1. Header ────────────────────────────────────────────────────────────────

emit('// @generated - do not edit manually')
emit('// Generated by ontology/codegen/generate.ts from the ontology registries.')
emit('// Source of truth: meta/typeRegistry.ts + meta/ontology.ts + meta/fields.ts')
emit('')
emit('import type { StoredPredicateId, FacetKey } from \'../meta/ontology\'')
emit('')
emit('// ValueConstraint and ValueTypeDef live in meta/valueTypes.ts (M2 concepts).')
emit('// Imported for local use and re-exported so consumers get all types from one file.')
emit('import type { ValueConstraint, ValueTypeDef } from \'../meta/valueTypes\'')
emit('export type { ValueConstraint, ValueTypeDef } from \'../meta/valueTypes\'')
emit('')

// ── 2. Enum / union / alias types ────────────────────────────────────────────

for (const def of ENUM_TYPES) {
  if (isEnumDef(def)) {
    emit(`export type ${def.name} = ${def.values.map(v => `'${v}'`).join(' | ')}`)
  } else if (isUnionDef(def)) {
    emit(`export type ${def.name} =`)
    for (const variant of def.variants) {
      emit(`  | ${variant}`)
    }
  } else if (isTypeAlias(def)) {
    emit(`export type ${def.name} = ${def.type}`)
  }
  emit('')
}

// ── 3. Interface types (non-facet) ───────────────────────────────────────────

function emitInterface(def: InterfaceDef) {
  const ext = 'extends' in def && def.extends ? ` extends ${def.extends}` : ''
  emit(`export interface ${def.name}${ext} {`)
  for (const field of def.fields) {
    const opt = field.optional ? '?' : ''
    const ro = field.readonly ? 'readonly ' : ''
    emit(`  ${ro}${field.name}${opt}: ${field.type}`)
  }
  emit('}')
  emit('')
}

// Emit non-facet interfaces (SubtreeFacet must come after the Facet union)
const DEFERRED_INTERFACES = new Set(['SubtreeFacet'])
for (const def of INTERFACE_TYPES) {
  if (DEFERRED_INTERFACES.has(def.name)) continue
  emitInterface(def)
}

// ── 4. Facet interfaces ─────────────────────────────────────────────────────

for (const facetKey of FACET_ORDER) {
  const entry = facetEntries.find(e => e.facetKey === facetKey)
  if (!entry) continue

  const classId = entry.classId
  const fields = generateFieldsForFacet(facetKey)

  emit(`export interface ${classId} {`)
  emit('  uri: string')
  emit('  name: string')

  for (const field of fields) {
    const opt = field.optional ? '?' : ''
    emit(`  ${field.name}${opt}: ${field.tsType}`)
  }

  emit('}')
  emit('')
}

// ── 5. Aliases for global-shadowing names ────────────────────────────────────
// 'Function' shadows the global Function constructor. Alias it so FacetTypeMap
// and consumer code can reference the ontology type unambiguously.
emit('export type BmFunction = Function')
emit('')

// ── 5b. Mapped types (FacetTypeMap, FacetArrays, Facet union) ────────────────

// Map to resolve global-shadowing names → aliases
const SAFE_NAME: Record<string, string> = { Function: 'BmFunction' }

emit('export interface FacetTypeMap {')
for (const facetKey of FACET_ORDER) {
  const entry = facetEntries.find(e => e.facetKey === facetKey)
  if (!entry) continue
  const safeName = SAFE_NAME[entry.classId] ?? entry.classId
  emit(`  ${facetKey}: ${safeName}`)
}
emit('}')
emit('')

// FacetArrays has both typed keys for the 11 built-in facets AND a string
// index signature so engine code can iterate dynamically registered facet
// types (from the DSL registry) without type casts. The named properties
// are subtypes of Facet[], so the index signature is compatible.
emit('export type FacetArrays = { [K in FacetType]: FacetTypeMap[K][] } & { [key: string]: Facet[] }')
emit('')

// Facet union - all 8 facet types
const facetClassIds = FACET_ORDER
  .map(k => facetEntries.find(e => e.facetKey === k)?.classId)
  .filter(Boolean)
emit(`export type Facet = ${facetClassIds.join(' | ')}`)
emit('')

// ── 6. Container types (FacetContainer, RootContext, Context) ────────────────

for (const def of CONTAINER_TYPES) {
  emitInterface(def)
}

// ── 7. InheritedAttributes ──────────────────────────────────────────────────

emit('/**')
emit(' * Inheritance resolution result for Things connected via the `extends` predicate.')
emit(' * Use `resolveInheritedAttributes(root, thingId)` from lib/core/inheritance.ts.')
emit(' */')
emit('export interface InheritedAttributes {')
emit('  own: ThingAttribute[]')
emit('  inherited: Array<ThingAttribute & { inheritedFrom: string; inheritedFromName: string }>')
emit('  all: ThingAttribute[]')
emit('  chain: Array<{ uri: string; name: string }>')
emit('  circular: boolean')
emit('}')
emit('')

// ── 8. CustomFacetInstance ──────────────────────────────────────────────────

emit('export interface CustomFacetInstance {')
emit('  uri: string')
emit('  name: string')
emit('  description?: string')
emit('  tags?: string[]')
emit('  [field: string]: unknown')
emit('}')
emit('')

// ── 9. Deferred interfaces (SubtreeFacet - depends on Facet union) ──────────

for (const name of DEFERRED_INTERFACES) {
  const def = INTERFACE_TYPES.find(d => d.name === name)
  if (def) emitInterface(def)
}

// ── Write output ─────────────────────────────────────────────────────────────

const output = lines.join('\n') + '\n'
writeFileSync(outPath, output, 'utf-8')

// eslint-disable-next-line no-console
console.log(`Generated ${outPath}`)
// eslint-disable-next-line no-console
console.log(`  ${ENUM_TYPES.length} enum/union/alias types`)
// eslint-disable-next-line no-console
console.log(`  ${INTERFACE_TYPES.length} interface types`)
// eslint-disable-next-line no-console
console.log(`  ${FACET_ORDER.length} facet interfaces`)
// eslint-disable-next-line no-console
console.log(`  ${CONTAINER_TYPES.length} container types`)
// eslint-disable-next-line no-console
console.log(`  + FacetTypeMap, FacetArrays, Facet, InheritedAttributes, CustomFacetInstance`)

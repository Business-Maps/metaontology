/**
 * M0 instance validation - validate data instances against M1 entity definitions.
 * Reuses the M2 validation infrastructure (validateAttributeValue, resolveValueType).
 */

import type { RootContext, Thing, Interface, ValueConstraint, ThingAttribute } from '../types/context'
import type { EntityInstance, FormSubmission } from '../types/instance'
import { validateAttributeValue, resolveValueType, getDatatypeDef } from '../meta/ontology'

export interface InstanceValidationResult {
  valid: boolean
  errors: InstanceValidationError[]
  warnings: InstanceValidationError[]
}

export interface InstanceValidationError {
  field?: string
  message: string
  code:
    | 'missing-required'
    | 'type-mismatch'
    | 'constraint-violation'
    | 'unknown-attribute'
    | 'thing-not-found'
    | 'interface-not-found'
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Find a Thing by ID across root and all contexts. */
export function findThingInModel(model: Readonly<RootContext>, thingId: string): Thing | undefined {
  for (const t of model.facets.things) {
    if (t.uri === thingId) return t
  }
  for (const ctx of Object.values(model.contexts)) {
    for (const t of ctx.facets.things) {
      if (t.uri === thingId) return t
    }
  }
  return undefined
}

/** Find an Interface by ID across root and all contexts. */
function findInterfaceInModel(model: Readonly<RootContext>, interfaceId: string): Interface | undefined {
  for (const iface of model.facets.interfaces) {
    if (iface.uri === interfaceId) return iface
  }
  for (const ctx of Object.values(model.contexts)) {
    for (const iface of ctx.facets.interfaces) {
      if (iface.uri === interfaceId) return iface
    }
  }
  return undefined
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate an M0 EntityInstance against its M1 Thing definition.
 *
 * Checks:
 * - Thing exists in the model
 * - Each attribute value matches the declared type
 * - Value constraints and ValueType constraints are satisfied
 * - All required attributes are present
 * - Unknown attributes produce warnings
 */
export function validateInstance(
  instance: Readonly<EntityInstance>,
  model: Readonly<RootContext>,
): InstanceValidationResult {
  const errors: InstanceValidationError[] = []
  const warnings: InstanceValidationError[] = []

  const thing = findThingInModel(model, instance.thingId)
  if (!thing) {
    return {
      valid: false,
      errors: [{ message: `Thing '${instance.thingId}' not found in model`, code: 'thing-not-found' }],
      warnings: [],
    }
  }

  const attrByName = new Map(thing.attributes.map(a => [a.name, a]))

  // Validate each attribute value in the instance
  for (const [name, attrValue] of Object.entries(instance.attributes)) {
    const thingAttr = attrByName.get(name)

    if (!thingAttr) {
      warnings.push({
        field: name,
        message: `Attribute '${name}' is not defined on Thing '${thing.name}'`,
        code: 'unknown-attribute',
      })
      continue
    }

    // Type mismatch check
    if (attrValue.type !== thingAttr.type) {
      const dtDef = getDatatypeDef(thingAttr.type)
      const label = dtDef?.label ?? thingAttr.type
      errors.push({
        field: name,
        message: `Type mismatch: expected '${label}' but got '${attrValue.type}'`,
        code: 'type-mismatch',
      })
      continue
    }

    // Gather constraints: inline on the attribute + from resolved ValueType
    const allConstraints = [...(thingAttr.constraints ?? [])]
    if (thingAttr.valueTypeId) {
      const vt = resolveValueType(thingAttr.valueTypeId, model.valueTypes)
      if (vt) {
        allConstraints.push(...vt.constraints)
      }
    }

    if (allConstraints.length > 0) {
      const constraintErrors = validateAttributeValue(attrValue.value, allConstraints, name)
      for (const ce of constraintErrors) {
        errors.push({
          field: ce.field,
          message: ce.message,
          code: 'constraint-violation',
        })
      }
    }
  }

  // Check for missing required attributes
  for (const thingAttr of thing.attributes) {
    if (!thingAttr.required) continue
    const provided = instance.attributes[thingAttr.name]
    if (provided === undefined || provided === null) {
      errors.push({
        field: thingAttr.name,
        message: `Required attribute '${thingAttr.name}' is missing`,
        code: 'missing-required',
      })
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate a FormSubmission against the M1 Interface and Thing definitions.
 *
 * Converts the submission's `data` map into an EntityInstance-like structure
 * and delegates to `validateInstance`.
 */
export function validateFormSubmission(
  submission: Readonly<FormSubmission>,
  model: Readonly<RootContext>,
): InstanceValidationResult {
  const errors: InstanceValidationError[] = []
  const warnings: InstanceValidationError[] = []

  const iface = findInterfaceInModel(model, submission.interfaceId)
  if (!iface) {
    return {
      valid: false,
      errors: [{
        message: `Interface '${submission.interfaceId}' not found in model`,
        code: 'interface-not-found',
      }],
      warnings: [],
    }
  }

  const thing = findThingInModel(model, submission.thingId)
  if (!thing) {
    return {
      valid: false,
      errors: [{
        message: `Thing '${submission.thingId}' not found in model`,
        code: 'thing-not-found',
      }],
      warnings: [],
    }
  }

  // Convert raw data to AttributeValue records using Thing attribute type info
  const attrByName = new Map(thing.attributes.map(a => [a.name, a]))
  const attributes: Record<string, { type: string; value: unknown }> = {}
  for (const [key, value] of Object.entries(submission.data)) {
    const thingAttr = attrByName.get(key)
    attributes[key] = {
      type: thingAttr?.type ?? 'text',
      value,
    }
  }

  const syntheticInstance: EntityInstance = {
    thingId: submission.thingId,
    id: '',
    attributes,
    createdAt: submission.submittedAt,
  }

  const result = validateInstance(syntheticInstance, model)
  return {
    valid: result.valid && errors.length === 0,
    errors: [...errors, ...result.errors],
    warnings: [...warnings, ...result.warnings],
  }
}

// ── JSON Schema generation ─────────────────────────────────────────────────

/** Map a datatype id to its JSON Schema type and format. */
function datatypeToJsonSchema(type: string): { type: string; format?: string; items?: Record<string, string> } {
  switch (type) {
    case 'text':
    case 'identifier':
    case 'markdown':
      return { type: 'string' }
    case 'email':
      return { type: 'string', format: 'email' }
    case 'uri':
      return { type: 'string', format: 'uri' }
    case 'integer':
      return { type: 'integer' }
    case 'decimal':
    case 'percentage':
    case 'money':
    case 'quantity':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'date':
      return { type: 'string', format: 'date' }
    case 'dateTime':
      return { type: 'string', format: 'date-time' }
    case 'time':
      return { type: 'string', format: 'time' }
    case 'duration':
      return { type: 'string', format: 'duration' }
    case 'enum':
      return { type: 'string' }
    case 'reference':
      return { type: 'string' }
    case 'list':
      return { type: 'array', items: { type: 'string' } }
    default:
      return { type: 'string' }
  }
}

/** Apply ValueConstraint[] to a JSON Schema property object. */
function applyConstraintsToJsonSchema(
  prop: Record<string, unknown>,
  constraints: readonly ValueConstraint[],
): Record<string, unknown> {
  const out = { ...prop }
  for (const c of constraints) {
    switch (c.type) {
      case 'regex':
        if (c.pattern) out.pattern = c.pattern
        break
      case 'enum':
        if (c.allowedValues?.length) {
          out.enum = c.allowedValues
        }
        break
      case 'range':
        if (c.min !== undefined) out.minimum = c.min
        if (c.max !== undefined) out.maximum = c.max
        break
      case 'length':
        if (c.minLength !== undefined) out.minLength = c.minLength
        if (c.maxLength !== undefined) out.maxLength = c.maxLength
        break
    }
  }
  return out
}

/** Build the JSON Schema property for a single attribute, including ValueType + inline constraints. */
function attributeToJsonSchema(
  attr: ThingAttribute,
  model: Readonly<RootContext>,
): Record<string, unknown> {
  // Special case: enum with declared values
  if (attr.type === 'enum' && attr.enumValues?.length) {
    return { type: 'string', enum: attr.enumValues }
  }

  // Special case: reference produces a UUID string
  if (attr.type === 'reference') {
    return { type: 'string', format: 'uuid' }
  }

  // Built-in ValueType shortcuts
  if (attr.valueTypeId === 'email') return { type: 'string', format: 'email' }
  if (attr.valueTypeId === 'url') return { type: 'string', format: 'uri' }

  // Base schema from datatype
  let prop: Record<string, unknown> = datatypeToJsonSchema(attr.type)

  // Fallback to registry baseType
  if (!prop.type) {
    const dt = getDatatypeDef(attr.type)
    if (dt) {
      switch (dt.baseType) {
        case 'number': prop = { type: 'number' }; break
        case 'boolean': prop = { type: 'boolean' }; break
        default: prop = { type: 'string' }; break
      }
    } else {
      prop = { type: 'string' }
    }
  }

  // Merge constraints: ValueType first, then inline
  const allConstraints: ValueConstraint[] = []
  if (attr.valueTypeId) {
    const vt = resolveValueType(attr.valueTypeId, model.valueTypes)
    if (vt) allConstraints.push(...vt.constraints)
  }
  if (attr.constraints?.length) {
    allConstraints.push(...attr.constraints)
  }
  if (allConstraints.length > 0) {
    prop = applyConstraintsToJsonSchema(prop, allConstraints)
  }

  return prop
}

/**
 * Build a runtime JSON Schema object for a Thing - no codegen step needed.
 * Returns a JSON Schema (draft-07) that validates M0 data against the Thing's attributes.
 */
export function buildJsonSchemaForThing(
  thing: Thing,
  model: Readonly<RootContext>,
): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {}
  const required: string[] = []

  for (const attr of thing.attributes ?? []) {
    properties[attr.name] = attributeToJsonSchema(attr, model)
    if (attr.required) required.push(attr.name)
  }

  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: thing.name,
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }
}

// ── Form Schema derivation ─────────────────────────────────────────────────

export interface FormField {
  name: string
  label: string
  type: string
  required: boolean
  constraints: ValueConstraint[]
  enumValues?: string[]
  widget: string
}

export interface FormSchemaResult {
  fields: FormField[]
  thingId: string
  interfaceName: string
}

/** Title-case a camelCase or kebab-case string for form labels. */
function toLabel(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

/** Infer a form widget type from a datatype id. */
function inferWidget(type: string, attr: ThingAttribute): string {
  if (attr.enumValues?.length) return 'select'
  switch (type) {
    case 'text':
    case 'identifier':
      return 'text'
    case 'email':
      return 'email'
    case 'uri':
      return 'url'
    case 'markdown':
      return 'textarea'
    case 'integer':
    case 'decimal':
    case 'percentage':
    case 'money':
    case 'quantity':
      return 'number'
    case 'boolean':
      return 'checkbox'
    case 'date':
      return 'date'
    case 'dateTime':
      return 'datetime'
    case 'time':
      return 'time'
    case 'duration':
      return 'text'
    case 'enum':
      return 'select'
    case 'reference':
      return 'reference'
    case 'list':
      return 'list'
    default:
      return 'text'
  }
}

/**
 * Derive a form schema from an M1 Interface + its linked Thing(s).
 *
 * Resolution order:
 * 1. Interface.sourceThingId (direct field on the Interface)
 * 2. Links with predicate 'displays' from the Interface to a Thing
 *
 * Maps each ThingAttribute to a FormField with label, widget hint, and
 * merged constraints (ValueType + inline).
 */
export function resolveFormSchema(
  model: Readonly<RootContext>,
  interfaceId: string,
): FormSchemaResult | { error: string } {
  const iface = findInterfaceInModel(model, interfaceId)
  if (!iface) {
    return { error: `Interface '${interfaceId}' not found in model` }
  }

  // Resolve the linked Thing - prefer sourceThingId, fall back to 'displays' link
  let thingId: string | undefined = iface.sourceThingId
  if (!thingId) {
    const link = model.links.find(
      l => l.sourceUri === interfaceId && l.predicate === 'displays',
    )
    thingId = link?.targetUri
  }

  if (!thingId) {
    return { error: `No Thing linked to Interface '${iface.name}' (no sourceThingId or 'displays' link)` }
  }

  const thing = findThingInModel(model, thingId)
  if (!thing) {
    return { error: `Thing '${thingId}' referenced by Interface '${iface.name}' not found in model` }
  }

  const fields: FormField[] = (thing.attributes ?? []).map(attr => {
    // Merge constraints: ValueType first, then inline
    const constraints: ValueConstraint[] = []
    if (attr.valueTypeId) {
      const vt = resolveValueType(attr.valueTypeId, model.valueTypes)
      if (vt) constraints.push(...vt.constraints)
    }
    if (attr.constraints?.length) {
      constraints.push(...attr.constraints)
    }

    // Collect enum values from attribute or from enum constraint
    let enumValues: string[] | undefined = attr.enumValues
    if (!enumValues?.length) {
      const enumConstraint = constraints.find(c => c.type === 'enum')
      if (enumConstraint?.allowedValues?.length) {
        enumValues = enumConstraint.allowedValues
      }
    }

    return {
      name: attr.name,
      label: toLabel(attr.name),
      type: attr.type,
      required: attr.required ?? false,
      constraints,
      ...(enumValues?.length ? { enumValues } : {}),
      widget: inferWidget(attr.type, attr),
    }
  })

  return {
    fields,
    thingId,
    interfaceName: iface.name,
  }
}

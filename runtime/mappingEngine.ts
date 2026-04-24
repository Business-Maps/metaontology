/**
 * Pipeline Mapping Engine - →
 * mappedInstances.
 *
 * **What this engine handles:**
 *
 *  1. **iterate** - walks a JSONata-style path into a response to find
 *     the record array. `'$.data'` extracts `response.data`. Omit for
 *     single-record responses.
 *  2. **identity** - the upsert key. Each mapped instance carries an
 *     `externalId` extracted from the record via a JSONata path.
 *  3. **field mapping (simple)** - a string value is treated as a
 *     JSONata path: `{ email: '$.customer.email' }` maps
 *     `record.customer.email` → `instance.email`.
 *  4. **field mapping (with transform)** - a FieldMapping object carries
 *     a Function ID whose runtime output becomes the value. The mapping
 *     engine delegates transform execution to an injected `invokeTransform`
 *     callback so the mapping engine stays free of the function runtime.
 *  5. **link mapping** - each mapping-level link resolves a target
 *     Thing instance by externalId and attaches an outgoing link edge.
 *  6. **filter** - a JSONata predicate that runs per record; false
 *     records are skipped.
 *  7. **missing required field** - if a mapping specifies a field but
 *     the source record is missing the value AND no defaultValue is
 *     provided, the record is reported as a mapping error (not silently
 *     dropped).
 *  8. **idempotency on re-run** - the same input + same mapping
 *     produces identical output. Callers can run the engine twice and
 *     expect byte-equal results (modulo the order of object keys).
 *
 *  **JSONata subset:**
 *
 *  A full JSONata implementation is its own library. This engine ships a
 *  minimal subset sufficient for the supported cases:
 *    - `$.path.to.field` - dot-path lookup (with the leading `$` meaning
 *      "the current record"). Also `path.to.field` without the `$`.
 *    - `$` - the current record.
 *    - literal values - numbers, strings in double-quotes, `true`,
 *      `false`, `null`.
 *
 *  More advanced JSONata (functions, array slices, conditionals) can be
 *  added by swapping the `evalPath` implementation for a real JSONata engine.
 */

import type { PipelineMapping, FieldMapping, LinkMapping } from '../types/context'

// ── Types ──────────────────────────────────────────────────────────────────

export interface MappedInstance {
  /** The upsert key extracted via `mapping.identity.externalId`. */
  externalId: string
  /** The mapped fields. */
  fields: Record<string, unknown>
  /** The mapped outgoing links for this instance. */
  links: Array<{ predicate: string; targetThingId: string; targetExternalId: string }>
}

export interface MappingError {
  /** Index of the source record that failed. */
  recordIndex: number
  /** The raw source record (for debugging). */
  record: unknown
  /** Human-readable error reason. */
  reason: string
  /** If set: which field failed. */
  field?: string
}

export interface MappingResult {
  /** Successfully mapped instances. */
  instances: MappedInstance[]
  /** Records that failed to map (missing required fields, filter eval errors). */
  errors: MappingError[]
  /** Records the filter predicate excluded. */
  skipped: number
}

/** Options passed to `runMapping`. */
export interface MappingRuntimeOptions {
/**
 * Invoke a transform Function by id with a raw source value. The
 * engine delegates to this callback rather than owning a runtime -
 * callers compose the function runtime or pass a stub here for unit tests.
 *
 * Return `undefined` to signal the transform failed and should not
 * produce a field value.
 */
  invokeTransform?(functionId: string, value: unknown, record: unknown): unknown
}

// ── JSONata-subset path evaluation ─────────────────────────────────────────

/**
 * Evaluate a JSONata-subset path against a record.
 *
 * Supported:
 *   - `$`        - returns the record itself
 *   - `$.a.b.c`  - returns record.a.b.c (undefined if any step is missing)
 *   - `a.b.c`    - same as above without the `$` prefix
 *   - literals   - `"hello"`, `42`, `true`, `false`, `null`
 *
 * Unsupported paths return `undefined` - the caller decides whether that
 * is a missing-required-field error or a default-value fallback.
 */
export function evalPath(expr: string, record: unknown): unknown {
  if (expr === undefined || expr === null) return undefined
  const trimmed = expr.trim()
  if (trimmed === '') return undefined

  // Literals
  if (trimmed === '$') return record
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  // Number literal
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  // Double-quoted string literal
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1)
  }

  // Dot-path - optionally starting with `$.`
  const path = trimmed.startsWith('$.') ? trimmed.slice(2) : trimmed
  const parts = path.split('.').filter(Boolean)
  let cur: unknown = record
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined
    if (typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

/** Evaluate a JSONata-subset predicate - truthy means "keep this record". */
export function evalPredicate(expr: string, record: unknown): boolean {
  const value = evalPath(expr, record)
  return Boolean(value)
}

// ── FieldMapping coercion ──────────────────────────────────────────────────

/**
 * Normalize a field-value spec into a FieldMapping object. A bare string
 * is shorthand for `{ source: str }`.
 */
function toFieldMapping(spec: string | FieldMapping): FieldMapping {
  if (typeof spec === 'string') {
    return { source: spec }
  }
  return spec
}

// ── Main entry point ──────────────────────────────────────────────────────

/**
 * Run a PipelineMapping over a set of source records.
 *
 * **Inputs:**
 *  - `sourceResponse` - what the transport returned. If `mapping.iterate`
 *    is set, that path is walked to find the record array; otherwise the
 *    response is treated as a single record.
 *  - `mapping` - the PipelineMapping spec from the Pipeline facet.
 *  - `opts.invokeTransform` - optional callback for field transforms.
 *
 * **Output:** `{ instances, errors, skipped }`.
 *  - `instances` is ordered by source-record order (idempotent across runs).
 *  - `errors` captures records with missing required fields or filter
 *    evaluation failures.
 *  - `skipped` counts records the filter predicate dropped.
 */
export function runMapping(
  sourceResponse: unknown,
  mapping: PipelineMapping,
  opts: MappingRuntimeOptions = {},
): MappingResult {
  const instances: MappedInstance[] = []
  const errors: MappingError[] = []
  let skipped = 0

  // Case 1: iterate - walk the path to find the record array. Single-record
  // responses have no iterate and are wrapped in a one-element array.
  const records: unknown[] = mapping.iterate
    ? toArray(evalPath(mapping.iterate, sourceResponse))
    : [sourceResponse]

  for (let i = 0; i < records.length; i++) {
    const record = records[i]

    // Case 6: filter - records that evaluate falsy are skipped
    if (mapping.filter) {
      try {
        if (!evalPredicate(mapping.filter, record)) {
          skipped++
          continue
        }
      } catch (e) {
        errors.push({
          recordIndex: i,
          record,
          reason: `Filter evaluation failed: ${e instanceof Error ? e.message : String(e)}`,
        })
        continue
      }
    }

    // Case 2: identity - extract the upsert key
    const idPath = mapping.identity.externalId
    const externalIdRaw = evalPath(idPath, record)
    if (externalIdRaw === undefined || externalIdRaw === null) {
      errors.push({
        recordIndex: i,
        record,
        reason: `identity.externalId path "${idPath}" did not resolve to a value`,
        field: 'externalId',
      })
      continue
    }
    const externalId = String(externalIdRaw)

    // Cases 3-4: field mapping (simple + with transform)
    const fields: Record<string, unknown> = {}
    let fieldError: MappingError | null = null

    for (const [targetField, spec] of Object.entries(mapping.fields)) {
      const fm = toFieldMapping(spec as string | FieldMapping)
      let value = evalPath(fm.source, record)

      // Transform via Function id
      if (fm.transform && value !== undefined && opts.invokeTransform) {
        try {
          value = opts.invokeTransform(fm.transform, value, record)
        } catch (e) {
          fieldError = {
            recordIndex: i,
            record,
            reason: `Transform "${fm.transform}" failed on field "${targetField}": ${e instanceof Error ? e.message : String(e)}`,
            field: targetField,
          }
          break
        }
      }

      // Case 7: missing required - if the source value is undefined AND
      // no defaultValue was provided, report it. (Null is a valid value;
      // only undefined means "missing".)
      if (value === undefined) {
        if (fm.defaultValue !== undefined) {
          value = fm.defaultValue
        } else {
          fieldError = {
            recordIndex: i,
            record,
            reason: `Required field "${targetField}" resolved to undefined (source path: "${fm.source}")`,
            field: targetField,
          }
          break
        }
      }

      fields[targetField] = value
    }

    if (fieldError) {
      errors.push(fieldError)
      continue
    }

    // Case 5: link mapping - resolve target instance by externalId
    const links: MappedInstance['links'] = []
    for (const link of (mapping.links ?? []) as LinkMapping[]) {
      const targetExternalIdRaw = evalPath(link.match, record)
      if (targetExternalIdRaw === undefined || targetExternalIdRaw === null) {
        // A link that doesn't resolve is *not* a hard error - the target
        // record might not have been ingested yet. The caller decides
        // whether to log or reconcile later.
        continue
      }
      links.push({
        predicate: link.predicate,
        targetThingId: link.targetThingId,
        targetExternalId: String(targetExternalIdRaw),
      })
    }

    instances.push({ externalId, fields, links })
  }

  return { instances, errors, skipped }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null) return []
  return [value]
}

// ── Reverse mapping (writeback) ──────────────────────────────────────────
//
// Given an instance's field data and a reverse PipelineMapping, produce the
// payload to send back to the source system. This is the inverse of
// `runMapping` - instead of source→instance, it's instance→source.

export interface ReverseMappedPayload {
  /** The external id for the source system record. */
  externalId: string
  /** The reverse-mapped fields in the source system's shape. */
  data: Record<string, unknown>
}

/**
 * Reverse-map an instance's data to the source system format.
 *
 * The `reverseMapping` is the Pipeline's `writeback.mapping`. Its `fields`
 * map source-system field names (keys) to JSONata paths into the instance
 * data (values). In the simplest case, this inverts the forward mapping:
 *
 *   Forward:  { name: '$.name', email: '$.email' }
 *   Reverse:  { name: '$.name', email: '$.email' }
 *
 * The identity.externalId path is evaluated against the instance data to
 * resolve the source system's record id.
 */
export function reverseMap(
  instanceData: Record<string, unknown>,
  externalId: string,
  reverseMapping: PipelineMapping,
  opts: MappingRuntimeOptions = {},
): ReverseMappedPayload {
  const data: Record<string, unknown> = {}

  for (const [sourceField, spec] of Object.entries(reverseMapping.fields)) {
    const fm = toFieldMapping(spec as string | FieldMapping)
    let value = evalPath(fm.source, instanceData)

    if (fm.transform && value !== undefined && opts.invokeTransform) {
      value = opts.invokeTransform(fm.transform, value, instanceData)
    }

    if (value !== undefined) {
      data[sourceField] = value
    } else if (fm.defaultValue !== undefined) {
      data[sourceField] = fm.defaultValue
    }
  }

  return { externalId, data }
}

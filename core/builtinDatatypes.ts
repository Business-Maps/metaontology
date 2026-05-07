/**
 * Built-in datatypes - the 18 XSD-grounded attribute types in the
 * BM framework. Registered via `defineDatatype` so the DSL registry
 * can enumerate them at runtime.
 */

import { defineDatatype } from '../dsl/defineGeneric'

// ── String family ────────────────────────────────────────────────────────────

export const textDt = defineDatatype('text', {
  xsd: 'xsd:string', baseType: 'string', tsType: 'string',
  label: { en: 'Text' }, description: 'Free-form text', shortLabel: 'str',
})

export const identifierDt = defineDatatype('identifier', {
  xsd: 'xsd:token', baseType: 'string', tsType: 'string',
  label: { en: 'Identifier' }, description: 'Short code or ID (no whitespace)',
  pattern: '\\S+', shortLabel: 'id',
})

export const emailDt = defineDatatype('email', {
  xsd: 'xsd:string', baseType: 'string', tsType: 'string',
  label: { en: 'Email' }, description: 'Email address', shortLabel: 'email',
})

export const uriDt = defineDatatype('uri', {
  xsd: 'xsd:anyURI', baseType: 'string', tsType: 'string',
  label: { en: 'URI' }, description: 'URL or URI', shortLabel: 'uri',
})

export const markdownDt = defineDatatype('markdown', {
  xsd: 'xsd:string', baseType: 'string', tsType: 'string',
  label: { en: 'Rich Text' }, description: 'Markdown-formatted text', shortLabel: 'md',
})

/**
 * Structured rich content document — ProseMirror-compatible tree of
 * typed blocks with stable ids. Declared as `complex` because the
 * serialized value is an object, not a primitive. The tsType resolves
 * to the generated `RichDoc` interface (see typeRegistry INTERFACE_TYPES).
 *
 * RDF representation: the doc is not a single literal. A dedicated
 * serializer walks its block tree and emits `dct:hasPart` / `schema:text`
 * / block-type-specific triples. `rdf:JSON` is used here as the closest
 * standard tag for opaque structured payloads when a downstream consumer
 * needs to serialize the raw tree (e.g. for backup / interop).
 */
export const richDocDt = defineDatatype('richDoc', {
  xsd: 'rdf:JSON', baseType: 'complex', tsType: 'RichDoc',
  label: { en: 'Rich Content' }, description: 'Structured content doc (headings, lists, todos, mentions, embeds — walkable to triples)', shortLabel: 'doc',
})

// ── Number family ────────────────────────────────────────────────────────────

export const integerDt = defineDatatype('integer', {
  xsd: 'xsd:integer', baseType: 'number', tsType: 'number',
  label: { en: 'Whole Number' }, description: 'Whole number (no decimals)', shortLabel: 'int',
})

export const decimalDt = defineDatatype('decimal', {
  xsd: 'xsd:decimal', baseType: 'number', tsType: 'number',
  label: { en: 'Decimal' }, description: 'Precise decimal number', shortLabel: 'dec',
})

export const percentageDt = defineDatatype('percentage', {
  xsd: 'xsd:decimal', baseType: 'number', tsType: 'number',
  label: { en: 'Percentage' }, description: 'Value expressed as a percentage', shortLabel: '%',
})

export const moneyDt = defineDatatype('money', {
  xsd: 'xsd:decimal', baseType: 'number', tsType: 'number',
  label: { en: 'Money' }, description: 'Monetary amount with currency',
  extraFields: ['currencyCode'], shortLabel: '$',
})

export const quantityDt = defineDatatype('quantity', {
  xsd: 'xsd:decimal', baseType: 'number', tsType: 'number',
  label: { en: 'Quantity' }, description: 'Measured value with unit',
  extraFields: ['unit'], shortLabel: 'qty',
})

// ── Temporal family ──────────────────────────────────────────────────────────

export const dateDt = defineDatatype('date', {
  xsd: 'xsd:date', baseType: 'temporal', tsType: 'Date',
  label: { en: 'Date' }, description: 'Calendar date (no time)', shortLabel: 'date',
})

export const dateTimeDt = defineDatatype('dateTime', {
  xsd: 'xsd:dateTime', baseType: 'temporal', tsType: 'Date',
  label: { en: 'Date & Time' }, description: 'Date with time of day', shortLabel: 'dt',
})

export const timeDt = defineDatatype('time', {
  xsd: 'xsd:time', baseType: 'temporal', tsType: 'string',
  label: { en: 'Time' }, description: 'Time of day only', shortLabel: 'time',
})

export const durationDt = defineDatatype('duration', {
  xsd: 'xsd:duration', baseType: 'temporal', tsType: 'string',
  label: { en: 'Duration' }, description: 'Length of time (e.g., P2D, PT30M)', shortLabel: 'dur',
})

// ── Boolean ──────────────────────────────────────────────────────────────────

export const booleanDt = defineDatatype('boolean', {
  xsd: 'xsd:boolean', baseType: 'boolean', tsType: 'boolean',
  label: { en: 'Yes / No' }, description: 'True or false flag', shortLabel: 'bool',
})

// ── Complex ──────────────────────────────────────────────────────────────────

export const referenceDt = defineDatatype('reference', {
  xsd: 'owl:ObjectProperty', baseType: 'complex', tsType: 'string',
  label: { en: 'Reference' }, description: 'Link to another Thing', shortLabel: 'ref',
})

export const enumDt = defineDatatype('enum', {
  xsd: 'xsd:string', baseType: 'complex', tsType: 'string',
  label: { en: 'Choice' }, description: 'One of a fixed set of values', shortLabel: 'enum',
})

export const listDt = defineDatatype('list', {
  xsd: 'rdf:List', baseType: 'complex', tsType: 'string[]',
  label: { en: 'List' }, description: 'Ordered collection of values', shortLabel: 'list',
})

/**
 * Three-tier export bundle - packages M2 (metaontology), M1 (user model),
 * and M0 (instance data) into a single self-describing artifact.
 */

import type { RootContext } from '../types/context'
import type { InstanceDataset } from '../types/instance'
import { ENTITY_CLASSES, PREDICATES, DATATYPE_REGISTRY, getBmNamespace } from '../meta/ontology'
import { projectToTriples, serialiseAsTurtle } from '../engine/triples'
import { projectInstancesToTriples } from '../engine/instanceTriples'
import {
  generateTypeScriptTypes,
  generateZodSchemas,
  generateActionFunctions,
  generateEventSchemas,
  generateGlossary,
  generateClaudeMd,
} from '../generate'

// ── Bundle types ────────────────────────────────────────────────────────────

/** Snapshot of M2 definitions used by this model */
export interface MetaontologyManifest {
  version: string
  namespace: string
  entityClassCount: number
  predicateCount: number
  datatypeCount: number
}

/** Pre-generated code artifacts (optional convenience) */
export interface GeneratedArtifacts {
  typescriptTypes?: string
  zodSchemas?: string
  actionFunctions?: string
  eventSchemas?: string
  glossary?: string
  claudeMd?: string
}

/** Complete three-tier export */
export interface BusinessMapBundle {
  /** Format version for forward compatibility */
  bundleVersion: '1.0'

  /** M2: The metaontology definitions used by this model */
  metaontology: MetaontologyManifest

  /** M1: The user's domain model */
  model: RootContext

  /** M0: Optional runtime instance data */
  instances?: InstanceDataset

  /** Pre-generated artifacts (optional) */
  generated?: GeneratedArtifacts

  /** Export metadata */
  exportedAt: string
}

// ── Build options ───────────────────────────────────────────────────────────

export interface BuildBundleOptions {
  includeGenerated?: boolean
}

// ── Bundle builder ──────────────────────────────────────────────────────────

export function buildBundle(
  model: RootContext,
  instances?: InstanceDataset,
  options?: BuildBundleOptions,
): BusinessMapBundle {
  const bmNamespace = getBmNamespace()
  const bundle: BusinessMapBundle = {
    bundleVersion: '1.0',
    metaontology: {
      version: '1.0',
      namespace: bmNamespace,
      entityClassCount: Object.keys(ENTITY_CLASSES).length,
      predicateCount: Object.keys(PREDICATES).length,
      datatypeCount: DATATYPE_REGISTRY.length,
    },
    model,
    exportedAt: new Date().toISOString(),
  }

  if (instances) {
    bundle.instances = instances
  }

  if (options?.includeGenerated) {
    bundle.generated = {
      typescriptTypes: generateTypeScriptTypes(model),
      zodSchemas: generateZodSchemas(model),
      actionFunctions: generateActionFunctions(model),
      eventSchemas: generateEventSchemas(model),
      glossary: generateGlossary(model),
      claudeMd: generateClaudeMd(model),
    }
  }

  return bundle
}

// ── Bundle validation ───────────────────────────────────────────────────────

export interface BundleValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validateBundle(bundle: BusinessMapBundle): BundleValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Check bundle version
  if (bundle.bundleVersion !== '1.0') {
    warnings.push(`Unknown bundle version: ${bundle.bundleVersion}`)
  }

  // Check model has required fields
  if (!bundle.model) {
    errors.push('Bundle is missing the M1 model')
  } else {
    if (!bundle.model.meta?.createdAt) {
      warnings.push('Model is missing meta.createdAt')
    }
  }

  // Check M2 manifest
  if (!bundle.metaontology) {
    errors.push('Bundle is missing metaontology manifest')
  }

  // Check M0 instance consistency (if present)
  if (bundle.instances) {
    for (const entity of bundle.instances.entities) {
      if (!entity.thingId) {
        errors.push(`Entity instance ${entity.id} is missing thingId`)
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

// ── Three-tier RDF dataset export ──────────────────────────────────────────

/**
 * Serialise a bundle as a TriG dataset with named graphs for each tier:
 *
 *   GRAPH bm:meta        { M2 ontology definitions }
 *   GRAPH <urn:map:{id}> { M1 model triples }
 *   GRAPH <urn:map:{id}/instances> { M0 instance triples }
 *
 * TriG is the named-graph extension of Turtle (W3C recommendation).
 */
export function serialiseBundleAsTriG(bundle: BusinessMapBundle): string {
  const bmNamespace = getBmNamespace()
  const lines: string[] = [
    `@prefix bm: <${bmNamespace}> .`,
    '@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .',
    '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
    '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .',
    '',
  ]

  // ── M2: Metaontology definitions ──────────────────────────────────────
  lines.push('# M2: Metaontology definitions')
  lines.push('GRAPH bm:meta {')
  for (const cls of Object.values(ENTITY_CLASSES)) {
    lines.push(`  <${cls.uri}> a rdfs:Class ; rdfs:label "${cls.labels.en}" .`)
  }
  for (const pred of Object.values(PREDICATES)) {
    const domain = pred.domain.map((d: string) => `<${bmNamespace}${d}>`).join(', ')
    const range = pred.range.map((r: string) => `<${bmNamespace}${r}>`).join(', ')
    lines.push(`  <${bmNamespace}${pred.id}> a rdf:Property ; rdfs:label "${pred.labels.en}"`)
    if (domain) lines.push(`    ; rdfs:domain ${domain}`)
    if (range) lines.push(`    ; rdfs:range ${range}`)
    lines.push('    .')
  }
  lines.push('}')
  lines.push('')

  // ── M1: User model ────────────────────────────────────────────────────
  const mapId = bundle.model.uri ?? 'unknown'
  const m1Triples = projectToTriples(bundle.model)
  lines.push('# M1: User model')
  lines.push(`GRAPH <urn:businessmap:${mapId}> {`)
  const m1Turtle = serialiseAsTurtle(m1Triples)
  // Indent each line and strip the @prefix declarations (already at top)
  for (const line of m1Turtle.split('\n')) {
    if (line.startsWith('@prefix') || line.trim() === '') continue
    lines.push(`  ${line}`)
  }
  lines.push('}')
  lines.push('')

  // ── M0: Instance data (if present) ────────────────────────────────────
  if (bundle.instances && bundle.instances.entities.length > 0) {
    const m0Triples = projectInstancesToTriples(bundle.instances, bundle.model)
    lines.push('# M0: Instance data')
    lines.push(`GRAPH <urn:businessmap:${mapId}/instances> {`)
    for (const t of m0Triples) {
      const subj = t.subject.startsWith('http') ? `<${t.subject}>` : `<${bmNamespace}${t.subject}>`
      const pred = t.predicate.startsWith('http') ? `<${t.predicate}>` : `<${bmNamespace}${t.predicate}>`
      const obj = t.object.startsWith('http') ? `<${t.object}>` : `"${t.object}"`
      lines.push(`  ${subj} ${pred} ${obj} .`)
    }
    lines.push('}')
    lines.push('')
  }

  return lines.join('\n')
}

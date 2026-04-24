/// <reference lib="dom" />
/**
 * Browser download helpers for exporting business maps.
 *
 * These functions trigger a file download in the browser. They wrap
 * the pure content generators from ./export with Blob creation and
 * an anchor-click download. Only import this module in browser
 * contexts (not Node, not SSR).
 */

import type { RootContext } from '../types/context'
import { exportMarkdownContent, generateTypeScriptTypes, generateEventSchemas, generateGuardFunctions, generateTestSkeletons, generateServiceBoundaries } from './export'
import { projectToTriples, serialiseAsTurtle, serialiseAsNTriples, serialiseAsJsonLd } from '../engine/triples'

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function safeName(name: string) {
  return name.replace(/\s+/g, '-').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'map'
}

export function exportAsJSON(map: RootContext): void {
  const json = JSON.stringify(map, null, 2)
  downloadBlob(new Blob([json], { type: 'application/json' }), `${safeName(map.name)}.businessmap.json`)
}

export function exportAsModelJSON(map: RootContext): void {
  const json = JSON.stringify(map, null, 2)
  downloadBlob(new Blob([json], { type: 'application/json' }), `${safeName(map.name)}.model.json`)
}

export function exportAsMarkdown(map: RootContext): void {
  const content = exportMarkdownContent(map)
  downloadBlob(
    new Blob([content], { type: 'text/markdown' }),
    `${safeName(map.name)}.md`,
  )
}

export function exportAsTurtle(map: RootContext): void {
  const triples = projectToTriples(map)
  const turtle = serialiseAsTurtle(triples)
  downloadBlob(new Blob([turtle], { type: 'text/turtle' }), `${safeName(map.name)}.ttl`)
}

export function exportAsNTriples(map: RootContext): void {
  const triples = projectToTriples(map)
  const nt = serialiseAsNTriples(triples)
  downloadBlob(new Blob([nt], { type: 'application/n-triples' }), `${safeName(map.name)}.nt`)
}

export function exportAsJsonLd(map: RootContext): void {
  const triples = projectToTriples(map)
  const jsonld = serialiseAsJsonLd(triples)
  downloadBlob(new Blob([jsonld], { type: 'application/ld+json' }), `${safeName(map.name)}.jsonld`)
}

export function exportAsEngineeringSchema(map: RootContext): void {
  const sections = [
    generateTypeScriptTypes(map),
    generateEventSchemas(map),
    generateGuardFunctions(map),
    generateTestSkeletons(map),
    generateServiceBoundaries(map),
  ]

  const content = sections.join('\n\n')
  downloadBlob(
    new Blob([content], { type: 'text/typescript' }),
    `${safeName(map.name)}-engineering-schema.ts`,
  )
}

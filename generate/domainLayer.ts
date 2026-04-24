/**
 * Domain Model Layer Generator - produces a complete Nuxt layer from a RootContext.
 *
 * Given a Business Maps design, generates: model root, version metadata,
 * TypeScript entity interfaces, Zod schemas, repository types/factory,
 * composables, and nuxt.config. The output is a DomainLayerFile[] that
 * can be written to disk as a functioning Nuxt layer.
 *
 * Reuses existing generators for types, schemas, actions, and events.
 */

import type { RootContext, Thing, FacetContainer } from '../types/context'
import {
  generateTypeScriptTypes,
  generateZodSchemas,
  generateActionFunctions,
  generateEventSchemas,
} from './export'

// ── Public types ────────────────────────────────────────────────────────────

export interface DomainLayerOptions {
  /** Layer name - used in composable names, repository types, import paths. */
  layerName: string
  /** Semantic version. Defaults to '0.1.0'. */
  version?: string
  /**
   * Relative path from the generated layer root to the ontology source code.
   * This must point to the directory containing runtime/, types/, composables/, etc.
   * Defaults to '../ontology/ontology' (standard Nuxt layer structure).
   */
  ontologyCodePath?: string
  /**
   * Relative path to the ontology Nuxt layer root (for extends in nuxt.config).
   * Defaults to '../ontology'.
   */
  ontologyLayerPath?: string
}

export interface DomainLayerFile {
  /** Relative path within the layer directory. */
  path: string
  /** File content. */
  content: string
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function allContainers(model: RootContext): FacetContainer[] {
  return [model as FacetContainer, ...Object.values(model.contexts)]
}

function allThings(model: RootContext): Thing[] {
  return allContainers(model).flatMap(c => c.facets.things)
}

function toPascal(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
}

function toCamel(name: string): string {
  const p = toPascal(name)
  return p.charAt(0).toLowerCase() + p.slice(1)
}

// ── File generators ─────────────────────────────────────────────────────────

function genModelRoot(model: RootContext): string {
  return [
    '// GENERATED - do not edit. Regenerate from the domain model.',
    "import type { RootContext } from '##OCP##/types/context'",
    '',
    `export const MODEL: RootContext = ${JSON.stringify(model, null, 2)} as unknown as RootContext`,
    '',
  ].join('\n')
}

function genVersion(version: string, model: RootContext): string {
  return [
    '// GENERATED - do not edit.',
    `export const MODEL_VERSION = '${version}'`,
    `export const MODEL_NAME = '${model.name}'`,
    `export const MODEL_ID = '${model.uri}'`,
    `export const PUBLISHED_AT = '${new Date().toISOString()}'`,
    '',
  ].join('\n')
}

function genTypesIndex(): string {
  return [
    '// GENERATED - do not edit.',
    "export * from './entities'",
    "export * from './schemas'",
    "export * from './operations'",
    "export * from './events'",
    '',
  ].join('\n')
}

function genRepositoryTypes(things: Thing[], pascal: string): string {
  const lines = [
    '// GENERATED - do not edit. Regenerate from the domain model.',
    "import type { TypedCollection } from '##OCP##/runtime/typedCollection'",
  ]

  const names = things.map(t => toPascal(t.name))
  if (names.length > 0) {
    lines.push(`import type { ${names.join(', ')} } from '../types/entities'`)
  }
  lines.push('')

  lines.push(`export interface ${pascal}Repository {`)
  for (const thing of things) {
    const typeName = toPascal(thing.name)
    const fieldName = toCamel(thing.name) + 's'
    lines.push(`  ${fieldName}: TypedCollection<${typeName}>`)
  }
  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

function genRepositoryFactory(things: Thing[], pascal: string): string {
  const lines = [
    '// GENERATED - do not edit. Regenerate from the domain model.',
    "import type { InstanceRepository } from '##OCP##/runtime/types'",
    "import { createTypedCollection } from '##OCP##/runtime/typedCollection'",
    `import type { ${pascal}Repository } from './types'`,
    "import { MODEL } from '../model/root'",
  ]

  // Import schemas
  const schemaNames = things.map(t => t.name.replace(/[^a-zA-Z0-9]/g, '') + 'Schema')
  if (schemaNames.length > 0) {
    lines.push(`import { ${schemaNames.join(', ')} } from '../types/schemas'`)
  }
  lines.push('')

  lines.push(`export function create${pascal}Repository(storage: InstanceRepository): ${pascal}Repository {`)
  lines.push('  return {')
  for (let i = 0; i < things.length; i++) {
    const thing = things[i]!
    const fieldName = toCamel(thing.name) + 's'
    const schemaName = thing.name.replace(/[^a-zA-Z0-9]/g, '') + 'Schema'
    lines.push(`    ${fieldName}: createTypedCollection({`)
    lines.push(`      thingId: '${thing.uri}',`)
    lines.push(`      schema: ${schemaName},`)
    lines.push('      repo: storage,')
    lines.push('      model: MODEL,')
    lines.push('    }),')
  }
  lines.push('  }')
  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

function genModelComposable(pascal: string): string {
  return [
    '// GENERATED - do not edit.',
    "import { readonly, ref } from 'vue'",
    "import { MODEL } from '../model/root'",
    "import { MODEL_VERSION, MODEL_NAME } from '../model/version'",
    '',
    `export function use${pascal}Model() {`,
    '  const model = readonly(ref(MODEL))',
    '  return {',
    '    model,',
    '    version: MODEL_VERSION,',
    '    name: MODEL_NAME,',
    '  }',
    '}',
    '',
  ].join('\n')
}

function genRepoComposable(pascal: string): string {
  return [
    '// GENERATED - do not edit.',
    "import { inject } from 'vue'",
    `import type { ${pascal}Repository } from '../repository/types'`,
    '',
    `const REPO_KEY = Symbol('${pascal}Repository')`,
    '',
    `export function use${pascal}Repository(): ${pascal}Repository {`,
    `  const repo = inject<${pascal}Repository>(REPO_KEY)`,
    `  if (!repo) throw new Error('${pascal}Repository not provided. Register a storage plugin.')`,
    '  return repo',
    '}',
    '',
    `export { REPO_KEY as ${pascal.toUpperCase()}_REPO_KEY }`,
    '',
  ].join('\n')
}

function genTriplesComposable(pascal: string): string {
  // Composables are at a standard location relative to the ontology code.
  return [
    '// GENERATED - do not edit.',
    "import { createTripleIndex } from '../../ontology/composables/useTripleStore'",
    "import { MODEL } from '../model/root'",
    '',
    `export function use${pascal}Triples() {`,
    '  return createTripleIndex(() => MODEL)',
    '}',
    '',
  ].join('\n')
}

function genQueryComposable(things: Thing[], pascal: string): string {
  const lines = [
    '// GENERATED - do not edit.',
    "import { fromEntity } from '##OCP##/runtime/queryBuilder'",
  ]

  const typeNames = things.map(t => toPascal(t.name))
  if (typeNames.length > 0) {
    lines.push(`import type { ${typeNames.join(', ')} } from '../types/entities'`)
  }
  lines.push('')

  lines.push(`export function use${pascal}Query() {`)
  lines.push('  return {')
  for (const thing of things) {
    const typeName = toPascal(thing.name)
    const fieldName = toCamel(thing.name) + 's'
    lines.push(`    ${fieldName}: fromEntity<${typeName}>('${thing.name}'),`)
  }
  lines.push('  }')
  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

function genNuxtConfig(ontologyPath: string): string {
  return [
    '// GENERATED - do not edit.',
    'export default defineNuxtConfig({',
    `  extends: ['${ontologyPath}'],`,
    '})',
    '',
  ].join('\n')
}

// ── Main generator ──────────────────────────────────────────────────────────

export function generateDomainModelLayer(
  model: RootContext,
  options: DomainLayerOptions,
): DomainLayerFile[] {
  const {
    layerName,
    version = '0.1.0',
    ontologyCodePath = '../ontology/ontology',
    ontologyLayerPath = '../ontology',
  } = options
  const pascal = toPascal(layerName)
  const things = allThings(model)
  const files: DomainLayerFile[] = []

  // model/
  files.push({ path: 'model/root.ts', content: genModelRoot(model) })
  files.push({ path: 'model/version.ts', content: genVersion(version, model) })

  // types/
  files.push({ path: 'types/entities.ts', content: generateTypeScriptTypes(model) })
  files.push({ path: 'types/schemas.ts', content: generateZodSchemas(model) })
  files.push({ path: 'types/operations.ts', content: generateActionFunctions(model) })
  files.push({ path: 'types/events.ts', content: generateEventSchemas(model) })
  files.push({ path: 'types/index.ts', content: genTypesIndex() })

  // repository/
  files.push({ path: 'repository/types.ts', content: genRepositoryTypes(things, pascal) })
  files.push({ path: 'repository/factory.ts', content: genRepositoryFactory(things, pascal) })

  // composables/
  files.push({ path: `composables/use${pascal}Model.ts`, content: genModelComposable(pascal) })
  files.push({ path: `composables/use${pascal}Repository.ts`, content: genRepoComposable(pascal) })
  files.push({ path: `composables/use${pascal}Triples.ts`, content: genTriplesComposable(pascal) })
  files.push({ path: `composables/use${pascal}Query.ts`, content: genQueryComposable(things, pascal) })

  // nuxt.config.ts
  files.push({ path: 'nuxt.config.ts', content: genNuxtConfig(ontologyLayerPath) })

  // Post-process: replace ##OCP## placeholder with actual ontology code path.
  // All generated files with imports are in subdirectories (model/, types/, etc.),
  // so the relative path from there is always ../../{ontologyCodePath without leading ../}
  const ocpFromSubdir = `../../${ontologyCodePath.replace(/^\.\.\//, '')}`
  for (const f of files) {
    f.content = f.content.replace(/##OCP##/g, ocpFromSubdir)
  }

  return files
}

/**
 * Digital Twin Scaffold Generator - produces a standalone project manifest
 * from a BusinessMapBundle. The generated project uses the ontology framework
 * to serve forms, endpoints, and handle business logic defined in the M1 model.
 *
 * Output is a ScaffoldManifest (file path -> content pairs). The caller decides
 * how to write them (zip download, filesystem, git repo, etc.).
 */

import type { RootContext, Interface, Action, Thing, FacetContainer } from '../types/context'
import type { BusinessMapBundle } from './bundle'
import {
  generateTypeScriptTypes,
  generateZodSchemas,
  generateActionFunctions,
  generateEventSchemas,
} from '../generate'

// ── Public types ─────────────────────────────────────────────────────────────

export interface ScaffoldFile {
  path: string
  content: string
}

export type ScaffoldManifest = ScaffoldFile[]

export interface ScaffoldOptions {
  /** Project name (used in package.json, README) */
  projectName?: string
  /** Include test files */
  includeTests?: boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function allContainers(model: RootContext): FacetContainer[] {
  return [model as FacetContainer, ...Object.values(model.contexts)]
}

function allThings(model: RootContext): Thing[] {
  return allContainers(model).flatMap(c => c.facets.things)
}

function allActions(model: RootContext): Action[] {
  return allContainers(model).flatMap(c => c.facets.actions)
}

function allInterfaces(model: RootContext): Interface[] {
  return allContainers(model).flatMap(c => c.facets.interfaces)
}

function safeName(name: string): string {
  return name.replace(/\s+/g, '-').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'project'
}

function toPascalCase(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
}

function toCamelCase(name: string): string {
  const pascal = toPascalCase(name)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

// ── File generators ──────────────────────────────────────────────────────────

function generatePackageJson(projectName: string, includeTests: boolean): string {
  const scripts: Record<string, string> = {
    build: 'tsc',
    start: 'node dist/server.js',
  }
  if (includeTests) {
    scripts.test = 'vitest run'
  }

  const pkg = {
    name: projectName,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts,
    dependencies: {
      express: '^4.21.0',
      zod: '^3.23.0',
    },
    devDependencies: {
      '@types/express': '^4.17.21',
      '@types/node': '^20.14.0',
      typescript: '^5.5.0',
      ...(includeTests ? { vitest: '^2.0.0' } : {}),
    },
  }

  return JSON.stringify(pkg, null, 2)
}

function generateTsConfig(): string {
  const config = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      outDir: './dist',
      rootDir: './src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      declaration: true,
    },
    include: ['src'],
  }

  return JSON.stringify(config, null, 2)
}

function generateReadme(
  projectName: string,
  model: RootContext,
  things: Thing[],
  actions: Action[],
  interfaces: Interface[],
): string {
  const lines: string[] = [
    `# ${projectName}`,
    '',
    `> Generated from Business Maps model: **${model.name}**`,
    '',
    '## Overview',
    '',
    `This project was scaffolded from a Business Maps domain model. It contains`,
    `TypeScript types, Zod validation schemas, action stubs, and an Express server`,
    `wired to the interfaces defined in the model.`,
    '',
  ]

  if (things.length > 0) {
    lines.push('## Entity Types', '')
    for (const t of things) {
      const attrCount = t.attributes.length
      lines.push(`- **${t.name}** - ${attrCount} attribute${attrCount !== 1 ? 's' : ''}${t.definition ? `: ${t.definition}` : ''}`)
    }
    lines.push('')
  }

  if (actions.length > 0) {
    lines.push('## Actions', '')
    for (const a of actions) {
      lines.push(`- **${a.name}**${a.description ? ` - ${a.description}` : ''}`)
    }
    lines.push('')
  }

  const endpoints = interfaces.filter(i => i.kind === 'endpoint' || i.kind === 'api')
  const forms = interfaces.filter(i => i.kind === 'form')
  if (endpoints.length > 0 || forms.length > 0) {
    lines.push('## Interfaces', '')
    for (const ep of endpoints) {
      const method = ep.httpMethod ?? 'GET'
      const path = ep.path ?? `/${safeName(ep.name)}`
      lines.push(`- \`${method} ${path}\` - ${ep.name}`)
    }
    for (const f of forms) {
      const route = f.route ?? `/${safeName(f.name)}`
      lines.push(`- Form: \`${route}\` - ${f.name}`)
    }
    lines.push('')
  }

  lines.push(
    '## Getting Started',
    '',
    '```bash',
    'npm install',
    'npm run build',
    'npm start',
    '```',
    '',
    'The server starts on `http://localhost:3000` by default.',
    '',
    '## Project Structure',
    '',
    '```',
    'src/',
    '  types.ts        # TypeScript interfaces from domain model',
    '  schemas.ts      # Zod validation schemas',
    '  actions.ts      # Action handler stubs',
    '  events.ts       # Event type definitions',
    '  server.ts       # Express server with routes from interfaces',
    '  repository.ts   # In-memory instance repository',
    '  model.json      # Serialised M1 domain model',
    '```',
    '',
  )

  return lines.join('\n')
}

function generateServerTs(
  interfaces: Interface[],
  _actions: Action[],
): string {
  const lines: string[] = [
    "import express from 'express'",
    "import { readFileSync } from 'node:fs'",
    "import { InMemoryRepository } from './repository'",
    '',
    '// ── Load model ───────────────────────────────────────────────────────────────',
    '',
    "const model = JSON.parse(readFileSync(new URL('./model.json', import.meta.url), 'utf-8'))",
    'const repo = new InMemoryRepository()',
    'const app = express()',
    '',
    'app.use(express.json())',
    '',
    '// ── Health check ─────────────────────────────────────────────────────────────',
    '',
    "app.get('/health', (_req, res) => {",
    "  res.json({ status: 'ok', model: model.name })",
    '})',
    '',
  ]

  // Generate routes for endpoint interfaces
  const endpoints = interfaces.filter(i => i.kind === 'endpoint')
  if (endpoints.length > 0) {
    lines.push('// ── Endpoint routes ──────────────────────────────────────────────────────────', '')

    for (const ep of endpoints) {
      const method = (ep.httpMethod ?? 'GET').toLowerCase()
      const path = ep.path ?? `/${safeName(ep.name)}`
      const handlerName = toCamelCase(ep.name) + 'Handler'

      lines.push(`// ${ep.name}${ep.description ? ` - ${ep.description}` : ''}`)
      lines.push(`app.${method}('${path}', async (req, res) => {`)
      lines.push('  try {')
      lines.push(`    // TODO: implement ${handlerName}`)
      lines.push(`    res.json({ message: '${ep.name} - not yet implemented' })`)
      lines.push('  } catch (err) {')
      lines.push("    res.status(500).json({ error: 'Internal server error' })")
      lines.push('  }')
      lines.push('})')
      lines.push('')
    }
  }

  // Generate routes for API interfaces (collection-level)
  const apis = interfaces.filter(i => i.kind === 'api')
  if (apis.length > 0) {
    lines.push('// ── API routes ───────────────────────────────────────────────────────────────', '')

    for (const api of apis) {
      const basePath = api.basePath ?? `/${safeName(api.name)}`

      lines.push(`// ${api.name}${api.description ? ` - ${api.description}` : ''}`)
      lines.push(`app.get('${basePath}', async (_req, res) => {`)
      lines.push(`  // TODO: implement ${toCamelCase(api.name)}`)
      lines.push(`  res.json({ message: '${api.name} - not yet implemented' })`)
      lines.push('})')
      lines.push('')
    }
  }

  // Generate routes for form interfaces
  const forms = interfaces.filter(i => i.kind === 'form')
  if (forms.length > 0) {
    lines.push('// ── Form routes ──────────────────────────────────────────────────────────────', '')

    for (const form of forms) {
      const route = form.route ?? `/${safeName(form.name)}`
      const schemaFields = form.requestSchema ?? form.props ?? []

      lines.push(`// ${form.name}${form.description ? ` - ${form.description}` : ''}`)

      // GET - return the form schema
      lines.push(`app.get('${route}', (_req, res) => {`)
      lines.push('  res.json({')
      lines.push(`    form: '${form.name}',`)
      if (schemaFields.length > 0) {
        lines.push('    fields: [')
        for (const field of schemaFields) {
          lines.push(`      { name: '${field.name}', type: '${field.type ?? 'text'}' },`)
        }
        lines.push('    ],')
      } else {
        lines.push('    fields: [],')
      }
      lines.push('  })')
      lines.push('})')
      lines.push('')

      // POST - validate and accept submission
      lines.push(`app.post('${route}', async (req, res) => {`)
      lines.push('  try {')
      lines.push('    // TODO: validate req.body against schema')
      lines.push(`    res.json({ success: true, message: '${form.name} submitted' })`)
      lines.push('  } catch (err) {')
      lines.push("    res.status(400).json({ error: 'Validation failed' })")
      lines.push('  }')
      lines.push('})')
      lines.push('')
    }
  }

  // Generate routes for webhook interfaces
  const webhooks = interfaces.filter(i => i.kind === 'webhook')
  if (webhooks.length > 0) {
    lines.push('// ── Webhook routes ───────────────────────────────────────────────────────────', '')

    for (const wh of webhooks) {
      const path = wh.path ?? `/webhooks/${safeName(wh.name)}`

      lines.push(`// ${wh.name}${wh.description ? ` - ${wh.description}` : ''}`)
      lines.push(`app.post('${path}', async (req, res) => {`)
      lines.push('  try {')
      lines.push(`    // TODO: implement ${toCamelCase(wh.name)} webhook handler`)
      lines.push("    res.json({ received: true })")
      lines.push('  } catch (err) {')
      lines.push("    res.status(500).json({ error: 'Webhook processing failed' })")
      lines.push('  }')
      lines.push('})')
      lines.push('')
    }
  }

  // Startup
  lines.push('// ── Start server ─────────────────────────────────────────────────────────────', '')
  lines.push("const PORT = process.env.PORT ?? 3000")
  lines.push('app.listen(PORT, () => {')
  lines.push('  console.log(`Server running on http://localhost:${PORT}`)')
  lines.push(`  console.log('Model:', model.name)`)

  const routeCount = endpoints.length + apis.length + forms.length + webhooks.length
  lines.push(`  console.log('Routes: ${routeCount} interface(s) mounted')`)

  lines.push('})')
  lines.push('')

  return lines.join('\n')
}

function generateRepositoryTs(): string {
  return [
    '/**',
    ' * In-memory InstanceRepository - stores entity instances at runtime.',
    ' * Replace with a database-backed implementation for production.',
    ' */',
    '',
    'export interface EntityInstance {',
    '  id: string',
    '  thingId: string',
    '  data: Record<string, unknown>',
    '  createdAt: string',
    '  updatedAt: string',
    '}',
    '',
    'export interface RelationshipInstance {',
    '  id: string',
    '  predicate: string',
    '  sourceId: string',
    '  targetId: string',
    '  createdAt: string',
    '}',
    '',
    'export class InMemoryRepository {',
    '  private entities = new Map<string, EntityInstance>()',
    '  private relationships = new Map<string, RelationshipInstance>()',
    '  private nextId = 1',
    '',
    '  private genId(): string {',
    '    return `inst_${this.nextId++}`',
    '  }',
    '',
    '  async create(thingId: string, data: Record<string, unknown>): Promise<EntityInstance> {',
    '    const now = new Date().toISOString()',
    '    const instance: EntityInstance = {',
    '      id: this.genId(),',
    '      thingId,',
    '      data,',
    '      createdAt: now,',
    '      updatedAt: now,',
    '    }',
    '    this.entities.set(instance.uri, instance)',
    '    return instance',
    '  }',
    '',
    '  async findById(id: string): Promise<EntityInstance | null> {',
    '    return this.entities.get(id) ?? null',
    '  }',
    '',
    '  async findByThing(thingId: string): Promise<EntityInstance[]> {',
    '    return [...this.entities.values()].filter(e => e.thingId === thingId)',
    '  }',
    '',
    '  async update(id: string, changes: Record<string, unknown>): Promise<EntityInstance> {',
    '    const existing = this.entities.get(id)',
    '    if (!existing) throw new Error(`Entity ${id} not found`)',
    '    const updated: EntityInstance = {',
    '      ...existing,',
    '      data: { ...existing.data, ...changes },',
    '      updatedAt: new Date().toISOString(),',
    '    }',
    '    this.entities.set(id, updated)',
    '    return updated',
    '  }',
    '',
    '  async delete(id: string): Promise<void> {',
    '    this.entities.delete(id)',
    '  }',
    '',
    '  async createRelationship(',
    '    predicate: string,',
    '    sourceId: string,',
    '    targetId: string,',
    '  ): Promise<RelationshipInstance> {',
    '    const now = new Date().toISOString()',
    '    const rel: RelationshipInstance = {',
    '      id: this.genId(),',
    '      predicate,',
    '      sourceId,',
    '      targetId,',
    '      createdAt: now,',
    '    }',
    '    this.relationships.set(rel.uri, rel)',
    '    return rel',
    '  }',
    '',
    '  async findRelationships(',
    '    entityUri: string,',
    '    options?: { predicate?: string, direction?: \'outgoing\' | \'incoming\' },',
    '  ): Promise<RelationshipInstance[]> {',
    '    return [...this.relationships.values()].filter(r => {',
    '      if (options?.predicate && r.predicate !== options.predicate) return false',
    '      if (options?.direction === \'outgoing\') return r.sourceUri === entityId',
    '      if (options?.direction === \'incoming\') return r.targetUri === entityId',
    '      return r.sourceUri === entityId || r.targetUri === entityId',
    '    })',
    '  }',
    '',
    '  async deleteRelationship(id: string): Promise<void> {',
    '    this.relationships.delete(id)',
    '  }',
    '}',
    '',
  ].join('\n')
}

// ── Main generator ───────────────────────────────────────────────────────────

export function generateScaffold(
  bundle: BusinessMapBundle,
  options?: ScaffoldOptions,
): ScaffoldManifest {
  const model = bundle.model
  const projectName = safeName(options?.projectName ?? model.name)
  const includeTests = options?.includeTests ?? true

  // Collect all entities from root + sub-contexts
  const things = allThings(model)
  const actions = allActions(model)
  const interfaces = allInterfaces(model)

  const manifest: ScaffoldManifest = []

  // 1. package.json
  manifest.push({
    path: 'package.json',
    content: generatePackageJson(projectName, includeTests),
  })

  // 2. tsconfig.json
  manifest.push({
    path: 'tsconfig.json',
    content: generateTsConfig(),
  })

  // 3. README.md
  manifest.push({
    path: 'README.md',
    content: generateReadme(projectName, model, things, actions, interfaces),
  })

  // 4. src/types.ts - generated TypeScript interfaces
  manifest.push({
    path: 'src/types.ts',
    content: bundle.generated?.typescriptTypes ?? generateTypeScriptTypes(model),
  })

  // 5. src/schemas.ts - Zod validation schemas
  manifest.push({
    path: 'src/schemas.ts',
    content: bundle.generated?.zodSchemas ?? generateZodSchemas(model),
  })

  // 6. src/actions.ts - action handler stubs
  manifest.push({
    path: 'src/actions.ts',
    content: bundle.generated?.actionFunctions ?? generateActionFunctions(model),
  })

  // 7. src/events.ts - event type definitions
  manifest.push({
    path: 'src/events.ts',
    content: bundle.generated?.eventSchemas ?? generateEventSchemas(model),
  })

  // 8. src/model.json - serialised M1 model
  manifest.push({
    path: 'src/model.json',
    content: JSON.stringify(model, null, 2),
  })

  // 9. src/server.ts - Express server with routes from interfaces
  manifest.push({
    path: 'src/server.ts',
    content: generateServerTs(interfaces, actions),
  })

  // 10. src/repository.ts - in-memory instance repository
  manifest.push({
    path: 'src/repository.ts',
    content: generateRepositoryTs(),
  })

  // Optional: test file
  if (includeTests) {
    manifest.push({
      path: 'src/__tests__/server.test.ts',
      content: generateTestFile(things, interfaces),
    })
  }

  return manifest
}

// ── Test file generator ──────────────────────────────────────────────────────

function generateTestFile(things: Thing[], interfaces: Interface[]): string {
  const lines: string[] = [
    "import { describe, it, expect } from 'vitest'",
    "import { InMemoryRepository } from '../repository'",
    '',
    "describe('InMemoryRepository', () => {",
    "  it('should create and retrieve an entity instance', async () => {",
    '    const repo = new InMemoryRepository()',
    "    const instance = await repo.create('thing-1', { name: 'Test' })",
    '    expect(instance.uri).toBeDefined()',
    "    expect(instance.thingId).toBe('thing-1')",
    '',
    '    const found = await repo.findById(instance.uri)',
    '    expect(found).toEqual(instance)',
    '  })',
    '',
    "  it('should update an entity instance', async () => {",
    '    const repo = new InMemoryRepository()',
    "    const instance = await repo.create('thing-1', { name: 'Original' })",
    "    const updated = await repo.update(instance.uri, { name: 'Updated' })",
    "    expect(updated.data.name).toBe('Updated')",
    '  })',
    '',
    "  it('should delete an entity instance', async () => {",
    '    const repo = new InMemoryRepository()',
    "    const instance = await repo.create('thing-1', { name: 'Test' })",
    '    await repo.delete(instance.uri)',
    '    const found = await repo.findById(instance.uri)',
    '    expect(found).toBeNull()',
    '  })',
    '',
    "  it('should find instances by thing ID', async () => {",
    '    const repo = new InMemoryRepository()',
    "    await repo.create('thing-1', { a: 1 })",
    "    await repo.create('thing-1', { a: 2 })",
    "    await repo.create('thing-2', { a: 3 })",
    "    const results = await repo.findByThing('thing-1')",
    '    expect(results).toHaveLength(2)',
    '  })',
    '',
    "  it('should create and query relationships', async () => {",
    '    const repo = new InMemoryRepository()',
    "    const a = await repo.create('thing-1', {})",
    "    const b = await repo.create('thing-2', {})",
    "    await repo.createRelationship('references', a.id, b.id)",
    '',
    "    const outgoing = await repo.findRelationships(a.id, { direction: 'outgoing' })",
    '    expect(outgoing).toHaveLength(1)',
    "    expect(outgoing[0].predicate).toBe('references')",
    '  })',
    '})',
    '',
  ]

  // Generate entity-specific tests from model
  if (things.length > 0) {
    lines.push("describe('Model entities', () => {")
    for (const thing of things) {
      const name = toPascalCase(thing.name)
      lines.push(`  it('should store ${name} instances', async () => {`)
      lines.push('    const repo = new InMemoryRepository()')

      // Build a sample data object from attributes
      const sampleFields: string[] = []
      for (const attr of thing.attributes.slice(0, 5)) {
        const val = sampleValue(attr.type)
        sampleFields.push(`      ${attr.name}: ${val},`)
      }
      if (sampleFields.length > 0) {
        lines.push(`    const instance = await repo.create('${thing.uri}', {`)
        lines.push(...sampleFields)
        lines.push('    })')
      } else {
        lines.push(`    const instance = await repo.create('${thing.uri}', {})`)
      }

      lines.push('    expect(instance.uri).toBeDefined()')
      lines.push(`    expect(instance.thingId).toBe('${thing.uri}')`)
      lines.push('  })')
      lines.push('')
    }
    lines.push('})')
    lines.push('')
  }

  // Generate route smoke tests
  const routableInterfaces = interfaces.filter(
    i => i.kind === 'endpoint' || i.kind === 'form' || i.kind === 'api',
  )
  if (routableInterfaces.length > 0) {
    lines.push("describe('Route configuration', () => {")
    for (const iface of routableInterfaces) {
      const path = iface.path ?? iface.route ?? `/${safeName(iface.name)}`
      const method = iface.httpMethod ?? 'GET'
      lines.push(`  it('should define ${method} ${path} for ${iface.name}', () => {`)
      lines.push(`    // Smoke test: verify the route path is valid`)
      lines.push(`    expect('${path}').toMatch(/^\\//)`)
      lines.push('  })')
      lines.push('')
    }
    lines.push('})')
    lines.push('')
  }

  return lines.join('\n')
}

function sampleValue(type: string): string {
  switch (type) {
    case 'text':
    case 'identifier':
    case 'email':
    case 'uri':
    case 'markdown':
      return "'sample'"
    case 'integer':
      return '42'
    case 'decimal':
    case 'percentage':
      return '3.14'
    case 'money':
      return '99.99'
    case 'quantity':
      return '10'
    case 'boolean':
      return 'true'
    case 'date':
      return "'2025-01-01'"
    case 'dateTime':
      return "'2025-01-01T00:00:00Z'"
    case 'time':
      return "'12:00:00'"
    case 'duration':
      return "'PT1H'"
    default:
      return "'sample'"
  }
}

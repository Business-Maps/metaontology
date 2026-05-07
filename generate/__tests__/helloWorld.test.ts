/**
 * Hello World integration test - end-to-end verification of the codegen pipeline.
 *
 * Creates a model through applyCommand(), then runs generateApp() and
 * verifies the output is a valid Nuxt app with
 * ONLY model-derived content.
 */

import { describe, it, expect } from 'vitest'
import { generateApp } from '../app'
import { generateDomainModelLayer } from '../domainLayer'
import type { RootContext } from '../../types/context'
import type { Command } from '../../types/commands'
import { applyCommand, createEmptyRootContext } from '../../engine/apply'

// ── Build model through commands ─────────────────────────────────────────

function apply(root: RootContext, cmd: Command): RootContext {
  const result = applyCommand(root, cmd)
  if (!result.success) throw new Error(`${cmd.type} failed: ${result.error}`)
  return result.state
}

function createHelloWorldModel(): RootContext {
  let root = createEmptyRootContext('Hello World')

  root = apply(root, {
    type: 'context:add',
    payload: { name: 'Hello', parentUri: root.uri, uri: 'ctx-hello' },
  })

  root = apply(root, {
    type: 'facet:add',
    payload: {
      contextUri: 'ctx-hello',
      facetType: 'interfaces',
      facet: {
        uri: 'iface-greet',
        name: 'Greet',
        description: '',
        kind: 'page',
        route: '/hello/:name',
      },
    },
  })

  return root
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('hello world app generation', () => {
  it('generates a working Nuxt app from a minimal model', () => {
    const model = createHelloWorldModel()
    const files = generateApp(model, 'ctx-hello', {
      domainLayerPath: '../domainLayer/bm',
    })

    const paths = files.map(f => f.path).sort()
    expect(paths).toContain('app.vue')
    expect(paths).toContain('nuxt.config.ts')
    expect(paths).toContain('package.json')
    expect(paths).toContain('pages/hello/[name].vue')
  })

  it('the page contains ONLY model-derived content', () => {
    const model = createHelloWorldModel()
    const files = generateApp(model, 'ctx-hello')
    const page = files.find(f => f.path === 'pages/hello/[name].vue')!

    // Model-driven: route param expression
    expect(page.content).toContain('{{ route.params.name }}')
    expect(page.content).toContain('useRoute()')

    // No editorial HTML - the model didn't ask for any elements
    expect(page.content).not.toContain('<main')
    expect(page.content).not.toContain('<h1')
    expect(page.content).not.toContain('<p>')
    expect(page.content).not.toContain('<table')
    expect(page.content).not.toContain('<dl')
    expect(page.content).not.toContain('<section')
  })

  it('the page template body is exactly the route param', () => {
    const model = createHelloWorldModel()
    const files = generateApp(model, 'ctx-hello')
    const page = files.find(f => f.path === 'pages/hello/[name].vue')!

    const templateMatch = page.content.match(/<template>([\s\S]*?)<\/template>/)
    const templateBody = templateMatch?.[1]?.trim() ?? ''

    expect(templateBody).toBe('{{ route.params.name }}')
  })

  it('nuxt.config extends the domain layer', () => {
    const model = createHelloWorldModel()
    const files = generateApp(model, 'ctx-hello', {
      domainLayerPath: '../domainLayer/bm',
    })
    const config = files.find(f => f.path === 'nuxt.config.ts')!

    expect(config.content).toContain("extends: ['../domainLayer/bm']")
  })

  it('domain layer and app can be generated from the same model', () => {
    const model = createHelloWorldModel()

    const domainFiles = generateDomainModelLayer(model, {
      layerName: 'helloWorld',
      ontologyLayerPath: '../ontology',
    })
    const appFiles = generateApp(model, 'ctx-hello')

    expect(domainFiles.length).toBeGreaterThan(0)
    expect(appFiles.length).toBeGreaterThan(0)
    expect(domainFiles.some(f => f.path.startsWith('types/'))).toBe(true)
    expect(appFiles.some(f => f.path.startsWith('pages/'))).toBe(true)
  })
})

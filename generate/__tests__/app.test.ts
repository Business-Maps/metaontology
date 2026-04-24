import { describe, it, expect } from 'vitest'
import { generateApp } from '../app'
import type { RootContext } from '../../types/context'
import type { Command } from '../../types/commands'
import { applyCommand, createEmptyRootContext } from '../../engine/apply'

// ── Helpers ──────────────────────────────────────────────────────────────

function apply(root: RootContext, cmd: Command): RootContext {
  const result = applyCommand(root, cmd)
  if (!result.success) throw new Error(`${cmd.type} failed: ${result.error}`)
  return result.state
}

/** Assert no editorial HTML elements in generated content. */
function assertNoEditorialHtml(content: string) {
  expect(content).not.toMatch(/<main[\s>]/)
  expect(content).not.toMatch(/<h1[\s>]/)
  expect(content).not.toMatch(/<h2[\s>]/)
  expect(content).not.toMatch(/<table[\s>]/)
  expect(content).not.toMatch(/<thead[\s>]/)
  expect(content).not.toMatch(/<th[\s>]/)
  expect(content).not.toMatch(/<dl[\s>]/)
  expect(content).not.toMatch(/<dt[\s>]/)
  expect(content).not.toMatch(/<dd[\s>]/)
  expect(content).not.toMatch(/<section[\s>]/)
  expect(content).not.toMatch(/role="region"/)
}

// ── Build model through commands ─────────────────────────────────────────

function createTestModel(): RootContext {
  let root = createEmptyRootContext('Acme Corp')

  // Add the Storefront context
  root = apply(root, {
    type: 'context:add',
    payload: { name: 'Storefront', parentUri: root.uri, uri: 'ctx-storefront' },
  })

  // Add Orders context with a Thing
  root = apply(root, {
    type: 'context:add',
    payload: { name: 'Orders', parentUri: root.uri, uri: 'ctx-orders' },
  })

  root = apply(root, {
    type: 'facet:add',
    payload: {
      contextUri: 'ctx-orders',
      facetType: 'things',
      facet: {
        uri: 'thing-order',
        name: 'Order',
        definition: 'A customer purchase',
        attributes: [
          { name: 'customerEmail', type: 'email', required: true },
          { name: 'total', type: 'money', required: true },
          { name: 'quantity', type: 'integer' },
          { name: 'notes', type: 'markdown' },
          { name: 'shippingDate', type: 'date' },
          { name: 'isGift', type: 'boolean' },
          { name: 'status', type: 'enum', enumValues: ['pending', 'shipped', 'delivered'] },
        ],
        rules: [],
        states: [],
      },
    },
  })

  // Add Product Thing at root level
  root = apply(root, {
    type: 'facet:add',
    payload: {
      contextUri: root.uri,
      facetType: 'things',
      facet: {
        uri: 'thing-product',
        name: 'Product',
        definition: 'A sellable item',
        attributes: [
          { name: 'name', type: 'text' },
          { name: 'price', type: 'decimal' },
          { name: 'sku', type: 'identifier' },
        ],
        rules: [],
        states: [],
      },
    },
  })

  // Add Interfaces to the Storefront context
  const interfaces = [
    { uri: 'iface-app', name: 'Storefront App', description: 'The main storefront application', kind: 'application' },
    { uri: 'iface-products', name: 'Products', description: 'Browse all products', kind: 'page', route: '/products' },
    { uri: 'iface-product-detail', name: 'Product Detail', description: 'View a single product', kind: 'page', route: '/products/:id' },
    { uri: 'iface-main-layout', name: 'Main Layout', description: 'Default layout', kind: 'layout', regions: ['header', 'content', 'footer'] },
    { uri: 'iface-product-card', name: 'Product Card', description: 'Displays a product summary', kind: 'component',
      props: [{ name: 'title', type: 'text' }, { name: 'price', type: 'decimal' }, { name: 'imageUrl', type: 'uri' }],
      emits: ['select', 'add-to-cart'], slots: ['actions'] },
    { uri: 'iface-checkout-form', name: 'Checkout', description: 'Checkout form', kind: 'form', sourceThingId: 'thing-order' },
    { uri: 'iface-revenue-dashboard', name: 'Revenue Dashboard', description: 'Revenue metrics overview', kind: 'dashboard', route: '/dashboard' },
    { uri: 'iface-get-products', name: 'Get Products', description: 'List products', kind: 'endpoint',
      httpMethod: 'GET', path: '/products',
      responseSchema: [{ name: 'id', type: 'identifier' }, { name: 'name', type: 'text' }, { name: 'price', type: 'decimal' }] },
    { uri: 'iface-create-order', name: 'Create Order', description: 'Place a new order', kind: 'endpoint',
      httpMethod: 'POST', path: '/orders', auth: 'bearer',
      requestSchema: [{ name: 'productId', type: 'identifier' }, { name: 'quantity', type: 'integer' }, { name: 'email', type: 'email' }],
      responseSchema: [{ name: 'orderId', type: 'identifier' }] },
    { uri: 'iface-api', name: 'Storefront API', description: 'Public API', kind: 'api', basePath: '/storefront', auth: 'api-key' },
    { uri: 'iface-stripe-webhook', name: 'Stripe Webhook', description: 'Stripe payment events', kind: 'webhook',
      requestSchema: [{ name: 'type', type: 'text' }, { name: 'data', type: 'text' }] },
    { uri: 'iface-order-confirmation', name: 'Order Confirmation', description: 'Send confirmation', kind: 'notification', channel: 'email' },
    { uri: 'iface-sales-report', name: 'Sales Report', description: 'Monthly sales', kind: 'report', format: 'csv' },
    { uri: 'iface-tokens', name: 'Brand Tokens', description: 'Design tokens', kind: 'design-tokens' },
  ]

  for (const iface of interfaces) {
    root = apply(root, {
      type: 'facet:add',
      payload: { contextUri: 'ctx-storefront', facetType: 'interfaces', facet: iface },
    })
  }

  // Add a Checkout action (needed for the exposes link)
  root = apply(root, {
    type: 'facet:add',
    payload: {
      contextUri: 'ctx-orders',
      facetType: 'actions',
      facet: { uri: 'action-checkout', name: 'Checkout', type: 'command', description: 'Complete a purchase' },
    },
  })

  // Add links
  root = apply(root, {
    type: 'link:add',
    payload: { predicate: 'displays', sourceUri: 'iface-products', targetUri: 'thing-product' },
  })
  root = apply(root, {
    type: 'link:add',
    payload: { predicate: 'displays', sourceUri: 'iface-product-detail', targetUri: 'thing-product' },
  })
  root = apply(root, {
    type: 'link:add',
    payload: { predicate: 'exposes', sourceUri: 'iface-checkout-form', targetUri: 'action-checkout' },
  })

  return root
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('generateApp', () => {
  it('throws when contextUri is not found', () => {
    const root = createEmptyRootContext('Test')
    expect(() => generateApp(root, 'nonexistent')).toThrow('Context "nonexistent" not found')
  })

  it('generates a minimal app from an empty context', () => {
    let root = createEmptyRootContext('Test')
    root = apply(root, {
      type: 'context:add',
      payload: { name: 'Empty', parentUri: root.uri, uri: 'ctx-empty' },
    })

    const files = generateApp(root, 'ctx-empty')
    expect(files.length).toBe(3)
    expect(files.map(f => f.path).sort()).toEqual(['app.vue', 'nuxt.config.ts', 'package.json'])
  })

  it('generates files for all interface kinds', () => {
    const model = createTestModel()
    const files = generateApp(model, 'ctx-storefront')

    expect(files.find(f => f.path === 'app.vue')).toBeDefined()
    expect(files.find(f => f.path === 'nuxt.config.ts')).toBeDefined()
    expect(files.find(f => f.path === 'package.json')).toBeDefined()
    expect(files.find(f => f.path === 'pages/products.vue')).toBeDefined()
    expect(files.find(f => f.path === 'pages/products/[id].vue')).toBeDefined()
    expect(files.find(f => f.path === 'layouts/main-layout.vue')).toBeDefined()
    expect(files.find(f => f.path === 'components/ProductCard.vue')).toBeDefined()
    expect(files.find(f => f.path === 'components/CheckoutForm.vue')).toBeDefined()
    expect(files.find(f => f.path === 'pages/dashboard.vue')).toBeDefined()
    expect(files.find(f => f.path === 'server/api/products.get.ts')).toBeDefined()
    expect(files.find(f => f.path === 'server/api/orders.post.ts')).toBeDefined()
  })

  describe('page', () => {
    it('generates a page file at the correct route path', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')
      expect(files.find(f => f.path === 'pages/products.vue')).toBeDefined()
    })

    it('converts dynamic route params to Nuxt bracket syntax', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')
      expect(files.find(f => f.path === 'pages/products/[id].vue')).toBeDefined()
    })

    it('binds displayed Thing attributes to the repository', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')
      const page = files.find(f => f.path === 'pages/products.vue')!

      // Uses domain layer composable for data access
      expect(page.content).toContain('useAcmeCorpRepository()')
      expect(page.content).toContain('repo.products.findAll()')
      // Binds to attribute values via v-for
      expect(page.content).toContain('v-for="item in productItems"')
      expect(page.content).toContain('name?.value')
      expect(page.content).toContain('price?.value')
      expect(page.content).toContain('sku?.value')
      assertNoEditorialHtml(page.content)
    })

    it('renders route params as text for dynamic pages', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')
      const detailPage = files.find(f => f.path === 'pages/products/[id].vue')!

      expect(detailPage.content).toContain('{{ route.params.id }}')
      expect(detailPage.content).toContain('useRoute()')
      assertNoEditorialHtml(detailPage.content)
    })

    it('generates onMounted for async data loading', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')
      const page = files.find(f => f.path === 'pages/products.vue')!

      expect(page.content).toContain('onMounted(async')
      expect(page.content).toContain('productItems.value = await')
    })

    it('contains no editorial HTML', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')
      const page = files.find(f => f.path === 'pages/products.vue')!
      assertNoEditorialHtml(page.content)
    })
  })

  describe('layout', () => {
    it('generates bare named slots for each region', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')
      const layout = files.find(f => f.path === 'layouts/main-layout.vue')!

      expect(layout.content).toContain('<slot name="header" />')
      expect(layout.content).toContain('<slot name="content" />')
      expect(layout.content).toContain('<slot name="footer" />')
    })

    it('contains no editorial wrapper elements', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')
      const layout = files.find(f => f.path === 'layouts/main-layout.vue')!

      // No semantic element mapping - the model declared region names, not HTML elements
      expect(layout.content).not.toContain('<header>')
      expect(layout.content).not.toContain('<footer>')
      expect(layout.content).not.toContain('<nav>')
      expect(layout.content).not.toMatch(/<div[\s>]/)
    })
  })

  describe('component', () => {
    it('generates defineProps from SchemaField props', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')
      const card = files.find(f => f.path === 'components/ProductCard.vue')!

      expect(card.content).toContain('defineProps<{')
      expect(card.content).toContain('title: string')
      expect(card.content).toContain('price: number')
    })

    it('generates defineEmits from emits list', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')
      const card = files.find(f => f.path === 'components/ProductCard.vue')!

      expect(card.content).toContain('defineEmits<{')
      expect(card.content).toContain("'select': []")
      expect(card.content).toContain("'add-to-cart': []")
    })

    it('generates named slots without wrapper div', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')
      const card = files.find(f => f.path === 'components/ProductCard.vue')!

      expect(card.content).toContain('<slot name="actions" />')
      expect(card.content).not.toMatch(/<div[\s>]/)
    })
  })

  describe('form', () => {
    it('generates form fields from Thing attributes via sourceThingId', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')
      const form = files.find(f => f.path === 'components/CheckoutForm.vue')!

      expect(form.content).toContain('<form')
      expect(form.content).toContain('<label for="customer-email">customerEmail</label>')
      expect(form.content).toContain('id="customer-email"')
    })

    it('maps XSD datatypes to correct HTML input types', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')
      const form = files.find(f => f.path === 'components/CheckoutForm.vue')!

      expect(form.content).toContain('type="email"')
      expect(form.content).toContain('type="number" step="0.01"')
      expect(form.content).toContain('type="number" step="1"')
      expect(form.content).toContain('<textarea')
      expect(form.content).toContain('type="date"')
      expect(form.content).toContain('type="checkbox"')
    })

    it('generates select with options for enum attributes', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')
      const form = files.find(f => f.path === 'components/CheckoutForm.vue')!

      expect(form.content).toContain('<select')
      expect(form.content).toContain('<option value="pending">pending</option>')
      expect(form.content).toContain('<option value="shipped">shipped</option>')
    })

    it('has no wrapper divs around fields', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')
      const form = files.find(f => f.path === 'components/CheckoutForm.vue')!

      // Fields sit directly in the form, no div wrappers
      expect(form.content).not.toMatch(/\s+<div>/)
    })

    it('uses action name for submit button when exposed', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')
      const form = files.find(f => f.path === 'components/CheckoutForm.vue')!

      // The link exposes action-checkout → button text derived from action URI
      expect(form.content).toContain('<button type="submit">')
      expect(form.content).not.toContain('>Submit<')
    })

    it('looks up Thing from a different context', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')
      const form = files.find(f => f.path === 'components/CheckoutForm.vue')!

      // thing-order is in ctx-orders, not ctx-storefront
      expect(form.content).toContain('customerEmail')
      expect(form.content).toContain('total')
    })
  })

  describe('dashboard', () => {
    it('generates a page with model-derived text only', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')
      const dashboard = files.find(f => f.path === 'pages/dashboard.vue')!

      expect(dashboard.content).toContain('Revenue Dashboard')
      expect(dashboard.content).toContain('Revenue metrics overview')
      assertNoEditorialHtml(dashboard.content)
    })
  })

  describe('endpoint', () => {
    it('generates GET endpoint with response schema', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')
      const ep = files.find(f => f.path === 'server/api/products.get.ts')!

      expect(ep.content).toContain('defineEventHandler')
    })

    it('generates POST endpoint with Zod request validation', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')
      const ep = files.find(f => f.path === 'server/api/orders.post.ts')!

      expect(ep.content).toContain("import { z } from 'zod'")
      expect(ep.content).toContain('productId: z.string(),')
      expect(ep.content).toContain('quantity: z.number().int(),')
      expect(ep.content).toContain('email: z.string().email(),')
      expect(ep.content).toContain('readValidatedBody(event, RequestSchema.parse)')
    })
  })

  describe('code style', () => {
    it('uses single quotes in generated TypeScript', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')
      const config = files.find(f => f.path === 'nuxt.config.ts')!

      expect(config.content).not.toMatch(/extends: \["/)
    })

    it('all generated files start with a GENERATED comment', () => {
      const model = createTestModel()
      const files = generateApp(model, 'ctx-storefront')

      for (const file of files) {
        if (file.path === 'package.json') continue
        expect(file.content).toMatch(/GENERATED/)
      }
    })
  })
})

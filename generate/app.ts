/**
 * Application Generator - Phase 13.
 *
 * Pure function: `generateApp(model, contextUri, options?) → GeneratedFile[]`.
 *
 * Given a RootContext and a specific context URI, generates a complete Nuxt
 * application from the Interface facets in that context. The generated app
 * extends a domain model layer (produced by `generateDomainModelLayer`) and
 * imports types/schemas/composables from it.
 *
 * Each Interface kind maps to a specific Nuxt convention:
 *   - page/dashboard  → pages/{route}.vue   (file-based routing)
 *   - layout          → layouts/{name}.vue   (layout system)
 *   - component/form  → components/{Name}.vue (auto-import)
 *   - endpoint        → server/api/{path}.{method}.ts (server routes)
 *   - webhook         → server/api/webhooks/{name}.post.ts
 *   - notification    → server/utils/notify/{name}.ts
 *   - report          → server/api/reports/{name}.get.ts
 *   - design-tokens   → assets/tokens.css
 *   - application     → app.vue + nuxt.config.ts
 *   - api             → server/api/{basePath}/ scaffold
 *
 * Generated HTML is semantic and accessible - no styling opinions.
 * A design system decorates through CSS or a component library.
 */

import type {
  RootContext,
  Interface,
  Action,
  Thing,
  ThingAttribute,
  FacetContainer,
  SchemaField,
} from '../types/context'
import type { DomainLayerFile } from './domainLayer'

// ── Public types ──────────────────────────────────────────────────────────

export interface AppGeneratorOptions {
  /** Name for the generated app directory. Defaults to context name, kebab-cased. */
  appName?: string
  /** Name of the domain layer this app extends. Defaults to model name, kebab-cased. */
  domainLayerName?: string
/**
 * Relative path from the generated app root to the domain layer root.
 * Defaults to '../domainLayer/{domainLayerName}'.
 */
  domainLayerPath?: string
}

// Re-export the file type from domainLayer for consistency
export type { DomainLayerFile as GeneratedFile }

// ── Helpers ───────────────────────────────────────────────────────────────

function toKebab(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'app'
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

function allContainers(model: RootContext): FacetContainer[] {
  return [model as FacetContainer, ...Object.values(model.contexts)]
}

function findThingByUri(model: RootContext, thingUri: string): Thing | undefined {
  for (const container of allContainers(model)) {
    const found = container.facets.things.find(t => t.uri === thingUri)
    if (found) return found
  }
  return undefined
}

/** Get Thing URIs that an Interface displays (via `displays` links). */
function getDisplayedThingUris(model: RootContext, ifaceUri: string): string[] {
  return model.links
    .filter(l => l.sourceUri === ifaceUri && l.predicate === 'displays')
    .map(l => l.targetUri)
}

/** Get Action URIs that an Interface exposes (via `exposes` links). */
function getExposedActionUris(model: RootContext, ifaceUri: string): string[] {
  return model.links
    .filter(l => l.sourceUri === ifaceUri && l.predicate === 'exposes')
    .map(l => l.targetUri)
}

function findActionByUri(model: RootContext, actionUri: string): Action | undefined {
  for (const container of allContainers(model)) {
    const found = container.facets.actions.find(a => a.uri === actionUri)
    if (found) return found
  }
  return undefined
}

/** Get the repository field name for a Thing (e.g., "Product" → "products"). */
function repoFieldName(thing: Thing): string {
  return toCamel(thing.name) + 's'
}

// ── XSD Datatype → HTML Input mapping ────────────────────────────────────

interface HtmlInputSpec {
  tag: 'input' | 'textarea' | 'select'
  type?: string
  step?: string
  extra?: string
}

function datatypeToHtmlInput(attr: ThingAttribute): HtmlInputSpec {
  switch (attr.type) {
    case 'text':
    case 'identifier':
      return { tag: 'input', type: 'text' }
    case 'markdown':
      return { tag: 'textarea' }
    case 'email':
      return { tag: 'input', type: 'email' }
    case 'uri':
      return { tag: 'input', type: 'url' }
    case 'integer':
      return { tag: 'input', type: 'number', step: '1' }
    case 'decimal':
    case 'percentage':
    case 'quantity':
      return { tag: 'input', type: 'number', step: 'any' }
    case 'money':
      return { tag: 'input', type: 'number', step: '0.01' }
    case 'boolean':
      return { tag: 'input', type: 'checkbox' }
    case 'date':
      return { tag: 'input', type: 'date' }
    case 'dateTime':
      return { tag: 'input', type: 'datetime-local' }
    case 'time':
      return { tag: 'input', type: 'time' }
    case 'duration':
      return { tag: 'input', type: 'text', extra: 'placeholder="P1DT2H30M"' }
    case 'enum':
      return { tag: 'select' }
    case 'reference':
      return { tag: 'input', type: 'text', extra: 'placeholder="URI"' }
    default:
      return { tag: 'input', type: 'text' }
  }
}

// ── Route → file path conversion ─────────────────────────────────────────

/**
 * Convert a route pattern to a Nuxt pages file path.
 * - `/orders` → `pages/orders.vue`
 * - `/orders/:id` → `pages/orders/[id].vue`
 * - `/` → `pages/index.vue`
 * - `/admin/users/:id` → `pages/admin/users/[id].vue`
 */
function routeToPagePath(route: string): string {
  if (!route || route === '/') return 'pages/index.vue'

  const segments = route.replace(/^\//, '').split('/')
  const parts = segments.map(seg => {
    if (seg.startsWith(':')) return `[${seg.slice(1)}]`
    return seg
  })

  // If the last segment is not dynamic, use it as the filename
  // If it is dynamic, nest it as [param].vue inside the parent
  return `pages/${parts.join('/')}.vue`
}

// ── SchemaField → TypeScript type string ─────────────────────────────────

function schemaFieldToTsType(field: SchemaField): string {
  switch (field.type) {
    case 'integer':
    case 'decimal':
    case 'percentage':
    case 'money':
    case 'quantity':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'date':
    case 'dateTime':
      return 'Date'
    default:
      return 'string'
  }
}

// ── Per-kind mappers ─────────────────────────────────────────────────────

function mapApplication(iface: Interface, domainLayerPath: string): DomainLayerFile[] {
  const appVue = [
    '<script setup lang="ts">',
    '// GENERATED - do not edit. Regenerate from the domain model.',
    '</script>',
    '',
    '<template>',
    '  <NuxtLayout>',
    '    <NuxtPage />',
    '  </NuxtLayout>',
    '</template>',
    '',
  ].join('\n')

  const nuxtConfig = [
    '// GENERATED - do not edit. Regenerate from the domain model.',
    'export default defineNuxtConfig({',
    `  extends: ['${domainLayerPath}'],`,
    '  ssr: false,',
    '  compatibilityDate: \'2025-01-01\',',
    '})',
    '',
  ].join('\n')

  return [
    { path: 'app.vue', content: appVue },
    { path: 'nuxt.config.ts', content: nuxtConfig },
  ]
}

function mapPage(iface: Interface, model: RootContext, pascal: string): DomainLayerFile[] {
  const route = iface.route || `/${toKebab(iface.name)}`
  const filePath = routeToPagePath(route)

  const thingUris = getDisplayedThingUris(model, iface.uri)
  const things = thingUris.map(uri => findThingByUri(model, uri)).filter(Boolean) as Thing[]
  const actionUris = getExposedActionUris(model, iface.uri)
  const actions = actionUris.map(uri => findActionByUri(model, uri)).filter(Boolean) as Action[]

  const isDynamic = route.includes(':')
  const paramNames = isDynamic
    ? (route.match(/:([a-zA-Z]+)/g) ?? []).map(p => p.slice(1))
    : []

  const needsRepo = things.length > 0
  const needsActions = actions.length > 0

  const script: string[] = [
    '<script setup lang="ts">',
    '// GENERATED - do not edit. Regenerate from the domain model.',
  ]

  if (isDynamic) {
    script.push('const route = useRoute()')
  }

  if (needsRepo) {
    script.push(`const repo = use${pascal}Repository()`)
    for (const thing of things) {
      const varName = toCamel(thing.name) + 'Items'
      script.push(`const ${varName} = ref<any[]>([])`)
    }
    script.push('')
    script.push('onMounted(async () => {')
    for (const thing of things) {
      const field = repoFieldName(thing)
      const varName = toCamel(thing.name) + 'Items'
      if (isDynamic) {
        script.push(`  const found = await repo.${field}.findById(route.params.${paramNames[0]} as string)`)
        script.push(`  if (found) ${varName}.value = [found]`)
      } else {
        script.push(`  ${varName}.value = await repo.${field}.findAll()`)
      }
    }
    script.push('})')
  }

  if (needsActions) {
    if (needsRepo) {
      script.push(`const { model: m } = use${pascal}Model()`)
      script.push("const executor = createActionInterpreter(m.value)")
      script.push(`const rawRepo = inject<any>('${pascal}RawRepo')`)
    }
    for (const action of actions) {
      const fnName = `run${toPascal(action.name)}`
      script.push('')
      script.push(`async function ${fnName}(params: Record<string, unknown> = {}) {`)
      script.push(`  await executor.execute('${action.uri}', params, {`)
      script.push('    model: m.value,')
      script.push('    instances: rawRepo,')
      script.push('  })')
      // Refresh data after action
      for (const thing of things) {
        const field = repoFieldName(thing)
        const varName = toCamel(thing.name) + 'Items'
        script.push(`  ${varName}.value = await repo.${field}.findAll()`)
      }
      script.push('}')
    }
  }

  script.push('</script>')

  // Template - model-driven content only
  const template: string[] = ['', '<template>']

  for (const param of paramNames) {
    template.push(`  {{ route.params.${param} }}`)
  }

  for (const thing of things) {
    const varName = toCamel(thing.name) + 'Items'
    template.push(`  <template v-for="item in ${varName}" :key="item.id">`)
    for (const attr of thing.attributes) {
      template.push(`    {{ item.data?.${toCamel(attr.name)}?.value ?? item.attributes?.${toCamel(attr.name)}?.value }}`)
    }
    template.push('  </template>')
  }

  for (const action of actions) {
    const fnName = `run${toPascal(action.name)}`
    template.push(`  <button @click="${fnName}()">${action.name}</button>`)
  }

  template.push('</template>', '')

  return [{ path: filePath, content: [...script, ...template].join('\n') }]
}

function mapDashboard(iface: Interface, model: RootContext, pascal: string): DomainLayerFile[] {
  const route = iface.route || `/${toKebab(iface.name)}`
  const filePath = routeToPagePath(route)

  const thingUris = getDisplayedThingUris(model, iface.uri)
  const things = thingUris.map(uri => findThingByUri(model, uri)).filter(Boolean) as Thing[]

  const needsRepo = things.length > 0

  const script: string[] = [
    '<script setup lang="ts">',
    '// GENERATED - do not edit. Regenerate from the domain model.',
  ]

  if (needsRepo) {
    script.push(`const repo = use${pascal}Repository()`)
    for (const thing of things) {
      const varName = toCamel(thing.name) + 'Items'
      script.push(`const ${varName} = ref<any[]>([])`)
    }
    script.push('')
    script.push('onMounted(async () => {')
    for (const thing of things) {
      const field = repoFieldName(thing)
      const varName = toCamel(thing.name) + 'Items'
      script.push(`  ${varName}.value = await repo.${field}.findAll()`)
    }
    script.push('})')
  }

  script.push('</script>')

  const template: string[] = ['', '<template>']

  if (iface.name) template.push(`  ${iface.name}`)
  if (iface.description) template.push(`  ${iface.description}`)

  for (const thing of things) {
    const varName = toCamel(thing.name) + 'Items'
    template.push(`  <template v-for="item in ${varName}" :key="item.id">`)
    for (const attr of thing.attributes) {
      template.push(`    {{ item.attributes?.${toCamel(attr.name)}?.value }}`)
    }
    template.push('  </template>')
  }

  template.push('</template>', '')

  return [{ path: filePath, content: [...script, ...template].join('\n') }]
}

function mapLayout(iface: Interface): DomainLayerFile[] {
  const name = toKebab(iface.name)
  const regions = iface.regions ?? ['default']

  const lines: string[] = [
    '<script setup lang="ts">',
    '// GENERATED - do not edit. Regenerate from the domain model.',
    '</script>',
    '',
    '<template>',
  ]

  if (regions.length === 1 && regions[0] === 'default') {
    lines.push('  <slot />')
  } else {
    for (const region of regions) {
      lines.push(`  <slot name="${region}" />`)
    }
  }

  lines.push('</template>', '')

  return [{ path: `layouts/${name}.vue`, content: lines.join('\n') }]
}

function mapComponent(iface: Interface): DomainLayerFile[] {
  const name = toPascal(iface.name)
  const props = iface.props ?? []
  const emits = iface.emits ?? []
  const slots = iface.slots ?? []

  const lines: string[] = [
    '<script setup lang="ts">',
    '// GENERATED - do not edit. Regenerate from the domain model.',
  ]

  // defineProps
  if (props.length > 0) {
    lines.push('defineProps<{')
    for (const prop of props) {
      const tsType = schemaFieldToTsType(prop)
      lines.push(`  ${prop.name}${prop.type ? '' : '?'}: ${tsType}`)
    }
    lines.push('}>()')
  }

  // defineEmits
  if (emits.length > 0) {
    lines.push(`defineEmits<{`)
    for (const emit of emits) {
      lines.push(`  '${emit}': []`)
    }
    lines.push('}>()')
  }

  lines.push('</script>', '', '<template>')

  for (const slot of slots) {
    lines.push(`  <slot name="${slot}" />`)
  }

  lines.push('</template>', '')

  return [{ path: `components/${name}.vue`, content: lines.join('\n') }]
}

function mapForm(iface: Interface, model: RootContext): DomainLayerFile[] {
  const name = toPascal(iface.name)
  const thing = iface.sourceThingId
    ? findThingByUri(model, iface.sourceThingId)
    : undefined
  const attributes = thing?.attributes ?? []

  const lines: string[] = [
    '<script setup lang="ts">',
    '// GENERATED - do not edit. Regenerate from the domain model.',
    "import { reactive } from 'vue'",
    '',
  ]

  // Build reactive form data
  lines.push('const formData = reactive({')
  for (const attr of attributes) {
    const defaultVal = attr.type === 'boolean' ? 'false' : "''"
    lines.push(`  ${toCamel(attr.name)}: ${defaultVal},`)
  }
  lines.push('})', '')

  // Submit handler
  const actionUris = getExposedActionUris(model, iface.uri)
  lines.push('function handleSubmit() {')
  if (actionUris.length > 0) {
    lines.push(`  // Dispatch action: ${actionUris[0]}`)
  }
  lines.push('  // Submit form data to repository')
  lines.push('}')

  lines.push('</script>', '', '<template>')
  lines.push('  <form @submit.prevent="handleSubmit">')

  for (const attr of attributes) {
    const fieldId = toKebab(attr.name)
    const fieldModel = toCamel(attr.name)
    const input = datatypeToHtmlInput(attr)
    const required = attr.required ? ' required' : ''

    lines.push(`    <label for="${fieldId}">${attr.name}</label>`)

    if (input.tag === 'textarea') {
      lines.push(`    <textarea id="${fieldId}" v-model="formData.${fieldModel}"${required}></textarea>`)
    } else if (input.tag === 'select' && attr.enumValues?.length) {
      lines.push(`    <select id="${fieldId}" v-model="formData.${fieldModel}"${required}>`)
      for (const val of attr.enumValues) {
        lines.push(`      <option value="${val}">${val}</option>`)
      }
      lines.push('    </select>')
    } else if (input.type === 'checkbox') {
      lines.push(`    <input id="${fieldId}" v-model="formData.${fieldModel}" type="checkbox">`)
    } else {
      const typeAttr = input.type ? ` type="${input.type}"` : ''
      const stepAttr = input.step ? ` step="${input.step}"` : ''
      const extraAttr = input.extra ? ` ${input.extra}` : ''
      lines.push(`    <input id="${fieldId}" v-model="formData.${fieldModel}"${typeAttr}${stepAttr}${extraAttr}${required}>`)
    }
  }

  // Submit button: use action name if exposed, otherwise omit
  if (actionUris.length > 0) {
    const actionName = actionUris[0]!.split(':').pop() ?? 'submit'
    lines.push(`    <button type="submit">${actionName}</button>`)
  }

  lines.push('  </form>', '</template>', '')

  return [{ path: `components/${name}Form.vue`, content: lines.join('\n') }]
}

function mapEndpoint(iface: Interface): DomainLayerFile[] {
  const method = (iface.httpMethod ?? 'GET').toLowerCase()
  const path = iface.path ?? `/${toKebab(iface.name)}`

  // Convert path to Nuxt server route: /orders/:id → server/api/orders/[id].get.ts
  const segments = path.replace(/^\//, '').split('/').map(seg =>
    seg.startsWith(':') ? `[${seg.slice(1)}]` : seg,
  )
  const filePath = `server/api/${segments.join('/')}.${method}.ts`

  const requestFields = iface.requestSchema ?? []
  const responseFields = iface.responseSchema ?? []
  const hasAuth = iface.auth && iface.auth !== 'none'

  const lines: string[] = [
    '// GENERATED - do not edit. Regenerate from the domain model.',
  ]

  // Zod schema for request validation
  if (requestFields.length > 0) {
    lines.push("import { z } from 'zod'", '')
    lines.push('const RequestSchema = z.object({')
    for (const field of requestFields) {
      lines.push(`  ${field.name}: ${schemaFieldToZod(field)},`)
    }
    lines.push('})', '')
  }

  lines.push(`export default defineEventHandler(async (event) => {`)

  if (hasAuth) {
    lines.push(`  // Auth: ${iface.auth}`)
    lines.push('  // TODO: Verify authentication')
  }

  if (requestFields.length > 0 && (method === 'post' || method === 'put' || method === 'patch')) {
    lines.push('  const body = await readValidatedBody(event, RequestSchema.parse)')
  }

  if (segments.some(s => s.startsWith('['))) {
    const paramName = segments.find(s => s.startsWith('['))!.slice(1, -1)
    lines.push(`  const ${paramName} = getRouterParam(event, '${paramName}')`)
  }

  // Response stub
  if (responseFields.length > 0) {
    lines.push('  return {')
    for (const field of responseFields) {
      lines.push(`    ${field.name}: undefined, // ${field.type ?? 'string'}`)
    }
    lines.push('  }')
  } else {
    lines.push('  return { success: true }')
  }

  lines.push('})', '')

  return [{ path: filePath, content: lines.join('\n') }]
}

function mapApi(iface: Interface): DomainLayerFile[] {
  const basePath = iface.basePath ?? toKebab(iface.name)
  const cleanPath = basePath.replace(/^\//, '')

  const content = [
    '// GENERATED - do not edit. Regenerate from the domain model.',
    `// API base: /${cleanPath}`,
    `// Auth: ${iface.auth ?? 'none'}`,
    '',
    'export default defineEventHandler(() => {',
    `  return { api: '${iface.name}', version: '1.0' }`,
    '})',
    '',
  ].join('\n')

  return [{ path: `server/api/${cleanPath}/index.get.ts`, content }]
}

function mapWebhook(iface: Interface): DomainLayerFile[] {
  const name = toKebab(iface.name)
  const requestFields = iface.requestSchema ?? []

  const lines: string[] = [
    '// GENERATED - do not edit. Regenerate from the domain model.',
  ]

  if (requestFields.length > 0) {
    lines.push("import { z } from 'zod'", '')
    lines.push('const PayloadSchema = z.object({')
    for (const field of requestFields) {
      lines.push(`  ${field.name}: ${schemaFieldToZod(field)},`)
    }
    lines.push('})', '')
  }

  lines.push('export default defineEventHandler(async (event) => {')
  lines.push("  // HMAC verification stub - replace with real secret")
  lines.push("  const signature = getHeader(event, 'x-webhook-signature')")
  lines.push('  if (!signature) {')
  lines.push("    throw createError({ statusCode: 401, message: 'Missing signature' })")
  lines.push('  }')
  lines.push('')
  lines.push('  const body = await readBody(event)')

  if (requestFields.length > 0) {
    lines.push('  const payload = PayloadSchema.parse(body)')
  }

  lines.push('')
  lines.push('  // Process webhook payload')
  lines.push("  return { received: true }")
  lines.push('})', '')

  return [{ path: `server/api/webhooks/${name}.post.ts`, content: lines.join('\n') }]
}

function mapNotification(iface: Interface): DomainLayerFile[] {
  const name = toKebab(iface.name)
  const channel = iface.channel ?? 'email'

  const content = [
    '// GENERATED - do not edit. Regenerate from the domain model.',
    '',
    `export async function send${toPascal(iface.name)}(to: string, data: Record<string, unknown>) {`,
    `  // Channel: ${channel}`,
    iface.template ? `  // Template: ${iface.template}` : '  // Template: (not specified)',
    `  console.warn('Notification "${iface.name}" not implemented - channel: ${channel}')`,
    '}',
    '',
  ].join('\n')

  return [{ path: `server/utils/notify/${name}.ts`, content }]
}

function mapReport(iface: Interface): DomainLayerFile[] {
  const name = toKebab(iface.name)
  const format = iface.format ?? 'html'

  const contentTypeMap: Record<string, string> = {
    pdf: 'application/pdf',
    csv: 'text/csv',
    html: 'text/html',
    excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }

  const content = [
    '// GENERATED - do not edit. Regenerate from the domain model.',
    '',
    'export default defineEventHandler((event) => {',
    `  setHeader(event, 'content-type', '${contentTypeMap[format] ?? 'text/html'}')`,
    `  // Format: ${format}`,
    `  // Generate ${iface.name} report data here`,
    `  return '<!-- ${iface.name} report -->'`,
    '})',
    '',
  ].join('\n')

  return [{ path: `server/api/reports/${name}.get.ts`, content }]
}

function mapDesignTokens(iface: Interface): DomainLayerFile[] {
  const content = [
    '/* GENERATED - do not edit. Regenerate from the domain model. */',
    `/* Design tokens: ${iface.name} */`,
    '',
    ':root {',
    '  /* Add design tokens here */',
    '  /* --color-primary: #000; */',
    '  /* --font-family-body: system-ui, sans-serif; */',
    '  /* --spacing-unit: 0.25rem; */',
    '}',
    '',
  ].join('\n')

  return [{ path: 'assets/tokens.css', content }]
}

// ── Zod schema generation for endpoint validation ────────────────────────

function schemaFieldToZod(field: SchemaField): string {
  switch (field.type) {
    case 'integer':
      return 'z.number().int()'
    case 'decimal':
    case 'percentage':
    case 'money':
    case 'quantity':
      return 'z.number()'
    case 'boolean':
      return 'z.boolean()'
    case 'date':
    case 'dateTime':
    case 'time':
    case 'duration':
      return 'z.string()'
    case 'email':
      return 'z.string().email()'
    case 'uri':
      return 'z.string().url()'
    default:
      return 'z.string()'
  }
}

// ── Plugin generation ────────────────────────────────────────────────────

function genStorePlugin(pascal: string, domainLayerPath: string): DomainLayerFile {
  const content = [
    '// GENERATED - do not edit. Regenerate from the domain model.',
    `import { ${pascal.toUpperCase()}_REPO_KEY } from '${domainLayerPath}/composables/use${pascal}Repository'`,
    `import { create${pascal}Repository } from '${domainLayerPath}/repository/factory'`,
    `import { createInMemoryRepository } from '${domainLayerPath}/../../ontology/runtime/inMemoryRepository'`,
    '',
    'export default defineNuxtPlugin((nuxtApp) => {',
    '  const storage = createInMemoryRepository()',
    `  const repo = create${pascal}Repository(storage)`,
    `  nuxtApp.vueApp.provide(${pascal.toUpperCase()}_REPO_KEY, repo)`,
    `  nuxtApp.vueApp.provide('${pascal}RawRepo', storage)`,
    '})',
    '',
  ].join('\n')

  return { path: 'plugins/store.client.ts', content }
}

// ── Main generator ───────────────────────────────────────────────────────

export function generateApp(
  model: RootContext,
  contextUri: string,
  options: AppGeneratorOptions = {},
): DomainLayerFile[] {
  const context = model.contexts[contextUri]
  if (!context) {
    throw new Error(`Context "${contextUri}" not found in model`)
  }

  const appName = options.appName ?? toKebab(context.name)
  const domainLayerName = options.domainLayerName ?? toKebab(model.name)
  const domainLayerPath = options.domainLayerPath ?? `../domainLayer/${domainLayerName}`
  const pascal = toPascal(model.name)

  const files: DomainLayerFile[] = []
  const interfaces = context.facets.interfaces ?? []

  // Check if there's an explicit Application Interface
  const hasAppInterface = interfaces.some(i => i.kind === 'application')

  // Always generate app shell
  if (!hasAppInterface) {
    files.push(...mapApplication(
      { uri: '', name: appName, description: '', kind: 'application' } as Interface,
      domainLayerPath,
    ))
  }

  // Check if any interface actually binds to Things (needs the repository)
  const allThingUris = interfaces.flatMap(i => getDisplayedThingUris(model, i.uri))
  const hasFormWithThing = interfaces.some(i => i.kind === 'form' && i.sourceThingId)
  const needsStore = allThingUris.length > 0 || hasFormWithThing

  if (needsStore) {
    files.push(genStorePlugin(pascal, domainLayerPath))
  }

  // Process each Interface by kind
  for (const iface of interfaces) {
    switch (iface.kind) {
      case 'application':
        files.push(...mapApplication(iface, domainLayerPath))
        break
      case 'page':
        files.push(...mapPage(iface, model, pascal))
        break
      case 'dashboard':
        files.push(...mapDashboard(iface, model, pascal))
        break
      case 'form':
        files.push(...mapForm(iface, model))
        break
      case 'layout':
        files.push(...mapLayout(iface))
        break
      case 'component':
        files.push(...mapComponent(iface))
        break
      case 'endpoint':
        files.push(...mapEndpoint(iface))
        break
      case 'api':
        files.push(...mapApi(iface))
        break
      case 'webhook':
        files.push(...mapWebhook(iface))
        break
      case 'notification':
        files.push(...mapNotification(iface))
        break
      case 'report':
        files.push(...mapReport(iface))
        break
      case 'design-tokens':
        files.push(...mapDesignTokens(iface))
        break
    }
  }

  // Always generate package.json
  files.push({
    path: 'package.json',
    content: JSON.stringify({
      name: appName,
      private: true,
      scripts: {
        dev: 'nuxt dev',
        build: 'nuxt build',
        generate: 'nuxt generate',
        preview: 'nuxt preview',
      },
    }, null, 2) + '\n',
  })

  return files
}

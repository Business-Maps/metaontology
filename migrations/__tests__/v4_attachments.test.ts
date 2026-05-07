import { describe, it, expect } from 'vitest'
import { MIGRATIONS } from '../registry'

const v4 = MIGRATIONS.find(m => m.version === 4)!

function makeModel(opts: {
  symbols?: any[]
  interfaces?: any[]
  contextSymbols?: Record<string, any[]>
  contextInterfaces?: Record<string, any[]>
  links?: any[]
} = {}): any {
  const contexts: Record<string, any> = {}
  for (const [ctxUri, syms] of Object.entries(opts.contextSymbols ?? {})) {
    contexts[ctxUri] = contexts[ctxUri] ?? { uri: ctxUri, symbols: [], facets: { interfaces: [] } }
    contexts[ctxUri].symbols = syms
  }
  for (const [ctxUri, ifaces] of Object.entries(opts.contextInterfaces ?? {})) {
    contexts[ctxUri] = contexts[ctxUri] ?? { uri: ctxUri, symbols: [], facets: { interfaces: [] } }
    contexts[ctxUri].facets.interfaces = ifaces
  }
  return {
    uri: 'root',
    symbols: opts.symbols ?? [],
    facets: { interfaces: opts.interfaces ?? [] },
    contexts,
    links: opts.links ?? [],
  }
}

describe('migration v4 — multi-attachment + annotation anchoring', () => {
  it('lifts a single Symbol.attachment into attachments[] with a stable id', () => {
    const model = makeModel({
      symbols: [{
        uri: 's1',
        content: '',
        attachment: { kind: 'blob', id: 'blob-x', mimeType: 'image/png' },
      }],
    })
    v4.migrate(model)
    const s = model.symbols[0]
    expect(s.attachment).toBeUndefined()
    expect(s.attachments).toHaveLength(1)
    const entry = s.attachments[0]
    expect(entry.kind).toBe('blob')
    expect(entry.id).toBe('blob-x')
    expect(entry.mimeType).toBe('image/png')
    expect(typeof entry.attachmentId).toBe('string')
    expect(entry.attachmentId.length).toBeGreaterThan(0)
  })

  it('lifts Interface.media into attachments[] with a stable id', () => {
    const model = makeModel({
      interfaces: [{
        uri: 'iface-1',
        name: 'Login',
        media: { kind: 'storybook', url: 'https://sb.example/iframe.html?id=login', storyId: 'login' },
      }],
    })
    v4.migrate(model)
    const i = model.facets.interfaces[0]
    expect(i.media).toBeUndefined()
    expect(i.attachments).toHaveLength(1)
    expect(i.attachments[0].kind).toBe('storybook')
    expect(typeof i.attachments[0].attachmentId).toBe('string')
  })

  it('stamps metadata.attachmentId on annotation links sourced from migrated entities', () => {
    const model = makeModel({
      symbols: [{
        uri: 's1',
        content: '',
        attachment: { kind: 'blob', id: 'blob-x', mimeType: 'image/png' },
      }],
      links: [
        {
          uri: 'l1',
          predicate: 'annotates',
          sourceUri: 's1',
          targetUri: 't1',
          metadata: { position: { x: 0.5, y: 0.5 } },
        },
        // Non-annotation link should be untouched.
        {
          uri: 'l2',
          predicate: 'references',
          sourceUri: 's1',
          targetUri: 't1',
          metadata: {},
        },
      ],
    })
    v4.migrate(model)
    const aid = model.symbols[0].attachments[0].attachmentId
    expect(model.links[0].metadata.attachmentId).toBe(aid)
    expect(model.links[0].metadata.position).toEqual({ x: 0.5, y: 0.5 })
    // Other predicates untouched.
    expect(model.links[1].metadata.attachmentId).toBeUndefined()
  })

  it('is idempotent — running twice on the same model is a no-op', () => {
    const model = makeModel({
      symbols: [{
        uri: 's1',
        content: '',
        attachment: { kind: 'blob', id: 'blob-x', mimeType: 'image/png' },
      }],
      links: [{
        uri: 'l1',
        predicate: 'annotates',
        sourceUri: 's1',
        targetUri: 't1',
        metadata: { position: { x: 0.3, y: 0.7 } },
      }],
    })
    v4.migrate(model)
    const firstAid = model.symbols[0].attachments[0].attachmentId
    const firstLinkAid = model.links[0].metadata.attachmentId
    v4.migrate(model)
    expect(model.symbols[0].attachments).toHaveLength(1)
    expect(model.symbols[0].attachments[0].attachmentId).toBe(firstAid)
    expect(model.links[0].metadata.attachmentId).toBe(firstLinkAid)
  })

  it('handles entities in sub-contexts', () => {
    const model = makeModel({
      contextSymbols: {
        'ctx-1': [{
          uri: 's1',
          content: '',
          attachment: { kind: 'url', href: 'https://example.com/img.png' },
        }],
      },
      contextInterfaces: {
        'ctx-1': [{
          uri: 'iface-1',
          name: 'Page',
          media: { kind: 'blob', id: 'blob-y', mimeType: 'image/png' },
        }],
      },
      links: [{
        uri: 'l1',
        predicate: 'annotates',
        sourceUri: 'iface-1',
        targetUri: 't1',
        metadata: { position: { x: 0.1, y: 0.1 } },
      }],
    })
    v4.migrate(model)
    const ifaceAid = model.contexts['ctx-1'].facets.interfaces[0].attachments[0].attachmentId
    expect(model.links[0].metadata.attachmentId).toBe(ifaceAid)
  })

  it('leaves entities without attachments alone', () => {
    const model = makeModel({
      symbols: [{ uri: 's1', content: '' }],
      interfaces: [{ uri: 'iface-1', name: 'Bare' }],
      links: [],
    })
    v4.migrate(model)
    expect(model.symbols[0].attachments).toBeUndefined()
    expect(model.facets.interfaces[0].attachments).toBeUndefined()
  })
})

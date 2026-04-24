import { describe, it, expect } from 'vitest'
import { MIGRATIONS } from '../registry'

const v3 = MIGRATIONS.find(m => m.version === 3)!

function makeSymbol(overrides: Record<string, unknown> = {}): any {
  return {
    uri: 'sym-1',
    content: '',
    ...overrides,
  }
}

function makeModel(topLevel: any[] = [], byContext: Record<string, any[]> = {}): any {
  const contexts: Record<string, any> = {}
  for (const [ctxUri, syms] of Object.entries(byContext)) {
    contexts[ctxUri] = { uri: ctxUri, symbols: syms }
  }
  return {
    uri: 'root',
    symbols: topLevel,
    contexts,
  }
}

describe('migration v3 — contentDoc upgrade', () => {
  it('adds contentDoc to every symbol lacking one', () => {
    const model = makeModel([
      makeSymbol({ uri: 's1', content: 'hello' }),
      makeSymbol({ uri: 's2', content: '# heading' }),
    ])
    v3.migrate(model)
    expect(model.symbols[0].contentDoc).toMatchObject({ type: 'doc' })
    expect(model.symbols[1].contentDoc).toMatchObject({ type: 'doc' })
  })

  it('upgrades symbols nested inside contexts', () => {
    const model = makeModel(
      [],
      {
        'ctx-a': [makeSymbol({ uri: 'inside-a', content: 'prose' })],
        'ctx-b': [makeSymbol({ uri: 'inside-b', content: '- one\n- two' })],
      },
    )
    v3.migrate(model)
    expect(model.contexts['ctx-a'].symbols[0].contentDoc).toMatchObject({ type: 'doc' })
    const bulletDoc = model.contexts['ctx-b'].symbols[0].contentDoc
    expect(bulletDoc.content[0].type).toBe('bulletList')
  })

  it('is idempotent — running twice leaves the already-upgraded docs intact', () => {
    const model = makeModel([makeSymbol({ uri: 's1', content: 'hello' })])
    v3.migrate(model)
    const firstDoc = model.symbols[0].contentDoc
    v3.migrate(model)
    expect(model.symbols[0].contentDoc).toBe(firstDoc)
  })

  it('preserves the legacy `content` field on every symbol (dual-read window)', () => {
    const model = makeModel([makeSymbol({ uri: 's1', content: 'hello world' })])
    v3.migrate(model)
    expect(model.symbols[0].content).toBe('hello world')
  })

  it('does not touch positions, labels, attachments, or any other field', () => {
    const stamp = {
      uri: 's1',
      label: 'My Sticky',
      content: 'hello',
      mode: 'card',
      modePinned: true,
      style: { fontSize: 'lg' },
      tags: ['important'],
      attachment: { kind: 'image', blobId: 'blob-1', mimeType: 'image/png' },
    }
    const model = makeModel([{ ...stamp }])
    v3.migrate(model)
    const s = model.symbols[0]
    expect(s.label).toBe('My Sticky')
    expect(s.mode).toBe('card')
    expect(s.modePinned).toBe(true)
    expect(s.style).toEqual({ fontSize: 'lg' })
    expect(s.tags).toEqual(['important'])
    expect(s.attachment).toEqual({ kind: 'image', blobId: 'blob-1', mimeType: 'image/png' })
  })

  it('handles symbols with missing or non-string content safely', () => {
    const model = makeModel([
      { uri: 'a' },                    // no content field at all
      { uri: 'b', content: null },      // null content
      { uri: 'c', content: 42 },        // non-string content
    ])
    v3.migrate(model)
    // All three should end up with a valid one-paragraph empty doc.
    for (const s of model.symbols) {
      expect(s.contentDoc).toMatchObject({ type: 'doc' })
      expect(s.contentDoc.content.length).toBeGreaterThan(0)
    }
  })

  it('preserves every mention token in the legacy content', () => {
    const model = makeModel([
      makeSymbol({
        uri: 's-mentions',
        content: 'see @[Thing:User:u-123:ctx-1] and @[Persona:Alice](entity:p-9)',
      }),
    ])
    v3.migrate(model)
    const doc = model.symbols[0].contentDoc
    const para = doc.content[0]
    const mentions = para.content.filter((n: any) => n.type === 'mention')
    expect(mentions).toHaveLength(2)
    expect(mentions[0].attrs.entityUri).toBe('u-123')
    // Legacy format: @[Alice](entity:p-9) — uri comes from the ( ) group
    expect(mentions[1].attrs.entityUri).toBe('p-9')
  })

  it('tolerates an empty contexts record', () => {
    const model: any = { uri: 'root', symbols: [makeSymbol({ content: 'hi' })] }
    // no `contexts` field at all
    expect(() => v3.migrate(model)).not.toThrow()
    expect(model.symbols[0].contentDoc).toMatchObject({ type: 'doc' })
  })

  it('tolerates a top-level model with no symbols array', () => {
    const model: any = { uri: 'root', contexts: {} }
    expect(() => v3.migrate(model)).not.toThrow()
  })
})

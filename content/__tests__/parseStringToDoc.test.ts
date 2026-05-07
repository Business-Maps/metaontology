import { describe, it, expect } from 'vitest'
import { parseStringToDoc } from '../parseStringToDoc'
import type { RichDocNode } from '../../types/context'

// Block ids are nanoid-generated; strip them before comparing shapes.
function stripIds(node: RichDocNode): RichDocNode {
  const { id: _id, content, ...rest } = node as RichDocNode
  const out: RichDocNode = { ...rest } as RichDocNode
  if (content) out.content = content.map(stripIds)
  return out
}

function shape(content: string) {
  const doc = parseStringToDoc(content)
  return {
    type: doc.type,
    content: doc.content.map(stripIds),
  }
}

describe('parseStringToDoc — structural fidelity', () => {
  it('empty input still yields a one-paragraph doc (ProseMirror invariant)', () => {
    expect(shape('')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    })
  })

  it('single line becomes one paragraph with one text node', () => {
    expect(shape('Hello world')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
      ],
    })
  })

  it('blank line between two prose blocks becomes an empty paragraph', () => {
    const out = shape('first line\n\nsecond line')
    expect(out.content).toHaveLength(3)
    expect(out.content[0]).toMatchObject({ type: 'paragraph' })
    expect(out.content[1]).toEqual({ type: 'paragraph' })
    expect(out.content[2]).toMatchObject({ type: 'paragraph' })
  })

  it('groups consecutive prose lines into one paragraph joined by \\n', () => {
    const out = shape('first\nsecond\nthird')
    expect(out.content).toEqual([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'first\nsecond\nthird' }],
      },
    ])
  })

  it('detects headings at levels 1, 2, 3', () => {
    const out = shape('# H1\n## H2\n### H3')
    expect(out.content).toEqual([
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'H1' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H2' }] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'H3' }] },
    ])
  })

  it('does NOT treat `####` as a heading (only levels 1-3 are supported)', () => {
    const out = shape('#### not a heading')
    expect(out.content[0]).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'text', text: '#### not a heading' }],
    })
  })

  it('recognizes exact `---` as a horizontal rule', () => {
    const out = shape('before\n---\nafter')
    expect(out.content.map(n => n.type)).toEqual(['paragraph', 'horizontalRule', 'paragraph'])
  })

  it('does NOT treat `--` (two dashes) as a rule', () => {
    const out = shape('--')
    expect(out.content[0]).toMatchObject({ type: 'paragraph' })
  })

  it('fenced code block captures language and preserves interior content', () => {
    const src = '```typescript\nconst x = 1\nconst y = 2\n```'
    const out = shape(src)
    expect(out.content).toEqual([
      {
        type: 'codeBlock',
        attrs: { language: 'typescript' },
        content: [{ type: 'text', text: 'const x = 1\nconst y = 2' }],
      },
    ])
  })

  it('unterminated fence still yields a code block (never drops user content)', () => {
    const out = shape('```\nstill here\nand here')
    expect(out.content).toEqual([
      {
        type: 'codeBlock',
        content: [{ type: 'text', text: 'still here\nand here' }],
      },
    ])
  })

  it('groups consecutive bullet items into one bulletList', () => {
    const out = shape('- one\n- two\n* three')
    expect(out.content).toEqual([
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'three' }] }] },
        ],
      },
    ])
  })

  it('groups consecutive ordered items into one orderedList', () => {
    const out = shape('1. first\n2. second\n3. third')
    expect(out.content[0]).toMatchObject({
      type: 'orderedList',
      content: [
        { type: 'listItem' },
        { type: 'listItem' },
        { type: 'listItem' },
      ],
    })
  })

  it('task items distinguish checked from unchecked', () => {
    const out = shape('- [ ] todo\n- [x] done\n- [X] also done')
    expect(out.content[0]).toMatchObject({
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: false } },
        { type: 'taskItem', attrs: { checked: true } },
        { type: 'taskItem', attrs: { checked: true } },
      ],
    })
  })

  it('a mix of bullet then task starts two separate list blocks', () => {
    const out = shape('- bullet one\n- [ ] task one')
    expect(out.content.map(n => n.type)).toEqual(['bulletList', 'taskList'])
  })

  it('consecutive blockquote lines fold into one blockquote', () => {
    const out = shape('> one\n> two\n> three')
    expect(out.content).toEqual([
      {
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'one\ntwo\nthree' }],
          },
        ],
      },
    ])
  })
})

describe('parseStringToDoc — mention preservation (the critical promise)', () => {
  it('canonical mention token becomes a mention inline node with attrs', () => {
    const out = shape('hello @[Thing:User:u-123:ctx-1] there')
    expect(out.content[0]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'hello ' },
        {
          type: 'mention',
          attrs: {
            entityUri: 'u-123',
            typeLabel: 'Thing',
            label: 'User',
            contextUri: 'ctx-1',
          },
        },
        { type: 'text', text: ' there' },
      ],
    })
  })

  it('legacy @[Name](entity:Id) mentions also become mention nodes', () => {
    const out = shape('see @[Alice](entity:alice-123)')
    expect(out.content[0]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'see ' },
        {
          type: 'mention',
          attrs: {
            entityUri: 'alice-123',
            typeLabel: 'entity',
            label: 'Alice',
          },
        },
      ],
    })
  })

  it('mentions without a contextUri do not emit a contextUri attr', () => {
    const out = shape('@[Thing:User:u-1]')
    const p = out.content[0]!.content![0]!
    expect(p).toMatchObject({ type: 'mention' })
    expect(p.attrs).not.toHaveProperty('contextUri')
  })

  it('mention inside a heading lands as a heading child', () => {
    const out = shape('## See also @[Thing:User:u-1]')
    expect(out.content[0]).toMatchObject({
      type: 'heading',
      attrs: { level: 2 },
      content: [
        { type: 'text', text: 'See also ' },
        { type: 'mention' },
      ],
    })
  })

  it('mention inside a bullet list item is preserved', () => {
    const out = shape('- go check @[Thing:Repo:r-1]')
    const para = out.content[0]!.content![0]!.content![0]!
    expect(para).toMatchObject({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'go check ' },
        { type: 'mention', attrs: { entityUri: 'r-1' } },
      ],
    })
  })

  it('every mention in a multi-line paragraph survives', () => {
    const out = shape('@[T:a:1] and @[T:b:2]\nalso @[T:c:3]')
    const inline = out.content[0]!.content!
    const mentions = inline.filter(n => n.type === 'mention')
    expect(mentions.map(m => m.attrs?.entityUri)).toEqual(['1', '2', '3'])
  })
})

describe('parseStringToDoc — block IDs', () => {
  it('every non-text node carries a stable id', () => {
    const doc = parseStringToDoc('# heading\npara\n\n- item')
    for (const block of doc.content) {
      expect(block.id).toBeDefined()
      expect(typeof block.id).toBe('string')
      expect(block.id!.length).toBeGreaterThan(0)
    }
  })

  it('two invocations on the same input produce different ids (freshness)', () => {
    const a = parseStringToDoc('hello')
    const b = parseStringToDoc('hello')
    expect(a.content[0]!.id).not.toBe(b.content[0]!.id)
  })
})

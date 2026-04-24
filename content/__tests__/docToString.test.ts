import { describe, it, expect } from 'vitest'
import { parseStringToDoc } from '../parseStringToDoc'
import { docToString } from '../docToString'
import type { RichDoc } from '../../types/context'

/** Parse → serialize → parse round-trip, then compare the two doc
 *  shapes with ids stripped. The second parse proves the serialized
 *  output still tokenizes back to the same block structure. */
function roundTrip(input: string): { out: string; reparsed: RichDoc } {
  const doc1 = parseStringToDoc(input)
  const out = docToString(doc1)
  const reparsed = parseStringToDoc(out)
  return { out, reparsed }
}

function stripIds(doc: RichDoc): unknown {
  return JSON.parse(JSON.stringify(doc, (k, v) => (k === 'id' ? undefined : v)))
}

describe('docToString — round-trip fidelity with parseStringToDoc', () => {
  it('single-line prose', () => {
    const { out, reparsed } = roundTrip('Hello world')
    expect(out).toBe('Hello world')
    expect(stripIds(reparsed)).toEqual(stripIds(parseStringToDoc('Hello world')))
  })

  it('multi-line prose grouped into one paragraph', () => {
    const input = 'first\nsecond\nthird'
    const { out } = roundTrip(input)
    expect(out).toBe(input)
  })

  it('blank-line paragraph separator preserved', () => {
    const input = 'first\n\nsecond'
    const { out, reparsed } = roundTrip(input)
    expect(out).toBe(input)
    expect(stripIds(reparsed)).toEqual(stripIds(parseStringToDoc(input)))
  })

  it('headings at all three levels', () => {
    const input = '# H1\n## H2\n### H3'
    const { out } = roundTrip(input)
    expect(out).toBe(input)
  })

  it('horizontal rule', () => {
    const input = 'before\n\n---\n\nafter'
    const { out, reparsed } = roundTrip(input)
    expect(stripIds(reparsed)).toEqual(stripIds(parseStringToDoc(input)))
    expect(out).toContain('---')
  })

  it('fenced code block with language', () => {
    const input = '```typescript\nconst x = 1\nconst y = 2\n```'
    const { out } = roundTrip(input)
    expect(out).toBe(input)
  })

  it('fenced code block without language', () => {
    const input = '```\nno lang here\n```'
    const { out } = roundTrip(input)
    expect(out).toBe(input)
  })

  it('bullet list', () => {
    const input = '- one\n- two\n- three'
    const { out } = roundTrip(input)
    expect(out).toBe(input)
  })

  it('ordered list is renumbered from 1', () => {
    const input = '1. first\n2. second\n3. third'
    const { out } = roundTrip(input)
    expect(out).toBe(input)
  })

  it('task list preserves checked state', () => {
    const input = '- [ ] todo\n- [x] done\n- [x] also done'
    const { out } = roundTrip(input)
    expect(out).toBe(input)
  })

  it('blockquote with multiple lines', () => {
    const input = '> line one\n> line two'
    const { out, reparsed } = roundTrip(input)
    expect(stripIds(reparsed)).toEqual(stripIds(parseStringToDoc(input)))
    expect(out).toContain('> ')
  })
})

describe('docToString — mention preservation (dual-write contract)', () => {
  it('canonical mention token survives the round-trip exactly', () => {
    const input = 'hello @[Thing:User:u-123:ctx-1] there'
    const { out } = roundTrip(input)
    expect(out).toBe(input)
  })

  it('mention without contextUri round-trips without adding one', () => {
    const input = '@[Thing:User:u-1]'
    const { out } = roundTrip(input)
    expect(out).toBe(input)
  })

  it('legacy @[Name](entity:Id) mention normalizes to canonical form on round-trip (self-healing)', () => {
    const input = 'see @[Alice](entity:alice-1)'
    const { out } = roundTrip(input)
    // Legacy format becomes canonical — the dual-format intent
    expect(out).toBe('see @[entity:Alice:alice-1]')
  })

  it('mention inside a heading is preserved', () => {
    const input = '## See @[Thing:User:u-1]'
    const { out } = roundTrip(input)
    expect(out).toBe(input)
  })

  it('mention inside a bullet item is preserved', () => {
    const input = '- see @[Thing:User:u-1]'
    const { out } = roundTrip(input)
    expect(out).toBe(input)
  })
})

describe('docToString — edge cases', () => {
  it('undefined / null docs produce empty string (never throw)', () => {
    expect(docToString(undefined)).toBe('')
    expect(docToString(null)).toBe('')
  })

  it('empty doc yields empty output', () => {
    const empty: RichDoc = { type: 'doc', content: [] }
    expect(docToString(empty)).toBe('')
  })

  it('unknown block types degrade to plain text instead of throwing', () => {
    const doc: RichDoc = {
      type: 'doc',
      content: [
        { type: 'mysteryBlock', content: [{ type: 'text', text: 'recovered content' }] },
      ],
    }
    expect(docToString(doc)).toBe('recovered content')
  })
})

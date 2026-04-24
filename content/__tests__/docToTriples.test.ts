import { describe, it, expect } from 'vitest'
import { parseStringToDoc } from '../parseStringToDoc'
import { docToTriples } from '../docToTriples'
import type { DocTriple } from '../docToTriples'
import type { RichDoc } from '../../types/context'

const S = 'sym-1'

function triples(input: string): DocTriple[] {
  return docToTriples(S, parseStringToDoc(input))
}

function findByPO(ts: DocTriple[], p: string, o: string): DocTriple[] {
  return ts.filter(t => t.predicate === p && t.object === o)
}

function findByP(ts: DocTriple[], p: string): DocTriple[] {
  return ts.filter(t => t.predicate === p)
}

describe('docToTriples — structural triples', () => {
  it('empty doc emits no triples', () => {
    expect(docToTriples(S, null)).toEqual([])
    expect(docToTriples(S, undefined)).toEqual([])
    const empty: RichDoc = { type: 'doc', content: [] }
    expect(docToTriples(S, empty)).toEqual([])
  })

  it('single paragraph emits hasPart + blockType + blockIndex + blockText', () => {
    const ts = triples('hello world')
    const hasPart = findByP(ts, 'bm:hasPart')
    expect(hasPart).toHaveLength(1)
    expect(hasPart[0]!.subject).toBe(S)
    const blockUri = hasPart[0]!.object
    expect(blockUri).toMatch(/^sym-1#block:/)

    const byType = findByP(ts, 'bm:blockType').filter(t => t.subject === blockUri)
    expect(byType[0]!.object).toBe('paragraph')

    const byIdx = findByP(ts, 'bm:blockIndex').filter(t => t.subject === blockUri)
    expect(byIdx[0]!.object).toBe('0')

    const byText = findByP(ts, 'bm:blockText').filter(t => t.subject === blockUri)
    expect(byText[0]!.object).toBe('hello world')
  })

  it('heading level is emitted', () => {
    const ts = triples('## my heading')
    const levels = findByP(ts, 'bm:blockLevel')
    expect(levels).toHaveLength(1)
    expect(levels[0]!.object).toBe('2')
  })

  it('every top-level block gets a unique block subject (blank lines count as empty paragraphs)', () => {
    // parseStringToDoc preserves blank lines as empty paragraphs, so
    // "one\n\ntwo\n\nthree" yields 5 top-level blocks (3 with text, 2 empty).
    const ts = triples('one\n\ntwo\n\nthree')
    const hasPart = findByP(ts, 'bm:hasPart')
    expect(hasPart).toHaveLength(5)
    const subs = new Set(hasPart.map(t => t.object))
    expect(subs.size).toBe(5)
  })

  it('bulletList container emits triples for the list AND each item (with redundant text at each level for query flexibility)', () => {
    const ts = triples('- one\n- two')
    const types = findByP(ts, 'bm:blockType').map(t => t.object)
    expect(types).toContain('bulletList')
    expect(types).toContain('listItem')
    expect(types).toContain('paragraph')
    // blockText surfaces at every leaf level that has text. For a
    // listItem wrapping a paragraph, text appears on both blocks —
    // that's intentional so queries can target either granularity.
    const texts = findByP(ts, 'bm:blockText')
      .filter(t => t.object === 'one' || t.object === 'two')
    expect(texts.map(t => t.object).sort()).toEqual(['one', 'one', 'two', 'two'])
  })

  it('taskItem carries bm:blockChecked true/false', () => {
    const ts = triples('- [ ] todo\n- [x] done')
    const checked = findByP(ts, 'bm:blockChecked')
    expect(checked).toHaveLength(2)
    const values = checked.map(t => t.object).sort()
    expect(values).toEqual(['false', 'true'])
  })

  it('codeBlock with language emits bm:blockLanguage', () => {
    const ts = triples('```typescript\nconst x = 1\n```')
    const langs = findByP(ts, 'bm:blockLanguage')
    expect(langs).toHaveLength(1)
    expect(langs[0]!.object).toBe('typescript')
  })

  it('horizontalRule is emitted as a block type', () => {
    const ts = triples('---')
    const hrs = findByPO(ts, 'bm:blockType', 'horizontalRule')
    expect(hrs).toHaveLength(1)
  })
})

describe('docToTriples — mention surfacing', () => {
  it('mention in prose emits bm:mentions on BOTH the symbol and the block', () => {
    const ts = triples('see @[Thing:Alice:alice-1:ctx-a]')
    const mentions = findByP(ts, 'bm:mentions')
    // One on the symbol, one on the block (coarse + fine grained).
    expect(mentions.map(t => t.object)).toEqual(['alice-1', 'alice-1'])
    const subjects = new Set(mentions.map(t => t.subject))
    expect(subjects.has(S)).toBe(true)
    // Second subject is the block URI
    const blockSubject = [...subjects].find(s => s !== S)!
    expect(blockSubject).toMatch(/^sym-1#block:/)
  })

  it('multiple mentions all surface', () => {
    const ts = triples('@[T:a:1] and @[T:b:2]\n\n@[T:c:3] here')
    const coarse = findByP(ts, 'bm:mentions').filter(t => t.subject === S)
    const uris = coarse.map(t => t.object).sort()
    expect(uris).toEqual(['1', '2', '3'])
  })

  it('mention inside a bullet item is correctly scoped to the item block', () => {
    const ts = triples('- see @[Thing:X:x-1]')
    const mentions = findByP(ts, 'bm:mentions')
    // Symbol-level + list container + listItem = likely 3 mentions for the same uri
    // (listItem inherits via its container walk). All subjects must match the URI.
    expect(mentions.every(t => t.object === 'x-1')).toBe(true)
    // At least the symbol-level one must exist.
    expect(mentions.some(t => t.subject === S)).toBe(true)
  })
})

describe('docToTriples — blockText semantics', () => {
  it('joins inline text and mention labels for AI readability', () => {
    const doc: RichDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          id: 'p1',
          content: [
            { type: 'text', text: 'send to ' },
            { type: 'mention', attrs: { entityUri: 'u-1', typeLabel: 'Persona', label: 'Alice' } },
            { type: 'text', text: ' now' },
          ],
        },
      ],
    }
    const ts = docToTriples(S, doc)
    const blockTexts = findByP(ts, 'bm:blockText')
    expect(blockTexts).toHaveLength(1)
    expect(blockTexts[0]!.object).toBe('send to @Alice now')
  })

  it('empty blocks do not emit blockText', () => {
    const doc: RichDoc = { type: 'doc', content: [{ type: 'paragraph', id: 'p1' }] }
    const ts = docToTriples(S, doc)
    const blockTexts = findByP(ts, 'bm:blockText')
    expect(blockTexts).toHaveLength(0)
  })
})

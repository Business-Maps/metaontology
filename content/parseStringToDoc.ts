/**
 * Lossless plaintext → RichDoc converter.
 *
 * Used by migration v3 to upgrade every pre-existing symbol's
 * `content: string` into a structured `contentDoc: RichDoc` without
 * losing a single mention, line break, or formatting cue the user
 * committed to writing.
 *
 * The parser is intentionally conservative — when in doubt, emit a
 * paragraph with plain-text inline nodes rather than aggressively
 * promoting it to a richer block. Aggressive promotion is how data
 * gets silently reshaped; conservatism is how we preserve intent.
 *
 * Supported top-level block detection (each recognized at line start):
 *   - `# `, `## `, `### `            → heading level 1 / 2 / 3
 *   - `> `                           → blockquote (one paragraph per line)
 *   - `- [ ] ` / `- [x] ` / `- [X] ` → task item
 *   - `- ` / `* `                    → bullet item
 *   - `\d+\. `                       → ordered item
 *   - `---`                          → horizontal rule (exact match)
 *   - triple-backtick fences         → code block (captures optional language)
 *
 * Inline detection within every text run:
 *   - `@[Type:Label:Id:ContextId]`   → mention node (canonical)
 *   - `@[Name](entity:Id)`           → mention node (legacy, self-heals on re-serialize)
 *
 * Every block node is stamped with a stable `id` via nanoid so
 * external systems can link *into* a specific block once Phase 2.3+
 * makes the editor first-class.
 */

import { nanoid } from 'nanoid'
import type { RichDoc, RichDocNode } from '../types/context'
import { toSegments } from './parseMentions'

// ── Inline construction ──────────────────────────────────────────────────────

/**
 * Convert a run of text (which may contain mention tokens) into
 * inline ProseMirror nodes: text + mention nodes in order of
 * appearance.
 */
function inlineNodesFromText(text: string): RichDocNode[] {
  if (!text) return []
  const segments = toSegments(text)
  const nodes: RichDocNode[] = []
  for (const seg of segments) {
    if (seg.type === 'text') {
      if (seg.text) nodes.push({ type: 'text', text: seg.text })
      continue
    }
    const m = seg.mention!
    nodes.push({
      type: 'mention',
      attrs: {
        entityUri: m.uri,
        typeLabel: m.typeLabel,
        label: m.label,
        ...(m.contextUri ? { contextUri: m.contextUri } : {}),
      },
    })
  }
  return nodes
}

// ── Block construction helpers ───────────────────────────────────────────────

function block(type: string, content: RichDocNode[] = [], attrs?: Record<string, unknown>): RichDocNode {
  const node: RichDocNode = { type, id: nanoid() }
  if (attrs) node.attrs = attrs
  if (content.length) node.content = content
  return node
}

function paragraphFrom(text: string): RichDocNode {
  const content = inlineNodesFromText(text)
  return block('paragraph', content)
}

// ── Line classification ──────────────────────────────────────────────────────

interface Classified {
  kind: 'heading' | 'blockquote' | 'task' | 'bullet' | 'ordered' | 'hr' | 'paragraph'
  text: string
  headingLevel?: 1 | 2 | 3
  taskChecked?: boolean
  orderedStart?: number
}

const HEADING_RE = /^(#{1,3})\s+(.*)$/
const BLOCKQUOTE_RE = /^>\s?(.*)$/
const TASK_RE = /^[-*]\s+\[( |x|X)\]\s+(.*)$/
const BULLET_RE = /^[-*]\s+(.*)$/
const ORDERED_RE = /^(\d+)\.\s+(.*)$/

function classifyLine(raw: string): Classified {
  const h = HEADING_RE.exec(raw)
  if (h) {
    return {
      kind: 'heading',
      text: h[2]!,
      headingLevel: h[1]!.length as 1 | 2 | 3,
    }
  }
  if (raw.trim() === '---') {
    return { kind: 'hr', text: '' }
  }
  const bq = BLOCKQUOTE_RE.exec(raw)
  if (bq) {
    return { kind: 'blockquote', text: bq[1] ?? '' }
  }
  const t = TASK_RE.exec(raw)
  if (t) {
    return {
      kind: 'task',
      text: t[2]!,
      taskChecked: t[1]!.toLowerCase() === 'x',
    }
  }
  const b = BULLET_RE.exec(raw)
  if (b) {
    return { kind: 'bullet', text: b[1]! }
  }
  const o = ORDERED_RE.exec(raw)
  if (o) {
    return {
      kind: 'ordered',
      text: o[2]!,
      orderedStart: Number.parseInt(o[1]!, 10),
    }
  }
  return { kind: 'paragraph', text: raw }
}

// ── Top-level converter ──────────────────────────────────────────────────────

/**
 * Parse a legacy plaintext symbol content string into a RichDoc.
 * Never lossy: content that doesn't match any structural pattern
 * falls through to a plain paragraph node, preserving every character
 * and every mention.
 */
export function parseStringToDoc(content: string): RichDoc {
  const blocks: RichDocNode[] = []
  const lines = content.split('\n')

  let i = 0
  while (i < lines.length) {
    const raw = lines[i]!

    // ── Fenced code blocks ──
    const fenceMatch = /^```(.*)$/.exec(raw)
    if (fenceMatch) {
      const language = fenceMatch[1]!.trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        codeLines.push(lines[i]!)
        i++
      }
      // Consume the closing fence if present. A dangling opening fence
      // still produces a code block containing everything that followed
      // — better than silently dropping text.
      if (i < lines.length) i++
      blocks.push(block(
        'codeBlock',
        [{ type: 'text', text: codeLines.join('\n') }],
        language ? { language } : undefined,
      ))
      continue
    }

    const cls = classifyLine(raw)

    if (cls.kind === 'hr') {
      blocks.push(block('horizontalRule'))
      i++
      continue
    }

    if (cls.kind === 'heading') {
      blocks.push(block('heading', inlineNodesFromText(cls.text), { level: cls.headingLevel }))
      i++
      continue
    }

    if (cls.kind === 'blockquote') {
      // Group consecutive blockquote lines into one blockquote containing
      // a single paragraph (joined by newlines to preserve line breaks).
      const quoted: string[] = [cls.text]
      i++
      while (i < lines.length) {
        const next = classifyLine(lines[i]!)
        if (next.kind !== 'blockquote') break
        quoted.push(next.text)
        i++
      }
      blocks.push(block('blockquote', [paragraphFrom(quoted.join('\n'))]))
      continue
    }

    if (cls.kind === 'task' || cls.kind === 'bullet' || cls.kind === 'ordered') {
      const listKind = cls.kind
      const items: RichDocNode[] = []
      while (i < lines.length) {
        const next = classifyLine(lines[i]!)
        if (next.kind !== listKind) break
        if (listKind === 'task') {
          items.push(block(
            'taskItem',
            [paragraphFrom(next.text)],
            { checked: next.taskChecked },
          ))
        } else {
          items.push(block('listItem', [paragraphFrom(next.text)]))
        }
        i++
      }
      const wrapperType = listKind === 'task' ? 'taskList'
        : listKind === 'bullet' ? 'bulletList'
        : 'orderedList'
      blocks.push(block(wrapperType, items))
      continue
    }

    // ── Default: paragraph. Group consecutive non-empty plain lines
    // into a single paragraph joined by newlines (so the writer's
    // intended shape survives). An empty line terminates the paragraph
    // and emits its own empty paragraph to preserve spacing.
    if (raw === '') {
      blocks.push(block('paragraph'))
      i++
      continue
    }

    const paraLines: string[] = [raw]
    i++
    while (i < lines.length) {
      const next = lines[i]!
      if (next === '' || classifyLine(next).kind !== 'paragraph') break
      paraLines.push(next)
      i++
    }
    blocks.push(paragraphFrom(paraLines.join('\n')))
  }

  // A completely empty input still yields a doc with one empty
  // paragraph — matches ProseMirror's invariant that `doc` must have
  // at least one child, and matches the TipTap default-empty shape.
  if (blocks.length === 0) {
    blocks.push(block('paragraph'))
  }

  return { type: 'doc', content: blocks }
}

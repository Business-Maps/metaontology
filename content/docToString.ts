/**
 * RichDoc → plaintext-with-mention-tokens serializer.
 *
 * The inverse of `parseStringToDoc` for every block type the parser
 * recognizes. Used during the dual-write window: every edit saves
 * BOTH `contentDoc` (canonical, structured) AND `content` (derived,
 * plaintext) so AI tools, exports, and any legacy reader that still
 * hits `.content` keeps working.
 *
 * Round-trip guarantee (for content originally produced by
 * parseStringToDoc): `parseStringToDoc(docToString(doc))` yields a
 * structurally-equivalent doc (modulo freshly-generated block ids).
 *
 * For block types the parser does not emit (like nested lists, inline
 * marks), docToString degrades gracefully — a nested bullet becomes a
 * flattened item, a bold mark is preserved as literal text with
 * `**text**` markers around it.
 */

import type { RichDoc, RichDocNode } from '../types/context'
import { serializeMention } from './parseMentions'

interface InlineCtx {
  out: string[]
}

function writeInline(nodes: RichDocNode[] | undefined, ctx: InlineCtx): void {
  if (!nodes) return
  for (const node of nodes) {
    if (node.type === 'text') {
      const text = node.text ?? ''
      const marks = node.marks ?? []
      // Inline marks → lightweight markdown-ish wrappers so docToString
      // output remains human-readable and AI-parseable. Round-tripping
      // doesn't re-parse these back to marks yet (Phase 2 parser only
      // supports block-level structure), but the user's intent is
      // preserved as literal characters.
      let wrapped = text
      const hasBold = marks.some(m => m.type === 'bold')
      const hasItalic = marks.some(m => m.type === 'italic')
      const hasCode = marks.some(m => m.type === 'code')
      if (hasCode) wrapped = `\`${wrapped}\``
      if (hasBold) wrapped = `**${wrapped}**`
      if (hasItalic) wrapped = `_${wrapped}_`
      ctx.out.push(wrapped)
      continue
    }
    if (node.type === 'mention') {
      const attrs = node.attrs ?? {}
      ctx.out.push(serializeMention({
        label: String(attrs.label ?? ''),
        typeLabel: String(attrs.typeLabel ?? 'entity'),
        uri: String(attrs.entityUri ?? ''),
        contextUri: attrs.contextUri ? String(attrs.contextUri) : undefined,
      }))
      continue
    }
    // Unknown inline node — recurse into its content to avoid dropping text.
    if (node.content) writeInline(node.content, ctx)
  }
}

function inlineText(nodes: RichDocNode[] | undefined): string {
  const ctx: InlineCtx = { out: [] }
  writeInline(nodes, ctx)
  return ctx.out.join('')
}

function writeBlock(node: RichDocNode, lines: string[]): void {
  switch (node.type) {
    case 'paragraph': {
      // An empty paragraph becomes an empty line — preserving user-intended spacing.
      lines.push(inlineText(node.content))
      return
    }
    case 'heading': {
      const level = Math.max(1, Math.min(3, Number(node.attrs?.level ?? 1))) as 1 | 2 | 3
      lines.push(`${'#'.repeat(level)} ${inlineText(node.content)}`)
      return
    }
    case 'horizontalRule': {
      lines.push('---')
      return
    }
    case 'blockquote': {
      // A blockquote holds paragraphs. Each paragraph may carry
      // interior newlines (parseStringToDoc groups consecutive `> X`
      // lines into one paragraph joined by \n). Every physical line
      // must carry the `> ` prefix on serialize — otherwise the
      // continuation lines escape the quote on re-parse.
      const inner: string[] = []
      for (const child of node.content ?? []) writeBlock(child, inner)
      for (const entry of inner) {
        for (const line of entry.split('\n')) lines.push(`> ${line}`)
      }
      return
    }
    case 'codeBlock': {
      const language = String(node.attrs?.language ?? '')
      const body = inlineText(node.content)
      lines.push('```' + language)
      // Preserve interior newlines as-is.
      for (const codeLine of body.split('\n')) lines.push(codeLine)
      lines.push('```')
      return
    }
    case 'bulletList': {
      for (const item of node.content ?? []) {
        // Each listItem contains a paragraph (per parseStringToDoc).
        const itemText = inlineText(item.content?.[0]?.content)
        lines.push(`- ${itemText}`)
      }
      return
    }
    case 'orderedList': {
      let n = 1
      for (const item of node.content ?? []) {
        const itemText = inlineText(item.content?.[0]?.content)
        lines.push(`${n}. ${itemText}`)
        n++
      }
      return
    }
    case 'taskList': {
      for (const item of node.content ?? []) {
        const checked = item.attrs?.checked === true
        const itemText = inlineText(item.content?.[0]?.content)
        lines.push(`- [${checked ? 'x' : ' '}] ${itemText}`)
      }
      return
    }
    default: {
      // Unknown block — recurse into children and flatten to text. Never drop.
      const flat = inlineText(node.content)
      if (flat) lines.push(flat)
    }
  }
}

/** Serialize a RichDoc back to plaintext-with-mention-tokens. */
export function docToString(doc: RichDoc | undefined | null): string {
  if (!doc || !Array.isArray(doc.content)) return ''
  const lines: string[] = []
  for (const block of doc.content) writeBlock(block, lines)
  return lines.join('\n')
}

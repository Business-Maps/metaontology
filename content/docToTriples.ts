/**
 * RichDoc → Triples walker.
 *
 * Produces a flat list of RDF-shaped triples that describe the
 * structure and semantic content of a symbol's contentDoc. This is
 * the key serialization that makes a doc *walkable* by the ontology:
 * block structure, prose text, mentions, todos, embeds, and code
 * language all become triples that downstream consumers (the AI
 * layer, Turtle/JSON-LD exports, a future SPARQL engine) can query.
 *
 * Triple shape (same as `engine/triples.ts` Triple):
 *   { subject, predicate, object }
 *
 * Subjects:
 *   - the host symbol's URI, for doc-level relations
 *   - `${symbolUri}#block:${blockId}` for per-block relations
 *
 * Predicates (scoped to avoid colliding with ontology predicates):
 *   - `bm:hasPart`          symbol hasPart block  (structural)
 *   - `bm:blockType`        block is of type X    (paragraph/heading/todo…)
 *   - `bm:blockIndex`       block's ordinal position (0-based)
 *   - `bm:blockLevel`       heading level (1/2/3) for heading blocks
 *   - `bm:blockLanguage`    code block language
 *   - `bm:blockChecked`     task item checked status (true/false literal)
 *   - `bm:blockText`        the block's plain text literal (joined inline)
 *   - `bm:mentions`         symbol or block mentions an entity URI
 *   - `bm:embedsResource`   block embeds an external resource URI
 *
 * Block-id strategy:
 *   Every structural block gets a stable id (stamped at parse time by
 *   `parseStringToDoc` or `TipTap → re-parse` during commit). If a
 *   block lacks an id (edge case: old data, hand-constructed doc),
 *   we synthesize one from `${symbolUri}#b${index}` so triples still
 *   have a stable subject within the doc's lifetime.
 */

import type { RichDoc, RichDocNode } from '../types/context'

export interface DocTriple {
  subject: string
  predicate: string
  object: string
}

interface WalkCtx {
  symbolUri: string
  triples: DocTriple[]
  /** Ordinal index for top-level blocks — used both for bm:blockIndex
   *  and to synthesize stable ids for blocks that lack one. */
  topIndex: number
}

function blockSubject(ctx: WalkCtx, node: RichDocNode, index: number): string {
  const id = node.id || `b${index}`
  return `${ctx.symbolUri}#block:${id}`
}

function emit(ctx: WalkCtx, s: string, p: string, o: string): void {
  ctx.triples.push({ subject: s, predicate: p, object: o })
}

/** Flatten a block's inline descendants into a single plaintext
 *  literal — skipping mentions (they become their own triples). */
function inlineText(nodes: RichDocNode[] | undefined): string {
  if (!nodes) return ''
  const parts: string[] = []
  for (const n of nodes) {
    if (n.type === 'text') {
      parts.push(n.text ?? '')
    } else if (n.type === 'mention') {
      // Represent the mention in the literal as the entity's label so
      // the surrounding prose reads naturally to an AI consumer.
      const label = String(n.attrs?.label ?? '')
      if (label) parts.push(`@${label}`)
    } else if (n.content) {
      parts.push(inlineText(n.content))
    }
  }
  return parts.join('').trim()
}

/** Emit mention triples for every mention anywhere inside `nodes`,
 *  scoped to the given block (or doc-level if blockSubject is the
 *  symbol URI). */
function emitMentions(
  ctx: WalkCtx,
  subject: string,
  nodes: RichDocNode[] | undefined,
): void {
  if (!nodes) return
  for (const n of nodes) {
    if (n.type === 'mention') {
      const uri = String(n.attrs?.entityUri ?? '')
      if (uri) emit(ctx, subject, 'bm:mentions', uri)
    } else if (n.content) {
      emitMentions(ctx, subject, n.content)
    }
  }
}

function walkBlock(ctx: WalkCtx, node: RichDocNode, index: number, depth: number): void {
  // Only top-level (depth === 0) blocks get `bm:hasPart` from the
  // symbol and `bm:blockIndex`. Nested blocks (list items, blockquote
  // paragraphs, code content) inherit via the parent's triples.
  const subject = blockSubject(ctx, node, index)
  if (depth === 0) {
    emit(ctx, ctx.symbolUri, 'bm:hasPart', subject)
    emit(ctx, subject, 'bm:blockIndex', String(index))
  }

  emit(ctx, subject, 'bm:blockType', node.type)

  // Block-type-specific facts.
  if (node.type === 'heading') {
    const level = Number(node.attrs?.level ?? 1)
    emit(ctx, subject, 'bm:blockLevel', String(level))
  }
  if (node.type === 'codeBlock') {
    const lang = String(node.attrs?.language ?? '')
    if (lang) emit(ctx, subject, 'bm:blockLanguage', lang)
  }
  if (node.type === 'taskItem') {
    const checked = node.attrs?.checked === true
    emit(ctx, subject, 'bm:blockChecked', String(checked))
  }

  // Leaf blocks: paragraph, heading, codeBlock, horizontalRule,
  // taskItem, listItem — emit their plain-text literal.
  const LEAF_TYPES = new Set([
    'paragraph', 'heading', 'codeBlock',
    'blockquote', 'listItem', 'taskItem',
  ])
  if (LEAF_TYPES.has(node.type)) {
    const text = inlineText(node.content)
    if (text) emit(ctx, subject, 'bm:blockText', text)
  }

  // Mentions live on the block they appear in (for fine-grained
  // linking) AND on the symbol (for coarse-grained lookups).
  emitMentions(ctx, subject, node.content)
  emitMentions(ctx, ctx.symbolUri, node.content)

  // Recurse into children for container blocks so nested structure
  // still surfaces as triples (e.g. a bullet list's items).
  if (node.content) {
    for (let i = 0; i < node.content.length; i++) {
      const child = node.content[i]!
      // Skip text/mention descendants — they're already captured via
      // inlineText/emitMentions above.
      if (child.type === 'text' || child.type === 'mention') continue
      walkBlock(ctx, child, i, depth + 1)
    }
  }
}

/**
 * Walk a RichDoc and return a flat list of triples describing its
 * structure and semantic content. Pure — no side effects.
 *
 * @param symbolUri  The URI of the symbol that owns this doc.
 *                   Used as the subject for doc-level relations and
 *                   as a prefix for block subjects.
 * @param doc        The RichDoc to walk.
 */
export function docToTriples(symbolUri: string, doc: RichDoc | null | undefined): DocTriple[] {
  if (!doc || !Array.isArray(doc.content)) return []
  const ctx: WalkCtx = { symbolUri, triples: [], topIndex: 0 }
  for (let i = 0; i < doc.content.length; i++) {
    walkBlock(ctx, doc.content[i]!, i, 0)
  }
  return ctx.triples
}

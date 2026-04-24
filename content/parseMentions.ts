/**
 * Mention-token parser — the canonical content-format primitives.
 *
 * Extracted to the metaontology layer (from the original home in
 * `app/composables/useMentionInput.ts`) so the migration pipeline and
 * any other framework-layer consumer can parse mention tokens without
 * crossing the layer boundary into `app/`.
 *
 * Two token formats live in the wild. Both are accepted here:
 *
 *   - `@[Type:Label:Id:ContextId]`   — canonical (all modern writes)
 *   - `@[Name](entity:Id)`           — legacy (early SymbolNode content)
 *
 * `parseMentions()` returns both, with the canonical format taking
 * precedence if the legacy regex accidentally matches overlapping text.
 */

export interface ParsedMention {
  label: string
  typeLabel: string
  uri: string
  contextUri?: string
  raw: string
  start: number
  end: number
}

const NEW_MENTION_RE = /@\[([^:\]]*):([^:\]]*):([^:\]]*)(?::([^\]]*))?\]/g
const LEGACY_MENTION_RE = /@\[([^\]]*)\]\(entity:([^)]+)\)/g

/**
 * Parse all mention tokens out of a string. Returns matches in order
 * of appearance. The legacy regex's results are dropped if they
 * overlap a canonical-format match so we never double-count the same
 * span.
 */
export function parseMentions(text: string): ParsedMention[] {
  const results: ParsedMention[] = []
  NEW_MENTION_RE.lastIndex = 0
  LEGACY_MENTION_RE.lastIndex = 0

  let m: RegExpExecArray | null
  while ((m = NEW_MENTION_RE.exec(text)) !== null) {
    results.push({
      typeLabel: m[1]!,
      label: m[2]!,
      uri: m[3]!,
      contextUri: m[4] || undefined,
      raw: m[0],
      start: m.index,
      end: m.index + m[0].length,
    })
  }

  while ((m = LEGACY_MENTION_RE.exec(text)) !== null) {
    const overlaps = results.some(r => m!.index < r.end && m!.index + m![0].length > r.start)
    if (overlaps) continue
    results.push({
      typeLabel: 'entity',
      label: m[1]!,
      uri: m[2]!,
      raw: m[0],
      start: m.index,
      end: m.index + m[0].length,
    })
  }

  results.sort((a, b) => a.start - b.start)
  return results
}

/** Serialize a mention back to the canonical token format. */
export function serializeMention(mention: {
  label: string
  typeLabel: string
  uri: string
  contextUri?: string
}): string {
  const ctxSuffix = mention.contextUri ? `:${mention.contextUri}` : ''
  return `@[${mention.typeLabel}:${mention.label}:${mention.uri}${ctxSuffix}]`
}

/** One span of a string: either literal text or a resolved mention. */
export interface ContentSegment {
  type: 'text' | 'mention'
  text: string
  mention?: ParsedMention
}

/**
 * Split a string into an ordered list of text + mention segments.
 * Useful for renderers and for the plaintext→RichDoc converter.
 */
export function toSegments(text: string): ContentSegment[] {
  const segments: ContentSegment[] = []
  const mentions = parseMentions(text)
  let cursor = 0
  for (const m of mentions) {
    if (m.start > cursor) {
      segments.push({ type: 'text', text: text.slice(cursor, m.start) })
    }
    segments.push({ type: 'mention', text: m.label, mention: m })
    cursor = m.end
  }
  if (cursor < text.length) {
    segments.push({ type: 'text', text: text.slice(cursor) })
  }
  return segments
}

/**
 * I18nLiteral - a localized string primitive for the metaontology.
 *
 * The metaontology deliberately does not hardcode display strings in any
 * particular language. Any field that is meant to be shown to a human -
 * labels, singular names, hints, descriptions - should use `I18nLiteral`
 * instead of a bare `string`.
 *
 * English is mandatory (it is the universal fallback), but the type stays
 * open to any number of additional language keys. Consumers resolve a
 * literal to a concrete string via `resolveI18n()`, passing the active
 * locale. If the requested locale is missing, the helper falls back to
 * English.
 *
 * This keeps the registry compact (translations live alongside the value
 * they translate, not in a separate table) and forward-compatible
 * (adding a new language is purely additive - no schema change).
 */

/** A localized string. English is required; other languages are optional. */
export type I18nLiteral = { en: string } & { [lang: string]: string }

/**
 * Resolve an `I18nLiteral` to a plain string for a given locale.
 *
 * Resolution rules:
 *   1. If `lang` is provided and the literal has that key, return it.
 *   2. Otherwise, fall back to the English key (always present).
 *
 * Accepts a plain `string` passthrough so migration is gradual - callers
 * can use `resolveI18n()` uniformly even on values that are still strings
 * in parts of the codebase that have not been localized yet.
 */
export function resolveI18n(literal: I18nLiteral | string | undefined, lang?: string): string {
  if (literal === undefined) return ''
  if (typeof literal === 'string') return literal
  if (lang && literal[lang]) return literal[lang]
  return literal.en
}

/**
 * Ergonomic factory for constructing an `I18nLiteral` from an English
 * string plus an optional dictionary of additional translations.
 *
 * Usage:
 *   i18n('Things')                                // just English
 *   i18n('Things', { es: 'Cosas', fr: 'Choses' }) // with translations
 */
export function i18n(en: string, more?: Record<string, string>): I18nLiteral {
  return { en, ...(more ?? {}) }
}

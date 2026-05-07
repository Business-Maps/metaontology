/**
 * Custom Type Merge Logic - pure functions for merging user-defined entity types
 * into the built-in registries. No Vue dependencies.
 */

import type { UserDefinedEntityType, UserDefinedFieldDef, FacetType } from '../types/context'
import type { FacetMetaItem } from './facets'
import type { FacetFieldDef, FieldWidget } from './fields'
import { FACET_TYPES } from './facets'
import { FACET_FIELD_DEFS } from './fields'
import { i18n } from './i18n'

export interface MergedRegistries {
  allFacetTypes: string[]
  allFacetRegistry: Record<string, FacetMetaItem>
  allFieldDefs: FacetFieldDef[]
}

/**
 * Merge custom types into the built-in registries (pure, no reactive state).
 *
  * `baseFacetRegistry` is injected by the caller - it's the
  * presentation-merged registry from the consumer. This keeps the metaontology free of
  * domain-specific branding while still letting consumers compose
  * custom types over their chosen presentation.
 */
export function mergeCustomTypes(
  customTypes: readonly UserDefinedEntityType[],
  baseFacetRegistry: Record<FacetType, FacetMetaItem>,
): MergedRegistries {
  // allFacetTypes
  const allFacetTypes = [
    ...FACET_TYPES,
    ...customTypes.map(ct => ct.pluralKey),
  ]

  // allFacetRegistry - start from the caller-provided base, then add custom-type entries.
  const allFacetRegistry: Record<string, FacetMetaItem> = { ...baseFacetRegistry }
  for (const ct of customTypes) {
    allFacetRegistry[ct.pluralKey] = {
      key: ct.pluralKey as FacetType,
      // User-defined types carry bare `string` labels in the editor; wrap them
      // as I18nLiteral so the merged registry's shape stays consistent with
      // BASE_FACET_REGISTRY. Translations for custom types can be added later
      // by extending the custom-type editor to accept a dictionary.
      label: i18n(ct.label),
      singular: i18n(ct.singular),
      color: ct.color,
      icon: ct.icon ?? '',
      hint: ct.description,
      nodeType: 'custom',
      entityClass: ct.id as any,
      tier: ct.tier,
    }
  }

  // allFieldDefs
  const extra: FacetFieldDef[] = []
  for (const ct of customTypes) {
    for (const field of ct.fields) {
      extra.push({
        paramName: field.name,
        schema: fieldDefToSchema(field),
        facetTypes: [ct.pluralKey as FacetType],
        aiDescription: field.description ?? field.label ?? field.name,
        defaultValue: field.defaultValue,
        widget: fieldDefToWidget(field),
        label: field.label ?? field.name,
      })
    }
    // All custom types get tags
    extra.push({
      paramName: 'tags',
      schema: { type: 'array', items: { type: 'string' } },
      facetTypes: [ct.pluralKey as FacetType],
      aiDescription: 'Classification labels',
      widget: 'chips-string',
      label: 'Tags',
    })
    // All custom types get description
    extra.push({
      paramName: 'description',
      schema: { type: 'string' },
      facetTypes: [ct.pluralKey as FacetType],
      aiDescription: 'Description',
      defaultValue: '',
      widget: 'textarea',
      label: 'Description',
    })
  }
  const allFieldDefs = [...FACET_FIELD_DEFS, ...extra]

  return { allFacetTypes, allFacetRegistry, allFieldDefs }
}

export function fieldDefToSchema(field: UserDefinedFieldDef): FacetFieldDef['schema'] {
  switch (field.type) {
    case 'string':
    case 'text':
      return { type: 'string' }
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'select':
      return { type: 'string', enum: field.enumValues ?? [] }
    case 'array-string':
      return { type: 'array', items: { type: 'string' } }
    default:
      return { type: 'string' }
  }
}

export function fieldDefToWidget(field: UserDefinedFieldDef): FieldWidget {
  switch (field.type) {
    case 'text': return 'textarea'
    case 'string': return 'text'
    case 'number': return 'text'
    case 'boolean': return 'select'
    case 'select': return 'select'
    case 'array-string': return 'array-string'
    default: return 'text'
  }
}

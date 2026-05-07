/**
 * Built-in value types - semantic wrappers around base datatypes with
 * validation constraints.
 */

import { defineValueType } from '../dsl/defineGeneric'

export const emailVt = defineValueType('email', {
  baseType: 'text',
  constraints: [{ type: 'regex', pattern: '^[^@]+@[^@]+\\.[^@]+$', message: 'Must be a valid email' }],
  label: { en: 'Email Address' },
})

export const urlVt = defineValueType('url', {
  baseType: 'uri',
  constraints: [{ type: 'regex', pattern: '^https?://', message: 'Must be a valid URL' }],
  label: { en: 'URL' },
})

export const phoneVt = defineValueType('phone', {
  baseType: 'text',
  constraints: [{ type: 'regex', pattern: '^\\+?[0-9\\s\\-()]+$' }],
  label: { en: 'Phone Number' },
})

export const countryCodeVt = defineValueType('country-code', {
  baseType: 'text',
  constraints: [
    { type: 'length', min: 2, max: 2 },
    { type: 'regex', pattern: '^[A-Z]{2}$' },
  ],
  label: { en: 'Country Code' },
})

export const currencyCodeVt = defineValueType('currency-code', {
  baseType: 'text',
  constraints: [
    { type: 'length', min: 3, max: 3 },
    { type: 'regex', pattern: '^[A-Z]{3}$' },
  ],
  label: { en: 'Currency Code' },
})

export const hexColorVt = defineValueType('hex-color', {
  baseType: 'text',
  constraints: [{ type: 'regex', pattern: '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' }],
  label: { en: 'Hex Color' },
})

export const slugVt = defineValueType('slug', {
  baseType: 'identifier',
  constraints: [{ type: 'regex', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' }],
  label: { en: 'URL Slug' },
})

export const percentage0to100Vt = defineValueType('percentage-0-100', {
  baseType: 'percentage',
  constraints: [{ type: 'range', min: 0, max: 100 }],
  label: { en: 'Percentage (0-100)' },
})

export const positiveIntegerVt = defineValueType('positive-integer', {
  baseType: 'integer',
  constraints: [{ type: 'range', min: 0 }],
  label: { en: 'Positive Integer' },
})

export const rating5Vt = defineValueType('rating-5', {
  baseType: 'integer',
  constraints: [{ type: 'range', min: 1, max: 5 }],
  label: { en: 'Rating (1-5)' },
})

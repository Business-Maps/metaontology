import type { ContextMapPattern } from '../types/context'

/** Action sub-type display labels */
export const ACTION_SUBTYPE_LABELS = {
  command: { default: 'Changes something', ddd: 'Command' },
  query:   { default: 'Looks something up', ddd: 'Query' },
  intent:  { default: 'Requests an outcome', ddd: 'Intent' },
} as const

/** Context Map pattern display labels */
export const CONTEXT_MAP_PATTERN_LABELS: Record<ContextMapPattern, { default: string; ddd: string }> = {
  'partnership':           { default: 'Work together',             ddd: 'Partnership' },
  'customer-supplier':     { default: 'One provides, one consumes', ddd: 'Customer-Supplier' },
  'conformist':            { default: 'Accept as-is',              ddd: 'Conformist' },
  'anticorruption-layer':  { default: 'Translate to protect',      ddd: 'Anticorruption Layer' },
  'open-host-service':     { default: 'Provide a clear protocol',  ddd: 'Open Host Service' },
  'published-language':    { default: 'Share a common format',     ddd: 'Published Language' },
  'shared-kernel':         { default: 'Share a subset',            ddd: 'Shared Kernel' },
  'separate-ways':         { default: 'Independent',               ddd: 'Separate Ways' },
}

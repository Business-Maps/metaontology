/**
 * Value type definitions - extracted from context.ts to break the circular
 * dependency between ontology.ts and the generated types file.
 *
 * These are M2 metaontology concepts: they define how value types work,
 * not specific domain entities.
 */

export interface ValueConstraint {
  type: 'regex' | 'enum' | 'range' | 'length' | 'custom'
  pattern?: string
  message?: string
  allowedValues?: string[]
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  expression?: string
  description?: string
}

export interface ValueTypeDef {
  id: string
  label: string
  baseType: string
  constraints: ValueConstraint[]
  renderHint?: string
  description?: string
}

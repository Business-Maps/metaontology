/**
 * Pipeline mapping engine tests -
 *   4. field mapping with transform (via injected callback)
 *   5. link mapping - resolve a target by externalId
 *   6. filter - skip records the predicate rejects
 *   7. missing required field - surface as a mapping error
 *   8. idempotency on re-run - same input produces identical output
 */

import { describe, it, expect } from 'vitest'
import { runMapping, evalPath, evalPredicate } from '../mappingEngine'
import type { PipelineMapping } from '../../types/context'

// ── evalPath primitive coverage ────────────────────────────────────────────

describe('mappingEngine - evalPath', () => {
  it('$ returns the record itself', () => {
    expect(evalPath('$', { a: 1 })).toEqual({ a: 1 })
  })

  it('$.path walks dot notation', () => {
    const record = { customer: { email: 'a@b.com', name: 'Alice' } }
    expect(evalPath('$.customer.email', record)).toBe('a@b.com')
    expect(evalPath('$.customer.name', record)).toBe('Alice')
  })

  it('paths without $ prefix also work', () => {
    expect(evalPath('a.b.c', { a: { b: { c: 42 } } })).toBe(42)
  })

  it('returns undefined for missing paths', () => {
    expect(evalPath('$.missing', { a: 1 })).toBeUndefined()
    expect(evalPath('$.a.nested.deep', { a: { nested: null } })).toBeUndefined()
  })

  it('handles numeric literals', () => {
    expect(evalPath('42', {})).toBe(42)
    expect(evalPath('3.14', {})).toBe(3.14)
    expect(evalPath('-7', {})).toBe(-7)
  })

  it('handles boolean + null literals', () => {
    expect(evalPath('true', {})).toBe(true)
    expect(evalPath('false', {})).toBe(false)
    expect(evalPath('null', {})).toBeNull()
  })

  it('handles double-quoted string literals', () => {
    expect(evalPath('"hello"', {})).toBe('hello')
  })
})

describe('mappingEngine - evalPredicate', () => {
  it('returns true for truthy values', () => {
    expect(evalPredicate('$.active', { active: true })).toBe(true)
    expect(evalPredicate('$.count', { count: 5 })).toBe(true)
    expect(evalPredicate('$.name', { name: 'hi' })).toBe(true)
  })

  it('returns false for falsy values', () => {
    expect(evalPredicate('$.active', { active: false })).toBe(false)
    expect(evalPredicate('$.count', { count: 0 })).toBe(false)
    expect(evalPredicate('$.name', { name: '' })).toBe(false)
    expect(evalPredicate('$.missing', { a: 1 })).toBe(false)
  })
})

// ── Acceptance case 1: iterate ────────────────────────────────────────────

describe('mappingEngine - case 1: iterate', () => {
  it('walks mapping.iterate to find the record array', () => {
    const stripeResponse = {
      object: 'list',
      data: [
        { id: 'cus_1', email: 'a@x.com' },
        { id: 'cus_2', email: 'b@x.com' },
      ],
    }
    const mapping: PipelineMapping = {
      iterate: '$.data',
      identity: { externalId: '$.id' },
      fields: { email: '$.email' },
    }

    const result = runMapping(stripeResponse, mapping)
    expect(result.instances).toHaveLength(2)
    expect(result.instances[0]!.externalId).toBe('cus_1')
    expect(result.instances[1]!.externalId).toBe('cus_2')
  })

  it('treats the response as a single record when iterate is omitted', () => {
    const singleRecord = { id: 'only-one', email: 'x@y.com' }
    const mapping: PipelineMapping = {
      identity: { externalId: '$.id' },
      fields: { email: '$.email' },
    }

    const result = runMapping(singleRecord, mapping)
    expect(result.instances).toHaveLength(1)
    expect(result.instances[0]!.externalId).toBe('only-one')
  })
})

// ── Acceptance case 2: identity ───────────────────────────────────────────

describe('mappingEngine - case 2: identity (upsert key)', () => {
  it('extracts externalId via the identity path', () => {
    const record = { stripeId: 'cus_abc123', email: 'x@y.com' }
    const mapping: PipelineMapping = {
      identity: { externalId: '$.stripeId' },
      fields: { email: '$.email' },
    }
    const result = runMapping(record, mapping)
    expect(result.instances[0]!.externalId).toBe('cus_abc123')
  })

  it('coerces non-string externalIds to strings', () => {
    const record = { id: 42, email: 'x@y.com' }
    const mapping: PipelineMapping = {
      identity: { externalId: '$.id' },
      fields: { email: '$.email' },
    }
    const result = runMapping(record, mapping)
    expect(result.instances[0]!.externalId).toBe('42')
  })

  it('reports a mapping error when identity path does not resolve', () => {
    const record = { email: 'x@y.com' } // missing id
    const mapping: PipelineMapping = {
      identity: { externalId: '$.id' },
      fields: { email: '$.email' },
    }
    const result = runMapping(record, mapping)
    expect(result.instances).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.reason).toMatch(/identity.externalId/)
  })
})

// ── Acceptance cases 3-4: field mapping (simple + with transform) ─────────

describe('mappingEngine - case 3-4: field mapping', () => {
  it('maps simple JSONata paths to target fields', () => {
    const record = {
      id: 'c-1',
      contact: { email: 'a@b.com', phone: '555-1234' },
      stats: { total: 100 },
    }
    const mapping: PipelineMapping = {
      identity: { externalId: '$.id' },
      fields: {
        email: '$.contact.email',
        phone: '$.contact.phone',
        lifetimeTotal: '$.stats.total',
      },
    }
    const result = runMapping(record, mapping)
    expect(result.instances[0]!.fields).toEqual({
      email: 'a@b.com',
      phone: '555-1234',
      lifetimeTotal: 100,
    })
  })

  it('applies transform via the injected invokeTransform callback', () => {
    const record = { id: 'c-1', phone: '555 1234' }
    const mapping: PipelineMapping = {
      identity: { externalId: '$.id' },
      fields: {
        phone: { source: '$.phone', transform: 'normalizePhone' },
      },
    }
    const result = runMapping(record, mapping, {
      invokeTransform(fnId, value) {
        expect(fnId).toBe('normalizePhone')
        return String(value).replace(/\s/g, '-')
      },
    })
    expect(result.instances[0]!.fields.phone).toBe('555-1234')
  })

  it('falls back to defaultValue when the source path is undefined', () => {
    const record = { id: 'c-1' }
    const mapping: PipelineMapping = {
      identity: { externalId: '$.id' },
      fields: {
        email: { source: '$.email', defaultValue: 'unknown@example.com' },
      },
    }
    const result = runMapping(record, mapping)
    expect(result.instances[0]!.fields.email).toBe('unknown@example.com')
  })

  it('transform failure surfaces as a mapping error', () => {
    const record = { id: 'c-1', email: 'bad' }
    const mapping: PipelineMapping = {
      identity: { externalId: '$.id' },
      fields: {
        email: { source: '$.email', transform: 'validateEmail' },
      },
    }
    const result = runMapping(record, mapping, {
      invokeTransform() {
        throw new Error('Not a valid email')
      },
    })
    expect(result.instances).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.reason).toMatch(/Transform "validateEmail" failed/)
    expect(result.errors[0]!.field).toBe('email')
  })
})

// ── Acceptance case 5: link mapping ───────────────────────────────────────

describe('mappingEngine - case 5: link mapping', () => {
  it('extracts outgoing links resolved by externalId', () => {
    const record = { id: 'c-1', email: 'a@b.com', subscriptionId: 'sub-99' }
    const mapping: PipelineMapping = {
      identity: { externalId: '$.id' },
      fields: { email: '$.email' },
      links: [
        {
          predicate: 'hasSubscription',
          targetThingId: 'thing-subscription',
          match: '$.subscriptionId',
        } as any,
      ],
    }
    const result = runMapping(record, mapping)
    expect(result.instances[0]!.links).toHaveLength(1)
    expect(result.instances[0]!.links[0]).toEqual({
      predicate: 'hasSubscription',
      targetThingId: 'thing-subscription',
      targetExternalId: 'sub-99',
    })
  })

  it('silently skips links whose match path is undefined (not a hard error)', () => {
    const record = { id: 'c-1', email: 'a@b.com' } // no subscriptionId
    const mapping: PipelineMapping = {
      identity: { externalId: '$.id' },
      fields: { email: '$.email' },
      links: [
        {
          predicate: 'hasSubscription',
          targetThingId: 'thing-subscription',
          match: '$.subscriptionId',
        } as any,
      ],
    }
    const result = runMapping(record, mapping)
    expect(result.instances).toHaveLength(1)
    expect(result.instances[0]!.links).toHaveLength(0)
    // No error - unresolved links are a "try again later" signal, not a failure
    expect(result.errors).toHaveLength(0)
  })
})

// ── Acceptance case 6: filter ─────────────────────────────────────────────

describe('mappingEngine - case 6: filter', () => {
  it('skips records where the filter predicate is falsy', () => {
    const records = [
      { id: '1', active: true, name: 'A' },
      { id: '2', active: false, name: 'B' },
      { id: '3', active: true, name: 'C' },
    ]
    const mapping: PipelineMapping = {
      iterate: '$',
      identity: { externalId: '$.id' },
      fields: { name: '$.name' },
      filter: '$.active',
    }
    const result = runMapping(records, mapping)
    expect(result.instances).toHaveLength(2)
    expect(result.instances.map(i => i.externalId)).toEqual(['1', '3'])
    expect(result.skipped).toBe(1)
  })
})

// ── Acceptance case 7: missing required field ────────────────────────────

describe('mappingEngine - case 7: missing required field', () => {
  it('reports a mapping error for a missing source path without defaultValue', () => {
    const record = { id: 'c-1', name: 'NoEmail' }
    const mapping: PipelineMapping = {
      identity: { externalId: '$.id' },
      fields: {
        name: '$.name',
        email: '$.email', // source missing, no default
      },
    }
    const result = runMapping(record, mapping)
    expect(result.instances).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.reason).toMatch(/Required field "email"/)
  })

  it('preserves null as a valid value (only undefined triggers missing)', () => {
    const record = { id: 'c-1', email: null }
    const mapping: PipelineMapping = {
      identity: { externalId: '$.id' },
      fields: { email: '$.email' },
    }
    const result = runMapping(record, mapping)
    expect(result.instances).toHaveLength(1)
    expect(result.instances[0]!.fields.email).toBeNull()
  })
})

// ── Acceptance case 8: idempotency ────────────────────────────────────────

describe('mappingEngine - case 8: idempotency on re-run', () => {
  it('the same input produces byte-identical output across runs', () => {
    const records = [
      { id: '1', email: 'a@x.com', orderTotal: 42 },
      { id: '2', email: 'b@x.com', orderTotal: 99 },
    ]
    const mapping: PipelineMapping = {
      iterate: '$',
      identity: { externalId: '$.id' },
      fields: {
        email: '$.email',
        total: '$.orderTotal',
      },
    }

    const run1 = runMapping(records, mapping)
    const run2 = runMapping(records, mapping)
    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2))
  })

  it('idempotent across N parallel evaluations', () => {
    const records = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      value: i * 10,
    }))
    const mapping: PipelineMapping = {
      iterate: '$',
      identity: { externalId: '$.id' },
      fields: { value: '$.value' },
    }

    const runs = Array.from({ length: 5 }, () => runMapping(records, mapping))
    const canonical = JSON.stringify(runs[0])
    for (const r of runs) {
      expect(JSON.stringify(r)).toBe(canonical)
    }
  })
})

// ── Mixed cases - a realistic Stripe-style ingestion ─────────────────────

describe('mappingEngine - Stripe-style realistic mapping', () => {
  it('handles a full Stripe customer list payload', () => {
    const stripeResponse = {
      object: 'list',
      has_more: false,
      data: [
        {
          id: 'cus_001',
          email: 'alice@example.com',
          name: 'Alice',
          default_source: 'card_123',
          metadata: { tier: 'gold' },
          livemode: true,
        },
        {
          id: 'cus_002',
          email: 'bob@example.com',
          name: 'Bob',
          default_source: null, // link will be skipped
          metadata: { tier: 'silver' },
          livemode: true,
        },
        {
          id: 'cus_003',
          email: 'test@example.com',
          name: 'Test',
          default_source: 'card_456',
          metadata: { tier: 'bronze' },
          livemode: false, // filtered out
        },
      ],
    }

    const mapping: PipelineMapping = {
      iterate: '$.data',
      identity: { externalId: '$.id' },
      fields: {
        email: '$.email',
        name: '$.name',
        tier: '$.metadata.tier',
      },
      filter: '$.livemode',
      links: [
        {
          predicate: 'hasDefaultSource',
          targetThingId: 'thing-card',
          match: '$.default_source',
        } as any,
      ],
    }

    const result = runMapping(stripeResponse, mapping)

    expect(result.instances).toHaveLength(2) // Alice + Bob (Test filtered)
    expect(result.skipped).toBe(1)

    const alice = result.instances.find(i => i.externalId === 'cus_001')!
    expect(alice.fields.email).toBe('alice@example.com')
    expect(alice.fields.tier).toBe('gold')
    expect(alice.links).toHaveLength(1)
    expect(alice.links[0]!.targetExternalId).toBe('card_123')

    const bob = result.instances.find(i => i.externalId === 'cus_002')!
    expect(bob.fields.tier).toBe('silver')
    // Bob's default_source is null → link silently skipped
    expect(bob.links).toHaveLength(0)
  })
})

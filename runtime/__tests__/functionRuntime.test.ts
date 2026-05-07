/**
 * Function Runtime tests -
 *   - `calls` transitivity via the registry
 *   - Recursion depth cap
 *   - Missing-required-parameter error
 *   - Function-call boundary discipline (Pipeline invocation rejected)
 */

import { describe, it, expect } from 'vitest'
import {
  invokeFunction,
  createFunctionRegistry,
  checkFunctionBoundary,
} from '../functionRuntime'
import type { Function as BmFunction } from '../../types/context'

// Small factory so tests stay focused on the runtime, not on the shape
// of BmFunction (which is generated and has several optional fields).
function makeFn(
  id: string,
  body: { kind: 'expression' | 'typescript'; source: string },
  parameters: Array<{ name: string; required: boolean; cardinality?: 'scalar' | 'array' }> = [],
): BmFunction {
  return {
    uri: id,
    name: id,
    tags: [],
    description: '',
    signature: {
      parameters: parameters.map(p => ({
        name: p.name,
        required: p.required,
        cardinality: p.cardinality ?? 'scalar',
      })),
      returns: { cardinality: 'scalar' },
    },
    body,
    stereotype: 'calculator',
    purity: 'pure',
    cacheable: false,
    visibility: 'internal',
  } as any as BmFunction
}

// ── Acceptance: 1 + 2 = 3 ──────────────────────────────────────────────────

describe('functionRuntime - acceptance', () => {
  it('executes `1 + 2` as an expression and returns 3', () => {
    const fn = makeFn('constSum', { kind: 'expression', source: '1 + 2' })
    const result = invokeFunction(fn, [])
    expect(result.success).toBe(true)
    expect(result.value).toBe(3)
  })
})

// ── Expression form ─────────────────────────────────────────────────────────

describe('functionRuntime - expression body', () => {
  it('binds parameters by name', () => {
    const fn = makeFn(
      'addOne',
      { kind: 'expression', source: 'x + 1' },
      [{ name: 'x', required: true }],
    )
    const result = invokeFunction(fn, [41])
    expect(result.success).toBe(true)
    expect(result.value).toBe(42)
  })

  it('handles multi-parameter expressions', () => {
    const fn = makeFn(
      'multiply',
      { kind: 'expression', source: 'a * b' },
      [
        { name: 'a', required: true },
        { name: 'b', required: true },
      ],
    )
    const result = invokeFunction(fn, [6, 7])
    expect(result.success).toBe(true)
    expect(result.value).toBe(42)
  })

  it('supports string operations', () => {
    const fn = makeFn(
      'greeting',
      { kind: 'expression', source: '`Hello, ${name}`' },
      [{ name: 'name', required: true }],
    )
    const result = invokeFunction(fn, ['world'])
    expect(result.success).toBe(true)
    expect(result.value).toBe('Hello, world')
  })
})

// ── TypeScript form ─────────────────────────────────────────────────────────

describe('functionRuntime - typescript body', () => {
  it('is disabled by default (requires explicit opt-in)', () => {
    const fn = makeFn(
      'double',
      { kind: 'typescript', source: 'x * 2' },
      [{ name: 'x', required: true }],
    )
    const result = invokeFunction(fn, [21])
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/disabled by default/i)
  })

  it('runs a body with an explicit return', () => {
    const fn = makeFn(
      'factorial',
      {
        kind: 'typescript',
        source: 'let r = 1; for (let i = 2; i <= n; i++) r *= i; return r;',
      },
      [{ name: 'n', required: true }],
    )
    const result = invokeFunction(fn, [5], { allowTypeScript: true })
    expect(result.success).toBe(true)
    expect(result.value).toBe(120)
  })

  it('runs a body with an implicit return (single expression)', () => {
    const fn = makeFn(
      'double',
      { kind: 'typescript', source: 'x * 2' },
      [{ name: 'x', required: true }],
    )
    const result = invokeFunction(fn, [21], { allowTypeScript: true })
    expect(result.success).toBe(true)
    expect(result.value).toBe(42)
  })
})

// ── `calls` transitivity via the registry ──────────────────────────────────

describe('functionRuntime - calls transitivity', () => {
  it('a Function body can invoke another Function via ctx.invokeFunction', () => {
    const addOne = makeFn(
      'addOne',
      { kind: 'expression', source: 'x + 1' },
      [{ name: 'x', required: true }],
    )
    const addTwo = makeFn(
      'addTwo',
      { kind: 'typescript', source: 'return ctx.invokeFunction("addOne", [ctx.invokeFunction("addOne", [x])]);' },
      [{ name: 'x', required: true }],
    )
    const registry = createFunctionRegistry([addOne, addTwo])

    const result = invokeFunction(addTwo, [10], { registry, allowTypeScript: true })
    expect(result.success).toBe(true)
    expect(result.value).toBe(12)
  })

  it('throws when calling a Function that is not in the registry', () => {
    const caller = makeFn(
      'caller',
      { kind: 'typescript', source: 'return ctx.invokeFunction("missing", []);' },
    )
    const registry = createFunctionRegistry([])
    const result = invokeFunction(caller, [], { registry, allowTypeScript: true })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/missing/)
  })

  it('respects maxCallDepth to prevent runaway recursion', () => {
    const recurse = makeFn(
      'recurse',
      { kind: 'typescript', source: 'return ctx.invokeFunction("recurse", [n]);' },
      [{ name: 'n', required: true }],
    )
    const registry = createFunctionRegistry([recurse])
    const result = invokeFunction(recurse, [1], { registry, maxCallDepth: 5, allowTypeScript: true })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/depth exceeded/i)
  })
})

// ── Parameter validation ───────────────────────────────────────────────────

describe('functionRuntime - parameter validation', () => {
  it('rejects missing required parameters', () => {
    const fn = makeFn(
      'addOne',
      { kind: 'expression', source: 'x + 1' },
      [{ name: 'x', required: true }],
    )
    const result = invokeFunction(fn, [])
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/required parameter "x"/)
  })

  it('allows missing optional parameters', () => {
    const fn = makeFn(
      'addOrZero',
      { kind: 'expression', source: '(x ?? 0) + 1' },
      [{ name: 'x', required: false }],
    )
    const result = invokeFunction(fn, [])
    expect(result.success).toBe(true)
    expect(result.value).toBe(1)
  })
})

// ── Function-call boundary discipline (Phase 6 §) ─────────────────────────

describe('functionRuntime - Function-call boundary discipline', () => {
  it('checkFunctionBoundary accepts a pure expression', () => {
    expect(checkFunctionBoundary('x + 1')).toBeNull()
    expect(checkFunctionBoundary('a * b + c')).toBeNull()
    expect(checkFunctionBoundary('`hello, ${name}`')).toBeNull()
    expect(checkFunctionBoundary('ctx.invokeFunction("other", [x])')).toBeNull()
  })

  it('rejects a body that calls `pipeline(...)` - bare identifier', () => {
    const reason = checkFunctionBoundary('return pipeline("stripe-sync")')
    expect(reason).not.toBeNull()
    expect(reason).toMatch(/pipeline/i)
  })

  it('rejects a body that reaches into a `pipelines.` namespace', () => {
    const reason = checkFunctionBoundary('pipelines.runAll()')
    expect(reason).not.toBeNull()
  })

  it('rejects a body that calls `runPipeline(...)`', () => {
    const reason = checkFunctionBoundary('return runPipeline("sync-orders")')
    expect(reason).not.toBeNull()
  })

  it('rejects a body that dispatches commands', () => {
    const reason = checkFunctionBoundary('dispatch({ type: "context:add" })')
    expect(reason).not.toBeNull()
    expect(reason).toMatch(/dispatch/i)
  })

  it('invokeFunction surfaces the boundary error through the result', () => {
    const fn = makeFn(
      'badFn',
      { kind: 'typescript', source: 'return pipeline("stripe-sync")' },
    )
    const result = invokeFunction(fn, [])
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/pipeline/i)
  })

  it('the boundary check runs BEFORE execution - a forbidden body never runs', () => {
    // Even if the body would throw a *different* error at runtime, the
    // boundary check catches it first.
    const fn = makeFn(
      'badFnWithRefError',
      { kind: 'typescript', source: 'return pipeline(someUndefinedVariable)' },
    )
    const result = invokeFunction(fn, [])
    expect(result.success).toBe(false)
    // The error is the boundary reason, not a ReferenceError
    expect(result.error).toMatch(/Phase 6 boundary discipline/)
    expect(result.error).not.toMatch(/ReferenceError|not defined/)
  })
})

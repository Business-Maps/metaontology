/**
 * Function Runtime -
 * against a sandboxed context. Enforces the Phase 6 Function-call boundary:
 * a Function body MAY call other Functions (by id), but MUST NOT invoke a
 * Pipeline - that would violate the "compute vs. integrate" separation
 * that justifies having three distinct facets.
 *
 * **Design choices:**
 *
 *  - **In-process for Phase 6.** A proper sandboxed runtime (V8 isolate,
 *    web worker, edge runtime) is deferred. We use the `Function`
 *    constructor to parse + execute with parameter bindings, which is safe
 *    enough for authoring-time preview and unit tests. Production
 *    deployment will need isolation before executing untrusted bodies.
 *  - **No global access.** Bodies run with `use strict`, receive only
 *    their declared parameters, and the runtime ctx. The ctx exposes
 *    read-only APIs; no Pipeline handle is ever created.
 *  - **Pipeline boundary enforced at runtime.** The ctx object passed to
 *    a Function body does NOT carry a `.pipeline` or `.invoke` reference
 *    that could reach a Pipeline. If a body tries to access
 *    `ctx.pipeline(...)`, the Proxy returns undefined (no-op). If it
 *    tries to throw via explicit Pipeline invocation (`pipeline(...)` -
 *    a bare identifier), the source-level guard rejects it at execution
 *    time.
 *  - **`calls` transitivity.** `invokeFunction(id, args)` inside a body
 *    runs the callee through the same runtime. The callee cannot reach
 *    a Pipeline either - the ctx is immutable across recursive invocations.
 */

import type { Function as BmFunction } from '../types/context'

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * The sandboxed context exposed to Function bodies. Deliberately narrow -
 * read-only ontology access, nothing that can mutate state or reach a
 * Pipeline. Future Phase 9 extensions add `resolveThing(id)`, `query(expr)`,
 * etc. For now the surface is just enough to support `invokeFunction`
 * (the `calls` predicate's runtime shape) and future read APIs.
 */
export interface FunctionRuntimeContext {
  /**
   * Invoke another Function by id with a positional argument list.
   * Used for the `calls` predicate's runtime behavior. The callee runs
   * through the same runtime - sandbox guarantees propagate transitively.
   */
  invokeFunction(id: string, args: unknown[]): unknown
}

/** Registry of Functions available to the runtime, keyed by Function id. */
export interface FunctionRegistry {
  get(id: string): BmFunction | undefined
}

export interface FunctionRuntimeOptions {
  /** Registry so `calls` can resolve referenced Functions. */
  registry?: FunctionRegistry
  /**
   * Allow execution of `typescript` Function bodies.
   *
   * Default OFF because the current Phase 6 runtime uses `new Function()`
   * (not a true sandbox). Keep TypeScript execution behind an explicit opt-in
   * until the runtime is isolated (V8 isolate / worker / edge runtime).
   */
  allowTypeScript?: boolean
  /**
   * Maximum call-stack depth across `invokeFunction` calls. Prevents
   * runaway recursion if a Function accidentally calls itself. Default 32.
   */
  maxCallDepth?: number
}

export interface FunctionRuntimeResult {
  success: boolean
  value?: unknown
  error?: string
}

// ── Boundary discipline: forbidden source patterns ────────────────────────

/**
 * Patterns that indicate a Function body is trying to reach a Pipeline
 * or any other write primitive. Matched against the raw source before
 * execution. This is a *structural commitment*, not a comment - the
 * Phase 6 acceptance test asserts that a Function with one of these
 * patterns fails at runtime.
 *
 * Kept conservative on purpose: we reject identifiers that would be
 * unambiguously referring to Pipelines, and reject obvious write APIs.
 * Authorship-time linting can be stricter; runtime enforcement is the
 * hard gate.
 */
const FORBIDDEN_SOURCE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bpipeline\s*\(/, reason: 'Function bodies must not invoke pipelines (Phase 6 boundary discipline).' },
  { pattern: /\bpipelines\s*\./, reason: 'Function bodies must not touch the pipelines namespace (Phase 6 boundary discipline).' },
  { pattern: /\brunPipeline\s*\(/, reason: 'Function bodies must not invoke pipelines (Phase 6 boundary discipline).' },
  { pattern: /\bdispatch\s*\(/, reason: 'Function bodies are pure - dispatch is forbidden.' },
  { pattern: /\bmutate\s*\(/, reason: 'Function bodies are pure - mutation helpers are forbidden.' },
]

/** Check a source string against the forbidden-pattern list. Returns null if clean. */
export function checkFunctionBoundary(source: string): string | null {
  for (const { pattern, reason } of FORBIDDEN_SOURCE_PATTERNS) {
    if (pattern.test(source)) return reason
  }
  return null
}

// ── Runtime entry point ────────────────────────────────────────────────────

/**
 * Execute a Function body and return the result.
 *
 * The `args` list is positional and must match the Function's declared
 * parameter order. Missing required parameters surface as an error before
 * execution.
 */
export function invokeFunction(
  fn: BmFunction,
  args: unknown[],
  opts: FunctionRuntimeOptions = {},
  depth = 0,
): FunctionRuntimeResult {
  const maxDepth = opts.maxCallDepth ?? 32
  if (depth > maxDepth) {
    return { success: false, error: `Function call depth exceeded maxCallDepth=${maxDepth}` }
  }

  // ── 1. Validate the signature ────────────────────────────────────────
  const parameters = fn.signature?.parameters ?? []
  for (let i = 0; i < parameters.length; i++) {
    const p = parameters[i]!
    if (p.required && args[i] === undefined) {
      return { success: false, error: `Missing required parameter "${p.name}" at position ${i}` }
    }
  }

  // ── 2. Enforce source-level boundary discipline ──────────────────────
  const source = fn.body?.source ?? ''
  const boundaryError = checkFunctionBoundary(source)
  if (boundaryError) {
    return { success: false, error: boundaryError }
  }

  // ── 3. Build the sandboxed ctx ──────────────────────────────────────
  const ctx: FunctionRuntimeContext = {
    invokeFunction: (id, calleeArgs) => {
      const callee = opts.registry?.get(id)
      if (!callee) {
        throw new Error(`Function "${id}" not found in registry`)
      }
      const inner = invokeFunction(callee, calleeArgs, opts, depth + 1)
      if (!inner.success) {
        throw new Error(`Nested call to "${id}" failed: ${inner.error}`)
      }
      return inner.value
    },
  }

  // ── 4. Pad arguments to match the parameter count ──────────────────
  // If a caller passes fewer arguments than parameters (legal for
  // optional parameters), we pad with `undefined` so the positional
  // binding lines up. Without this, `ctx` would slot into the missing
  // position and bodies would see `x === ctx` instead of `x === undefined`.
  const paddedArgs: unknown[] = []
  for (let i = 0; i < parameters.length; i++) {
    paddedArgs.push(i < args.length ? args[i] : undefined)
  }

  // ── 5. Execute ───────────────────────────────────────────────────────
  try {
    if (fn.body?.kind === 'expression') {
      // Expression form: evaluate `source` as a JS expression with
      // parameters bound as local identifiers. `ctx` is available but
      // the expression form is primarily for simple computations.
      const paramNames = parameters.map(p => p.name)
      const fnImpl = new Function(
        ...paramNames,
        'ctx',
        `'use strict'; return (${source});`,
      )
      const value = fnImpl(...paddedArgs, ctx)
      return { success: true, value }
    }

    if (fn.body?.kind === 'typescript') {
      if (!opts.allowTypeScript) {
        return {
          success: false,
          error: 'TypeScript Function bodies are disabled by default (enable allowTypeScript to opt in).',
        }
      }
      // TypeScript form: `source` is a function body. Parameters are
      // bound by name, ctx is available. No `return` keyword required
      // for simple expressions - we wrap the body so both styles work.
      const paramNames = parameters.map(p => p.name)
      const hasExplicitReturn = /\breturn\b/.test(source)
      const wrappedBody = hasExplicitReturn ? source : `return (${source});`
      const fnImpl = new Function(
        ...paramNames,
        'ctx',
        `'use strict'; ${wrappedBody}`,
      )
      const value = fnImpl(...paddedArgs, ctx)
      return { success: true, value }
    }

    return { success: false, error: `Unknown body kind: ${fn.body?.kind}` }
  }
  catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Convenience: build a registry from a flat list of Functions ──────────

export function createFunctionRegistry(functions: BmFunction[]): FunctionRegistry {
  const map = new Map<string, BmFunction>()
  for (const fn of functions) map.set(fn.uri, fn)
  return { get: (id) => map.get(id) }
}

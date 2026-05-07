/**
 * DSL dispatcher bridge - the deferred-accessor pattern that lets
 * DSL handles dispatch framework commands without importing from
 * consumer layers.
 *
 * The metaontology's DSL handles need to call `dispatch()` when
 * `.add(...)`, `.update(...)`, `.remove(...)` are invoked. But
 * `dispatch()` lives in the consumer layer (e.g. an app store),
 * which the metaontology cannot import from (layer boundary).
 * The solution: the DSL exposes `bindDispatcher(fn)`,
 * and the consumer calls it at init time with their dispatch
 * function. The handles call through the stored reference.
 *
 * Additionally, `bindRootAccessor(fn)` stores a function that
 * returns the current `RootContext` so query operations (`.findById`,
 * `.where`, `.all`, `.count`) can read the live model state.
 *
 * This file is the bridge; the handle implementations in
 * `defineFacetType.ts` (and by extension `definePrimitives.ts`)
 * call these functions when their methods are invoked.
 */

import type { RootContext } from '../types/context'

// ── Types for the dispatch function ────────────────────────────────────────

/** The shape of a command the dispatcher accepts. */
export interface DispatchableCmd {
  type: string
  payload: Record<string, unknown>
}

/** The result the dispatcher returns. */
export interface DispatchResult {
  success: boolean
  error?: string
}

/** The dispatch function type - maps to the consumer's dispatch logic. */
export type DispatchFn = (cmd: DispatchableCmd) => DispatchResult

/** The root accessor type - returns the current reactive RootContext. */
export type RootAccessorFn = () => RootContext

// ── Module-scoped state ────────────────────────────────────────────────────

let _dispatch: DispatchFn | null = null
let _getRoot: RootAccessorFn | null = null

// ── Binding (called by the consumer layer at init) ─────────────────────────

/**
 * Register the real dispatch function. Called once by the consumer
 * layer (e.g. when the app store is ready).
 * After this call, all DSL handles dispatch through the real
 * commit log.
 */
export function bindDispatcher(fn: DispatchFn): void {
  _dispatch = fn
}

/**
 * Register the root accessor so query operations can read the
 * current model. Called alongside `bindDispatcher`.
 */
export function bindRootAccessor(fn: RootAccessorFn): void {
  _getRoot = fn
}

// ── Invocation (called by DSL handles) ─────────────────────────────────────

/**
 * Dispatch a command through the bound dispatcher. Throws if no
 * dispatcher is bound yet (which means the consumer layer hasn't
 * initialized - a programming error, not a runtime condition).
 */
export function dispatch(cmd: DispatchableCmd): DispatchResult {
  if (!_dispatch) {
    throw new Error(
      '[DSL] No dispatcher bound. Call bindDispatcher(fn) from your ' +
      'consumer layer before invoking DSL handle ' +
      'methods like .add() or .update().',
    )
  }
  return _dispatch(cmd)
}

/**
 * Access the current RootContext. Throws if no accessor is bound.
 */
export function getRoot(): RootContext {
  if (!_getRoot) {
    throw new Error(
      '[DSL] No root accessor bound. Call bindRootAccessor(fn) from ' +
      'your consumer layer before invoking DSL query methods like ' +
      '.findById() or .where().',
    )
  }
  return _getRoot()
}

// ── Test-only ──────────────────────────────────────────────────────────────

/**
 * Reset the dispatcher and root accessor. For test isolation only -
 * do NOT call from production code.
 */
export function resetDispatcher(): void {
  _dispatch = null
  _getRoot = null
}

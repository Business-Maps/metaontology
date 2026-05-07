/**
 * `defineAction` - declare a typed action with parameters and mutations.
 *
 * Actions are different from passive facet types: they're declared
 * with a parameter schema and a list of mutation rules instead of an
 * attribute schema. Dispatching an action through its typed handle
 * routes through the framework's existing action interpreter which
 * already knows how to validate params, check authorization, run
 * preconditions, apply mutations, and fire side effects.
 *
 * Mutation `target` fields are constrained at the type level to
 * reference names from the declared parameters, so this compiles:
 *
 *   defineAction('dragNode', {
 *     parameters: { node: reference().to(exampleNode), dx: decimal, dy: decimal },
 *     mutations: [
 *       { type: 'modify', target: 'node', field: 'x', formula: 'node.x + $params.dx' },
 *     ],
 *   })
 *
 * but the same declaration with `target: 'ghost'` fails to compile
 * because `ghost` isn't a parameter name.
 *
 * Phase 1 wires the typed surface and registers the action in the
 * DSL registry. The runtime bridge to the existing action
 * interpreter arrives in a later chunk.
 */

import type { AttrSchema } from './schemaCombinators'
import type { ActionHandle, AttrsOf, ActionResult } from './handles'
import type { ActionTypeDecl, MutationRuleDecl } from './registry'
import { registerActionType } from './registry'

// ── Mutation rule - typed over the action's parameter names ───────────────

/**
 * A single mutation declared on an action. `target` must name one of
 * the action's declared parameters (TypeScript enforces this via
 * `keyof TParams & string`).
 *
 * The runtime interpreter reads these declarations and applies them
 * in order; the `field` / `formula` / `predicate` / `sourceRef` /
 * `targetRef` fields carry the mutation's payload depending on the
 * mutation type.
 */
export interface MutationRule<TParams extends Record<string, AttrSchema<unknown>>> {
  readonly type: 'modify' | 'create' | 'delete' | 'transitionState' | 'createLink' | 'deleteLink'
  readonly target: keyof TParams & string
  readonly field?: string
  readonly formula?: string
  readonly predicate?: string
  readonly sourceRef?: string
  readonly targetRef?: string
}

// ── Config ─────────────────────────────────────────────────────────────────

export interface ActionConfig<TParams extends Record<string, AttrSchema<unknown>>> {
  /** 'command' mutates state, 'query' reads state, 'intent' expresses desired outcome. */
  type: 'command' | 'query' | 'intent'
  description: string
  /** Typed parameter schema - the action's `.dispatch(...)` signature is inferred from this. */
  parameters: TParams
  /** Ordered list of mutations the interpreter applies when the action runs. */
  mutations?: ReadonlyArray<MutationRule<TParams>>
  authorization?: 'performers-only' | 'any-authenticated' | 'custom'
}

// ── The definer ────────────────────────────────────────────────────────────

/**
 * Declare a typed action. Returns an `ActionHandle` whose
 * `.dispatch(...)` is type-checked against the declared parameter
 * schema.
 */
export function defineAction<
  Id extends string,
  TParams extends Record<string, AttrSchema<unknown>>,
>(id: Id, config: ActionConfig<TParams>): ActionHandle<Id, TParams> {
  const decl: ActionTypeDecl = {
    kind: 'action-type',
    id,
    actionType: config.type,
    description: config.description,
    parameters: config.parameters,
    mutations: (config.mutations ?? []).map(normalizeMutation),
    authorization: config.authorization,
  }
  registerActionType(decl)
  return createActionHandle<Id, TParams>(id)
}

/**
 * Strip the generic parameter constraint from the runtime mutation
 * record so it can be stored in the untyped registry. This is the
 * only place where the type-level `keyof TParams` constraint is
 * erased.
 */
function normalizeMutation<TParams extends Record<string, AttrSchema<unknown>>>(
  rule: MutationRule<TParams>,
): MutationRuleDecl {
  return {
    type: rule.type,
    target: rule.target,
    field: rule.field,
    formula: rule.formula,
    predicate: rule.predicate,
    sourceRef: rule.sourceRef,
    targetRef: rule.targetRef,
  }
}

/**
 * Internal factory for action handles. Phase 1 returns a typed stub;
 * the runtime bridge to the action interpreter is wired in a later
 * chunk so the metaontology doesn't import from the app layer.
 *
 * @internal
 */
function createActionHandle<
  Id extends string,
  TParams extends Record<string, AttrSchema<unknown>>,
>(id: Id): ActionHandle<Id, TParams> {
  const handle: ActionHandle<Id, TParams> = {
    __brand: 'ActionHandle',
    __id: id,
    actionId: id,

    async dispatch(_params: AttrsOf<TParams>): Promise<ActionResult> {
      // Phase 1 runtime stub - wired to the action interpreter in a later chunk.
      return {
        success: true,
        created: [],
        updated: [],
        deleted: [],
        errors: [],
      }
    },
  }
  return handle
}

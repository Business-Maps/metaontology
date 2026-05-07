/**
 * M0 Action Runtime Interpreter - reads M1 Action definitions and executes
 * them against an InstanceRepository. Same 5-phase pipeline as generateActionFunctions()
 * but interpreted at runtime instead of compiled to static TypeScript.
 *
 * Phases:
 *   1. Validate params (from ActionParameter[])
 *   2. Check authorization (from ActionAuthorization)
 *   3. Evaluate preconditions (from ActionCondition[])
 *   4. Execute mutations (from MutationRule[] with FieldSource resolution)
 *   5. Fire side effects (from SideEffectRule[])
 */

import type {
  RootContext,
  Action,
  ActionParameter,
  ActionCondition,
  MutationRule,
  SideEffectRule,
  FieldSource,
  FacetContainer,
} from '../types/context'
import type { EntityInstance, EventOccurrence } from '../types/instance'
import type {
  ActionExecutor,
  ActionContext,
  ActionResult,
} from './types'
import { getDatatypeDef } from '../meta/ontology'

// ── Helpers ────────────────────────────────────────────────────────────────────

function allContainers(model: RootContext): FacetContainer[] {
  return [model as FacetContainer, ...Object.values(model.contexts)]
}

function findAction(model: RootContext, actionUri: string): Action | undefined {
  for (const container of allContainers(model)) {
    const found = container.facets.actions.find(a => a.uri === actionUri)
    if (found) return found
  }
  return undefined
}

function findThingByUri(model: RootContext, thingUri: string) {
  for (const container of allContainers(model)) {
    const found = container.facets.things.find(t => t.uri === thingUri)
    if (found) return found
  }
  return undefined
}

// ── Phase 1: Parameter Validation ──────────────────────────────────────────────

function validateParams(
  params: Record<string, unknown>,
  defs: ActionParameter[],
  model: RootContext,
): string[] {
  const errors: string[] = []
  for (const def of defs) {
    const value = params[def.name]

    // Required check
    if (def.required && (value === undefined || value === null)) {
      errors.push(`Missing required parameter: ${def.name}`)
      continue
    }

    // Skip type check if value not provided (and not required)
    if (value === undefined || value === null) continue

    // Resolve type from sourceThingId + sourceAttribute if no direct type
    let resolvedType = def.type
    if (!resolvedType && def.sourceThingId && def.sourceAttribute) {
      const thing = findThingByUri(model, def.sourceThingId)
      const attr = thing?.attributes.find(a => a.name === def.sourceAttribute)
      if (attr) resolvedType = attr.type
    }

    if (resolvedType) {
      const dt = getDatatypeDef(resolvedType)
      if (dt) {
        const baseType = dt.baseType
        if (baseType === 'number' && typeof value !== 'number') {
          errors.push(`Parameter "${def.name}" expected number, got ${typeof value}`)
        } else if (baseType === 'boolean' && typeof value !== 'boolean') {
          errors.push(`Parameter "${def.name}" expected boolean, got ${typeof value}`)
        } else if (baseType === 'string' && typeof value !== 'string') {
          errors.push(`Parameter "${def.name}" expected string, got ${typeof value}`)
        }
        // temporal and complex types: accept any (runtime validation is app-level)
      }
    }
  }
  return errors
}

// ── Phase 2: Authorization ─────────────────────────────────────────────────────

function checkAuthorization(
  action: Action,
  currentUser: string | undefined,
  model: RootContext,
): string | null {
  if (!action.authorization) return null

  switch (action.authorization.mode) {
    case 'performers-only': {
      if (!currentUser) return 'Authorization failed: performers-only requires an authenticated user'
      // Walk the model to check if the current user's Persona has a `performs`
      // link to this action. First find the user's persona by userId attribute.
      let personaUri: string | null = null
      for (const container of allContainers(model)) {
        for (const p of container.facets.personas) {
          const persona = p as unknown as Record<string, unknown>
          if (persona.authUserId === currentUser || p.uri === `persona:${currentUser}`) {
            personaUri = p.uri
            break
          }
        }
        if (personaUri) break
      }
      if (!personaUri) return 'Authorization failed: no identity found for user'
      const performsThis = model.links.some(
        l => (l.predicate as string) === 'performs' && l.sourceUri === personaUri && l.targetUri === action.uri,
      )
      if (!performsThis) return `Authorization failed: user does not have "performs" link to action "${action.name}"`
      return null
    }
    case 'any-authenticated':
      if (!currentUser) return 'Authorization failed: action requires an authenticated user'
      return null
    case 'custom':
      // Custom authorization is app-level
      return null
    default:
      return null
  }
}

// ── Phase 3: Precondition Evaluation ───────────────────────────────────────────

async function evaluatePreconditions(
  conditions: ActionCondition[],
  ctx: ActionContext,
): Promise<string[]> {
  const errors: string[] = []

  for (const cond of conditions) {
    switch (cond.type) {
      case 'text':
        // Descriptive only - skip
        break

      case 'state': {
        const instances = await ctx.instances.findByThing(cond.thingId)
        if (instances.length === 0) {
          errors.push(`Precondition failed: no instances of thing "${cond.thingId}" found`)
          break
        }
        // Check that at least one instance is in the required state
        const inState = instances.some(
          inst => inst.attributes._state?.value === cond.stateId,
        )
        if (!inState) {
          const desc = cond.description ? ` (${cond.description})` : ''
          errors.push(
            `Precondition failed: no instance of thing "${cond.thingId}" is in state "${cond.stateId}"${desc}`,
          )
        }
        break
      }

      case 'field': {
        const instances = await ctx.instances.findByThing(cond.thingId)
        if (instances.length === 0) {
          errors.push(`Precondition failed: no instances of thing "${cond.thingId}" found`)
          break
        }
        const satisfied = instances.some(inst => {
          const attrVal = inst.attributes[cond.attribute]
          return matchFieldCondition(attrVal?.value, cond.operator, cond.value)
        })
        if (!satisfied) {
          const desc = cond.description ? ` (${cond.description})` : ''
          errors.push(
            `Precondition failed: field "${cond.attribute}" on thing "${cond.thingId}" does not satisfy ${cond.operator}${cond.value !== undefined ? ` ${cond.value}` : ''}${desc}`,
          )
        }
        break
      }
    }
  }

  return errors
}

function matchFieldCondition(
  actual: unknown,
  operator: 'exists' | 'equals' | 'gt' | 'lt',
  expected?: string,
): boolean {
  switch (operator) {
    case 'exists':
      return actual !== undefined && actual !== null
    case 'equals':
      return String(actual) === String(expected)
    case 'gt':
      return Number(actual) > Number(expected)
    case 'lt':
      return Number(actual) < Number(expected)
    default:
      return false
  }
}

// ── Phase 4: Mutation Execution ────────────────────────────────────────────────

function resolveFieldSource(
  source: FieldSource,
  params: Record<string, unknown>,
  ctx: ActionContext,
  createdEntities: Map<string, EntityInstance>,
): unknown {
  switch (source.from) {
    case 'parameter':
      return params[source.paramName]
    case 'static':
      return source.value
    case 'currentUser':
      return ctx.currentUser
    case 'currentTime':
      return new Date().toISOString()
    case 'attribute': {
      // Look up from created entities first, then existing instances
      const created = createdEntities.get(source.thingRef)
      if (created) return created.attributes[source.attribute]?.value
      return undefined
    }
    case 'computed':
      // Computed expressions are a stub - app-level concern
      return undefined
    default:
      return undefined
  }
}

function resolveFieldMappings(
  mappings: Record<string, FieldSource> | undefined,
  params: Record<string, unknown>,
  ctx: ActionContext,
  createdEntities: Map<string, EntityInstance>,
): Record<string, unknown> {
  if (!mappings) return {}
  const resolved: Record<string, unknown> = {}
  for (const [key, source] of Object.entries(mappings)) {
    resolved[key] = resolveFieldSource(source, params, ctx, createdEntities)
  }
  return resolved
}

async function executeMutations(
  mutations: MutationRule[],
  params: Record<string, unknown>,
  ctx: ActionContext,
): Promise<{
  created: EntityInstance[]
  updated: EntityInstance[]
  deleted: string[]
  errors: string[]
}> {
  const created: EntityInstance[] = []
  const updated: EntityInstance[] = []
  const deleted: string[] = []
  const errors: string[] = []
  // Track created entities by thingId so later mutations can reference them
  const createdByThingId = new Map<string, EntityInstance>()

  for (const mut of mutations) {
    try {
      switch (mut.type) {
        case 'create': {
          if (!mut.thingId) {
            errors.push('Create mutation missing thingId')
            break
          }
          const fields = resolveFieldMappings(mut.fieldMappings, params, ctx, createdByThingId)
          const inst = await ctx.instances.create(mut.thingId, fields)
          created.push(inst)
          createdByThingId.set(mut.thingId, inst)
          break
        }

        case 'modify': {
          if (!mut.thingId) {
            errors.push('Modify mutation missing thingId')
            break
          }
          const changes = resolveFieldMappings(mut.fieldMappings, params, ctx, createdByThingId)
          // Find the target instance - prefer one created in this execution, else latest by thingId
          const existing = createdByThingId.get(mut.thingId)
          if (existing) {
            const inst = await ctx.instances.update(existing.id, changes)
            updated.push(inst)
          } else {
            const instances = await ctx.instances.findByThing(mut.thingId)
            if (instances.length > 0) {
              const inst = await ctx.instances.update(instances[0].id, changes)
              updated.push(inst)
            } else {
              errors.push(`Modify mutation: no instance found for thing "${mut.thingId}"`)
            }
          }
          break
        }

        case 'delete': {
          if (!mut.thingId) {
            errors.push('Delete mutation missing thingId')
            break
          }
          const instances = await ctx.instances.findByThing(mut.thingId)
          if (instances.length > 0) {
            await ctx.instances.delete(instances[0].id)
            deleted.push(instances[0].id)
          } else {
            errors.push(`Delete mutation: no instance found for thing "${mut.thingId}"`)
          }
          break
        }

        case 'transitionState': {
          if (!mut.thingId || !mut.targetStateId) {
            errors.push('TransitionState mutation missing thingId or targetStateId')
            break
          }
          const existing2 = createdByThingId.get(mut.thingId)
          if (existing2) {
            const inst = await ctx.instances.update(existing2.id, { _state: mut.targetStateId })
            updated.push(inst)
          } else {
            const instances = await ctx.instances.findByThing(mut.thingId)
            if (instances.length > 0) {
              const inst = await ctx.instances.update(instances[0].id, { _state: mut.targetStateId })
              updated.push(inst)
            } else {
              errors.push(`TransitionState: no instance found for thing "${mut.thingId}"`)
            }
          }
          break
        }

        case 'createLink': {
          if (!mut.predicate || !mut.sourceRef || !mut.targetRef) {
            errors.push('CreateLink mutation missing predicate, sourceRef, or targetRef')
            break
          }
          // Resolve refs - could be thingIds pointing to created entities
          const sourceInst = createdByThingId.get(mut.sourceRef)
          const targetInst = createdByThingId.get(mut.targetRef)
          const sourceId = sourceInst?.id ?? mut.sourceRef
          const targetId = targetInst?.id ?? mut.targetRef
          await ctx.instances.createRelationship(mut.predicate, sourceId, targetId)
          break
        }

        case 'deleteLink': {
          if (!mut.predicate || !mut.sourceRef) {
            errors.push('DeleteLink mutation missing predicate or sourceRef')
            break
          }
          const sourceInst2 = createdByThingId.get(mut.sourceRef)
          const entityId = sourceInst2?.id ?? mut.sourceRef
          const rels = await ctx.instances.findRelationships(entityId, {
            predicate: mut.predicate,
            direction: 'outgoing',
          })
          if (rels.length > 0) {
            await ctx.instances.deleteRelationship(rels[0].id)
          }
          break
        }
      }
    } catch (err) {
      errors.push(`Mutation "${mut.type}" failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { created, updated, deleted, errors }
}

// ── Phase 5: Side Effects ──────────────────────────────────────────────────────

async function fireSideEffects(
  sideEffects: SideEffectRule[],
  params: Record<string, unknown>,
  ctx: ActionContext,
  createdEntities: Map<string, EntityInstance>,
  actionId: string,
): Promise<EventOccurrence[]> {
  const events: EventOccurrence[] = []

  for (const effect of sideEffects) {
    switch (effect.type) {
      case 'emit': {
        const payload = resolveFieldMappings(
          effect.payloadMappings,
          params,
          ctx,
          createdEntities,
        )
        const eventId = effect.eventId ?? actionId

        if (ctx.eventBus) {
          await ctx.eventBus.emit(eventId, payload)
        }

        events.push({
          eventId,
          id: crypto.randomUUID(),
          payload,
          occurredAt: new Date().toISOString(),
          sourceActionId: actionId,
        })
        break
      }

      // notify, webhook, invoke - app-level concerns, skip at runtime
      case 'notify':
      case 'webhook':
      case 'invoke':
        break
    }
  }

  return events
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Create an ActionExecutor that interprets M1 Action definitions at runtime.
 * The returned executor reads Action rules from the provided model and executes
 * the 5-phase pipeline against the InstanceRepository in the ActionContext.
 */
export function createActionInterpreter(model: RootContext): ActionExecutor {
  return {
    async execute(
      actionId: string,
      params: Record<string, unknown>,
      ctx: ActionContext,
    ): Promise<ActionResult> {
      const errors: string[] = []

      // ── Find the Action ──────────────────────────────────────────────────
      const action = findAction(model, actionId)
      if (!action) {
        return {
          success: false,
          created: [],
          updated: [],
          deleted: [],
          events: [],
          errors: [`Action "${actionId}" not found in model`],
        }
      }

      // ── Phase 1: Validate params ────────────────────────────────────────
      if (action.parameters?.length) {
        const paramErrors = validateParams(params, action.parameters, model)
        if (paramErrors.length > 0) {
          return {
            success: false,
            created: [],
            updated: [],
            deleted: [],
            events: [],
            errors: paramErrors,
          }
        }
      }

      // ── Phase 2: Check authorization ────────────────────────────────────
      const authError = checkAuthorization(action, ctx.currentUser, model)
      if (authError) {
        return {
          success: false,
          created: [],
          updated: [],
          deleted: [],
          events: [],
          errors: [authError],
        }
      }

      // ── Phase 3: Evaluate preconditions ─────────────────────────────────
      if (action.preconditions?.length) {
        const preErrors = await evaluatePreconditions(action.preconditions, ctx)
        if (preErrors.length > 0) {
          return {
            success: false,
            created: [],
            updated: [],
            deleted: [],
            events: [],
            errors: preErrors,
          }
        }
      }

      // ── Phase 4: Execute mutations ──────────────────────────────────────
      let created: EntityInstance[] = []
      let updated: EntityInstance[] = []
      let deleted: string[] = []

      if (action.mutations?.length) {
        const result = await executeMutations(action.mutations, params, ctx)
        created = result.created
        updated = result.updated
        deleted = result.deleted
        errors.push(...result.errors)
      }

      // ── Phase 4.5: Writeback (additive - only fires when writebackDeps provided) ──
      const writebackWarnings: string[] = []

      if (ctx.writebackDeps && (created.length > 0 || updated.length > 0)) {
        const { processWriteback } = await import('./writebackRuntime')
        const mutatedInstances = [...created, ...updated]
        for (const inst of mutatedInstances) {
          const result = await processWriteback(
            inst.thingId,
            inst.id,
            inst.attributes ? Object.fromEntries(
              Object.entries(inst.attributes).map(([k, v]) => [k, v.value]),
            ) : {},
            (inst as any).externalId as string | undefined,
            ctx.writebackDeps,
          )
          if (result && !result.dispatched && result.error) {
            writebackWarnings.push(result.error)
          }
        }
      }

      // ── Phase 5: Fire side effects ──────────────────────────────────────
      let events: EventOccurrence[] = []

      if (action.sideEffects?.length) {
        const createdByThingId = new Map<string, EntityInstance>()
        for (const inst of created) {
          createdByThingId.set(inst.thingId, inst)
        }
        events = await fireSideEffects(
          action.sideEffects,
          params,
          ctx,
          createdByThingId,
          actionId,
        )
      }

      return {
        success: errors.length === 0,
        created,
        updated,
        deleted,
        events,
        errors,
        writebackWarnings: writebackWarnings.length > 0 ? writebackWarnings : undefined,
      }
    },
  }
}

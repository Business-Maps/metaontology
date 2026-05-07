/**
 * Why this provider exists:
 *  The framework enumerates five provider flavors including Computed.
 *  Even though the Pipeline runtime schedules computations, ComputedProvider is a
 *  provider surface that the composite repository can route to - the
 *  composite doesn't care whether the provider's data comes from
 *  storage, a Transport, or a Function. All five providers satisfy
 *  the same InstanceRepository contract.
 */

import type {
  InstanceRepository,
  RelationshipQueryOptions,
  QueryOptions,
} from '../types'
import type { EntityInstance, RelationshipInstance } from '../../types/instance'
import type { SetExpr } from '../../types/query'
import type { RootContext, Function as BmFunction } from '../../types/context'
import { invokeFunction, type FunctionRegistry } from '../functionRuntime'

export interface ComputedProviderOptions {
  /** The Thing this provider yields (e.g. "thing-high-value-customer"). */
  thingId: string
  /** The Function that computes attributes for a single source instance. */
  functionId: string
  /** A registry that can resolve functionId → BmFunction. */
  registry: FunctionRegistry
  /** Upstream repository whose instances feed this computation. */
  source: InstanceRepository
  /** Thing id of the upstream source (what to query against `source`). */
  sourceThingId: string
}

export interface ComputedProvider extends InstanceRepository {
  readonly thingId: string
}

function toEntityInstance(
  thingId: string,
  sourceInstance: EntityInstance,
  computed: unknown,
): EntityInstance {
  // Convert the raw Function output into attribute shape. If the
  // Function returned an object, each property becomes an attribute.
  // If it returned a primitive, wrap it in a single `value` attribute.
  const attributes: Record<string, { type: string; value: unknown }> = {}
  if (computed && typeof computed === 'object' && !Array.isArray(computed)) {
    for (const [key, value] of Object.entries(computed as Record<string, unknown>)) {
      attributes[key] = { type: 'text', value }
    }
  } else {
    attributes.value = { type: 'text', value: computed }
  }
  return {
    id: sourceInstance.id,
    thingId,
    attributes,
    createdAt: sourceInstance.createdAt,
    updatedAt: new Date().toISOString(),
  }
}

const READ_ONLY_MESSAGE = 'ComputedProvider is read-only - writes go to the upstream source, not the derived provider'

export function createComputedProvider(options: ComputedProviderOptions): ComputedProvider {
  const { thingId, functionId, registry, source, sourceThingId } = options

  function resolveFunction(): BmFunction {
    const fn = registry.get(functionId)
    if (!fn) {
      throw new Error(`ComputedProvider[${thingId}] function "${functionId}" not found in registry`)
    }
    return fn
  }

  async function computeOne(sourceInstance: EntityInstance): Promise<EntityInstance | null> {
    const fn = resolveFunction()
    // Flatten the source instance's attributes to plain values and pass
    // the resulting object as the single argument. Phase 9's functions
    // operate on single records - cross-instance aggregation is Phase
    // 10's PipelineRuntime responsibility.
    const flattenedInput: Record<string, unknown> = {}
    for (const [key, attr] of Object.entries(sourceInstance.attributes)) {
      flattenedInput[key] = attr.value
    }
    const result = invokeFunction(fn, [flattenedInput], { registry, allowTypeScript: true })
    if (!result.success) {
      return null
    }
    return toEntityInstance(thingId, sourceInstance, result.value)
  }

  return {
    thingId,

    async create(_tid, _data) {
      throw new Error(READ_ONLY_MESSAGE)
    },

    async findById(id) {
      // Find the upstream instance by id, then compute.
      const sourceInstance = await source.findById(id)
      if (!sourceInstance) return null
      if (sourceInstance.thingId !== sourceThingId) return null
      return computeOne(sourceInstance)
    },

    async findByThing(targetThingId, options?: QueryOptions) {
      if (targetThingId !== thingId) return []
      // Walk all upstream instances and compute.
      const sourceInstances = await source.findByThing(sourceThingId, options)
      const computed: EntityInstance[] = []
      for (const sourceInstance of sourceInstances) {
        const result = await computeOne(sourceInstance)
        if (result) computed.push(result)
      }
      return computed
    },

    async update(_id, _changes) {
      throw new Error(READ_ONLY_MESSAGE)
    },

    async delete(_id) {
      throw new Error(READ_ONLY_MESSAGE)
    },

    async query(_expr: SetExpr, _model: RootContext) {
      // Baseline: same as findByThing with no options.
      const sourceInstances = await source.findByThing(sourceThingId)
      const computed: EntityInstance[] = []
      for (const sourceInstance of sourceInstances) {
        const result = await computeOne(sourceInstance)
        if (result) computed.push(result)
      }
      return computed
    },

    async createRelationship(_predicate, _sourceId, _targetId): Promise<RelationshipInstance> {
      throw new Error(READ_ONLY_MESSAGE)
    },

    async findRelationships(_entityId, _options?: RelationshipQueryOptions) {
      return []
    },

    async deleteRelationship(_id) {
      throw new Error(READ_ONLY_MESSAGE)
    },
  }
}

/**
 * M0 entity class registrations - the 8 operational entity types that
 * make up the runtime tier of the ontology.
 *
 * Unlike M1 facet types (registered with `facetKey` for storage in
 * `FacetContainer.facets`), M0 entity classes are registered WITHOUT
 * a `facetKey`. This means:
 *   - They appear in the DSL registry for predicate domain/range validation
 *   - They DO NOT appear in `getRegisteredFacetKeys()` - the engine
 *     will not iterate them when scanning facets
 *   - Their instances live in `M0State`, not in `FacetArrays`
 *
 * This is the key distinction: M0 entities are registered for predicate
 * validation and triple projection, but not for facet iteration.
 */

import { registerFacetType } from '../dsl/registry'
import type { FacetTypeDecl } from '../dsl/registry'

function registerM0EntityClass(spec: {
  id: string
  entityClassId: string
  label: string
  singular: string
}): FacetTypeDecl {
  return registerFacetType({
    kind: 'facet-type',
    id: spec.id,
    baseType: null,
    attributes: {},
    entityClassId: spec.entityClassId,
    label: { en: spec.label },
    singular: { en: spec.singular },
    tier: 3,
    // No facetKey - M0 entities live in M0State, not FacetArrays
  })
}

// ── The 8 M0 entity classes ───────────────────────────────────────────────

export const instanceClass = registerM0EntityClass({
  id: 'm0:instance',
  entityClassId: 'Instance',
  label: 'Instances',
  singular: 'Instance',
})

export const pipelineRunClass = registerM0EntityClass({
  id: 'm0:pipelineRun',
  entityClassId: 'PipelineRun',
  label: 'Pipeline Runs',
  singular: 'Pipeline Run',
})

export const retryEntryClass = registerM0EntityClass({
  id: 'm0:retryEntry',
  entityClassId: 'RetryEntry',
  label: 'Retry Entries',
  singular: 'Retry Entry',
})

export const suppressionRecordClass = registerM0EntityClass({
  id: 'm0:suppressionRecord',
  entityClassId: 'SuppressionRecord',
  label: 'Suppression Records',
  singular: 'Suppression Record',
})

export const replayPointClass = registerM0EntityClass({
  id: 'm0:replayPoint',
  entityClassId: 'ReplayPoint',
  label: 'Replay Points',
  singular: 'Replay Point',
})

export const deploymentRecordClass = registerM0EntityClass({
  id: 'm0:deploymentRecord',
  entityClassId: 'DeploymentRecord',
  label: 'Deployment Records',
  singular: 'Deployment Record',
})

export const simulationRunClass = registerM0EntityClass({
  id: 'm0:simulationRun',
  entityClassId: 'SimulationRun',
  label: 'Simulation Runs',
  singular: 'Simulation Run',
})

export const writebackQueueItemClass = registerM0EntityClass({
  id: 'm0:writebackQueueItem',
  entityClassId: 'WritebackQueueItem',
  label: 'Writeback Queue Items',
  singular: 'Writeback Queue Item',
})

/**
 * Re-register all M0 entity classes. Called alongside
 * `ensureBaseTypesRegistered()` after `resetRegistry()` in tests.
 */
export function ensureM0EntityClassesRegistered(): void {
  registerM0EntityClass({ id: 'm0:instance',            entityClassId: 'Instance',            label: 'Instances',              singular: 'Instance' })
  registerM0EntityClass({ id: 'm0:pipelineRun',         entityClassId: 'PipelineRun',         label: 'Pipeline Runs',          singular: 'Pipeline Run' })
  registerM0EntityClass({ id: 'm0:retryEntry',          entityClassId: 'RetryEntry',          label: 'Retry Entries',          singular: 'Retry Entry' })
  registerM0EntityClass({ id: 'm0:suppressionRecord',   entityClassId: 'SuppressionRecord',   label: 'Suppression Records',    singular: 'Suppression Record' })
  registerM0EntityClass({ id: 'm0:replayPoint',         entityClassId: 'ReplayPoint',         label: 'Replay Points',          singular: 'Replay Point' })
  registerM0EntityClass({ id: 'm0:deploymentRecord',    entityClassId: 'DeploymentRecord',    label: 'Deployment Records',     singular: 'Deployment Record' })
  registerM0EntityClass({ id: 'm0:simulationRun',       entityClassId: 'SimulationRun',       label: 'Simulation Runs',        singular: 'Simulation Run' })
  registerM0EntityClass({ id: 'm0:writebackQueueItem',  entityClassId: 'WritebackQueueItem',  label: 'Writeback Queue Items',  singular: 'Writeback Queue Item' })
}

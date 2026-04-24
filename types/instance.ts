// M0 instance types - runtime data conforming to M1 model definitions.

/** An M0 data instance conforming to an M1 Thing */
export interface EntityInstance {
  thingId: string
  id: string
  attributes: Record<string, AttributeValue>
  createdAt: string
  updatedAt?: string
  contextId?: string
}

/** A typed attribute value carrying its M2 datatype */
export interface AttributeValue {
  type: string
  value: unknown
  currencyCode?: string
  unit?: string
}

/** A runtime relationship between two M0 instances */
export interface RelationshipInstance {
  id: string
  predicate: string
  sourceInstanceId: string
  targetInstanceId: string
  createdAt: string
}

/** A form submission - M0 instance created via an M1 Interface */
export interface FormSubmission {
  interfaceId: string
  thingId: string
  data: Record<string, unknown>
  submittedAt: string
  submittedBy?: string
}

/** An event occurrence - M0 instance of an M1 Event */
export interface EventOccurrence {
  eventId: string
  id: string
  payload: Record<string, unknown>
  occurredAt: string
  sourceActionId?: string
}

/** A workflow execution - runtime trace of an M1 Workflow */
export interface WorkflowExecution {
  workflowId: string
  id: string
  currentStepId: string
  status: 'running' | 'completed' | 'failed' | 'suspended'
  startedAt: string
  completedAt?: string
  stepResults: Record<string, unknown>
}

/** An M0 reading of an M1 Measure */
export interface MeasureDataPoint {
  measureId: string
  value: number
  timestamp: string
  dimensions?: Record<string, string>
}

/** The full M0 instance dataset for a business map */
export interface InstanceDataset {
  mapId: string
  entities: EntityInstance[]
  relationships: RelationshipInstance[]
  events: EventOccurrence[]
  workflows: WorkflowExecution[]
  measures: MeasureDataPoint[]
}

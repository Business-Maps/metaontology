/**
 * Pipeline event bus tests - and that a misbehaving
 * listener can't break the whole runtime (robustness).
 */

import { describe, it, expect, vi } from 'vitest'
import { createPipelineEventBus, type PipelineEvent } from '../pipelineEvents'

describe('pipelineEventBus - subscribe + emit', () => {
  it('delivers events to a subscribed listener', () => {
    const bus = createPipelineEventBus()
    const received: PipelineEvent[] = []
    bus.subscribe(event => received.push(event))

    const event: PipelineEvent = {
      type: 'pipeline.run.started',
      runId: 'r-1',
      pipelineId: 'p-1',
      trigger: 'on-demand',
      startedAt: '2026-04-08T12:00:00Z',
    }
    bus.emit(event)

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual(event)
  })

  it('delivers events to multiple listeners in registration order', () => {
    const bus = createPipelineEventBus()
    const order: string[] = []
    bus.subscribe(() => order.push('a'))
    bus.subscribe(() => order.push('b'))
    bus.subscribe(() => order.push('c'))

    bus.emit({
      type: 'pipeline.run.started',
      runId: 'r',
      pipelineId: 'p',
      trigger: 'on-demand',
      startedAt: '',
    })
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('unsubscribe removes the listener', () => {
    const bus = createPipelineEventBus()
    const fn = vi.fn()
    const unsubscribe = bus.subscribe(fn)

    bus.emit({
      type: 'pipeline.run.started',
      runId: 'r',
      pipelineId: 'p',
      trigger: 'on-demand',
      startedAt: '',
    })
    expect(fn).toHaveBeenCalledTimes(1)

    unsubscribe()
    bus.emit({
      type: 'pipeline.run.started',
      runId: 'r',
      pipelineId: 'p',
      trigger: 'on-demand',
      startedAt: '',
    })
    expect(fn).toHaveBeenCalledTimes(1) // unchanged
  })

  it('listenerCount reflects the current subscription set', () => {
    const bus = createPipelineEventBus()
    expect(bus.listenerCount()).toBe(0)

    const u1 = bus.subscribe(() => {})
    const u2 = bus.subscribe(() => {})
    expect(bus.listenerCount()).toBe(2)

    u1()
    expect(bus.listenerCount()).toBe(1)
    u2()
    expect(bus.listenerCount()).toBe(0)
  })
})

describe('pipelineEventBus - robustness', () => {
  it('a listener that throws does not prevent other listeners from firing', () => {
    const bus = createPipelineEventBus()
    const received: string[] = []

    bus.subscribe(() => {
      throw new Error('listener A exploded')
    })
    bus.subscribe(() => received.push('b fired'))
    bus.subscribe(() => received.push('c fired'))

    bus.emit({
      type: 'pipeline.run.started',
      runId: 'r',
      pipelineId: 'p',
      trigger: 'on-demand',
      startedAt: '',
    })

    expect(received).toEqual(['b fired', 'c fired'])
  })
})

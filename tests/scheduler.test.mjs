import assert from 'node:assert/strict'
import test from 'node:test'

import { createDebouncedTask } from '../src/scheduler.js'

function harness(overrides = {}) {
  const state = { active: overrides.active ?? true }
  const callbacks = []
  const cancelled = []
  const errors = []
  const runs = []
  const task = createDebouncedTask({
    delay: 250,
    isActive: () => state.active,
    run: overrides.run ?? (() => {
      runs.push('run')
    }),
    onError: error => errors.push(error),
    schedule: callback => {
      callbacks.push(callback)
      return { id: callbacks.length, unref() {} }
    },
    cancel: handle => cancelled.push(handle),
  })
  return {
    state,
    task,
    callbacks,
    cancelled,
    errors,
    runs,
    fire(index = callbacks.length - 1) {
      callbacks[index]()
    },
  }
}

test('a burst of triggers schedules one timer and cancels the previous', () => {
  const h = harness()
  h.task.trigger()
  h.task.trigger()
  h.task.trigger()
  assert.equal(h.callbacks.length, 3)
  assert.equal(h.cancelled.length, 2)
  assert.equal(h.runs.length, 0)
})

test('the queued work runs once when the timer fires', () => {
  const h = harness()
  h.task.trigger()
  h.fire()
  assert.deepEqual(h.runs, ['run'])
  assert.equal(h.task.pending(), false)
})

test('triggering while inactive schedules nothing', () => {
  const h = harness({ active: false })
  h.task.trigger()
  assert.equal(h.callbacks.length, 0)
  assert.equal(h.task.pending(), false)
})

test('a timer that fires after the owner unloaded runs nothing', () => {
  const h = harness()
  h.task.trigger()
  h.state.active = false
  h.fire()
  assert.deepEqual(h.runs, [])
})

test('a synchronous throw is reported, never rethrown', () => {
  const h = harness({
    run: () => {
      throw new Error('boom')
    },
  })
  h.task.trigger()
  assert.doesNotThrow(() => h.fire())
  assert.equal(h.errors.length, 1)
  assert.equal(h.errors[0].message, 'boom')
})

test('a rejected promise is reported, never left unhandled', async () => {
  const h = harness({ run: async () => { throw new Error('async boom') } })
  h.task.trigger()
  h.fire()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.errors.length, 1)
  assert.equal(h.errors[0].message, 'async boom')
})

test('cancelling drops the pending timer and the callback becomes a no-op', () => {
  const h = harness()
  h.task.trigger()
  assert.equal(h.task.pending(), true)
  h.task.cancel()
  assert.equal(h.task.pending(), false)
  assert.equal(h.cancelled.length, 1)
  h.fire()
  assert.deepEqual(h.runs, [])
})

test('cancelling twice is harmless', () => {
  const h = harness()
  h.task.trigger()
  h.task.cancel()
  h.task.cancel()
  assert.equal(h.cancelled.length, 1)
})

test('invalid construction is rejected loudly', () => {
  assert.throws(() => createDebouncedTask({ delay: 1, run: () => {} }), TypeError)
  assert.throws(() => createDebouncedTask({ delay: 1, isActive: () => true }), TypeError)
  assert.throws(() => createDebouncedTask({ delay: -1, isActive: () => true, run: () => {} }), TypeError)
})

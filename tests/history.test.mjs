import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_LIMIT, createHistory } from '../src/history.js'

const role = (revision = 1) => ({ id: 'r1', name: 'r', members: [], edges: [], revision })

test('undo returns the state recorded before the edit', () => {
  const history = createHistory()
  history.record('r1', role(1))
  const back = history.takeUndo('r1', role(2))
  assert.equal(back.revision, 1)
})

test('undo with nothing recorded yields undefined', () => {
  const history = createHistory()
  assert.equal(history.takeUndo('r1', role(1)), undefined)
})

test('redo replays what undo took', () => {
  const history = createHistory()
  history.record('r1', role(1))
  history.takeUndo('r1', role(2))
  const forward = history.takeRedo('r1', role(1))
  assert.equal(forward.revision, 2)
})

test('a new edit clears the redo branch', () => {
  const history = createHistory()
  history.record('r1', role(1))
  history.takeUndo('r1', role(2))
  assert.equal(history.counts('r1').redo, 1)
  history.record('r1', role(1))
  assert.equal(history.counts('r1').redo, 0)
})

test('stacks are bounded and drop the oldest step first', () => {
  const history = createHistory({ limit: 3 })
  for (let step = 0; step < 5; step += 1) history.record('r1', role(step))
  assert.equal(history.counts('r1').undo, 3)
  // Only the three newest states survived, and undo walks them newest first.
  assert.equal(history.takeUndo('r1', role(9)).revision, 4)
  assert.equal(history.takeUndo('r1', role(8)).revision, 3)
  assert.equal(history.takeUndo('r1', role(7)).revision, 2)
  assert.equal(history.takeUndo('r1', role(6)), undefined)
})

test('histories are independent per role', () => {
  const history = createHistory()
  history.record('r1', role(1))
  assert.equal(history.counts('r2').undo, 0)
  assert.equal(history.takeUndo('r2', role(1)), undefined)
})

test('forget drops a role entirely', () => {
  const history = createHistory()
  history.record('r1', role(1))
  history.forget('r1')
  assert.deepEqual(history.counts('r1'), { undo: 0, redo: 0 })
})

test('the default depth is 20', () => {
  const history = createHistory()
  for (let step = 0; step < 30; step += 1) history.record('r1', role(step))
  assert.equal(history.counts('r1').undo, DEFAULT_LIMIT)
})

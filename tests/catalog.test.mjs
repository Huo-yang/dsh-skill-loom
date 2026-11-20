import assert from 'node:assert/strict'
import test from 'node:test'

import { buildCatalog } from '../src/catalog.js'

const summary = name => ({ name, description: name.toUpperCase() })

/**
 * Fake `ctx.skills.list`: no scope -> global layer, scope -> that agent's extra
 * skills. Global wins on collisions by construction.
 */
function fakeList({ global = [], scopes = {}, failing = new Set() } = {}) {
  return async options => {
    if (options?.scope === undefined) return global.map(summary)
    const key = String(options.scope)
    if (failing.has(key)) throw new Error(`scope ${key} unavailable`)
    return (scopes[key] ?? []).map(summary)
  }
}

test('without scopes the view is the global layer', async () => {
  const view = await buildCatalog({ list: fakeList({ global: ['a', 'b'] }) })
  assert.deepEqual([...view.keys()].sort(), ['a', 'b'])
})

test('an agent scope adds preset-mounted skills', async () => {
  const view = await buildCatalog({
    list: fakeList({ global: ['a'], scopes: { agent1: ['dsh-doc'] } }),
    agent: 'agent1',
  })
  assert.deepEqual([...view.keys()].sort(), ['a', 'dsh-doc'])
})

test('every live agent scope is included when no agent is given', async () => {
  const view = await buildCatalog({
    list: fakeList({ global: ['a'], scopes: { agent1: ['x'], agent2: ['y'] } }),
    agents: ['agent1', 'agent2'],
  })
  assert.deepEqual([...view.keys()].sort(), ['a', 'x', 'y'])
})

test('the global layer wins a name collision', async () => {
  const list = async options => (options?.scope === undefined
    ? [{ name: 'a', description: 'real' }]
    : [{ name: 'a', description: 'shadow' }])
  const view = await buildCatalog({ list, agent: 'agent1' })
  assert.equal(view.get('a').description, 'real')
})

test('a failing scope is skipped instead of breaking the view', async () => {
  const errors = []
  const view = await buildCatalog({
    list: fakeList({ global: ['a'], scopes: { bad: [], good: ['b'] }, failing: new Set(['bad']) }),
    agents: ['bad', 'good'],
    onError: error => errors.push(error.message),
  })
  assert.deepEqual([...view.keys()].sort(), ['a', 'b'])
  assert.equal(errors.length, 1)
})

test('base options reach every lookup', async () => {
  const seen = []
  const list = async options => {
    seen.push(options)
    return []
  }
  await buildCatalog({ list, agent: 'agent1', base: { cwd: '/w' } })
  assert.deepEqual(seen, [{ cwd: '/w' }, { cwd: '/w', scope: 'agent1' }])
})

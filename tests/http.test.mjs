import assert from 'node:assert/strict'
import test from 'node:test'

import { createResource } from '../src/http.js'

const UUID_A = '3f2a6c1e-9b4d-4e21-8a77-1c5b0d9e4f60'
const UUID_B = '9b4d4e21-8a77-4e21-9c33-2d7f6a1b8e02'

const role = (overrides = {}) => ({
  schema: 1,
  revision: 1,
  id: UUID_A,
  name: '审阅',
  members: ['a'],
  edges: [],
  conflicts: [],
  ...overrides,
})

const storeOf = (...roles) => {
  const byId = new Map(roles.map(item => [item.id, item]))
  return {
    async readAll() {
      return [...byId.values()]
    },
    async read(id) {
      return byId.get(id)
    },
  }
}

const catalogOf = entries => async () => new Map(Object.entries(entries).map(([name, value]) => [name, value]))

const resource = (overrides = {}) => createResource({
  store: overrides.store ?? storeOf(role()),
  catalog: overrides.catalog ?? catalogOf({ a: { name: 'a', description: 'A', path: '/a/SKILL.md' } }),
  exists: overrides.exists ?? (() => true),
})

const get = (path, method = 'GET') => new Request(`http://127.0.0.1:3080${path}`, { method })

test('the list route returns roles and the skill catalog', async () => {
  const response = await resource()(get('/plugins/skill-loom/roles'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.roles.length, 1)
  assert.equal(body.roles[0].name, '审阅')
  assert.deepEqual(body.roles[0].runtime, ['a'])
  assert.equal(body.skills[0].name, 'a')
})

test('the bare prefix is treated as the list route', async () => {
  const response = await resource()(get('/plugins/skill-loom'))
  assert.equal(response.status, 200)
})

test('a role detail carries plan, health and missing explanations', async () => {
  const response = await resource()(get(`/plugins/skill-loom/roles/${UUID_A}`))
  const body = await response.json()
  assert.equal(body.role.id, UUID_A)
  assert.deepEqual(body.plan.runtime, ['a'])
  assert.deepEqual(body.health.red, [])
  assert.deepEqual(body.plan.missing, { missing: [], unloaded: [], unconfirmed: [] })
})

test('a missing skill surfaces as red with an explanation', async () => {
  const response = await resource({
    store: storeOf(role({ members: ['a', 'gone'] })),
  })(get(`/plugins/skill-loom/roles/${UUID_A}`))
  const body = await response.json()
  assert.deepEqual(body.plan.red, ['gone'])
  assert.equal(body.roles, undefined)
})

test('an unknown role id is a 404, not an empty body', async () => {
  const response = await resource()(get(`/plugins/skill-loom/roles/${UUID_B}`))
  assert.equal(response.status, 404)
  assert.equal((await response.json()).error, 'role-not-found')
})

test('paths outside the prefix are not ours to answer', async () => {
  const response = await resource()(get('/plugins/other/roles'))
  assert.equal(response.status, 404)
})

test('a write method is refused', async () => {
  const response = await resource()(get('/plugins/skill-loom/roles', 'POST'))
  assert.equal(response.status, 405)
})

test('a store failure becomes a 500 instead of an unhandled rejection', async () => {
  const response = await resource({
    store: {
      async readAll() {
        throw new Error('disk on fire')
      },
      async read() {},
    },
  })(get('/plugins/skill-loom/roles'))
  assert.equal(response.status, 500)
  assert.match((await response.json()).message, /disk on fire/)
})

test('the list reports red and gray without dropping the role', async () => {
  const response = await resource({
    store: storeOf(role({ members: ['a', 'b'], edges: [{ from: 'b', to: 'a' }] })),
    catalog: catalogOf({ b: { description: 'B' } }),
  })(get('/plugins/skill-loom/roles'))
  const body = await response.json()
  assert.deepEqual(body.roles[0].red, ['a'])
  assert.deepEqual(body.roles[0].gray, ['b'])
})

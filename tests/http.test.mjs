import assert from 'node:assert/strict'
import test from 'node:test'

import { Readable } from 'node:stream'

import { createResource, toNodeHandler } from '../src/http.js'

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
  const response = await resource()(get('/skill-loom/roles'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.roles.length, 1)
  assert.equal(body.roles[0].name, '审阅')
  assert.deepEqual(body.roles[0].runtime, ['a'])
  assert.equal(body.skills[0].name, 'a')
})

test('the bare prefix is treated as the list route', async () => {
  const response = await resource()(get('/skill-loom'))
  assert.equal(response.status, 200)
})

test('a role detail carries plan, health and missing explanations', async () => {
  const response = await resource()(get(`/skill-loom/roles/${UUID_A}`))
  const body = await response.json()
  assert.equal(body.role.id, UUID_A)
  assert.deepEqual(body.plan.runtime, ['a'])
  assert.deepEqual(body.health.red, [])
  assert.deepEqual(body.plan.missing, { missing: [], unloaded: [], unconfirmed: [] })
})

test('a missing skill surfaces as red with an explanation', async () => {
  const response = await resource({
    store: storeOf(role({ members: ['a', 'gone'] })),
  })(get(`/skill-loom/roles/${UUID_A}`))
  const body = await response.json()
  assert.deepEqual(body.plan.red, ['gone'])
  assert.equal(body.roles, undefined)
})

test('an unknown role id is a 404, not an empty body', async () => {
  const response = await resource()(get(`/skill-loom/roles/${UUID_B}`))
  assert.equal(response.status, 404)
  assert.equal((await response.json()).error, 'role-not-found')
})

test('paths outside the prefix are not ours to answer', async () => {
  const response = await resource()(get('/plugins/other/roles'))
  assert.equal(response.status, 404)
})

test('a write method is refused', async () => {
  const response = await resource()(get('/skill-loom/roles', 'POST'))
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
  })(get('/skill-loom/roles'))
  assert.equal(response.status, 500)
  assert.match((await response.json()).message, /disk on fire/)
})

test('the list reports red and gray without dropping the role', async () => {
  const response = await resource({
    store: storeOf(role({ members: ['a', 'b'], edges: [{ from: 'b', to: 'a' }] })),
    catalog: catalogOf({ b: { description: 'B' } }),
  })(get('/skill-loom/roles'))
  const body = await response.json()
  assert.deepEqual(body.roles[0].red, ['a'])
  assert.deepEqual(body.roles[0].gray, ['b'])
})

// --- writes ---------------------------------------------------------------

const post = (path, body, headers = {}) => new Request(`http://127.0.0.1:3080${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

test('adding a member reaches the action layer with the caller revision', async () => {
  const calls = []
  const handler = createResource({
    store: storeOf(role()),
    catalog: catalogOf({ a: { name: 'a', description: 'A' }, b: { name: 'b', description: 'B' } }),
    exists: () => true,
    mutate: async input => {
      calls.push(input)
      return { ok: true }
    },
  })
  const response = await handler(post(`/skill-loom/roles/${UUID_A}/members`, {
    action: 'add_members', add: ['b'], expectedRevision: 3,
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(calls, [{ action: 'add_members', role: UUID_A, add: ['b'], remove: undefined, expectedRevision: 3 }])
})

test('a cross-origin write is refused', async () => {
  const handler = createResource({
    store: storeOf(role()),
    catalog: catalogOf({}),
    mutate: async () => ({ ok: true }),
  })
  const response = await handler(post(`/skill-loom/roles/${UUID_A}/members`, { action: 'add_members', add: ['a'] }, { origin: 'https://evil.example' }))
  assert.equal(response.status, 403)
})

test('a sandboxed (null) origin is refused too', async () => {
  const handler = createResource({ store: storeOf(role()), catalog: catalogOf({}), mutate: async () => ({}) })
  const response = await handler(post(`/skill-loom/roles/${UUID_A}/members`, { action: 'add_members', add: ['a'] }, { origin: 'null' }))
  assert.equal(response.status, 403)
})

test('a local origin is accepted', async () => {
  const handler = createResource({ store: storeOf(role()), catalog: catalogOf({}), mutate: async () => ({ ok: true }) })
  const response = await handler(post(`/skill-loom/roles/${UUID_A}/members`, { action: 'add_members', add: ['a'] }, { origin: 'http://127.0.0.1:3080' }))
  assert.equal(response.status, 200)
})

test('only the two member actions are reachable over HTTP', async () => {
  const handler = createResource({ store: storeOf(role()), catalog: catalogOf({}), mutate: async () => ({ ok: true }) })
  for (const action of ['bind', 'create', 'link', 'duplicate']) {
    const response = await handler(post(`/skill-loom/roles/${UUID_A}/members`, { action }))
    assert.equal(response.status, 400, action)
  }
})

test('malformed json is a 400, not a crash', async () => {
  const handler = createResource({ store: storeOf(role()), catalog: catalogOf({}), mutate: async () => ({}) })
  const request = new Request(`http://127.0.0.1:3080/skill-loom/roles/${UUID_A}/members`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ nope',
  })
  const response = await handler(request)
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error, 'invalid-json')
})

test('an oversized body is refused before parsing', async () => {
  const handler = createResource({ store: storeOf(role()), catalog: catalogOf({}), mutate: async () => ({}) })
  const request = post(`/skill-loom/roles/${UUID_A}/members`, { action: 'add_members', add: ['x'.repeat(70000)] })
  const response = await handler(request)
  assert.equal(response.status, 413)
})

test('a revision conflict returns 409 with the current role', async () => {
  const conflict = new Error('stale')
  conflict.name = 'RoleConflictError'
  const handler = createResource({
    store: storeOf(role({ revision: 7 })),
    catalog: catalogOf({}),
    mutate: async () => {
      throw conflict
    },
  })
  const response = await handler(post(`/skill-loom/roles/${UUID_A}/members`, { action: 'add_members', add: ['a'], expectedRevision: 2 }))
  assert.equal(response.status, 409)
  const body = await response.json()
  assert.equal(body.error, 'conflict')
  assert.equal(body.current.revision, 7)
})

test('a validation rejection surfaces its code', async () => {
  const rejected = new Error('the role was not saved because it is invalid')
  rejected.name = 'RoleGraphError'
  rejected.code = 'VALIDATION_FAILED'
  const handler = createResource({
    store: storeOf(role()),
    catalog: catalogOf({}),
    mutate: async () => {
      throw rejected
    },
  })
  const response = await handler(post(`/skill-loom/roles/${UUID_A}/members`, { action: 'add_members', add: ['a'] }))
  assert.equal(response.status, 400)
  assert.equal((await response.json()).code, 'VALIDATION_FAILED')
})

test('a host without a mutate hook is read-only', async () => {
  const response = await resource()(post(`/skill-loom/roles/${UUID_A}/members`, { action: 'add_members', add: ['a'] }))
  assert.equal(response.status, 405)
})

test('the collection route refuses POST', async () => {
  const response = await resource()(post('/skill-loom/roles', { action: 'add_members' }))
  assert.equal(response.status, 405)
})
// --- node adapter ---------------------------------------------------------

const fakeRes = () => {
  const res = {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(key, value) {
      this.headers[key] = value
    },
    end(buffer) {
      this.body = buffer
    },
  }
  return res
}

const fakeReq = ({ method = 'GET', url = '/skill-loom/roles', body, headers = {} } = {}) => {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)])
  req.method = method
  req.url = url
  req.headers = { 'content-type': 'application/json', ...headers }
  return req
}

test('the adapter forwards a POST body into the resource', async () => {
  const calls = []
  const handler = toNodeHandler(createResource({
    store: storeOf(role()),
    catalog: catalogOf({}),
    mutate: async input => {
      calls.push(input)
      return { ok: true }
    },
  }))
  const res = fakeRes()
  await handler(fakeReq({
    method: 'POST',
    url: `/skill-loom/roles/${UUID_A}/members`,
    body: JSON.stringify({ action: 'add_members', add: ['a'], expectedRevision: 1 }),
  }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].add, ['a'])
  assert.equal(JSON.parse(res.body.toString()).ok, true)
})

test('the adapter serves GET without a body', async () => {
  const handler = toNodeHandler(createResource({
    store: storeOf(role()),
    catalog: catalogOf({ a: { name: 'a', description: 'A' } }),
    exists: () => true,
  }))
  const res = fakeRes()
  await handler(fakeReq(), res)
  assert.equal(res.statusCode, 200)
  assert.equal(JSON.parse(res.body.toString()).writable, false)
})

test('the adapter refuses an oversized body before the resource runs', async () => {
  const handler = toNodeHandler(createResource({
    store: storeOf(role()),
    catalog: catalogOf({}),
    mutate: async () => ({ ok: true }),
  }))
  const res = fakeRes()
  await handler(fakeReq({
    method: 'POST',
    url: `/skill-loom/roles/${UUID_A}/members`,
    body: 'x'.repeat(70000),
  }), res)
  assert.equal(res.statusCode, 413)
})
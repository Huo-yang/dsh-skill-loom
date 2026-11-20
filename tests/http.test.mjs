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
    removed: [],
    async remove(id) {
      this.removed.push(id)
      return byId.delete(id)
    },
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
// --- edges ----------------------------------------------------------------

test('an edge write reaches the action layer with from/to', async () => {
  const calls = []
  const handler = createResource({
    store: storeOf(role({ members: ['a', 'b'] })),
    catalog: catalogOf({}),
    mutate: async input => {
      calls.push(input)
      return { ok: true }
    },
  })
  const response = await handler(post(`/skill-loom/roles/${UUID_A}/edges`, {
    action: 'link', from: 'a', to: 'b', expectedRevision: 4,
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(calls[0], {
    action: 'link', role: UUID_A, from: 'a', to: 'b', why: undefined, expectedRevision: 4,
  })
})

test('member actions are not accepted on the edge route', async () => {
  const handler = createResource({ store: storeOf(role()), catalog: catalogOf({}), mutate: async () => ({}) })
  const response = await handler(post(`/skill-loom/roles/${UUID_A}/edges`, { action: 'add_members', add: ['a'] }))
  assert.equal(response.status, 400)
})

test('edge actions are not accepted on the member route', async () => {
  const handler = createResource({ store: storeOf(role()), catalog: catalogOf({}), mutate: async () => ({}) })
  const response = await handler(post(`/skill-loom/roles/${UUID_A}/members`, { action: 'link', from: 'a', to: 'b' }))
  assert.equal(response.status, 400)
})
// --- sessions -------------------------------------------------------------

const sessionsDep = () => ({
  list: async () => [{ sessionId: 'sess_1', roleId: UUID_A }, { sessionId: 'sess_2' }],
  bind: async (sessionId, role) => ({ sessionId, roleId: role.id, live: false }),
  unbind: async sessionId => ({ sessionId, cleared: true }),
})

test('the session list comes from the host hook', async () => {
  const handler = createResource({
    store: storeOf(role()),
    catalog: catalogOf({}),
    sessions: sessionsDep(),
  })
  const response = await handler(get('/skill-loom/sessions'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(body.sessions.map(row => row.sessionId), ['sess_1', 'sess_2'])
})

test('binding a session resolves the role before calling the hook', async () => {
  const calls = []
  const handler = createResource({
    store: storeOf(role()),
    catalog: catalogOf({}),
    sessions: {
      ...sessionsDep(),
      bind: async (sessionId, loaded) => {
        calls.push([sessionId, loaded.id])
        return { sessionId, roleId: loaded.id, live: false }
      },
    },
  })
  const response = await handler(post('/skill-loom/sessions/bind', { sessionId: 'sess_3', roleId: UUID_A }))
  assert.equal(response.status, 200)
  assert.deepEqual(calls, [['sess_3', UUID_A]])
})

test('binding to an unknown role is a 404', async () => {
  const handler = createResource({ store: storeOf(role()), catalog: catalogOf({}), sessions: sessionsDep() })
  const response = await handler(post('/skill-loom/sessions/bind', { sessionId: 'sess_3', roleId: UUID_B }))
  assert.equal(response.status, 404)
})

test('binding without a session id is refused', async () => {
  const handler = createResource({ store: storeOf(role()), catalog: catalogOf({}), sessions: sessionsDep() })
  const response = await handler(post('/skill-loom/sessions/bind', { roleId: UUID_A }))
  assert.equal(response.status, 400)
})

test('unbinding reports the host result', async () => {
  const handler = createResource({ store: storeOf(role()), catalog: catalogOf({}), sessions: sessionsDep() })
  const response = await handler(post('/skill-loom/sessions/unbind', { sessionId: 'sess_1' }))
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).result, { sessionId: 'sess_1', cleared: true })
})

test('a cross-origin bind is refused', async () => {
  const handler = createResource({ store: storeOf(role()), catalog: catalogOf({}), sessions: sessionsDep() })
  const response = await handler(post('/skill-loom/sessions/bind', { sessionId: 's', roleId: UUID_A }, { origin: 'https://evil.example' }))
  assert.equal(response.status, 403)
})

test('a host without the session hook reports it instead of crashing', async () => {
  const handler = createResource({ store: storeOf(role()), catalog: catalogOf({}) })
  assert.equal((await handler(get('/skill-loom/sessions'))).status, 405)
  assert.equal((await handler(post('/skill-loom/sessions/bind', { sessionId: 's' }))).status, 405)
})
// --- fields and delete ----------------------------------------------------

test('the fields route only accepts field actions', async () => {
  const calls = []
  const handler = createResource({
    store: storeOf(role()),
    catalog: catalogOf({}),
    mutate: async input => {
      calls.push(input)
      return { ok: true }
    },
  })
  const ok = await handler(post(`/skill-loom/roles/${UUID_A}/fields`, { action: 'set_persona', persona: 'You review.' }))
  assert.equal(ok.status, 200)
  assert.equal(calls[0].persona, 'You review.')

  const refused = await handler(post(`/skill-loom/roles/${UUID_A}/fields`, { action: 'add_members', add: ['a'] }))
  assert.equal(refused.status, 400)
})

test('deleting a role removes its file', async () => {
  const store = storeOf(role())
  const handler = createResource({ store, catalog: catalogOf({}) })
  const response = await handler(post(`/skill-loom/roles/${UUID_A}/delete`, {}))
  assert.equal(response.status, 200)
  assert.deepEqual(store.removed, [UUID_A])
})

test('deleting an unknown role is a 404', async () => {
  const handler = createResource({ store: storeOf(role()), catalog: catalogOf({}) })
  const response = await handler(post(`/skill-loom/roles/${UUID_B}/delete`, {}))
  assert.equal(response.status, 404)
})

test('deleting with a stale revision is refused', async () => {
  const store = storeOf(role({ revision: 5 }))
  const handler = createResource({ store, catalog: catalogOf({}) })
  const response = await handler(post(`/skill-loom/roles/${UUID_A}/delete`, { expectedRevision: 2 }))
  assert.equal(response.status, 409)
  assert.deepEqual(store.removed, [])
})

test('a cross-origin delete is refused', async () => {
  const store = storeOf(role())
  const handler = createResource({ store, catalog: catalogOf({}) })
  const response = await handler(post(`/skill-loom/roles/${UUID_A}/delete`, {}, { origin: 'https://evil.example' }))
  assert.equal(response.status, 403)
  assert.deepEqual(store.removed, [])
})
test('creating a role goes through mutate with a trimmed name', async () => {
  const calls = []
  const handler = createResource({
    store: storeOf(),
    catalog: catalogOf({}),
    mutate: async input => {
      calls.push(input)
      return { result: { role: { id: UUID_A, name: input.name }, plan: {} } }
    },
  })
  const response = await handler(post('/skill-loom/roles', { name: '  新角色  ' }))
  assert.equal(response.status, 200)
  assert.equal(calls[0].action, 'create')
  assert.equal(calls[0].name, '新角色')
})

test('creating without a name is refused', async () => {
  const handler = createResource({ store: storeOf(), catalog: catalogOf({}), mutate: async () => ({ result: {} }) })
  assert.equal((await handler(post('/skill-loom/roles', { name: '   ' }))).status, 400)
})

test('creating on a read-only host is refused', async () => {
  const handler = createResource({ store: storeOf(), catalog: catalogOf({}) })
  assert.equal((await handler(post('/skill-loom/roles', { name: 'x' }))).status, 405)
})
// --- history --------------------------------------------------------------

const historyDep = () => ({
  counts: () => ({ undo: 1, redo: 0 }),
  undo: async id => ({ ...role(), id, name: 'restored', revision: 9 }),
  redo: async () => undefined,
})

test('undo returns the restored role and the new counts', async () => {
  const handler = createResource({ store: storeOf(role()), catalog: catalogOf({ a: 'x' }), history: historyDep() })
  const response = await handler(post(`/skill-loom/roles/${UUID_A}/history`, { action: 'undo' }))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.role.name, 'restored')
  assert.equal(body.history.undo, 1)
})

test('an unknown history direction is refused', async () => {
  const handler = createResource({ store: storeOf(role()), catalog: catalogOf({ a: 'x' }), history: historyDep() })
  const response = await handler(post(`/skill-loom/roles/${UUID_A}/history`, { action: 'sideways' }))
  assert.equal(response.status, 400)
})

test('an empty redo stack is a conflict, not a crash', async () => {
  const handler = createResource({ store: storeOf(role()), catalog: catalogOf({ a: 'x' }), history: historyDep() })
  const response = await handler(post(`/skill-loom/roles/${UUID_A}/history`, { action: 'redo' }))
  assert.equal(response.status, 409)
})
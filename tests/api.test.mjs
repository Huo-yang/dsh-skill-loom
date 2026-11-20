import assert from 'node:assert/strict'
import test from 'node:test'

import { RoleGraphError, createRoleGraphApi } from '../src/api.js'

const CATALOG = [
  { name: 'a', description: 'A', path: '/skills/a/SKILL.md', source: 'user-dsh', provider: 'filesystem' },
  { name: 'b', description: 'B', path: '/skills/b/SKILL.md', source: 'user-dsh', provider: 'filesystem' },
  { name: 'c', description: 'C', path: '/skills/c/SKILL.md', source: 'user-dsh', provider: 'filesystem' },
  { name: 'd', description: 'D', path: '/skills/d/SKILL.md', source: 'user-dsh', provider: 'filesystem' },
]

class MemoryStore {
  constructor() {
    this.roles = new Map()
    this.writes = 0
  }

  async readAll() {
    return [...this.roles.values()]
  }

  async read(id) {
    return this.roles.get(id)
  }

  async save(role, options = {}) {
    const existing = this.roles.get(role.id)
    const previous = existing?.revision ?? 0
    if (options.expectedRevision !== undefined && existing !== undefined && options.expectedRevision !== previous) {
      throw new Error(`conflict: expected ${options.expectedRevision}, found ${previous}`)
    }
    const next = { ...role, revision: previous + 1 }
    this.roles.set(role.id, next)
    this.writes += 1
    return next
  }
}

let counter = 0
function uuid() {
  counter += 1
  const tail = String(counter).padStart(12, '0')
  return `3f2a6c1e-9b4d-4e21-8a77-${tail}`
}

const api = (overrides = {}) => {
  const store = overrides.store ?? new MemoryStore()
  return createRoleGraphApi({
    store,
    listSkills: async () => overrides.catalog ?? CATALOG,
    exists: overrides.exists ?? (() => true),
    generateId: overrides.generateId ?? uuid,
  })
}

const expectCode = async (promise, code) => {
  await assert.rejects(promise, error => error instanceof RoleGraphError && error.code === code)
}

test('help lists every action', async () => {
  const result = await api().handle({ action: 'help' })
  assert.ok(result.result.actions.includes('plan'))
  assert.ok(result.result.actions.includes('link'))
})

test('an unknown action is refused with a pointer to help', async () => {
  await expectCode(api().handle({ action: 'delete' }), 'UNKNOWN_ACTION')
})

test('create then list reports the new role', async () => {
  const handler = api()
  const created = await handler.handle({ action: 'create', name: '审阅' })
  assert.equal(created.result.role.name, '审阅')
  const listed = await handler.handle({ action: 'list' })
  assert.equal(listed.result.length, 1)
  assert.equal(listed.result[0].name, '审阅')
})

test('a role can be addressed by display name', async () => {
  const handler = api()
  await handler.handle({ action: 'create', name: '审阅' })
  const shown = await handler.handle({ action: 'show', role: '审阅' })
  assert.equal(shown.result.role.name, '审阅')
})

test('an unknown role name lists what does exist', async () => {
  const handler = api()
  await handler.handle({ action: 'create', name: '审阅' })
  await assert.rejects(
    () => handler.handle({ action: 'show', role: '写作' }),
    error => error.code === 'ROLE_NOT_FOUND' && error.message.includes('审阅'),
  )
})

test('plan writes nothing', async () => {
  const store = new MemoryStore()
  const result = await api({ store }).handle({ action: 'plan', add: ['a'] })
  assert.equal(store.writes, 0)
  assert.equal(result.result.members.length, 1)
})

test('add_members fills the requires closure on save', async () => {
  const handler = api()
  const created = await handler.handle({ action: 'create', name: 'r' })
  const id = created.result.role.id
  await handler.handle({ action: 'link', role: id, from: 'a', to: 'b', why: 'needs b' })
  const after = await handler.handle({ action: 'add_members', role: id, add: ['a'] })
  assert.deepEqual(after.result.role.members.sort(), ['a', 'b'])
})

test('link without a why is refused', async () => {
  const handler = api()
  const created = await handler.handle({ action: 'create', name: 'r' })
  await expectCode(
    handler.handle({ action: 'link', role: created.result.role.id, from: 'a', to: 'b' }),
    'MISSING_WHY',
  )
})

test('a why longer than 80 characters is refused', async () => {
  const handler = api()
  const created = await handler.handle({ action: 'create', name: 'r' })
  await expectCode(
    handler.handle({ action: 'link', role: created.result.role.id, from: 'a', to: 'b', why: 'x'.repeat(81) }),
    'WHY_TOO_LONG',
  )
})

test('a self-edge is refused', async () => {
  const handler = api()
  const created = await handler.handle({ action: 'create', name: 'r' })
  await expectCode(
    handler.handle({ action: 'link', role: created.result.role.id, from: 'a', to: 'a', why: 'loop' }),
    'INVALID_EDGE',
  )
})

test('a cycle is rejected at save time', async () => {
  const handler = api()
  const created = await handler.handle({ action: 'create', name: 'r' })
  const id = created.result.role.id
  await handler.handle({ action: 'link', role: id, from: 'a', to: 'b', why: 'a needs b' })
  await assert.rejects(
    () => handler.handle({ action: 'link', role: id, from: 'b', to: 'a', why: 'b needs a' }),
    error => error.code === 'VALIDATION_FAILED'
      && error.details.issues.some(issue => issue.code === 'cycle'),
  )
})

test('removing a member also removes its edges', async () => {
  const handler = api()
  const created = await handler.handle({ action: 'create', name: 'r', add: ['a', 'b'] })
  const id = created.result.role.id
  await handler.handle({ action: 'link', role: id, from: 'a', to: 'b', why: 'a needs b' })
  const after = await handler.handle({ action: 'remove_members', role: id, remove: ['b'] })
  assert.deepEqual(after.result.role.edges, [])
  assert.deepEqual(after.result.role.members, ['a'])
})

test('a duplicate name is refused', async () => {
  const handler = api()
  await handler.handle({ action: 'create', name: '审阅' })
  await expectCode(handler.handle({ action: 'create', name: '审阅' }), 'DUPLICATE_NAME')
})

test('duplicate copies the graph under a new id and name', async () => {
  const handler = api()
  const created = await handler.handle({ action: 'create', name: '审阅', add: ['a'] })
  const id = created.result.role.id
  await handler.handle({ action: 'link', role: id, from: 'a', to: 'b', why: 'a needs b' })
  const copy = await handler.handle({ action: 'duplicate', role: id, name: '严格审阅' })
  assert.notEqual(copy.result.role.id, id)
  assert.equal(copy.result.role.name, '严格审阅')
  assert.equal(copy.result.role.edges.length, 1)
  assert.equal(copy.result.role.revision, 1)
})

test('unlink reports an edge that was never there', async () => {
  const handler = api()
  const created = await handler.handle({ action: 'create', name: 'r' })
  await expectCode(
    handler.handle({ action: 'unlink', role: created.result.role.id, from: 'a', to: 'b' }),
    'EDGE_NOT_FOUND',
  )
})

test('a skill that disappears after saving is red and explains itself from its anchor', async () => {
  const catalog = [CATALOG[0]]
  const store = new MemoryStore()
  const handler = createRoleGraphApi({
    store,
    listSkills: async () => catalog,
    exists: () => false,
    generateId: uuid,
  })
  const created = await handler.handle({ action: 'create', name: 'r', add: ['a'] })
  catalog.length = 0
  const shown = await handler.handle({ action: 'show', role: created.result.role.id })
  assert.deepEqual(shown.result.plan.red, ['a'])
  assert.deepEqual(shown.result.plan.missing.missing, [{ name: 'a', path: '/skills/a/SKILL.md' }])
})

test('a skill that still resolves is never red, even when its anchor path is gone', async () => {
  const handler = api({ exists: () => false })
  const created = await handler.handle({ action: 'create', name: 'r', add: ['a'] })
  const shown = await handler.handle({ action: 'show', role: created.result.role.id })
  assert.deepEqual(shown.result.plan.red, [])
  assert.deepEqual(shown.result.plan.missing, { missing: [], unloaded: [], unconfirmed: [] })
})

test('saving records anchors for every resolved skill', async () => {
  const handler = api()
  const created = await handler.handle({ action: 'create', name: 'r', add: ['a', 'b'] })
  assert.deepEqual(created.result.role.anchors, {
    a: { path: '/skills/a/SKILL.md', source: 'user-dsh', provider: 'filesystem' },
    b: { path: '/skills/b/SKILL.md', source: 'user-dsh', provider: 'filesystem' },
  })
})

test('a stale revision surfaces as a store conflict and nothing is lost', async () => {
  const store = new MemoryStore()
  const handler = api({ store })
  const created = await handler.handle({ action: 'create', name: 'r' })
  const id = created.result.role.id
  await handler.handle({ action: 'set_name', role: id, name: 'r2' })
  await assert.rejects(
    () => handler.handle({ action: 'set_name', role: id, name: 'r3' }, { expectedRevision: 1 }),
    /conflict/,
  )
  assert.equal((await store.read(id)).name, 'r2')
})

// --- session binding -----------------------------------------------------

test('bind delegates to the host and reports what it installed', async () => {
  const handler = api()
  const created = await handler.handle({ action: 'create', name: 'r', add: ['a'] })
  let bound
  const result = await handler.handle(
    { action: 'bind', role: 'r' },
    {
      bindSession: async role => {
        bound = role.id
        return { sessionId: 'sess_1', roleId: role.id, runtime: 1, shadowed: 2, persona: false }
      },
    },
  )
  assert.equal(bound, created.result.role.id)
  assert.deepEqual(result.result, { sessionId: 'sess_1', roleId: created.result.role.id, runtime: 1, shadowed: 2, persona: false })
})

test('bind without a host hook is refused', async () => {
  const handler = api()
  await handler.handle({ action: 'create', name: 'r' })
  await expectCode(handler.handle({ action: 'bind', role: 'r' }), 'NOT_AVAILABLE')
})

test('unbind reports whether a binding was removed', async () => {
  const handler = api()
  const result = await handler.handle({ action: 'unbind' }, { clearSession: async () => true })
  assert.deepEqual(result.result, { cleared: true })
})

test('bind of an unknown role fails before touching the session', async () => {
  const handler = api()
  let called = false
  await assert.rejects(
    () => handler.handle({ action: 'bind', role: 'nope' }, { bindSession: async () => { called = true } }),
    error => error.code === 'ROLE_NOT_FOUND',
  )
  assert.equal(called, false)
})
// --- role resolution -----------------------------------------------------

test('resolve accepts a uuid or a display name and rejects the rest', async () => {
  const handler = api()
  const created = await handler.handle({ action: 'create', name: '审阅' })
  const id = created.result.role.id
  assert.equal((await handler.resolve(id)).id, id)
  assert.equal((await handler.resolve('审阅')).id, id)
  await assert.rejects(() => handler.resolve('nope'), error => error.code === 'ROLE_NOT_FOUND')
  await assert.rejects(() => handler.resolve(''), error => error.code === 'ROLE_REQUIRED')
})
test('a human writer may draw an edge without a why', async () => {
  const handler = api()
  const created = await handler.handle({ action: 'create', name: 'r', add: ['a', 'b'] })
  const id = created.result.role.id
  const linked = await handler.handle(
    { action: 'link', role: id, from: 'a', to: 'b' },
    { source: 'human' },
  )
  assert.equal(linked.result.role.edges.length, 1)
  assert.equal(linked.result.role.edges[0].why, undefined)
})

test('an agent still has to justify an edge', async () => {
  const handler = api()
  const created = await handler.handle({ action: 'create', name: 'r', add: ['a', 'b'] })
  await expectCode(
    handler.handle({ action: 'link', role: created.result.role.id, from: 'a', to: 'b' }, { source: 'agent' }),
    'MISSING_WHY',
  )
})
test('linking a non-member onto a member pulls the source into members', async () => {
  const handler = api()
  const created = await handler.handle({ action: 'create', name: 'r', add: ['b'] })
  const id = created.result.role.id
  const linked = await handler.handle({ action: 'link', role: id, from: 'a', to: 'b' }, { source: 'human' })
  assert.deepEqual([...linked.result.role.members].sort(), ['a', 'b'])
})
test('prune_edges removes only the implied edge', async () => {
  const handler = api()
  const created = await handler.handle({ action: 'create', name: 'r', add: ['a', 'b', 'c'] })
  const id = created.result.role.id
  await handler.handle({ action: 'link', role: id, from: 'a', to: 'b', why: 'x' })
  await handler.handle({ action: 'link', role: id, from: 'b', to: 'c', why: 'y' })
  await handler.handle({ action: 'link', role: id, from: 'a', to: 'c', why: 'z' })

  const pruned = await handler.handle({ action: 'prune_edges', role: id }, { source: 'human' })
  assert.deepEqual(pruned.result.role.edges.map(edge => `${edge.from}->${edge.to}`).sort(), ['a->b', 'b->c'])
})
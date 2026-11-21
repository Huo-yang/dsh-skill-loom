import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createRoleGraphApi } from '../src/api.js'
import { createFamilyLibrary, mergeFamily } from '../src/families.js'
import { newRoleId } from '../src/graph.js'
import { RoleStore } from '../src/store.js'

test('families can be created and edited without any role', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-family-direct-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const library = createFamilyLibrary(new RoleStore(directory), {
    read() { assert.fail('direct family edits must not read a role') },
  })
  const graph = { members: ['write', 'format'], edges: [{ from: 'write', to: 'format' }] }
  const family = await library.change({ action: 'create', name: 'Writing', graph })
  assert.deepEqual(family.entries, ['format'])
  const edit = { action: 'update', id: family.id, name: family.name, expectedRevision: family.revision }
  await assert.rejects(library.change({ ...edit, graph: {
    ...graph, edges: [...graph.edges, { from: 'format', to: 'write' }],
  } }), { code: 'FAMILY_CYCLE' })
  await assert.rejects(library.change({ ...edit, graph: {
    ...graph, edges: [{ from: 'write', to: 'missing' }],
  } }), { code: 'FAMILY_EDGES' })
  assert.equal((await library.read(family.id)).revision, family.revision)
  const updated = await library.change({ ...edit, graph: { ...graph, edges: [] } })
  assert.deepEqual(updated.entries, graph.members)
  const summaryEdit = { ...edit, expectedRevision: updated.revision }
  await assert.rejects(library.change({ ...summaryEdit, description: 'x'.repeat(161) }), {
    code: 'INVALID_DESCRIPTION',
  })
  const described = await library.change({ ...summaryEdit, description: '  Write   and format  ' })
  assert.equal((await library.read(family.id)).description, 'Write and format')
  assert.deepEqual(described.members, updated.members)
  assert.deepEqual(described.edges, updated.edges)
  const revised = await library.change({ ...edit, expectedRevision: described.revision, graph })
  assert.equal(revised.description, described.description)
  const cleared = await library.change({ ...edit, expectedRevision: revised.revision, description: '' })
  assert.equal(cleared.description, undefined)
})

test('a saved family is an independent snapshot with derived entries', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-family-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const roles = new RoleStore(directory)
  const library = createFamilyLibrary(new RoleStore(join(directory, 'families')), roles)
  const role = await roles.save({
    id: newRoleId(), name: 'Author', members: ['write', 'format', 'publish'],
    edges: [{ from: 'write', to: 'format' }, { from: 'publish', to: 'write' }],
  })
  const input = { action: 'create', name: 'Writing', roleId: role.id, roleRevision: role.revision, members: ['write'] }
  const family = await library.change(input)
  assert.deepEqual(family.entries, ['format'])
  assert.deepEqual(family.members, ['write', 'format'])
  assert.deepEqual(family.edges, [{ from: 'write', to: 'format' }])
  assert.deepEqual((await roles.readAll()).map(item => item.id), [role.id])
  const newer = await roles.save({ ...role, edges: [] })
  assert.deepEqual((await library.read(family.id)).edges, family.edges)
  await assert.rejects(library.change({ ...input, name: 'Stale' }), { name: 'RoleConflictError' })
  const edited = await library.change({
    ...input, action: 'update', id: family.id, expectedRevision: family.revision, roleRevision: newer.revision,
    members: ['write', 'format'],
  })
  assert.deepEqual(edited.entries, ['write', 'format'])
  await assert.rejects(library.change({
    action: 'delete', id: family.id, expectedRevision: family.revision,
  }), { name: 'RoleConflictError' })
  await library.change({ action: 'delete', id: family.id, expectedRevision: edited.revision })
  assert.equal(await library.read(family.id), undefined)
  assert.deepEqual((await library.list()).map(item => [item.id, item.builtin]), [['builtin-role-orchestration', true]])
})

test('selecting a consumer preserves the entire transitive dependency chain', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-family-closure-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const roles = new RoleStore(directory)
  const library = createFamilyLibrary(new RoleStore(join(directory, 'families')), roles)
  const edges = [{ from: 'write', to: 'format' }, { from: 'format', to: 'parse' }]
  const role = await roles.save({ id: newRoleId(), name: 'Writer', members: ['write', 'format', 'parse', 'publish'], edges })
  const family = await library.change({
    action: 'create', name: 'Writing', roleId: role.id, roleRevision: role.revision, members: ['write'],
  })
  assert.deepEqual(family.members, ['write', 'format', 'parse'])
  assert.deepEqual(family.edges, edges)
  assert.deepEqual(family.entries, ['parse'])
})

test('merge shares existing nodes and attaches every entry to the target skill', () => {
  const original = { members: ['review', 'read', 'lint'], edges: [{ from: 'review', to: 'lint', why: 'Existing' }] }
  const family = { members: ['read', 'parse'], edges: [{ from: 'read', to: 'parse' }] }
  const merged = mergeFamily(original, family, 'review')
  assert.deepEqual(merged.members, ['review', 'read', 'lint', 'parse'])
  assert.deepEqual(merged.edges, [...original.edges, ...family.edges, { from: 'parse', to: 'review' }])
  assert.deepEqual(original.members, ['review', 'read', 'lint'])
  const multi = { ...family, edges: [] }
  assert.deepEqual(mergeFamily(original, multi, 'review').edges, [
    ...original.edges, { from: 'read', to: 'review' }, { from: 'parse', to: 'review' },
  ])
  assert.throws(() => mergeFamily(original, family, 'absent'), { code: 'FAMILY_TARGET' })
  assert.deepEqual(mergeFamily(original, multi).members, merged.members)
})

test('a cyclic insertion leaves the role unchanged', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-family-cycle-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new RoleStore(directory)
  const skills = ['a', 'b', 'c']
  const role = await store.save({ id: newRoleId(), name: 'Role', members: skills, edges: [
    { from: 'a', to: 'b' }, { from: 'b', to: 'c' },
  ] })
  const family = { members: skills, edges: [{ from: 'c', to: 'b' }, { from: 'c', to: 'a' }] }
  const api = createRoleGraphApi({ store, listSkills: async () => skills.map(name => ({ name })) })
  await assert.rejects(api.applyFamily({ role: role.id, expectedRevision: role.revision },
    current => mergeFamily(current, family)), { code: 'VALIDATION_FAILED' })
  assert.deepEqual(await store.read(role.id), role)
})

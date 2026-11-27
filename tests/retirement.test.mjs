import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RoleStore } from '../src/store.js'
import { createRetirement } from '../src/retirement.js'
import { createRoleGraphApi } from '../src/api.js'
import { createFamilyLibrary, PRESETS } from '../src/families.js'
import { createResource } from '../src/http.js'
import { createHistory } from '../src/history.js'

const id = '3f2a6c1e-9b4d-4e21-8a77-1c5b0d9e4f60'
const graph = (extra = {}) => ({ id, name: 'Review role', members: ['a'], edges: [{ from: 'a', to: 'b' }], conflicts: [], ...extra })
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'loom-retirement-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const skillFile = join(directory, 'SKILL.md'); await writeFile(skillFile, 'Synthetic skill bytes\n')
  let repo = new Map([['a', { name: 'a', path: skillFile }], ['b', { name: 'b', description: 'dependency' }]])
  let unavailable = false
  const catalog = async () => { if (unavailable) throw new Error('offline'); return repo }
  const make = () => {
    const roles = new RoleStore(directory), familyStore = new RoleStore(join(directory, 'families'))
    const service = createRetirement({ directory, stores: [{ kind: 'role', store: roles }, { kind: 'family', store: familyStore }], builtins: PRESETS, catalog })
    const families = createFamilyLibrary(familyStore, roles)
    const api = createRoleGraphApi({ store: roles, listSkills: async () => [...(await catalog()).values()], exists: () => false })
    return { roles, familyStore, service, families, api }
  }
  return { directory, skillFile, make, ...make(), catalog, setRepo: value => { repo = value }, setUnavailable: value => { unavailable = value } }
}
async function action(service, name, action = 'retire', revision) {
  return service.handle({ action, name, confirm: true, revision: revision ?? (await service.list()).revision })
}

test('inspect/list/propose/help and rejected unknown/confirmation operations do not write', async t => {
  const f = await setup(t), before = await readdir(f.directory)
  for (const input of [{ action: 'help' }, { action: 'list' }, { action: 'inspect', name: 'a' }, { action: 'propose', name: 'a' }]) await f.service.handle(input)
  await assert.rejects(action(f.service, 'unseen'), { code: 'SKILL_UNKNOWN' })
  await assert.rejects(f.service.handle({ action: 'retire', name: 'a' }), { code: 'RETIREMENT_CONFIRM' })
  assert.deepEqual(await readdir(f.directory), before)
  assert.equal(await readFile(f.skillFile, 'utf8'), 'Synthetic skill bytes\n')
})

test('saved direct/indirect, edge-only, conflicts and missing references block retirement', async t => {
  const f = await setup(t)
  await f.roles.save(graph({ conflicts: [['conflict-only', 'a']] }))
  f.setRepo(new Map())
  const status = await f.service.handle({ action: 'inspect', name: 'b' })
  assert.equal(status.skill.availability, 'unresolved')
  assert.ok(status.skill.references[0].paths.some(p => p.join('/') === 'a/b'))
  for (const name of ['a', 'b', 'conflict-only']) await assert.rejects(action(f.service, name), { code: 'SKILL_REFERENCED' })
  assert.deepEqual((await f.service.handle({ action: 'inspect', name: 'conflict-only' })).skill.references[0].conflicts, [['conflict-only', 'a']])
})

test('family references and immutable management preset block retirement', async t => {
  const f = await setup(t)
  await f.families.change({ action: 'create', name: 'Family', graph: { members: ['a', 'b'], edges: [{ from: 'a', to: 'b' }] } })
  await assert.rejects(action(f.service, 'b'), { code: 'SKILL_REFERENCED' })
  const info = await f.service.handle({ action: 'inspect', name: 'skill-loom-review' })
  assert.equal(info.skill.references[0].builtin, true)
  await assert.rejects(action(f.service, 'skill-loom-review'), { code: 'SKILL_PROTECTED' })
})

test('draft cleanup does not count; saved cleanup retains vanished names across restart', async t => {
  const f = await setup(t)
  const saved = await f.roles.save(graph())
  f.setRepo(new Map())
  await f.api.handle({ action: 'set_graph', role: id, members: [], edges: [], preview: true }, { source: 'human', expectedRevision: saved.revision })
  await assert.rejects(action(f.service, 'b'), { code: 'SKILL_REFERENCED' })
  await f.api.handle({ action: 'set_graph', role: id, members: [], edges: [] }, { source: 'human', expectedRevision: saved.revision })
  const restarted = f.make()
  await action(restarted.service, 'b')
  assert.equal((await f.make().service.handle({ action: 'inspect', name: 'b' })).skill.retired, true)
  await action(f.make().service, 'b', 'restore')
  const restored = (await f.service.handle({ action: 'inspect', name: 'b' })).skill
  assert.equal(restored.retired, false); assert.equal(restored.availability, 'unresolved')
})

test('retirement is name-based, survives directory reappearance and leaves provider bytes unchanged', async t => {
  const f = await setup(t)
  await action(f.service, 'a')
  f.setRepo(new Map([['a', { name: 'a', source: 'other scope', path: '/synthetic/another-copy' }]]))
  const info = (await f.make().service.handle({ action: 'inspect', name: 'a' })).skill
  assert.equal(info.retired, true); assert.equal(info.availability, 'available')
  assert.equal(await readFile(f.skillFile, 'utf8'), 'Synthetic skill bytes\n')
  await assert.rejects(f.api.handle({ action: 'create', name: 'New', add: ['a'] }), { code: 'SKILL_RETIRED' })
  await assert.rejects(f.families.change({ action: 'create', name: 'New family', graph: { members: ['a'], edges: [] } }), { code: 'SKILL_RETIRED' })
  await action(f.service, 'a', 'restore')
  await f.api.handle({ action: 'create', name: 'New', add: ['a'] })
})

test('old snapshots, concurrent writers and old graph saves cannot violate retirement', async t => {
  const f = await setup(t), other = f.make()
  const revision = (await f.service.list()).revision
  await f.roles.save(graph())
  await assert.rejects(action(other.service, 'b', 'retire', revision), { code: 'RETIREMENT_STALE' })
  const current = await f.roles.read(id)
  await f.roles.save(graph({ members: [], edges: [] }), { expectedRevision: current.revision })
  const r = (await f.service.list()).revision
  const outcomes = await Promise.allSettled([action(f.service, 'b', 'retire', r), other.roles.save(graph(), { expectedRevision: current.revision + 1 })])
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1)
  const status = (await f.service.handle({ action: 'inspect', name: 'b' })).skill
  assert.ok(!status.retired || status.references.length === 0)
  if (status.retired) await assert.rejects(other.roles.save(graph()), { code: 'SKILL_RETIRED' })
  else await assert.rejects(action(f.service, 'b'), { code: 'SKILL_REFERENCED' })
})

test('retirement refuses incomplete catalogs and corrupt graphs without repairing them', async t => {
  const f = await setup(t)
  await f.service.list(); f.setUnavailable(true)
  assert.equal((await f.service.handle({ action: 'inspect', name: 'a' })).skill.availability, 'unknown')
  await assert.rejects(action(f.service, 'a'), { code: 'RETIREMENT_UNCERTAIN' })
  f.setUnavailable(false)
  await writeFile(join(f.directory, id + '.json'), '{ broken')
  const before = await readdir(f.directory)
  await assert.rejects(f.service.list())
  await assert.rejects(f.roles.readAll())
  assert.deepEqual(await readdir(f.directory), before)
  assert.equal(await readFile(join(f.directory, id + '.json'), 'utf8'), '{ broken')
})

test('old format graphs remain readable and saving missing anchors preserves diagnostics', async t => {
  const f = await setup(t)
  await writeFile(join(f.directory, id + '.json'), JSON.stringify(graph({ anchors: { b: { path: '/synthetic/missing/SKILL.md' } } })))
  f.setRepo(new Map([['a', { name: 'a' }]]))
  const saved = (await f.api.handle({ action: 'set_name', role: id, name: 'Renamed' })).result
  assert.equal(saved.role.anchors.b.path, '/synthetic/missing/SKILL.md')
  assert.ok(saved.plan.red.includes('b'))
  assert.ok(saved.plan.gray.some(row => row.name === 'a'))
})

test('HTTP and model action handler share reference checks and confirmation revisions', async t => {
  const f = await setup(t)
  const resource = createResource({ store: f.roles, catalog: f.catalog, retirement: f.service })
  const post = async body => resource(new Request('http://localhost/skill-loom/skills', { method: 'POST', body: JSON.stringify(body) }))
  const saved = await f.roles.save(graph())
  const listing = await (await resource(new Request('http://localhost/skill-loom/skills'))).json()
  const input = { action: 'retire', name: 'b', confirm: true, revision: listing.revision }
  await assert.rejects(f.service.handle(input), { code: 'SKILL_REFERENCED' })
  const rejection = await post(input);assert.equal(rejection.status, 400);assert.equal((await rejection.json()).code, 'SKILL_REFERENCED')
  await f.roles.save(graph({ members: [], edges: [] }), { expectedRevision: saved.revision })
  assert.equal((await (await post(input)).json()).code, 'RETIREMENT_STALE')
  const fresh = await f.service.list();assert.equal((await post({ ...input, revision: fresh.revision })).status, 200)
})

test('undo/redo rejection does not consume history, nor allow duplicate/import-like saves', async t => {
  const f = await setup(t), history = createHistory()
  const old = await f.roles.save(graph()), clean = await f.roles.save(graph({ members: [], edges: [] }), { expectedRevision: old.revision })
  history.record(id, old)
  await action(f.service, 'b')
  const restore = async direction => {
    const current = await f.roles.read(id), target = history.peek(id, direction)
    await f.roles.save(target, { expectedRevision: current.revision })
    direction === 'undo' ? history.takeUndo(id, current) : history.takeRedo(id, current)
  }
  await assert.rejects(restore('undo'), { code: 'SKILL_RETIRED' })
  assert.deepEqual(history.counts(id), { undo: 1, redo: 0 })
  history.takeUndo(id, clean);history.takeRedo(id, old)
  history.takeUndo(id, old)
  const before = history.counts(id)
  await assert.rejects(restore('redo'), { code: 'SKILL_RETIRED' })
  assert.deepEqual(history.counts(id), before)
  await assert.rejects(f.roles.save({ ...old, id: '9b4d4e21-8a77-4e21-9c33-2d7f6a1b8e02', name: 'Copy' }), { code: 'SKILL_RETIRED' })
})

 test('A → B explicit removal preview and commit agree, and preview alone cannot unblock retirement', async t => {
  const f = await setup(t)
  await f.roles.save(graph({ members: ['a', 'b'], edges: [{ from: 'a', to: 'b', why: 'requires' }], conflicts: [['b', 'c']] }))
  const proposed = (await f.service.handle({ action: 'propose', name: 'b' })).proposal[0]
  const preview = (await f.api.handle({ action: 'plan', role: id, remove: ['b'] })).result
  for (const key of ['members', 'edges', 'conflicts']) assert.deepEqual(proposed.draft[key], preview.draft[key])
  assert.equal(preview.removedEdges.length, 1)
  assert.deepEqual(preview.removedConflicts, [['b', 'c']])
  await assert.rejects(action(f.service, 'b'), { code: 'SKILL_REFERENCED' })
  const saved = (await f.api.handle({ action: 'remove_members', role: id, remove: ['b'] })).result.role
  for (const key of ['members', 'edges', 'conflicts']) assert.deepEqual(saved[key], preview.draft[key])
  await action(f.service, 'b')
  assert.equal((await f.service.handle({ action: 'inspect', name: 'b' })).skill.retired, true)
})

test('discovery unknown, unresolved catalog and verified missing file are separate from retirement', async t => {
  const f = await setup(t)
  await f.service.list()
  f.setRepo(new Map())
  assert.equal((await f.service.handle({ action: 'inspect', name: 'a' })).skill.availability, 'unresolved')
  await rm(f.skillFile) // synthetic fixture only
  assert.equal((await f.service.handle({ action: 'inspect', name: 'a' })).skill.availability, 'missing')
  f.setUnavailable(true)
  assert.equal((await f.service.handle({ action: 'inspect', name: 'a' })).skill.availability, 'unknown')
  await assert.rejects(action(f.service, 'a'), { code: 'RETIREMENT_UNCERTAIN' })
  f.setUnavailable(false)
  await action(f.service, 'a')
  const retired = (await f.service.handle({ action: 'inspect', name: 'a' })).skill
  assert.equal(retired.availability, 'missing')
  assert.equal(retired.retired, true)
})

test('unknown graph schemas and quarantined files block inventory without mutation', async t => {
  const f = await setup(t)
  const path = join(f.directory, id + '.json')
  await writeFile(path, JSON.stringify(graph({ schema: 99 })))
  await assert.rejects(f.service.list(), { code: 'RETIREMENT_UNCERTAIN' })
  await rm(path)
  await writeFile(path + '.corrupt-test', 'synthetic corrupt graph')
  const before = await readdir(f.directory)
  await assert.rejects(f.service.list(), { code: 'RETIREMENT_UNCERTAIN' })
  assert.deepEqual(await readdir(f.directory), before)
})

test('partial graph/metadata failure is never reported as successful cleanup and blocks reads across restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-write-failure-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let failMetadata = false, failGraph = false
  class FaultStore extends RoleStore {
    async save(value, options) {
      if (failGraph) throw new Error('synthetic graph write failure')
      const saved = await super.save(value, options)
      if (failMetadata) {
        await rm(join(directory, 'skill-retirement.json'), { force: true })
        await mkdir(join(directory, 'skill-retirement.json')) // force metadata rename to fail
      }
      return saved
    }
  }
  const roles = new FaultStore(directory)
  const catalog = async () => new Map([['a', { name: 'a' }], ['b', { name: 'b' }]])
  const service = createRetirement({ directory, stores: [{ kind: 'role', store: roles }], catalog })
  const saved = await roles.save(graph())
  const before = await readFile(join(directory, id + '.json'), 'utf8')
  failGraph = true
  await assert.rejects(roles.save(graph({ edges: [], members: [] }), { expectedRevision: saved.revision }), /synthetic graph write failure/)
  assert.equal(await readFile(join(directory, id + '.json'), 'utf8'), before)
  assert.equal((await service.handle({ action: 'inspect', name: 'b' })).skill.references.length, 1)
  failGraph = false; failMetadata = true
  await assert.rejects(roles.save(graph({ edges: [], members: [] }), { expectedRevision: saved.revision }), { code: 'RETIREMENT_UNCERTAIN' })
  assert.equal(JSON.parse(await readFile(join(directory, id + '.json'), 'utf8')).edges.length, 0)
  await assert.rejects(service.list(), { code: 'RETIREMENT_UNCERTAIN' })
  await assert.rejects(roles.read(id), { code: 'RETIREMENT_UNCERTAIN' })
  await assert.rejects(roles.readAll(), { code: 'RETIREMENT_UNCERTAIN' })
  const restartedRoles = new RoleStore(directory)
  const restarted = createRetirement({ directory, stores: [{ kind: 'role', store: restartedRoles }], catalog })
  await assert.rejects(restarted.handle({ action: 'retire', name: 'b', confirm: true, revision: 'old' }), { code: 'RETIREMENT_UNCERTAIN' })
  await assert.rejects(restartedRoles.save(graph()), { code: 'RETIREMENT_UNCERTAIN' })
})

test('partial template deletion also retains a blocking transaction marker', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-delete-failure-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  class FaultStore extends RoleStore {
    async remove(id) {
      const result = await super.remove(id)
      await rm(join(directory, 'skill-retirement.json'), { force: true })
      await mkdir(join(directory, 'skill-retirement.json'))
      return result
    }
  }
  const store = new FaultStore(join(directory, 'families'))
  const service = createRetirement({ directory, stores: [{ kind: 'family', store }], catalog: async () => new Map() })
  const saved = await store.save(graph())
  await assert.rejects(store.remove(id, { expectedRevision: saved.revision }), { code: 'RETIREMENT_UNCERTAIN' })
  await assert.rejects(service.list(), { code: 'RETIREMENT_UNCERTAIN' })
  await assert.rejects(store.readAll(), { code: 'RETIREMENT_UNCERTAIN' })
})

import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { RoleConflictError, RoleStore, RoleValidationError } from '../src/store.js'

const UUID_A = '3f2a6c1e-9b4d-4e21-8a77-1c5b0d9e4f60'
const UUID_B = '9b4d4e21-8a77-4e21-9c33-2d7f6a1b8e02'

const roots = []
after(async () => {
  await Promise.all(roots.map(dir => rm(dir, { recursive: true, force: true })))
})

async function freshStore() {
  const dir = await mkdtemp(join(tmpdir(), 'loom-store-'))
  roots.push(dir)
  const store = new RoleStore(dir)
  await store.init()
  return { dir, store }
}

const role = (overrides = {}) => ({
  schema: 1,
  id: UUID_A,
  name: '审阅',
  members: ['code-review'],
  edges: [],
  conflicts: [],
  ...overrides,
})

test('a new role starts at revision 1', async () => {
  const { store } = await freshStore()
  const saved = await store.save(role())
  assert.equal(saved.revision, 1)
  const read = await store.read(UUID_A)
  assert.deepEqual(read, saved)
})

test('each save bumps the revision', async () => {
  const { store } = await freshStore()
  await store.save(role())
  const second = await store.save(role({ members: ['code-review', 'git-workflow'] }))
  assert.equal(second.revision, 2)
})

test('a stale expected revision is a conflict, not a silent overwrite', async () => {
  const { store } = await freshStore()
  await store.save(role())
  await store.save(role({ name: '审阅 v2' }))
  await assert.rejects(
    () => store.save(role({ name: '审阅 v3' }), { expectedRevision: 1 }),
    error => error instanceof RoleConflictError && error.actual === 2,
  )
  const onDisk = await store.read(UUID_A)
  assert.equal(onDisk.name, '审阅 v2')
})

test('a matching expected revision is accepted', async () => {
  const { store } = await freshStore()
  const first = await store.save(role())
  const second = await store.save(role({ name: '审阅 v2' }), { expectedRevision: first.revision })
  assert.equal(second.revision, 2)
})

test('display names stay unique, case-insensitively', async () => {
  const { store } = await freshStore()
  await store.save(role({ name: 'Code Review' }))
  await assert.rejects(
    () => store.save(role({ id: UUID_B, name: 'code review' })),
    error => error instanceof RoleValidationError && error.code === 'duplicate-name',
  )
})

test('a role may keep its own name when updating itself', async () => {
  const { store } = await freshStore()
  await store.save(role({ name: '审阅' }))
  await store.save(role({ name: '审阅', members: ['x'] }))
  assert.equal((await store.read(UUID_A)).revision, 2)
})

test('an invalid id or name is rejected before touching disk', async () => {
  const { store } = await freshStore()
  await assert.rejects(() => store.save(role({ id: 'review' })), error => error.code === 'invalid-id')
  await assert.rejects(() => store.save(role({ name: '' })), error => error.code === 'invalid-name')
})

test('reading a role that does not exist yields undefined', async () => {
  const { store } = await freshStore()
  assert.equal(await store.read(UUID_B), undefined)
})

test('remove reports whether anything was deleted', async () => {
  const { store } = await freshStore()
  await store.save(role())
  assert.equal(await store.remove(UUID_A), true)
  assert.equal(await store.remove(UUID_A), false)
})

test('a corrupt file is quarantined instead of crashing the listing', async () => {
  const { dir, store } = await freshStore()
  await store.save(role())
  await writeFile(join(dir, `${UUID_B}.json`), '{ not json')

  const all = await store.readAll()
  assert.deepEqual(all.map(row => row.id), [UUID_A])

  const entries = await readdir(dir)
  const quarantined = entries.filter(name => name.startsWith(`${UUID_B}.json.corrupt-`))
  assert.equal(quarantined.length, 1)
  assert.equal(await store.read(UUID_B), undefined)
})

test('readAll skips non-role files', async () => {
  const { dir, store } = await freshStore()
  await store.save(role())
  await writeFile(join(dir, 'bindings.json'), '{"schema":1,"bindings":{}}')
  await writeFile(join(dir, 'notes.json'), '{}')

  const all = await store.readAll()
  assert.deepEqual(all.map(row => row.id), [UUID_A])
})

test('no temporary file survives a successful write', async () => {
  const { dir, store } = await freshStore()
  await store.save(role())
  const entries = await readdir(dir)
  assert.deepEqual(entries, [`${UUID_A}.json`])
})

test('the file on disk is pretty-printed JSON with a trailing newline', async () => {
  const { dir, store } = await freshStore()
  await store.save(role())
  const text = await readFile(join(dir, `${UUID_A}.json`), 'utf8')
  assert.ok(text.endsWith('\n'))
  assert.ok(text.includes('\n  "name": "审阅"'))
})

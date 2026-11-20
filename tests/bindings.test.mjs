import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { BindingStore, bindingsFileFor } from '../src/bindings.js'

const roots = []
after(async () => {
  await Promise.all(roots.map(dir => rm(dir, { recursive: true, force: true })))
})

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'loom-bindings-'))
  roots.push(dir)
  return { dir, file: join(dir, 'bindings.json'), store: new BindingStore(join(dir, 'bindings.json')) }
}

test('an unbound session has no role', async () => {
  const { store } = await fresh()
  assert.equal(await store.get('sess_a'), undefined)
})

test('a binding survives a new store instance', async () => {
  const { file, store } = await fresh()
  await store.set('sess_a', 'role-1')
  const reopened = new BindingStore(file)
  assert.equal(await reopened.get('sess_a'), 'role-1')
})

test('bindings are independent per session', async () => {
  const { store } = await fresh()
  await store.set('sess_a', 'role-1')
  await store.set('sess_b', 'role-2')
  assert.equal(await store.get('sess_a'), 'role-1')
  assert.equal(await store.get('sess_b'), 'role-2')
})

test('clearing one binding leaves the others alone', async () => {
  const { store } = await fresh()
  await store.set('sess_a', 'role-1')
  await store.set('sess_b', 'role-2')
  assert.equal(await store.clear('sess_a'), true)
  assert.equal(await store.get('sess_a'), undefined)
  assert.equal(await store.get('sess_b'), 'role-2')
})

test('clearing an unbound session reports false', async () => {
  const { store } = await fresh()
  assert.equal(await store.clear('sess_missing'), false)
})

test('the file is pretty-printed and carries a timestamp', async () => {
  const { file, store } = await fresh()
  await store.set('sess_a', 'role-1')
  const text = await readFile(file, 'utf8')
  assert.ok(text.endsWith('\n'))
  assert.ok(text.includes('"roleId": "role-1"'))
  assert.ok(text.includes('boundAt'))
})

test('a corrupt file degrades to no bindings instead of throwing', async () => {
  const { file } = await fresh()
  await writeFile(file, '{ nope')
  const store = new BindingStore(file)
  assert.equal(await store.get('sess_a'), undefined)
  await store.set('sess_a', 'role-1')
  assert.equal(await store.get('sess_a'), 'role-1')
})

test('the bindings document lives beside the role files', () => {
  const path = bindingsFileFor(join('home', 'roles'))
  assert.ok(path.endsWith(join('home', 'roles', 'bindings.json')), path)
})
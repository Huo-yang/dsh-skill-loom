import assert from 'node:assert/strict'
import test from 'node:test'

import { createOverrideRegistry, resolveCreatedRole } from '../src/spawn.js'

test('an override is consumed exactly once', () => {
  const registry = createOverrideRegistry()
  registry.set('parent-a', 'role-1')
  assert.equal(registry.take('parent-a'), 'role-1')
  assert.equal(registry.take('parent-a'), undefined)
  assert.equal(registry.size(), 0)
})

test('overrides are keyed per parent', () => {
  const registry = createOverrideRegistry()
  registry.set('parent-a', 'role-1')
  registry.set('parent-b', 'role-2')
  assert.equal(registry.take('parent-a'), 'role-1')
  assert.equal(registry.take('parent-b'), 'role-2')
})

test('clearing drops an unused override', () => {
  const registry = createOverrideRegistry()
  registry.set('parent-a', 'role-1')
  registry.clear('parent-a')
  assert.equal(registry.size(), 0)
  assert.equal(registry.take('parent-a'), undefined)
})

const bound = map => async id => map[id]
const roles = map => async id => map[id]

const resolve = (overrides = {}) => resolveCreatedRole({
  sessionId: 'child',
  parentSession: 'parent',
  takeOverride: () => undefined,
  boundRoleFor: async () => undefined,
  loadRole: async id => ({ id }),
  ...overrides,
})

test('an explicit override wins over inheritance', async () => {
  const decision = await resolve({
    takeOverride: () => 'override-role',
    boundRoleFor: bound({ parent: 'parent-role' }),
  })
  assert.deepEqual(decision, { role: { id: 'override-role' }, source: 'override' })
})

test('without an override a child inherits the parent role', async () => {
  const decision = await resolve({ boundRoleFor: bound({ parent: 'parent-role' }) })
  assert.deepEqual(decision, { role: { id: 'parent-role' }, source: 'inherit' })
})

test('an unbound parent falls back to the child own binding', async () => {
  const decision = await resolve({ boundRoleFor: bound({ child: 'own-role' }) })
  assert.deepEqual(decision, { role: { id: 'own-role' }, source: 'own' })
})

test('a top-level session uses its own binding', async () => {
  const decision = await resolve({ sessionId: 'root', parentSession: undefined, boundRoleFor: bound({ root: 'root-role' }) })
  assert.deepEqual(decision, { role: { id: 'root-role' }, source: 'own' })
})

test('nothing bound anywhere resolves to none', async () => {
  const decision = await resolve({})
  assert.deepEqual(decision, { role: undefined, source: 'none' })
})

test('a deleted override role falls through to inheritance', async () => {
  const decision = await resolve({
    takeOverride: () => 'deleted-role',
    boundRoleFor: bound({ parent: 'parent-role' }),
    loadRole: roles({ 'parent-role': { id: 'parent-role' } }),
  })
  assert.deepEqual(decision, { role: { id: 'parent-role' }, source: 'inherit' })
})

test('a deleted parent role falls through to the child binding', async () => {
  const decision = await resolve({
    boundRoleFor: bound({ parent: 'deleted', child: 'own-role' }),
    loadRole: roles({ 'own-role': { id: 'own-role' } }),
  })
  assert.deepEqual(decision, { role: { id: 'own-role' }, source: 'own' })
})
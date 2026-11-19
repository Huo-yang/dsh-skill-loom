import assert from 'node:assert/strict'
import test from 'node:test'

import {
  computeHealth,
  findCycles,
  isRoleNameTaken,
  newRoleId,
  planRole,
  referencedNames,
  requiresClosure,
  roleNameKey,
  topoLevels,
  validateRole,
  validateRoleId,
  validateRoleName,
} from '../src/graph.js'

const repo = (...names) => new Map(names.map(name => [name, { description: `${name} skill` }]))

const ROLE_ID = '3f2a6c1e-9b4d-4e21-8a77-1c5b0d9e4f60'

const role = (overrides = {}) => ({
  id: ROLE_ID,
  name: '审阅',
  members: [],
  edges: [],
  conflicts: [],
  ...overrides,
})

test('validateRoleId accepts a UUID and nothing else', () => {
  assert.deepEqual(validateRoleId(ROLE_ID), { ok: true })
  assert.equal(validateRoleId(ROLE_ID.toUpperCase()).ok, true)
  for (const bad of ['review', '', '3f2a6c1e-9b4d-4e21-8a77', `${ROLE_ID}-x`, '审阅', 42, null]) {
    assert.equal(validateRoleId(bad).ok, false, String(bad))
  }
})

test('newRoleId mints ids that validate', () => {
  assert.equal(validateRoleId(newRoleId()).ok, true)
  assert.notEqual(newRoleId(), newRoleId())
})

test('newRoleId refuses a generator that produces an invalid id', () => {
  assert.throws(() => newRoleId(() => 'not-a-uuid'), TypeError)
})

test('validateRoleName accepts free-form names and rejects path-like edges', () => {
  assert.equal(validateRoleName('审阅').ok, true)
  assert.equal(validateRoleName('Code Review').ok, true)
  assert.equal(validateRoleName('🔍 审阅').ok, true)
  assert.equal(validateRoleName('').ok, false)
  assert.equal(validateRoleName('   ').ok, false)
  assert.equal(validateRoleName(' 审阅').ok, false)
  assert.equal(validateRoleName('审阅 ').ok, false)
  assert.equal(validateRoleName('a'.repeat(65)).ok, false)
  assert.equal(validateRoleName('bad\u0007name').ok, false)
  assert.equal(validateRoleName(7).ok, false)
})

test('role names are unique case-insensitively, ids are not', () => {
  const roles = [{ id: ROLE_ID, name: 'Code Review' }, { id: 'other', name: '审阅' }]
  assert.equal(roleNameKey('  Code Review '), 'code review')
  assert.equal(isRoleNameTaken(roles, 'code review'), true)
  assert.equal(isRoleNameTaken(roles, '审阅'), true)
  assert.equal(isRoleNameTaken(roles, '写作'), false)
  assert.equal(isRoleNameTaken(roles, 'code review', ROLE_ID), false)
})
test('referencedNames collects members, edge endpoints and conflict pairs', () => {
  const graph = role({
    members: ['a'],
    edges: [{ from: 'a', to: 'b', why: 'needs b' }],
    conflicts: [['c', 'd']],
  })
  assert.deepEqual(referencedNames(graph).sort(), ['a', 'b', 'c', 'd'])
})

test('requiresClosure walks the whole chain', () => {
  const graph = role({
    members: ['a'],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
    ],
  })
  assert.deepEqual([...requiresClosure(graph)].sort(), ['a', 'b', 'c', 'd'])
})

test('requiresClosure only follows edges, never leaves', () => {
  const graph = role({ members: ['a'], edges: [{ from: 'x', to: 'y' }] })
  assert.deepEqual([...requiresClosure(graph)], ['a'])
})

test('findCycles reports the full loop', () => {
  const graph = role({
    members: ['a'],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a' },
    ],
  })
  const cycles = findCycles(graph)
  assert.equal(cycles.length, 1)
  assert.deepEqual(cycles[0], ['a', 'b', 'c', 'a'])
})

test('findCycles is empty for a DAG', () => {
  const graph = role({
    members: ['a', 'b'],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
  })
  assert.deepEqual(findCycles(graph), [])
})

test('topoLevels puts leaves at zero and consumers above their dependencies', () => {
  const graph = role({
    members: ['a'],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ],
  })
  const levels = topoLevels(graph)
  assert.equal(levels.get('c'), 0)
  assert.equal(levels.get('b'), 1)
  assert.equal(levels.get('a'), 2)
})

test('a fully resolved role has an empty red and gray set', () => {
  const graph = role({ members: ['a', 'b'], edges: [{ from: 'a', to: 'b' }] })
  const health = computeHealth(graph, repo('a', 'b'))
  assert.deepEqual(health.runtime, ['a', 'b'])
  assert.deepEqual(health.red, [])
  assert.deepEqual(health.gray, [])
})

test('a missing leaf cascades: every dependent turns gray and leaves the runtime', () => {
  const graph = role({
    members: ['a', 'b', 'c'],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ],
  })
  const health = computeHealth(graph, repo('a', 'b'))
  assert.deepEqual(health.red, ['c'])
  assert.deepEqual(health.gray.map(row => row.name).sort(), ['a', 'b'])
  assert.deepEqual(health.runtime, [])
})

test('a gray row names the full path to the missing skill', () => {
  const graph = role({
    members: ['a', 'b', 'c'],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ],
  })
  const health = computeHealth(graph, repo('a', 'b'))
  const b = health.gray.find(row => row.name === 'b')
  const a = health.gray.find(row => row.name === 'a')
  assert.deepEqual(b.path, ['b', 'c'])
  assert.deepEqual(a.path, ['a', 'b', 'c'])
})

test('no red means no gray, even with a long chain', () => {
  const graph = role({
    members: ['a', 'b', 'c', 'd'],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
    ],
  })
  const health = computeHealth(graph, repo('a', 'b', 'c', 'd'))
  assert.deepEqual(health.red, [])
  assert.deepEqual(health.gray, [])
  assert.equal(health.runtime.length, 4)
})

test('an unrelated member is untouched when another branch is broken', () => {
  const graph = role({
    members: ['a', 'b', 'z'],
    edges: [{ from: 'a', to: 'b' }],
  })
  const health = computeHealth(graph, repo('a', 'z'))
  assert.deepEqual(health.red, ['b'])
  assert.deepEqual(health.gray.map(row => row.name), ['a'])
  assert.deepEqual(health.runtime, ['z'])
})

test('non-member edge endpoints never become gray', () => {
  const graph = role({ members: ['a'], edges: [{ from: 'x', to: 'y' }] })
  const health = computeHealth(graph, repo('a'))
  assert.deepEqual(health.gray, [])
  assert.deepEqual(health.runtime, ['a'])
})
test('validateRole rejects cycles, conflicts and missing whys from an agent', () => {
  const graph = role({
    members: ['a', 'b', 'c'],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
    ],
    conflicts: [['a', 'c']],
  })
  const codes = validateRole(graph, repo('a', 'b', 'c'), { source: 'agent' }).map(i => i.code)
  assert.ok(codes.includes('cycle'))
  assert.ok(codes.includes('conflict'))
  assert.ok(codes.includes('missing-why'))
})

test('validateRole lets a human leave the why empty', () => {
  const graph = role({ members: ['a', 'b'], edges: [{ from: 'a', to: 'b' }] })
  const codes = validateRole(graph, repo('a', 'b'), { source: 'human' }).map(i => i.code)
  assert.ok(!codes.includes('missing-why'))
})

test('validateRole reports auto-fill for a resolvable dependency', () => {
  const graph = role({ members: ['a'], edges: [{ from: 'a', to: 'b', why: 'x' }] })
  const issues = validateRole(graph, repo('a', 'b'))
  const autoFill = issues.find(i => i.code === 'auto-fill')
  assert.ok(autoFill)
  assert.equal(autoFill.severity, 'info')
})

test('validateRole warns, but does not block, on an unresolvable dependency', () => {
  const graph = role({ members: ['a'], edges: [{ from: 'a', to: 'gone', why: 'x' }] })
  const issues = validateRole(graph, repo('a'))
  const unresolved = issues.find(i => i.code === 'unresolved-dependency')
  assert.ok(unresolved)
  assert.equal(unresolved.severity, 'warning')
  assert.ok(!issues.some(i => i.severity === 'error'))
})

test('validateRole ignores a conflict pair that is not reachable', () => {
  const graph = role({ members: ['a'], conflicts: [['x', 'y']] })
  const codes = validateRole(graph, repo('a')).map(i => i.code)
  assert.ok(!codes.includes('conflict'))
})

test('validateRole rejects an id that is not a UUID', () => {
  const codes = validateRole(role({ id: 'review' }), repo()).map(i => i.code)
  assert.ok(codes.includes('invalid-id'))
})

test('planRole reports what a save would add and what the catalog costs', () => {
  const graph = role({
    members: ['a'],
    edges: [{ from: 'a', to: 'b', why: 'x' }],
  })
  const result = planRole(graph, repo('a', 'b'))
  assert.deepEqual(result.toAdd, ['b'])
  assert.deepEqual(result.runtime.sort(), ['a', 'b'])
  // name + description for both members
  assert.equal(result.catalogChars, ('a'.length + 'a skill'.length) + ('b'.length + 'b skill'.length))
})

test('planRole never pulls in a dependent that is not a member', () => {
  const graph = role({ members: ['b'], edges: [{ from: 'a', to: 'b', why: 'x' }] })
  const result = planRole(graph, repo('a', 'b'))
  assert.deepEqual(result.toAdd, [])
  assert.deepEqual(result.runtime, ['b'])
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  captureAnchors,
  computeHealth,
  explainMissing,
  detectAnchorDrift,
  findCycles,
  findRedundantEdges,
  isRoleNameTaken,
  newRoleId,
  planRole,
  referencedNames,
  requiresClosure,
  resolvedMembers,
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
test('validateRole rejects cycles and conflicts', () => {
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

test('an edge source outside members is pulled in, not left dangling', () => {
  // Regression: a link whose `from` was not a member used to produce an edge the
  // canvas never drew while the inspector still listed it as a dependent.
  const graph = role({ members: ['b'], edges: [{ from: 'a', to: 'b', why: 'x' }] })
  const result = planRole(graph, repo('a', 'b'))
  assert.deepEqual(result.toAdd, ['a'])
  assert.deepEqual([...result.runtime].sort(), ['a', 'b'])
})

// --- anchors -------------------------------------------------------------

const entries = map => new Map(Object.entries(map).map(([name, value]) => [name, value]))

test('captureAnchors records where each referenced skill resolved from', () => {
  const graph = role({ members: ['a', 'b'], edges: [{ from: 'a', to: 'b', why: 'x' }] })
  const repository = entries({
    a: { description: 'A', path: '/home/u/.dsh/skills/a/SKILL.md', source: 'user-dsh', provider: 'filesystem' },
    b: { description: 'B', provider: 'virtual-plugin' },
  })
  assert.deepEqual(captureAnchors(graph, repository), {
    a: { path: '/home/u/.dsh/skills/a/SKILL.md', source: 'user-dsh', provider: 'filesystem' },
    b: { provider: 'virtual-plugin' },
  })
})

test('captureAnchors skips skills the repository cannot resolve', () => {
  const graph = role({ members: ['a', 'gone'] })
  assert.deepEqual(captureAnchors(graph, entries({ a: { path: '/x' } })), { a: { path: '/x' } })
})

test('a reinstalled skill is reported as drift, not as missing', () => {
  const graph = role({
    members: ['a'],
    anchors: { a: { path: '/old/a/SKILL.md', source: 'user-dsh' } },
  })
  const drift = detectAnchorDrift(graph, entries({ a: { path: '/new/a/SKILL.md', source: 'project-dsh' } }))
  assert.deepEqual(drift, [
    { name: 'a', kind: 'path-changed', from: '/old/a/SKILL.md', to: '/new/a/SKILL.md' },
    { name: 'a', kind: 'source-changed', from: 'user-dsh', to: 'project-dsh' },
  ])
})

test('a vanished skill is red, never drift', () => {
  const graph = role({ members: ['a'], anchors: { a: { path: '/old/a/SKILL.md' } } })
  assert.deepEqual(detectAnchorDrift(graph, entries({})), [])
})

test('anchor drift surfaces as a warning, not an error', () => {
  const graph = role({ members: ['a'], anchors: { a: { path: '/old/a/SKILL.md' } } })
  const issues = validateRole(graph, entries({ a: { path: '/new/a/SKILL.md' } }))
  const drift = issues.find(issue => issue.code === 'anchor-drift')
  assert.ok(drift)
  assert.equal(drift.severity, 'warning')
  assert.ok(!issues.some(issue => issue.severity === 'error'))
})
// --- missing confirmation ------------------------------------------------

test('a deleted file confirms the skill is gone', () => {
  const graph = role({
    members: ['a'],
    anchors: { a: { path: '/gone/a/SKILL.md' } },
  })
  const result = explainMissing(graph, entries({}), () => false)
  assert.deepEqual(result.missing, [{ name: 'a', path: '/gone/a/SKILL.md' }])
  assert.deepEqual(result.unloaded, [])
  assert.deepEqual(result.unconfirmed, [])
})

test('a file still on disk is reported as unloaded, not missing', () => {
  const graph = role({
    members: ['a'],
    anchors: { a: { path: '/still/a/SKILL.md' } },
  })
  const result = explainMissing(graph, entries({}), path => path === '/still/a/SKILL.md')
  assert.deepEqual(result.missing, [])
  assert.deepEqual(result.unloaded, [{ name: 'a', path: '/still/a/SKILL.md' }])
})

test('without an anchor or a probe the state stays unconfirmed', () => {
  const graph = role({ members: ['virtual'] })
  const result = explainMissing(graph, entries({}), () => false)
  assert.deepEqual(result.unconfirmed, ['virtual'])
  assert.deepEqual(result.missing, [])
})

test('a resolved skill is never reported as missing, even if the anchor moved', () => {
  const graph = role({
    members: ['a'],
    anchors: { a: { path: '/old/a/SKILL.md' } },
  })
  const result = explainMissing(graph, entries({ a: { path: '/new/a/SKILL.md' } }), () => false)
  assert.deepEqual(result, { missing: [], unloaded: [], unconfirmed: [] })
})

test('validateRole distinguishes a confirmed loss from an unloaded file', () => {
  const base = role({ members: ['a'], anchors: { a: { path: '/x/a/SKILL.md' } } })
  const gone = validateRole(base, entries({}), { exists: () => false }).map(i => i.code)
  const present = validateRole(base, entries({}), { exists: () => true }).map(i => i.code)
  assert.ok(gone.includes('missing-confirmed'))
  assert.ok(present.includes('missing-but-present'))
  assert.ok(!present.includes('missing-confirmed'))
})

test('planRole carries the missing classification', () => {
  const graph = role({ members: ['a'], anchors: { a: { path: '/x/a/SKILL.md' } } })
  const result = planRole(graph, entries({}), { exists: () => true })
  assert.deepEqual(result.missing.unloaded, [{ name: 'a', path: '/x/a/SKILL.md' }])
  assert.deepEqual(result.red, ['a'])
})
test('topoLevels covers members that have no edges at all', () => {
  const graph = role({ members: ['a', 'b'] })
  const levels = topoLevels(graph)
  assert.equal(levels.get('a'), 0)
  assert.equal(levels.get('b'), 0)
})
test('a node may have unlimited out-edges and unlimited in-edges', () => {
  const graph = role({
    members: ['a', 'e', 'f'],
    edges: [
      // a fans out to three dependencies
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
      { from: 'a', to: 'd' },
      // b is required by three different nodes
      { from: 'e', to: 'b' },
      { from: 'f', to: 'b' },
    ],
  })
  const closure = requiresClosure(graph)
  assert.deepEqual([...closure].sort(), ['a', 'b', 'c', 'd', 'e', 'f'])

  const levels = topoLevels(graph)
  assert.equal(levels.get('b'), 0)
  assert.equal(levels.get('a'), 1)
  assert.equal(levels.get('e'), 1)
  assert.equal(levels.get('f'), 1)
})

test('one missing dependency greys out every node that requires it', () => {
  const graph = role({
    members: ['a', 'e', 'f'],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
      { from: 'e', to: 'b' },
      { from: 'f', to: 'b' },
    ],
  })
  const health = computeHealth(graph, repo('a', 'c', 'e', 'f'))
  assert.deepEqual(health.red, ['b'])
  assert.deepEqual(health.gray.map(row => row.name).sort(), ['a', 'e', 'f'])
  assert.deepEqual(health.runtime, ['c'])
})
test('a self-edge is reported as a cycle', () => {
  const graph = role({ members: ['a'], edges: [{ from: 'a', to: 'a' }] })
  assert.deepEqual(findCycles(graph), [['a', 'a']])
})

test('duplicate identical edges do not double-count', () => {
  const graph = role({
    members: ['a'],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'b' },
    ],
  })
  assert.deepEqual([...requiresClosure(graph)].sort(), ['a', 'b'])
  assert.deepEqual(findCycles(graph), [])
})

test('resolving a role never mutates it', () => {
  const graph = role({
    members: ['a', 'b'],
    edges: [{ from: 'a', to: 'b' }],
    conflicts: [['x', 'y']],
    anchors: { a: { path: '/a' } },
  })
  const before = JSON.parse(JSON.stringify(graph))
  computeHealth(graph, repo('a'))
  planRole(graph, repo('a'), { exists: () => true })
  validateRole(graph, repo('a'), { source: 'agent', exists: () => true })
  assert.deepEqual(graph, before)
})
test('an edge endpoint outside members still belongs to the graph', () => {
  const graph = role({ members: ['b'], edges: [{ from: 'a', to: 'b' }] })
  assert.deepEqual([...resolvedMembers(graph)].sort(), ['a', 'b'])
})

test('resolving members also closes over the endpoints dependencies', () => {
  const graph = role({
    members: ['c'],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ],
  })
  assert.deepEqual([...resolvedMembers(graph)].sort(), ['a', 'b', 'c'])
})

test('planRole treats an orphan edge source as a member to add', () => {
  const graph = role({ members: ['b'], edges: [{ from: 'a', to: 'b' }] })
  const plan = planRole(graph, repo('a', 'b'))
  assert.deepEqual(plan.toAdd, ['a'])
  assert.deepEqual(plan.members.sort(), ['a', 'b'])
})
test('an edge implied by a longer path is reported as redundant', () => {
  const graph = role({
    members: ['a'],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'a', to: 'c' },
    ],
  })
  assert.deepEqual(findRedundantEdges(graph).map(edge => `${edge.from}->${edge.to}`), ['a->c'])
})

test('a plain chain has no redundant edges', () => {
  const graph = role({ members: ['a'], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] })
  assert.deepEqual(findRedundantEdges(graph), [])
})

test('redundancy is reported as info, never as an error', () => {
  const graph = role({
    members: ['a', 'b', 'c'],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'a', to: 'c' }],
  })
  const issues = validateRole(graph, repo('a', 'b', 'c'))
  assert.ok(issues.some(issue => issue.code === 'redundant-edge' && issue.severity === 'info'))
  assert.ok(!issues.some(issue => issue.severity === 'error'))
})
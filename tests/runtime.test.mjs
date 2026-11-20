import assert from 'node:assert/strict'
import test from 'node:test'

import { installRole } from '../src/runtime.js'

const repo = map => new Map(Object.entries(map).map(([name, value]) => [name, value]))

function fakeSkills() {
  const registrations = new Map()
  return {
    registrations,
    register(definition) {
      if (registrations.has(definition.name)) return () => {}
      registrations.set(definition.name, definition)
      return () => registrations.delete(definition.name)
    },
  }
}

function fakeSystemPrompt() {
  const sections = []
  return {
    sections,
    section(entry) {
      sections.push(entry)
      return () => {
        const at = sections.indexOf(entry)
        if (at >= 0) sections.splice(at, 1)
      }
    },
  }
}

const role = (overrides = {}) => ({
  id: '3f2a6c1e-9b4d-4e21-8a77-1c5b0d9e4f60',
  name: '审阅',
  members: ['a'],
  edges: [],
  conflicts: [],
  ...overrides,
})

const install = overrides => installRole({
  skills: overrides.skills ?? fakeSkills(),
  systemPrompt: overrides.systemPrompt ?? fakeSystemPrompt(),
  scope: 'agent',
  role: overrides.role ?? role(),
  repo: overrides.repo ?? repo({ a: { description: 'A' }, b: { description: 'B' }, c: { description: 'C' } }),
  definitions: overrides.definitions ?? new Map(),
  personaSection: overrides.personaSection,
})

test('every skill outside the runtime set is shadowed, and nothing else is', () => {
  const skills = fakeSkills()
  const generation = install({ skills })
  assert.deepEqual(generation.runtime, ['a'])
  assert.deepEqual(generation.shadowed.sort(), ['b', 'c'])
  assert.deepEqual([...skills.registrations.keys()].sort(), ['b', 'c'])
})

test('a shadow keeps the original body but turns both invocation flags off', () => {
  const skills = fakeSkills()
  const definitions = new Map([['b', { name: 'b', description: 'B skill', content: 'the whole body' }]])
  install({ skills, definitions })
  const shadow = skills.registrations.get('b')
  assert.equal(shadow.description, 'B skill')
  assert.equal(shadow.content, 'the whole body')
  assert.deepEqual(shadow.invocation, { modelInvocable: false, userInvocable: false })
  assert.equal(shadow.provider, 'skill-loom')
})

test('a skill with no description still gets a non-empty one', () => {
  const skills = fakeSkills()
  install({ skills, repo: repo({ a: { description: 'A' }, d: {} }) })
  assert.ok(skills.registrations.get('d').description.length > 0)
})

test('dispose removes every shadow it registered', () => {
  const skills = fakeSkills()
  const generation = install({ skills })
  assert.equal(skills.registrations.size, 2)
  generation.dispose()
  assert.equal(skills.registrations.size, 0)
})

test('a role with a persona registers exactly one prompt section', () => {
  const systemPrompt = fakeSystemPrompt()
  const generation = install({
    systemPrompt,
    role: role({ persona: { prefix: 'You review code.' } }),
    personaSection: { name: 'deployment:persona-prefix', order: 0 },
  })
  assert.equal(generation.persona, true)
  assert.deepEqual(systemPrompt.sections, [{ name: 'deployment:persona-prefix', order: 0, text: 'You review code.' }])
})

test('a role without a persona registers no section', () => {
  const systemPrompt = fakeSystemPrompt()
  const generation = install({ systemPrompt })
  assert.equal(generation.persona, false)
  assert.deepEqual(systemPrompt.sections, [])
})

test('a missing runtime skill is not shadowed and does not break the install', () => {
  const skills = fakeSkills()
  const generation = install({
    skills,
    role: role({ members: ['a', 'gone'] }),
  })
  assert.deepEqual(generation.runtime, ['a'])
  assert.deepEqual(generation.shadowed.sort(), ['b', 'c'])
})

test('a role that excludes a missing skill still yields the same shadows', () => {
  const skills = fakeSkills()
  install({ skills, repo: repo({ a: { description: 'A' } }), role: role({ members: [] }) })
  assert.deepEqual([...skills.registrations.keys()], ['a'])
})

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import * as module from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('live edits refresh the bound agent and an unsuccessful bind preserves its role', {
  skip: typeof module.registerHooks !== 'function',
}, async t => {
  const hooks = module.registerHooks({
    resolve(specifier, context, next) {
      if (specifier === '@deepseek-ai/dsh-tools') {
        return { url: 'data:text/javascript,export const defineTool = tool => tool', shortCircuit: true }
      }
      if (specifier === '@deepseek-ai/dsh-system-prompt') {
        return { url: 'data:text/javascript,export const PERSONA_PREFIX_SECTION = "persona"', shortCircuit: true }
      }
      return next(specifier, context)
    },
  })
  const { apply } = await import('../src/index.js').finally(() => hooks.deregister())
  const rolesDir = await mkdtemp(join(tmpdir(), 'skill-loom-host-'))
  t.after(() => rm(rolesDir, { recursive: true, force: true }))
  const tools = new Map()
  const events = new Map()
  const sections = new Set()
  const shadows = new Set()
  const skill = { name: 'review', description: 'Review documents' }
  let failPreparation = false
  let rejectShadow = false
  const skills = {
    list: () => [skill],
    get: () => skill,
    register(definition) {
      if (rejectShadow) throw new Error('registry unavailable')
      shadows.add(definition.name)
      return () => shadows.delete(definition.name)
    },
  }
  const systemPrompt = {
    getSectionOrder: () => 0,
    section({ text }) {
      sections.add(text)
      return () => sections.delete(text)
    },
  }
  const agent = {
    ctx: { get: name => ({ skills, systemPrompt })[name] },
    session: { header: { id: 'test-session' } },
  }
  let cleanup
  apply({
    tools: { register: tool => tools.set(tool.name, tool) },
    skills,
    systemPrompt,
    workingDirectory: {
      ensure: () => {
        if (failPreparation) throw new Error('working directory unavailable')
        return rolesDir
      },
    },
    agents: { list: () => [agent], get: () => agent },
    inject() {},
    on: (name, listener) => events.set(name, listener),
    effect: callback => { cleanup = callback() },
  }, { rolesDir })
  t.after(cleanup)
  const run = args => tools.get('role_graph').execute(args, { agent })
  const first = (await run({ action: 'create', name: 'First', persona: 'first', add: ['review'] })).result.role
  const second = (await run({ action: 'create', name: 'Second', persona: 'second' })).result.role
  await run({ action: 'bind', role: first.id })
  await run({ action: 'set_persona', role: first.id, persona: 'updated' })
  assert.deepEqual([...sections], ['updated'])
  assert.deepEqual([...shadows], [])

  rejectShadow = true
  await assert.rejects(run({ action: 'bind', role: second.id }), /registry unavailable/)
  assert.deepEqual([...sections], ['updated'])
  rejectShadow = false
  await mkdir(join(rolesDir, 'bindings.json.tmp'))
  await assert.rejects(run({ action: 'bind', role: second.id }), /EISDIR|EPERM|EACCES/)
  assert.deepEqual([...sections], ['updated'])
  assert.deepEqual([...shadows], [])

  failPreparation = true
  // An unscoped edit can save even when the bound agent cannot prepare.
  await tools.get('role_graph').execute({
    action: 'set_persona', role: first.id, persona: 'saved',
  }, {})
  assert.deepEqual([...sections], ['updated'])
  failPreparation = false
  events.get('agent/disposed')({ agent })
  const resumed = { ...agent }
  await events.get('agent/created')({ agent: resumed })
  assert.deepEqual([...sections], ['saved'])
})

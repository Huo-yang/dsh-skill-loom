import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import * as module from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Readable } from 'node:stream'

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
  const packagedSkills = new Map()
  const skill = { name: 'review', description: 'Review documents' }
  let failPreparation = false
  let rejectShadow = false
  const catalog = [skill]
  const skills = {
    list: () => catalog,
    get: () => skill,
    register(definition) {
      if (definition.invocation?.modelInvocable !== false) {
        packagedSkills.set(definition.name, definition)
        return () => packagedSkills.delete(definition.name)
      }
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
  let webHandler
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
    inject(_services, register) {
      register({
        effect: callback => callback(),
        webServer: { register: route => { webHandler = route.handler } },
      })
    },
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

  const request = async (url, payload, expectedStatus = 200) => {
    const req = Object.assign(Readable.from(payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))]), {
      url: '/skill-loom' + url, method: payload === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' },
    })
    let body
    const res = { setHeader() {}, end(chunk) { body = JSON.parse(chunk) } }
    await webHandler(req, res)
    assert.equal(res.statusCode, expectedStatus, JSON.stringify(body))
    return body
  }
  const post = request
  catalog.push({ name: 'format' })
  await t.test('role graph previews do not persist or refresh the bound agent', async () => {
    catalog.push({ name: 'proof' })
    const role = (await run({ action: 'show', role: first.id })).result.role
    const route = '/roles/' + role.id
    const graph = {
      action: 'set_graph', expectedRevision: role.revision,
      members: ['proof', 'format'], edges: [{ from: 'proof', to: 'format' }],
    }
    const { result: { result: preview } } = await post(route + '/graph', { ...graph, preview: true })
    assert.deepEqual(preview.role.members, graph.members)
    assert.deepEqual(preview.role.edges, graph.edges)
    assert.equal(preview.role.revision, role.revision)
    assert.deepEqual((await run({ action: 'show', role: role.id })).result.role, role)
    assert.deepEqual([...shadows], [])

    const { result: { result: saved } } = await post(route + '/graph', graph)
    assert.equal(saved.role.revision, role.revision + 1)
    assert.equal(saved.role.persona.prefix, role.persona.prefix)
    assert.deepEqual(saved.role.edges, graph.edges)
    assert.deepEqual([...shadows], ['review'])
    await post(route + '/graph', graph, 409)
    await post(route + '/graph', {
      ...graph, preview: true, expectedRevision: saved.role.revision,
      edges: [...graph.edges, { from: 'format', to: 'proof' }],
    }, 400)
    assert.deepEqual((await run({ action: 'show', role: role.id })).result.role, saved.role)
  })

  await t.test('one undo restores the entire graph after a family insertion', async () => {
    const { result: family } = await post('/families', {
      action: 'create', name: 'Document review',
      graph: { members: ['review', 'format'], edges: [{ from: 'review', to: 'format' }] },
    })
    const route = '/roles/' + second.id
    const inserted = await post(route + '/families', {
      familyId: family.id, familyRevision: family.revision, expectedRevision: second.revision,
    })
    const saved = inserted.result.result.role
    assert.deepEqual(saved.members, ['review', 'format'])
    assert.deepEqual(saved.edges, [{ from: 'review', to: 'format' }])

    const undone = await post(route + '/history', { action: 'undo', expectedRevision: saved.revision })
    assert.deepEqual(undone.role.members, second.members)
    assert.deepEqual(undone.role.edges, second.edges)
    assert.equal(undone.history.undo, 0)
  })

  await t.test('the bundled skills can compose a family and queue review for the calling session', async () => {
    const familyTool = args => tools.get('role_family').execute(args, { agent })
    const preset = (await familyTool({ action: 'show', family: 'builtin-role-orchestration' })).family
    assert.deepEqual(preset.members, ['skill-loom-orchestrate', 'skill-loom-review'])
    for (const name of preset.members) {
      const skill = packagedSkills.get(name)
      assert.equal(skill.source, 'bundled')
      assert.equal(skill.invocation.modelInvocable, true)
    }
    assert.match(packagedSkills.get('skill-loom-review').content, /role_review/)
    const created = (await familyTool({
      action: 'create', name: 'Review helper', members: ['review', 'format'],
      edges: [{ from: 'review', to: 'format', why: 'Review uses the formatter report' }],
    })).family
    await assert.rejects(familyTool({ action: 'update', family: created.id, revision: 0, name: 'Stale' }),
      { name: 'RoleConflictError' })
    const updated = (await familyTool({
      action: 'update', family: created.id, revision: created.revision, description: 'Review formatted documents.',
    })).family
    const { result: applied } = await familyTool({ action: 'apply', family: updated.id, role: second.id })
    assert.deepEqual(applied.role.members, ['review', 'format'])
    assert.deepEqual(applied.role.edges, updated.edges)
    const review = await tools.get('role_review').execute({ family: updated.id }, { agent })
    assert.equal(review.queued, true)
    assert.deepEqual(await request('/sessions/review?session=other-session'), { request: null })
    const { request: pending } = await request('/sessions/review?session=test-session')
    assert.equal(pending.familyId, updated.id)
    assert.ok(pending.ticket)
  })
})

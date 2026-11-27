import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
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
  await t.test('registered role tool and Web create preserve optional descriptions through disk and readback', async () => {
    const created = (await run({ action: 'create', name: 'Described tool role', description: '  Review\n documents  ' })).result.role
    assert.equal(created.description, 'Review documents')
    assert.equal((await run({ action: 'show', role: created.id })).result.role.description, created.description)
    assert.equal((await run({ action: 'list' })).result.find(r => r.id === created.id).description, created.description)
    assert.equal((await request('/roles')).roles.find(r => r.id === created.id).description, created.description)
    assert.equal(JSON.parse(await readFile(join(rolesDir, created.id + '.json'), 'utf8')).description, created.description)
    const web = await post('/roles', { name: 'Described Web role', description: '  Web   description ' })
    assert.equal(web.role.description, 'Web description')
    await run({ action: 'set_description', role: web.role.id, description: 'Updated description', expectedRevision: web.role.revision })
    await assert.rejects(run({ action: 'set_description', role: web.role.id, description: 'Stale overwrite', expectedRevision: web.role.revision }), /changed since it was read/)
    await run({ action: 'set_description', role: web.role.id, description: 'Web description' })
    assert.equal((await run({ action: 'show', role: web.role.id })).result.role.description, 'Web description')
    const legacy = (await run({ action: 'create', name: 'Legacy tool role' })).result.role
    assert.equal(Object.hasOwn(legacy, 'description'), false)
    assert.equal(Object.hasOwn((await post('/roles', { name: 'Legacy Web role' })).role, 'description'), false)
    await assert.rejects(run({ action: 'create', name: 'Bad description', description: 42 }), /INVALID_DESCRIPTION/)
    await assert.rejects(run({ action: 'create', name: 'Long description', description: 'x'.repeat(161) }), /INVALID_DESCRIPTION/)
    assert.equal((await post('/roles', { name: 'Bad Web description', description: 42 }, 400)).code, 'INVALID_DESCRIPTION')
  })
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

  await t.test('tool and HTTP retirement reject saved references and do not consume rejected undo/redo', async () => {
    catalog.push({ name: 'retirement-test', description: 'Synthetic retirement target' })
    const lifecycle = args => tools.get('skill_retirement').execute(args)
    const role = (await run({ action: 'create', name: 'Retirement history', add: ['retirement-test'] })).result.role
    const before = await lifecycle({ action: 'inspect', name: 'retirement-test' })
    assert.equal((await post('/skills', { action: 'retire', name: 'retirement-test', confirm: true, revision: before.revision }, 400)).code, 'SKILL_REFERENCED')
    await assert.rejects(lifecycle({ action: 'retire', name: 'retirement-test', confirm: true, revision: before.revision }), { code: 'SKILL_REFERENCED' })
    const clean = (await run({ action: 'remove_members', role: role.id, remove: ['retirement-test'] })).result.role
    const state = await request('/skills')
    await lifecycle({ action: 'retire', name: 'retirement-test', confirm: true, revision: state.revision })
    const route = '/roles/' + role.id
    const historyBefore = (await request(route)).history
    await post(route + '/history', { action: 'undo', expectedRevision: clean.revision }, 400)
    assert.deepEqual((await request(route)).history, historyBefore)
    assert.deepEqual((await request(route)).role.members, [])
    const fresh = await lifecycle({ action: 'inspect', name: 'retirement-test' })
    await post('/skills', { action: 'restore', name: 'retirement-test', confirm: true, revision: fresh.revision })
    const undone = await post(route + '/history', { action: 'undo', expectedRevision: clean.revision })
    const redone = await post(route + '/history', { action: 'redo', expectedRevision: undone.role.revision })
    const retiredAgain = await lifecycle({ action: 'inspect', name: 'retirement-test' })
    await lifecycle({ action: 'retire', name: 'retirement-test', confirm: true, revision: retiredAgain.revision })
    await post(route + '/history', { action: 'undo', expectedRevision: redone.role.revision }, 400)
    assert.deepEqual((await request(route)).history, redone.history)
    await lifecycle({ action: 'restore', name: 'retirement-test', confirm: true, revision: (await lifecycle({ action: 'inspect', name: 'retirement-test' })).revision })
    const added = (await run({ action: 'add_members', role: role.id, add: ['retirement-test'] })).result.role
    const cleanUndo = await post(route + '/history', { action: 'undo', expectedRevision: added.revision })
    await lifecycle({ action: 'retire', name: 'retirement-test', confirm: true, revision: (await lifecycle({ action: 'inspect', name: 'retirement-test' })).revision })
    await post(route + '/history', { action: 'redo', expectedRevision: cleanUndo.role.revision }, 400)
    assert.deepEqual((await request(route)).history, cleanUndo.history)

  })

  await t.test('registered family delete requires an exact ID, explicit confirmation and caller revision', async t => {
    const familyTool = args => tools.get('role_family').execute(args, { agent })
    catalog.push({ name: 'delete-family-synthetic', description: 'Synthetic deletion dependency' })
    const created = (await familyTool({ action: 'create', name: 'Delete test template', members: ['delete-family-synthetic'], edges: [] })).family
    const role = (await run({ action: 'create', name: 'Applied template remains' })).result.role
    await familyTool({ action: 'apply', family: created.id, role: role.id })
    const applied = (await run({ action: 'show', role: role.id })).result.role
    const base = { action: 'delete', family: created.id, confirm: true, revision: created.revision }
    for (const [name, overrides, error] of [
      ['missing ID', { family: undefined }, { code: 'FAMILY_ID_REQUIRED' }],
      ['display name', { family: created.name }, { code: 'FAMILY_ID_REQUIRED' }],
      ['missing confirmation', { confirm: undefined }, { code: 'FAMILY_CONFIRM' }],
      ['false confirmation', { confirm: false }, { code: 'FAMILY_CONFIRM' }],
      ['string confirmation', { confirm: 'true' }, { code: 'FAMILY_CONFIRM' }],
      ...[undefined, 0, -1, 1.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(value => ['bad revision ' + String(value), { revision: value }, { code: 'FAMILY_REVISION' }]),
      ['stale revision', { revision: created.revision + 1 }, { name: 'RoleConflictError' }],
      ['builtin', { family: 'builtin-role-orchestration', revision: 1 }, { code: 'FAMILY_BUILTIN' }],
      ['absent ID', { family: '11111111-1111-4111-8111-111111111111' }, { code: 'FAMILY_NOT_FOUND' }],
    ]) await t.test(name, async () => {
      await assert.rejects(familyTool({ ...base, ...overrides }), error)
      assert.deepEqual((await familyTool({ action: 'show', family: created.id })).family, created)
      assert.deepEqual((await run({ action: 'show', role: role.id })).result.role, applied)
    })
    // A Web edit invalidates the model's reviewed revision; no implicit refresh.
    const { result: updated } = await post('/families', { action: 'update', id: created.id, expectedRevision: created.revision, name: created.name, description: 'Changed on Web' })
    await assert.rejects(familyTool(base), { name: 'RoleConflictError' })
    await post('/families', { action: 'delete', id: created.id, expectedRevision: created.revision }, 409)
    assert.equal((await post('/families', { action: 'delete', id: 'builtin-role-orchestration', expectedRevision: 1 }, 400)).code, 'FAMILY_BUILTIN')
    const deleted = await familyTool({ ...base, revision: updated.revision })
    assert.deepEqual(deleted, { deleted: { id: created.id }, scope: 'family-template-only', preserved: ['skill files', 'graphs already applied to roles'] })
    assert.equal((await familyTool({ action: 'list' })).families.some(f => f.id === created.id), false)
    assert.deepEqual((await run({ action: 'show', role: role.id })).result.role, applied)
    await assert.rejects(familyTool({ ...base, revision: updated.revision }), { code: 'FAMILY_NOT_FOUND' })
    const lifecycle = args => tools.get('skill_retirement').execute(args)
    const status = await lifecycle({ action: 'inspect', name: 'delete-family-synthetic' })
    assert.ok(status.skill.references.some(ref => ref.kind === 'role' && ref.id === role.id))
    assert.equal(status.skill.references.some(ref => ref.kind === 'family' && ref.id === created.id), false)
    await assert.rejects(lifecycle({ action: 'retire', name: 'delete-family-synthetic', revision: status.revision, confirm: true }), { code: 'SKILL_REFERENCED' })
    const webFamily = (await familyTool({ action: 'create', name: 'Web delete parity', members: ['review'], edges: [] })).family
    assert.deepEqual((await post('/families', { action: 'delete', id: webFamily.id, expectedRevision: webFamily.revision })).result, { id: webFamily.id })
    await assert.rejects(familyTool({ ...base, family: webFamily.id, revision: webFamily.revision }), { code: 'FAMILY_NOT_FOUND' })
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

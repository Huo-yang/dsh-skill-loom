import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import * as module from 'node:module'
import test from 'node:test'

test('last missing reference: partial failure, plugin restart, Web/tool refusal, lossless rollback and explicit retry', {
  skip: typeof module.registerHooks !== 'function',
}, async t => {
  const hooks = module.registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: 'data:text/javascript,export const defineTool = t => t', shortCircuit: true }
    if (specifier === '@deepseek-ai/dsh-system-prompt') return { url: 'data:text/javascript,export const PERSONA_PREFIX_SECTION = "persona"', shortCircuit: true }
    if (specifier === 'node:fs/promises' && context.parentURL?.endsWith('/src/retirement.js')) return {
      shortCircuit: true,
      url: 'data:text/javascript,' + encodeURIComponent(`export * from 'node:fs/promises'; import * as fs from 'node:fs/promises'; export async function rename(a,b) { if (globalThis.__loomFailMetadata === b) { globalThis.__loomFailMetadata = undefined; throw Object.assign(new Error('synthetic metadata failure'), {code:'EIO'}); } return fs.rename(a,b); }`),
    }
    return next(specifier, context)
  } })
  const { apply } = await import('../src/index.js').finally(() => hooks.deregister())
  const directory = await mkdtemp(join(tmpdir(), 'loom-restart-recovery-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let catalog = [{ name: 'last-missing-skill', path: join(directory, 'absent-SKILL.md') }]
  function mount() {
    const tools = new Map(), cleanups = []
    let web
    apply({
      tools: { register: tool => tools.set(tool.name, tool) },
      skills: { list: async () => catalog, register: () => () => {}, get: () => undefined },
      agents: { list: () => [] }, systemPrompt: {}, workingDirectory: { ensure: () => directory },
      on: () => () => {}, effect: fn => { const dispose = fn(); if (typeof dispose === 'function') cleanups.push(dispose) },
      inject: (_services, fn) => fn({ effect: fn => fn(), webServer: { register: route => { web = route.handler } } }),
    }, { rolesDir: directory })
    return { tools, dispose: () => cleanups.forEach(fn => fn()), async request(payload) {
      const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(payload))]), { url: '/skill-loom/skills', method: 'POST', headers: { 'content-type': 'application/json' } })
      let body
      const res = { setHeader() {}, end(value) { body = JSON.parse(value) } }
      await web(req, res)
      return { status: res.statusCode, body }
    } }
  }
  let host = mount()
  const run = (name, args) => host.tools.get(name).execute(args, {})
  const created = (await run('role_graph', { action: 'create', name: 'Only saved reference', add: ['last-missing-skill'] })).result.role
  catalog = []
  const before = await run('skill_retirement', { action: 'inspect', name: 'last-missing-skill' })
  assert.equal(before.skill.availability, 'missing')
  assert.equal(before.skill.references.length, 1)
  const graphFile = join(directory, created.id + '.json'), metadataFile = join(directory, 'skill-retirement.json')
  const graphBytes = await readFile(graphFile, 'utf8'), metadataBytes = await readFile(metadataFile, 'utf8')
  globalThis.__loomFailMetadata = metadataFile
  await assert.rejects(run('role_graph', { action: 'remove_members', role: created.id, remove: ['last-missing-skill'], expectedRevision: created.revision }), /RETIREMENT_UNCERTAIN/)
  assert.deepEqual(JSON.parse(await readFile(graphFile, 'utf8')).members, [])
  host.dispose(); host = mount() // reconstruct plugin and all stores
  const retire = { action: 'retire', name: 'last-missing-skill', revision: before.revision, confirm: true }
  await assert.rejects(run('skill_retirement', retire), { code: 'RETIREMENT_UNCERTAIN' })
  const response = await host.request(retire)
  assert.equal(response.status, 400)
  assert.equal(response.body.code, 'RETIREMENT_UNCERTAIN')
  await assert.rejects(run('role_graph', { action: 'show', role: created.id }), /RETIREMENT_UNCERTAIN/)
  host.dispose()
  // Documented operator rollback, applied ONLY to this synthetic directory:
  // keep copies, restore exact pre-write bytes, then clear the marker last.
  const markerFile = join(directory, '.skill-loom-pending-write.json')
  await copyFile(markerFile, join(directory, 'pending.backup'))
  await copyFile(graphFile, join(directory, 'partial-graph.backup'))
  await copyFile(metadataFile, join(directory, 'metadata.backup'))
  const marker = JSON.parse(await readFile(markerFile, 'utf8'))
  assert.equal(marker.graphFile, graphFile)
  assert.equal(marker.previousGraph, graphBytes)
  assert.equal(marker.previousMetadata, metadataBytes)
  await writeFile(graphFile, marker.previousGraph)
  await writeFile(metadataFile, marker.previousMetadata)
  assert.equal(await readFile(graphFile, 'utf8'), graphBytes)
  assert.equal(await readFile(metadataFile, 'utf8'), metadataBytes)
  await rm(markerFile)
  host = mount()
  await assert.rejects(run('skill_retirement', { ...retire, revision: (await run('skill_retirement', { action: 'inspect', name: 'last-missing-skill' })).revision }), { code: 'SKILL_REFERENCED' })
  await run('role_graph', { action: 'remove_members', role: created.id, remove: ['last-missing-skill'], expectedRevision: created.revision })
  host.dispose(); host = mount()
  const clean = await run('skill_retirement', { action: 'inspect', name: 'last-missing-skill' })
  assert.equal(clean.skill.availability, 'missing')
  assert.deepEqual(clean.skill.references, [])
  assert.equal((await host.request({ ...retire, revision: clean.revision })).status, 200)
  host.dispose(); host = mount()
  assert.equal((await run('skill_retirement', { action: 'inspect', name: 'last-missing-skill' })).skill.retired, true)
  host.dispose()
})

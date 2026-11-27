/** Loom-only retirement. Never deletes or modifies provider skill files. */
import { mkdir, readFile, readdir, rename, rm, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { RoleGraphError, removeMembers } from './api.js'
import { referencedNames, validateRoleId } from './graph.js'
import { RoleConflictError } from './store.js'

const protectedNames = new Set(['skill-loom-orchestrate', 'skill-loom-review'])
const fail = (code, message, details) => { throw new RoleGraphError(code, message, details) }
const namesOf = graph => [...referencedNames(graph)]
const metadata = skill => Object.fromEntries(['name', 'description', 'source', 'provider', 'path']
  .filter(key => typeof skill?.[key] === 'string').map(key => [key, skill[key]]))

export function createRetirement({ directory, stores, builtins = [], catalog }) {
  const file = join(directory, 'skill-retirement.json')
  const lock = join(directory, '.skill-loom-write-lock')
  const pending = join(directory, '.skill-loom-pending-write.json')
  const observed = new Map()
  async function state() {
    let value
    try { value = JSON.parse(await readFile(file, 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') return { schema: 1, known: {}, retired: {} }; throw error }
    if (value?.schema !== 1 || !value.known || !value.retired
      || typeof value.known !== 'object' || typeof value.retired !== 'object'
      || Array.isArray(value.known) || Array.isArray(value.retired)
      || Object.entries(value.retired).some(([name, flag]) => flag !== true || !Object.hasOwn(value.known, name))) fail('RETIREMENT_UNCERTAIN', 'Cannot verify retirement state; no changes made.')
    return value
  }
  async function graphs(store) {
    let entries
    try { entries = await readdir(store.directory) }
    catch (error) { if (error.code === 'ENOENT') return []; throw error }
    if (entries.some(entry => /\.json\.corrupt-/.test(entry))) fail('RETIREMENT_UNCERTAIN', 'A quarantined graph requires review; retirement is blocked.')
    const result = []
    for (const entry of entries.sort()) {
      if (!entry.endsWith('.json') || !validateRoleId(entry.slice(0, -5)).ok) continue
      const graph = JSON.parse(await readFile(join(store.directory, entry), 'utf8'))
      if (graph?.id !== entry.slice(0, -5) || typeof graph.name !== 'string'
        || (graph.schema !== undefined && graph.schema !== 1)
        || (graph.members !== undefined && (!Array.isArray(graph.members) || !graph.members.every(n => typeof n === 'string' && n.trim())))
        || (graph.edges !== undefined && (!Array.isArray(graph.edges) || !graph.edges.every(e => typeof e?.from === 'string' && e.from.trim() && typeof e?.to === 'string' && e.to.trim())))
        || (graph.conflicts !== undefined && (!Array.isArray(graph.conflicts) || !graph.conflicts.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(n => typeof n === 'string' && n.trim()))))) {
        fail('RETIREMENT_UNCERTAIN', 'Cannot verify saved graph references; no changes made.')
      }
      result.push({ ...graph, members: graph.members ?? [], edges: graph.edges ?? [] })
    }
    return result
  }
  async function assertComplete() {
    try { await stat(pending) }
    catch (error) { if (error.code === 'ENOENT') return; throw error }
    fail('RETIREMENT_UNCERTAIN', 'An incomplete graph/metadata write requires review. No references can be confirmed; do not retire skills or remove the marker without reconciling both files.')
  }
  async function graphWrite(store, id, data, operation) {
    const graphFile = store.fileOf(id)
    const bytes = async () => {
      try { return await readFile(graphFile, 'utf8') }
      catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
    }
    const before = await bytes()
    let previousMetadata = null
    try { previousMetadata = await readFile(file, 'utf8') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    await writeFile(pending, JSON.stringify({ schema: 1, graphFile, previousGraph: before ?? null, previousMetadata, intendedMetadata: data }) + '\n', { flag: 'wx', mode: 0o600 })
    try {
      const result = await operation()
      await persist(data)
      await rm(pending)
      return result
    } catch (error) {
      // An ordinary validation/revision failure can be cleared only when the
      // graph is provably byte-identical. Partial/uncertain writes stay blocked.
      let unchanged = false
      try { unchanged = await bytes() === before } catch {}
      if (unchanged) { await rm(pending); throw error }
      fail('RETIREMENT_UNCERTAIN', 'Graph/metadata write did not finish. Reload is blocked pending review; no successful cleanup is confirmed.')
    }
  }
  async function snapshot() {
    await assertComplete()
    const data = await state()
    const groups = []
    for (const { kind, store } of stores) for (const graph of await graphs(store)) groups.push({ kind, graph })
    for (const graph of builtins) groups.push({ kind: 'family', graph })
    const revision = createHash('sha256').update(JSON.stringify([data, groups])).digest('hex')
    return { data, groups, revision }
  }
  async function withLock(work) {
    await mkdir(directory, { recursive: true })
    try { await mkdir(lock) }
    catch (error) { if (error.code === 'EEXIST') fail('RETIREMENT_BUSY', 'Another Loom write is active. Refresh and retry; do not remove an active lock.'); throw error }
    try { return await work() } finally { await rm(lock, { recursive: true }) }
  }
  async function persist(data) {
    const temp = file + '.' + randomUUID() + '.tmp'
    try { await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); await rename(temp, file) }
    finally { await rm(temp, { force: true }) }
  }
  async function available() {
    try {
      const repo = await catalog()
      for (const [name, skill] of repo) observed.set(name, metadata({ ...skill, name }))
      return { repo, complete: true }
    } catch { return { repo: new Map(), complete: false } }
  }
  function known(data, groups, repo) {
    const all = new Map(Object.entries(data.known))
    for (const [name, skill] of observed) all.set(name, skill)
    for (const { graph } of groups) for (const name of namesOf(graph)) {
      if (!all.has(name)) all.set(name, { name, ...metadata(graph.anchors?.[name]) })
    }
    for (const [name, skill] of repo) all.set(name, metadata({ ...skill, name }))
    return all
  }
  function references(groups, name) {
    return groups.filter(({ graph }) => namesOf(graph).includes(name)).map(({ kind, graph }) => {
      // One shortest path per reachable consumer avoids exponential path output.
      const paths = []
      for (const start of namesOf(graph)) {
        const queue = [[start]], seen = new Set()
        while (queue.length) {
          const path = queue.shift(), last = path.at(-1)
          if (seen.has(last)) continue
          seen.add(last)
          if (last === name) { paths.push(path); break }
          for (const edge of graph.edges ?? []) if (edge.from === last) queue.push([...path, edge.to])
        }
      }
      return { kind, id: graph.id, name: graph.name, builtin: !!graph.builtin, paths,
        conflicts: (graph.conflicts ?? []).filter(pair => pair.includes(name)) }
    })
  }
  async function availability(name, skill, repo, complete) {
    if (!complete) return 'unknown'
    if (repo.has(name)) return 'available'
    if (!skill.path) return 'unresolved'
    try { await stat(skill.path); return 'unresolved' }
    catch (error) { return error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 'missing' : 'unknown' }
  }
  async function list() {
    const { data, groups, revision } = await snapshot()
    const { repo, complete } = await available()
    return { revision, scope: 'Loom only; provider files and other applications are unchanged.', skills: await Promise.all([...known(data, groups, repo)].map(async ([name, skill]) => ({
      ...skill, name, retired: Object.hasOwn(data.retired, name),
      availability: await availability(name, skill, repo, complete),
      protected: protectedNames.has(name), references: references(groups, name),
    }))) }
  }
  async function handle(input = {}) {
    if (input.action === 'help') return { actions: ['help', 'list', 'inspect', 'propose', 'retire', 'restore'],
      notes: ['Read/list/inspect/propose never write. Propose only suggests cleanup; it does not edit graphs.',
        'retire/restore require an explicit user request, confirm=true and the latest revision from list/inspect.',
        'Clean references explicitly in each named graph and save first. Restore before reintroducing a retired name.',
        'Retirement is name-based across all same-name providers in Loom only. Directory reappearance does not restore it.',
        'The two built-in management skills cannot be retired. Unknown names are rejected.'] }
    if (['list', 'inspect', 'propose'].includes(input.action)) {
      const result = await list()
      if (input.action === 'list') return result
      const skill = result.skills.find(s => s.name === input.name)
      if (!skill) fail('SKILL_UNKNOWN', 'This skill name has not been observed or referenced.')
      const { groups, revision } = await snapshot()
      if (revision !== result.revision) fail('RETIREMENT_STALE', 'Saved graphs changed; inspect again.')
      return { revision, skill, proposal: skill.references.map(ref => {
        const graph = groups.find(group => group.kind === ref.kind && group.graph.id === ref.id).graph
        const draft = removeMembers(graph, [input.name])
        return { ...ref, expectedRevision: graph.revision, draft,
          removedEdges: (graph.edges ?? []).filter(edge => !draft.edges.includes(edge)),
          removedConflicts: (graph.conflicts ?? []).filter(pair => !draft.conflicts.includes(pair)),
          instruction: 'Read-only proposal. Review incident edges/conflicts and affected consumers; explicitly confirm graph edits before saving. Built-in families are immutable; custom families must remain valid. No automatic cleanup.' }
      }) }
    }
    if (!['retire', 'restore'].includes(input.action)) fail('RETIREMENT_ACTION', 'Use help, list, inspect, propose, retire or restore.')
    if (input.confirm !== true || typeof input.revision !== 'string') fail('RETIREMENT_CONFIRM', 'Explicit confirmation and a current revision are required.')
    return withLock(async () => {
      const { data, groups, revision } = await snapshot()
      if (revision !== input.revision) fail('RETIREMENT_STALE', 'Saved graphs or retirement state changed; inspect again.')
      const { repo, complete } = await available()
      const all = known(data, groups, repo)
      if (!all.has(input.name)) fail('SKILL_UNKNOWN', 'Unknown name; nothing was recorded.')
      if (protectedNames.has(input.name)) fail('SKILL_PROTECTED', 'Built-in Loom management skills cannot be retired.')
      const refs = references(groups, input.name)
      if (input.action === 'retire' && refs.length) fail('SKILL_REFERENCED', 'Clean and save the named graphs before retiring this skill.', { references: refs })
      if (input.action === 'retire' && await availability(input.name, all.get(input.name), repo, complete) === 'unknown') fail('RETIREMENT_UNCERTAIN', 'The catalog could not be verified; retry after it is available.')
      if (input.action === 'retire' && Object.hasOwn(data.retired, input.name)
        || input.action === 'restore' && !Object.hasOwn(data.retired, input.name)) return { changed: false }
      data.known = Object.fromEntries(all)
      if (input.action === 'retire') Object.defineProperty(data.retired, input.name, { value: true, enumerable: true, configurable: true, writable: true })
      else delete data.retired[input.name]
      await persist(data)
      return { changed: true, name: input.name, retired: input.action === 'retire', scope: 'Loom only' }
    })
  }
  for (const { store } of stores) {
    // The underlying store may read during its own write. Keep those internal
    // reads separate from public reads, which must reject a pending transaction.
    const raw = Object.create(store)
    raw.readAll = () => graphs(store)
    raw.read = async id => (await graphs(store)).find(graph => graph.id === id)
    const save = store.save.bind(raw), remove = store.remove.bind(raw)
    // Strict reads neither create directories nor quarantine/ignore malformed data.
    store.readAll = async () => { await assertComplete(); return graphs(store) }
    store.read = async id => {
      await assertComplete()
      if (!validateRoleId(id).ok) fail('INVALID_ID', 'Invalid graph ID.')
      return (await graphs(store)).find(graph => graph.id === id)
    }
    store.save = (graph, options) => withLock(async () => {
      const { data, groups } = await snapshot()
      const forbidden = namesOf(graph).filter(name => Object.hasOwn(data.retired, name))
      if (forbidden.length) fail('SKILL_RETIRED', 'Restore these skills before saving references.', { names: forbidden })
      const { repo } = await available()
      const all = known(data, [...groups, { graph }], repo)
      data.known = Object.fromEntries(all)
      return graphWrite(store, graph.id, data, () => save(graph, options))
    })
    store.remove = (id, options = {}) => withLock(async () => {
      const { data, groups } = await snapshot()
      const current = await store.read(id)
      if (options.expectedRevision !== undefined && current?.revision !== options.expectedRevision) {
        throw new RoleConflictError(id, options.expectedRevision, current?.revision)
      }
      const { repo } = await available()
      data.known = Object.fromEntries(known(data, groups, repo))
      if (!current) return false
      return graphWrite(store, id, data, () => remove(id))
    })
  }
  return { list, handle }
}

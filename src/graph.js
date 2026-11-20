/**
 * Pure role-graph logic: no DSH imports, no I/O, no side effects.
 *
 * A role graph is the whole orchestration state of one role:
 *   { id, name, members: string[], edges: [{from, to, why}], conflicts: [[a, b]] }
 *
 * Invariants this module maintains:
 *   - `members` is the root set of the DAG; every edge endpoint must belong to
 *     the closure of `members` (missing ones are auto-fill candidates).
 *   - `conflicts` is symmetric, hence stored as pairs rather than directed edges.
 *   - Nothing here decides *how* the graph is persisted; that is the store's job.
 *
 * @module dsh-skill-loom/graph
 */

/** Role ids become file names, so the character set is deliberately narrow. */
export const ROLE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Longest accepted display name, in characters. */
export const ROLE_NAME_MAX_LENGTH = 64

/**
 * Whether a value is shaped like a UUID.
 *
 * Deliberately version-agnostic (v4 today, v7 later) so a future id scheme does
 * not invalidate existing files.
 * @param {unknown} id - candidate id.
 * @returns {{ ok: true, reason?: undefined } | { ok: false, reason: string }} verdict.
 */
export function validateRoleId(id) {
  if (typeof id !== 'string') return { ok: false, reason: 'not-a-string' }
  if (id.length === 0) return { ok: false, reason: 'empty' }
  if (!ROLE_ID_PATTERN.test(id)) return { ok: false, reason: 'pattern' }
  return { ok: true }
}

/**
 * Mint a new role id.
 *
 * A role id is the storage key and the file name, so it never derives from the
 * display name: renaming a role must not move its file or invalidate session
 * bindings.
 * @param {() => string} [generate] - id source, injectable for tests.
 * @returns {string} a new role id.
 */
export function newRoleId(generate = () => globalThis.crypto.randomUUID()) {
  const id = generate()
  if (!validateRoleId(id).ok) throw new TypeError(`role id generator produced an invalid id: ${String(id)}`)
  return id
}

/**
 * Validate a role display name.
 *
 * Names are free-form text (any script, emoji allowed) with no path or file-name
 * constraints, because they never touch the filesystem.
 * @param {unknown} name - candidate display name.
 * @returns {{ ok: true, reason?: undefined } | { ok: false, reason: string }} verdict.
 */
export function validateRoleName(name) {
  if (typeof name !== 'string') return { ok: false, reason: 'not-a-string' }
  if (name.trim() === '') return { ok: false, reason: 'empty' }
  if (name !== name.trim()) return { ok: false, reason: 'surrounding-whitespace' }
  if (name.length > ROLE_NAME_MAX_LENGTH) return { ok: false, reason: 'too-long' }
  if (/[\u0000-\u001f\u007f]/.test(name)) return { ok: false, reason: 'control-character' }
  return { ok: true }
}

/** Case-insensitive comparison key for a display name. */
export function roleNameKey(name) {
  return String(name ?? '').trim().toLocaleLowerCase()
}

/**
 * Whether another role already uses this display name.
 *
 * Names must be unique so a name can address a role; ids stay the durable key.
 * @param {Array<{ id: string, name: string }>} roles - existing roles.
 * @param {string} name - candidate name.
 * @param {string} [exceptId] - role being renamed, excluded from the check.
 * @returns {boolean} whether the name is taken.
 */
export function isRoleNameTaken(roles, name, exceptId) {
  const key = roleNameKey(name)
  return (roles ?? []).some(role => role.id !== exceptId && roleNameKey(role.name) === key)
}

/**
 * Record where each referenced skill resolved from, at save time.
 *
 * Skills are installed into several roots (project, custom, user, bundled) or
 * supplied by a provider with no file at all, so a name alone cannot answer
 * "which copy did this role mean" after a reinstall. The anchor answers that,
 * but it is **advisory only**: resolution always goes through the skill name.
 * Anchors are machine-specific and must be stripped on export.
 * @param {object} role - role graph.
 * @param {Map<string, object> | Iterable<string>} repository - available skills.
 * @returns {Record<string, { path?: string, source?: string, provider?: string }>} anchors.
 */
export function captureAnchors(role, repository) {
  const index = normalizeRepository(repository)
  const anchors = {}
  for (const name of referencedNames(role)) {
    const entry = index.get(name)
    if (entry === undefined) continue
    const anchor = {}
    if (typeof entry.path === 'string') anchor.path = entry.path
    if (typeof entry.source === 'string') anchor.source = entry.source
    if (typeof entry.provider === 'string') anchor.provider = entry.provider
    if (Object.keys(anchor).length > 0) anchors[name] = anchor
  }
  return anchors
}

/**
 * Compare recorded anchors with the current repository.
 *
 * Only resolved skills are compared: a skill that vanished is red, not drift.
 * @param {object} role - role graph.
 * @param {Map<string, object> | Iterable<string>} repository - available skills.
 * @returns {Array<{ name: string, kind: 'path-changed' | 'source-changed', from: string, to: string }>} drift.
 */
export function detectAnchorDrift(role, repository) {
  const index = normalizeRepository(repository)
  const anchors = role?.anchors ?? {}
  const drift = []
  for (const [name, anchor] of Object.entries(anchors)) {
    const entry = index.get(name)
    if (entry === undefined) continue
    if (typeof anchor?.path === 'string' && typeof entry.path === 'string' && anchor.path !== entry.path) {
      drift.push({ name, kind: 'path-changed', from: anchor.path, to: entry.path })
    }
    if (typeof anchor?.source === 'string' && typeof entry.source === 'string' && anchor.source !== entry.source) {
      drift.push({ name, kind: 'source-changed', from: anchor.source, to: entry.source })
    }
  }
  return drift
}

/**
 * Explain every red node using its anchor.
 *
 * The name decides availability; the anchor only decides *why* it is gone. Three
 * outcomes, deliberately kept apart:
 *
 * - `missing` — the name does not resolve and the anchored file is gone too.
 * - `unloaded` — the name does not resolve but the file is still on disk: the
 *   skill root moved, or frontmatter made the provider drop it. Red, but a very
 *   different repair.
 * - `unconfirmed` — nothing to check against (virtual provider skill, or a role
 *   saved before anchors existed). Never reported as missing on a guess.
 * @param {object} role - role graph.
 * @param {Map<string, object> | Iterable<string>} repository - available skills.
 * @param {(path: string) => boolean} [exists] - filesystem probe; omit to disable confirmation.
 * @returns {{ missing: Array<{name: string, path: string}>, unloaded: Array<{name: string, path: string}>, unconfirmed: string[] }}
 */
export function explainMissing(role, repository, exists) {
  const index = normalizeRepository(repository)
  const anchors = role?.anchors ?? {}
  const red = [...requiresClosure(role)].filter(name => !index.has(name))
  const missing = []
  const unloaded = []
  const unconfirmed = []
  for (const name of red) {
    const path = anchors[name]?.path
    if (typeof path !== 'string' || typeof exists !== 'function') {
      unconfirmed.push(name)
      continue
    }
    if (exists(path)) unloaded.push({ name, path })
    else missing.push({ name, path })
  }
  return { missing, unloaded, unconfirmed }
}

/** Normalize the repository view into a name -> { description } map. */
function normalizeRepository(repository) {
  if (repository instanceof Map) {
    const index = new Map()
    for (const [name, value] of repository) {
      index.set(name, value !== null && typeof value === 'object' ? value : {})
    }
    return index
  }
  const index = new Map()
  for (const name of repository ?? []) index.set(name, {})
  return index
}

/** Build the adjacency map of `requires` edges. */
function requiresMap(role) {
  const map = new Map()
  for (const edge of role?.edges ?? []) {
    if (typeof edge?.from !== 'string' || typeof edge?.to !== 'string') continue
    const targets = map.get(edge.from) ?? new Set()
    targets.add(edge.to)
    map.set(edge.from, targets)
  }
  return map
}

/**
 * Every skill name the graph mentions, in first-seen order.
 * @param {object} role - role graph.
 * @returns {string[]} referenced names.
 */
export function referencedNames(role) {
  const names = new Set()
  for (const member of role?.members ?? []) names.add(member)
  for (const edge of role?.edges ?? []) {
    if (typeof edge?.from === 'string') names.add(edge.from)
    if (typeof edge?.to === 'string') names.add(edge.to)
  }
  for (const pair of role?.conflicts ?? []) {
    for (const name of pair ?? []) if (typeof name === 'string') names.add(name)
  }
  return [...names]
}

/**
 * Transitive closure of `requires` starting from `roots`.
 * @param {object} role - role graph.
 * @param {Iterable<string>} [roots] - defaults to the role's members.
 * @returns {Set<string>} roots plus everything they require, transitively.
 */
export function requiresClosure(role, roots) {
  const requires = requiresMap(role)
  const start = roots === undefined ? role?.members ?? [] : roots
  const seen = new Set()
  const queue = [...start]
  while (queue.length > 0) {
    const node = queue.shift()
    if (seen.has(node)) continue
    seen.add(node)
    for (const next of requires.get(node) ?? []) {
      if (!seen.has(next)) queue.push(next)
    }
  }
  return seen
}

/**
 * Find cycles among `requires` edges.
 *
 * A cycle makes the graph invalid: it has no topological order, so neither the
 * layout nor the load order is well defined.
 * @param {object} role - role graph.
 * @returns {string[][]} one path per cycle, first node repeated at the end.
 */
export function findCycles(role) {
  const requires = requiresMap(role)
  const state = new Map()
  const stack = []
  const cycles = []

  const visit = node => {
    state.set(node, 1)
    stack.push(node)
    for (const next of requires.get(node) ?? []) {
      const seen = state.get(next) ?? 0
      if (seen === 1) {
        const at = stack.indexOf(next)
        cycles.push([...stack.slice(at), next])
      } else if (seen === 0) {
        visit(next)
      }
    }
    stack.pop()
    state.set(node, 2)
  }

  for (const node of requires.keys()) {
    if ((state.get(node) ?? 0) === 0) visit(node)
  }
  return cycles
}

/**
 * Topological level of each reachable node, relative to this role's members.
 *
 * This is a *layout and load-order* metric only. It never affects runtime
 * behaviour, and it is deliberately not called `depth`: the host already has a
 * delegation-depth concept that means something unrelated.
 * @param {object} role - role graph.
 * @returns {Map<string, number>} level per node; leaves are 0.
 */
export function topoLevels(role) {
  const requires = requiresMap(role)
  const levels = new Map()
  const visiting = new Set()

  const levelOf = node => {
    if (levels.has(node)) return levels.get(node)
    if (visiting.has(node)) return 0 // cycle guard; cycles are reported separately
    visiting.add(node)
    let level = 0
    for (const next of requires.get(node) ?? []) {
      level = Math.max(level, levelOf(next) + 1)
    }
    visiting.delete(node)
    levels.set(node, level)
    return level
  }

  for (const node of requiresClosure(role)) levelOf(node)
  return levels
}

/**
 * Resolve a role against the repository.
 *
 * Three states, and the rule that ties them together:
 *
 * - **red** — the graph references it but the repository cannot resolve it.
 * - **gray** — it exists, but something it depends on is red or gray. A gray
 *   skill is *effectively missing*: its premise is gone, so it is excluded
 *   together with the red nodes it descends from ("连坐").
 * - **runtime** — the closure minus red and gray; this is what a session sees.
 *
 * Invariant: gray is derived from red, so no red means no gray. A gray row
 * always carries the path that reaches the red node.
 * @param {object} role - role graph.
 * @param {Map<string, object> | Iterable<string>} repository - available skills.
 * @returns {{ runtime: string[], red: string[], gray: Array<{ name: string, path: string[] }> }}
 */
export function computeHealth(role, repository) {
  const index = normalizeRepository(repository)
  const requires = requiresMap(role)
  // A saved role carries the whole closure in `members`; using the closure here
  // makes the same function answer "what would the runtime see" for an unsaved
  // draft too.
  const scope = requiresClosure(role)

  const red = [...scope].filter(name => !index.has(name))
  const redSet = new Set(red)

  const dependents = new Map()
  for (const [from, targets] of requires) {
    for (const target of targets) {
      const list = dependents.get(target) ?? []
      list.push(from)
      dependents.set(target, list)
    }
  }

  const gray = new Map()
  const visited = new Set(red)
  const queue = red.map(name => [name])
  while (queue.length > 0) {
    const path = queue.shift()
    // A path is [dependent, ...pathToRed], so the node being expanded is its head.
    const node = path[0]
    for (const dependent of dependents.get(node) ?? []) {
      if (visited.has(dependent)) continue
      visited.add(dependent)
      const nextPath = [dependent, ...path]
      gray.set(dependent, nextPath)
      queue.push(nextPath)
    }
  }

  if (gray.size > 0 && red.length === 0) {
    throw new Error('invariant violated: gray without red')
  }

  const runtime = [...scope].filter(name => !redSet.has(name) && !gray.has(name))
  return {
    runtime,
    red,
    gray: [...gray].map(([name, path]) => ({ name, path })),
  }
}

/**
 * Validate a role graph.
 *
 * Severities:
 *   - `error`   — must not be written to disk.
 *   - `warning` — allowed, but the writer must surface it.
 *   - `info`    — a change the save pipeline will apply automatically.
 * @param {object} role - role graph.
 * @param {Map<string, object> | Iterable<string>} repository - available skills.
 * @param {{ source?: 'agent' | 'human' }} [options] - who is writing.
 * @returns {Array<{ code: string, severity: 'error' | 'warning' | 'info', message: string }>}
 */
export function validateRole(role, repository, options = {}) {
  const source = options.source ?? 'human'
  const index = normalizeRepository(repository)
  const issues = []

  const id = validateRoleId(role?.id)
  if (!id.ok) {
    issues.push({ code: 'invalid-id', severity: 'error', message: `role id is not a UUID (${id.reason})` })
  }

  const name = validateRoleName(role?.name)
  if (!name.ok) {
    issues.push({ code: 'invalid-name', severity: 'error', message: `role display name is invalid (${name.reason})` })
  }

  const cycles = findCycles(role)
  for (const cycle of cycles) {
    issues.push({ code: 'cycle', severity: 'error', message: `requires cycle: ${cycle.join(' -> ')}` })
  }

  const closure = requiresClosure(role)
  const members = new Set(role?.members ?? [])
  const exists = options.exists
  const anchors = role?.anchors ?? {}

  for (const name of closure) {
    if (index.has(name)) {
      if (!members.has(name)) {
        issues.push({ code: 'auto-fill', severity: 'info', message: `"${name}" is required but not a member; it will be added` })
      }
      continue
    }
    const path = anchors[name]?.path
    if (typeof path === 'string' && typeof exists === 'function') {
      if (exists(path)) {
        issues.push({ code: 'missing-but-present', severity: 'warning', message: `"${name}" does not resolve but its file is still on disk at ${path}; check the skill roots or its frontmatter` })
      } else {
        issues.push({ code: 'missing-confirmed', severity: 'warning', message: `"${name}" no longer exists at ${path}` })
      }
      continue
    }
    issues.push({ code: 'unresolved-dependency', severity: 'warning', message: `"${name}" is absent from the repository; it renders red and its dependents gray` })
  }

  const conflictPairs = []
  for (const pair of role?.conflicts ?? []) {
    if (!Array.isArray(pair) || pair.length !== 2) continue
    const [a, b] = pair
    if (typeof a !== 'string' || typeof b !== 'string') continue
    conflictPairs.push([a, b])
    if (!closure.has(a) || !closure.has(b)) continue
    issues.push({ code: 'conflict', severity: 'error', message: `"${a}" and "${b}" conflict but are both reachable` })
  }

  for (const item of detectAnchorDrift(role, index)) {
    const detail = item.kind === 'path-changed'
      ? `moved from ${item.from} to ${item.to}`
      : `now resolves from source ${item.to} instead of ${item.from}`
    issues.push({ code: 'anchor-drift', severity: 'warning', message: `"${item.name}" ${detail}` })
  }

  if (source === 'agent') {
    for (const edge of role?.edges ?? []) {
      if (typeof edge?.why === 'string' && edge.why.trim() !== '') continue
      issues.push({ code: 'missing-why', severity: 'error', message: `agent-created edge ${String(edge?.from)} -> ${String(edge?.to)} must carry a "why"` })
    }
  }

  const seen = new Set()
  return issues.filter(issue => {
    const key = `${issue.code}\u0000${issue.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Dry-run a role: everything a save would do, without writing.
 * @param {object} role - role graph.
 * @param {Map<string, object> | Iterable<string>} repository - available skills.
 * @param {{ source?: 'agent' | 'human' }} [options] - who is planning.
 * @returns {object} plan summary.
 */
export function planRole(role, repository, options = {}) {
  const index = normalizeRepository(repository)
  const members = [...new Set(role?.members ?? [])]
  const closure = requiresClosure(role)
  const health = computeHealth(role, index)
  const levels = topoLevels(role)

  let catalogChars = 0
  for (const name of health.runtime) {
    const entry = index.get(name) ?? {}
    catalogChars += name.length + (typeof entry.description === 'string' ? entry.description.length : 0)
  }

  return {
    members,
    closure: [...closure],
    toAdd: [...closure].filter(name => !members.includes(name)),
    ...health,
    cycles: findCycles(role),
    anchors: captureAnchors(role, index),
    drift: detectAnchorDrift(role, index),
    missing: explainMissing(role, index, options.exists),
    levels: Object.fromEntries([...levels].sort(([a], [b]) => a.localeCompare(b))),
    catalogChars,
    issues: validateRole(role, index, options),
  }
}

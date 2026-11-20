/**
 * Action layer for the `role_graph` tool.
 *
 * Deliberately free of DSH imports: the host wiring lives in `index.js`, and
 * everything here is exercised in tests against a fake store and a fake skill
 * repository.
 *
 * @module dsh-skill-loom/api
 */

import {
  captureAnchors,
  explainMissing,
  isRoleNameTaken,
  newRoleId,
  planRole,
  requiresClosure,
  roleNameKey,
  validateRole,
  validateRoleName,
} from './graph.js'

/** A failure the caller can act on, as opposed to a bug or an I/O error. */
export class RoleGraphError extends Error {
  /**
   * @param {string} code - stable machine code.
   * @param {string} message - actionable message for the model.
   * @param {unknown} [details] - extra structured context.
   */
  constructor(code, message, details) {
    super(message)
    this.name = 'RoleGraphError'
    this.code = code
    this.details = details
  }
}

const ACTIONS = [
  'help', 'list', 'show', 'plan',
  'create', 'set_name', 'set_persona',
  'add_members', 'remove_members',
  'link', 'unlink', 'duplicate', 'bind', 'unbind',
]

const HELP = {
  actions: ACTIONS,
  notes: [
    'role accepts a role UUID or its display name.',
    'plan computes without writing; create/set_*/add_members/remove_members/link/unlink/duplicate write.',
    'Agent-created edges must carry a why (<= 80 chars).',
    'A save fills members with the whole requires closure and records skill anchors.',
    'Deleting a role is not available here; it is a UI-only action.',
    'bind attaches the current session to a role; unbind returns it to native behaviour.',
  ],
}

/**
 * Build the action handler.
 * @param {object} deps - injected collaborators.
 * @param {{ readAll: Function, read: Function, save: Function }} deps.store - role store.
 * @param {(cwd?: string) => Promise<Array<object>>} deps.listSkills - global skill catalog.
 * @param {(path: string) => boolean} [deps.exists] - filesystem probe for anchors.
 * @param {() => string} [deps.generateId] - id source.
 * @returns {{ handle: (input: object, context?: object) => Promise<object> }} the api.
 */
export function createRoleGraphApi(deps) {
  const { store, listSkills, exists, generateId = newRoleId } = deps
  if (typeof store?.readAll !== 'function' || typeof store?.save !== 'function') {
    throw new TypeError('createRoleGraphApi requires a role store')
  }
  if (typeof listSkills !== 'function') throw new TypeError('createRoleGraphApi requires listSkills')

  async function repository(context) {
    // The catalog is the union the host decides to expose; this layer only
    // indexes it by skill name.
    const skills = await listSkills(context)
    return new Map(skills.map(skill => [skill.name, skill]))
  }

  async function load(ref) {
    if (typeof ref !== 'string' || ref.trim() === '') {
      throw new RoleGraphError('ROLE_REQUIRED', 'this action needs a role (UUID or display name)')
    }
    const all = await store.readAll()
    const byId = all.find(role => role.id === ref)
    if (byId !== undefined) return byId
    const key = roleNameKey(ref)
    const byName = all.filter(role => roleNameKey(role.name) === key)
    if (byName.length === 1) return byName[0]
    if (byName.length === 0) {
      const known = all.map(role => role.name).sort()
      throw new RoleGraphError(
        'ROLE_NOT_FOUND',
        known.length === 0
          ? `no roles exist yet; create one first with action="create"`
          : `no role named "${ref}"; known roles: ${known.join(', ')}`,
      )
    }
    throw new RoleGraphError('ROLE_AMBIGUOUS', `several roles are named "${ref}"; address it by UUID`)
  }

  function summarize(role, repo) {
    const plan = planRole(role, repo, { exists })
    return {
      id: role.id,
      name: role.name,
      members: role.members?.length ?? 0,
      runtime: plan.runtime.length,
      red: plan.red,
      gray: plan.gray.map(row => row.name),
      issues: plan.issues.filter(issue => issue.severity !== 'info'),
    }
  }

  /** Validate, auto-fill, anchor, then persist. */
  async function persist(role, repo, options = {}) {
    // The caller states who is writing: an agent must justify every edge, a
    // human editing through the page does not (D11).
    const issues = validateRole(role, repo, { source: options.source ?? 'agent', exists })
    const errors = issues.filter(issue => issue.severity === 'error')
    if (errors.length > 0) {
      throw new RoleGraphError('VALIDATION_FAILED', 'the role was not saved because it is invalid', { issues: errors })
    }
    const others = (await store.readAll()).filter(existing => existing.id !== role.id)
    if (isRoleNameTaken(others, role.name)) {
      throw new RoleGraphError('DUPLICATE_NAME', `another role is already named "${role.name}"`)
    }
    const filled = {
      ...role,
      members: [...requiresClosure(role)],
      anchors: captureAnchors(role, repo),
    }
    const saved = await store.save(filled, { expectedRevision: options.expectedRevision })
    return {
      role: saved,
      plan: planRole(saved, repo, { exists }),
      issues: issues.filter(issue => issue.severity !== 'info'),
    }
  }

  async function handle(input = {}, context = {}) {
    const action = input.action
    if (!ACTIONS.includes(action)) {
      throw new RoleGraphError('UNKNOWN_ACTION', `unknown action "${String(action)}"; use action="help"`)
    }
    if (action === 'help') return { ok: true, action, result: HELP }

    if (action === 'bind') {
      if (typeof context.bindSession !== 'function') {
        throw new RoleGraphError('NOT_AVAILABLE', 'this host cannot bind a session to a role')
      }
      const selected = await load(input.role)
      const bound = await context.bindSession(selected)
      return { ok: true, action, result: bound }
    }

    if (action === 'unbind') {
      if (typeof context.clearSession !== 'function') {
        throw new RoleGraphError('NOT_AVAILABLE', 'this host cannot unbind a session')
      }
      const cleared = await context.clearSession()
      return { ok: true, action, result: { cleared } }
    }

    if (action === 'plan') {
      const repo = await repository(context)
      const base = input.role === undefined
        ? { id: generateId(), name: 'draft', members: [], edges: [], conflicts: [] }
        : await load(input.role)
      const draft = {
        ...base,
        ...(Array.isArray(input.add) ? { members: [...new Set([...(base.members ?? []), ...input.add])] } : {}),
        ...(Array.isArray(input.remove)
          ? { members: (base.members ?? []).filter(name => !input.remove.includes(name)) }
          : {}),
      }
      const plan = planRole(draft, repo, { exists })
      return { ok: true, action, result: { ...plan, missing: explainMissing(draft, repo, exists) } }
    }

    const repo = await repository(context)

    if (action === 'list') {
      const roles = await store.readAll()
      return { ok: true, action, result: roles.map(role => summarize(role, repo)) }
    }

    if (action === 'create') {
      const name = input.name
      const verdict = validateRoleName(name)
      if (!verdict.ok) throw new RoleGraphError('INVALID_NAME', `role name is invalid (${verdict.reason})`)
      const role = {
        schema: 1,
        id: generateId(),
        name,
        persona: typeof input.persona === 'string' ? { prefix: input.persona } : undefined,
        members: Array.isArray(input.add) ? [...new Set(input.add)] : [],
        edges: [],
        conflicts: [],
      }
      if (role.persona === undefined) delete role.persona
      const saved = await persist(role, repo)
      return { ok: true, action, result: saved }
    }

    const current = await load(input.role)

    if (action === 'show') {
      const plan = planRole(current, repo, { exists })
      return {
        ok: true,
        action,
        result: { role: current, plan: { ...plan, missing: explainMissing(current, repo, exists) } },
      }
    }

    let next = { ...current }
    switch (action) {
      case 'set_name': {
        const verdict = validateRoleName(input.name)
        if (!verdict.ok) throw new RoleGraphError('INVALID_NAME', `role name is invalid (${verdict.reason})`)
        next.name = input.name
        break
      }
      case 'set_persona': {
        if (typeof input.persona !== 'string') throw new RoleGraphError('INVALID_PERSONA', 'persona must be a string')
        next.persona = { ...(next.persona ?? {}), prefix: input.persona }
        break
      }
      case 'add_members': {
        if (!Array.isArray(input.add) || input.add.length === 0) {
          throw new RoleGraphError('INVALID_MEMBERS', 'add_members needs a non-empty "add" array')
        }
        next.members = [...new Set([...(next.members ?? []), ...input.add])]
        break
      }
      case 'remove_members': {
        if (!Array.isArray(input.remove) || input.remove.length === 0) {
          throw new RoleGraphError('INVALID_MEMBERS', 'remove_members needs a non-empty "remove" array')
        }
        const drop = new Set(input.remove)
        next.members = (next.members ?? []).filter(name => !drop.has(name))
        next.edges = (next.edges ?? []).filter(edge => !drop.has(edge.from) && !drop.has(edge.to))
        break
      }
      case 'link': {
        if (typeof input.from !== 'string' || typeof input.to !== 'string') {
          throw new RoleGraphError('INVALID_EDGE', 'link needs both "from" and "to"')
        }
        if (input.from === input.to) throw new RoleGraphError('INVALID_EDGE', 'a skill cannot require itself')
        // Only an agent must justify an edge (D11); a person drawing one in the
        // page is not forced to write a sentence for every line.
        const why = typeof input.why === 'string' ? input.why.trim() : ''
        if (why === '' && (context.source ?? 'agent') === 'agent') {
          throw new RoleGraphError('MISSING_WHY', 'an agent-created edge must explain why it exists')
        }
        if (why.length > 80) throw new RoleGraphError('WHY_TOO_LONG', 'why must be 80 characters or fewer')
        const edges = (next.edges ?? []).filter(edge => !(edge.from === input.from && edge.to === input.to))
        edges.push({ from: input.from, to: input.to, ...(why === '' ? {} : { why }) })
        next.edges = edges
        break
      }
      case 'unlink': {
        if (typeof input.from !== 'string' || typeof input.to !== 'string') {
          throw new RoleGraphError('INVALID_EDGE', 'unlink needs both "from" and "to"')
        }
        const before = next.edges?.length ?? 0
        next.edges = (next.edges ?? []).filter(edge => !(edge.from === input.from && edge.to === input.to))
        if ((next.edges.length ?? 0) === before) {
          throw new RoleGraphError('EDGE_NOT_FOUND', `no edge from "${input.from}" to "${input.to}"`)
        }
        break
      }
      case 'duplicate': {
        const verdict = validateRoleName(input.name)
        if (!verdict.ok) throw new RoleGraphError('INVALID_NAME', `role name is invalid (${verdict.reason})`)
        next = {
          ...current,
          id: generateId(),
          name: input.name,
          revision: undefined,
        }
        delete next.revision
        break
      }
      default:
        throw new RoleGraphError('UNKNOWN_ACTION', `unknown action "${action}"`)
    }

    const saved = await persist(next, repo, { expectedRevision: context.expectedRevision, source: context.source })
    return { ok: true, action, result: saved }
  }

  return { handle, resolve: load }
}

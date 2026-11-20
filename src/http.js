/**
 * Read-only HTTP surface, plus the one write action the page needs.
 *
 * The route lives outside `/plugins/*` on purpose: that namespace belongs to the
 * client module bundles, and a prefix registered there can be shadowed by it.
 *
 * The page is a root-scope panel with no session binding, so it cannot ask for
 * "this agent's" skill view. The orchestration view is therefore the union of
 * the global layer and every live agent's scope — a superset of what any single
 * session sees, which is what an editor wants: it must not report a
 * preset-mounted skill as missing just because no agent is answering.
 *
 * @module dsh-skill-loom/http
 */

import { computeHealth, explainMissing, planRole } from './graph.js'

/** Prefix every route lives under. */
export const ROUTE_PREFIX = '/skill-loom'

/** Largest accepted write body. */
export const MAX_BODY_BYTES = 64 * 1024

/** The only actions the browser may perform, per route. */
const MEMBER_ACTIONS = new Set(['add_members', 'remove_members'])
const FIELD_ACTIONS = new Set(['set_name', 'set_persona'])
const EDGE_ACTIONS = new Set(['link', 'unlink', 'reparent'])

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})

/**
 * Reject a cross-origin write.
 *
 * Browsers attach `Origin` to a POST; a page on another origin must never be
 * able to edit this profile. A request without `Origin` is a local tool (curl,
 * tests) and is allowed; the literal string `null` is a sandboxed frame and is
 * not.
 * @param {Request} request - incoming request.
 * @returns {boolean} whether the origin is acceptable.
 */
export function isLocalOrigin(request) {
  const origin = request.headers.get('origin')
  if (origin === null) return true
  if (origin === 'null') return false
  try {
    const { hostname } = new URL(origin)
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
  } catch {
    return false
  }
}

/** Summarize one role for the list view. */
function summarize(role, repo, exists) {
  const plan = planRole(role, repo, { exists })
  return {
    id: role.id,
    name: role.name,
    icon: role.icon,
    persona: typeof role.persona?.prefix === 'string' ? role.persona.prefix : undefined,
    members: role.members ?? [],
    edges: role.edges ?? [],
    conflicts: role.conflicts ?? [],
    revision: role.revision,
    runtime: plan.runtime,
    red: plan.red,
    gray: plan.gray.map(row => row.name),
    levels: plan.levels,
    catalogChars: plan.catalogChars,
    issues: plan.issues,
  }
}

/**
 * Build the route resource.
 * @param {object} deps - injected seams.
 * @param {{ readAll: Function, read: Function }} deps.store - role store.
 * @param {() => Promise<Map<string, object>>} deps.catalog - orchestration view.
 * @param {(path: string) => boolean} [deps.exists] - anchor probe.
 * @param {(input: object) => Promise<object>} [deps.mutate] - action dispatch (agent action layer).
 * @returns {(request: Request) => Promise<Response>} the resource.
 */
export function createResource({ store, catalog, exists, mutate, sessions }) {
  async function readBody(request) {
    const declared = Number(request.headers.get('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { tooLarge: true }
    const text = await request.text()
    if (text.length > MAX_BODY_BYTES) return { tooLarge: true }
    try {
      return { value: JSON.parse(text) }
    } catch {
      return { invalid: true }
    }
  }

  async function write(request, id, allowed) {
    if (typeof mutate !== 'function') return json({ error: 'read-only' }, 405)
    if (!isLocalOrigin(request)) return json({ error: 'cross-origin' }, 403)

    const body = await readBody(request)
    if (body.tooLarge === true) return json({ error: 'body-too-large' }, 413)
    if (body.invalid === true) return json({ error: 'invalid-json' }, 400)

    const input = body.value
    if (input === null || typeof input !== 'object') return json({ error: 'invalid-body' }, 400)
    const action = input.action
    if (!allowed.has(action)) return json({ error: 'action-not-allowed' }, 400)

    try {
      const expectedRevision = typeof input.expectedRevision === 'number' ? input.expectedRevision : undefined
      let payload
      if (MEMBER_ACTIONS.has(action)) {
        payload = {
          action,
          role: id,
          add: Array.isArray(input.add) ? input.add : undefined,
          remove: Array.isArray(input.remove) ? input.remove : undefined,
          expectedRevision,
        }
      } else if (FIELD_ACTIONS.has(action)) {
        payload = { action, role: id, name: input.name, persona: input.persona, expectedRevision }
      } else {
        payload = {
          action,
          role: id,
          from: typeof input.from === 'string' ? input.from : undefined,
          to: typeof input.to === 'string' ? input.to : undefined,
          why: typeof input.why === 'string' ? input.why : undefined,
          expectedRevision,
        }
      }
      const result = await mutate(payload)
      return json({ ok: true, result })
    } catch (error) {
      if (error?.name === 'RoleConflictError') {
        const current = await store.read(id)
        return json({ error: 'conflict', current }, 409)
      }
      if (error?.name === 'RoleGraphError' || typeof error?.code === 'string') {
        return json({ error: 'rejected', code: error.code, message: error.message }, 400)
      }
      return json({ error: 'internal', message: String(error?.message ?? error) }, 500)
    }
  }

  return async function resource(request) {
    const method = request.method
    if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
      return json({ error: 'method-not-allowed' }, 405)
    }
    const url = new URL(request.url)
    const path = url.pathname
    if (path !== ROUTE_PREFIX && !path.startsWith(`${ROUTE_PREFIX}/`)) return json({ error: 'not-found' }, 404)
    const rest = path.slice(ROUTE_PREFIX.length).replace(/^\//, '')

    try {
      const repo = await catalog()

      if (rest === '' || rest === 'roles') {
        if (method === 'POST') {
          if (typeof mutate !== 'function') return json({ error: 'read-only' }, 405)
          if (!isLocalOrigin(request)) return json({ error: 'cross-origin' }, 403)
          const body = await readBody(request)
          if (body.tooLarge === true) return json({ error: 'body-too-large' }, 413)
          if (body.invalid === true) return json({ error: 'invalid-json' }, 400)
          const name = typeof body.value?.name === 'string' ? body.value.name.trim() : ''
          if (name === '') return json({ error: 'name-required' }, 400)
          const outcome = await mutate({
            action: 'create',
            name,
            add: Array.isArray(body.value.add) ? body.value.add : undefined,
          })
          return json({ ok: true, role: outcome.result.role, plan: outcome.result.plan })
        }
        const roles = await store.readAll()
        return json({
          // Exposed so the page (and a smoke test) can tell a read-only host
          // from one that accepts writes.
          writable: typeof mutate === 'function',
          roles: roles.map(role => summarize(role, repo, exists)),
          skills: [...repo.values()].map(skill => ({
            name: skill.name,
            description: skill.description,
            source: skill.source,
            provider: skill.provider,
            // Only used to hand the file to the sidebar's viewer; the page never
            // reads it and no write path accepts it back.
            path: skill.path,
          })),
        })
      }

      if (rest === 'sessions') {
        if (typeof sessions?.list !== 'function') return json({ error: 'sessions-unavailable' }, 405)
        if (method === 'POST') return json({ error: 'method-not-allowed' }, 405)
        return json({ sessions: await sessions.list() })
      }

      if (rest === 'sessions/bind' || rest === 'sessions/unbind') {
        if (method !== 'POST') return json({ error: 'method-not-allowed' }, 405)
        if (typeof sessions?.bind !== 'function') return json({ error: 'sessions-unavailable' }, 405)
        if (!isLocalOrigin(request)) return json({ error: 'cross-origin' }, 403)

        const body = await readBody(request)
        if (body.tooLarge === true) return json({ error: 'body-too-large' }, 413)
        if (body.invalid === true) return json({ error: 'invalid-json' }, 400)
        const input = body.value
        const sessionId = typeof input?.sessionId === 'string' ? input.sessionId : undefined
        if (sessionId === undefined) return json({ error: 'session-required' }, 400)

        if (rest === 'sessions/unbind') {
          return json({ ok: true, result: await sessions.unbind(sessionId) })
        }
        const roleId = typeof input.roleId === 'string' ? input.roleId : undefined
        if (roleId === undefined) return json({ error: 'role-required' }, 400)
        const role = await store.read(roleId)
        if (role === undefined) return json({ error: 'role-not-found', id: roleId }, 404)
        return json({ ok: true, result: await sessions.bind(sessionId, role) })
      }

      const memberMatch = /^roles\/([^/]+)\/members$/.exec(rest)
      if (memberMatch !== null) {
        const id = decodeURIComponent(memberMatch[1])
        if (method === 'POST') return await write(request, id, MEMBER_ACTIONS)
        return json({ error: 'method-not-allowed' }, 405)
      }

      const fieldMatch = /^roles\/([^/]+)\/fields$/.exec(rest)
      if (fieldMatch !== null) {
        const id = decodeURIComponent(fieldMatch[1])
        if (method === 'POST') return await write(request, id, FIELD_ACTIONS)
        return json({ error: 'method-not-allowed' }, 405)
      }

      const deleteMatch = /^roles\/([^/]+)\/delete$/.exec(rest)
      if (deleteMatch !== null) {
        const id = decodeURIComponent(deleteMatch[1])
        if (method !== 'POST') return json({ error: 'method-not-allowed' }, 405)
        if (!isLocalOrigin(request)) return json({ error: 'cross-origin' }, 403)
        const body = await readBody(request)
        if (body.tooLarge === true) return json({ error: 'body-too-large' }, 413)
        const role = await store.read(id)
        if (role === undefined) return json({ error: 'role-not-found', id }, 404)
        if (typeof body.value?.expectedRevision === 'number' && role.revision !== body.value.expectedRevision) {
          return json({ error: 'conflict', current: role }, 409)
        }
        await store.remove(id)
        return json({ ok: true, result: { id } })
      }

      const edgeMatch = /^roles\/([^/]+)\/edges$/.exec(rest)
      if (edgeMatch !== null) {
        const id = decodeURIComponent(edgeMatch[1])
        if (method === 'POST') return await write(request, id, EDGE_ACTIONS)
        return json({ error: 'method-not-allowed' }, 405)
      }

      if (rest.startsWith('roles/')) {
        if (method === 'POST') return json({ error: 'method-not-allowed' }, 405)
        const id = decodeURIComponent(rest.slice('roles/'.length))
        const role = await store.read(id)
        if (role === undefined) return json({ error: 'role-not-found', id }, 404)
        const plan = planRole(role, repo, { exists })
        return json({
          role,
          plan: { ...plan, missing: explainMissing(role, repo, exists) },
          health: computeHealth(role, repo),
        })
      }

      return json({ error: 'not-found' }, 404)
    } catch (error) {
      return json({ error: 'internal', message: String(error?.message ?? error) }, 500)
    }
  }
}

/**
 * Adapt a Fetch-style resource to the host's Node-style route handler.
 *
 * `WebResourceRoute` answers GET and HEAD only — the server itself returns 405
 * for anything else — so a route that must accept POST registers `handler`
 * instead and reads the body from the request stream.
 * @param {(request: Request) => Promise<Response>} resource - the fetch-style resource.
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>} handler.
 */
export function toNodeHandler(resource) {
  return async function handler(req, res) {
    const method = req.method ?? 'GET'
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue
      headers.set(key, Array.isArray(value) ? value.join(', ') : value)
    }

    let body
    if (method !== 'GET' && method !== 'HEAD') {
      const chunks = []
      let total = 0
      for await (const chunk of req) {
        total += chunk.length
        if (total > MAX_BODY_BYTES) {
          res.statusCode = 413
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'body-too-large' }))
          return
        }
        chunks.push(chunk)
      }
      body = Buffer.concat(chunks)
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const response = await resource(new Request(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
    }))
    res.statusCode = response.status
    response.headers.forEach((value, key) => res.setHeader(key, value))
    res.end(Buffer.from(await response.arrayBuffer()))
  }
}
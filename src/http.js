/**
 * Read-only HTTP surface for the Skill Loom page.
 *
 * The route lives outside `/plugins/*` on purpose: that namespace belongs to the\n * client module bundles, and a prefix registered there can be shadowed by it.\n *\n * The page is a root-scope panel with no session binding, so it cannot ask for
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

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})

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
 * @returns {(request: Request) => Promise<Response>} the resource.
 */
export function createResource({ store, catalog, exists }) {
  return async function resource(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'method-not-allowed' }, 405)
    }
    const url = new URL(request.url)
    const path = url.pathname
    if (path !== ROUTE_PREFIX && !path.startsWith(`${ROUTE_PREFIX}/`)) return json({ error: 'not-found' }, 404)
    const rest = path.slice(ROUTE_PREFIX.length).replace(/^\//, '')

    try {
      const repo = await catalog()

      if (rest === '' || rest === 'roles') {
        const roles = await store.readAll()
        return json({
          roles: roles.map(role => summarize(role, repo, exists)),
          skills: [...repo.values()].map(skill => ({
            name: skill.name,
            description: skill.description,
            source: skill.source,
            provider: skill.provider,
          })),
        })
      }

      if (rest.startsWith('roles/')) {
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

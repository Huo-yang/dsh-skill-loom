/**
 * Role resolution for a newly created agent, plus the one-shot override that
 * lets a parent choose a child's role.
 *
 * Why a registry instead of a request field: the native subagent request has no
 * hook for plugin data (`SubagentStartRequest` carries only cwd, preset, label,
 * prompt, parent, signal, agentOptions, outputSchema, maxDepth). A parent that
 * wants a different role for one child therefore registers the intent first,
 * spawns, then clears it. That is race-free because one agent's tool calls are
 * serial: no other spawn from the same parent can interleave between the three
 * steps, and the key is the parent session, so unrelated parents never collide.
 *
 * @module dsh-skill-loom/spawn
 */

/**
 * One-shot, parent-keyed role overrides.
 * @returns {{ set: Function, take: Function, clear: Function, size: Function }} registry.
 */
export function createOverrideRegistry() {
  const pending = new Map()
  return {
    /**
     * Record the role a parent's next child should use.
     * @param {string} parentSessionId - parent session.
     * @param {string} roleId - role to apply.
     */
    set(parentSessionId, roleId) {
      pending.set(parentSessionId, roleId)
    },
    /**
     * Consume the override for a parent, if any.
     * @param {string} parentSessionId - parent session.
     * @returns {string | undefined} the role id, removed from the registry.
     */
    take(parentSessionId) {
      const roleId = pending.get(parentSessionId)
      if (roleId !== undefined) pending.delete(parentSessionId)
      return roleId
    },
    /**
     * Drop an override without consuming it.
     * @param {string} parentSessionId - parent session.
     */
    clear(parentSessionId) {
      pending.delete(parentSessionId)
    },
    /** Number of pending overrides; used by tests and diagnostics. */
    size() {
      return pending.size
    },
  }
}

/**
 * Decide which role a newly created agent should run.
 *
 * Order: an explicit override wins, then the parent's binding (inheritance),
 * then the child's own binding. A candidate that no longer loads is skipped
 * rather than aborting the decision — a deleted role must not leave a child
 * without its inherited role.
 * @param {object} deps - injected seams.
 * @param {string | undefined} deps.sessionId - the new agent's session.
 * @param {string | undefined} deps.parentSession - its parent, if any.
 * @param {(parentSessionId: string) => string | undefined} deps.takeOverride - consumes an override.
 * @param {(sessionId: string) => Promise<string | undefined>} deps.boundRoleFor - binding lookup.
 * @param {(roleId: string) => Promise<object | undefined>} deps.loadRole - loads a role graph.
 * @returns {Promise<{ role: object | undefined, source: 'override' | 'inherit' | 'own' | 'none' }>} decision.
 */
export async function resolveCreatedRole({ sessionId, parentSession, takeOverride, boundRoleFor, loadRole }) {
  const load = async roleId => (roleId === undefined ? undefined : await loadRole(roleId))

  if (typeof parentSession === 'string' && parentSession !== '') {
    const override = takeOverride(parentSession)
    if (override !== undefined) {
      const role = await load(override)
      if (role !== undefined) return { role, source: 'override' }
    }
    const inherited = await load(await boundRoleFor(parentSession))
    if (inherited !== undefined) return { role: inherited, source: 'inherit' }
  }

  if (typeof sessionId === 'string' && sessionId !== '') {
    const own = await load(await boundRoleFor(sessionId))
    if (own !== undefined) return { role: own, source: 'own' }
  }

  return { role: undefined, source: 'none' }
}
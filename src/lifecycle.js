/**
 * Lifecycle helpers that must be testable without a host.
 *
 * Restoring bound roles on plugin load is not cosmetic: `agent/created` only
 * fires once per session, so after a reload the live agents never announce
 * themselves again. Without this pass, every bound session silently reverts to
 * native behaviour until it is recreated.
 *
 * @module dsh-skill-loom/lifecycle
 */

/** Session identity of an agent, tolerant of partial fakes. */
export function sessionIdOf(agent) {
  const id = agent?.session?.header?.id
  return typeof id === 'string' ? id : undefined
}

/**
 * Re-install the bound role for every live agent.
 *
 * A failure for one session must not stop the others: a role that no longer
 * parses should leave that session native, not break the plugin.
 * @param {object} deps - injected seams.
 * @param {Array<object>} deps.agents - live agents, in any order.
 * @param {(sessionId: string) => Promise<object | undefined>} deps.boundRoleFor - role lookup.
 * @param {(agent: object, sessionId: string, role: object) => Promise<unknown>} deps.installRoleFor - installer.
 * @param {(error: unknown, sessionId: string) => void} [deps.onError] - failure observer.
 * @returns {Promise<{ restored: string[], failed: string[] }>} per-session outcome.
 */
export async function restoreBoundRoles({ agents, boundRoleFor, installRoleFor, onError }) {
  const restored = []
  const failed = []
  for (const agent of agents ?? []) {
    const sessionId = sessionIdOf(agent)
    if (sessionId === undefined) continue
    const role = await boundRoleFor(sessionId)
    if (role === undefined) continue
    try {
      await installRoleFor(agent, sessionId, role)
      restored.push(sessionId)
    } catch (error) {
      failed.push(sessionId)
      onError?.(error, sessionId)
    }
  }
  return { restored, failed }
}

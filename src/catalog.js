/**
 * The orchestration view of the skill repository.
 *
 * DSH layers skills: the global provider set plus, per agent, whatever that
 * agent's preset mounts. A role editor must see all of it — never just one
 * layer — or it will report a preset-mounted skill as missing and drop its
 * anchor on the next save.
 *
 * Two callers need this and they resolve the agent differently: the HTTP read
 * path has no agent at all, and the write path (an action dispatched from the
 * page) has none either, while the agent tool path does. The rule is therefore:
 * union the global layer with every live agent scope, and additionally the
 * caller's own scope when it has one.
 *
 * @module dsh-skill-loom/catalog
 */

/**
 * Build the union view.
 * @param {object} deps - injected seams.
 * @param {(options: object) => Promise<Array<object>>} deps.list - `ctx.skills.list`.
 * @param {Iterable<object>} [deps.agents] - live agents whose scopes to include.
 * @param {object} [deps.agent] - the calling agent, if any.
 * @param {object} [deps.base] - extra lookup options, e.g. `{ cwd }`.
 * @param {(name: string) => void} [deps.onError] - scope failure observer.
 * @returns {Promise<Map<string, object>>} skills by name; the global layer wins.
 */
export async function buildCatalog({ list, agents, agent, base = {}, onError }) {
  const byName = new Map((await list(base)).map(skill => [skill.name, skill]))

  const scopes = [...(agents ?? [])]
  if (agent !== undefined) scopes.push(agent)

  for (const scope of scopes) {
    let skills
    try {
      skills = await list({ ...base, scope })
    } catch (error) {
      // A shutting-down agent must not break the view.
      onError?.(error)
      continue
    }
    for (const skill of skills) {
      // Global wins: an agent-scoped shadow must not make a real skill look absent.
      if (!byName.has(skill.name)) byName.set(skill.name, skill)
    }
  }

  return byName
}

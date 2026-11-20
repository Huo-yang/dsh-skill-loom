/**
 * Runtime installation of one role into one agent's scope.
 *
 * Everything registered through `agentCtx` applies to that agent alone and is
 * undone when the returned disposer runs, which is what makes switching roles a
 * matter of dispose-then-install.
 *
 * Two mechanisms:
 *   - **shadowing** — for every skill the role excludes, register a same-name
 *     entry with both invocation flags off. The registry's nearer layer wins, so
 *     the skill disappears from the catalog and cannot be loaded by name.
 *   - **persona** — a same-name prompt section shadowing the deployment persona.
 *
 * The original definition is copied into the shadow so nothing observes an empty
 * body if a caller bypasses the invocation check.
 *
 * @module dsh-skill-loom/runtime
 */

import { computeHealth } from './graph.js'

/**
 * Install a role into an agent scope.
 * @param {object} deps - injected host seams.
 * @param {{ register: Function, get: Function }} deps.skills - agent-scoped skill registry.
 * @param {{ section: Function }} deps.systemPrompt - agent-scoped prompt registry.
 * @param {unknown} deps.scope - the agent, used as the registry scope key.
 * @param {object} deps.role - role graph (already saved).
 * @param {Map<string, object>} deps.repo - current repository view for health.
 * @param {Map<string, object>} deps.definitions - full definitions (content) by skill name.
 * @param {{ name: string, order: number } | undefined} deps.personaSection - where to put the persona.
 * @returns {{ dispose: () => void, shadowed: string[], runtime: string[], persona: boolean }}
 */
export function installRole({ skills, systemPrompt, scope, role, repo, definitions, personaSection, strict = false }) {
  const health = computeHealth(role, repo)
  const runtime = new Set(health.runtime)
  const disposers = []
  const shadowed = []

  function dispose() {
    while (disposers.length > 0) {
      try {
        disposers.pop()()
      } catch {
        // Continue releasing the remaining registrations.
      }
    }
  }

  for (const [name, summary] of repo) {
    if (runtime.has(name)) continue
    const definition = definitions.get(name)
    const body = definition ?? summary
    const description = typeof body.description === 'string' && body.description !== ''
      ? body.description
      : `(hidden by role ${String(role?.name ?? role?.id)})`
    try {
      disposers.push(skills.register({
        name,
        description,
        content: typeof body.content === 'string' ? body.content : '',
        ...(typeof body.path === 'string' ? { path: body.path } : {}),
        ...(typeof body.whenToUse === 'string' ? { whenToUse: body.whenToUse } : {}),
        ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
        invocation: { modelInvocable: false, userInvocable: false },
        provider: 'skill-loom',
      }))
      shadowed.push(name)
    } catch (error) {
      if (strict) {
        dispose()
        throw error
      }
      // A skill that vanished between the catalog read and this registration is
      // simply not shadowed; the next rebuild picks up the settled state.
    }
  }

  const prefix = role?.persona?.prefix
  let persona = false
  if (typeof prefix === 'string' && prefix !== '' && personaSection !== undefined) {
    try {
      disposers.push(systemPrompt.section({ name: personaSection.name, order: personaSection.order, text: prefix }))
      persona = true
    } catch {
      persona = false
    }
  }

  return {
    shadowed,
    runtime: [...runtime],
    persona,
    dispose,
  }
}

/**
 * Compute the `scope` argument for a skill lookup performed on behalf of an agent.
 * Kept as a function so callers do not accidentally pass the wrong thing.
 * @param {unknown} agent - the agent.
 * @returns {unknown} the registry scope key.
 */
export function scopeOf(agent) {
  return agent
}

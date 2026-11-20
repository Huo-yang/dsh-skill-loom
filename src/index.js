/**
 * DSH host wiring for dsh-skill-loom.
 *
 * Glue only: resolve paths, connect the action layer to host services, install a
 * role into one agent's scope, and keep generations alive per session.
 *
 * Host contract used (verified against DSH 0.2.2-rc.5):
 *   ctx.skills.list({ cwd })            -> SkillSummary[] (global layer)
 *   ctx.skills.list({ cwd, scope })     -> that agent's layer
 *   ctx.skills.get(name, { scope })     -> full definition, including content
 *   agent.ctx.get('skills')             -> agent-scoped registry
 *   ctx.on('agent/created' | 'agent/disposed' | 'skills/change')
 *   ctx.tools.register(tool)
 *
 * `agent/created` is dispatched through `ctx.serial` and awaited, so the async
 * work of installing a role finishes before the agent's first step.
 *
 * @module dsh-skill-loom
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'

import { RoleGraphError, createRoleGraphApi } from './api.js'
import { computeHealth } from './graph.js'
import { BindingStore } from './bindings.js'
import { installRole } from './runtime.js'
import { RoleStore } from './store.js'

/** Cordis plugin name. */
export const name = 'skill-loom'

/** Services this plugin needs. */
export const inject = ['tools', 'skills', 'systemPrompt', 'workingDirectory', 'agents']

/** Default roles directory, honouring `DSH_HOME`. */
export function defaultRolesDir() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'roles')
}

/** Session identity of an agent. */
function sessionIdOf(agent) {
  return agent?.session?.header?.id
}

const PARAMETERS = {
  action: {
    type: 'string',
    required: true,
    description: 'help | list | show | plan | create | set_name | set_persona | add_members | remove_members | link | unlink | duplicate | bind | unbind',
  },
  role: { type: 'string', description: 'Role UUID or display name.' },
  name: { type: 'string', description: 'Display name (create, set_name, duplicate). Any script, <= 64 chars.' },
  persona: { type: 'string', description: 'Persona prefix for set_persona / create.' },
  add: { type: 'array', items: { type: 'string' }, description: 'Skill names to add (add_members, plan).' },
  remove: { type: 'array', items: { type: 'string' }, description: 'Skill names to remove (remove_members, plan).' },
  from: { type: 'string', description: 'Requiring skill (link, unlink).' },
  to: { type: 'string', description: 'Required skill (link, unlink).' },
  why: { type: 'string', description: 'Why the edge exists. Required for agent-created edges, <= 80 chars.' },
}

/**
 * Mount the plugin.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin scope.
 * @param {{ rolesDir?: string }} [config] - optional overrides from the patch row.
 */
export function apply(ctx, config = {}) {
  const rolesDir = config.rolesDir ?? defaultRolesDir()
  const store = new RoleStore(rolesDir)
  const bindings = new BindingStore(join(dirname(rolesDir), 'bindings.json'))
  /** @type {Map<string, { dispose: () => void }>} */
  const generations = new Map()
  let rebuildTimer

  /**
   * The orchestration view: global layer plus this agent's scope.
   *
   * The global layer keeps a role's own exclusions from hiding skills from the
   * editor; the agent scope adds preset-mounted skills, which only exist there.
   * Global wins on a name collision so an agent-scoped shadow cannot make a real
   * skill look absent.
   */
  async function catalog(agent, cwd) {
    const base = cwd === undefined ? {} : { cwd }
    const byName = new Map((await ctx.skills.list(base)).map(skill => [skill.name, skill]))
    if (agent !== undefined) {
      for (const skill of await ctx.skills.list({ ...base, scope: agent })) {
        if (!byName.has(skill.name)) byName.set(skill.name, skill)
      }
    }
    return byName
  }

  /** Full definitions (with content) for the skills a role will shadow. */
  async function definitionsFor(agent, names) {
    const definitions = new Map()
    for (const skillName of names) {
      try {
        const definition = await ctx.skills.get(skillName, { scope: agent })
        if (definition !== undefined) definitions.set(skillName, definition)
      } catch {
        // A skill that vanished between list and get is skipped; the next
        // rebuild settles it.
      }
    }
    return definitions
  }

  /**
   * Install a role into one agent. Any previous generation is disposed first, so
   * the definition lookup always sees the real skills rather than our shadows.
   */
  async function install(agent, sessionId, role) {
    generations.get(sessionId)?.dispose()
    generations.delete(sessionId)

    const cwd = await ctx.workingDirectory.ensure(agent)
    const repo = await catalog(agent, cwd)
    const agentSkills = agent.ctx.get('skills') ?? ctx.skills
    const agentPrompt = agent.ctx.get('systemPrompt') ?? ctx.systemPrompt

    // Everything the repository has but this role does not expose must be
    // shadowed; the complement is computed here so the definition lookup only
    // touches skills that will actually be hidden.
    const runtime = new Set(computeHealth(role, repo).runtime)
    const shadowNames = [...repo.keys()].filter(skillName => !runtime.has(skillName))
    const definitions = await definitionsFor(agent, shadowNames)

    const personaSection = agentPrompt?.getSectionOrder === undefined
      ? undefined
      : {
          name: PERSONA_PREFIX_SECTION,
          order: agentPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
        }

    const generation = installRole({
      skills: agentSkills,
      systemPrompt: agentPrompt,
      scope: agent,
      role,
      repo,
      definitions,
      personaSection,
    })
    generations.set(sessionId, generation)
    return generation
  }

  function disposeSession(sessionId) {
    generations.get(sessionId)?.dispose()
    generations.delete(sessionId)
  }

  /** Read the role a session is bound to, if any. */
  async function boundRole(sessionId) {
    const roleId = await bindings.get(sessionId)
    if (roleId === undefined) return undefined
    return store.read(roleId)
  }

  const api = createRoleGraphApi({
    store,
    listSkills: async ({ agent, cwd }) => [...(await catalog(agent, cwd)).values()],
    exists: path => {
      try {
        return existsSync(path)
      } catch {
        return false
      }
    },
  })

  const tool = defineTool({
    name: 'role_graph',
    description: 'Manage per-role skill graphs: list roles, inspect one, dry-run a role with plan, edit members or requires edges, and bind the current session to a role. Roles are DAG roots; skills are nodes. Deleting a role is a UI-only action.',
    parameters: PARAMETERS,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      const sessionId = sessionIdOf(agent)
      const cwd = agent === undefined ? undefined : await ctx.workingDirectory.ensure(agent, exec.signal)
      try {
        return await api.handle(args, {
          cwd,
          agent,
          sessionId,
          bindSession: async role => {
            if (sessionId === undefined) {
              throw new RoleGraphError('NO_SESSION', 'this tool call has no session to bind')
            }
            await bindings.set(sessionId, role.id)
            const generation = await install(agent, sessionId, role)
            return {
              sessionId,
              roleId: role.id,
              name: role.name,
              runtime: generation.runtime.length,
              shadowed: generation.shadowed.length,
              persona: generation.persona,
            }
          },
          clearSession: async () => {
            if (sessionId === undefined) return false
            disposeSession(sessionId)
            return await bindings.clear(sessionId)
          },
        })
      } catch (error) {
        if (error instanceof RoleGraphError) {
          const detail = error.details === undefined ? '' : `\n${JSON.stringify(error.details, null, 2)}`
          throw new Error(`${error.code}: ${error.message}${detail}`)
        }
        throw error
      }
    },
  })

  ctx.tools.register(tool)

  ctx.on('agent/created', async ({ agent }) => {
    const sessionId = sessionIdOf(agent)
    if (sessionId === undefined) return
    const role = await boundRole(sessionId)
    if (role === undefined) return
    try {
      await install(agent, sessionId, role)
    } catch (error) {
      ctx.logger?.warn?.(`skill-loom: could not install role "${role.name}" for ${sessionId}: ${String(error)}`)
    }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    const sessionId = sessionIdOf(agent)
    if (sessionId !== undefined) disposeSession(sessionId)
  })

  // Skills appearing or disappearing change what a role must shadow. Rebuilding
  // is debounced so a burst of provider updates costs one pass.
  ctx.on('skills/change', () => {
    clearTimeout(rebuildTimer)
    rebuildTimer = setTimeout(() => {
      void (async () => {
        for (const sessionId of [...generations.keys()]) {
          const agent = ctx.agents.get(sessionId)
          if (agent === undefined) {
            disposeSession(sessionId)
            continue
          }
          const role = await boundRole(sessionId)
          if (role === undefined) {
            disposeSession(sessionId)
            continue
          }
          try {
            await install(agent, sessionId, role)
          } catch {
            // Keep the previous generation if the rebuild fails.
          }
        }
      })()
    }, 250)
    rebuildTimer.unref?.()
  })
}

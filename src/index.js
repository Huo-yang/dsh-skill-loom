/**
 * DSH host wiring for dsh-skill-loom.
 *
 * Everything here is glue: it resolves the roles directory, connects the action
 * layer to `ctx.skills` and `ctx.tools`, and maps actionable failures onto tool
 * errors the model can read. The behaviour itself lives in `api.js` and
 * `graph.js`, which have no DSH imports and are unit-tested.
 *
 * Host contract used (verified against DSH 0.2.2-rc.5):
 *   ctx.skills.list({ cwd })      -> SkillSummary[] (no `scope`: global view)
 *   ctx.workingDirectory.ensure() -> absolute cwd for project-level skill roots
 *   ctx.tools.register(tool)      -> tool becomes model-visible
 *   defineTool({ name, description, parameters, output, execute })
 *
 * @module dsh-skill-loom
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'

import { RoleGraphError, createRoleGraphApi } from './api.js'
import { RoleStore } from './store.js'

/** Cordis plugin name. */
export const name = 'skill-loom'

/** Services this plugin needs before it can register its tool. */
export const inject = ['tools', 'skills', 'workingDirectory']

/** Default roles directory, honouring `DSH_HOME`. */
export function defaultRolesDir() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'roles')
}

const PARAMETERS = {
  action: {
    type: 'string',
    required: true,
    description: 'help | list | show | plan | create | set_name | set_persona | add_members | remove_members | link | unlink | duplicate',
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
  const store = new RoleStore(config.rolesDir ?? defaultRolesDir())
  const api = createRoleGraphApi({
    store,
    listSkills: async (cwd) => {
      // No `scope`: the orchestration view must see the whole repository, not
      // just what the current session's role allows.
      const summaries = await ctx.skills.list(cwd === undefined ? {} : { cwd })
      return summaries.map(skill => ({
        name: skill.name,
        description: skill.description,
        path: skill.path,
        source: skill.source,
        provider: skill.provider,
      }))
    },
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
    description: 'Manage per-role skill graphs: list roles, inspect one, dry-run a role with plan, and edit members or requires edges. Roles are DAG roots; skills are nodes. Deleting a role is a UI-only action.',
    parameters: PARAMETERS,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const cwd = exec.agent === undefined
        ? undefined
        : await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      try {
        return await api.handle(args, { cwd })
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
}

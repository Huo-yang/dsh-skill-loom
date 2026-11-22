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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineTool } from '@deepseek-ai/dsh-tools'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'

import { RoleGraphError, createRoleGraphApi } from './api.js'
import { computeHealth } from './graph.js'
import { BindingStore, bindingsFileFor } from './bindings.js'
import { restoreBoundRoles, sessionIdOf } from './lifecycle.js'
import { installRole } from './runtime.js'
import { createDebouncedTask } from './scheduler.js'
import { buildCatalog } from './catalog.js'
import { ROUTE_PREFIX, createResource, toNodeHandler } from './http.js'
import { createOverrideRegistry, resolveCreatedRole } from './spawn.js'
import { RoleConflictError, RoleStore } from './store.js'
import { createHistory } from './history.js'
import { createFamilyLibrary, mergeFamily } from './families.js'

/** Cordis plugin name. */
export const name = 'skill-loom'

/** Services this plugin needs. */
export const inject = ['tools', 'skills', 'systemPrompt', 'workingDirectory', 'agents', 'subagents']

/** Default roles directory, honouring `DSH_HOME`. */
export function defaultRolesDir() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'roles')
}

const PARAMETERS = {
  action: {
    type: 'string',
    required: true,
    description: 'help | list | show | plan | create | set_name | set_description | set_persona | add_members | remove_members | link | unlink | reparent | duplicate | bind | unbind',
  },
  role: { type: 'string', description: 'Role UUID or display name.' },
  name: { type: 'string', description: 'Display name (create, set_name, duplicate). Any script, <= 64 chars.' },
  persona: { type: 'string', description: 'Persona prefix for set_persona / create.' },
  description: { type: 'string', description: 'Short role description displayed in the UI (set_description, <= 160 chars).' },
  add: { type: 'array', items: { type: 'string' }, description: 'Skill names to add (add_members, plan).' },
  remove: { type: 'array', items: { type: 'string' }, description: 'Skill names to remove (remove_members, plan).' },
  from: { type: 'string', description: 'Requiring skill (link, unlink, reparent).' },
  to: { type: 'string', description: 'Required skill (link, unlink, reparent).' },
  why: { type: 'string', description: 'Why the edge exists. Required for agent-created edges, <= 80 chars.' },
}

/** Skills shipped as Markdown next to the code, so each one has a real file path. */
const BUNDLED_SKILLS = [
  { name: 'skill-loom-orchestrate', file: '../skill/skill-loom-orchestrate/SKILL.md' },
  { name: 'skill-loom-review', file: '../skill/skill-loom-review/SKILL.md' },
]

/**
 * Read one bundled SKILL.md and split its frontmatter from its body.
 * @param {string} file - absolute path to the Markdown file.
 * @returns {{ name: string, description: string, content: string, path: string }} the registration.
 */
function loadBundledSkill(file) {
  const raw = readFileSync(file, 'utf8')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (match === null) throw new Error(`skill frontmatter is missing: ${file}`)
  const fields = {}
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator < 0) continue
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }
  if (typeof fields.name !== 'string' || fields.name === '' || typeof fields.description !== 'string') {
    throw new Error(`skill frontmatter must declare name and description: ${file}`)
  }
  return { name: fields.name, description: fields.description, content: match[2].trim(), path: file }
}

/**
 * Mount the plugin.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin scope.
 * @param {{ rolesDir?: string }} [config] - optional overrides from the patch row.
 */
export function apply(ctx, config = {}) {
  const rolesDir = config.rolesDir ?? defaultRolesDir()
  const store = new RoleStore(rolesDir)
  const families = createFamilyLibrary(new RoleStore(join(rolesDir, 'families')), store)
  for (const entry of BUNDLED_SKILLS) {
    const skill = loadBundledSkill(fileURLToPath(new URL(entry.file, import.meta.url)))
    ctx.skills.register({
      ...skill,
      // The path is real, so the editor can offer to open this skill's folder.
      source: 'bundled',
      invocation: { modelInvocable: true, userInvocable: true },
    })
  }
  const reviewRequests = new Map()
  let reviewSequence = 0
  const getReviewRequest = sessionId => {
    const request = reviewRequests.get(sessionId)
    if (request?.expires > Date.now()) return request
    reviewRequests.delete(sessionId)
    return undefined
  }
  const history = createHistory({ limit: 20 })
  let pending = Promise.resolve()
  function serialize(work) {
    const next = pending.then(work)
    pending = next.catch(() => {})
    return next
  }
  // Every save through this handle remembers the state it replaced. The raw store
  // is kept for undo/redo itself, so restoring a snapshot does not record again.
  const trackedStore = {
    readAll: () => store.readAll(),
    read: id => store.read(id),
    remove: (id, expectedRevision) => serialize(async () => {
      const role = await store.read(id)
      if (role === undefined) return false
      checkRevision(role, expectedRevision)
      if (!await store.remove(id)) return false
      history.forget(id)
      for (const [sessionId, generation] of generations) {
        if (generation.config.role.id === id) disposeSession(sessionId)
      }
      try {
        await bindings.clearRole(id)
      } catch (error) {
        logger?.warn?.(`skill-loom: could not clear bindings for deleted role ${id}: ${String(error)}`)
      }
      return true
    }),
    async save(role, options) {
      const before = await store.read(role?.id)
      const saved = await store.save(role, options)
      history.record(role.id, before)
      if (before !== undefined) await refreshRole(saved)
      return saved
    },
  }
  const bindings = new BindingStore(bindingsFileFor(rolesDir))
  /** @type {Map<string, { dispose: () => void }>} */
  const generations = new Map()
  const overrides = createOverrideRegistry()
  const disposedAgents = new WeakSet()
  let registering = false
  // Capture services once: after unload the context is inactive and even
  // ctx.logger may throw on access.
  const logger = ctx.logger
  // Timers outlive Cordis contexts. Everything scheduled off a timer must check
  // this flag before touching a service, or it will throw into an inactive
  // context and (because nothing catches a timer callback) take down the host.
  let active = true

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
   * Prepare a role while the current one is still installed.
   */
  async function prepare(agent, sessionId, role) {
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
    const previous = generations.get(sessionId)?.config
    for (const [skillName, definition] of definitions) {
      if (definition.provider === 'skill-loom' && previous?.definitions.has(skillName)) {
        definitions.set(skillName, previous.definitions.get(skillName))
      }
    }

    const wantsPersona = typeof role?.persona?.prefix === 'string' && role.persona.prefix !== ''
    const personaSection = agentPrompt?.getSectionOrder === undefined
      ? undefined
      : {
          name: PERSONA_PREFIX_SECTION,
          order: agentPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
        }
    if (wantsPersona && personaSection === undefined) {
      // The role does carry a persona, but this host exposes no section order for
      // it. Skills keep working while the persona disappears, which is exactly the
      // kind of half-working state that needs to be visible in the log.
      logger?.warn?.(
        `skill-loom: persona of role "${String(role?.name ?? role?.id)}" was not injected: ` +
        'systemPrompt.getSectionOrder is unavailable on this host',
      )
    }

    return {
      skills: agentSkills,
      systemPrompt: agentPrompt,
      scope: agent,
      role,
      repo,
      definitions,
      personaSection,
    }
  }

  function activate(sessionId, config, strict = true) {
    registering = true
    try {
      disposeSession(sessionId)
      if (!active || config === undefined || disposedAgents.has(config.scope)) return undefined
      const generation = { ...installRole({ ...config, strict }), config }
      generations.set(sessionId, generation)
      return generation
    } finally {
      registering = false
    }
  }

  async function install(agent, sessionId, role, persist = false) {
    const config = await prepare(agent, sessionId, role)
    if (!active || disposedAgents.has(agent)) return undefined
    const previous = generations.get(sessionId)?.config
    let generation
    try {
      generation = activate(sessionId, config)
      if (persist) await bindings.set(sessionId, role.id)
    } catch (error) {
      activate(sessionId, previous, false)
      throw error
    }
    if (role?.persona?.prefix && generation.persona !== true && config.personaSection !== undefined) {
      logger?.warn?.(
        `skill-loom: persona section for role "${String(role?.name ?? role?.id)}" was rejected by the prompt registry`,
      )
    }
    return generation
  }

  async function refreshRole(role) {
    for (const [sessionId, generation] of [...generations]) {
      if (!active) return
      if (generation.config.role.id !== role.id) continue
      try {
        await install(generation.config.scope, sessionId, role)
      } catch (error) {
        logger?.warn?.(`skill-loom: could not refresh ${sessionId}: ${String(error)}`)
      }
    }
  }

  function checkRevision(role, expected) {
    if (expected !== undefined && role.revision !== expected) {
      throw new RoleConflictError(role.id, expected, role.revision)
    }
  }

  /**
   * Walk one step of a role's history and write the snapshot back as a new
   * revision. The raw store is used so the restore itself is not recorded.
   */
  async function restoreRole(id, direction, expectedRevision) {
    const current = await store.read(id)
    if (current === undefined) return undefined
    checkRevision(current, expectedRevision)
    const target = history.peek(id, direction)
    if (target === undefined) return undefined
    const saved = await store.save(target, { expectedRevision: current.revision })
    if (direction === 'undo') history.takeUndo(id, current)
    else history.takeRedo(id, current)
    await refreshRole(saved)
    return saved
  }

  function disposeSession(sessionId) {
    const generation = generations.get(sessionId)
    generations.delete(sessionId)
    const wasRegistering = registering
    registering = true
    try {
      generation?.dispose()
    } finally {
      registering = wasRegistering
    }
  }

  async function unbind(sessionId) {
    const cleared = await bindings.clear(sessionId)
    disposeSession(sessionId)
    return cleared
  }

  /** Read the role a session is bound to, if any. */
  async function boundRole(sessionId) {
    const roleId = await bindings.get(sessionId)
    if (roleId === undefined) return undefined
    return store.read(roleId)
  }

  const api = createRoleGraphApi({
    store: trackedStore,
    listSkills: async ({ agent, cwd }) => {
      // A write dispatched from the page carries no agent. Falling back to the
      // global layer alone would make preset-mounted skills look missing and
      // drop their anchors on save, so widen the union to every live agent.
      const byName = agent !== undefined
        ? await catalog(agent, cwd)
        : await buildCatalog({
            list: options => ctx.skills.list(options),
            agents: ctx.agents.list(),
            base: cwd === undefined ? {} : { cwd },
            onError: error => logger?.warn?.(`skill-loom: a skill scope failed: ${String(error)}`),
          })
      return [...byName.values()]
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
        return await serialize(() => api.handle(args, {
          cwd,
          agent,
          sessionId,
          bindSession: async role => {
            if (sessionId === undefined) {
              throw new RoleGraphError('NO_SESSION', 'this tool call has no session to bind')
            }
            const generation = await install(agent, sessionId, role, true)
            if (generation === undefined) throw new RoleGraphError('NO_SESSION', 'the session was closed')
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
            return await unbind(sessionId)
          },
        }))
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

  const applyFamily = (input, family) => api.applyFamily(input, role => mergeFamily(role, family, input.target))
  const familyFor = async query => {
    const matches = (await families.list()).filter(item => item.id === query || item.name === query)
    if (matches.length !== 1) throw new RoleGraphError('FAMILY_LOOKUP', 'Use a unique family ID from role_family list.')
    return matches[0]
  }
  const graphToolsOutput = {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
  ctx.tools.register(defineTool({
    name: 'role_family',
    description: 'List, inspect, create, update, or apply reusable Skill Loom ability families.',
    parameters: {
      action: { type: 'string', required: true, description: 'list | show | create | update | apply' },
      family: { type: 'string', description: 'Ability family ID or unique display name.' },
      name: { type: 'string', description: 'Ability family display name.' },
      description: { type: 'string', description: 'Short summary, at most 160 characters.' },
      members: { type: 'array', items: { type: 'string' }, description: 'Complete skill membership for a new or edited graph.' },
      edges: { type: 'array', items: {
        type: 'object', additionalProperties: false,
        properties: {
          from: { type: 'string', required: true }, to: { type: 'string', required: true },
          why: { type: 'string', required: true },
        },
      }, description: 'Complete requires edges, each with a reason of at most 80 characters.' },
      role: { type: 'string', description: 'Destination role ID or display name for apply.' },
      target: { type: 'string', description: 'Optional skill in the destination role. Omit to attach at the role root.' },
      revision: { type: 'number', description: 'Current family revision required for update.' },
    },
    output: graphToolsOutput,
    execute(args) {
      return serialize(async () => {
        if (args.action === 'list') return { families: await families.list() }
        const family = args.action === 'create' ? undefined : await familyFor(args.family)
        if (args.action === 'show') return { family }
        if (args.action === 'apply') {
          const role = await api.resolve(args.role)
          return await applyFamily({ role: role.id, expectedRevision: role.revision, target: args.target }, family)
        }
        if (args.action !== 'create' && args.action !== 'update') throw new Error('Unknown role_family action')
        const graph = args.members === undefined && args.edges === undefined
          ? undefined : { members: args.members, edges: args.edges }
        if (graph && (!Array.isArray(graph.edges) || graph.edges.some(edge => typeof edge?.why !== 'string'
          || !edge.why.trim() || edge.why.trim().length > 80))) throw new Error('Every dependency needs a reason of 1–80 characters.')
        if (!family && !graph) throw new Error('Provide members and edges to create a family.')
        return { family: await families.change({
          action: args.action, id: family?.id, name: args.name ?? family?.name,
          description: args.description, expectedRevision: args.revision, graph,
        }) }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'role_review',
    description: 'Open Skill Loom in the current DSH Web conversation sidebar for the user to inspect a saved role or ability family.',
    parameters: {
      role: { type: 'string', description: 'Saved role ID or display name.' },
      family: { type: 'string', description: 'Saved ability family ID or unique display name.' },
    },
    output: graphToolsOutput,
    async execute(args, exec) {
      const sessionId = sessionIdOf(exec.agent)
      if (sessionId === undefined) throw new Error('A DSH session is required.')
      if (!!args.role === !!args.family) throw new Error('Provide exactly one role or family.')
      const role = args.role ? await api.resolve(args.role) : undefined
      const family = args.family ? await familyFor(args.family) : undefined
      const request = {
        ticket: Date.now() + '-' + ++reviewSequence, roleId: role?.id, familyId: family?.id,
        expires: Date.now() + 300_000,
      }
      reviewRequests.set(sessionId, request)
      return { queued: true, surface: 'DSH Web conversation sidebar', name: role?.name ?? family.name }
    },
  }))

  const roleSpawn = defineTool({
    name: 'role_spawn',
    description: 'Spawn a subagent that runs under a named role instead of inheriting the caller role. Use the native subagent tool when no role is needed.',
    parameters: {
      role: { type: 'string', required: true, description: 'Role UUID or display name.' },
      prompt: { type: 'string', required: true, description: 'The task for the child.' },
      description: { type: 'string', description: 'Short label shown in the subagent list.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const parent = exec.agent
      if (parent === undefined) throw new Error('NO_AGENT: role_spawn requires an agent session')
      const parentSession = sessionIdOf(parent)
      if (parentSession === undefined) throw new Error('NO_SESSION: role_spawn cannot identify the calling session')

      let role
      try {
        role = await api.resolve(args.role)
      } catch (error) {
        if (error instanceof RoleGraphError) throw new Error(`${error.code}: ${error.message}`)
        throw error
      }

      // Register, spawn, clear — all inside one tool call, and one agent never
      // runs two tool calls at once, so no other child can consume this.
      overrides.set(parentSession, role.id)
      try {
        const started = await ctx.subagents.startActivation({
          provider: config.subagentProvider ?? 'spawn',
          label: args.description ?? role.name,
          prompt: [{ type: 'text', text: args.prompt }],
          parent,
          signal: exec.signal,
          delivery: 'parent',
        })
        return { ok: true, role: { id: role.id, name: role.name }, child: started.name }
      } catch (error) {
        if (/exceeds maxDepth/.test(String(error?.message ?? ''))) {
          throw new Error(
            'DELEGATION_DEPTH: the host delegation-depth cap is already reached, so no further child can be spawned; '
            + 'raise the subagent maxDepth configuration if deeper delegation is intended',
          )
        }
        throw error
      } finally {
        overrides.clear(parentSession)
      }
    },
  })
  ctx.tools.register(roleSpawn)

  // Read-only HTTP surface for the page. `inject` waits for the service: at boot
  // `ctx.get('webServer')` is not populated yet, and a `get` would silently skip
  // the whole registration.
  ctx.inject(['webServer'], webCtx => webCtx.effect(() => webCtx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    // A handler, not a resource: resource routes answer GET/HEAD only.
    handler: toNodeHandler(createResource({
      store: trackedStore,
      mutate: input => serialize(() => api.handle(input, { expectedRevision: input.expectedRevision, source: 'human' })),
      families: {
        list: families.list,
        change: input => serialize(() => families.change(input)),
        insert: input => serialize(() => api.applyFamily(input, async role => {
          const family = await families.read(input.familyId)
          if (family === undefined) throw new RoleGraphError('FAMILY_NOT_FOUND', '能力族不存在')
          if (!family.builtin && family.revision !== input.familyRevision) {
            throw new RoleConflictError(family.id, input.familyRevision, family.revision)
          }
          return mergeFamily(role, family, input.target)
        })),
      },
      // Union of the global layer and every live agent scope: the editor must
      // not report a preset-mounted skill as missing just because no agent is
      // answering an HTTP request.
      catalog: async () => buildCatalog({
        list: options => ctx.skills.list(options),
        agents: ctx.agents.list(),
        onError: error => logger?.warn?.(`skill-loom: a skill scope failed: ${String(error)}`),
      }),
      exists: path => {
        try {
          return existsSync(path)
        } catch {
          return false
        }
      },
      history: {
        counts: id => history.counts(id),
        undo: (id, revision) => serialize(() => restoreRole(id, 'undo', revision)),
        redo: (id, revision) => serialize(() => restoreRole(id, 'redo', revision)),
      },
      sessions: {
        review: getReviewRequest,
        getRole: sessionId => bindings.get(sessionId),
        list: async () => {
          const rows = []
          for (const agent of ctx.agents.list()) {
            const sessionId = sessionIdOf(agent)
            if (sessionId === undefined) continue
            rows.push({
              sessionId,
              cwd: agent.session.header.cwd,
              roleId: await bindings.get(sessionId),
            })
          }
          return rows
        },
        bind: (sessionId, selected) => serialize(async () => {
          const role = await store.read(selected.id)
          if (role === undefined) throw new RoleGraphError('ROLE_NOT_FOUND', 'the role was deleted')
          const agent = ctx.agents.get(sessionId)
          if (agent?.status === 'running') throw new RoleGraphError('SESSION_BUSY', 'the session is running')
          if (agent === undefined) await bindings.set(sessionId, role.id)
          const installed = agent === undefined ? undefined : await install(agent, sessionId, role, true)
          return { sessionId, roleId: role.id, live: installed !== undefined }
        }),
        unbind: sessionId => serialize(async () => {
          if (ctx.agents.get(sessionId)?.status === 'running') {
            throw new RoleGraphError('SESSION_BUSY', 'the session is running')
          }
          return { sessionId, cleared: await unbind(sessionId) }
        }),
      },
    })),
  }), 'skill-loom: http routes'))
  ctx.on('agent/created', ({ agent }) => serialize(async () => {
    if (!active) return
    const sessionId = sessionIdOf(agent)
    if (sessionId === undefined) return
    let decision
    try {
      decision = await resolveCreatedRole({
        sessionId,
        parentSession: agent?.session?.header?.parentSession,
        takeOverride: parentId => overrides.take(parentId),
        boundRoleFor: id => bindings.get(id),
        loadRole: id => store.read(id),
      })
    } catch (error) {
      logger?.warn?.(`skill-loom: could not resolve a role for ${sessionId}: ${String(error)}`)
      return
    }
    if (!active || decision.role === undefined) return
    try {
      // Persist so a reload can restore the child without its parent.
      await install(agent, sessionId, decision.role, decision.source !== 'own')
    } catch (error) {
      logger?.warn?.(`skill-loom: could not install role "${decision.role.name}" for ${sessionId}: ${String(error)}`)
    }
  }))

  ctx.on('agent/disposed', ({ agent }) => {
    if (agent === undefined) return
    disposedAgents.add(agent)
    const sessionId = sessionIdOf(agent)
    if (sessionId !== undefined) {
      reviewRequests.delete(sessionId)
      disposeSession(sessionId)
    }
  })

  // A reload must not lose roles: existing agents never fire `agent/created`
  // again, and the previous instance's generation is gone. Restore first, and
  // release our generations when this instance unloads.
  ctx.effect(() => {
    void serialize(async () => {
      if (!active) return
      try {
        await restoreBoundRoles({
          agents: ctx.agents.list(),
          boundRoleFor: sessionId => boundRole(sessionId),
          installRoleFor: (agent, sessionId, role) => install(agent, sessionId, role),
          onError: (error, sessionId) => {
            logger?.warn?.(`skill-loom: could not restore the role of ${sessionId}: ${String(error)}`)
          },
        })
      } catch (error) {
        logger?.warn?.(`skill-loom: restoring bound roles failed: ${String(error)}`)
      }
    })
    return () => {
      active = false
      rebuild.cancel()
      reviewRequests.clear()
      for (const sessionId of [...generations.keys()]) disposeSession(sessionId)
    }
  }, 'skill-loom: restore bound roles and release generations')

  // Skills appearing or disappearing change what a role must shadow. Rebuilding
  // is debounced so a burst of provider updates costs one pass, and the task
  // refuses to run once this instance is unloaded.
  const rebuild = createDebouncedTask({
    delay: 250,
    isActive: () => active,
    onError: error => logger?.warn?.(`skill-loom: rebuild after skills/change failed: ${String(error)}`),
    run: () => serialize(async () => {
      for (const sessionId of [...generations.keys()]) {
        if (!active) return
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
        } catch (error) {
          logger?.warn?.(`skill-loom: could not rebuild ${sessionId}: ${String(error)}`)
        }
      }
    }),
  })

  ctx.on('skills/change', () => {
    if (!registering) rebuild.trigger()
  })
}
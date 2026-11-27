import { RoleGraphError } from './api.js'
import { findCycles, newRoleId, requiresClosure, validateRoleName } from './graph.js'
import { RoleConflictError } from './store.js'

export const PRESETS = [{
  id: 'builtin-role-orchestration',
  name: '技能编排助手',
  builtin: true,
  description: '整理技能依赖，创建和维护角色或能力族，完成后打开会话侧栏供检查。',
  members: ['skill-loom-orchestrate', 'skill-loom-review'],
  edges: [{ from: 'skill-loom-review', to: 'skill-loom-orchestrate' }],
}]

function withEntries(family) {
  // Skills without prerequisites sit directly below the virtual root.
  const consumers = new Set(family.edges.map(edge => edge.from))
  return { ...family, entries: family.members.filter(name => !consumers.has(name)) }
}

function validateFamilyGraph(graph) {
  if (!Array.isArray(graph?.members) || graph.members.length === 0
    || !graph.members.every(name => typeof name === 'string' && name.trim() && name !== '__role__')) {
    throw new RoleGraphError('FAMILY_MEMBERS', '能力族至少需要一项有效技能')
  }
  const members = new Set(graph.members)
  if (!Array.isArray(graph.edges)) throw new RoleGraphError('FAMILY_EDGES', '依赖列表无效')
  const pairs = new Map()
  for (const edge of graph.edges) {
    if (!members.has(edge?.from) || !members.has(edge?.to)) {
      throw new RoleGraphError('FAMILY_EDGES', '依赖两端都必须是能力族内的技能')
    }
    const { from, to, why } = edge
    const key = JSON.stringify([from, to])
    if (!pairs.has(key)) pairs.set(key, { from, to, ...(typeof why === 'string' && why ? { why: why.slice(0, 80) } : {}) })
  }
  const edges = [...pairs.values()]
  const [cycle] = findCycles({ edges })
  if (cycle) throw new RoleGraphError('FAMILY_CYCLE', '依赖会形成环：' + cycle.join(' → '))
  return { members: [...members], edges }
}

export function mergeFamily(role, family, target) {
  if (target !== undefined && !(role.members ?? []).includes(target)) {
    throw new RoleGraphError('FAMILY_TARGET', '目标技能不在当前角色中')
  }
  const { entries } = withEntries(family)
  const pairs = new Map()
  const attachments = target === undefined ? [] : entries.map(from => ({ from, to: target }))
  for (const edge of [...(role.edges ?? []), ...family.edges, ...attachments]) {
    const key = JSON.stringify([edge.from, edge.to])
    if (!pairs.has(key)) pairs.set(key, edge)
  }
  return {
    ...role,
    members: [...new Set([...(role.members ?? []), ...family.members])],
    edges: [...pairs.values()],
  }
}

export function createFamilyLibrary(store, roles) {
  async function read(id) {
    return PRESETS.find(family => family.id === id) ?? await store.read(id)
  }

  return {
    read,
    async list() {
      return [...PRESETS, ...await store.readAll()].map(withEntries)
    },
    async change(input) {
      const { id, action, expectedRevision } = input ?? {}
      if (!['create', 'update', 'delete'].includes(action)) {
        throw new RoleGraphError('FAMILY_ACTION', '无效的能力族操作')
      }
      const current = action === 'create' ? undefined : await read(id)
      if (action !== 'create' && current === undefined) {
        throw new RoleGraphError('FAMILY_NOT_FOUND', '能力族不存在')
      }
      if (current?.builtin) throw new RoleGraphError('FAMILY_BUILTIN', '预置能力族不可修改')
      if (current !== undefined && current.revision !== expectedRevision) {
        throw new RoleConflictError(id, expectedRevision, current.revision)
      }
      if (action === 'delete') {
        await store.remove(id, { expectedRevision: current.revision })
        return { id }
      }

      const name = typeof input.name === 'string' ? input.name.trim() : ''
      if (!validateRoleName(name).ok) throw new RoleGraphError('FAMILY_NAME', '请输入有效的能力族名称')
      let graph = current
      if (input.graph !== undefined) {
        graph = input.graph
      } else if (action === 'create' || input.roleId !== undefined) {
        const source = await roles.read(input.roleId)
        if (source === undefined) throw new RoleGraphError('ROLE_NOT_FOUND', '来源角色不存在')
        if (source.revision !== input.roleRevision) {
          throw new RoleConflictError(source.id, input.roleRevision, source.revision)
        }
        const selected = new Set(Array.isArray(input.members) ? input.members : [])
        const available = new Set(source.members ?? [])
        if (selected.size === 0 || [...selected].some(name => !available.has(name))) {
          throw new RoleGraphError('FAMILY_MEMBERS', '请从当前角色选择至少一项技能')
        }
        const included = requiresClosure(source, selected)
        graph = {
          members: [...included],
          edges: (source.edges ?? []).filter(edge => included.has(edge.from) && included.has(edge.to)),
        }
      }
      if (input.description !== undefined && typeof input.description !== 'string') {
        throw new RoleGraphError('INVALID_DESCRIPTION', '简介必须是文本')
      }
      const description = input.description === undefined
        ? current?.description : input.description.trim().replace(/\s+/g, ' ')
      if (description?.length > 160) throw new RoleGraphError('INVALID_DESCRIPTION', '简介最多 160 个字符')

      const saved = await store.save({
        schema: 1, id: current?.id ?? newRoleId(), name, ...validateFamilyGraph(graph),
        ...(description ? { description } : {}),
      }, { expectedRevision })
      return withEntries(saved)
    },
  }
}

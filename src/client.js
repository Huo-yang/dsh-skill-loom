window.__ModuleLoader__.load({
  id: 'dsh-skill-loom',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useMemo } = React

    const API = '/skill-loom'
    const NODE_W = 150
    const NODE_H = 34
    const GAP_X = 26
    const ROW_H = 96

    const COLORS = { runtime: '#2ea043', red: '#d1242f', gray: '#8b949e', member: '#1f6feb', role: '#8250df' }

    const styles = {
      page: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, font: 'inherit', color: 'inherit' },
      canvas: {
        flex: '1 1 45%', minHeight: 200, overflow: 'auto',
        borderBottom: '1px solid var(--dsw-border-subtle, rgba(127,127,127,.24))',
        background: 'var(--dsw-surface-sunken, rgba(127,127,127,.04))',
      },
      bottom: { flex: '1 1 55%', display: 'flex', minHeight: 180, overflow: 'hidden' },
      skillList: {
        width: 250, flex: '0 0 250px', overflowY: 'auto', padding: '10px 8px',
        borderRight: '1px solid var(--dsw-border-subtle, rgba(127,127,127,.24))',
      },
      detail: { flex: '1 1 auto', overflowY: 'auto', padding: '14px 18px', minWidth: 0 },
      title: { fontSize: 12, fontWeight: 600, opacity: 0.7, padding: '2px 8px 8px' },
      item: active => ({
        padding: '6px 8px', borderRadius: 5, cursor: 'pointer', marginBottom: 2,
        background: active ? 'var(--dsw-surface-raised, rgba(127,127,127,.14))' : 'transparent',
      }),
      itemName: { fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 },
      meta: { fontSize: 11, opacity: 0.6, marginTop: 2 },
      h2: { fontSize: 15, margin: '0 0 2px' },
      muted: { fontSize: 12, opacity: 0.62 },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 12 },
      section: { marginTop: 16 },
      sectionTitle: { fontSize: 12, fontWeight: 600, opacity: 0.7, marginBottom: 6 },
      line: {
        display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
        borderBottom: '1px solid var(--dsw-border-subtle, rgba(127,127,127,.12))',
      },
      button: enabled => ({
        marginLeft: 'auto', fontSize: 11, padding: '0 8px', height: 20, borderRadius: 4,
        border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,.35))',
        background: 'transparent', color: 'inherit', cursor: enabled ? 'pointer' : 'default',
        opacity: enabled ? 1 : 0.45,
      }),
      select: {
        fontSize: 12, height: 22, maxWidth: 200,
        background: 'var(--dsw-surface-raised, rgba(127,127,127,.08))', color: 'inherit',
        border: '1px solid var(--dsw-border-subtle, rgba(127,127,127,.35))', borderRadius: 4,
      },
      dot: color => ({ width: 8, height: 8, borderRadius: 4, background: color, display: 'inline-block', flex: '0 0 auto' }),
      error: {
        fontSize: 12, padding: '8px 10px', margin: '8px 0', borderRadius: 5,
        borderLeft: `3px solid ${COLORS.red}`, background: 'var(--dsw-surface-raised, rgba(127,127,127,.1))',
      },
      empty: { fontSize: 12, opacity: 0.6, padding: '8px 2px' },
    }

    function SidebarIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M2 3.5h5v5H2zM9 3.5h5v2H9zM9 6.5h5v5H9zM2 10.5h5v2H2z', fill: 'currentColor', opacity: 0.85 }))
    }

    /** Lay out one role as a top-down tree: role node on top, dependencies below. */
    function layout(role, plan) {
      const levels = plan.levels ?? {}
      const members = plan.members ?? []
      const rows = new Map()
      for (const name of members) {
        const level = levels[name] ?? 0
        const row = rows.get(level) ?? []
        row.push(name)
        rows.set(level, row)
      }
      const maxLevel = members.reduce((max, name) => Math.max(max, levels[name] ?? 0), 0)
      const roleLevel = maxLevel + 1
      const perRow = Math.max(1, ...[...rows.values()].map(row => row.length), 1)

      const width = Math.max(360, perRow * (NODE_W + GAP_X) + GAP_X)
      const positions = new Map()
      const place = (name, level, index, count) => {
        const rowWidth = count * NODE_W + (count - 1) * GAP_X
        const x = (width - rowWidth) / 2 + index * (NODE_W + GAP_X) + NODE_W / 2
        const y = (roleLevel - level) * ROW_H + NODE_H
        positions.set(name, { x, y })
      }
      place('__role__', roleLevel, 0, 1)
      for (const [level, row] of rows) row.forEach((name, index) => place(name, level, index, row.length))

      const height = (roleLevel + 1) * ROW_H + 20
      return { width, height, positions, roleLevel }
    }

    function Graph({ role, plan, health, selected, onSelect }) {
      const state = useMemo(() => {
        const { width, height, positions } = layout(role, plan)
        return { width, height, positions }
      }, [role, plan])

      const red = new Set(plan.red ?? [])
      const gray = new Set((plan.gray ?? []).map(row => row.name))
      const runtime = new Set(plan.runtime ?? [])
      const colorOf = name => (red.has(name) ? COLORS.red : gray.has(name) ? COLORS.gray : runtime.has(name) ? COLORS.runtime : COLORS.member)

      const edges = []
      for (const name of plan.members ?? []) edges.push({ from: '__role__', to: name, include: true })
      for (const edge of role.edges ?? []) edges.push({ from: edge.from, to: edge.to, why: edge.why })

      const path = edge => {
        const a = state.positions.get(edge.from)
        const b = state.positions.get(edge.to)
        if (a === undefined || b === undefined) return undefined
        const y1 = a.y
        const y2 = b.y - NODE_H
        const mid = (y1 + y2) / 2
        return `M ${a.x} ${y1} C ${a.x} ${mid}, ${b.x} ${mid}, ${b.x} ${y2}`
      }

      const nodes = [{ name: '__role__', label: role.name, level: state.roleLevel, kind: 'role' },
        ...(plan.members ?? []).map(name => ({ name, label: name, kind: 'skill' }))]

      return h('svg', {
        viewBox: `0 0 ${state.width} ${state.height}`,
        width: '100%',
        height: state.height,
        role: 'img',
        'aria-label': `${role.name} 的依赖图`,
        style: { display: 'block' },
      },
      h('defs', null, h('marker', {
        id: 'loom-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4,
        markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse',
      }, h('path', { d: 'M0,0 L8,4 L0,8 z', fill: 'currentColor', opacity: 0.55 }))),

      edges.map((edge, index) => {
        const d = path(edge)
        if (d === undefined) return null
        return h('path', {
          key: `e${index}`,
          d,
          fill: 'none',
          stroke: 'currentColor',
          strokeOpacity: edge.include ? 0.22 : 0.5,
          strokeWidth: 1.4,
          strokeDasharray: edge.include ? '4 3' : undefined,
        })
      }),

      nodes.map(node => {
        const position = state.positions.get(node.name)
        if (position === undefined) return null
        const active = selected === node.name
        const stateColor = node.kind === 'role' ? COLORS.role : colorOf(node.name)
        return h('g', {
          key: node.name,
          transform: `translate(${position.x - NODE_W / 2}, ${position.y - NODE_H})`,
          onClick: () => onSelect(node.kind === 'role' ? undefined : node.name),
          style: { cursor: node.kind === 'role' ? 'default' : 'pointer' },
        },
        h('rect', {
          width: NODE_W, height: NODE_H, rx: 6,
          fill: 'var(--dsw-surface-raised, rgba(127,127,127,.1))',
          stroke: active ? COLORS.role : 'currentColor',
          strokeOpacity: active ? 1 : 0.25,
          strokeWidth: active ? 2 : 1,
        }),
        h('circle', { cx: 14, cy: NODE_H / 2, r: 4, fill: stateColor }),
        h('text', {
          x: 26, y: NODE_H / 2 + 4, fontSize: 12, fill: 'currentColor',
          style: { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' },
        }, node.label.length > 17 ? `${node.label.slice(0, 16)}…` : node.label))
      }))
    }

    function RolePage() {
      const [list, setList] = useState({ status: 'loading', roles: [], skills: [] })
      const [selectedRole, setSelectedRole] = useState(undefined)
      const [detail, setDetail] = useState({ status: 'idle' })
      const [selectedSkill, setSelectedSkill] = useState(undefined)
      const [pending, setPending] = useState(false)
      const [error, setError] = useState(undefined)
      const [filter, setFilter] = useState('')
      const [linkTarget, setLinkTarget] = useState('')

      const loadList = useCallback(async () => {
        try {
          const response = await fetch(`${API}/roles`, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const body = await response.json()
          setList({ status: 'ready', roles: body.roles ?? [], skills: body.skills ?? [] })
        } catch (cause) {
          setList({ status: 'error', error: String(cause), roles: [], skills: [] })
        }
      }, [])

      const loadDetail = useCallback(async id => {
        try {
          const response = await fetch(`${API}/roles/${encodeURIComponent(id)}`, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          setDetail({ status: 'ready', ...(await response.json()) })
        } catch (cause) {
          setDetail({ status: 'error', error: String(cause) })
        }
      }, [])

      useEffect(() => { void loadList() }, [loadList])

      useEffect(() => {
        if (selectedRole === undefined) {
          setDetail({ status: 'idle' })
          return
        }
        setDetail({ status: 'loading' })
        void loadDetail(selectedRole)
      }, [selectedRole, loadDetail])

      const send = async (path, payload) => {
        const role = detail.role
        setPending(true)
        setError(undefined)
        try {
          const response = await fetch(`${API}/roles/${encodeURIComponent(role.id)}/${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...payload, expectedRevision: role.revision }),
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok) {
            throw new Error(body.error === 'conflict'
              ? '这个角色刚被别处修改过，请刷新后再操作'
              : (body.message ?? body.code ?? body.error ?? `HTTP ${response.status}`))
          }
          await Promise.all([loadList(), loadDetail(role.id)])
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setPending(false)
        }
      }

      const roleReady = detail.status === 'ready'
      const role = roleReady ? detail.role : undefined
      const plan = roleReady ? detail.plan : undefined
      const health = roleReady ? detail.health : undefined

      return h('div', { style: styles.page },
        h('div', { style: styles.canvas },
          detail.status === 'error' ? h('div', { style: styles.error }, detail.error) : null,
          roleReady
            ? h(Graph, { role, plan, health, selected: selectedSkill, onSelect: setSelectedSkill })
            : h('div', { style: { ...styles.empty, padding: 16 } },
              detail.status === 'loading' ? '加载中…' : '选择一个角色查看它的依赖图')),

        h('div', { style: styles.bottom },
          h('div', { style: styles.skillList },
            h('div', { style: styles.title }, `角色 · ${list.roles.length}`),
            list.roles.map(item => h('div', {
              key: item.id,
              style: styles.item(selectedRole === item.id),
              onClick: () => { setSelectedRole(item.id); setSelectedSkill(undefined) },
            },
            h('div', { style: styles.itemName }, h('span', { style: styles.dot(COLORS.role) }), item.name),
            h('div', { style: styles.meta }, `${item.runtime.length} 可用 · ${item.red.length} 缺失`))),
            h('div', { style: styles.title }, `技能 · ${list.skills.length}`),
            h('input', {
              value: filter,
              onChange: event => setFilter(event.target.value),
              placeholder: '过滤技能…',
              style: { ...styles.select, width: '92%', margin: '0 4px 8px' },
            }),
            list.skills
              .filter(skill => filter === '' || skill.name.includes(filter))
              .map(skill => {
                const member = roleReady && (plan.members ?? []).includes(skill.name)
                const stateColor = !roleReady ? COLORS.member
                  : (plan.red ?? []).includes(skill.name) ? COLORS.red
                    : (plan.gray ?? []).some(row => row.name === skill.name) ? COLORS.gray
                      : member ? COLORS.runtime : COLORS.member
                return h('div', {
                  key: skill.name,
                  style: styles.item(selectedSkill === skill.name),
                  onClick: () => setSelectedSkill(skill.name),
                },
                h('div', { style: styles.itemName }, h('span', { style: styles.dot(stateColor) }), skill.name),
                h('div', { style: styles.meta }, member ? '已纳入' : (skill.source ?? '')))
              })),

          h('div', { style: styles.detail },
            role === undefined
              ? h('div', { style: styles.empty }, '选择左侧角色后，可查看并编辑技能连线。')
              : h(SkillDetail, {
                role, plan, health, skills: list.skills, skillName: selectedSkill,
                pending, error, linkTarget, setLinkTarget, send,
              }))))
    }

    function SkillDetail({ role, plan, health, skills, skillName, pending, error, linkTarget, setLinkTarget, send }) {
      if (skillName === undefined) {
        const summary = [
          h('h2', { key: 'h', style: styles.h2 }, role.name),
          h('div', { key: 'm', style: styles.muted },
            `revision ${role.revision} · 闭包 ${plan.closure.length} · 目录约 ${plan.catalogChars} 字符`),
          h('div', { key: 'e', style: { ...styles.empty, marginTop: 12 } }, '点击上图节点或下方技能，编辑它的依赖关系。'),
        ]
        if (error !== undefined) summary.push(h('div', { key: 'err', style: styles.error }, error))
        return h('div', null, summary)
      }

      const members = plan.members ?? []
      const member = members.includes(skillName)
      const info = (skills ?? []).find(skill => skill.name === skillName)
      const outgoing = (role.edges ?? []).filter(edge => edge.from === skillName)
      const incoming = (role.edges ?? []).filter(edge => edge.to === skillName)
      const candidates = members.filter(name => name !== skillName)

      const stateLabel = (plan.red ?? []).includes(skillName)
        ? '缺失（红）'
        : (plan.gray ?? []).some(row => row.name === skillName) ? '受阻（灰）' : member ? '可用' : '未纳入'

      const children = [
        h('h2', { key: 'name', style: styles.h2 }, skillName),
        h('div', { key: 'state', style: styles.muted }, `${stateLabel}${info?.source ? ` · ${info.source}` : ''}`),
      ]
      if (info?.description) children.push(h('div', { key: 'desc', style: { ...styles.muted, marginTop: 6 } }, info.description))
      if (error !== undefined) children.push(h('div', { key: 'err', style: styles.error }, error))

      children.push(h('div', { key: 'member', style: styles.section },
        h('button', {
          style: { ...styles.button(!pending), marginLeft: 0 },
          disabled: pending,
          onClick: () => void send('members', member
            ? { action: 'remove_members', remove: [skillName] }
            : { action: 'add_members', add: [skillName] }),
        }, member ? '从角色中移除' : '纳入该角色')))

      const outgoingRows = outgoing.map((edge, index) => h('div', { key: `o${index}`, style: styles.line }, [
        h('span', { key: 'to', style: styles.mono }, edge.to),
        edge.why ? h('span', { key: 'why', style: styles.muted }, edge.why) : null,
        h('button', {
          key: 'del',
          style: styles.button(!pending),
          disabled: pending,
          onClick: () => void send('edges', { action: 'unlink', from: edge.from, to: edge.to }),
        }, '删除'),
      ]))

      children.push(h('div', { key: 'out', style: styles.section }, [
        h('div', { key: 'title', style: styles.sectionTitle }, `它依赖 · ${outgoing.length}`),
        outgoing.length === 0 ? h('div', { key: 'none', style: styles.empty }, '没有依赖。') : null,
        ...outgoingRows,
        h('div', { key: 'add', style: { ...styles.line, borderBottom: 'none', paddingTop: 8 } }, [
          h('select', {
            key: 'pick',
            value: linkTarget,
            onChange: event => setLinkTarget(event.target.value),
            style: styles.select,
          }, [
            h('option', { key: '', value: '' }, '选择被依赖的技能…'),
            ...candidates.map(name => h('option', { key: name, value: name }, name)),
          ]),
          h('button', {
            key: 'go',
            style: styles.button(!pending && linkTarget !== '' && member),
            disabled: pending || linkTarget === '' || !member,
            onClick: () => {
              void send('edges', { action: 'link', from: skillName, to: linkTarget })
              setLinkTarget('')
            },
          }, '添加依赖'),
        ]),
      ]))

      const incomingRows = incoming.map((edge, index) => h('div', { key: `i${index}`, style: styles.line }, [
        h('span', { key: 'from', style: styles.mono }, edge.from),
        edge.why ? h('span', { key: 'why', style: styles.muted }, edge.why) : null,
        h('button', {
          key: 'del',
          style: styles.button(!pending),
          disabled: pending,
          onClick: () => void send('edges', { action: 'unlink', from: edge.from, to: edge.to }),
        }, '删除'),
      ]))

      children.push(h('div', { key: 'in', style: styles.section }, [
        h('div', { key: 'title', style: styles.sectionTitle }, `被依赖 · ${incoming.length}`),
        incoming.length === 0 ? h('div', { key: 'none', style: styles.empty }, '没有其他技能依赖它。') : null,
        ...incomingRows,
      ]))

      return h('div', null, children)
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'skill-loom',
          order: 5,
          label: () => '技能编排',
        }, SidebarIcon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'skill-loom',
        }, RolePage))
      },
    }
  },
})
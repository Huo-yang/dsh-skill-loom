window.__ModuleLoader__.load({
  id: 'dsh-skill-loom',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const API = '/skill-loom'

    const STATE_COLORS = {
      runtime: '#2ea043',
      red: '#d1242f',
      gray: '#8b949e',
      member: '#1f6feb',
    }

    const styles = {
      page: {
        display: 'flex',
        height: '100%',
        minHeight: 0,
        font: 'inherit',
        color: 'inherit',
      },
      list: {
        width: 260,
        flex: '0 0 260px',
        borderRight: '1px solid var(--dsw-border-subtle, rgba(127,127,127,.24))',
        overflowY: 'auto',
        padding: '12px 8px',
      },
      detail: { flex: '1 1 auto', overflowY: 'auto', padding: '16px 20px', minWidth: 0 },
      title: { fontSize: 13, fontWeight: 600, opacity: 0.7, padding: '4px 8px 10px' },
      row: active => ({
        padding: '8px 10px',
        borderRadius: 6,
        cursor: 'pointer',
        background: active ? 'var(--dsw-surface-raised, rgba(127,127,127,.14))' : 'transparent',
        marginBottom: 2,
      }),
      rowName: { fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 },
      meta: { fontSize: 11, opacity: 0.62, marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' },
      h2: { fontSize: 15, margin: '0 0 4px' },
      muted: { fontSize: 12, opacity: 0.62 },
      section: { marginTop: 18 },
      sectionTitle: { fontSize: 12, fontWeight: 600, opacity: 0.7, marginBottom: 8 },
      dot: color => ({
        width: 8, height: 8, borderRadius: 4, background: color, display: 'inline-block', flex: '0 0 auto',
      }),
      skillRow: {
        display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 0',
        borderBottom: '1px solid var(--dsw-border-subtle, rgba(127,127,127,.14))',
      },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 12 },
      issue: sev => ({
        fontSize: 12,
        padding: '6px 8px',
        marginBottom: 6,
        borderRadius: 5,
        borderLeft: `3px solid ${sev === 'error' ? STATE_COLORS.red : '#bf8700'}`,
        background: 'var(--dsw-surface-raised, rgba(127,127,127,.1))',
      }),
      empty: { fontSize: 13, opacity: 0.6, padding: 12 },
    }

    const counts = role => `${role.runtime.length} 可用 · ${role.red.length} 缺失 · ${role.gray.length} 受阻`

    function SidebarIcon() {
      return h('svg', {
        viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true,
        style: { display: 'block' },
      }, h('path', {
        d: 'M2 3.5h5v5H2zM9 3.5h5v2H9zM9 6.5h5v5H9zM2 10.5h5v2H2z',
        fill: 'currentColor', opacity: 0.85,
      }))
    }

    function RolePage() {
      const [data, setData] = useState({ status: 'loading', roles: [], skills: [] })
      const [selected, setSelected] = useState(undefined)
      const [detail, setDetail] = useState({ status: 'idle' })

      const load = useCallback(async () => {
        try {
          const response = await fetch(`${API}/roles`, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const body = await response.json()
          setData({ status: 'ready', roles: body.roles ?? [], skills: body.skills ?? [] })
        } catch (error) {
          setData({ status: 'error', error: String(error), roles: [], skills: [] })
        }
      }, [])

      useEffect(() => {
        void load()
      }, [load])

      useEffect(() => {
        if (selected === undefined) {
          setDetail({ status: 'idle' })
          return undefined
        }
        let cancelled = false
        setDetail({ status: 'loading' })
        void (async () => {
          try {
            const response = await fetch(`${API}/roles/${encodeURIComponent(selected)}`, { headers: { accept: 'application/json' } })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const body = await response.json()
            if (!cancelled) setDetail({ status: 'ready', ...body })
          } catch (error) {
            if (!cancelled) setDetail({ status: 'error', error: String(error) })
          }
        })()
        return () => {
          cancelled = true
        }
      }, [selected])

      const roles = data.roles
      const active = detail.status === 'ready' ? detail.role : undefined

      return h('div', { style: styles.page },
        h('div', { style: styles.list },
          h('div', { style: styles.title }, `角色 · ${roles.length}`),
          data.status === 'error'
            ? h('div', { style: styles.empty }, `读取失败：${data.error}`)
            : null,
          data.status === 'ready' && roles.length === 0
            ? h('div', { style: styles.empty }, '还没有角色。让 agent 用 role_graph 建一个，刷新即可看到。')
            : null,
          roles.map(role => h('div', {
            key: role.id,
            style: styles.row(selected === role.id),
            onClick: () => setSelected(role.id),
            role: 'button',
            tabIndex: 0,
            onKeyDown: event => {
              if (event.key === 'Enter' || event.key === ' ') setSelected(role.id)
            },
          },
          h('div', { style: styles.rowName },
            h('span', { style: styles.dot(STATE_COLORS.member) }),
            role.name),
          h('div', { style: styles.meta }, counts(role)))))
        ,
        h('div', { style: styles.detail },
          active === undefined
            ? h('div', { style: styles.empty },
              detail.status === 'loading' ? '加载中…' : '从左侧选择一个角色查看编排。')
            : renderDetail(active, detail)))

      function renderDetail(role, payload) {
        const plan = payload.plan
        const runtime = new Set(plan.runtime)
        const red = new Set(plan.red)
        const gray = new Set(plan.gray.map(row => row.name))
        const members = plan.members ?? []
        const extra = plan.toAdd ?? []

        const stateOf = name => (red.has(name) ? 'red' : gray.has(name) ? 'gray' : runtime.has(name) ? 'runtime' : 'member')
        const stateLabel = { runtime: '可用', red: '缺失', gray: '受阻', member: '未纳入' }

        return h('div', null,
          h('h2', { style: styles.h2 }, role.name),
          h('div', { style: styles.muted },
            `revision ${role.revision} · 闭包 ${plan.closure.length} · 目录约 ${plan.catalogChars} 字符`),

          h('div', { style: styles.section },
            h('div', { style: styles.sectionTitle }, '技能'),
            members.length === 0
              ? h('div', { style: styles.empty }, '这个角色没有纳入任何技能（会话将看不到任何技能）。')
              : null,
            [...members, ...extra].map(name => {
              const state = stateOf(name)
              const anchor = plan.anchors?.[name]
              const missing = plan.missing?.missing?.find(row => row.name === name)
              const path = missing?.path ?? anchor?.path
              return h('div', { key: name, style: styles.skillRow },
                h('span', { style: styles.dot(STATE_COLORS[state] ?? STATE_COLORS.member) }),
                h('span', { style: styles.mono }, name),
                h('span', { style: styles.muted }, stateLabel[state] ?? ''),
                path === undefined ? null : h('span', { style: { ...styles.muted, ...styles.mono, opacity: 0.45 } }, path))
            })),

          (role.edges ?? []).length === 0
            ? null
            : h('div', { style: styles.section },
              h('div', { style: styles.sectionTitle }, `依赖 · ${role.edges.length}`),
              role.edges.map((edge, index) => h('div', { key: index, style: styles.skillRow },
                h('span', { style: styles.mono }, edge.from),
                h('span', { style: styles.muted }, '→'),
                h('span', { style: styles.mono }, edge.to),
                edge.why === undefined ? null : h('span', { style: styles.muted }, edge.why)))),

          (plan.issues ?? []).length === 0
            ? null
            : h('div', { style: styles.section },
              h('div', { style: styles.sectionTitle }, `校验 · ${plan.issues.length}`),
              plan.issues.map((issue, index) => h('div', {
                key: index,
                style: styles.issue(issue.severity),
              }, `[${issue.code}] ${issue.message}`))))
      }
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

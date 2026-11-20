window.__ModuleLoader__.load({
  id: 'dsh-skill-loom',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useMemo, useRef } = React

    const API = '/skill-loom'
    const NODE_W = 150
    const NODE_H = 34
    const GAP_X = 26
    const ROW_H = 78

    const COLORS = { runtime: '#2ea043', red: '#d1242f', gray: '#8b949e', member: '#1f6feb', role: '#8250df' }

    const styles = {
      stage: { position: 'relative', height: '100%', minHeight: 0, font: 'inherit', color: 'inherit', overflow: 'hidden' },
      canvasFill: {
        position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 1,
        display: 'flex', alignItems: 'safe center', justifyContent: 'safe center',
        // Bias the initial view a little above the geometric centre: a graph
        // that starts dead-centre reads as bottom-heavy once rows are added.
        paddingBottom: '12vh',
        background: 'linear-gradient(rgba(0,0,0,.025), rgba(0,0,0,.025)), var(--dsw-alias-bg-base, #ffffff)',
        // Without this a right-drag starts a text selection and the highlight
        // fights the panning gesture.
        userSelect: 'none', WebkitUserSelect: 'none',
      },
      roleCard: {
        position: 'absolute', top: 12, left: 12, width: 240, padding: '10px 12px',
        borderRadius: 10, background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.28))',
        boxShadow: '0 4px 16px rgba(0,0,0,.10)', display: 'flex', flexDirection: 'column', zIndex: 2,
      },
      cardHead: {
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
        fontSize: 12, fontWeight: 600, opacity: 0.7,
        cursor: 'grab', userSelect: 'none', touchAction: 'none',
      },
      cardTitle: { fontSize: 12, fontWeight: 600, opacity: 0.7, marginBottom: 8 },
      panel: {
        position: 'absolute', top: 12, right: 12, bottom: 12, width: 340,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        borderRadius: 10, background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.28))',
        boxShadow: '0 4px 16px rgba(0,0,0,.10)', zIndex: 2,
      },
      panelHead: { padding: '10px 10px 6px', display: 'flex', gap: 6 },
      skillScroll: {
        maxHeight: '38%', overflowY: 'auto', padding: '0 8px',
        borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.2))',
      },
      panelBody: { flex: '1 1 auto', overflowY: 'auto', padding: '12px 14px' },
      title: { fontSize: 12, fontWeight: 600, opacity: 0.7, padding: '2px 8px 8px' },
      item: active => ({
        padding: '6px 8px', borderRadius: 5, cursor: 'pointer', marginBottom: 2,
        background: active ? 'var(--dsw-alias-bg-multi-select, rgba(0,0,0,.06))' : 'transparent',
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
        borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.12))',
      },
      button: enabled => ({
        marginLeft: 'auto', fontSize: 11, padding: '0 8px', height: 20, borderRadius: 4,
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35))',
        background: 'transparent', color: 'inherit', cursor: enabled ? 'pointer' : 'default',
        opacity: enabled ? 1 : 0.45,
      }),
      select: {
        fontSize: 12, height: 22, maxWidth: 200,
        background: 'var(--dsw-alias-bg-layer-1, #ffffff)', color: 'inherit',
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35))', borderRadius: 4,
      },
      dot: color => ({ width: 8, height: 8, borderRadius: 4, background: color, display: 'inline-block', flex: '0 0 auto' }),
      error: {
        fontSize: 12, padding: '8px 10px', margin: '8px 0', borderRadius: 5,
        borderLeft: `3px solid ${COLORS.red}`, background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1))',
      },
      empty: { fontSize: 12, opacity: 0.6, padding: '8px 2px' },
      trashZone: {
        position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)',
        padding: '10px 22px', borderRadius: 10, border: '2px dashed ' + COLORS.red,
        color: COLORS.red, fontSize: 12, fontWeight: 600, pointerEvents: 'none',
        background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
        boxShadow: '0 4px 16px rgba(0,0,0,.12)', zIndex: 5,
      },
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
        // Dependencies sit nearest the role; consumers hang below them. `level 0`
        // is a base skill, so it is the row right under the role node.
        const y = level * ROW_H + NODE_H
        positions.set(name, { x, y })
      }
      place('__role__', 0, 0, 1)
      for (const [level, row] of rows) row.forEach((name, index) => place(name, level + 1, index, row.length))

      const height = (maxLevel + 2) * ROW_H + NODE_H + 20
      return { width, height, positions, roleLevel }
    }

    function Graph({ role, plan, selected, onSelect, onCreateEdge, onRemoveEdge, onRemovalDrag, onRemoveDrop, onDropOnNode }) {
      const geom = useMemo(() => layout(role, plan), [role, plan])
      const svgRef = useRef(undefined)
      const [drag, setDrag] = useState(undefined)
      const [dropTarget, setDropTarget] = useState(undefined)
      // Dragging an edge by its midpoint detaches it; releasing anywhere removes it.
      const [edgeDrag, setEdgeDrag] = useState(undefined)

      const red = new Set(plan.red ?? [])
      const gray = new Set((plan.gray ?? []).map(row => row.name))
      const runtime = new Set(plan.runtime ?? [])
      const colorOf = name => (red.has(name) ? COLORS.red : gray.has(name) ? COLORS.gray
        : runtime.has(name) ? COLORS.runtime : COLORS.member)

      const pointOf = event => {
        const rect = svgRef.current?.getBoundingClientRect()
        if (rect === undefined) return { x: 0, y: 0 }
        return { x: event.clientX - rect.left, y: event.clientY - rect.top }
      }
      const nodeAt = (x, y) => {
        for (const [name, position] of geom.positions) {
          if (Math.abs(x - position.x) <= NODE_W / 2 && y >= position.y - NODE_H && y <= position.y) return name
        }
        return undefined
      }

      const beginEdgeDrag = (index, edge) => event => {
        if (event.button !== 0) return
        event.stopPropagation()
        svgRef.current?.setPointerCapture?.(event.pointerId)
        const point = pointOf(event)
        setEdgeDrag({ index, edge, ox: point.x, oy: point.y, x: point.x, y: point.y, moved: false })
      }

      const beginLink = (name, requested) => event => {
        if (event.button !== 0) return
        event.stopPropagation()
        svgRef.current?.setPointerCapture?.(event.pointerId)
        const point = pointOf(event)
        // The grip carries the box (and feeds the trash zone); the body draws a
        // connection. Separating by handle keeps one gesture from stealing the
        // other, without demanding a modifier key.
        const mode = requested === 'move' && name !== '__role__' ? 'move' : 'link'
        setDrag({ from: name, mode, ox: point.x, oy: point.y, x: point.x, y: point.y, moved: false })
        if (mode === 'move') onRemovalDrag(true)
      }
      const moveLink = event => {
        const point = pointOf(event)
        if (edgeDrag !== undefined) {
          const moved = edgeDrag.moved || Math.abs(point.x - edgeDrag.ox) + Math.abs(point.y - edgeDrag.oy) > 6
          setEdgeDrag({ ...edgeDrag, x: point.x, y: point.y, moved })
          return
        }
        if (drag === undefined) return
        const moved = drag.moved || Math.abs(point.x - drag.ox) + Math.abs(point.y - drag.oy) > 6
        setDrag({ ...drag, x: point.x, y: point.y, moved })
      }
      const endLink = event => {
        if (edgeDrag !== undefined) {
          svgRef.current?.releasePointerCapture?.(event.pointerId)
          if (edgeDrag.moved) onRemoveEdge(edgeDrag.edge)
          setEdgeDrag(undefined)
          return
        }
        if (drag === undefined) return
        svgRef.current?.releasePointerCapture?.(event.pointerId)
        const point = pointOf(event)
        const target = nodeAt(point.x, point.y)
        if (drag.moved) {
          if (drag.mode === 'move') {
            // Removal happens only inside the drop zone the page shows while this
            // gesture is active; anywhere else simply returns the node.
            onRemovalDrag(false)
            onRemoveDrop(drag.from, event.clientX, event.clientY)
          } else if (drag.mode === 'link' && target !== undefined && target !== drag.from) {
            onCreateEdge(drag.from, target)
          }
        } else {
          if (drag.mode === 'move') onRemovalDrag(false)
          onSelect(drag.from === '__role__' ? undefined : drag.from)
        }
        setDrag(undefined)
      }

      const edges = []
      for (const name of plan.members ?? []) edges.push({ from: '__role__', to: name, include: true })
      for (const edge of role.edges ?? []) edges.push({ from: edge.from, to: edge.to })

      // Curves read better than right angles here: an orthogonal route adds long
      // horizontal runs and corners that compete with the node boxes for
      // attention. The arrowhead carries the direction instead.
      const pathOf = edge => {
        const a = geom.positions.get(edge.from)
        const b = geom.positions.get(edge.to)
        if (a === undefined || b === undefined) return undefined

        if (Math.abs(a.y - b.y) < 1) {
          const y = a.y - NODE_H / 2
          const rightward = b.x > a.x
          const x1 = a.x + (rightward ? NODE_W / 2 : -NODE_W / 2)
          const x2 = b.x + (rightward ? -NODE_W / 2 : NODE_W / 2)
          const bend = (x2 - x1) / 2
          return {
            d: `M ${x1} ${y} C ${x1 + bend} ${y}, ${x2 - bend} ${y}, ${x2} ${y}`,
            from: { x: x1, y },
            to: { x: x2, y },
            mid: { x: (x1 + x2) / 2, y },
          }
        }

        const targetAbove = b.y < a.y
        const fromY = targetAbove ? a.y - NODE_H : a.y
        const toY = targetAbove ? b.y : b.y - NODE_H
        const bendY = (fromY + toY) / 2
        return {
          d: `M ${a.x} ${fromY} C ${a.x} ${bendY}, ${b.x} ${bendY}, ${b.x} ${toY}`,
          from: { x: a.x, y: fromY },
          to: { x: b.x, y: toY },
          mid: { x: (a.x + b.x) / 2, y: bendY },
        }
      }
      const nodes = [{ name: '__role__', label: role.name, kind: 'role' },
        ...(plan.members ?? []).map(name => ({ name, label: name, kind: 'skill' }))]

      const sourcePos = drag === undefined ? undefined : geom.positions.get(drag.from)

      return h('svg', {
        ref: svgRef,
        viewBox: `0 0 ${geom.width} ${geom.height}`,
        width: geom.width,
        height: geom.height,
        role: 'img',
        'aria-label': `${role.name} 的依赖图`,
        // Without overflow: visible the root SVG clips to its viewBox, so a node
        // carried past the canvas edge simply disappears.
        style: { display: 'block', margin: '0 auto', touchAction: 'none', overflow: 'visible' },
        onPointerMove: moveLink,
        onPointerUp: endLink,
        onPointerCancel: () => setDrag(undefined),
      },

      edges.map((edge, index) => {
        const route = pathOf(edge)
        if (route === undefined) return null
        const dragging = edgeDrag !== undefined && edgeDrag.index === index && edgeDrag.moved
        return h('g', { key: `e${index}` },
          h('path', {
            d: dragging ? `M ${route.from.x} ${route.from.y} L ${edgeDrag.x} ${edgeDrag.y}` : route.d,
            fill: 'none',
            stroke: dragging ? COLORS.red : 'currentColor',
            strokeOpacity: dragging ? 0.9 : edge.include ? 0.22 : 0.5,
            strokeWidth: dragging ? 1.8 : 1.4,
            strokeDasharray: edge.include || dragging ? '4 3' : undefined,
          }),
          // Only a real dependency can be detached; an include line is membership.
          edge.include || dragging
            ? null
            : h('circle', {
                cx: route.mid.x,
                cy: route.mid.y,
                r: 7,
                fill: 'transparent',
                stroke: 'currentColor',
                strokeOpacity: 0.16,
                style: { cursor: 'grab' },
                onPointerDown: beginEdgeDrag(index, edge),
              }))
      }),

      drag !== undefined && drag.moved && drag.mode === 'link' && sourcePos !== undefined
        ? h('line', {
            x1: sourcePos.x, y1: sourcePos.y, x2: drag.x, y2: drag.y,
            stroke: drag.mode === 'remove' ? COLORS.red : 'currentColor',
            strokeOpacity: 0.7, strokeDasharray: '5 4', strokeWidth: 1.4,
          })
        : null,

      nodes.map(node => {
        const position = geom.positions.get(node.name)
        if (position === undefined) return null
        const active = selected === node.name
        const stateColor = node.kind === 'role' ? COLORS.role : colorOf(node.name)
        const isDropTarget = dropTarget === node.name
        const ghosting = drag !== undefined && drag.from === node.name && drag.mode === 'move'
        const removing = ghosting && drag.moved
        const ghost = ghosting ? { dx: drag.x - drag.ox, dy: drag.y - drag.oy } : { dx: 0, dy: 0 }
        return h('g', { key: node.name }, [
          // The placeholder stays at the node's original cell while its box is
          // being carried, so the layout never looks like it lost a node.
          ghosting
            ? h('rect', {
                key: 'placeholder',
                x: position.x - NODE_W / 2, y: position.y - NODE_H,
                width: NODE_W, height: NODE_H, rx: 6,
                fill: 'none', stroke: 'currentColor', strokeOpacity: 0.3,
                strokeDasharray: '5 4', strokeWidth: 1,
              })
            : null,
          h('g', {
            key: 'node',
            transform: `translate(${position.x - NODE_W / 2 + ghost.dx}, ${position.y - NODE_H + ghost.dy})`,
            opacity: removing ? 0.7 : 1,
            onPointerDown: beginLink(node.name, 'link'),
            style: { cursor: 'grab' },
            onDragOver: event => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'link'
              setDropTarget(node.name)
            },
            onDragLeave: () => setDropTarget(current => (current === node.name ? undefined : current)),
            onDrop: event => {
              event.preventDefault()
              setDropTarget(undefined)
              const payload = event.dataTransfer.getData('text/plain')
              if (payload !== '') onDropOnNode(payload, node.name)
            },
          }, [
            h('rect', {
              key: 'box',
              width: NODE_W, height: NODE_H, rx: 6,
              fill: 'var(--dsw-alias-bg-layer-1, #ffffff)',
              stroke: removing ? COLORS.red : isDropTarget || active ? COLORS.role : 'currentColor',
              strokeOpacity: removing || isDropTarget || active ? 1 : 0.25,
              strokeWidth: removing || isDropTarget || active ? 2 : 1,
              strokeDasharray: isDropTarget ? '5 3' : undefined,
            }),
            h('circle', { key: 'dot', cx: 14, cy: NODE_H / 2, r: 4, fill: stateColor }),
            h('text', {
              key: 'label',
              x: 26, y: NODE_H / 2 + 4, fontSize: 12, fill: 'currentColor',
              style: { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' },
            }, node.label.length > 17 ? `${node.label.slice(0, 16)}…` : node.label),
            node.kind === 'role' ? null : h('g', {
              key: 'grip',
              onPointerDown: beginLink(node.name, 'move'),
              style: { cursor: 'grab' },
            }, [
              h('title', { key: 'tip' }, '拖动握把搬走节点，放到删除区即移除'),
              h('circle', {
                key: 'knob', cx: -9, cy: NODE_H / 2, r: 7,
                fill: 'var(--dsw-alias-bg-layer-2, #ffffff)',
                stroke: 'currentColor', strokeOpacity: 0.35, strokeWidth: 1,
              }),
              h('circle', { key: 'd1', cx: -9, cy: NODE_H / 2 - 3.2, r: 1.3, fill: 'currentColor', fillOpacity: 0.45 }),
              h('circle', { key: 'd2', cx: -9, cy: NODE_H / 2, r: 1.3, fill: 'currentColor', fillOpacity: 0.45 }),
              h('circle', { key: 'd3', cx: -9, cy: NODE_H / 2 + 3.2, r: 1.3, fill: 'currentColor', fillOpacity: 0.45 }),
            ]),
          ]),
        ])
      }))
    }
    function RolePage({ compact = false } = {}) {
      const [list, setList] = useState({ status: 'loading', roles: [], skills: [] })
      const [selectedRole, setSelectedRole] = useState(undefined)
      const [detail, setDetail] = useState({ status: 'idle' })
      const [selectedSkill, setSelectedSkill] = useState(undefined)
      const [pending, setPending] = useState(false)
      const [error, setError] = useState(undefined)
      const [filter, setFilter] = useState('')
      const [linkTarget, setLinkTarget] = useState('')
      const [cardCollapsed, setCardCollapsed] = useState(false)
      const [sessions, setSessions] = useState([])
      const [removalActive, setRemovalActive] = useState(false)
      const zoneRef = useRef(undefined)
      const cardKey = compact ? 'skill-loom:card-compact' : 'skill-loom:card'
      const [cardPos, setCardPos] = useState(() => {
        try {
          const saved = JSON.parse(globalThis.localStorage?.getItem(cardKey) ?? 'null')
          if (saved !== null && typeof saved.x === 'number' && typeof saved.y === 'number') return saved
        } catch {
          // A blocked or corrupt preference simply keeps the default position.
        }
        return { x: 12, y: 12 }
      })
      const dragRef = useRef(undefined)
      const [dragging, setDragging] = useState(false)

      const startDrag = event => {
        dragRef.current = { dx: event.clientX - cardPos.x, dy: event.clientY - cardPos.y }
        setDragging(true)
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }
      const moveDrag = event => {
        const drag = dragRef.current
        if (drag === undefined) return
        setCardPos({ x: Math.max(0, event.clientX - drag.dx), y: Math.max(0, event.clientY - drag.dy) })
      }
      const endDrag = event => {
        if (dragRef.current === undefined) return
        dragRef.current = undefined
        setDragging(false)
        event.currentTarget.releasePointerCapture?.(event.pointerId)
        try {
          globalThis.localStorage?.setItem(cardKey, JSON.stringify(cardPos))
        } catch {
          // Persisting the position is a convenience, never a requirement.
        }
      }

      // Right-drag pans the canvas. Scroll offsets are used rather than a CSS
      // transform so the browser keeps its scrollbars and wheel scrolling intact.
      const canvasRef = useRef(undefined)
      const panRef = useRef(undefined)
      const [panning, setPanning] = useState(false)
      const [pan, setPan] = useState({ x: 0, y: 0 })

      const startPan = event => {
        // Middle drag only: browsers (and some trackpad drivers) claim the right
        // button for their own gestures, so panning on right-drag collides.
        if (event.button !== 1) return
        const element = canvasRef.current
        if (element === undefined) return
        event.preventDefault()
        panRef.current = {
          x: event.clientX,
          y: event.clientY,
          px: pan.x,
          py: pan.y,
        }
        element.setPointerCapture?.(event.pointerId)
        setPanning(true)
      }
      const movePan = event => {
        const start = panRef.current
        if (start === undefined) return
        const element = canvasRef.current
        // Bound the pan to a fraction of the viewport: the graph can be pushed
        // aside but never dragged out of reach.
        const maxX = element === undefined ? 0 : element.clientWidth * 0.6
        const maxY = element === undefined ? 0 : element.clientHeight * 0.6
        const clamp = (value, max) => Math.max(-max, Math.min(max, value))
        setPan({
          x: clamp(start.px + (event.clientX - start.x), maxX),
          y: clamp(start.py + (event.clientY - start.y), maxY),
        })
      }
      const endPan = event => {
        if (panRef.current === undefined) return
        panRef.current = undefined
        setPanning(false)
        canvasRef.current?.releasePointerCapture?.(event.pointerId)
      }

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

      const loadSessions = useCallback(async () => {
        try {
          const response = await fetch(`${API}/sessions`, { headers: { accept: 'application/json' } })
          if (!response.ok) return
          const body = await response.json()
          setSessions(body.sessions ?? [])
        } catch {
          // The session tray is an affordance, not a requirement.
        }
      }, [])

      useEffect(() => { void loadList() }, [loadList])
      useEffect(() => { void loadSessions() }, [loadSessions])

      useEffect(() => {
        if (selectedRole === undefined) {
          setDetail({ status: 'idle' })
          return
        }
        setDetail({ status: 'loading' })
        void loadDetail(selectedRole)
      }, [selectedRole, loadDetail])

      // Keep a role selected once the list arrives, so the canvas is never empty
      // by accident.
      useEffect(() => {
        if (selectedRole !== undefined) return
        const first = list.roles[0]
        if (first !== undefined) setSelectedRole(first.id)
      }, [list, selectedRole])

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

      const bindSession = async sessionId => {
        const current = detail.role
        if (current === undefined) return
        setPending(true)
        setError(undefined)
        try {
          const response = await fetch(`${API}/sessions/bind`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, roleId: current.id }),
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(body.message ?? body.error ?? `HTTP ${response.status}`)
          await Promise.all([loadSessions(), loadDetail(current.id)])
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setPending(false)
        }
      }

      const unbindSession = async sessionId => {
        setPending(true)
        setError(undefined)
        try {
          const response = await fetch(`${API}/sessions/unbind`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          await loadSessions()
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setPending(false)
        }
      }

      const deleteRole = async () => {
        const current = detail.role
        if (current === undefined) return
        setPending(true)
        setError(undefined)
        try {
          const response = await fetch(`${API}/roles/${encodeURIComponent(current.id)}/delete`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expectedRevision: current.revision }),
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok) {
            throw new Error(body.error === 'conflict'
              ? '这个角色刚被别处修改过，请刷新后再操作'
              : (body.message ?? body.error ?? `HTTP ${response.status}`))
          }
          setSelectedRole(undefined)
          setSelectedSkill(undefined)
          setDetail({ status: 'idle' })
          await Promise.all([loadList(), loadSessions()])
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setPending(false)
        }
      }

      const dropToRemove = (name, clientX, clientY) => {
        // Measure before hiding the zone; the ref is still bound to the element
        // that the drop landed on.
        const rect = zoneRef.current?.getBoundingClientRect()
        setRemovalActive(false)
        if (rect === undefined) return
        const inside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
        if (inside) void send('members', { action: 'remove_members', remove: [name] })
      }

      const dropOnNode = (payload, target) => {
        const separator = payload.indexOf(':')
        if (separator < 0) return
        const kind = payload.slice(0, separator)
        const value = payload.slice(separator + 1)
        const onRole = target === '__role__'

        if (kind === 'session') {
          // A session belongs to a role, not to a skill.
          if (onRole) void bindSession(value)
          return
        }
        if (kind !== 'skill') return
        if (onRole) void send('members', { action: 'add_members', add: [value] })
        // Dropping A onto B means A depends on B: the dragged skill is the
        // dependent, the node it lands on is the dependency.
        else if (value !== target) void send('edges', { action: 'link', from: value, to: target })
      }

      const roleReady = detail.status === 'ready'
      const role = roleReady ? detail.role : undefined
      const plan = roleReady ? detail.plan : undefined

      const filtered = list.skills.filter(skill => filter === '' || skill.name.includes(filter))

      // A right-sidebar pane is narrow, so the same page stacks vertically there
      // instead of floating two absolute panels.
      const stageStyle = { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative', font: 'inherit', color: 'inherit', overflow: 'hidden' }
      const canvasStyle = compact
        ? { ...styles.canvasFill, position: 'relative', inset: 'auto', flex: '1 1 auto', minHeight: 160, paddingRight: 0 }
        : { ...styles.canvasFill, position: 'relative', inset: 'auto', flex: '1 1 auto', minHeight: 200, paddingRight: 356 }
      const cardStyle = compact
        ? { ...styles.roleCard, left: cardPos.x, top: cardPos.y, zIndex: 2 }
        : { ...styles.roleCard, left: cardPos.x, top: cardPos.y }
      const panelStyle = compact
        ? { ...styles.panel, position: 'relative', top: 'auto', right: 'auto', bottom: 'auto', width: 'auto', flex: '1 1 48%', minHeight: 0, borderRadius: 0, border: 'none', boxShadow: 'none', zIndex: 1 }
        : { ...styles.panel, zIndex: 2 }
      const listStyle = styles.skillScroll

      return h('div', { style: stageStyle },
        h('div', {
          ref: canvasRef,
          style: {
            ...canvasStyle,
            // While a node is being carried it must stay above the floating panels.
            ...(removalActive ? { zIndex: 4 } : {}),
            cursor: panning ? 'grabbing' : 'default',
          },
          onPointerDown: startPan,
          onPointerMove: movePan,
          onPointerUp: endPan,
          onPointerCancel: endPan,
          onSelectStart: event => event.preventDefault(),
          onDragStart: event => event.preventDefault(),
        },
          h('div', {
            style: {
              transform: `translate(${pan.x}px, ${pan.y}px)`,
              width: 'fit-content',
              margin: '0 auto',
            },
          }, [
            roleReady
              ? h(Graph, {
                  key: 'graph',
                  role,
                  plan,
                  selected: selectedSkill,
                  onSelect: setSelectedSkill,
                  onCreateEdge: (from, to) => {
                    // Either direction against the role node means "include this
                    // skill"; skill-to-skill means "requires".
                    if (from === '__role__') void send('members', { action: 'add_members', add: [to] })
                    else if (to === '__role__') void send('members', { action: 'add_members', add: [from] })
                    else void send('edges', { action: 'link', from, to })
                  },
                  onDropOnNode: dropOnNode,
                  onRemoveEdge: edge => void send('edges', { action: 'unlink', from: edge.from, to: edge.to }),
                  onRemovalDrag: setRemovalActive,
                  onRemoveDrop: dropToRemove,
                })
              : h('div', { key: 'empty', style: { ...styles.empty, padding: 24 } },
                detail.status === 'error' ? detail.error
                  : detail.status === 'loading' ? '加载中…'
                    : list.status === 'ready' && list.roles.length === 0
                      ? '还没有角色。让 agent 用 role_graph 建一个，刷新即可看到。'
                      : '选择一个角色查看依赖图'),
          ])),

        removalActive ? h('div', { ref: zoneRef, style: styles.trashZone }, '拖到此处移除') : null,
        h('div', { style: cardStyle }, [
          h('div', {
            key: 'head',
            style: { ...styles.cardHead, cursor: dragging ? 'grabbing' : 'grab' },
            onPointerDown: startDrag,
            onPointerMove: moveDrag,
            onPointerUp: endDrag,
            onPointerCancel: endDrag,
            title: '拖动可移动面板',
          }, [
            h('span', { key: 'g', style: { opacity: 0.5 } }, '⠿'),
            h('span', { key: 't' }, '技能编排'),
            h('button', {
              key: 'toggle',
              style: { ...styles.button(true), marginLeft: 'auto', height: 18, padding: '0 6px' },
              onPointerDown: event => event.stopPropagation(),
              onClick: () => setCardCollapsed(value => !value),
              title: cardCollapsed ? '展开角色面板' : '收起角色面板',
            }, cardCollapsed ? '展开' : '收起'),
          ]),
          cardCollapsed ? null : h('div', { key: 'body' }, [
            h('select', {
              key: 'roles',
              value: selectedRole ?? '',
              onChange: event => { setSelectedRole(event.target.value); setSelectedSkill(undefined) },
              style: { ...styles.select, width: '100%' },
            }, list.roles.map(item => h('option', { key: item.id, value: item.id },
              `${item.name}（${item.runtime.length} 可用 / ${item.red.length} 缺失）`))),
            roleReady
              ? h('div', { key: 'meta', style: { ...styles.meta, marginTop: 6 } },
                `revision ${role.revision} · 闭包 ${plan.closure.length} · 约 ${plan.catalogChars} 字符`)
              : null,
            h('div', { key: 'sessions-title', style: { ...styles.sectionTitle, marginTop: 10 } }, `会话 · ${sessions.length}`),
            h('div', { key: 'sessions', style: { maxHeight: 130, overflowY: 'auto', marginTop: 2 } }, sessions.map(session => h('div', {
              key: session.sessionId,
              draggable: true,
              onDragStart: event => {
                event.dataTransfer.setData('text/plain', `session:${session.sessionId}`)
                event.dataTransfer.effectAllowed = 'link'
              },
              style: { ...styles.item(false), cursor: 'grab' },
              title: '拖到角色节点即可绑定该会话',
            }, [
              h('div', { key: 'n', style: styles.itemName }, session.sessionId.slice(0, 8)),
              h('div', { key: 'm', style: styles.meta },
                roleReady && session.roleId === role?.id
                  ? '已绑定本角色'
                  : session.roleId !== undefined && session.roleId !== null ? '已绑定其他角色' : '未绑定'),
              session.roleId === undefined || session.roleId === null
                ? null
                : h('button', {
                    key: 'x',
                    style: { ...styles.button(!pending), marginLeft: 'auto', height: 18, padding: '0 6px' },
                    disabled: pending,
                    title: '解除该会话的绑定',
                    onClick: event => {
                      event.stopPropagation()
                      void unbindSession(session.sessionId)
                    },
                  }, '解绑'),
            ]))),
          ]),
        ]),

        roleReady
          ? h('div', { style: panelStyle }, [
            h('div', { key: 'head', style: styles.panelHead }, [
              h('input', {
                key: 'filter',
                value: filter,
                onChange: event => setFilter(event.target.value),
                placeholder: '过滤技能…',
                style: { ...styles.select, flex: '1 1 auto' },
              }),
            ]),
            h('div', {
              key: 'body',
              style: {
                display: 'flex',
                flexDirection: 'column',
                flex: '1 1 auto',
                minHeight: 0,
              },
            }, [
              h('div', { key: 'list', style: listStyle }, filtered.map(skill => {
                const member = (plan.members ?? []).includes(skill.name)
                const stateColor = (plan.red ?? []).includes(skill.name) ? COLORS.red
                  : (plan.gray ?? []).some(row => row.name === skill.name) ? COLORS.gray
                    : member ? COLORS.runtime : COLORS.member
                return h('div', {
                  key: skill.name,
                  draggable: true,
                  onDragStart: event => {
                    event.dataTransfer.setData('text/plain', 'skill:' + skill.name)
                    event.dataTransfer.effectAllowed = 'link'
                  },
                  title: '拖到角色节点即纳入；拖到技能节点即依赖该技能',
                  style: { ...styles.item(selectedSkill === skill.name), cursor: 'grab' },
                  onClick: () => setSelectedSkill(skill.name),
                }, [
                  h('div', { key: 'n', style: styles.itemName },
                    h('span', { style: styles.dot(stateColor) }),
                    skill.name),
                  h('div', { key: 'm', style: styles.meta }, member ? '已纳入' : (skill.source ?? '')),
                ])
              })),
              h('div', { key: 'detail', style: styles.panelBody }, [
                h(SkillDetail, {
                  role, plan, skills: list.skills, skillName: selectedSkill,
                  pending, error, linkTarget, setLinkTarget, send,
                  onDeleteRole: deleteRole,
                }),
              ]),
            ]),
          ])
          : null)
    }
    function SkillDetail({ role, plan, health, skills, skillName, pending, error, linkTarget, setLinkTarget, send, onDeleteRole }) {
      const [personaDraft, setPersonaDraft] = useState(role.persona?.prefix ?? '')
      const [confirmDelete, setConfirmDelete] = useState(false)

      useEffect(() => {
        setPersonaDraft(role.persona?.prefix ?? '')
        setConfirmDelete(false)
      }, [role.id, role.revision])

      if (skillName === undefined) {
        const summary = [
          h('h2', { key: 'h', style: styles.h2 }, role.name),
          h('div', { key: 'm', style: styles.muted },
            `revision ${role.revision} · 闭包 ${plan.closure.length} · 目录约 ${plan.catalogChars} 字符`),
          h('div', { key: 'p', style: { ...styles.sectionTitle, marginTop: 14 } }, '人设（persona）'),
          h('textarea', {
            key: 'pt',
            value: personaDraft,
            onChange: event => setPersonaDraft(event.target.value),
            rows: 4,
            placeholder: '这段文字会作为该角色会话的系统提示首段。',
            style: {
              width: '100%', boxSizing: 'border-box', resize: 'vertical',
              font: 'inherit', fontSize: 12, padding: 8, borderRadius: 6,
              color: 'inherit', background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
              border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35))',
            },
          }),
          h('div', { key: 'pb', style: { display: 'flex', gap: 8, marginTop: 8 } }, [
            h('button', {
              key: 'save',
              style: { ...styles.button(pending || personaDraft === (role.persona?.prefix ?? '')), marginLeft: 0 },
              disabled: pending || personaDraft === (role.persona?.prefix ?? ''),
              onClick: () => void send('fields', { action: 'set_persona', persona: personaDraft }),
            }, '保存人设'),
            h('button', {
              key: 'del',
              style: { ...styles.button(!pending), marginLeft: 'auto', borderColor: confirmDelete ? COLORS.red : undefined, color: confirmDelete ? COLORS.red : 'inherit' },
              disabled: pending,
              title: '删除角色会同时删除它的整张图',
              onClick: () => {
                if (confirmDelete) void onDeleteRole()
                else setConfirmDelete(true)
              },
            }, confirmDelete ? '确认删除角色' : '删除角色'),
          ]),

          h('div', { key: 'e', style: { ...styles.empty, marginTop: 14 } }, '点击上图节点或下方技能，编辑它的依赖关系。'),
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

      children.push(member
        ? h('div', { key: 'member', style: styles.section },
            h('button', {
              style: { ...styles.button(!pending), marginLeft: 0 },
              disabled: pending,
              onClick: () => void send('members', { action: 'remove_members', remove: [skillName] }),
            }, '从角色中移除'))
        : h('div', { key: 'member', style: styles.section },
            h('div', { style: styles.empty }, '尚未纳入。拖到角色节点即纳入；拖到某个技能节点，则那个技能依赖它。')))

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
    function TabRolePanel() {
      return h(RolePage, { compact: true })
    }

    const TAB_ID = 'dsh-skill-loom/tab'
    const TAB_KIND = 'skillLoom'

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

        // The right sidebar keeps the conversation visible, which is the whole
        // point of a second surface. Registered only when the host exposes the
        // tab system, so an older client degrades to the main panel alone.
        const tabs = ctx.get?.('sidebarRightTabs')
        if (tabs === undefined) return
        ctx.effect(() => tabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          priority: 'builtin',
          title: () => '技能编排',
        }), 'skill-loom: right tab type')
        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
        }, TabRolePanel))

        // Open the tab on every load for now, so the surface is easy to inspect
        // while it is being tuned. This becomes a menu entry or a button once the
        // layout settles.
        const right = ctx.get?.('sidebarRight')
        if (right === undefined) return
        setTimeout(() => {
          try {
            right.openTab(TAB_KIND)
          } catch {
            // Auto-opening is a convenience; a refused open changes nothing.
          }
        }, 700)
      },
    }
  },
})
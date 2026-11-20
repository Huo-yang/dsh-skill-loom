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
      roleMenu: {
        position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20,
        maxHeight: 240, overflowY: 'auto', padding: 4, borderRadius: 8,
        background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3))',
        boxShadow: '0 8px 24px rgba(0,0,0,.16)',
      },
      roleRow: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, fontSize: 12 },
      toast: {
        position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
        zIndex: 6, padding: '6px 12px', borderRadius: 8, fontSize: 12, maxWidth: '70%',
        background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3))',
        boxShadow: '0 4px 16px rgba(0,0,0,.12)', pointerEvents: 'none', color: 'inherit',
      },
      trashZone: {
        position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)',
        padding: '10px 22px', borderRadius: 10, border: '2px dashed ' + COLORS.red,
        color: COLORS.red, fontSize: 12, fontWeight: 600, pointerEvents: 'none',
        background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
        boxShadow: '0 4px 16px rgba(0,0,0,.12)', zIndex: 5,
      },
    }

    const MENU_CSS = `
.loom-menu { margin-top: 6px; padding: 4px; border-radius: var(--dsw-radius-md, 8px); max-height: 200px; overflow-y: auto;
  width: max-content; min-width: 140px; max-width: 260px;
  background: var(--dsw-alias-bg-layer-2, #ffffff);
  border: .5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.28));
  box-shadow: 0 10px 28px rgba(0,0,0,.18); }
.loom-menu--float { position: absolute; top: calc(100% + 4px); right: 0; left: auto; z-index: 30; }
.loom-menu-item { display: flex; align-items: center; min-height: 30px; padding: 4px 8px;
  border-radius: var(--dsw-radius-sm, 6px); font-size: 13px; line-height: 20px; cursor: pointer;
  color: var(--dsw-alias-label-primary, inherit); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.loom-menu-check { margin-left: 8px; flex: none; color: var(--dsw-alias-label-primary, currentColor); }
.loom-menu-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.loom-menu-text { display: flex; flex-direction: column; min-width: 0; }
.loom-menu-desc { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary, currentColor);
  opacity: .85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loom-menu-item:hover { background: var(--dsw-alias-bg-multi-select, rgba(127,127,127,.16)); }
.loom-menu-empty { padding: 6px 10px; font-size: 12px; opacity: .6; }
.loom-option { display: inline-flex; align-items: center; gap: 4px; min-height: 28px; padding: 0 8px;
  border: none; background: none; border-radius: var(--dsw-radius-sm, 6px);
  color: var(--dsw-alias-label-primary, inherit); font: inherit; font-size: 13px; font-weight: 500;
  line-height: 20px; cursor: pointer; }
.loom-option:hover { background: var(--dsw-alias-bg-multi-select, rgba(127,127,127,.12)); }
.loom-option-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loom-option-icon { color: var(--dsw-alias-label-caption, currentColor); flex: none; }
`
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

      // Crossing reduction: order each row by the average position of its
      // neighbours in the other rows (barycenter heuristic), sweeping down then
      // up a few times. Without this the order is the member array order, so edges
      // cross for no reason the reader can see.
      const neighbours = new Map(members.map(name => [name, []]))
      for (const edge of role.edges ?? []) {
        if (!neighbours.has(edge.from) || !neighbours.has(edge.to)) continue
        neighbours.get(edge.from).push(edge.to)
        neighbours.get(edge.to).push(edge.from)
      }
      const order = new Map([...rows].map(([level, row]) => [level, [...row]]))
      const indexIn = name => {
        const row = order.get(levels[name] ?? 0) ?? []
        return row.indexOf(name)
      }
      for (let pass = 0; pass < 4; pass += 1) {
        const descending = pass % 2 === 1
        const levelList = [...order.keys()].sort((a, b) => (descending ? b - a : a - b))
        for (const level of levelList) {
          const row = order.get(level)
          const weight = name => {
            const linked = neighbours.get(name).filter(other => (levels[other] ?? 0) !== level)
            if (linked.length === 0) return row.indexOf(name)
            const total = linked.reduce((sum, other) => sum + indexIn(other), 0)
            return total / linked.length
          }
          order.set(level, [...row].sort((a, b) => weight(a) - weight(b) || row.indexOf(a) - row.indexOf(b)))
        }
      }

      const perRow = Math.max(1, ...[...order.values()].map(row => row.length), 1)

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
      for (const [level, row] of [...order].sort((a, b) => a[0] - b[0])) {
        row.forEach((name, index) => place(name, level + 1, index, row.length))
      }

      const height = (maxLevel + 2) * ROW_H + NODE_H + 20
      return { width, height, positions, roleLevel }
    }

    function Graph({ role, plan, selected, onSelect, onCreateEdge, onRemoveEdge, onRemovalDrag, onRemoveDrop, onDropOnNode, onDropMissed, onGrab }) {
      const geom = useMemo(() => layout(role, plan), [role, plan])
      const svgRef = useRef(undefined)
      const [drag, setDrag] = useState(undefined)
      const [dropTarget, setDropTarget] = useState(undefined)
      // Hovering a node dims every edge that does not touch it, answering which
      // line belongs to this box without adding anything to the canvas.
      const [hovered, setHovered] = useState(undefined)
      // The node under the pointer during a drag is the drop target; highlighting
      // it replaces the old rubber-band line as the landing cue.
      const [hoverTarget, setHoverTarget] = useState(undefined)
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

      const beginDrag = (name, mode) => event => {
        if (event.button !== 0) return
        event.stopPropagation()
        svgRef.current?.setPointerCapture?.(event.pointerId)
        const point = pointOf(event)
        if (name === '__role__') {
          setDrag({ from: name, mode: 'none', ox: point.x, oy: point.y, x: point.x, y: point.y, moved: false })
          return
        }
        // Two intents on one canvas: the port adds an edge, the box replaces the
        // existing ones, and the trash zone removes the member.
        // The trash zone is an affordance for an ongoing drag, so it appears only
        // after the pointer actually moves (see moveLink), never on a plain click.
        setDrag({ from: name, mode, ox: point.x, oy: point.y, x: point.x, y: point.y, moved: false })
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
        setHoverTarget(moved ? nodeAt(point.x, point.y) : undefined)
        if (moved && drag.mode === 'replace' && !drag.moved) onRemovalDrag(true)
      }
      const endLink = event => {
        if (edgeDrag !== undefined) {
          svgRef.current?.releasePointerCapture?.(event.pointerId)
          if (edgeDrag.moved) onRemoveEdge(edgeDrag.edge)
          setEdgeDrag(undefined)
          return
        }
        if (drag === undefined) return
        setHoverTarget(undefined)
        svgRef.current?.releasePointerCapture?.(event.pointerId)
        const point = pointOf(event)
        const target = nodeAt(point.x, point.y)
        if (drag.moved) {
          onRemovalDrag(false)
          const removed = onRemoveDrop(drag.from, event.clientX, event.clientY) === true
          if (removed) {
            // handled by the trash zone
          } else if (target !== undefined && target !== drag.from) {
            onCreateEdge(drag.from, target, drag.mode === 'add' ? 'add' : 'replace')
          } else {
            onDropMissed(drag.from)
          }
        } else {
          onSelect(drag.from === '__role__' ? undefined : drag.from)
        }
        setDrag(undefined)
      }

      // The role connects only to the first layer — the shallowest row of skills.
      // Every drawn node is already a member, so drawing one line per member said
      // nothing new and tangled the picture.
      const levels = plan.levels ?? {}
      const memberLevels = (plan.members ?? []).map(name => levels[name] ?? 0)
      const firstLevel = memberLevels.length === 0 ? 0 : Math.min(...memberLevels)
      const edges = []
      for (const name of plan.members ?? []) {
        if ((levels[name] ?? 0) === firstLevel) edges.push({ from: '__role__', to: name, include: true })
      }
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
        const related = hovered === undefined || edge.from === hovered || edge.to === hovered
        const baseOpacity = 0.5
        return h('g', { key: `e${index}` },
          h('path', {
            d: dragging ? `M ${route.from.x} ${route.from.y} L ${edgeDrag.x} ${edgeDrag.y}` : route.d,
            fill: 'none',
            stroke: dragging ? COLORS.red : 'currentColor',
            strokeOpacity: dragging ? 0.9 : related ? Math.min(1, baseOpacity + 0.45) : 0.07,
            strokeWidth: dragging ? 1.8 : related && !edge.include ? 2 : 1.4,
            // Role links are a reading aid, not data: dashed marks them as such.
            strokeDasharray: edge.include || dragging ? '4 3' : undefined,
          }),
          // Only a real dependency can be detached; an include line is membership.
          edge.include || dragging || !related
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


      drag !== undefined && drag.mode === 'add' && drag.moved && sourcePos !== undefined
        ? h('line', {
            x1: sourcePos.x + NODE_W / 2,
            y1: sourcePos.y - NODE_H / 2,
            x2: drag.x,
            y2: drag.y,
            stroke: 'currentColor',
            strokeOpacity: 0.65,
            strokeWidth: 1.4,
          })
        : null,

      nodes.map(node => {
        const position = geom.positions.get(node.name)
        if (position === undefined) return null
        const active = selected === node.name
        const stateColor = node.kind === 'role' ? COLORS.role : colorOf(node.name)
        const isDropTarget = dropTarget === node.name || (hoverTarget === node.name && drag !== undefined && drag.moved)
        const ghosting = drag !== undefined && drag.from === node.name && drag.mode === 'replace' && drag.moved
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
            opacity: ghosting ? 0.85 : 1,
            onPointerDown: node.kind === 'role' ? onGrab : beginDrag(node.name, 'replace'),
            onPointerEnter: () => setHovered(node.name),
            onPointerLeave: () => setHovered(current => (current === node.name ? undefined : current)),
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
              stroke: isDropTarget || active ? COLORS.role : 'currentColor',
              strokeOpacity: isDropTarget || active ? 1 : 0.25,
              strokeWidth: isDropTarget || active ? 2 : 1,
              strokeDasharray: isDropTarget ? '5 3' : undefined,
            }),
            h('circle', { key: 'dot', cx: 14, cy: NODE_H / 2, r: 4, fill: stateColor }),
            h('text', {
              key: 'label',
              x: 26, y: NODE_H / 2 + 4, fontSize: 12, fill: 'currentColor',
              style: { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' },
            }, node.label.length > 17 ? `${node.label.slice(0, 16)}…` : node.label),
            node.kind === 'role' ? null : h('circle', {
              key: 'port',
              cx: NODE_W + 7,
              cy: NODE_H / 2,
              r: 5,
              fill: 'var(--dsw-alias-bg-layer-1, #ffffff)',
              stroke: 'currentColor',
              strokeOpacity: 0.45,
              strokeWidth: 1.2,
              style: { cursor: 'crosshair' },
              onPointerDown: beginDrag(node.name, 'add'),
            }, h('title', null, '拖出以新增一条依赖（保留原有依赖）')),          ]),
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
      const [cardCollapsed, setCardCollapsed] = useState(false)
      const [removalActive, setRemovalActive] = useState(false)
      const [notice, setNotice] = useState(undefined)
      const [roleMenu, setRoleMenu] = useState(false)
      const roleMenuRef = useRef(undefined)
      useEffect(() => {
        if (!roleMenu) return undefined
        const onDown = event => {
          const node = roleMenuRef.current
          if (node !== null && node !== undefined && !node.contains(event.target)) setRoleMenu(false)
        }
        document.addEventListener('pointerdown', onDown, true)
        return () => document.removeEventListener('pointerdown', onDown, true)
      }, [roleMenu])
      const [creatingRole, setCreatingRole] = useState(undefined)
      const [confirmRoleDel, setConfirmRoleDel] = useState(undefined)
      const [apps, setApps] = useState(undefined)
      const [appsLoading, setAppsLoading] = useState(false)
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

      const beginPan = event => {
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
      const startPan = event => {
        // Middle drag only: browsers (and some trackpad drivers) claim the right
        // button for their own gestures, so panning on right-drag collides.
        if (event.button !== 1) return
        beginPan(event)
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


      useEffect(() => {
        if (notice === undefined) return undefined
        const timer = setTimeout(() => setNotice(undefined), 2500)
        return () => clearTimeout(timer)
      }, [notice])

      useEffect(() => { void loadList() }, [loadList])

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

      const send = async (path, payload, message) => {
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
          if (message !== undefined) setNotice(message)
        } catch (cause) {
          setNotice(undefined)
          setError(String(cause?.message ?? cause))
        } finally {
          setPending(false)
        }
      }



      const createRole = async rawName => {
        const name = rawName.trim()
        if (name === '') return
        setPending(true)
        setError(undefined)
        try {
          const response = await fetch(`${API}/roles`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name }),
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(body.message ?? body.code ?? body.error ?? HTTP )
          setCreatingRole(undefined)
          setRoleMenu(false)
          await loadList()
          if (body.role !== undefined) setSelectedRole(body.role.id)
          setNotice('已创建角色 ' + name)
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setPending(false)
        }
      }

      const deleteRoleById = async item => {
        setPending(true)
        setError(undefined)
        try {
          const response = await fetch(`${API}/roles/${encodeURIComponent(item.id)}/delete`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expectedRevision: item.revision }),
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok) {
            throw new Error(body.error === 'conflict'
              ? '这个角色刚被别处修改过，请刷新后再操作'
              : (body.message ?? body.error ?? HTTP ))
          }
          setConfirmRoleDel(undefined)
          if (selectedRole === item.id) {
            setSelectedRole(undefined)
            setSelectedSkill(undefined)
            setDetail({ status: 'idle' })
          }
          await loadList()
          setNotice('已删除角色 ' + item.name)
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setPending(false)
        }
      }

      const folderOf = path => path.replace(/[\\/][^\\/]+$/, '')

      // Returns the catalog so callers can act on it without waiting for a render.
      const loadApps = async () => {
        if (apps !== undefined) return apps
        if (appsLoading) return []
        setAppsLoading(true)
        try {
          const response = await fetch('/open-in-app/apps', { headers: { accept: 'application/json' }, credentials: 'same-origin' })
          const text = await response.text()
          let body = {}
          try {
            body = text === '' ? {} : JSON.parse(text)
          } catch {
            body = {}
          }
          if (!response.ok) {
            throw new Error('HTTP ' + response.status + ' ' + String(body.code ?? body.message ?? text.slice(0, 120)))
          }
          const list = Array.isArray(body) ? body : (Array.isArray(body.apps) ? body.apps : [])
          setApps(list)
          return list
        } catch (cause) {
          setApps([])
          setError('读取已安装应用失败：' + String(cause?.message ?? cause))
          return []
        } finally {
          setAppsLoading(false)
        }
      }

      const launchInApp = async (appId, dir) => {
        try {
          const response = await fetch('/open-in-app/open', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ app: appId, path: dir }),
          })
          const text = await response.text()
          let body = {}
          try {
            body = text === '' ? {} : JSON.parse(text)
          } catch {
            body = {}
          }
          if (!response.ok) {
            throw new Error('HTTP ' + response.status + ' ' + String(body.code ?? body.message ?? text.slice(0, 120)))
          }

          setNotice('已用 ' + appId + ' 打开 ' + dir)
        } catch (cause) {
          setError('打开失败：' + String(cause?.message ?? cause))
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
          await loadList()
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setPending(false)
        }
      }

      const dropToRemove = (name, clientX, clientY) => {
        // Measure before hiding the zone; the ref is still bound to the element
        // the drop landed on. Returns whether it consumed the drop, so the caller
        // can fall back to creating an edge.
        const rect = zoneRef.current?.getBoundingClientRect()
        setRemovalActive(false)
        if (rect === undefined) return false
        const inside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
        if (!inside) return false
        void send('members', { action: 'remove_members', remove: [name] }, '已移除 ' + name)
        return true
      }

      const dropOnNode = (payload, target) => {
        const separator = payload.indexOf(':')
        if (separator < 0) return
        const kind = payload.slice(0, separator)
        const value = payload.slice(separator + 1)
        const onRole = target === '__role__'

        if (kind !== 'skill') return
        if (onRole) void send('members', { action: 'add_members', add: [value] })
        // A skill dragged in from the list only adds an edge; migrating an
        // existing node's dependencies is the box-drag gesture below.
        else if (value !== target) void send('edges', { action: 'link', from: value, to: target }, '已新增依赖：' + value + ' → ' + target)
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
                  onCreateEdge: (from, to, mode) => {
                    // Either direction against the role node means "include this
                    // skill"; skill-to-skill means "requires".
                    if (from === '__role__') void send('members', { action: 'add_members', add: [to] }, '已纳入 ' + to)
                    else if (to === '__role__') {
                      // Every drawn node is already a member, so this can only be a
                      // no-op; say so instead of failing silently.
                      if ((plan.members ?? []).includes(from)) setNotice(from + ' 已在角色中')
                      else void send('members', { action: 'add_members', add: [from] }, '已纳入 ' + from)
                    }
                    else if (mode === 'add') void send('edges', { action: 'link', from, to }, '已新增依赖：' + from + ' → ' + to)
                    else void send('edges', { action: 'reparent', from, to }, '已清空 ' + from + ' 原有依赖，改为仅依赖 ' + to)
                  },
                  onDropOnNode: dropOnNode,
                  onRemoveEdge: edge => void send('edges', { action: 'unlink', from: edge.from, to: edge.to }),
                  onRemovalDrag: setRemovalActive,
                  onRemoveDrop: dropToRemove,
                  onDropMissed: from => setNotice('松手时不在任何节点上，未建立依赖：' + from),
                  onGrab: beginPan,
                })
              : h('div', { key: 'empty', style: { ...styles.empty, padding: 24 } },
                detail.status === 'error' ? detail.error
                  : detail.status === 'loading' ? '加载中…'
                    : list.status === 'ready' && list.roles.length === 0
                      ? '还没有角色。让 agent 用 role_graph 建一个，刷新即可看到。'
                      : '选择一个角色查看依赖图'),
          ])),

        h('style', { key: 'loom-css' }, MENU_CSS),
        error !== undefined
          ? h('div', { style: { ...styles.toast, color: COLORS.red, borderColor: COLORS.red } }, error)
          : notice !== undefined
            ? h('div', { style: styles.toast }, notice)
            : null,
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
            h('div', { key: 'roles', ref: roleMenuRef, style: { position: 'relative' } }, [
              h('button', {
                key: 'toggle',
                style: { ...styles.select, width: '100%', textAlign: 'left', cursor: 'pointer' },
                onClick: () => setRoleMenu(open => !open),
              }, (roleReady ? role.name : (list.roles.length === 0 ? '还没有角色' : '选择角色')) + '  ▾'),
              roleMenu
                ? h('div', { key: 'menu', style: styles.roleMenu }, [
                  ...list.roles.map(item => h('div', {
                    key: item.id,
                    style: {
                      ...styles.roleRow,
                      background: item.id === selectedRole ? 'var(--dsw-alias-bg-multi-select, rgba(127,127,127,.16))' : 'transparent',
                    },
                  }, [
                    h('span', {
                      key: 'n',
                      title: item.name + '（' + item.runtime.length + ' 可用 / ' + item.red.length + ' 缺失）',
                      style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' },
                      onClick: () => {
                        setSelectedRole(item.id)
                        setSelectedSkill(undefined)
                        setRoleMenu(false)
                      },
                    }, item.name),
                    confirmRoleDel === item.id
                      ? h('span', { key: 'c', style: { display: 'flex', gap: 4, flex: '0 0 auto' } }, [
                        h('button', {
                          key: 'y',
                          style: { ...styles.button(!pending), marginLeft: 0, height: 18, padding: '0 6px' },
                          disabled: pending,
                          onClick: () => void deleteRoleById(item),
                        }, '删除'),
                        h('button', {
                          key: 'n2',
                          style: { ...styles.button(true), marginLeft: 0, height: 18, padding: '0 6px' },
                          onClick: () => setConfirmRoleDel(undefined),
                        }, '取消'),
                      ])
                      : h('button', {
                        key: 'x',
                        style: { ...styles.button(true), marginLeft: 'auto', height: 18, padding: '0 6px' },
                        title: '删除这个角色',
                        onClick: event => {
                          event.stopPropagation()
                          setConfirmRoleDel(item.id)
                        },
                      }, '×'),
                  ])),
                  creatingRole === undefined
                    ? h('div', {
                      key: 'new',
                      style: { ...styles.roleRow, cursor: 'pointer', opacity: 0.85 },
                      onClick: () => setCreatingRole(''),
                    }, '＋ 新建角色')
                    : h('div', { key: 'newform', style: { ...styles.roleRow, gap: 6 } }, [
                      h('input', {
                        key: 'i',
                        value: creatingRole,
                        placeholder: '角色名称',
                        onChange: event => setCreatingRole(event.target.value),
                        onKeyDown: event => {
                          if (event.key === 'Enter') void createRole(creatingRole)
                          if (event.key === 'Escape') setCreatingRole(undefined)
                        },
                        style: { ...styles.select, flex: '1 1 auto' },
                      }),
                      h('button', {
                        key: 'ok',
                        style: { ...styles.button(!pending && creatingRole.trim() !== ''), marginLeft: 0, height: 22, padding: '0 8px' },
                        disabled: pending || creatingRole.trim() === '',
                        onClick: () => void createRole(creatingRole),
                      }, '创建'),
                    ]),
                ])
                : null,
            ]),
            roleReady
              ? h('div', { key: 'meta', style: { ...styles.meta, marginTop: 6 } },
                `revision ${role.revision} · 闭包 ${plan.closure.length} · 约 ${plan.catalogChars} 字符`)
              : null,
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
                  style: { ...styles.item(selectedSkill === skill.name), cursor: 'grab', position: 'relative' },
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
                  pending, error, send,
                  onDeleteRole: deleteRole,
                  onOpenFailed: message => setError(message),
                  apps, appsLoading, loadApps, launchInApp, folderOf,
                }),
              ]),
            ]),
          ])
          : null)
    }
    function SkillDetail({ role, plan, health, skills, skillName, pending, error, send, onDeleteRole, onOpenFailed, apps, appsLoading, loadApps, launchInApp, folderOf }) {
      const [personaDraft, setPersonaDraft] = useState(role.persona?.prefix ?? '')
      const [confirmDelete, setConfirmDelete] = useState(false)
      const [pickerOpen, setPickerOpen] = useState(false)
      useEffect(() => {
        if (!pickerOpen) return undefined
        const onDown = event => {
          const target = event.target
          if (typeof target?.closest === 'function' && (target.closest('.loom-option') !== null || target.closest('.loom-menu') !== null)) return
          setPickerOpen(false)
        }
        document.addEventListener('pointerdown', onDown, true)
        return () => document.removeEventListener('pointerdown', onDown, true)
      }, [pickerOpen])

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

      const stateLabel = (plan.red ?? []).includes(skillName)
        ? '缺失（红）'
        : (plan.gray ?? []).some(row => row.name === skillName) ? '受阻（灰）' : member ? '可用' : '未纳入'

      const children = [
        h('h2', { key: 'name', style: styles.h2 }, skillName),
        h('div', { key: 'state', style: styles.muted }, `${stateLabel}${info?.source ? ` · ${info.source}` : ''}`),
      ]
      if (info?.description) children.push(h('div', { key: 'desc', style: { ...styles.muted, marginTop: 6 } }, info.description))
      if (info?.path !== undefined) {
        // One entry, no shortcut: the user always picks the application, so a
        // stray click never launches something they did not choose.
        const dir = folderOf(info.path)
        children.push(h('div', { key: 'open', style: { marginTop: 10 } },
          h('button', {
            key: 'openwith',
            style: { ...styles.button(!appsLoading), marginLeft: 0 },
            title: dir,
            disabled: appsLoading,
            onClick: async () => {
              await loadApps()
              setPickerOpen(value => !value)
            },
          }, '在应用中打开 ' + (pickerOpen ? '▴' : '▾'))))
        if (pickerOpen) {
          children.push(h('div', { key: 'applist', className: 'loom-menu' },
            (apps ?? []).length === 0
              ? h('div', { key: 'e', className: 'loom-menu-empty' }, '没有可用的应用')
              : (apps ?? []).map(app => h('div', {
                  key: appKey(app),
                  className: 'loom-menu-item',
                  onClick: () => {
                    setPickerOpen(false)
                    void launchInApp(appKey(app), dir)
                  },
                }, appLabel(app)))))
        }
      }
      children.push(h('div', { key: 'member', style: styles.section },
        h('div', { style: styles.empty },
          member ? '已纳入该角色。' : '尚未纳入。从右侧列表拖入，或拖到角色节点即可纳入。')))

      const outgoingRows = outgoing.map((edge, index) => h('div', { key: `o${index}`, style: styles.line }, [
        h('span', { key: 'to', style: styles.mono }, edge.to),
        edge.why ? h('span', { key: 'why', style: styles.muted }, edge.why) : null,
      ]))

      children.push(h('div', { key: 'out', style: styles.section }, [
        h('div', { key: 'title', style: styles.sectionTitle }, `它依赖 · ${outgoing.length}`),
        outgoing.length === 0 ? h('div', { key: 'none', style: styles.empty }, '没有依赖。') : null,
        ...outgoingRows,
      ]))

      const incomingRows = incoming.map((edge, index) => h('div', { key: `i${index}`, style: styles.line }, [
        h('span', { key: 'from', style: styles.mono }, edge.from),
        edge.why ? h('span', { key: 'why', style: styles.muted }, edge.why) : null,
      ]))

      children.push(h('div', { key: 'in', style: styles.section }, [
        h('div', { key: 'title', style: styles.sectionTitle }, `被依赖 · ${incoming.length}`),
        incoming.length === 0 ? h('div', { key: 'none', style: styles.empty }, '没有其他技能依赖它。') : null,
        ...incomingRows,
      ]))

      return h('div', null, children)
    }
    // Captured once at apply time: the sidebar service is the only way to hand a
    // file to DSH's own viewer, which is where editing a SKILL.md happens.
    let openInSidebar

    // The host route answers with plain application ids, not records.
    function appKey(app) {
      return typeof app === 'string' ? app : (app?.id ?? app?.app ?? '')
    }

    function appLabel(app) {
      return typeof app === 'string' ? app : (app?.title ?? app?.label ?? app?.id ?? app?.app ?? '')
    }

    function skillFileAddress(path) {
      const normalized = path.replace(/\\/g, '/')
      const segments = normalized.split('/').map(segment => encodeURIComponent(segment).replace(/%3A/gi, ':'))
      return 'dsh-resource://file/absolute/' + segments.join('/')
    }

    /** Role selector for the New Session row, next to the workspace and preset controls. */
    function RoleOption(props) {
      const sessionId = props?.sessionId
      const [roles, setRoles] = useState([])
      const [bound, setBound] = useState(undefined)
      const [open, setOpen] = useState(false)
      const [busy, setBusy] = useState(false)
      const [failed, setFailed] = useState(undefined)

      useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const [rolesResponse, sessionsResponse] = await Promise.all([
              fetch('/skill-loom/roles', { headers: { accept: 'application/json' } }),
              fetch('/skill-loom/sessions', { headers: { accept: 'application/json' } }),
            ])
            const rolesBody = rolesResponse.ok ? await rolesResponse.json() : { roles: [] }
            const sessionsBody = sessionsResponse.ok ? await sessionsResponse.json() : { sessions: [] }
            if (!alive) return
            setRoles(Array.isArray(rolesBody.roles) ? rolesBody.roles : [])
            const mine = (sessionsBody.sessions ?? []).find(row => row.sessionId === sessionId)
            setBound(mine?.roleId ?? undefined)
          } catch (cause) {
            if (alive) setFailed(String(cause?.message ?? cause))
          }
        }
        void load()
        return () => { alive = false }
      }, [sessionId])

      const choose = async roleId => {
        if (sessionId === undefined) return
        setBusy(true)
        setFailed(undefined)
        try {
          const url = roleId === undefined ? '/skill-loom/sessions/unbind' : '/skill-loom/sessions/bind'
          const payload = roleId === undefined ? { sessionId } : { sessionId, roleId }
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!response.ok) {
            const text = await response.text()
            throw new Error('HTTP ' + response.status + ' ' + text.slice(0, 120))
          }
          setBound(roleId)
          setOpen(false)
        } catch (cause) {
          setFailed(String(cause?.message ?? cause))
        } finally {
          setBusy(false)
        }
      }

      // Close on any pointer press outside the control, the way a native menu does.
      const rootRef = useRef(undefined)
      useEffect(() => {
        if (!open) return undefined
        const onDown = event => {
          const node = rootRef.current
          if (node !== null && node !== undefined && !node.contains(event.target)) setOpen(false)
        }
        document.addEventListener('pointerdown', onDown, true)
        return () => document.removeEventListener('pointerdown', onDown, true)
      }, [open])

      const check = h('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        className: 'loom-menu-check',
        'aria-hidden': true,
      }, h('path', { d: 'M3.5 8.5l3 3 6-7', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))

      const current = roles.find(role => role.id === bound)
      return h('span', { ref: rootRef, style: { position: 'relative', display: 'inline-flex' } }, [
        h('style', { key: 'css' }, MENU_CSS),
        h('button', {
          key: 'trigger',
          type: 'button',
          className: 'loom-option',
          disabled: busy,
          title: failed ?? '这个会话以哪个角色的技能集运行',
          onClick: () => setOpen(value => !value),
        }, [
          h('svg', {
            key: 'icon',
            viewBox: '0 0 16 16',
            width: 16,
            height: 16,
            className: 'loom-option-icon',
            'aria-hidden': true,
          }, h('path', {
            d: 'M8 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm-6 12c0-2.5 2.7-4 6-4s6 1.5 6 4v.5H2V14Z',
            fill: 'currentColor',
          })),
          h('span', { key: 'label', className: 'loom-option-label' }, current?.name ?? '默认角色'),
          h('svg', {
            key: 'chevron',
            viewBox: '0 0 16 16',
            width: 12,
            height: 12,
            className: 'loom-option-icon',
            'aria-hidden': true,
          }, h('path', { d: 'M4 6l4 4 4-4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })),
        ]),
        open
          ? h('div', { key: 'menu', className: 'loom-menu loom-menu--float', style: { left: 'auto', right: 0 } }, [
            h('div', { key: 'none', className: 'loom-menu-item', onClick: () => void choose(undefined) }, [
              h('span', { key: 't', className: 'loom-menu-text' }, [
                h('span', { key: 'l', className: 'loom-menu-label' }, '默认'),
                h('span', { key: 'd', className: 'loom-menu-desc' }, '不收窄技能，注入全部已加载技能'),
              ]),
              bound === undefined ? h('span', { key: 'c' }, check) : null,
            ]),
            ...roles.map(role => {
              const total = Array.isArray(role.runtime) ? role.runtime.length : 0
              const missing = Array.isArray(role.red) ? role.red.length : 0
              const detail = total + ' 个技能可用' + (missing > 0 ? ' · ' + missing + ' 个缺失' : '')
              return h('div', {
                key: role.id,
                className: 'loom-menu-item',
                title: role.name,
                onClick: () => void choose(role.id),
              }, [
                h('span', { key: 't', className: 'loom-menu-text' }, [
                  h('span', { key: 'l', className: 'loom-menu-label' }, role.name),
                  h('span', { key: 'd', className: 'loom-menu-desc' }, detail),
                ]),
                bound === role.id ? h('span', { key: 'c' }, check) : null,
              ])
            }),
          ])
          : null,
      ])
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
        // Sits at the right end of the New Session row, after workspace and preset.
        ctx.slots.inject('conversation.hero.options', () => ctx.slots.register({
          name: 'conversation.hero.options',
          id: 'skill-loom-role',
          order: 50,
        }, RoleOption))

        // The right sidebar keeps the conversation visible, which is the whole
        // point of a second surface. The services can arrive after this module
        // applies, so wait for them instead of checking once and giving up: a
        // missed registration means no entry and no page at all.
        // `ctx.inject` is the supported way to depend on a service that may mount
        // after this plugin; `ctx.get` only sees what exists at this instant, which
        // is why the tab type sometimes never registered at all. The polling arm
        // stays as a fallback for a context without the scoped form.
        const whenAvailable = (name, run, attempt = 0) => {
          if (typeof ctx.inject === 'function') {
            ctx.inject([name], scope => {
              const service = scope?.[name] ?? ctx.get?.(name)
              if (service === undefined) return
              try {
                run(service)
              } catch {
                // A late service that refuses registration changes nothing.
              }
            })
            return
          }
          const service = ctx.get?.(name)
          if (service !== undefined) {
            try {
              run(service)
            } catch {
              // A late service that refuses registration changes nothing.
            }
            return
          }
          if (attempt >= 24) return
          setTimeout(() => whenAvailable(name, run, attempt + 1), 250)
        }

        whenAvailable('sidebarRightTabs', tabs => ctx.effect(() => tabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          priority: 'builtin',
          title: () => '技能编排',
          // Entries on the sidebar's default page, beside "workspace files" and
          // "new terminal": the user opens the tab from there instead of waiting
          // for anything to open it for them.
          guide: [{
            id: 'skill-loom',
            order: 40,
            title: () => '技能编排',
            description: () => '按角色编排技能依赖图',
          }],
        }), 'skill-loom: right tab type'))

        whenAvailable('sidebarRightTabs', () => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
        }, TabRolePanel)))

        whenAvailable('sidebarRight', service => {
          openInSidebar = service.openResource?.bind(service)
        })
      },
    }
  },
})
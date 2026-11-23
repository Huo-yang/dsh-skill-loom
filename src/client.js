window.__ModuleLoader__.load({
  id: '@huo-yang/dsh-skill-loom',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement
    const { useState, useEffect, useLayoutEffect, useSyncExternalStore, useCallback, useMemo, useRef, useId } = React

    let localeService
    const subscribeLocale = listener => localeService?.subscribe(listener) ?? (() => {})
    const localeSnapshot = () => localeService?.getSnapshot()
    const t = (zh, en) => localeService?.resolveText({ zh, en }) ?? zh
    const kindName = kind => kind === 'family' ? t('能力族', 'ability family')
      : kind === 'skill' ? t('技能', 'skill') : t('角色', 'role')
    const familyName = family => family.id === 'builtin-role-orchestration'
      ? t(family.name, 'Skill Loom Assistant') : family.name
    const familyDescription = family => family.id === 'builtin-role-orchestration'
      ? t(family.description, 'Organize skill dependencies, manage roles and ability families, and open the conversation sidebar for review.')
      : family.description

    const FAMILY_SAVED = 'family-saved'
    const API = '/skill-loom'
    const NODE_W = 150
    const NODE_H = 34
    const GAP_X = 26
    const ROW_H = 78
    const displayNames = new Intl.Collator('zh-Hans-CN-u-co-pinyin', { numeric: true })
    const compareName = displayNames.compare
    const byDisplayName = (a, b) => compareName(a.name, b.name)

    const COLORS = { runtime: '#2ea043', red: '#d1242f', gray: '#8b949e', member: '#1f6feb', role: '#8250df' }

    const styles = {
      stage: { position: 'relative', height: '100%', minHeight: 0, font: 'inherit', color: 'inherit', overflow: 'hidden' },
      canvasFill: {
        position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 1,
        display: 'flex', alignItems: 'safe center', justifyContent: 'safe center',
        // Bias the initial view a little above the geometric centre: a graph
        // that starts dead-centre reads as bottom-heavy once rows are added.
        paddingBottom: '12vh',
        backgroundColor: 'var(--dsw-alias-bg-base, #ffffff)',
        backgroundImage: 'radial-gradient(var(--dsw-alias-border-l2, rgba(127,127,127,.23)) .75px, transparent .75px)',
        backgroundSize: '18px 18px',
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
      panelHead: { padding: '12px 12px 8px', display: 'flex', flexDirection: 'column', gap: 8 },
      skillScroll: {
        flex: '1 1 0', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain',
        scrollbarGutter: 'stable', padding: '0 8px',
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
      mono: { fontFamily: 'inherit', fontSize: 12 },
      section: { marginTop: 16 },
      sectionTitle: { fontSize: 12, fontWeight: 600, opacity: 0.7, marginBottom: 6 },
      line: {
        display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
        borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.12))',
      },
      button: enabled => ({
        marginLeft: 'auto', font: 'inherit', fontSize: 12, padding: '0 8px', height: 24, borderRadius: 'var(--dsw-radius-sm, 6px)',
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35))',
        background: 'transparent', color: 'inherit', cursor: enabled ? 'pointer' : 'default',
        opacity: enabled ? 1 : 0.45,
      }),
      select: {
        font: 'inherit', fontSize: 13, height: 30, maxWidth: 200, padding: '0 8px', boxSizing: 'border-box',
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
      cornerBar: { position: 'absolute', top: 12, left: 12, zIndex: 3, display: 'flex', alignItems: 'center' },
      cornerStack: { alignItems: 'flex-start', flexDirection: 'column' },
      historyBar: { position: 'absolute', top: 12, right: 12, zIndex: 3, display: 'flex', alignItems: 'center' },
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
.loom-session-role { display: inline-flex; min-width: 0; }
.loom-session-role > button { max-width: min(148px, 28vw); }
@media (max-width: 560px) {
  .loom-session-role[data-loom-role-placement="header"] .loom-option-label { display: none; }
}
.loom-session-role > button:disabled { cursor: not-allowed; opacity: .6; }
.loom-session-role-menu { position: fixed; z-index: 1000; margin: 0; box-sizing: border-box; min-width: 0;
  color: var(--dsw-alias-label-primary, inherit); font: inherit; }
.loom-session-role-menu > button { width: 100%; justify-content: space-between; border: 0; background: transparent;
  text-align: left; font: inherit; font-size: 13px; }
.loom-session-role-menu > button:hover { background: var(--dsw-alias-bg-multi-select, rgba(127,127,127,.16)); }
.loom-session-role-menu > button:disabled { opacity: .6; cursor: not-allowed; }
.loom-session-role-menu > button:focus-visible { outline: 1px solid currentColor; outline-offset: -2px; }
.loom-session-role-error { padding: 5px 8px; font-size: 12px; overflow-wrap: anywhere; }
.loom-session-role-hint { margin-top: 4px; padding: 6px 8px 3px; border-top: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.28));
  font-size: 11px; color: var(--dsw-alias-label-secondary, #5e6572); }
.loom-session-role-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
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
.loom-app-menu-item { width: 100%; gap: 8px; border: 0; background: transparent; text-align: left; font: inherit; font-size: 13px; }
.loom-app-menu-item:focus-visible { outline: 1px solid currentColor; outline-offset: -2px; }
.loom-app-menu-icon { display: block; width: 14px; height: 14px; flex: 0 0 14px; object-fit: contain; }
.loom-menu-empty { padding: 6px 10px; font-size: 12px; opacity: .6; }
.loom-option { display: inline-flex; align-items: center; gap: 4px; min-height: 28px; padding: 0 8px;
  border: none; background: none; border-radius: var(--dsw-radius-sm, 6px);
  color: var(--dsw-alias-label-primary, inherit); font: inherit; font-size: 13px; font-weight: 500;
  line-height: 20px; cursor: pointer; }
.loom-option:hover { background: var(--dsw-alias-bg-multi-select, rgba(127,127,127,.12)); }
.loom-option-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loom-option-icon { color: var(--dsw-alias-label-caption, currentColor); flex: none; }
.loom-library-tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px; padding: 3px;
  border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.10)); }
.loom-library-tab { border: 0; background: transparent; color: var(--dsw-alias-label-secondary, inherit);
  border-radius: var(--dsw-radius-sm, 6px); min-height: 30px; cursor: pointer; font: inherit; font-size: 13px; }
.loom-library-tab[aria-pressed="true"] { background: var(--dsw-alias-bg-multi-select, rgba(127,127,127,.16));
  color: var(--dsw-alias-label-primary, inherit); font-weight: 600; }
.loom-card { margin: 0 0 6px; border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));
  border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-2, transparent); }
.loom-card:hover, .loom-card[data-selected="true"] { background: var(--dsw-alias-bg-multi-select, rgba(127,127,127,.12)); }
.loom-skill-card { display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 9px; cursor: grab; user-select: none; touch-action: none; }
.loom-card-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.loom-card-info { color: var(--dsw-alias-label-secondary, inherit); opacity: .8; font-size: 11px; }
.loom-search { display: flex; align-items: center; gap: 7px; min-height: 32px; padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25)); border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-bg-layer-1, transparent); }
.loom-search:focus-within { outline: 1px solid var(--dsw-alias-label-secondary, currentColor); }
.loom-search svg { flex: none; opacity: .65; }
.loom-search input { min-width: 0; flex: 1; padding: 4px 0; border: 0; outline: none; background: transparent;
  color: inherit; font: inherit; font-size: 13px; }
.loom-search input::-webkit-search-cancel-button { display: none; }
.loom-search button { border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.loom-skill-filters { display: flex; flex-wrap: wrap; gap: 4px; }
.loom-skill-filter { display: inline-flex; gap: 4px; align-items: center; padding: 3px 7px;
  border: 1px solid transparent; border-radius: var(--dsw-radius-sm, 6px); background: transparent;
  color: var(--dsw-alias-label-secondary, inherit); font: inherit; font-size: 12px; cursor: pointer; }
.loom-skill-filter:hover, .loom-skill-filter[aria-pressed="true"] {
  background: var(--dsw-alias-bg-multi-select, rgba(127,127,127,.12)); color: var(--dsw-alias-label-primary, inherit); }
.loom-skill-filter[aria-pressed="true"] { border-color: var(--dsw-alias-border-l2, rgba(127,127,127,.2)); font-weight: 600; }
.loom-skill-state { flex: none; padding: 1px 5px; border-radius: 4px; white-space: nowrap; }
.loom-skill-state[data-member="true"] { background: var(--dsw-alias-bg-multi-select, rgba(127,127,127,.12)); }
.loom-skill-empty { padding: 10px 4px 14px; color: var(--dsw-alias-label-secondary, inherit); font-size: 12px; }
.loom-role-summary { margin: 5px 0 0 2px; min-width: 0; max-width: min(285px, 35vw);
  font: inherit; font-size: 12px; color: var(--dsw-alias-label-secondary, inherit); }
button.loom-role-summary { padding: 3px 5px; border: 0; border-radius: 4px; background: transparent;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
  text-align: left; overflow: hidden; overflow-wrap: anywhere; cursor: text; }
button.loom-role-summary:hover { background: var(--dsw-alias-bg-multi-select, rgba(127,127,127,.12)); }
.loom-role-summary[data-empty="true"] { opacity: .7; }
.loom-role-drawer { position: absolute; z-index: 7; top: 72px; right: 12px;
  width: min(360px, calc(100% - 24px)); max-height: min(410px, calc(100% - 78px)); box-sizing: border-box;
  padding: 14px; overflow: auto; border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.28));
  border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-2, #fff);
  box-shadow: 0 8px 24px rgba(0,0,0,.14); color: var(--dsw-alias-label-primary, inherit); }
.loom-role-drawer[hidden] { display: none; }
.loom-detail-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.loom-detail-header h2 { min-width: 0; overflow-wrap: anywhere; }
.loom-library-hover { position: absolute; z-index: 4; right: 4px;
  top: clamp(48px, var(--loom-hover-anchor), max(48px, 55%)); width: min(340px, 65%);
  max-height: min(calc(100% - 52px), max(35%, calc(100% - var(--loom-hover-anchor) - 8px)), 440px);
  display: flex; box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25));
  border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-2, #fff);
  box-shadow: 0 8px 24px rgba(0,0,0,.14); }
.loom-library-hover[data-compact="true"] { top: auto; bottom: 4px; }
.loom-library-detail { width: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.loom-library-detail > .loom-detail-header { flex: none; padding: 8px 12px 4px; }
.loom-library-detail-body { min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable;
  padding: 0 12px 10px; }
.loom-role-trigger { max-width: min(225px, 46vw); border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));
  background: var(--dsw-alias-bg-layer-2, #fff); }
.loom-role-picker { left: 0; right: auto; width: min(252px, 72vw); max-height: 260px; box-sizing: border-box; }
.loom-role-picker-row { display: flex; align-items: center; gap: 2px; border-radius: var(--dsw-radius-sm, 6px); }
.loom-role-picker-row[data-current="true"] { background: var(--dsw-alias-bg-multi-select, rgba(127,127,127,.12)); }
.loom-role-picker-choice { flex: 1; min-width: 0; gap: 6px; justify-content: space-between; text-align: left; }
.loom-role-picker-choice[aria-current="true"] { font-weight: 600; }
.loom-role-picker-icon { flex: none; padding: 0 6px; min-height: 26px; opacity: .65; }
.loom-role-picker-icon:hover, .loom-role-picker-icon:focus-visible { color: #d1242f; opacity: 1; }
.loom-role-picker-rename { flex: 1; min-width: 0; }
.loom-role-picker-footer { margin-top: 4px; padding: 4px 2px 0; border-top: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22)); }
.loom-role-picker-footer form { display: flex; align-items: center; gap: 5px; }
.loom-role-picker-footer input { min-width: 0; flex: 1; }
.loom-family-handle { display: flex; align-items: center; gap: 9px; width: 100%; padding: 9px; border: 0;
  border-radius: inherit; background: transparent; color: inherit; text-align: left; font: inherit;
  cursor: grab; user-select: none; touch-action: none; }
.loom-family-handle:active { cursor: grabbing; }
.loom-family-icon { display: grid; place-items: center; width: 28px; height: 28px; flex: none;
  border-radius: var(--dsw-radius-sm, 6px); background: var(--dsw-alias-bg-multi-select, rgba(127,127,127,.12)); }
.loom-family-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 0 9px 8px; }
.loom-family-library, .loom-family-detail {
  font: inherit; color: var(--dsw-alias-label-primary, inherit); line-height: 1.5;
}
.loom-family-library button, .loom-family-library input {
  font-family: inherit;
}
.loom-family-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 2px 0 10px; }
.loom-family-toolbar button { margin-left: 0; }
.loom-family-toolbar .loom-family-new {
  min-height: 30px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));
  border-radius: var(--dsw-radius-sm, 6px); background: var(--dsw-alias-bg-multi-select, rgba(127,127,127,.12));
  color: inherit; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
}
.loom-family-toolbar .loom-family-new:disabled { opacity: .45; cursor: default; }
.loom-graph-label { display: flex; align-items: center; height: 100%; overflow: hidden;
  color: inherit; font-family: inherit; font-size: 12px; line-height: 13px; }
.loom-graph-label > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loom-graph-select-node:focus-visible > rect { stroke: currentColor; stroke-width: 2.5; }
.loom-family-entries-list { display: flex; flex-wrap: wrap; gap: 5px; padding: 0; margin: 8px 0 0; list-style: none; }
.loom-family-entry { min-width: 0; padding: 2px 7px; border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-bg-multi-select, rgba(127,127,127,.10)); font-size: 12px; overflow-wrap: anywhere; }
.loom-family-detail .loom-card-info { font-size: 12px; }
.loom-operation-result { position: absolute; z-index: 5; left: 50%; bottom: clamp(34px, 12%, 84px);
  transform: translateX(-50%); width: max-content; max-width: min(420px, calc(100% - 24px));
  box-sizing: border-box; pointer-events: none; text-align: center; }
.loom-operation-result > span { display: block; padding: 5px 11px; font-size: 12px; line-height: 18px;
  overflow-wrap: anywhere; color: var(--dsw-alias-label-primary, CanvasText);
  background: var(--dsw-alias-bg-layer-2, Canvas); border-radius: var(--dsw-radius-md, 8px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));
  box-shadow: 0 3px 12px rgba(0,0,0,.12); }
.loom-operation-result[data-error="true"] > span { color: var(--dsw-alias-label-danger, #c43e36); }
.loom-confirm-dialog { box-sizing: border-box; width: min(380px, calc(100% - 32px));
  padding: 16px; border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));
  border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-2, Canvas);
  color: var(--dsw-alias-label-primary, CanvasText); font: inherit; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
.loom-confirm-dialog::backdrop { background: rgba(0,0,0,.26); }
.loom-confirm-dialog p { margin: 6px 0 14px; overflow-wrap: anywhere; }
.loom-confirm-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.loom-family-editor-heading { display: flex; align-items: center; gap: 6px; max-width: 100%; }
.loom-family-editor-heading > button { flex: none; }
.loom-family-editor-heading > input { width: min(225px, 46vw); min-width: 0; font: inherit; font-size: 13px; }
.loom-family-editor-hint { width: max-content; max-width: 100%; margin: -26px auto 0; padding: 4px 8px;
  text-align: center; font-size: 12px; color: var(--dsw-alias-label-secondary, inherit); pointer-events: none; }
.loom-drag-card { position: absolute; z-index: 50; pointer-events: none; display: flex; align-items: center;
  box-sizing: border-box; gap: 8px; padding: 0 9px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.28));
  border-radius: var(--dsw-radius-sm, 6px); background: var(--dsw-alias-bg-layer-2, #fff);
  color: var(--dsw-alias-label-primary, inherit); box-shadow: 0 4px 12px rgba(0,0,0,.16); }
`
    function SidebarIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M2 3.5h5v5H2zM9 3.5h5v2H9zM9 6.5h5v5H9zM2 10.5h5v2H2z', fill: 'currentColor', opacity: 0.85 }))
    }

    /** Count strict inversions in O(n log n), leaving equal values in order. */
    function countInversions(values) {
      if (values.length < 2) return 0
      const buffer = new Array(values.length)
      const merge = (start, end) => {
        if (end - start < 2) return 0
        const middle = (start + end) >>> 1
        let count = merge(start, middle) + merge(middle, end)
        if (values[middle - 1] <= values[middle]) return count
        let left = start
        let right = middle
        for (let at = start; at < end; at++) {
          if (right === end || (left < middle && values[left] <= values[right])) {
            buffer[at] = values[left++]
          } else {
            buffer[at] = values[right++]
            count += middle - left
          }
        }
        for (let at = start; at < end; at++) values[at] = buffer[at]
        return count
      }
      return merge(0, values.length)
    }

    function countLayerCrossings(bands, columns) {
      const xAt = (line, level) => (
        columns.get(line.upper) * (line.bottom - level) + columns.get(line.lower) * (level - line.top)
      ) / (line.bottom - line.top)
      let count = 0
      for (const [level, lines] of bands) {
        if (lines.length < 2) continue
        const segments = lines.map(line => ({
          start: xAt(line, level),
          end: xAt(line, level + 1),
          continues: line.bottom > level + 1,
        })).sort((a, b) => a.start - b.start || a.end - b.end)
        count += countInversions(segments.map(segment => segment.end))

        // A crossing exactly on a layer boundary belongs to the upper band.
        // Only consider edges passing through the boundary, never shared endpoints.
        const boundary = new Map()
        for (const segment of segments) {
          if (!segment.continues) continue
          if (!boundary.has(segment.end)) boundary.set(segment.end, [])
          boundary.get(segment.end).push(segment.end - segment.start)
        }
        for (const slopes of boundary.values()) count += countInversions(slopes)
      }
      return count
    }

    function orderGraphRows(rows, levels, edges) {
      const columns = new Map()
      const neighbours = new Map()
      const rank = row => {
        row.forEach((name, index) => columns.set(name, index - (row.length - 1) / 2))
      }
      for (const row of rows.values()) rank(row)
      const bands = new Map()
      for (const { from, to } of edges) {
        if (!columns.has(from) || !columns.has(to) || levels[from] === levels[to]) continue
        const [upper, lower] = levels[from] < levels[to] ? [from, to] : [to, from]
        const line = { upper, lower, top: levels[upper], bottom: levels[lower] }
        for (let level = line.top; level < line.bottom; level++) {
          if (!bands.has(level)) bands.set(level, [])
          bands.get(level).push(line)
        }
        for (const [name, other] of [[upper, lower], [lower, upper]]) {
          if (!neighbours.has(name)) neighbours.set(name, [])
          neighbours.get(name).push(other)
        }
      }
      // Start from name order and keep a sweep only if it improves the drawing.
      const orderedLevels = [...rows.keys()].sort((a, b) => a - b)
      let bestRows = rows
      let bestScore = countLayerCrossings(bands, columns)
      if (bestScore === 0) return bestRows
      const candidate = new Map(rows)
      for (let pass = 0; pass < 4; pass++) {
        const forward = pass % 2 === 0
        const sweep = forward ? orderedLevels : [...orderedLevels].reverse()
        for (const level of sweep) {
          const row = candidate.get(level)
          const weight = new Map(row.map(name => {
            const links = (neighbours.get(name) ?? []).filter(other => forward ? levels[other] < level : levels[other] > level)
            const center = links.length ? links.reduce((sum, other) => sum + columns.get(other), 0) / links.length : columns.get(name)
            return [name, center]
          }))
          const sorted = [...row].sort((a, b) => weight.get(a) - weight.get(b) || compareName(a, b))
          candidate.set(level, sorted)
          rank(sorted)
        }
        const score = countLayerCrossings(bands, columns)
        if (score < bestScore) {
          bestScore = score
          bestRows = new Map(candidate)
          if (score === 0) break
        }
      }
      return bestRows
    }

    /** Lay out one role as a top-down tree: role node on top, dependencies below. */
    function layout(plan, edges) {
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
      for (const row of rows.values()) row.sort(compareName)
      const orderedRows = orderGraphRows(rows, levels, edges)

      const perRow = Math.max(1, ...[...rows.values()].map(row => row.length))

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
      for (const [level, row] of orderedRows) {
        row.forEach((name, index) => place(name, level + 1, index, row.length))
      }

      const height = (maxLevel + 2) * ROW_H + NODE_H + 20
      return { width, height, positions }
    }

    const edgeKey = ({ from, to }) => JSON.stringify([from, to])

    function Graph({ role, plan, selected, onSelect, onCreateEdge, onRemoveEdge, onRemovalDrag, onRemoveDrop, onDropMissed, onGrab, onOpenRoot, libraryDrag, inserted, selection, preview = false }) {
      const geom = useMemo(() => layout(plan, role.edges ?? []), [plan, role.edges])
      const draggedFamily = libraryDrag?.family
      const blockedTargets = useMemo(() => draggedFamily && familyBlockedTargets(role, draggedFamily), [role.edges, draggedFamily])
      const svgRef = useRef(undefined)
      const [drag, setDrag] = useState(undefined)
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
        const matrix = svgRef.current?.getScreenCTM()
        if (!matrix) return { x: 0, y: 0 }
        return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
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
        if (drag.mode === 'none') {
          if (!drag.moved) onOpenRoot?.()
          setDrag(undefined)
          return
        }
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
        if (role.entries ? role.entries.includes(name) : (levels[name] ?? 0) === firstLevel) {
          edges.push({ from: '__role__', to: name, include: true })
        }
      }
      for (const edge of role.edges ?? []) edges.push({ from: edge.from, to: edge.to })

      // Curves read better than right angles here: an orthogonal route adds long
      // horizontal runs and corners that compete with the node boxes for
      // attention. The layer order carries the dependency direction.
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
        role: selection ? 'group' : 'img',
        'aria-label': t(role.name + ' 的依赖图', role.name + ' dependency graph'),
        // Without overflow: visible the root SVG clips to its viewBox, so a node
        // carried past the canvas edge simply disappears.
        style: { display: 'block', margin: '0 auto', touchAction: 'none', overflow: 'visible',
          ...(preview ? { maxWidth: '100%', height: 'auto' } : {}) },
        onPointerMove: moveLink,
        onPointerUp: endLink,
        onPointerCancel: () => setDrag(undefined),
      },

      edges.map((edge, index) => {
        const route = pathOf(edge)
        if (route === undefined) return null
        const dragging = edgeDrag !== undefined && edgeDrag.index === index && edgeDrag.moved
        const included = selection?.members.has(edge.to) && (edge.include || selection.members.has(edge.from))
        const related = selection?.members.size
          ? included : hovered === undefined || edge.from === hovered || edge.to === hovered
        const added = edge.include ? inserted?.members.has(edge.to) : inserted?.edges.has(edgeKey(edge))
        const baseOpacity = 0.5
        return h('g', { key: `e${index}` },
          h('path', {
            d: dragging ? `M ${route.from.x} ${route.from.y} L ${edgeDrag.x} ${edgeDrag.y}` : route.d,
            fill: 'none',
            stroke: dragging ? COLORS.red : included || added ? COLORS.role : 'currentColor',
            strokeOpacity: added ? 1 : dragging ? 0.9 : related ? Math.min(1, baseOpacity + 0.45) : 0.07,
            strokeWidth: added ? 2.6 : dragging ? 1.8 : related && !edge.include ? 2 : 1.4,
            // Role links are a reading aid, not data: dashed marks them as such.
            strokeDasharray: edge.include || dragging ? '4 3' : undefined,
          }),
          // Only a real dependency can be detached; an include line is membership.
          preview || edge.include || dragging || !related
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
        const active = selected === node.name || inserted?.members.has(node.name)
        const selectable = selection && node.kind === 'skill'
        const chosen = selectable && selection.members.has(node.name)
        const implicit = chosen && !selection.roots.includes(node.name)
        const stateColor = node.kind === 'role' ? COLORS.role : colorOf(node.name)
        const availableTarget = libraryDrag && acceptsLibraryDrop(libraryDrag, node.name) && !blockedTargets?.has(node.name)
        const isDropTarget = (availableTarget && libraryDrag.target === node.name)
          || (hoverTarget === node.name && drag !== undefined && drag.moved)
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
            'data-loom-drop-node': preview ? undefined : node.name,
            transform: `translate(${position.x - NODE_W / 2 + ghost.dx}, ${position.y - NODE_H + ghost.dy})`,
            opacity: ghosting ? 0.85 : selectable && selection.members.size && !chosen ? 0.55 : 1,
            onPointerDown: selectable ? undefined : preview || (node.kind === 'role' && !onOpenRoot) ? onGrab : beginDrag(node.name, 'replace'),
            onPointerEnter: () => setHovered(node.name),
            onPointerLeave: () => setHovered(current => (current === node.name ? undefined : current)),
            style: { cursor: selectable || (node.kind === 'role' && onOpenRoot) ? 'pointer' : 'grab' },
            ...(selectable ? {
              className: 'loom-graph-select-node', role: 'button', tabIndex: 0,
              'aria-label': node.name + (implicit ? t('（自动纳入的依赖）', '(automatically included prerequisite)') : ''),
              'aria-pressed': !!chosen,
              onClick: () => selection.toggle(node.name),
              onKeyDown: event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                selection.toggle(node.name)
              },
            } : {}),
          }, [
            h('rect', {
              key: 'box',
              width: NODE_W, height: NODE_H, rx: 6,
              fill: 'var(--dsw-alias-bg-layer-1, #ffffff)',
              stroke: isDropTarget || active || availableTarget || chosen ? COLORS.role : 'currentColor',
              strokeOpacity: isDropTarget || active || chosen ? 1 : availableTarget ? 0.7 : 0.25,
              strokeWidth: isDropTarget || active || chosen ? 2 : 1,
              strokeDasharray: isDropTarget || availableTarget || implicit ? '5 3' : undefined,
            }),
            h('title', { key: 'title' }, node.label + (implicit ? t('（自动纳入的依赖）', '(automatically included prerequisite)') : '')),
            h('circle', { key: 'dot', cx: 14, cy: NODE_H / 2, r: 4, fill: stateColor }),
            h('foreignObject', {
              key: 'label', x: 26, y: 2, width: NODE_W - 34, height: NODE_H - 4,
              style: { pointerEvents: 'none' }, 'aria-hidden': true,
            }, h('div', { className: 'loom-graph-label' }, h('span', null, node.label))),
            preview || node.kind === 'role' ? null : h('circle', {
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
            }, h('title', null, t('拖出以新增一条依赖（保留原有依赖）', 'Drag to add a dependency'))),          ]),
        ])
      }))
    }
    function dropNodeAt(event) {
      return event.currentTarget.ownerDocument.elementFromPoint(event.clientX, event.clientY)
        ?.closest('[data-loom-drop-node]')?.getAttribute('data-loom-drop-node')
    }

    function acceptsLibraryDrop(item, target) {
      if (target === '__role__') return true
      if (!item.family) return item.name !== target
      return item.family.entries.length > 0
    }

    function dragStage(event) {
      const stage = event.currentTarget.closest('[data-loom-stage]')
      const rect = stage.getBoundingClientRect()
      return { rect, scaleX: stage.offsetWidth / rect.width, scaleY: stage.offsetHeight / rect.height }
    }

    function useLibraryDrag(onStart, onDrop) {
      const pointer = useRef(undefined)
      const suppressClick = useRef(false)
      const [card, setCard] = useState(undefined)
      const finish = (event, dropped) => {
        const drag = pointer.current
        if (drag?.id !== event.pointerId) return
        pointer.current = undefined
        if (!drag.moved) return
        setCard(undefined)
        const target = dropped ? dropNodeAt(event) : undefined
        if (target != null && acceptsLibraryDrop(drag.item, target)) onDrop(drag.item, target)
      }
      const bind = (item, onClick, disabled) => ({
        onPointerDown(event) {
          suppressClick.current = false
          if (disabled || event.button !== 0 || !event.isPrimary) return
          const bounds = event.currentTarget.getBoundingClientRect()
          event.currentTarget.setPointerCapture(event.pointerId)
          pointer.current = {
            id: event.pointerId, item, moved: false, startX: event.clientX, startY: event.clientY,
            offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top,
            width: bounds.width, height: bounds.height,
          }
        },
        onPointerMove(event) {
          const drag = pointer.current
          if (drag?.id !== event.pointerId) return
          if (!drag.moved) {
            if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return
            drag.moved = true
            suppressClick.current = true
            onStart(drag.item)
          }
          const { rect, scaleX, scaleY } = dragStage(event)
          setCard({
            ...drag.item, target: dropNodeAt(event),
            left: (event.clientX - rect.left - drag.offsetX) * scaleX,
            top: (event.clientY - rect.top - drag.offsetY) * scaleY,
            width: drag.width * scaleX, height: drag.height * scaleY,
          })
        },
        onPointerUp: event => finish(event, true),
        onPointerCancel: event => finish(event, false),
        onLostPointerCapture: event => finish(event, false),
        onClick(event) {
          if (event.detail === 0 || !suppressClick.current) onClick()
          suppressClick.current = false
        },
      })
      return { card, bind }
    }

    function familyDraftPlan({ members, edges }, skills) {
      const dependencies = new Map(members.map(name => [name, []]))
      for (const { from, to } of edges) {
        dependencies.get(from).push(to)
      }
      const levels = new Map()
      const level = name => {
        if (!levels.has(name)) {
          levels.set(name, Math.max(0, ...dependencies.get(name).map(next => 1 + level(next))))
        }
        return levels.get(name)
      }
      const available = new Set(skills.map(skill => skill.name))
      const red = members.filter(name => !available.has(name))
      const blocked = new Map(red.map(name => [name, [name]]))
      const gray = []
      for (const name of [...members].sort((a, b) => level(a) - level(b))) {
        if (blocked.has(name)) continue
        const unavailable = dependencies.get(name).find(next => blocked.has(next))
        if (unavailable !== undefined) {
          const path = [name, ...blocked.get(unavailable)]
          blocked.set(name, path)
          gray.push({ name, path })
        }
      }
      return {
        members, levels: Object.fromEntries(members.map(name => [name, level(name)])), red, gray,
        runtime: members.filter(name => !blocked.has(name)),
        entries: members.filter(name => dependencies.get(name).length === 0),
      }
    }

    function familySelectionMembers(role, roots) {
      const dependencies = new Map()
      for (const edge of role.edges ?? []) {
        const targets = dependencies.get(edge.from) ?? []
        targets.push(edge.to)
        dependencies.set(edge.from, targets)
      }
      const members = new Set(roots)
      for (const name of members) {
        for (const target of dependencies.get(name) ?? []) members.add(target)
      }
      return members
    }

    function familyBlockedTargets(role, family) {
      const edges = [...(role.edges ?? []), ...family.edges].map(({ from, to }) => ({ from: to, to: from }))
      return familySelectionMembers({ edges }, family.entries)
    }

    function useLibraryHover(canvasRef, scope) {
      const [hover, setHover] = useState(undefined)
      const leaveTimer = useRef(undefined)
      const keep = () => clearTimeout(leaveTimer.current)
      const hide = () => {
        keep()
        setHover(undefined)
      }
      useEffect(() => {
        setHover(undefined)
        return () => clearTimeout(leaveTimer.current)
      }, [scope])
      const leave = () => {
        keep()
        // Allow the pointer to cross from the library into the popup.
        leaveTimer.current = setTimeout(() => setHover(undefined), 240)
      }
      const bind = (kind, id) => ({
        onPointerEnter(event) {
          if (event.pointerType === 'touch' || event.buttons || !canvasRef.current) return
          keep()
          const canvas = canvasRef.current.getBoundingClientRect()
          const card = event.currentTarget.getBoundingClientRect()
          setHover({ kind, id, top: card.top - canvas.top })
        },
        onPointerLeave: leave,
      })
      return { hover, bind, hide, keep, leave }
    }

    const DRAFT_HISTORY_LIMIT = 20
    const familyDraftContent = ({ description, members, edges }) => ({ description, members, edges })
    const familyDraftSignature = draft => JSON.stringify([draft.name, familyDraftContent(draft)])
    const familyDraftDirty = draft => draft && familyDraftSignature(draft) !== draft.savedSignature

    function HistoryButtons({ pending, undo, redo, step, save, canSave, saving, showHistory = true }) {
      return h('div', { style: { display: 'flex', gap: 6 } }, (showHistory ? [
        ['undo', t('↶ 撤销', '↶ Undo'), undo], ['redo', t('↷ 重做', '↷ Redo'), redo],
      ] : []).map(([direction, label, count]) => {
        const enabled = !pending && count > 0
        return h('button', {
          key: direction, type: 'button',
          style: { ...styles.button(enabled), marginLeft: 0, height: 24, padding: '0 8px' },
          disabled: !enabled,
          onClick: () => void step(direction),
        }, label)
      }).concat(save ? h('button', {
        key: 'save', type: 'button', style: { ...styles.button(canSave), marginLeft: 0, height: 24, padding: '0 8px' },
        disabled: !canSave, onClick: () => void save(),
      }, saving ? t('保存中…', 'Saving…') : t('保存', 'Save')) : []))
    }

    const DRAFT_STORAGE_KEY = 'dsh-skill-loom:editor-drafts:v1'
    const graphSignature = role => JSON.stringify([role.members ?? [], role.edges ?? []])
    const snapshotGraph = ({ role, plan }) => ({ role: { members: role.members, edges: role.edges }, plan })

    function readEditorDrafts() {
      try {
        const stored = JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY))
        if (!stored || typeof stored !== 'object') return {}
        return stored
      } catch {
        return {}
      }
    }

    function persistEditorDrafts(roleWorkspace, familyDraft) {
      try {
        const role = roleWorkspace && graphSignature(roleWorkspace.current.role) !== roleWorkspace.baseSignature
          ? roleWorkspace : undefined
        const family = familyDraftDirty(familyDraft) ? familyDraft : undefined
        if (!role && !family) {
          window.localStorage.removeItem(DRAFT_STORAGE_KEY)
          return
        }
        window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
          role: role && {
            ...role, current: snapshotGraph(role.current),
            undo: role.undo.map(snapshotGraph), redo: role.redo.map(snapshotGraph),
          },
          family,
        }))
      } catch {
        // A blocked or full browser store must not interrupt editing.
      }
    }

    function useEditorFeedback() {
      const [feedback, setFeedback] = useState(undefined)
      useEffect(() => {
        if (!feedback) return undefined
        const timer = setTimeout(() => {
          setFeedback(current => current === feedback ? undefined : current)
        }, feedback.kind === 'error' ? 6000 : 3000)
        return () => clearTimeout(timer)
      }, [feedback])
      const update = kind => text => setFeedback(current => text === undefined
        ? (current?.kind === kind ? undefined : current)
        : { kind, text })
      return {
        error: feedback?.kind === 'error' ? feedback.text : undefined,
        notice: feedback?.kind === 'notice' ? feedback.text : undefined,
        setError: update('error'), setNotice: update('notice'),
      }
    }

    function RolePage({ compact = false, review } = {}) {
      const language = useSyncExternalStore(subscribeLocale, localeSnapshot, localeSnapshot)
      const [restoredDrafts] = useState(readEditorDrafts)
      const [list, setList] = useState({ status: 'loading', roles: [], skills: [] })
      const [selectedRole, setSelectedRole] = useState(restoredDrafts.role?.id)
      const [roleWorkspace, setRoleWorkspace] = useState(restoredDrafts.role)
      const [roleSwitchTarget, setRoleSwitchTarget] = useState(undefined)
      const [roleGraphSaving, setRoleGraphSaving] = useState(false)
      const [detail, setDetail] = useState({ status: 'idle' })
      const [selectedSkill, setSelectedSkill] = useState(undefined)
      const [insertedFamily, setInsertedFamily] = useState(undefined)
      useEffect(() => {
        if (!insertedFamily) return undefined
        const timer = setTimeout(() => setInsertedFamily(undefined), 2500)
        return () => clearTimeout(timer)
      }, [insertedFamily])
      const [roleDetailsOpen, setRoleDetailsOpen] = useState(false)
      const roleDetailsButton = useRef(null)
      const [pending, setPending] = useState(false)
      const { error, notice, setError, setNotice } = useEditorFeedback()
      const [skillQuery, setSkillQuery] = useState('')
      const [familyQuery, setFamilyQuery] = useState('')
      const [skillMembership, setSkillMembership] = useState('all')
      const [libraryTab, setLibraryTab] = useState(restoredDrafts.family ? 'families' : 'skills')
      const [families, setFamilies] = useState([])
      const [previewId, setPreviewId] = useState(undefined)
      const [familyDraft, setFamilyDraft] = useState(restoredDrafts.family)
      useLayoutEffect(() => persistEditorDrafts(roleWorkspace, familyDraft), [roleWorkspace, familyDraft])
      useEffect(() => {
        if (restoredDrafts.role || restoredDrafts.family) setNotice(t('已恢复未保存的草稿', 'Unsaved draft restored'))
      }, [])
      const [extraction, setExtraction] = useState(undefined)
      const [draftSelection, setDraftSelection] = useState(undefined)
      const [discardDraft, setDiscardDraft] = useState(false)
      const [draftSaving, setDraftSaving] = useState(false)
      const previewFamily = !familyDraft && !extraction && libraryTab === 'families' ? families.find(family => family.id === previewId) : undefined
      const extractionMembers = useMemo(() => extraction
        ? familySelectionMembers(extraction.source, extraction.roots) : new Set(), [extraction])
      const draftPlan = useMemo(() => familyDraft && familyDraftPlan(familyDraft, list.skills), [familyDraft, list.skills])
      const draftGraph = useMemo(() => familyDraft && {
        ...familyDraft, name: familyDraft.name.trim() || t('新能力族', 'New ability family'), entries: draftPlan.entries,
      }, [familyDraft, draftPlan, language])
      const [familyError, setFamilyError] = useState('')
      const [removalActive, setRemovalActive] = useState(false)
      const [roleMenu, setRoleMenu] = useState(false)
      useEffect(() => setRoleDetailsOpen(false), [selectedRole])
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
      const [deleteTarget, setDeleteTarget] = useState(undefined)
      const [renameDraft, setRenameDraft] = useState(undefined)
      useEffect(() => {
        if (!roleMenu) {
          setCreatingRole(undefined)
          setRenameDraft(undefined)
        }
      }, [roleMenu])
      const [apps, setApps] = useState(undefined)
      const [appsLoading, setAppsLoading] = useState(false)
      const zoneRef = useRef(undefined)

      // Right-drag pans the canvas. Scroll offsets are used rather than a CSS
      // transform so the browser keeps its scrollbars and wheel scrolling intact.
      const canvasRef = useRef(undefined)
      const panRef = useRef(undefined)
      const [panning, setPanning] = useState(false)
      const [rolePan, setRolePan] = useState({ x: 0, y: 0 })
      const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 })
      const pan = previewFamily || familyDraft ? previewPan : rolePan
      const setPan = previewFamily || familyDraft ? setPreviewPan : setRolePan
      const openPreview = id => {
        if (id !== previewId) setPreviewPan({ x: 0, y: 0 })
        setPreviewId(id)
      }

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
          setList({ status: 'ready', roles: (body.roles ?? []).sort(byDisplayName), skills: body.skills ?? [] })
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

      const loadFamilies = useCallback(async () => {
        setFamilyError('')
        try {
          const response = await fetch(API + '/families')
          if (!response.ok) throw new Error('HTTP ' + response.status)
          setFamilies((await response.json()).families.sort(byDisplayName))
        } catch (cause) {
          setFamilyError(t('无法读取能力族：', 'Could not load ability families: ') + String(cause.message ?? cause))
        }
      }, [])

      useEffect(() => {
        if (libraryTab === 'families') void loadFamilies()
      }, [libraryTab, loadFamilies])

      const changeFamily = async payload => {
        const response = await fetch(API + '/families', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.message ?? body.error ?? 'HTTP ' + response.status)
        await loadFamilies()
        return body.result
      }

      const startFamilyDraft = family => {
        setError(undefined)
        setDiscardDraft(false)
        setDraftSelection(undefined)
        setPreviewPan({ x: 0, y: 0 })
        const draft = {
          id: family?.id, revision: family?.revision, name: family?.name ?? '',
          description: family?.description ?? '',
          members: family?.members ?? [], edges: family?.edges ?? [],
          undo: [], redo: [],
        }
        setFamilyDraft({ ...draft, savedSignature: familyDraftSignature(draft) })
      }
      const editFamilyRecord = async (item, payload) => {
        setDraftSaving(true)
        setError(undefined)
        try {
          const current = familyDraft?.id === item.id
          const saved = await changeFamily({
            ...payload, id: item.id,
            expectedRevision: current ? familyDraft.revision : item.revision,
          })
          if (payload.action === 'delete') {
            if (previewId === item.id) setPreviewId(undefined)
            if (current) setFamilyDraft(undefined)
            setNotice(t('已删除能力族 ', 'Deleted ability family ') + item.name)
          } else if (current) {
            setFamilyDraft(draft => ({
              ...draft, name: saved.name, revision: saved.revision,
              savedSignature: familyDraftSignature({ ...saved, description: saved.description ?? '' }),
            }))
          }
          return true
        } catch (cause) {
          setError(String(cause.message ?? cause))
          return false
        } finally {
          setDraftSaving(false)
        }
      }
      const renameFamily = (item, name) => editFamilyRecord(item, { action: 'update', name })
      const deleteFamily = item => editFamilyRecord(item, { action: 'delete' })
      const updateDraft = changes => {
        if (draftSaving) return
        setError(undefined)
        setDiscardDraft(false)
        setFamilyDraft(current => {
          const next = { ...current, ...changes }
          if (familyDraftSignature(next) === familyDraftSignature(current)) return current
          if (changes.name !== undefined) return next
          return {
            ...next, undo: [...current.undo, familyDraftContent(current)].slice(-DRAFT_HISTORY_LIMIT), redo: [],
          }
        })
      }
      const stepFamilyHistory = direction => {
        if (draftSaving || !familyDraft?.[direction].length) return
        setError(undefined)
        setDiscardDraft(false)
        setNotice(undefined)
        setDraftSelection(undefined)
        const opposite = direction === 'undo' ? 'redo' : 'undo'
        setFamilyDraft(current => current?.[direction].length ? ({
          ...current, ...current[direction].at(-1),
          [direction]: current[direction].slice(0, -1),
          [opposite]: [...current[opposite], familyDraftContent(current)],
        }) : current)
      }
      const closeFamilyDraft = () => {
        if (draftSaving) return
        if (familyDraftDirty(familyDraft) && !discardDraft) {
          setDiscardDraft(true)
          return
        }
        setError(undefined)
        setFamilyDraft(undefined)
      }
      const saveFamilyDraft = async nextFamily => {
        if (!canSaveFamily) return
        setDiscardDraft(false)
        setDraftSaving(true)
        setError(undefined)
        try {
          const saved = await changeFamily({
            action: familyDraft.id === undefined ? 'create' : 'update',
            id: familyDraft.id, expectedRevision: familyDraft.revision, name: familyDraft.name,
            description: familyDraft.description,
            graph: { members: familyDraft.members, edges: familyDraft.edges },
          })
          if (nextFamily) startFamilyDraft(nextFamily)
          else {
            setFamilyDraft(current => ({
              ...current, id: saved.id, revision: saved.revision, name: saved.name,
              description: saved.description ?? '', members: saved.members, edges: saved.edges,
              savedSignature: familyDraftSignature({ ...saved, description: saved.description ?? '' }),
            }))
            setPreviewId(saved.id)
          }
          setNotice(FAMILY_SAVED)
        } catch (cause) {
          setError(String(cause.message ?? cause))
        } finally {
          setDraftSaving(false)
        }
      }
      const startExtraction = source => {
        setError(undefined)
        setPreviewId(undefined)
        setExtraction({ source, name: '', roots: [] })
      }
      const toggleExtraction = name => {
        if (draftSaving) return
        if (extraction.roots.includes(name)) {
          setExtraction({ ...extraction, roots: extraction.roots.filter(root => root !== name) })
        } else if (extractionMembers.has(name)) {
          setNotice(t('仍被所选技能依赖，无法单独取消：', 'Still required by a selected skill: ') + name)
        } else {
          setExtraction({ ...extraction, roots: [...extraction.roots, name] })
        }
      }
      const saveExtraction = async () => {
        if (draftSaving || !extraction.name.trim() || extraction.roots.length === 0) return
        setDraftSaving(true)
        setError(undefined)
        try {
          const saved = await changeFamily({
            action: 'create', name: extraction.name, roleId: extraction.source.id,
            roleRevision: extraction.source.revision, members: extraction.roots,
          })
          setExtraction(undefined)
          openPreview(saved.id)
        } catch (cause) {
          setError(String(cause.message ?? cause))
        } finally {
          setDraftSaving(false)
        }
      }
      const linkDraft = (from, to, replace = false) => {
        const members = [...new Set([...familyDraft.members, from, to].filter(name => name !== '__role__'))]
        if (from === '__role__' || to === '__role__') {
          if (members.length !== familyDraft.members.length) updateDraft({ members })
          return
        }
        const original = familyDraft.edges.find(edge => edge.from === from && edge.to === to)
        if (original && !replace) return
        const edges = replace ? familyDraft.edges.filter(edge => edge.from !== from) : familyDraft.edges
        const reachable = new Set()
        const stack = [to]
        while (stack.length) {
          const name = stack.pop()
          if (name === from) {
            setError(t('这条依赖会形成环', 'This dependency would create a cycle'))
            return
          }
          if (reachable.has(name)) continue
          reachable.add(name)
          for (const edge of edges) if (edge.from === name) stack.push(edge.to)
        }
        updateDraft({ members, edges: [...edges, original ?? { from, to }] })
      }
      const removeDraftSkill = name => {
        updateDraft({
          members: familyDraft.members.filter(member => member !== name),
          edges: familyDraft.edges.filter(edge => edge.from !== name && edge.to !== name),
        })
        setDraftSelection(undefined)
      }

      // Ctrl+Z / Ctrl+Shift+Z, the shortcuts every editor uses for this.
      useEffect(() => {
        const onKey = event => {
          if (previewFamily && event.key === 'Escape' && !event.defaultPrevented) setPreviewId(undefined)
          if (extraction && event.key === 'Escape' && !draftSaving) setExtraction(undefined)
          if (event.defaultPrevented || previewFamily || extraction
            || event.target?.closest?.('input, textarea, [contenteditable="true"], dialog')) return
          if (!(event.ctrlKey || event.metaKey)) return
          if (String(event.key).toLowerCase() !== 'z') return
          event.preventDefault()
          const direction = event.shiftKey ? 'redo' : 'undo'
          if (familyDraft) stepFamilyHistory(direction)
          else stepRoleDraft(direction)
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [detail, previewFamily, familyDraft, extraction, draftSaving, roleWorkspace, pending])

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

      const send = async (path, payload, message, role = detail.role) => {
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
              ? t('这个角色刚被别处修改过，请刷新后再操作', 'This role changed elsewhere. Refresh and try again.')
              : (body.message ?? body.code ?? body.error ?? `HTTP ${response.status}`))
          }
          await Promise.all([loadList(), role.id === selectedRole ? loadDetail(role.id) : undefined])
          if (message !== undefined) setNotice(message)
          return true
        } catch (cause) {
          setNotice(undefined)
          setError(String(cause?.message ?? cause))
          return false
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
          if (!response.ok) throw new Error(body.message ?? body.code ?? body.error ?? 'HTTP ' + response.status)
          setCreatingRole(undefined)
          setRoleMenu(false)
          await loadList()
          if (body.role !== undefined) requestRoleSwitch(body.role)
          setNotice(t('已创建角色 ', 'Created role ') + name)
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
              ? t('这个角色刚被别处修改过，请刷新后再操作', 'This role changed elsewhere. Refresh and try again.')
              : (body.message ?? body.error ?? 'HTTP ' + response.status))
          }
          if (selectedRole === item.id) {
            setList(current => ({ ...current, roles: current.roles.filter(role => role.id !== item.id) }))
            selectRole(undefined)
            setSelectedSkill(undefined)
            setDetail({ status: 'idle' })
          }
          await loadList()
          setNotice(t('已删除角色 ', 'Deleted role ') + item.name)
          return true
        } catch (cause) {
          setError(String(cause?.message ?? cause))
          return false
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
          setError(t('读取已安装应用失败：', 'Could not list installed apps: ') + String(cause?.message ?? cause))
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

          setNotice(t('已用 ' + appId + ' 打开 ' + dir, 'Opened ' + dir + ' in ' + appId))
        } catch (cause) {
          setError(t('打开失败：', 'Could not open: ') + String(cause?.message ?? cause))
        }
      }

      const savedRole = detail.status === 'ready' && detail.role.id === selectedRole ? detail.role : undefined
      const matchingWorkspace = savedRole && roleWorkspace?.id === savedRole.id ? roleWorkspace : undefined
      const workspace = matchingWorkspace && (
        matchingWorkspace.baseSignature === graphSignature(savedRole)
        || graphSignature(matchingWorkspace.current.role) !== matchingWorkspace.baseSignature
      ) ? matchingWorkspace : undefined
      const roleDirty = !!workspace && graphSignature(workspace.current.role) !== workspace.baseSignature
      const graphRole = roleDirty
        ? { ...savedRole, members: workspace.current.role.members, edges: workspace.current.role.edges }
        : savedRole
      const selectRole = id => {
        setRoleWorkspace(undefined)
        setRoleSwitchTarget(undefined)
        setSelectedSkill(undefined)
        setSelectedRole(id)
      }
      const requestRoleSwitch = item => {
        if (pending || item.id === selectedRole) return
        if (roleDirty) setRoleSwitchTarget(item)
        else selectRole(item.id)
      }
      const reviewedTicket = useRef(undefined)
      useEffect(() => {
        if (!review?.ticket || review.ticket === reviewedTicket.current || list.status !== 'ready' || pending || draftSaving) return
        reviewedTicket.current = review.ticket
        if (roleDirty || familyDraftDirty(familyDraft) || extraction) {
          setNotice(t('已打开技能编排侧栏，当前草稿仍可继续编辑', 'Skill Loom opened. Your draft is still available.'))
          return
        }
        setFamilyDraft(undefined)
        if (review.familyId) {
          if (libraryTab === 'families') void loadFamilies()
          setLibraryTab('families')
          openPreview(review.familyId)
        } else if (review.roleId) {
          void loadList()
          setPreviewId(undefined)
          setLibraryTab('skills')
          if (selectedRole === review.roleId) void loadDetail(review.roleId)
          else selectRole(review.roleId)
        }
      }, [review, list, pending, draftSaving])
      const stepRoleDraft = direction => {
        if (pending || !workspace?.[direction].length) return
        const opposite = direction === 'undo' ? 'redo' : 'undo'
        setRoleWorkspace(current => current?.[direction].length ? {
          ...current, current: current[direction].at(-1),
          [direction]: current[direction].slice(0, -1),
          [opposite]: [...current[opposite], current.current],
        } : current)
        setError(undefined)
        setNotice(undefined)
        setSelectedSkill(undefined)
      }
      const writeRoleGraph = async (graph, preview) => {
        if (workspace && workspace.baseSignature !== graphSignature(savedRole)) {
          throw new Error(t('已保存的角色编排在别处被修改，当前草稿已保留', 'The saved graph changed elsewhere. Your draft was kept.'))
        }
        const response = await fetch(API + '/roles/' + encodeURIComponent(savedRole.id) + '/graph', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'set_graph', preview, expectedRevision: savedRole.revision,
            members: graph.members, edges: graph.edges,
          }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error === 'conflict'
          ? t('角色刚被别处修改，当前草稿已保留', 'This role changed elsewhere. Your draft was kept.') : body.message ?? body.error ?? 'HTTP ' + response.status)
        return body.result.result
      }
      const editRoleGraph = async (graph, afterPreview) => {
        if (pending || !savedRole) return
        if (graphSignature(graph) === graphSignature(graphRole)) {
          afterPreview?.(graphRole)
          return
        }
        setPending(true)
        setError(undefined)
        setNotice(undefined)
        try {
          const current = await writeRoleGraph(graph, true)
          if (graphSignature(current.role) === graphSignature(graphRole)) {
            afterPreview?.(current.role)
            return
          }
          const previous = workspace?.current ?? { role: savedRole, plan: detail.plan }
          setRoleWorkspace({
            id: savedRole.id, baseSignature: workspace?.baseSignature ?? graphSignature(savedRole), current,
            undo: [...(workspace?.undo ?? []), previous].slice(-DRAFT_HISTORY_LIMIT), redo: [],
          })
          afterPreview?.(current.role)
        } catch (cause) {
          setError(String(cause.message ?? cause))
        } finally {
          setPending(false)
        }
      }
      const saveRoleGraph = async nextRole => {
        if (pending || !roleDirty) return
        setPending(true)
        setRoleGraphSaving(true)
        setError(undefined)
        try {
          const current = await writeRoleGraph(graphRole, false)
          if (nextRole) selectRole(nextRole.id)
          else {
            setRoleWorkspace({ ...workspace, current, baseSignature: graphSignature(current.role) })
            setDetail({ status: 'ready', role: current.role, plan: current.plan })
            setNotice(t('角色编排已保存', 'Role graph saved'))
          }
          await loadList()
        } catch (cause) {
          setError(String(cause.message ?? cause))
        } finally {
          setPending(false)
          setRoleGraphSaving(false)
        }
      }
      const linkRoleSkill = (from, to, mode) => {
        if (!graphRole) return
        if (from === '__role__' || to === '__role__') {
          const name = from === '__role__' ? to : from
          void editRoleGraph({ ...graphRole, members: [...new Set([...graphRole.members, name])] })
          return
        }
        const existing = graphRole.edges.find(edge => edge.from === from && edge.to === to)
        const edges = graphRole.edges.filter(edge => edge.from !== from || (mode !== 'replace' && edge.to !== to))
        void editRoleGraph({
          members: [...new Set([...graphRole.members, from, to])],
          edges: [...edges, existing ?? { from, to }],
        })
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
        if (familyDraft) removeDraftSkill(name)
        else if (graphRole) void editRoleGraph({
          members: graphRole.members.filter(member => member !== name),
          edges: graphRole.edges.filter(edge => edge.from !== name && edge.to !== name),
        })
        return true
      }

      const insertFamily = (family, target) => {
        if (pending || !graphRole) return
        if (target !== undefined && familyBlockedTargets(graphRole, family).has(target)) {
          setError(t('接到此技能会形成循环依赖', 'Connecting to this skill would create a cycle'))
          return
        }
        const members = new Set(graphRole.members)
        const edges = new Map(graphRole.edges.map(edge => [edgeKey(edge), edge]))
        const attached = target === undefined ? [] : family.entries.map(from => ({ from, to: target }))
        const merged = new Map(edges)
        for (const edge of [...family.edges, ...attached]) {
          if (!merged.has(edgeKey(edge))) merged.set(edgeKey(edge), edge)
        }
        void editRoleGraph({
          members: [...new Set([...members, ...family.members])], edges: [...merged.values()],
        }, saved => {
          const addedMembers = new Set(saved.members.filter(name => !members.has(name)))
          const addedEdges = new Set(saved.edges.map(edgeKey).filter(key => !edges.has(key)))
          if (addedMembers.size === 0 && addedEdges.size === 0) {
            setNotice(t('「' + familyName(family) + '」已包含，无需添加', '“' + familyName(family) + '” is already included'))
            return
          }
          setInsertedFamily({ role: saved, members: addedMembers, edges: addedEdges })
          setNotice(t('「' + familyName(family) + '」新增 ' + addedMembers.size + ' 项技能、' + addedEdges.size + ' 条依赖', 'Added ' + addedMembers.size + ' skills and ' + addedEdges.size + ' dependencies from “' + familyName(family) + '”'))
        })
      }

      const dropLibraryCard = (item, target) => {
        if (item.family) {
          insertFamily(item.family, target === '__role__' ? undefined : target)
          return
        }
        const value = item.name
        if (familyDraft) {
          linkDraft(value, target)
          return
        }
        linkRoleSkill(value, target, 'add')
      }
      const libraryHover = useLibraryHover(canvasRef, JSON.stringify([selectedRole, libraryTab, !!familyDraft, familyDraft?.id, !!extraction]))
      const { card: dragCard, bind: bindLibraryDrag } = useLibraryDrag(item => {
        libraryHover.hide()
        if (item.family) setPreviewId(undefined)
      }, dropLibraryCard)

      const roleReady = !!savedRole
      const role = graphRole
      const plan = roleDirty ? workspace.current.plan : roleReady ? detail.plan : undefined
      const roleCanvas = roleReady && !previewFamily && !familyDraft && !extraction
      const familyForm = familyDraft ?? extraction
      const canSaveFamily = familyForm && !draftSaving && !!familyForm.name.trim()
        && (familyDraft?.members.length ?? extractionMembers.size) > 0
        && (!familyDraft || familyDraftDirty(familyDraft))
      const showFamilySaved = familyDraft && !familyDraftDirty(familyDraft) && notice === FAMILY_SAVED

      const shownPlan = draftPlan ?? plan
      const members = new Set(shownPlan?.members)
      const catalogNames = new Set(list.skills.map(skill => skill.name))
      const keywords = skillQuery.toLowerCase().trim().split(/\s+/).filter(Boolean)
      const matches = [...list.skills, ...[...members].filter(name => !catalogNames.has(name)).map(name => ({ name }))]
        .filter(skill => {
          const text = (skill.name + '\n' + (skill.description ?? '')).toLowerCase()
          return keywords.every(word => text.includes(word))
        }).sort(byDisplayName)
      const includedCount = matches.filter(skill => members.has(skill.name)).length
      const filtered = !shownPlan || skillMembership === 'all' ? matches
        : matches.filter(skill => members.has(skill.name) === (skillMembership === 'included'))

      // Two panes in both layouts; only the split direction differs. The wide page
      // puts the list beside the graph, the narrow one below it — no floating panel
      // means nothing has to be lifted above it while dragging.
      const stageStyle = {
        display: 'flex',
        flexDirection: compact ? 'column' : 'row',
        height: '100%',
        minHeight: 0,
        position: 'relative',
        font: 'inherit',
        color: 'inherit',
        overflow: 'hidden',
      }
      const canvasStyle = {
        ...styles.canvasFill,
        position: 'relative',
        inset: 'auto',
        flex: '1 1 auto',
        minWidth: 0,
        minHeight: compact ? 160 : 0,
        paddingRight: 0,
      }
      const panelStyle = compact
        ? { ...styles.panel, position: 'relative', top: 'auto', right: 'auto', bottom: 'auto', width: 'auto', flex: '1 1 48%', minHeight: 0, borderRadius: 0, border: 'none', boxShadow: 'none', zIndex: 1 }
        : {
            ...styles.panel,
            position: 'relative',
            top: 'auto',
            right: 'auto',
            bottom: 'auto',
            width: 340,
            flex: '0 0 340px',
            borderRadius: 0,
            boxShadow: 'none',
            border: 'none',
            borderLeft: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.28))',
            zIndex: 1,
          }
      const feedbackText = error ?? (notice === FAMILY_SAVED ? undefined : notice)
      const hover = libraryHover.hover
      const skillDetailGraph = familyDraft ? draftGraph : roleCanvas && libraryTab === 'skills' ? role : undefined
      const skillDetailPlan = skillDetailGraph ? (familyDraft ? draftPlan : plan) : undefined
      const hoveredSkill = hover?.kind === 'skill'
        ? filtered.find(skill => skill.name === hover.id) : undefined
      const familyKeywords = familyQuery.toLowerCase().trim().split(/\s+/).filter(Boolean)
      const visibleFamilies = families.filter(family => {
        const text = [familyName(family), familyDescription(family), family.name, ...family.members].join('\n').toLowerCase()
        return familyKeywords.every(word => text.includes(word))
      })
      const hoveredFamily = !familyDraft && !extraction && libraryTab === 'families' && hover?.kind === 'family'
        ? visibleFamilies.find(family => family.id === hover.id) : undefined

      return h('div', {
        'data-loom-stage': '',
        style: stageStyle,
        // A drag that ends anywhere but a node must not fall back to the browser's
        // default drop action (which is what shows the search-the-web prompt).
        onDragOver: event => event.preventDefault(),
        onDrop: event => event.preventDefault(),
      },
        h('div', {
          ref: canvasRef,
          style: {
            ...canvasStyle,
            cursor: panning ? 'grabbing' : 'default',
          },
          onPointerDown: startPan,
          onPointerMove: movePan,
          onPointerUp: endPan,
          onPointerCancel: endPan,
          onSelectStart: event => event.preventDefault(),
          onDragStart: event => event.preventDefault(),
          onDragOver: event => event.preventDefault(),
          onDrop: event => event.preventDefault(),
        }, [
          (hoveredSkill || hoveredFamily) && h('div', {
            key: 'library-hover',
            className: 'loom-library-hover', 'data-compact': compact,
            style: { '--loom-hover-anchor': hover.top + 'px' },
            onPointerEnter: libraryHover.keep, onPointerLeave: libraryHover.leave,
            onPointerDown: event => event.stopPropagation(),
          }, hoveredFamily ? h(LibraryDetail, { kind: 'family', name: familyName(hoveredFamily) },
            h('div', { style: styles.muted }, familyDescription(hoveredFamily) || t('暂无简介', 'No description'))) : h(SkillDetail, {
            key: hoveredSkill.name, graph: skillDetailGraph, plan: skillDetailPlan,
            kind: familyDraft ? 'family' : 'role', skills: list.skills, skillName: hoveredSkill.name,
            apps, appsLoading, loadApps, launchInApp, folderOf,
          })),
          h('div', {
            style: {
              transform: `translate(${pan.x}px, ${pan.y}px)`,
              width: previewFamily || extraction ? '100%' : 'fit-content',
              padding: previewFamily || extraction ? '0 16px' : undefined,
              boxSizing: 'border-box',
              margin: '0 auto',
            },
          }, [
            extraction
              ? h(Graph, {
                key: 'family-extraction', role: extraction.source, plan: detail.plan, preview: true, onGrab: beginPan,
                selection: { roots: extraction.roots, members: extractionMembers, toggle: toggleExtraction },
              })
              : familyDraft
              ? h(React.Fragment, { key: 'draft-graph' }, [
                h(Graph, {
                key: 'family-editor',
                role: draftGraph, libraryDrag: dragCard,
                plan: draftPlan, selected: draftSelection, onSelect: setDraftSelection,
                onCreateEdge: (from, to, mode) => linkDraft(from, to, mode === 'replace'),
                onRemoveEdge: edge => updateDraft({
                  edges: familyDraft.edges.filter(item => item.from !== edge.from || item.to !== edge.to),
                }),
                onRemovalDrag: setRemovalActive, onRemoveDrop: dropToRemove,
                onDropMissed: () => setNotice(t('请将技能拖到节点或移除区', 'Drop the skill on a node or the removal zone')),
                onGrab: beginPan,
                }),
                !familyDraft.members.length && h('div', { key: 'empty', className: 'loom-family-editor-hint' },
                  t('把技能拖到能力族节点开始编排', 'Drop a skill on the family root to start')),
              ])
              : previewFamily
              ? h(Graph, {
                key: previewFamily.id, role: { ...previewFamily, name: familyName(previewFamily) }, plan: previewFamily.preview,
                preview: true, onGrab: beginPan,
              })
              : roleReady
              ? h(Graph, {
                  key: 'graph',
                  role,
                  plan,
                  selected: selectedSkill,
                  onSelect: name => {
                    if (name !== undefined) setLibraryTab('skills')
                    setSelectedSkill(name)
                  },
                  onOpenRoot: () => setRoleDetailsOpen(true),
                  onCreateEdge: linkRoleSkill,
                  libraryDrag: dragCard,
                  inserted: roleDirty && insertedFamily?.role === workspace.current.role ? insertedFamily : undefined,
                  onRemoveEdge: edge => void editRoleGraph({
                    members: role.members, edges: role.edges.filter(item => edgeKey(item) !== edgeKey(edge)),
                  }),
                  onRemovalDrag: setRemovalActive,
                  onRemoveDrop: dropToRemove,
                  onDropMissed: from => setNotice(t('松手时不在任何节点上，未建立依赖：', 'No dependency added. Drop on a node: ') + from),
                  onGrab: beginPan,
                })
              : h('div', { key: 'empty', style: { ...styles.empty, padding: 24 } },
                detail.status === 'error' ? detail.error
                  : detail.status === 'loading' ? t('加载中…', 'Loading…')
                    : list.status === 'ready' && list.roles.length === 0
                      ? t('还没有角色。让 agent 用 role_graph 建一个，刷新即可看到。', 'No roles yet. Create one here or ask the agent to use role_graph.')
                      : t('选择一个角色查看依赖图', 'Select a role to view its dependency graph')),
          ]),
          dragCard?.family && h('div', {
            key: 'family-drag-hint',
            role: 'status',
            style: { position: 'absolute', bottom: 12, left: 12, padding: '5px 9px', borderRadius: 6,
              pointerEvents: 'none', background: 'var(--dsw-alias-bg-layer-2, #fff)', fontSize: 12 },
          }, t('拖到高亮节点以插入能力族', 'Drop on a highlighted node to insert the family')),
          h('div', {
            key: 'feedback', className: 'loom-operation-result', role: 'status',
            'data-error': error !== undefined,
          }, feedbackText && h('span', null, feedbackText)),
          roleCanvas && !dragCard && !removalActive && h('div', {
            key: 'catalog-size',
            title: t('统计可用技能的名称和描述，不含技能正文或人设，也不是 token 数。', 'Character count for available skill names and descriptions. Skill bodies and persona are excluded.'),
            style: { ...styles.muted, position: 'absolute', bottom: 12, left: 12,
              padding: '3px 6px', borderRadius: 4, background: 'var(--dsw-alias-bg-layer-1, #fff)' },
          }, t('技能名称与描述约占 ' + plan.catalogChars.toLocaleString() + ' 字符', 'Skill names and descriptions: about ' + plan.catalogChars.toLocaleString() + ' characters')),
          familyForm && h('div', {
            key: 'family-heading',
            style: { ...styles.cornerBar, ...styles.cornerStack, maxWidth: 'calc(100% - 190px)' },
          }, [
            h('div', { key: 'name-row', className: 'loom-family-editor-heading' }, [
              h('button', {
                key: 'back', type: 'button', className: 'loom-option', disabled: draftSaving,
                onClick: extraction ? () => setExtraction(undefined) : closeFamilyDraft,
                'aria-label': extraction ? t('取消另存能力族', 'Cancel saving as an ability family') : discardDraft ? t('确认放弃能力族草稿', 'Confirm discarding the family draft') : t('返回能力族库', 'Back to the family library'),
              }, extraction ? t('取消', 'Cancel') : discardDraft ? t('放弃草稿', 'Discard draft') : t('← 返回', '← Back')),
              familyDraft && h(FamilyPicker, {
                key: familyDraft.id ?? 'new', draft: familyDraft, families, pending: draftSaving,
                choose: startFamilyDraft, rename: renameFamily,
                remove: item => setDeleteTarget({ kind: 'family', item, dirty: familyDraft.id === item.id && familyDraftDirty(familyDraft) }),
                canSave: canSaveFamily, saveAndChoose: saveFamilyDraft, error,
              }),
              familyDraftDirty(familyDraft) && h('span', { key: 'dirty', style: { ...styles.muted, whiteSpace: 'nowrap' } }, t('未保存', 'Unsaved')),
              (!familyDraft || familyDraft.id === undefined) && h('input', {
                key: 'name', className: 'loom-role-trigger', value: familyForm.name, maxLength: 64,
                placeholder: t('能力族名称', 'Ability family name'), 'aria-label': t('能力族名称', 'Ability family name'),
                style: { ...styles.select, maxWidth: 'none', height: 28 }, disabled: draftSaving,
                onChange: event => {
                  const name = event.target.value
                  if (extraction) setExtraction({ ...extraction, name })
                  else updateDraft({ name })
                },
              }),
            ]),
            familyDraft && h(InlineDescription, {
              key: 'summary', kind: 'family', value: familyDraft.description, pending: draftSaving,
              save: description => {
                updateDraft({ description })
                return true
              },
            }),
          ]),
          familyForm && h('div', { key: 'family-actions', style: { ...styles.historyBar, alignItems: 'flex-end', flexDirection: 'column' } }, [
            h(HistoryButtons, {
              key: 'history', pending: draftSaving, undo: familyDraft?.undo.length ?? 0, redo: familyDraft?.redo.length ?? 0,
              step: stepFamilyHistory, save: extraction ? saveExtraction : () => saveFamilyDraft(),
              canSave: canSaveFamily, saving: draftSaving, showHistory: !!familyDraft,
            }),
            showFamilySaved && h('span', { key: 'saved', role: 'status', style: styles.muted }, t('已保存', 'Saved')),
          ]),
          // Anchored to the drawing area, not the whole stage: in the narrow layout
          // the stage also holds the skill panel, and a stage-wide zone landed in
          // the middle of the sidebar instead of at the bottom of the graph.
          removalActive ? h('div', { ref: zoneRef, style: styles.trashZone }, t('拖到此处移除', 'Drop here to remove')) : null,
          roleReady && h(RoleDetails, {
            key: role.id, role, pending, send,
            open: roleCanvas && roleDetailsOpen,
            onClose: () => {
              setRoleDetailsOpen(false)
              roleDetailsButton.current?.focus()
            },
          }),
          // Inside the canvas, so "top-right" means the drawing area even now that
          // the page is split into a graph pane and a list pane.
          roleCanvas
            ? h('div', { style: { ...styles.historyBar, alignItems: 'flex-end', flexDirection: 'column' } }, [
              h(HistoryButtons, {
                key: 'history', pending, undo: workspace?.undo.length ?? 0, redo: workspace?.redo.length ?? 0,
                step: stepRoleDraft, save: () => saveRoleGraph(), canSave: roleDirty && !pending, saving: roleGraphSaving,
              }),
              h('div', { key: 'role-options', style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 } }, [
                roleDirty && h('span', { key: 'dirty', style: styles.muted }, t('未保存', 'Unsaved')),
                h('button', {
                  key: 'persona-edit', type: 'button', ref: roleDetailsButton,
                  style: { ...styles.button(true), marginLeft: 0, height: 24, padding: '0 8px' },
                  'aria-expanded': roleDetailsOpen, 'aria-controls': 'loom-role-details-' + role.id,
                  onClick: () => setRoleDetailsOpen(open => !open),
                }, t('编辑人设', 'Edit persona')),
              ]),
            ])
            : null,
        ]),

        deleteTarget && h(DeleteConfirmDialog, {
          key: deleteTarget.kind + deleteTarget.item.id, target: deleteTarget,
          pending: pending || draftSaving, error,
          onCancel: () => setDeleteTarget(undefined),
          onConfirm: async () => {
            const remove = deleteTarget.kind === 'role' ? deleteRoleById : deleteFamily
            if (await remove(deleteTarget.item)) setDeleteTarget(undefined)
          },
        }),
        roleSwitchTarget && h(DraftSwitchDialog, {
          key: roleSwitchTarget.id, target: roleSwitchTarget, pending, canSave: roleDirty && !pending, error,
          onSave: () => saveRoleGraph(roleSwitchTarget),
          onDiscard: () => selectRole(roleSwitchTarget.id),
          onCancel: () => setRoleSwitchTarget(undefined),
        }),
        h('style', { key: 'loom-css' }, MENU_CSS),
        dragCard && h('div', {
          key: 'drag-card', className: 'loom-drag-card', 'aria-hidden': true,
          style: { left: dragCard.left, top: dragCard.top, width: dragCard.width, height: dragCard.height },
        }, [
          h('span', { key: 'dot', style: styles.dot(dragCard.color) }),
          h('span', { key: 'name', className: 'loom-card-name' }, dragCard.name),
        ]),
        !familyForm && h('div', { style: { ...styles.cornerBar, ...styles.cornerStack } }, [
            previewFamily
              ? h('div', { key: 'preview', style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
                h('button', { key: 'back', type: 'button', className: 'loom-option', onClick: () => setPreviewId(undefined) }, t('← 返回角色', '← Back to role')),
                h('span', { key: 'title', style: { fontSize: 13, fontWeight: 600 } }, familyName(previewFamily)),
              ])
              : h('div', {
                key: 'roles', ref: roleMenuRef, style: { position: 'relative' },
                onKeyDown: event => {
                  if (event.key !== 'Escape' || !roleMenu) return
                  setRoleMenu(false)
                  roleMenuRef.current?.querySelector('button')?.focus()
                },
              }, [
              h('button', {
                key: 'toggle',
                type: 'button',
                className: 'loom-option loom-role-trigger',
                'aria-expanded': roleMenu, 'aria-controls': 'loom-role-picker',
                onClick: () => setRoleMenu(open => !open),
              }, [
                h('svg', {
                  key: 'icon',
                  viewBox: '0 0 16 16',
                  width: 16,
                  height: 16,
                  className: 'loom-option-icon',
                  'aria-hidden': true,
                }, h('path', { d: 'M8 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm-6 12c0-2.5 2.7-4 6-4s6 1.5 6 4v.5H2V14Z', fill: 'currentColor' })),
                h('span', { key: 'label', className: 'loom-option-label' }, roleReady ? role.name : (list.roles.length === 0 ? t('还没有角色', 'No roles yet') : t('选择角色', 'Choose a role'))),
                h('svg', {
                  key: 'chevron',
                  viewBox: '0 0 16 16',
                  width: 12,
                  height: 12,
                  className: 'loom-option-icon',
                  'aria-hidden': true,
                }, h('path', { d: 'M4 6l4 4 4-4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })),
              ]),
              roleMenu
                ? h('div', { key: 'menu', id: 'loom-role-picker', className: 'loom-menu loom-menu--float loom-role-picker' }, [
                  ...list.roles.map(item => h(PickerRow, {
                    key: item.id, item, kind: 'role', current: item.id === selectedRole, pending,
                    title: t(item.name + '（' + item.runtime.length + ' 可用 / ' + item.red.length + ' 缺失）', item.name + ' (' + item.runtime.length + ' available / ' + item.red.length + ' missing)'),
                    renameDraft, setRenameDraft,
                    choose: () => {
                      requestRoleSwitch(item)
                      setRoleMenu(false)
                    },
                    rename: (_, name) => send('fields', { action: 'set_name', name }, t('角色已重命名', 'Role renamed'), item),
                    remove: target => setDeleteTarget({ kind: 'role', item: target, dirty: target.id === selectedRole && roleDirty }),
                  })),
                  h('div', { key: 'footer', className: 'loom-role-picker-footer' }, creatingRole === undefined
                    ? h('button', {
                      key: 'new', type: 'button', className: 'loom-option',
                      onClick: () => setCreatingRole(''),
                    }, t('＋ 新建角色', '＋ New role'))
                    : h('form', { key: 'newform', onSubmit: event => {
                      event.preventDefault()
                      if (!pending && creatingRole.trim()) void createRole(creatingRole)
                    } }, [
                      h('input', {
                        key: 'i',
                        autoFocus: true,
                        value: creatingRole,
                        placeholder: t('角色名称', 'Role name'), 'aria-label': t('角色名称', 'Role name'),
                        onChange: event => setCreatingRole(event.target.value),
                        style: styles.select,
                      }),
                      h('button', {
                        key: 'ok', type: 'submit',
                        style: styles.button(!pending && creatingRole.trim() !== ''),
                        disabled: pending || creatingRole.trim() === '',
                      }, t('创建', 'Create')),
                    ])),
                ])
                : null,
            ]),
            roleCanvas && h(InlineDescription, {
              key: role.id, value: role.description ?? '', pending,
              save: description => send('fields', { action: 'set_description', description }, t('简介已保存', 'Description saved')),
            }),
        ]),

        list.status === 'ready'
          ? h('div', { style: panelStyle }, [
            h('div', { key: 'head', style: styles.panelHead }, [
              extraction ? h('h2', { key: 'extraction-title', style: styles.h2 }, t('另存能力族', 'Save as ability family'))
                : familyDraft ? h('h2', { key: 'library-title', style: styles.h2 }, t('技能库', 'Skill library'))
                : h('div', { key: 'tabs', className: 'loom-library-tabs' }, [['skills', t('技能', 'Skills')], ['families', t('能力族', 'Ability families')]].map(([tab, label]) => h('button', {
                key: tab, type: 'button', 'aria-pressed': libraryTab === tab,
                className: 'loom-library-tab', onClick: () => {
                  if (tab !== libraryTab) {
                    setPreviewId(undefined)
                    setSelectedSkill(undefined)
                  }
                  setLibraryTab(tab)
                },
              }, label))),
              libraryTab === 'families' && !familyForm && h(LibrarySearch, {
                key: 'family-search', query: familyQuery, setQuery: setFamilyQuery,
                label: t('搜索能力族名称、简介或成员技能', 'Search families by name, description, or skill'),
              }),
              (libraryTab === 'skills' || familyDraft) && h(SkillLibraryFilters, {
                key: 'filter', query: skillQuery, setQuery: setSkillQuery,
                membership: skillMembership, setMembership: setSkillMembership, showMembership: !!shownPlan,
                total: matches.length, included: includedCount,
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
              extraction ? h(FamilyExtractionSummary, { key: 'extraction-summary', extraction, members: extractionMembers })
                : libraryTab === 'families' && !familyDraft
                ? h(FamilyLibrary, {
                  key: role?.id ?? 'library', role: savedRole, roleDirty, families: visibleFamilies, familyError, pending, startFamilyDraft,
                  filtering: familyKeywords.length > 0,
                  remove: item => setDeleteTarget({ kind: 'family', item }),
                  previewId, openPreview, loadFamilies, bindLibraryDrag, startExtraction, bindLibraryHover: libraryHover.bind,
                })
                : h('div', { key: 'list', style: styles.skillScroll, tabIndex: 0,
                  role: 'region', 'aria-label': t('技能列表', 'Skill list') }, filtered.length === 0
                  ? h('div', { className: 'loom-skill-empty', role: 'status' },
                    keywords.length ? t('没有符合搜索和筛选条件的技能', 'No skills match the search and filters')
                      : shownPlan && skillMembership === 'included' ? t('当前画布还没有纳入技能', 'No skills included on this canvas')
                        : shownPlan && skillMembership === 'excluded' ? t('没有未纳入的技能', 'No excluded skills') : t('没有可用技能', 'No available skills'))
                  : filtered.map(skill => {
                const member = members.has(skill.name)
                const stateColor = (shownPlan?.red ?? []).includes(skill.name) ? COLORS.red
                  : (shownPlan?.gray ?? []).some(row => row.name === skill.name) ? COLORS.gray
                    : member ? COLORS.runtime : COLORS.member
                return h('div', {
                  key: skill.name,
                  className: 'loom-card loom-skill-card',
                  'data-selected': (familyDraft ? draftSelection : selectedSkill) === skill.name,
                  tabIndex: 0, role: 'button',
                  ...libraryHover.bind('skill', skill.name),
                  ...bindLibraryDrag({ name: skill.name, color: stateColor }, () => {
                    if (familyDraft) setDraftSelection(skill.name)
                    else setSelectedSkill(skill.name)
                  }, familyDraft ? draftSaving : pending || !roleReady),
                  onKeyDown: event => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    if (familyDraft) {
                      linkDraft(skill.name, '__role__')
                      setDraftSelection(skill.name)
                    } else setSelectedSkill(skill.name)
                  },
                }, [
                  h('span', { key: 'status', style: styles.dot(stateColor) }),
                  h('span', { key: 'n', className: 'loom-card-name' }, skill.name),
                  shownPlan && h('span', {
                    key: 'm', className: 'loom-card-info loom-skill-state', 'data-member': member,
                  }, member ? t('已纳入', 'Included') : t('未纳入', 'Excluded')),
                ])
              })),
            ]),
          ])
          : null)
    }
    function LibrarySearch({ query, setQuery, label }) {
      return h('div', { className: 'loom-search' }, [
        h('svg', { key: 'icon', width: 15, height: 15, viewBox: '0 0 16 16', 'aria-hidden': true,
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' },
        h('circle', { cx: 7, cy: 7, r: 4 }), h('path', { d: 'M10 10l3 3' })),
        h('input', {
          key: 'query', type: 'search', value: query, placeholder: label,
          'aria-label': label, onChange: event => setQuery(event.target.value),
        }),
        query && h('button', { key: 'clear', type: 'button', 'aria-label': t('清空搜索', 'Clear search'), onClick: () => setQuery('') }, '×'),
      ])
    }

    function SkillLibraryFilters({ query, setQuery, membership, setMembership, showMembership, total, included }) {
      return h(React.Fragment, null,
        h(LibrarySearch, { query, setQuery, label: t('搜索技能名称或描述', 'Search skill names or descriptions') }),
        showMembership && h('div', { className: 'loom-skill-filters', role: 'group', 'aria-label': t('按纳入状态筛选', 'Filter by membership') },
          [['all', t('全部', 'All'), total], ['included', t('已纳入', 'Included'), included], ['excluded', t('未纳入', 'Excluded'), total - included]]
            .map(([id, label, count]) => h('button', {
              key: id, type: 'button', className: 'loom-skill-filter', 'aria-pressed': membership === id,
              onClick: () => setMembership(id),
            }, label, h('span', { className: 'loom-card-info' }, count)))),
      )
    }

    function FamilyExtractionSummary({ extraction, members }) {
      return h('div', { className: 'loom-family-detail', style: styles.panelBody }, [
        h('p', { key: 'help', style: { ...styles.muted, margin: '0 0 10px' } },
          t('点击画布上的技能进行选择。它依赖的技能会自动纳入，虚线框表示自动纳入的依赖。', 'Select skills on the canvas. Prerequisites are included automatically and shown with dashed borders.')),
        h('div', { key: 'count', style: styles.sectionTitle, 'aria-live': 'polite' },
          t('将保存 ', 'Will save ') + members.size + t(' 项技能', ' skills')),
        h('ul', { key: 'items', className: 'loom-family-entries-list' }, [...members].sort(compareName).map(name =>
          h('li', { key: name, className: 'loom-family-entry' }, [
            name,
            !extraction.roots.includes(name) && h('span', { key: 'dependency', className: 'loom-card-info' }, t(' · 依赖', ' · prerequisite')),
          ]))),
      ])
    }

    function FamilyLibrary({ role, roleDirty, families, familyError, pending, filtering, remove, bindLibraryDrag, loadFamilies, previewId, openPreview, startFamilyDraft, startExtraction, bindLibraryHover }) {
      const actionStyle = { ...styles.button(!pending), marginLeft: 0 }
      return h('div', {
        className: 'loom-family-library', style: { ...styles.skillScroll, padding: '0 12px 8px' },
        tabIndex: 0, role: 'region', 'aria-label': t('能力族列表', 'Ability families'),
      }, [
        h('div', { key: 'toolbar', className: 'loom-family-toolbar' }, [
          h('button', { key: 'new', type: 'button', className: 'loom-family-new', disabled: pending,
            onClick: () => startFamilyDraft() }, t('＋ 新建能力族', '＋ New ability family')),
          h('button', { key: 'from-role', type: 'button', className: 'loom-option',
            disabled: pending || roleDirty || !role?.members?.length, onClick: () => startExtraction(role) },
          roleDirty ? t('保存角色后可另存', 'Save the role first') : t('从当前角色另存', 'Save from current role')),
        ]),
        familyError && h('div', { key: 'error', style: styles.error, role: 'alert' }, familyError),
        familyError && h('button', { key: 'retry', type: 'button', className: 'loom-option', onClick: loadFamilies }, t('重试加载', 'Retry')),
        !familyError && filtering && families.length === 0
          && h('div', { key: 'empty', className: 'loom-skill-empty', role: 'status' }, t('没有符合搜索条件的能力族', 'No ability families match the search')),
        ...families.map(family => h('div', {
          key: family.id,
          className: 'loom-card',
          'data-selected': previewId === family.id,
          ...bindLibraryHover('family', family.id),
        }, [
          h('button', {
            key: 'handle', type: 'button', className: 'loom-family-handle',
            'aria-pressed': previewId === family.id,
            ...bindLibraryDrag({ name: familyName(family), color: COLORS.role, family }, () => openPreview(family.id), !role || pending),
          }, [
            h('span', { key: 'icon', className: 'loom-family-icon', 'aria-hidden': true },
              h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 },
                h('path', { d: 'M8 5v3m-4 3V8h8v3' }),
                h('rect', { x: 6, y: 2, width: 4, height: 3, rx: 1 }),
                h('rect', { x: 2, y: 11, width: 4, height: 3, rx: 1 }),
                h('rect', { x: 10, y: 11, width: 4, height: 3, rx: 1 }))),
            h('span', { key: 'text', style: { minWidth: 0 } }, [
              h('span', { key: 'name', className: 'loom-card-name', style: { display: 'block', fontWeight: 600 } }, familyName(family)),
              h('span', { key: 'meta', className: 'loom-card-info' },
                (family.builtin ? t('预置 · ', 'Built-in · ') : '') + family.members.length + t(' 项技能', ' skills')),
            ]),
          ]),
          !family.builtin && h('div', { key: 'actions', className: 'loom-family-actions' }, [
            h('button', { key: 'edit', type: 'button', style: actionStyle, disabled: pending,
              onClick: () => startFamilyDraft(family) }, t('编辑', 'Edit')),
            h('button', { key: 'delete', type: 'button', style: actionStyle, disabled: pending,
              'aria-label': t('删除能力族 ', 'Delete ability family ') + family.name, onClick: () => remove(family) }, t('删除', 'Delete')),
          ]),
        ])),
      ])
    }

    function FamilyPicker({ draft, families, pending, choose, rename, remove, canSave, saveAndChoose, error }) {
      const [open, setOpen] = useState(false)
      const [renameDraft, setRenameDraft] = useState(undefined)
      const [switchTo, setSwitchTo] = useState(undefined)
      const switchTarget = families.find(item => item.id === switchTo)
      const ref = useRef(null)
      const close = () => {
        setOpen(false)
        setRenameDraft(undefined)
      }
      useEffect(() => {
        if (!open) return undefined
        const onDown = event => {
          if (!ref.current?.contains(event.target)) close()
        }
        document.addEventListener('pointerdown', onDown, true)
        return () => document.removeEventListener('pointerdown', onDown, true)
      }, [open])
      const select = item => {
        close()
        setSwitchTo(undefined)
        choose(item)
      }
      return h('div', {
        ref, style: { position: 'relative', minWidth: 0 },
        onKeyDown: event => {
          if (event.key !== 'Escape' || !open) return
          close()
          ref.current?.querySelector('button')?.focus()
        },
      }, [
        h('button', {
          key: 'toggle', type: 'button', className: 'loom-option loom-role-trigger',
          disabled: pending, 'aria-expanded': open, 'aria-controls': 'loom-family-picker',
          onClick: () => open ? close() : setOpen(true),
        }, [
          h('span', { key: 'name', className: 'loom-option-label' }, draft.id ? draft.name : t('切换能力族', 'Switch ability family')),
          h('svg', { key: 'chevron', width: 12, height: 12, viewBox: '0 0 16 16', 'aria-hidden': true },
            h('path', { d: 'M4 6l4 4 4-4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 })),
        ]),
        open && h('div', { key: 'menu', id: 'loom-family-picker', className: 'loom-menu loom-menu--float loom-role-picker' }, [
          ...families.filter(item => !item.builtin).map(item => h(PickerRow, {
            key: item.id, item, kind: 'family', current: item.id === draft.id, pending,
            renameDraft, setRenameDraft, rename, remove,
            choose: target => {
              if (pending) return
              if (target.id === draft.id) close()
              else if (familyDraftDirty(draft)) {
                close()
                setSwitchTo(target.id)
              } else select(target)
            },
          })),
          families.every(item => item.builtin) && h('div', { key: 'empty', style: styles.muted }, t('暂无可编辑的能力族', 'No editable ability families')),
        ]),
        switchTarget && h(DraftSwitchDialog, {
          key: switchTarget.id, target: switchTarget, pending, canSave, error,
          onSave: () => saveAndChoose(switchTarget),
          onDiscard: () => select(switchTarget),
          onCancel: () => {
            setSwitchTo(undefined)
            ref.current?.querySelector('button')?.focus()
          },
        }),
      ])
    }

    function DeleteConfirmDialog({ target, pending, error, onConfirm, onCancel }) {
      const ref = useRef(null)
      const [attempted, setAttempted] = useState(false)
      useEffect(() => {
        const dialog = ref.current
        dialog.showModal()
        return () => dialog.close()
      }, [])
      return h('dialog', {
        ref, className: 'loom-confirm-dialog',
        'aria-labelledby': 'loom-delete-title', 'aria-describedby': 'loom-delete-description',
        onCancel: event => {
          event.preventDefault()
          event.stopPropagation()
          if (!pending) onCancel()
        },
      }, [
        h('h2', { key: 'title', id: 'loom-delete-title', style: styles.h2 }, t('删除' + kindName(target.kind) + '？', 'Delete ' + kindName(target.kind) + '?')),
        h('p', { key: 'description', id: 'loom-delete-description', style: styles.muted },
          t('确定删除' + kindName(target.kind) + '「' + target.item.name + '」吗？', 'Delete “' + target.item.name + '”?')
          + (target.dirty ? t(' 未保存的草稿也会丢失。', ' Your unsaved draft will also be lost.') : '')),
        attempted && error && h('p', { key: 'error', role: 'alert', style: styles.error }, error),
        h('div', { key: 'actions', className: 'loom-confirm-actions' }, [
          h('button', { key: 'cancel', type: 'button', className: 'loom-option', autoFocus: true,
            disabled: pending, onClick: onCancel }, t('取消', 'Cancel')),
          h('button', { key: 'confirm', type: 'button', className: 'loom-option loom-role-trigger',
            style: { color: COLORS.red }, disabled: pending, onClick: () => {
              setAttempted(true)
              void onConfirm()
            } }, pending ? t('删除中…', 'Deleting…') : t('确认删除', 'Confirm deletion')),
        ]),
      ])
    }

    function DraftSwitchDialog({ target, pending, canSave, error, onSave, onDiscard, onCancel }) {
      const ref = useRef(null)
      const cancelRef = useRef(null)
      const [attempted, setAttempted] = useState(false)
      useEffect(() => {
        const dialog = ref.current
        if (!dialog.open) dialog.showModal()
        cancelRef.current?.focus()
        return () => dialog.close()
      }, [])
      const cancel = () => {
        if (pending) return
        ref.current?.close()
        onCancel()
      }
      return h('dialog', {
        ref, className: 'loom-confirm-dialog',
        'aria-labelledby': 'loom-family-switch-title',
        'aria-describedby': 'loom-family-switch-description',
        onCancel: event => {
          event.preventDefault()
          event.stopPropagation()
          cancel()
        },
      }, [
        h('h2', { key: 'title', id: 'loom-family-switch-title', style: styles.h2 }, t('当前草稿还未保存', 'Unsaved draft')),
        h('p', { key: 'description', id: 'loom-family-switch-description', style: styles.muted }, t('切换到「' + target.name + '」前，如何处理当前草稿？', 'What should happen to the draft before switching to “' + target.name + '”?')),
        attempted && error && h('p', { key: 'error', role: 'alert', style: styles.error }, error),
        h('div', { key: 'actions', className: 'loom-confirm-actions' }, [
          h('button', { key: 'stay', ref: cancelRef, type: 'button', className: 'loom-option', disabled: pending,
            onClick: cancel }, t('继续编辑', 'Continue editing')),
          h('button', { key: 'discard', type: 'button', className: 'loom-option', disabled: pending,
            onClick: onDiscard }, t('放弃并切换', 'Discard and switch')),
          h('button', { key: 'save', type: 'button', className: 'loom-option loom-role-trigger', disabled: !canSave,
            onClick: () => {
              setAttempted(true)
              void onSave()
            } }, pending ? t('保存中…', 'Saving…') : t('保存并切换', 'Save and switch')),
        ]),
      ])
    }

    function PickerRow({ item, kind, current, title, pending, renameDraft, setRenameDraft, choose, rename, remove }) {
      return h('div', null, [
        h('div', { key: 'row', className: 'loom-role-picker-row', 'data-current': current }, [
          renameDraft?.id === item.id ? h('input', {
            key: 'rename-input', className: 'loom-role-picker-rename',
            autoFocus: true, maxLength: 64, value: renameDraft.name, readOnly: pending,
            'aria-label': t('新' + kindName(kind) + '名称', 'New ' + kindName(kind) + ' name'),
            style: { ...styles.select, height: 28, maxWidth: 'none' },
            onFocus: event => event.currentTarget.select(),
            onChange: event => setRenameDraft({ ...renameDraft, name: event.target.value }),
            onKeyDown: async event => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'Escape') {
                event.stopPropagation()
                setRenameDraft(undefined)
              }
              if (event.key !== 'Enter' || pending) return
              event.preventDefault()
              const name = renameDraft.name.trim()
              if (name && (name === item.name || await rename(item, name))) {
                setRenameDraft(undefined)
              }
            },
          }) : h('button', {
            key: 'n', type: 'button', className: 'loom-option loom-role-picker-choice',
            'aria-current': current ? 'true' : undefined,
            title,
            onClick: () => choose(item),
          }, [
            h('span', { key: 'name', className: 'loom-option-label' }, item.name),
            current && h('span', { key: 'check', 'aria-hidden': true }, '✓'),
          ]),
          h('button', {
            key: 'rename', type: 'button', className: 'loom-option loom-role-picker-icon',
            'aria-label': t('重命名' + kindName(kind) + ' ' + item.name, 'Rename ' + kindName(kind) + ' ' + item.name),
            disabled: pending || renameDraft?.id === item.id,
            onClick: () => {
              setRenameDraft({ id: item.id, name: item.name })
            },
          }, h('svg', {
            width: 15, height: 15, viewBox: '0 0 16 16', 'aria-hidden': true,
            fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
          }, h('path', { d: 'm3 10-.5 3.5L6 13l7-7-3-3-7 7Zm5.5-5.5 3 3' }))),
          h('button', {
            key: 'x', type: 'button', className: 'loom-option loom-role-picker-icon',
            'aria-label': t('删除' + kindName(kind) + ' ' + item.name, 'Delete ' + kindName(kind) + ' ' + item.name),
            disabled: pending,
            onClick: () => {
              setRenameDraft(undefined)
              remove(item)
            },
          }, h('svg', {
            width: 15, height: 15, viewBox: '0 0 16 16', 'aria-hidden': true,
            fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
          }, h('path', { d: 'M3 4.5h10M6 4.5V3h4v1.5m1.7 0-.5 8h-6.4l-.5-8M7 7v3m2-3v3' }))),
        ]),
      ])
    }

    function InlineDescription({ kind = 'role', value, pending, save }) {
      const [draft, setDraft] = useState(undefined)
      if (draft === undefined) return h('button', {
        type: 'button', className: 'loom-role-summary', 'data-empty': !value,
        title: value || undefined, disabled: pending, onClick: () => setDraft(value),
      }, value || t('点击添加' + kindName(kind) + '简介', 'Add a ' + kindName(kind) + ' description'))
      return h('input', {
        type: 'text', className: 'loom-role-summary', style: { ...styles.select, width: 'min(285px, 35vw)', maxWidth: 'none' },
        autoFocus: true, value: draft, maxLength: 160, readOnly: pending,
        'aria-label': t(kindName(kind) + '简介', kindName(kind) + ' description'),
        placeholder: t('用一句话描述' + kindName(kind) + '用途', 'Describe the purpose in one sentence'),
        onChange: event => setDraft(event.target.value),
        onBlur: () => setDraft(undefined),
        onKeyDown: async event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(undefined)
          }
          if (event.key !== 'Enter' || pending) return
          event.preventDefault()
          const description = draft.trim().replace(/\s+/g, ' ')
          if (description === value || await save(description)) setDraft(undefined)
        },
      })
    }

    function RoleDetails({ role, pending, send, open, onClose }) {
      const [personaDraft, setPersonaDraft] = useState(role.persona?.prefix ?? '')
      const closeButton = useRef(null)
      const savedPersona = role.persona?.prefix ?? ''
      const canSave = !pending && personaDraft !== savedPersona
      useEffect(() => setPersonaDraft(savedPersona), [savedPersona])
      useEffect(() => {
        if (open) closeButton.current?.focus()
      }, [open])
      return h('section', {
        className: 'loom-role-drawer', id: 'loom-role-details-' + role.id, hidden: !open, 'aria-label': t('编辑人设', 'Edit persona'),
        onKeyDown: event => { if (event.key === 'Escape') onClose() },
      }, [
          h('div', { key: 'head', className: 'loom-detail-header' }, [
            h('h2', { key: 'h', style: styles.h2 }, role.name),
            h('button', {
              key: 'close', type: 'button', ref: closeButton, className: 'loom-option',
              'aria-label': t('关闭角色详情', 'Close role details'), onClick: onClose,
            }, '×'),
          ]),
          h('label', { key: 'p', htmlFor: 'loom-persona-' + role.id,
            style: { ...styles.sectionTitle, display: 'block', marginTop: 14 } }, t('人设', 'Persona')),
          h('p', { key: 'note', style: { ...styles.muted, margin: '0 0 6px' } }, t('保存后会注入绑定此角色的会话系统提示。', 'Saving adds this persona to the system prompt of sessions bound to this role.')),
          h('textarea', {
            key: 'pt',
            id: 'loom-persona-' + role.id,
            value: personaDraft,
            onChange: event => setPersonaDraft(event.target.value),
            rows: 4,
            placeholder: t('这段文字会作为该角色会话的系统提示首段。', 'Enter the opening section of this role\'s session system prompt.'),
            style: {
              width: '100%', boxSizing: 'border-box', resize: 'vertical',
              font: 'inherit', fontSize: 12, padding: 8, borderRadius: 6,
              color: 'inherit', background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
              border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35))',
            },
          }),
          h('div', { key: 'pb', style: { display: 'flex', justifyContent: 'flex-end', marginTop: 8 } }, [
            h('button', {
              key: 'save',
              type: 'button',
              style: { ...styles.button(canSave), marginLeft: 0 },
              disabled: !canSave,
              onClick: () => void send('fields', { action: 'set_persona', persona: personaDraft }, t('人设已保存', 'Persona saved')),
            }, t('保存人设', 'Save persona')),
          ]),

      ])
    }

    function LibraryDetail({ kind, name, children }) {
      return h('section', {
        className: 'loom-family-detail loom-library-detail', 'aria-label': t(kindName(kind) + '详情', kindName(kind) + ' details'),
      }, [
        h('div', { key: 'head', className: 'loom-detail-header' },
          h('h2', { style: styles.h2 }, name)),
        h('div', { key: name, className: 'loom-library-detail-body' }, children),
      ])
    }

    function SkillDetail({ graph, plan, kind, skills, skillName, apps, appsLoading, loadApps, launchInApp, folderOf }) {
      const [pickerOpen, setPickerOpen] = useState(false)
      const pickerRef = useRef(null)
      useEffect(() => {
        if (!pickerOpen) return undefined
        const onDown = event => {
          if (!pickerRef.current?.contains(event.target)) setPickerOpen(false)
        }
        document.addEventListener('pointerdown', onDown, true)
        return () => document.removeEventListener('pointerdown', onDown, true)
      }, [pickerOpen])
      useEffect(() => setPickerOpen(false), [skillName, graph?.id])

      // Catalog metadata remains useful before a canvas is available. Never
      // interpret a missing/loading graph or plan as an excluded skill.
      const hasGraphContext = !!graph && Array.isArray(graph.edges) && Array.isArray(plan?.members)
      const members = hasGraphContext ? plan.members : []
      const member = members.includes(skillName)
      const info = (skills ?? []).find(skill => skill.name === skillName)
      const outgoing = (hasGraphContext ? graph.edges : []).filter(edge => edge.from === skillName).sort((a, b) => compareName(a.to, b.to))
      const incoming = (hasGraphContext ? graph.edges : []).filter(edge => edge.to === skillName).sort((a, b) => compareName(a.from, b.from))

      const stateLabel = !hasGraphContext ? undefined : (plan.red ?? []).includes(skillName)
        ? t('缺失（红）', 'Missing (red)')
        : (plan.gray ?? []).some(row => row.name === skillName) ? t('受阻（灰）', 'Blocked (gray)') : member ? t('可用', 'Available') : t('未纳入', 'Excluded')

      const children = [
        stateLabel && h('div', { key: 'state', style: styles.muted }, stateLabel),
        h('div', { key: 'source', style: styles.muted }, t('来源：', 'Source: ') + (info?.source?.trim() || t('未知', 'Unknown'))),
        h('div', { key: 'desc', style: { ...styles.muted, marginTop: 6 } }, info?.description?.trim() || t('暂无简介', 'No description')),
      ]
      if (info?.path !== undefined) {
        // One entry, no shortcut: the user always picks the application, so a
        // stray click never launches something they did not choose.
        const dir = folderOf(info.path)
        children.push(h('div', {
          key: 'open', ref: pickerRef, style: { position: 'relative', width: 'fit-content', marginTop: 10 },
          onKeyDown: event => {
            if (event.key !== 'Escape' || !pickerOpen) return
            setPickerOpen(false)
            pickerRef.current?.querySelector('button')?.focus()
          },
        }, [
          h('button', {
            key: 'openwith', type: 'button', 'aria-expanded': pickerOpen,
            style: { ...styles.button(!appsLoading), marginLeft: 0 },
            title: dir,
            disabled: appsLoading,
            onClick: async () => {
              await loadApps()
              setPickerOpen(value => !value)
            },
          }, t('在应用中打开 ', 'Open in app ') + (pickerOpen ? '▴' : '▾')),
          pickerOpen && h('div', {
            key: 'applist', className: 'loom-menu loom-menu--float',
            style: { left: 0, right: 'auto', marginTop: 0 },
          },
            (apps ?? []).length === 0
              ? h('div', { key: 'e', className: 'loom-menu-empty' }, t('没有可用的应用', 'No apps available'))
              : (apps ?? []).map(app => h('button', {
                  key: appKey(app),
                  type: 'button', className: 'loom-menu-item loom-app-menu-item',
                  onClick: () => {
                    setPickerOpen(false)
                    void launchInApp(appKey(app), dir)
                  },
                }, [
                  h(ApplicationMenuIcon, { key: 'icon', id: appKey(app) }),
                  h('span', { key: 'label', className: 'loom-menu-label' }, appLabel(app)),
                ]))),
        ]))
      }
      if (!hasGraphContext) return h(LibraryDetail, { kind: 'skill', name: skillName }, children)

      children.push(h('div', { key: 'member', style: styles.section },
        h('div', { style: styles.empty },
          member ? t('已纳入该' + kindName(kind) + '。', 'Included in this ' + kindName(kind) + '.') : t('尚未纳入。拖到' + kindName(kind) + '节点即可纳入。', 'Drag onto the ' + kindName(kind) + ' node to include it.'))))

      const outgoingRows = outgoing.map((edge, index) => h('div', { key: `o${index}`, style: styles.line }, [
        h('span', { key: 'to', style: styles.mono }, edge.to),
        edge.why ? h('span', { key: 'why', style: styles.muted }, edge.why) : null,
      ]))

      children.push(h('div', { key: 'out', style: styles.section }, [
        h('div', { key: 'title', style: styles.sectionTitle }, t('它依赖', 'Requires') + ' · ' + outgoing.length),
        outgoing.length === 0 ? h('div', { key: 'none', style: styles.empty }, t('没有依赖。', 'No prerequisites.')) : null,
        ...outgoingRows,
      ]))

      const incomingRows = incoming.map((edge, index) => h('div', { key: `i${index}`, style: styles.line }, [
        h('span', { key: 'from', style: styles.mono }, edge.from),
        edge.why ? h('span', { key: 'why', style: styles.muted }, edge.why) : null,
      ]))

      children.push(h('div', { key: 'in', style: styles.section }, [
        h('div', { key: 'title', style: styles.sectionTitle }, t('被依赖', 'Required by') + ' · ' + incoming.length),
        incoming.length === 0 ? h('div', { key: 'none', style: styles.empty }, t('没有其他技能依赖它。', 'No other skills require it.')) : null,
        ...incomingRows,
      ]))

      return h(LibraryDetail, { kind: 'skill', name: skillName }, children)
    }
    // Captured once at apply time: the sidebar service is the only way to hand a
    // file to DSH's own viewer, which is where editing a SKILL.md happens.
    let openInSidebar

    // The host route answers with plain application ids, not records.
    function appKey(app) {
      return typeof app === 'string' ? app : (app?.id ?? app?.app ?? '')
    }

    function appLabel(app) {
      const id = appKey(app)
      const label = Object.hasOwn(APP_LABELS, id) ? APP_LABELS[id] : id
      return app?.name ?? app?.title ?? app?.label ?? (typeof label === 'function' ? label() : label)
    }

    const APP_LABELS = {
      finder: () => t('访达', 'Finder'), explorer: () => t('文件资源管理器', 'File Explorer'), filemanager: () => t('文件管理器', 'File Manager'),
      cursor: 'Cursor', vscode: 'VS Code', vscodeinsiders: 'VS Code Insiders',
      windsurf: 'Windsurf', zed: 'Zed', sublimetext: 'Sublime Text', xcode: 'Xcode',
      androidstudio: 'Android Studio', intellij: 'IntelliJ IDEA', pycharm: 'PyCharm',
      webstorm: 'WebStorm', phpstorm: 'PhpStorm', goland: 'GoLand', rider: 'Rider', rustrover: 'RustRover',
      fork: 'Fork', sourcetree: 'Sourcetree', github: 'GitHub Desktop', tower: 'Tower',
      gitkraken: 'GitKraken', smartgit: 'SmartGit', sublimemerge: 'Sublime Merge',
      ghostty: 'Ghostty', warp: 'Warp', iterm: 'iTerm2', kitty: 'kitty',
      windowsterminal: 'Windows Terminal', gitbash: 'Git Bash', gnometerminal: 'GNOME Terminal', konsole: 'Konsole',
    }

    function ApplicationMenuIcon({ id }) {
      const [failed, setFailed] = useState(false)
      if (id && !failed) return h('img', {
        className: 'loom-app-menu-icon', src: '/open-in-app/icon/' + encodeURIComponent(id),
        alt: '', draggable: false, onError: () => setFailed(true),
      })
      return h('svg', {
        className: 'loom-app-menu-icon', viewBox: '0 0 16 16', 'aria-hidden': true,
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
      }, h('path', { d: 'M4 12L12 4M7 4h5v5' }))
    }

    function skillFileAddress(path) {
      const normalized = path.replace(/\\/g, '/')
      const segments = normalized.split('/').map(segment => encodeURIComponent(segment).replace(/%3A/gi, ':'))
      return 'dsh-resource://file/absolute/' + segments.join('/')
    }

    // The upstream header hides its utilities in the blank hero; the hero slot
    // and the normal header slot use the same control without a second picker.
    function SessionRoleOption({ sessionId, useSession, header = false }) {
      const session = useSession(snapshot => snapshot)
      const unavailable = !session || session.removed || (header && session.openState !== 'open')
      const running = !!(session?.running || session?.pendingSubmissions?.length)
      if (!sessionId) return null
      return h(RoleOption, { key: sessionId, sessionId, header, unavailable, running })
    }

    function HeaderRoleOption(props) {
      return h(SessionRoleOption, { ...props, header: true })
    }

    function RoleOption({ sessionId, header, unavailable, running }) {
      useSyncExternalStore(subscribeLocale, localeSnapshot, localeSnapshot)
      const [roles, setRoles] = useState([])
      const [bound, setBound] = useState(undefined)
      const [open, setOpen] = useState(false)
      const [position, setPosition] = useState(undefined)
      const [loaded, setLoaded] = useState(false)
      const [known, setKnown] = useState(false)
      const [readError, setReadError] = useState(false)
      const [failed, setFailed] = useState(undefined)
      const [writing, setWriting] = useState(false)
      const [announcement, setAnnouncement] = useState('')
      const pending = useRef(false)
      const trigger = useRef(null)
      const panel = useRef(null)
      const request = useRef(null)
      const menuId = useId()
      const blocked = unavailable || running || writing

      const refresh = useCallback(async () => {
        request.current?.abort()
        const controller = new AbortController()
        request.current = controller
        const fetchJson = async url => {
          const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error('HTTP ' + response.status)
          return response.json()
        }
        setLoaded(false)
        setReadError(false)
        setFailed(undefined)
        try {
          const [rolesBody, binding] = await Promise.all([
            fetchJson(API + '/roles'),
            fetchJson(API + '/sessions?session=' + encodeURIComponent(sessionId)),
          ])
          if (controller.signal.aborted) return
          if (!Array.isArray(rolesBody.roles) || !Object.hasOwn(binding, 'roleId')) throw new Error('invalid role response')
          setRoles([...rolesBody.roles].sort(byDisplayName))
          setBound(binding.roleId ?? undefined)
          setLoaded(true)
          setKnown(true)
        } catch {
          if (!controller.signal.aborted) {
            setReadError(true)
            setFailed(t('无法读取此会话的角色，请重试。', 'Could not read the role for this session. Try again.'))
          }
        }
      }, [sessionId])

      useEffect(() => {
        void refresh()
        return () => request.current?.abort()
      }, [refresh])

      const close = useCallback(restoreFocus => {
        setOpen(false)
        setPosition(undefined)
        if (restoreFocus) trigger.current?.focus()
      }, [])

      useEffect(() => {
        if (open && (running || unavailable)) close(false)
      }, [open, running, unavailable, close])

      useLayoutEffect(() => {
        if (!open) return undefined
        const update = () => {
          const rect = trigger.current?.getBoundingClientRect()
          if (!rect) return
          const viewport = window.visualViewport
          const leftEdge = (viewport?.offsetLeft ?? 0) + 8
          const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth) - 16
          const topEdge = (viewport?.offsetTop ?? 0) + 8
          const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 16
          const width = Math.max(0, Math.min(264, rightEdge - leftEdge))
          const left = Math.max(leftEdge, Math.min(rect.right - width, rightEdge - width))
          const above = rect.top - topEdge - 5
          const below = bottomEdge - rect.bottom - 5
          setPosition(above > below && below < 160
            ? { left, width, bottom: window.innerHeight - rect.top + 5, maxHeight: Math.min(240, Math.max(0, above)) }
            : { left, width, top: rect.bottom + 5, maxHeight: Math.min(240, Math.max(0, below)) })
        }
        update()
        window.addEventListener('resize', update)
        window.addEventListener('scroll', update, true)
        window.visualViewport?.addEventListener('resize', update)
        window.visualViewport?.addEventListener('scroll', update)
        return () => {
          window.removeEventListener('resize', update)
          window.removeEventListener('scroll', update, true)
          window.visualViewport?.removeEventListener('resize', update)
          window.visualViewport?.removeEventListener('scroll', update)
        }
      }, [open])

      useEffect(() => {
        if (!open) return undefined
        const onPointer = event => {
          if (!trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) close(false)
        }
        const onEscape = event => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          close(true)
        }
        document.addEventListener('pointerdown', onPointer, true)
        document.addEventListener('keydown', onEscape, true)
        return () => {
          document.removeEventListener('pointerdown', onPointer, true)
          document.removeEventListener('keydown', onEscape, true)
        }
      }, [open, close])

      const choose = async roleId => {
        if (blocked || pending.current || !loaded) return
        if (roleId === bound) { close(true); return }
        pending.current = true
        setWriting(true)
        setFailed(undefined)
        setAnnouncement('')
        try {
          const response = await fetch(API + (roleId === undefined ? '/sessions/unbind' : '/sessions/bind'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(roleId === undefined ? { sessionId } : { sessionId, roleId }),
          })
          if (!response.ok) throw new Error(response.status === 409
            ? t('会话正在运行，完成后再切换角色。', 'Wait for the session to finish before switching roles.')
            : response.status === 404 ? t('此角色已不存在，请重新打开选择器。', 'This role no longer exists. Reopen the role picker.') : t('无法切换角色，请重试。', 'Could not switch roles. Try again.'))
          setBound(roleId)
          if (header) setAnnouncement(t('角色已切换，从下一轮生效，历史消息不变。', 'Role changed. It takes effect on the next turn and leaves previous messages intact.'))
          close(false)
          requestAnimationFrame(() => trigger.current?.focus())
        } catch (cause) {
          setFailed(cause instanceof Error ? cause.message : t('无法切换角色，请重试。', 'Could not switch roles. Try again.'))
        } finally {
          pending.current = false
          setWriting(false)
        }
      }

      const current = roles.find(role => role.id === bound)
      const label = current?.name ?? (bound ? t('角色不可用', 'Role unavailable') : known ? t('默认角色', 'Default role') : t('角色', 'Role'))
      const title = running ? label + t('（会话运行中，暂不可切换）', ' (switching unavailable while the session is running)') : failed ?? label
      const option = (roleId, name, description) => h('button', {
        key: roleId ?? 'default', type: 'button', className: 'loom-menu-item',
        title: name, disabled: blocked, 'aria-pressed': roleId === bound,
        onClick: () => void choose(roleId),
      }, [
        h('span', { key: 'text', className: 'loom-menu-text' }, [
          h('span', { key: 'name', className: 'loom-menu-label' }, name),
          description && h('span', { key: 'desc', className: 'loom-menu-desc' }, description),
        ]),
        roleId === bound ? h('span', { key: 'check', 'aria-hidden': true, className: 'loom-menu-check' }, '✓') : null,
      ])

      return h('span', { className: 'loom-session-role', 'data-loom-role-placement': header ? 'header' : 'hero' }, [
        h('style', { key: 'css' }, MENU_CSS),
        h('button', {
          key: 'trigger', ref: trigger, type: 'button', className: 'loom-option',
          disabled: blocked, title, 'aria-label': t('会话角色：', 'Session role: ') + title,
          'aria-expanded': open, 'aria-controls': open ? menuId : undefined,
          onClick: () => {
            if (open) { close(false); return }
            setOpen(true)
            void refresh()
          },
          onKeyDown: event => {
            if (event.key !== 'Tab' || event.shiftKey || !open) return
            const first = panel.current?.querySelector('button:not(:disabled)')
            if (first) { event.preventDefault(); first.focus() }
          },
        }, [
          h('svg', {
            key: 'icon', viewBox: '0 0 16 16', width: 16, height: 16,
            className: 'loom-option-icon', 'aria-hidden': true,
          }, h('path', { d: 'M8 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm-6 12c0-2.5 2.7-4 6-4s6 1.5 6 4v.5H2V14Z', fill: 'currentColor' })),
          h('span', { key: 'label', className: 'loom-option-label' }, label),
          h('svg', {
            key: 'chevron', viewBox: '0 0 16 16', width: 12, height: 12,
            className: 'loom-option-icon', 'aria-hidden': true,
          }, h('path', { d: 'M4 6l4 4 4-4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })),
        ]),
        header && h('span', { key: 'status', role: 'status', className: 'loom-session-role-status' }, announcement),
        open && position ? createPortal(h('div', {
          id: menuId, ref: panel, className: 'loom-menu loom-session-role-menu', style: position,
          role: 'group', 'aria-label': t('选择会话角色', 'Choose a session role'),
          onBlur: event => {
            if (event.relatedTarget && !panel.current?.contains(event.relatedTarget)
              && event.relatedTarget !== trigger.current) close(false)
          },
          onKeyDown: event => {
            if (event.key === 'Tab' && event.shiftKey && event.target === panel.current?.querySelector('button:not(:disabled)')) {
              event.preventDefault()
              trigger.current?.focus()
            }
          },
        }, [
          failed && h('div', { key: 'error', className: 'loom-session-role-error', role: 'alert' }, failed),
          readError ? h('button', { key: 'retry', type: 'button', className: 'loom-menu-item', onClick: () => void refresh() }, t('重试', 'Retry'))
            : !loaded ? h('div', { key: 'loading', className: 'loom-menu-empty', role: 'status' }, t('加载中…', 'Loading…'))
              : option(undefined, t('默认角色', 'Default role'), t('不收窄技能，注入全部已加载技能', 'Make all loaded skills available')),
          ...(loaded ? roles.map(role => option(role.id, role.name, role.description?.trim())) : []),
          header && loaded && h('div', { key: 'hint', className: 'loom-session-role-hint' }, t('角色从下一轮生效，历史消息不变。', 'Role changes take effect on the next turn and leave previous messages intact.')),
        ]), document.body, 'menu') : null,
      ])
    }

    function TabRolePanel({ useTabInfo }) {
      const info = useTabInfo?.()
      return h(RolePage, { compact: true, review: info?.tab?.navigation?.params })
    }

    const TAB_ID = 'dsh-skill-loom/tab'
    const TAB_KIND = 'skillLoom'

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        localeService = ctx.locale ?? ctx.get?.('locale')
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'skill-loom',
          order: 5,
          label: () => t('技能编排', 'Skill Loom'),
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
        }, SessionRoleOption))
        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'skill-loom-session-role',
          order: 50,
        }, HeaderRoleOption))

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
          title: () => t('技能编排', 'Skill Loom'),
          // Entries on the sidebar's default page, beside "workspace files" and
          // "new terminal": the user opens the tab from there instead of waiting
          // for anything to open it for them.
          guide: [{
            id: 'skill-loom',
            order: 40,
            title: () => t('技能编排', 'Skill Loom'),
            description: () => t('按角色编排技能依赖图', 'Compose skill dependency graphs by role'),
          }],
        }), 'skill-loom: right tab type'))

        whenAvailable('sidebarRightTabs', () => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
        }, TabRolePanel)))

        whenAvailable('sidebarRight', service => {
          openInSidebar = service.openResource?.bind(service)
          if (typeof service.openTab !== 'function' || !service.mounted?.getSnapshot) return
          ctx.effect(() => {
            let active = true
            let inFlight = false
            const seen = new Map()
            const checkReview = async () => {
              const session = service.mounted.getSnapshot()
              if (!session || inFlight) return
              inFlight = true
              try {
                const response = await fetch(API + '/sessions/review?session=' + encodeURIComponent(session), { cache: 'no-store' })
                if (!response.ok || !active) return
                const { request } = await response.json()
                if (!request || service.mounted.getSnapshot() !== session || seen.get(session) === request.ticket) return
                service.openTab(TAB_KIND, { params: request })
                seen.set(session, request.ticket)
              } catch {
                // A session or its sidebar may have closed before the request arrived.
              } finally {
                inFlight = false
              }
            }
            const timer = setInterval(checkReview, 1600)
            void checkReview()
            return () => {
              active = false
              clearInterval(timer)
            }
          }, 'skill-loom: open requested review in the current session')

        })
      },
    }
  },
})

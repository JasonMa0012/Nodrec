import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Crop, GripVertical, LockKeyhole, Ellipsis, X, ChevronDown } from 'lucide-react'
import { ControlButton, RuntimeDisplay } from './WorkflowControls'
import { dockRegion, expandToolbar, editRegionField, handles, handlePoint, hitRegion, selectionRect, transformRegion, type Rect, type Handle } from './region-geometry'
import type { RegisteredControl, RegisteredDisplay } from './model'

type Tool = { token: string; toolId: string; blueprintId: string; display: { id: string; x: number; y: number; width: number; height: number }; rect: Rect | null; work: Rect; scale: number; picking: boolean; visible: boolean; excluded: boolean; captureExclusion: boolean; aspectRatio: number }
type Runtime = { status: string; controls: RegisteredControl[]; displays: RegisteredDisplay[]; recording: { durationMs: number } | null; error: string | null }
type ToolState = { tool: Tool | null; runtime: Runtime }

export default function RegionTool({ role, token }: { role: string; token: string }) {
  const [state, setState] = useState<ToolState | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ratioLocked, setRatioLocked] = useState(false)
  const [hover, setHover] = useState<Handle | null>(null)
  const [menu, setMenu] = useState<'size' | 'more' | null>(null)
  const [toolbarOffset, setToolbarOffset] = useState(0)
  const surface = useRef<HTMLDivElement>(null)
  const drag = useRef<{ start: { x: number; y: number }; rect: Rect; handle: Handle; picking: boolean } | null>(null)
  const queued = useRef<Rect | null>(null)
  const sending = useRef(false)
  const tool = state?.tool
  const locked = !!state && ['starting', 'recording', 'paused', 'stopping'].includes(state.runtime.status)
  const act = async (action: string, value?: Rect) => {
    try { await invoke('region_tool_action', { token, action, rect: value ?? null }); setError(null) }
    catch (e) { setError(String(e)) }
  }
  const sendChange = async (value: Rect) => {
    queued.current = value
    if (sending.current) return
    sending.current = true
    while (queued.current) { const next = queued.current; queued.current = null; await act('change', next) }
    sending.current = false
  }
  useEffect(() => {
    document.title = `Nodrec Region ${role}`
    document.documentElement.classList.add('region-surface')
    let disposed = false
    const stops: (() => void)[] = []
    const apply = (next: ToolState) => {
      if (disposed || next.tool?.token !== token) return
      setState(next)
      if (!drag.current && !sending.current) setRect(next.tool.rect)
    }
    void Promise.all([
      listen<Tool>('region-tool', event => { if (event.payload.token === token) { setState(current => current ? { ...current, tool: event.payload } : current); if (!drag.current && !sending.current) setRect(event.payload.rect) } }),
      listen<Runtime>('workflow-status', event => setState(current => current ? { ...current, runtime: event.payload } : current)),
    ]).then(async listeners => {
      if (disposed) { listeners.forEach(stop => stop()); return }
      stops.push(...listeners)
      try { apply(await invoke<ToolState>('region_tool_state')) } catch (e) { setError(String(e)) }
    })
    const poll = window.setInterval(() => { void invoke<ToolState>('region_tool_state').then(apply).catch(e => setError(String(e))) }, 1000)
    return () => { disposed = true; stops.forEach(stop => stop()); window.clearInterval(poll); document.documentElement.classList.remove('region-surface') }
  }, [token, role])

  useEffect(() => {
    if (tool?.token === token) void invoke('region_tool_action', { token, action: 'ready', rect: null }).catch(e => setError(String(e)))
  }, [tool?.token, token])
  useEffect(() => {
    if (role === 'frame' && tool?.picking) document.querySelector<HTMLElement>('.region-frame')?.focus()
  }, [role, tool?.picking])

  useEffect(() => {
    if (!menu) return
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!(event.target as HTMLElement).closest('.region-popup, [aria-label="More region actions"], [aria-label="Region size"]')) setMenu(null)
    }
    const blur = () => setMenu(null)
    document.addEventListener('pointerdown', dismiss)
    window.addEventListener('blur', blur)
    return () => { document.removeEventListener('pointerdown', dismiss); window.removeEventListener('blur', blur) }
  }, [menu])

  const targets = `region:${tool?.toolId ?? ''}`
  const items = state ? [...state.runtime.controls.filter(c => c.targets?.includes(targets)), ...state.runtime.displays.filter(c => c.targets?.includes(targets))].sort((a, b) => a.order - b.order) : []
  const toolbarWidth = tool ? Math.min(Math.max(760, 250 + items.reduce((total, item) => total + ('source' in item ? 100 : Math.max(70, item.label.length * 8 + 50)), 0)), tool.work.width / tool.scale - 16) : 600
  useLayoutEffect(() => {
    if (role !== 'toolbar' || !tool || !rect) return
    const width = Math.round(toolbarWidth * tool.scale)
    const height = Math.round(Math.min(410, tool.work.height / tool.scale - 16) * tool.scale)
    const preferred = rect.y - tool.work.y >= tool.work.y + tool.work.height - rect.y - rect.height ? 0 : 1
    const dock = dockRegion(rect, tool.work, width, 56 * tool.scale, 8 * tool.scale, preferred)
    const expanded = expandToolbar(dock, tool.work, 56 * tool.scale, height, 4 * tool.scale)
    setToolbarOffset(expanded.offset / tool.scale)
    void invoke('region_tool_layout', { token, x: Math.round(dock.x), y: Math.round(expanded.y), width, height: Math.round(expanded.height) }).catch(e => setError(String(e)))
  }, [role, tool, rect, toolbarWidth, token])

  const shapeScale = tool?.scale
  useLayoutEffect(() => {
    if (role !== 'toolbar' || !surface.current || !shapeScale) return
    let frame = 0
    let previous = ''
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const areas = Array.from(surface.current!.querySelectorAll<HTMLElement>('.region-toolbar, .region-popup, .control-menu[open] > .control-menu-popover, .control-submenu[open] > .control-submenu-popover, .region-error')).filter(el => el.getClientRects().length).map(el => {
          const r = el.getBoundingClientRect()
          const x = Math.max(0, r.x), y = Math.max(0, r.y)
          return { x: Math.floor(x * shapeScale), y: Math.floor(y * shapeScale), width: Math.max(0, Math.ceil((Math.min(innerWidth, r.right) - x) * shapeScale)), height: Math.max(0, Math.ceil((Math.min(innerHeight, r.bottom) - y) * shapeScale)) }
        })
        const signature = JSON.stringify(areas)
        if (signature === previous) return
        previous = signature
        void invoke('region_tool_shape', { token, areas }).catch(e => { previous = ''; setError(String(e)) })
      })
    }
    const observer = new MutationObserver(update)
    observer.observe(surface.current, { subtree: true, attributes: true, childList: true })
    window.addEventListener('resize', update); update()
    return () => { observer.disconnect(); window.removeEventListener('resize', update); cancelAnimationFrame(frame) }
  }, [role, shapeScale, token, toolbarOffset])

  if (!tool || tool.token !== token || !state) return null
  const scale = tool.scale
  const bounds = { x: 0, y: 0, width: tool.display.width, height: tool.display.height }
  const point = (event: PointerEvent) => role === 'frame'
    ? { x: Math.round(event.clientX * scale), y: Math.round(event.clientY * scale) }
    : { x: Math.round(event.screenX * scale), y: Math.round(event.screenY * scale) }
  const start = (event: PointerEvent, handle?: Handle) => {
    if (locked || event.button !== 0) return
    const p = point(event)
    const picking = role === 'frame' && tool.picking
    const hit = handle ?? (rect ? hitRegion(rect, p.x, p.y, scale) : null)
    if (!picking && (!rect || !hit)) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { start: p, rect: rect ?? { ...p, width: 16, height: 16 }, handle: hit ?? 'se', picking }
    if (picking) setRect({ ...p, width: 0, height: 0 })
  }
  const move = (event: PointerEvent) => {
    const p = point(event)
    const d = drag.current
    if (!d) { if (role === 'frame' && rect) setHover(hitRegion(rect, p.x, p.y, scale)); return }
    const next = d.picking ? selectionRect(d.start, p, bounds)
      : transformRegion(d.rect, d.handle, p.x-d.start.x, p.y-d.start.y, bounds, event.shiftKey ? d.rect.width/d.rect.height : tool.aspectRatio)
    setRect(next)
    if (!d.picking) void sendChange(next)
  }
  const finish = (event: PointerEvent) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (d.picking) {
      if (rect && rect.width >= 16 && rect.height >= 16) void act('select', rect)
      else { setRect(tool.rect); setError('Select at least 16 × 16 physical pixels') }
    }
  }
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { setMenu(null); document.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(item => { item.open = false }); if (tool.picking) void act('cancel'); return }
    if ((event.target as HTMLElement).closest('input,select')) return
    if (locked || !rect || !event.key.startsWith('Arrow')) return
    event.preventDefault()
    const step = event.shiftKey ? 10 : 1
    const next = transformRegion(rect, 'move', event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0, bounds)
    setRect(next); void sendChange(next)
  }
  if (role === 'frame') return <div className={`region-frame ${tool.picking ? 'picking' : ''}`} tabIndex={0} role="application" aria-label="Screen region: drag border to move, drag round handles to resize" style={{ cursor: tool.picking ? 'crosshair' : locked ? 'default' : hover === 'move' ? 'move' : hover ? `${hover}-resize` : 'default' }} onKeyDown={key} onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { drag.current = null; setRect(tool.rect) }}>
    {tool.picking && <div className="region-pick-hint">Drag to select a region · Esc to cancel{error && <p role="alert">{error}</p>}</div>}
    {rect && <div className={`region-outline${locked ? ' locked' : ''}`} style={{ left:rect.x/scale, top:rect.y/scale, width:rect.width/scale, height:rect.height/scale }} />}
    {rect && !locked && !tool.picking && handles.map(h => { const p = handlePoint(rect, h); return <span key={h} className="region-handle" style={{ left:p.x/scale, top:p.y/scale }} /> })}
  </div>
  const renderItem = (item: RegisteredControl | RegisteredDisplay) => 'source' in item
    ? <RuntimeDisplay key={item.id} display={item} status={state.runtime.status} durationMs={state.runtime.recording?.durationMs ?? 0} />
    : <ControlButton key={item.id} control={item} dispatch={eventId => { setMenu(null); void invoke('region_tool_dispatch', { token, controlId: item.id, eventId }).catch(e => setError(String(e))) }} disabled={false} />
  return <div ref={surface} className={`region-toolbar-window${toolbarOffset ? ' popups-up' : ''}`} style={{ paddingTop: toolbarOffset + 4 }} onKeyDown={key}>
    <div className="region-toolbar" aria-label="Region toolbar">
      <button className="icon-button region-grip" aria-label="Move region" disabled={locked} onPointerDown={event => start(event, 'move')} onPointerMove={move} onPointerUp={finish}><GripVertical size={16} /></button>
      <button className="icon-button" aria-label="Select region again" disabled={locked} onClick={() => { setMenu(null); void act('reselect') }}><Crop size={17} /></button>
      <button className="region-size" aria-label="Region size" disabled={locked} onClick={() => setMenu(menu === 'size' ? null : 'size')}>{rect?.width} × {rect?.height}<ChevronDown size={13} /></button>
      <div className="region-custom">{items.map(renderItem)}</div>
      <button className="icon-button" aria-expanded={menu === 'more'} aria-label="More region actions" onClick={() => setMenu(menu === 'more' ? null : 'more')}><Ellipsis size={18} /></button>
      <button className="icon-button" aria-label="Close region tool" onClick={() => void act('close')}><X size={17} /></button>
    </div>
    {menu === 'size' && rect && <div className="region-popup">
      <RegionFields key={`${rect.x}:${rect.y}:${rect.width}:${rect.height}`} rect={rect} bounds={bounds} locked={locked} ratioLocked={ratioLocked} setRatioLocked={setRatioLocked} initialRatio={tool.aspectRatio} syncRatio={ratio => { void invoke('region_tool_ratio', { token, ratio }).catch(e => setError(String(e))) }} apply={next => { setRect(next); void sendChange(next) }} />
    </div>}
    {menu === 'more' && <div className="region-popup region-settings"><label className="region-capture-toggle">Exclude from capture<span className="field-control checkbox-control compact"><input type="checkbox" role="switch" aria-label="Exclude from capture" checked={tool.captureExclusion} onChange={event => void act(event.target.checked ? 'exclude-capture' : 'allow-capture')} /><span className="toggle-track"><i /></span></span></label></div>}
    {(error || state.runtime.error) && <div className="region-error" role="alert">{error || state.runtime.error}</div>}
  </div>
}

function RegionFields({ rect, bounds, locked, ratioLocked, setRatioLocked, initialRatio, syncRatio, apply }: { initialRatio: number; syncRatio: (ratio: number) => void; rect: Rect; bounds: Rect; locked: boolean; ratioLocked: boolean; setRatioLocked: (value: boolean) => void; apply: (rect: Rect) => void }) {
  const [unit, setUnit] = useState('px')
  const [draft, setDraft] = useState(rect)
  const [ratio, setRatio] = useState(initialRatio ? [initialRatio, 1] : [rect.width, rect.height])
  const [error, setError] = useState('')
  const fields: [string, string, number][] = [['centerX', 'Center X', draft.x + draft.width / 2], ['centerY', 'Center Y', draft.y + draft.height / 2], ['width', 'Width', draft.width], ['height', 'Height', draft.height], ['minX', 'Min X', draft.x], ['minY', 'Min Y', draft.y], ['maxX', 'Max X', draft.x + draft.width], ['maxY', 'Max Y', draft.y + draft.height]]
  return <form className="region-fields" onSubmit={event => {
    event.preventDefault()
    if (Object.values(draft).some(v => !Number.isFinite(v)) || draft.x < 0 || draft.y < 0 || draft.width < 16 || draft.height < 16 || draft.x + draft.width > bounds.width || draft.y + draft.height > bounds.height) { setError('Region must fit the display and be at least 16 × 16 pixels'); return }
    setError(''); apply(draft)
  }}>
    <label>Units<select aria-label="Region units" value={unit} onChange={event => setUnit(event.target.value)}><option value="px">Pixels</option><option value="%">Display %</option></select></label>
    <div className="region-field-grid">{fields.map(([field, label, value]) => {
      const extent = field.endsWith('Y') || field === 'height' ? bounds.height : bounds.width
      return <label key={field}>{label}<input aria-label={`Region ${label.toLowerCase()}`} type="number" step="any" required disabled={locked} value={Number.isFinite(value) ? Number((unit === '%' ? value / extent * 100 : value).toFixed(4)) : ''} onChange={event => setDraft(editRegionField(draft, bounds, field, event.target.valueAsNumber, unit, ratioLocked ? ratio[0]! / ratio[1]! : 0))} /></label>
    })}</div>
    <div className="region-ratio"><button type="button" className="button secondary" aria-pressed={ratioLocked} disabled={locked} onClick={() => { setRatioLocked(!ratioLocked); syncRatio(ratioLocked ? 0 : ratio[0]! / ratio[1]!) }}><LockKeyhole size={14} />Lock aspect ratio</button>{ratio.map((v, i) => <input key={i} aria-label={`Aspect ratio ${i === 0 ? 'width' : 'height'}`} type="number" min="0.0001" step="any" required value={Number.isFinite(v) ? v : ''} disabled={locked} onChange={event => {
      const next = [...ratio]; next[i] = event.target.valueAsNumber; setRatio(next)
      if (next.every(n => Number.isFinite(n) && n > 0)) { setDraft(current => ({ ...current, height: Math.round(current.width * next[1]! / next[0]!) })); if (ratioLocked) syncRatio(next[0]! / next[1]!) }
    }} />)}</div>
    <button className="button secondary" type="submit" disabled={locked}>Apply</button>{error && <span role="alert">{error}</span>}
  </form>
}

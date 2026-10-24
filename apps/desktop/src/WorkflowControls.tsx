import { useRef } from 'react'
import { Crop, Monitor, MousePointer2, Play, Pause, Square, StopCircle, Settings, Video, Folder, AudioLines, Clock3, CircleHelp, ChevronDown, ChevronRight } from 'lucide-react'
import type { ControlMenuItem, RegisteredControl, RegisteredDisplay } from './model'
import { elapsedText } from './region-geometry'

const controlIcons = { crop: Crop, monitor: Monitor, 'mouse-pointer-2': MousePointer2, play: Play, pause: Pause, square: Square, 'stop-circle': StopCircle, settings: Settings, video: Video, folder: Folder, 'audio-lines': AudioLines, 'clock-3': Clock3, 'circle-help': CircleHelp }
function ControlIcon({ name, size = 14 }: { name: string; size?: number }) {
  const Icon = controlIcons[name as keyof typeof controlIcons] ?? CircleHelp
  return <Icon size={size} />
}

function closeNestedMenus(menu: HTMLDetailsElement) {
  menu.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((submenu) => { submenu.open = false })
}

function ControlMenuItems({ items, dispatch, closeRoot, disabled = false, depth = 0 }: { items: ControlMenuItem[]; dispatch: (eventId: string) => void; closeRoot: () => void; disabled?: boolean; depth?: number }) {
  return <>{items.map((item) => <div className="control-menu-row" key={item.id} onMouseEnter={(event) => {
    const submenu = event.currentTarget.querySelector<HTMLDetailsElement>(':scope > .control-submenu')
    event.currentTarget.parentElement?.querySelectorAll<HTMLDetailsElement>(':scope > .control-menu-row > .control-submenu[open]').forEach((other) => { if (other !== submenu) other.open = false })
    if (submenu) submenu.open = true
  }}>
    <button disabled={disabled} onClick={() => { closeRoot(); dispatch(item.eventId) }}><ControlIcon name={item.icon} size={13} /><span>{item.label}</span></button>
    {item.children?.length ? <details className="control-submenu" name={`control-submenu-${depth}`}><summary aria-label={`Open ${item.label} submenu`} title={`Open ${item.label} submenu`} onClick={(event) => { event.preventDefault(); event.currentTarget.parentElement?.setAttribute('open', '') }}><ChevronRight size={13} /></summary><div className="control-submenu-popover"><ControlMenuItems items={item.children} dispatch={dispatch} closeRoot={closeRoot} disabled={disabled} depth={depth + 1} /></div></details> : null}
  </div>)}</>
}

export function ControlButton({ control, primary, dispatch, disabled }: { control: RegisteredControl; primary?: boolean; dispatch: (eventId: string) => void; disabled: boolean }) {
  const menuRef = useRef<HTMLDetailsElement>(null)
  const locked = disabled || !control.enabled
  const closeRoot = () => {
    if (!menuRef.current) return
    menuRef.current.open = false
    closeNestedMenus(menuRef.current)
  }
  return <div className="split-control">
    <button className={`button ${primary ? 'primary' : 'secondary'}${primary ? ' recording-primary' : ''}`} disabled={locked} onClick={() => dispatch(control.eventId)}><ControlIcon name={control.icon} /><span>{control.label}</span></button>
    {control.menu.length > 0 && <details className="control-menu" name="global-dropdown-menu" ref={menuRef} onToggle={(event) => { if (!event.currentTarget.open) closeNestedMenus(event.currentTarget) }}>
      <summary className={`button ${primary ? 'primary' : 'secondary'} control-menu-toggle`} aria-label={`Open ${control.label} menu`} title={`Open ${control.label} menu`}><ChevronDown size={13} /></summary>
      <div className="control-menu-popover"><ControlMenuItems items={control.menu} dispatch={dispatch} disabled={locked} closeRoot={closeRoot} /></div>
    </details>}
  </div>
}

export function RuntimeDisplay({ display, status, durationMs }: { display: RegisteredDisplay; status: string; durationMs: number }) {
  return <span className={`registered-display ${display.source === 'status' ? status : ''}`} aria-label={display.source === 'status' ? 'Workflow status' : 'Recording time'}>{display.source === 'elapsed' ? elapsedText(durationMs) : <><i />{status.charAt(0).toUpperCase() + status.slice(1)}</>}</span>
}


import { invoke } from '@tauri-apps/api/core'
import { useState } from 'react'
import { Crop, Monitor, MousePointer2, Play, Pause, Square, StopCircle, Settings, Video, Folder, AudioLines, Clock3, CircleHelp } from 'lucide-react'
import type { RegisteredControl, RegisteredDisplay } from './model'
import { elapsedText } from './region-geometry'

const controlIcons = { crop: Crop, monitor: Monitor, 'mouse-pointer-2': MousePointer2, play: Play, pause: Pause, square: Square, 'stop-circle': StopCircle, settings: Settings, video: Video, folder: Folder, 'audio-lines': AudioLines, 'clock-3': Clock3, 'circle-help': CircleHelp }
function ControlIcon({ name, size = 14 }: { name: string; size?: number }) {
  const Icon = controlIcons[name as keyof typeof controlIcons] ?? CircleHelp
  return <Icon size={size} />
}

export function ControlButton({ control, disabled, status = 'ready', durationMs = 0, token }: { control: RegisteredControl; disabled: boolean; status?: string; durationMs?: number; token?: string }) {
  const [error,setError] = useState<string | null>(null)
  const send = (action: string) => {
    const binding = control.binding
    if (!binding) return
    setError(null)
    void invoke(token ? 'region_tool_node_action' : 'dispatch_node_action', token ? {token,controlId:control.id,action} : {graphId:binding.graphId,nodeId:binding.nodeId,action}).catch(error => setError(String(error)))
  }
  const locked = disabled || !control.enabled
  if (control.binding?.action === 'select') return <div><button className="button secondary" disabled={locked || !['ready','failed'].includes(status)} onClick={() => send('select')}><ControlIcon name={control.icon} />{control.label}</button>{(control.error || error) && <span role="alert">{control.error || error}</span>}</div>
  if (control.binding?.action === 'record') return <div><div className="split-control">{status === 'ready' || status === 'failed'
    ? <button className="button primary" disabled={locked} onClick={() => send('start')}><ControlIcon name={control.icon} />{control.label}</button>
    : status === 'starting' ? <><span role="status">Preparing…</span><button className="button secondary" disabled={locked} onClick={() => send('stop')}>Cancel</button></>
    : status === 'stopping' ? <span role="status">Saving…</span>
    : <><button className="button secondary" disabled={locked} onClick={() => send(status === 'paused' ? 'resume' : 'pause')}>{status === 'paused' ? 'Resume' : 'Pause'}</button><button className="button secondary" disabled={locked} onClick={() => send('stop')}>Stop</button><span aria-label="Recording time">{elapsedText(durationMs)}</span></>}</div>{(control.error || error) && <span role="alert">{control.error || error}</span>}</div>
  return <span role="alert">Invalid node action binding</span>
}

export function RuntimeDisplay({ display, status, durationMs }: { display: RegisteredDisplay; status: string; durationMs: number }) {
  return <span className={`registered-display ${display.source === 'status' ? status : ''}`} aria-label={display.source === 'status' ? 'Workflow status' : 'Recording time'}>{display.source === 'elapsed' ? elapsedText(durationMs) : <><i />{status.charAt(0).toUpperCase() + status.slice(1)}</>}</span>
}


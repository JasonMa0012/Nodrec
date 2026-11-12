import { useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { Folder, FolderOpen } from 'lucide-react'

export function Toggle({ label, checked, disabled = false, onChange }: {
  label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void
}) {
  return <span className="checkbox-control">
    <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    <span className="toggle-track" aria-hidden="true"><i /></span>
  </span>
}

export function FolderActions({ label, value, onChange }: {
  label: string; value: string; onChange?: (value: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(pick: boolean) {
    setBusy(true)
    setError('')
    try {
      if (pick) {
        const path = await open({ directory: true, multiple: false, defaultPath: value || undefined, title: `Select ${label}` })
        if (path !== null) onChange?.(path)
      } else {
        await invoke('open_folder', { path: value })
      }
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }
  return <>
    {onChange && <button type="button" className="parameter-browse" aria-label={`Browse ${label}`} title="Choose folder" disabled={busy || !isTauri()} onClick={() => void run(true)}><Folder size={14} /></button>}
    <button type="button" className="parameter-browse" aria-label={`Open ${label} in File Explorer`} title="Open in File Explorer" disabled={busy || !isTauri() || !value.trim()} onClick={() => void run(false)}><FolderOpen size={14} /></button>
    {error && <span className="parameter-picker-error" role="alert">{error}</span>}
  </>
}

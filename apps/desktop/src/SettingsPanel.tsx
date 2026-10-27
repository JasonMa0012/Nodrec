import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { listen } from '@tauri-apps/api/event'
import { Download, ExternalLink, Globe, Info, Settings } from 'lucide-react'

type Preferences = { checkOnStartup: boolean; proxyMode: 'direct' | 'system' | 'custom'; proxyUrl: string }
type UpdateInfo = { currentVersion: string; version: string | null; notes: string | null; mainland: boolean | null; route: string }
type Progress = { downloaded: number; total: number | null; route: string }
const defaults: Preferences = { checkOnStartup: true, proxyMode: 'system', proxyUrl: 'http://127.0.0.1:7890' }
const sections = [{ id: 'general', label: 'General', icon: Settings }, { id: 'network', label: 'Network', icon: Globe }, { id: 'about', label: 'About', icon: Info }]

export default function SettingsPanel({ visible, locked, onUpdate, onAvailable }: {
  visible: boolean; locked: boolean; onUpdate: () => Promise<void>; onAvailable: (version: string) => void
}) {
  const [section, setSection] = useState('general')
  const [preferences, setPreferences] = useState(defaults)
  const [saved, setSaved] = useState(defaults)
  const [version, setVersion] = useState('')
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [message, setMessage] = useState('')
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const dirty = JSON.stringify(preferences) !== JSON.stringify(saved)

  useEffect(() => {
    let cancelled = false
    if (!('__TAURI_INTERNALS__' in window)) return
    void Promise.all([invoke<Preferences>('get_settings'), getVersion()]).then(async ([settings, localVersion]) => {
      if (cancelled) return
      setPreferences(settings); setSaved(settings); setVersion(localVersion); setReady(true)
      if (!settings.checkOnStartup) return
      setBusy(true); setMessage('Checking for updates…')
      try {
        const result = await invoke<UpdateInfo>('check_update')
        if (cancelled) return
        setUpdate(result)
        setMessage(result.version ? `Nodrec ${result.version} is available.` : 'You are up to date.')
        if (result.version) onAvailable(result.version)
      } catch (error) { if (!cancelled) setMessage(String(error)) }
      finally { if (!cancelled) setBusy(false) }
    }).catch(error => { if (!cancelled) setMessage(String(error)) })
    return () => { cancelled = true }
  }, [onAvailable])

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    const subscription = listen<Progress>('update-progress', event => setProgress(event.payload))
    return () => { void subscription.then(unlisten => unlisten()) }
  }, [])

  async function save() {
    setBusy(true); setMessage('')
    try {
      await invoke('save_settings', { settings: preferences })
      setSaved(preferences); setUpdate(null); setMessage('Settings saved.')
    } catch (error) { setMessage(String(error)) }
    finally { setBusy(false) }
  }
  async function check() {
    setBusy(true); setMessage('Checking for updates…'); setProgress(null); setUpdate(null)
    try {
      const result = await invoke<UpdateInfo>('check_update')
      setUpdate(result); setMessage(result.version ? `Nodrec ${result.version} is available.` : 'You are up to date.')
    } catch (error) { setMessage(String(error)) }
    finally { setBusy(false) }
  }
  async function install() {
    setBusy(true); setInstalling(true); setProgress(null); setMessage('Saving changes and downloading update…')
    try { await onUpdate() }
    catch (error) { setMessage(String(error)) }
    finally { setBusy(false); setInstalling(false) }
  }
  return <><main className="app-settings" hidden={!visible}>
    <nav className="settings-navigation" aria-label="Settings pages">
      <h1>Settings</h1>
      {sections.map(({ id, label, icon: Icon }) => <button key={id} className={section === id ? 'active' : ''} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}><Icon size={16} />{label}</button>)}
    </nav>
    <section className="settings-content">
      {section === 'general' && <><h2>General</h2><label className="settings-option"><span>Check for updates on startup</span><input type="checkbox" checked={preferences.checkOnStartup} disabled={!ready || busy} onChange={event => setPreferences({ ...preferences, checkOnStartup: event.target.checked })} /></label><p>Notify when a new version is available. Install when you are ready.</p></>}
      {section === 'network' && <><h2>Network</h2><label className="settings-option"><span>Proxy</span><select value={preferences.proxyMode} disabled={!ready || busy} onChange={event => setPreferences({ ...preferences, proxyMode: event.target.value as Preferences['proxyMode'] })}><option value="direct">Direct connection</option><option value="system">System proxy (default)</option><option value="custom">Custom</option></select></label>
        {preferences.proxyMode === 'custom' && <label className="settings-proxy">Proxy URL<input value={preferences.proxyUrl} disabled={busy} placeholder="http://127.0.0.1:7890" onChange={event => setPreferences({ ...preferences, proxyUrl: event.target.value })} /><small>HTTP, HTTPS or SOCKS5 · include the host/IP and port.</small></label>}
        <p>Applies to update checks and downloads. Mainland China connections use GitHub acceleration with automatic fallback.</p></>}
      {section === 'about' && <><div className="settings-about"><span className="brand-mark"><span>N</span></span><div><h2>Nodrec</h2><span>Version {version || '—'}</span></div></div><button className="button" onClick={() => { void invoke('open_project').catch(error => setMessage(String(error))) }}><ExternalLink size={14} />GitHub · JasonMa0012/Nodrec</button>
        <div className="settings-updates"><h3>Updates</h3><button className="button" disabled={!ready || busy || dirty} onClick={() => { void check() }}>Check for updates</button>
          {update?.version && <><h3>Nodrec {update.version}</h3>{update.notes && <p className="release-notes">{update.notes}</p>}<button className="button primary" disabled={busy || locked || dirty} onClick={() => { void install() }}><Download size={14} />Update and restart</button><p>All blueprint changes are saved before downloading. Built-in blueprints are replaced by the update; duplicate them to keep customizations.</p></>}
          {locked && <p>Stop recording and wait for saves to finish before updating.</p>}
          {update && <small>IP region: {update.mainland === null ? 'unavailable' : update.mainland ? 'Mainland China' : 'outside Mainland China'} · {update.route}</small>}
          {progress && <><progress value={progress.downloaded} max={progress.total || undefined} /><small>{(progress.downloaded / 1048576).toFixed(1)} MB{progress.total ? ` / ${(progress.total / 1048576).toFixed(1)} MB` : ''} · {progress.route}</small></>}
        </div></>}
      {dirty && <div className="settings-save"><button className="button primary" disabled={busy} onClick={() => { void save() }}>Save settings</button><span>Save settings before checking for updates.</span></div>}
      {message && <p className="settings-message" role="status">{message}</p>}
    </section>
  </main>{installing && createPortal(<div className="update-overlay" role="dialog" aria-modal="true" aria-label="Updating Nodrec"><div><Download size={24} /><h2>Updating Nodrec</h2><p>Saving changes, downloading and verifying the update.<br />Nodrec will restart automatically.</p>{progress && <><progress value={progress.downloaded} max={progress.total || undefined} /><p>{(progress.downloaded / 1048576).toFixed(1)} MB{progress.total ? ` / ${(progress.total / 1048576).toFixed(1)} MB` : ''} · {progress.route}</p></>}</div></div>, document.body)}</>
}

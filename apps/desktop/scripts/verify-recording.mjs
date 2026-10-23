import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, copyFile, readFile, writeFile, stat } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = path.join(desktop, 'src-tauri/target', `recording-check-${Date.now()}`)
await mkdir(path.join(fixture, 'blueprints/builtin'), { recursive: true })
await copyFile(path.join(desktop, 'src-tauri/target/release/nodrec-desktop.exe'), path.join(fixture, 'nodrec-desktop.exe'))
const document = JSON.parse(await readFile(path.join(desktop, 'blueprints/builtin/screen-recording.nodrec.json'), 'utf8'))
Object.assign(document.values, { regionMode: 'Rectangle', x: 100, y: 100, width: 897, height: 360, output: path.join(fixture, 'recordings'), filename: 'region_{timestamp}.mp4' })
await writeFile(path.join(fixture, 'blueprints/builtin/screen-recording.nodrec.json'), JSON.stringify(document))
const port = 9351
try {
  await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) })
  throw Error(`Refusing to use occupied WebView debugging port ${port}`)
} catch (error) { if (error.message.startsWith('Refusing')) throw error }
const app = spawn(path.join(fixture, 'nodrec-desktop.exe'), [], { windowsHide: true, stdio: 'ignore', env: {
  ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(fixture, 'webview'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
} })
const until = async (probe, label, timeout = 20000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { const value = await probe(); if (value) return value; await delay(100) }
  throw Error(`Timed out: ${label}`)
}
let socket
try {
  const target = await until(async () => {
    try { return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page' && /^(http:\/\/tauri\.localhost|tauri:\/\/localhost)/.test(t.url)) } catch { return null }
  }, 'local Nodrec WebView')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
  const pending = new Map(); let id = 0
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data); const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(Error(message.error.message)); else request.resolve(message.result)
  })
  const command = (method, params) => new Promise((resolve, reject) => {
    const key = ++id
    const timer = setTimeout(() => { pending.delete(key); reject(Error(`CDP timeout: ${method}`)) }, 30000)
    pending.set(key, { resolve: result => { clearTimeout(timer); resolve(result) }, reject: error => { clearTimeout(timer); reject(error) } })
    socket.send(JSON.stringify({ id: key, method, params }))
  })
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const invoke = (name, args = {}) => evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)}, ${JSON.stringify(args)})`)
  const snapshot = () => invoke('runtime_snapshot')
  await until(async () => evaluate(`!!document.querySelector('[aria-label="Width (physical px)"]')`), 'region inputs')
  await until(async () => evaluate(`!![...document.querySelectorAll('.split-control > button')].find(button=>button.textContent.trim()==='Start recording'&&!button.disabled)`), 'initial control activation')
  const displayList = await invoke('list_displays')
  assert.ok(displayList.length > 0)
  document.values.display = displayList[0].id
  await invoke('activate_blueprint', { document })
  assert.equal(await evaluate(`document.querySelector('[aria-label="Width (physical px)"]').value`), '897')
  // Changing color and counter verifies moving pixels without an external game.
  await evaluate(`(() => { const marker = document.createElement('div'); marker.id='recording-marker'; Object.assign(marker.style,{position:'fixed',left:'0',top:'0',width:'100px',height:'100px',zIndex:'99999',background:'red'}); document.body.append(marker); window.recordingMarkerTimer=setInterval(()=>{marker.style.background=marker.style.background==='red'?'blue':'red'},100) })()`)
  await invoke('dispatch_blueprint_event', { eventId: 'event-start' })
  const started = await until(async () => { const s = await snapshot(); if (s.status === 'failed') throw Error(s.error); return s.status === 'recording' && s.frameCount > 0 ? s : null }, 'real recording')
  assert.equal(started.recording.width, 898); assert.equal(started.recording.height, 360)
  assert.ok(started.recording.encoder)
  try { await until(async () => evaluate(`document.querySelector('.runtime-locked')?.textContent.includes('encoded frames')`), 'recording status UI', 4000) }
  catch (error) { console.log(await evaluate(`({state:document.querySelector('.runtime-state')?.textContent,panel:document.querySelector('.runtime-locked')?.textContent,notice:document.querySelector('.app-notice')?.textContent,body:document.body.innerText.slice(0,2000)})`)); throw error }
  await delay(700)
  await invoke('dispatch_blueprint_event', { eventId: 'event-pause' })
  await until(async () => (await snapshot()).status === 'paused', 'pause')
  await delay(100)
  const paused = await snapshot(); await delay(500); const stillPaused = await snapshot()
  assert.ok(stillPaused.recording.durationMs - paused.recording.durationMs < 30, 'pause must exclude wall time')
  await invoke('dispatch_blueprint_event', { eventId: 'event-resume' })
  await until(async () => (await snapshot()).status === 'recording', 'resume')
  await delay(700)
  await invoke('dispatch_blueprint_event', { eventId: 'event-stop' })
  const stopped = await until(async () => { const s = await snapshot(); if (s.status === 'failed') throw Error(s.error); return s.status === 'ready' ? s : null }, 'MP4 finalization')
  assert.ok(stopped.recording.stopMs < 3000)
  assert.ok((await stat(stopped.recording.outputPath)).size > 0)
  const decoder = path.join(desktop, 'src-tauri/target/release/examples/recording-smoke.exe')
  const decoded = await promisify(execFile)(decoder, ['verify', stopped.recording.outputPath])
  assert.match(decoded.stdout, /Decoded H.264 MP4 898x360/)
  assert.ok(Number(decoded.stdout.match(/sceneChanges=(\d+)/)?.[1]) > 0, 'changing screen pixels must reach the decoded video')
  const capture = await command('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(fixture, 'overview.png'), Buffer.from(capture.data, 'base64'))
  const original = await readFile(stopped.recording.outputPath)
  const collision = structuredClone(document); collision.values.filename = path.basename(stopped.recording.outputPath)
  await invoke('activate_blueprint', { document: collision })
  await invoke('dispatch_blueprint_event', { eventId: 'event-start' })
  const collisionFailure = await until(async () => { const s = await snapshot(); return s.status === 'failed' ? s : null }, 'existing output protection')
  assert.match(collisionFailure.error, /already exists/)
  assert.deepEqual(await readFile(stopped.recording.outputPath), original)
  const partialCollision = structuredClone(document); partialCollision.values.filename = 'existing-partial.mp4'
  const partialPath = path.join(fixture, 'recordings/existing-partial.partial.mp4')
  await writeFile(partialPath, 'preserve existing partial file')
  await invoke('activate_blueprint', { document: partialCollision })
  await invoke('dispatch_blueprint_event', { eventId: 'event-start' })
  await until(async () => (await snapshot()).status === 'failed', 'existing partial output protection')
  assert.equal(await readFile(partialPath, 'utf8'), 'preserve existing partial file')
  // A second session must also finalize when stopped directly from paused.
  await invoke('activate_blueprint', { document })
  await invoke('dispatch_blueprint_event', { eventId: 'event-start' })
  await until(async () => (await snapshot()).status === 'recording', 'second session')
  await delay(150)
  await invoke('dispatch_blueprint_event', { eventId: 'event-pause' })
  await until(async () => (await snapshot()).status === 'paused', 'second pause')
  await delay(100)
  await invoke('dispatch_blueprint_event', { eventId: 'event-stop' })
  const stoppedPaused = await until(async () => { const s = await snapshot(); if(s.status==='failed')throw Error(s.error); return s.status==='ready'?s:null }, 'stop while paused')
  assert.ok((await stat(stoppedPaused.recording.outputPath)).size > 0)
  // A bad region must fail before success is reported or controls are advanced.
  const invalid = structuredClone(document); invalid.values.width = 999999
  await invoke('activate_blueprint', { document: invalid })
  await invoke('dispatch_blueprint_event', { eventId: 'event-start' })
  const failed = await until(async () => { const s = await snapshot(); return s.status === 'failed' ? s : null }, 'out-of-bounds rejection')
  assert.match(failed.error, /inside the selected display/)
  await invoke('activate_blueprint', { document })
  await invoke('dispatch_blueprint_event', { eventId: 'event-start' })
  const beforeClose = await until(async () => { const s = await snapshot(); return s.status==='recording' && s.frameCount>0 ? s : null }, 'close-time recording')
  await command('Runtime.evaluate', { expression: `window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'}); window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'}); true`, returnByValue: true })
  await until(() => app.exitCode !== null, 'graceful close while recording')
  assert.ok((await stat(beforeClose.recording.outputPath)).size > 0, 'window close must wait for MP4 publication')
  const closeDecoded = await promisify(execFile)(decoder, ['verify', beforeClose.recording.outputPath])
  assert.match(closeDecoded.stdout, /Decoded H.264 MP4/)
  await writeFile(path.join(fixture, 'result.json'), JSON.stringify({ started, stopped, stoppedPaused, existingOutputsPreserved: true, gracefulCloseDecoded: closeDecoded.stdout, failed: failed.error, decoded: decoded.stdout }, null, 2))
  console.log(JSON.stringify({ fixture, recording: stopped.recording, decoded: decoded.stdout }, null, 2))
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ id: 999999, method: 'Runtime.evaluate', params: { expression: `window.__TAURI_INTERNALS__.invoke('dispatch_blueprint_event',{eventId:'event-stop'}).catch(()=>{})` } }))
    await delay(500); socket.close()
  }
  if (app.exitCode === null) app.kill()
}

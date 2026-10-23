import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, copyFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = 9347
const endpoint = `http://127.0.0.1:${port}`
const fixture = path.join(desktop, 'src-tauri/target/function-navigation-check')
await mkdir(path.join(fixture, 'blueprints/builtin'), { recursive: true })
await copyFile(path.join(desktop, 'src-tauri/target/release/nodrec-desktop.exe'), path.join(fixture, 'nodrec-desktop.exe'))
await copyFile(path.join(desktop, 'blueprints/builtin/screen-recording.nodrec.json'), path.join(fixture, 'blueprints/builtin/screen-recording.nodrec.json'))
const app = spawn(path.join(fixture, 'nodrec-desktop.exe'), [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(fixture, 'webview'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } })
let socket
try {
  let target
  for (let attempt = 0; attempt < 60 && !target; attempt++) {
    try { target = (await (await fetch(`${endpoint}/json/list`)).json()).find(item => item.type === 'page') } catch {}
    if (!target) await delay(250)
  }
  assert.ok(target, 'WebView debugging target must start')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map()
  const errors = []
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
    const entry = pending.get(message.id)
    if (entry) { pending.delete(message.id); if (message.error) entry.reject(message.error); else entry.resolve(message.result) }
  })
  const command = (method, params = {}) => Promise.race([new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params })) }), delay(5000).then(() => { throw Error(`Timed out: ${method}`) })])
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  await command('Runtime.enable')
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await evaluate(`!!document.querySelector('.blueprint-select')`)) break
    await delay(250)
  }
  assert.ok(await evaluate(`!!document.querySelector('.blueprint-select')`), await evaluate(`document.body.innerText`))
  await evaluate(`document.querySelector('.blueprint-select').click()`)
  await delay(150)
  await evaluate(`[...document.querySelectorAll('.workspace-tab > button')].find(b => b.textContent === 'Blueprint').click()`)
  await delay(300)
  const startupErrors = errors.splice(0)
  if (startupErrors.length) console.warn('Startup exceptions:', JSON.stringify(startupErrors))
  for (let attempt = 0; attempt < 8; attempt++) {
    await evaluate(`(() => { const button = [...document.querySelectorAll('.library-section')].find(s => s.textContent.includes('Functions')).querySelector('.tree-item'); if (!button) throw Error('Missing function'); button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`)
    await delay(150)
    assert.ok(await evaluate(`document.querySelector('.graph-breadcrumb').textContent.includes('Prepare Output Path')`), 'function graph opens')
    assert.ok(await evaluate(`!!document.querySelector('.react-flow') && !!document.querySelector('.blueprint-library')`), 'UI remains mounted')
    await evaluate(`document.querySelector('.library-section .tree-item').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
    await delay(150)
    assert.ok(await evaluate(`document.querySelector('.graph-breadcrumb').textContent.includes('Events')`), 'event graph opens')
  }
  assert.equal(errors.length, 0, JSON.stringify(errors))
  console.log('PASS: 8 function/event double-click cycles; WebView responsive; no navigation JavaScript exceptions')
} finally {
  socket?.close()
  app.kill()
}


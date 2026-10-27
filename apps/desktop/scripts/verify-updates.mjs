// Run against a deliberately installed older build after publishing the target release.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const executable = process.argv[2]
const expected = process.argv[3]
assert(executable && /^\d+\.\d+\.\d+$/.test(expected || ''), 'Pass an installed old EXE path and expected new version')
const installation = path.dirname(executable)
const output = path.join(desktop, 'src-tauri/target/update-acceptance')
await mkdir(output, { recursive: true })
const fixturePath = path.join(installation, 'blueprints/user/update-acceptance.nodrec.json')
try { await readFile(fixturePath); throw new Error('Refusing to overwrite an existing acceptance fixture') }
catch (e) { if (e.code !== 'ENOENT') throw e }
const builtinPath = path.join(installation, 'blueprints/builtin/screen-recording.nodrec.json')
const builtin = await readFile(builtinPath, 'utf8')
const fixture = JSON.parse(builtin)
fixture.id = 'update-acceptance'; fixture.name = 'Update acceptance'
await mkdir(path.dirname(fixturePath), { recursive: true })
await writeFile(fixturePath, JSON.stringify(fixture))
const endpoint = 'http://127.0.0.1:9339'
try { await fetch(`${endpoint}/json/list`); throw new Error('Debug port 9339 is occupied') }
catch (e) { if (e.message.includes('occupied')) throw e }
const app = spawn(executable, [], { env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(output, 'webview'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9339' }, windowsHide: true, stdio: 'ignore' })
let socket, originalSettings, sequence = 0
const pending = new Map()
async function until(test, timeout = 120000) {
  const start = Date.now()
  let error
  while (Date.now() - start < timeout) {
    try { const result = await test(); if (result) return result } catch (e) { error = e }
    await delay(250)
  }
  throw new Error(`Timed out: ${error?.message || 'condition did not become true'}`)
}
async function connect(previousTarget) {
  const target = await until(async () => {
    const targets = await (await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(1000) })).json()
    return targets.find(item => item.type === 'page' && item.url.includes('tauri.localhost') && item.id !== previousTarget)
  })
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data), request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  socket.addEventListener('close', () => { for (const request of pending.values()) request.reject(new Error('App restarted')); pending.clear() })
  return target.id
}
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }))
})
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
const invoke = (name, args = {}) => evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)},${JSON.stringify(args)})`)
async function click(text, selector = 'button') {
  assert(await evaluate(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)return false;b.click();return true})()`), `Missing enabled ${text}`)
  await delay(100)
}
async function setInput(selector, value) {
  await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw Error('Missing input');input.focus();input.select()})()`)
  await command('Input.insertText', { text: value })
  await delay(150)
}
async function settingsPage(section) {
  await evaluate(`document.querySelector('.brand-menu').open=true`)
  await click('Settings', '.brand-menu button')
  await click(section, '.settings-navigation button')
}
try {
  const target = await connect()
  await until(() => evaluate(`document.querySelectorAll('.builtin-badge').length===2`))
  originalSettings = await invoke('get_settings')
  const initialVersion = await invoke('plugin:app|version').catch(() => evaluate(`window.__TAURI_INTERNALS__.invoke('plugin:app|version')`))
  assert.notEqual(initialVersion, expected)
  await settingsPage('Network')
  await until(() => evaluate(`!document.querySelector('.settings-option select')?.disabled`), 300000)
  await evaluate(`(()=>{const s=document.querySelector('.settings-option select');s.value='direct';s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await click('Save settings')
  await until(async () => (await invoke('get_settings')).proxyMode === 'direct')
  assert(await invoke('save_settings', { settings: { ...originalSettings, proxyMode: 'custom', proxyUrl: 'file:///bad' } }).then(() => false, () => true), 'Reject invalid proxy')
  if (process.argv.includes('--settings-only')) {
    await settingsPage('About')
    const result = await invoke('check_update').catch(error => String(error))
    await writeFile(path.join(output, 'direct-check.json'), JSON.stringify(result, null, 2))
    const screenshot = await command('Page.captureScreenshot', { format: 'png' })
    await writeFile(path.join(output, 'settings-about.png'), Buffer.from(screenshot.data, 'base64'))
    console.log('PASS: actual Settings UI, direct proxy save, invalid proxy rejection and built-in badges.')
  } else {
  await evaluate(`document.querySelector('[aria-label="More actions for Update acceptance"]').click()`)
  await click('Rename', '.context-menu button')
  await setInput('.name-dialog input', 'Update acceptance saved')
  await click('Save', '.dialog-actions button')
  await click('Screen recording', '.blueprint-select')
  await setInput('input[aria-label="Output folder"]', 'C:/Update acceptance built-in overwrite test')
  assert(await evaluate(`document.querySelectorAll('.blueprint-save').length===2`), 'Both blueprints must be dirty')
  await settingsPage('About')
  await click('Check for updates')
  await until(() => evaluate(`!![...document.querySelectorAll('.settings-updates button')].find(b=>b.textContent.includes('Update and restart')&&!b.disabled)`))
  const checkText = await evaluate(`document.querySelector('.settings-content').innerText`)
  assert(checkText.includes(`Nodrec ${expected}`), checkText)
  await writeFile(path.join(output, 'check.txt'), checkText)
  const screenshot = await command('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(output, 'about-before-update.png'), Buffer.from(screenshot.data, 'base64'))
  const originalFixture = await readFile(fixturePath, 'utf8')
  await writeFile(fixturePath, JSON.stringify({ ...fixture, name: 'External edit must survive' }))
  await click('Update and restart')
  await until(() => evaluate(`document.querySelector('.settings-message')?.textContent.includes('Update cancelled')`))
  assert.equal(JSON.parse(await readFile(fixturePath, 'utf8')).name, 'External edit must survive', 'Conflict aborts update without overwriting external edits')
  await writeFile(fixturePath, originalFixture)
  await click('Update and restart')
  await until(async () => JSON.parse(await readFile(fixturePath, 'utf8')).name === 'Update acceptance saved')
  const savedBuiltin = JSON.parse(await readFile(builtinPath, 'utf8'))
  assert.equal(savedBuiltin.values.output, 'C:/Update acceptance built-in overwrite test', 'Built-in edits are saved before downloading')
  console.log('Saved user and built-in edits before update; waiting for installer and restart.')
  await until(() => socket.readyState === WebSocket.CLOSED, 600000)
  await connect(target)
  await until(async () => await invoke('plugin:app|version') === expected)
  assert.equal((await invoke('get_settings')).proxyMode, 'direct', 'Proxy survives upgrade')
  assert.equal(JSON.parse(await readFile(fixturePath, 'utf8')).name, 'Update acceptance saved', 'User blueprint survives upgrade')
  assert.deepEqual(JSON.parse(await readFile(builtinPath, 'utf8')), JSON.parse(builtin), 'Built-in blueprint is replaced')
  const latest = await until(async () => { try { return await invoke('check_update') } catch { return null } })
  assert.equal(latest.version, null, 'Current latest version does not offer another update')
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ initialVersion, installedVersion: expected, directCheck: checkText, latest, userPreserved: true, builtinReplaced: true, automaticallyRestarted: true }, null, 2))
  console.log(`PASS: ${initialVersion} → ${expected}, direct check/download, automatic save/install/restart, user preservation and built-in replacement.`)
  }
} catch (error) {
  console.error('Update acceptance failed:', error)
  throw error
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    if (originalSettings) await until(async () => { try { await invoke('save_settings', { settings: originalSettings }); return true } catch { return false } }, 120000).catch(() => {})
    await invoke('plugin:window|close', { label: 'main' }).catch(() => {})
    socket.close()
  }
  if (app.exitCode === null) app.kill()
  await rm(fixturePath, { force: true })
}

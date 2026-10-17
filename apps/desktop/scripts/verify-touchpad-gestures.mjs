import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'

const demoUrl = 'https://example-apps.xyflow.com/react/learn/zoom-pan-2/index.html'
const edge = process.env.EDGE_EXECUTABLE ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(existsSync)
if (!edge) throw new Error('Microsoft Edge is required for official touchpad gesture verification; set EDGE_EXECUTABLE to its executable path.')

const portProbe = net.createServer()
const port = await new Promise((resolve, reject) => {
  portProbe.once('error', reject)
  portProbe.listen(0, '127.0.0.1', () => {
    const address = portProbe.address()
    if (typeof address === 'object' && address) resolve(address.port)
    else reject(new Error('Could not reserve a local DevTools port.'))
    portProbe.close()
  })
})
const profile = await mkdtemp(path.join(os.tmpdir(), 'nodrec-touchpad-'))
const browser = spawn(edge, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, demoUrl,
], { stdio: 'ignore', windowsHide: true })
let socket
let closeBrowser

async function waitForTarget() {
  const endpoint = `http://127.0.0.1:${port}/json/list`
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (browser.exitCode !== null) throw new Error(`Edge exited before opening the official demo (${browser.exitCode}).`)
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(500) })
      const targets = await response.json()
      const target = targets.find((item) => item.type === 'page' && item.url.startsWith('https://example-apps.xyflow.com/react/learn/zoom-pan-2/'))
      if (target) return target
    } catch { /* Edge's DevTools endpoint is not ready yet. */ }
    await delay(100)
  }
  throw new Error(`Timed out opening the official React Flow demo: ${browser.stderr ?? ''}`)
}

try {
  const target = await waitForTarget()
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const pending = new Map()
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  let nextId = 0
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`DevTools command timed out: ${method}`)) }, 5000)
    pending.set(id, {
      resolve: (value) => { clearTimeout(timeout); resolve(value) },
      reject: (error) => { clearTimeout(timeout); reject(error) },
    })
    socket.send(JSON.stringify({ id, method, params }))
  })
  closeBrowser = command
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
  const waitUntil = async (check, timeout = 15000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await check()) return
      await delay(80)
    }
    throw new Error(`Timed out waiting for the official demo: ${await evaluate(`location.href`)}`)
  }
  const viewport = () => evaluate(`(() => { const el = document.querySelector('.react-flow__viewport'); if (!el) return null; const m = new DOMMatrix(getComputedStyle(el).transform); return { x: m.m41, y: m.m42, zoom: m.a } })()`)
  const waitForStableViewport = async () => {
    let previous = await viewport()
    let stable = 0
    for (let attempt = 0; attempt < 80 && stable < 4; attempt++) {
      await delay(100)
      const next = await viewport()
      if (next.x === previous.x && next.y === previous.y && next.zoom === previous.zoom) stable++
      else stable = 0
      previous = next
    }
    assert.ok(stable >= 4, 'the official demo viewport should settle before gesture input')
    return previous
  }
  const wheelAt = (point, deltaX, deltaY, modifiers = 0) => command('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX, deltaY, modifiers })

  await command('Page.enable')
  await command('Runtime.enable')
  await command('Page.bringToFront')
  await waitUntil(() => evaluate(`!!document.querySelector('.react-flow__pane') && !!document.querySelector('.react-flow__viewport')`))
  await waitForStableViewport()
  const point = await evaluate(`(() => { const r = document.querySelector('.react-flow__pane').getBoundingClientRect(); for (let y = r.top + 40; y < r.bottom - 30; y += 16) for (let x = r.left + 30; x < r.right - 30; x += 16) { const el = document.elementFromPoint(x, y); if (!el?.closest('.react-flow__node, .react-flow__edge, .react-flow__background, .react-flow__controls, .react-flow__minimap')) return { x, y } } return null })()`)
  assert.ok(point, 'the official demo should expose a blank pane for gesture testing')
  await evaluate(`(() => { window.__gestureTrace = []; window.addEventListener('wheel', (event) => window.__gestureTrace.push({ deltaMode: event.deltaMode, deltaX: event.deltaX, deltaY: event.deltaY, ctrlKey: event.ctrlKey, wheelDeltaY: event.wheelDeltaY, trusted: event.isTrusted }), true) })()`)

  const beforePan = await viewport()
  await wheelAt(point, 0, 24)
  await waitUntil(async () => {
    const next = await viewport()
    return next && (next.x !== beforePan.x || next.y !== beforePan.y)
  })
  const afterPan = await viewport()
  const panEvent = await evaluate(`window.__gestureTrace.at(-1)`)
  assert.equal(panEvent.deltaMode, 0, 'the pan simulation should use pixel-mode wheel deltas')
  assert.equal(panEvent.ctrlKey, false, 'the two-finger scroll simulation should not hold Ctrl')
  assert.equal(panEvent.trusted, true, 'the browser should receive a trusted wheel event')
  assert.ok(Math.abs(panEvent.deltaY) < 80, 'the pan simulation should carry a continuous sub-notch pixel delta')
  assert.equal(afterPan.zoom, beforePan.zoom, 'two-finger scroll must pan the official demo without zooming')
  assert.notEqual(afterPan.y, beforePan.y, 'vertical two-finger scroll must move the official demo viewport')

  await wheelAt(point, 0, -48, 2)
  await waitUntil(async () => (await viewport()).zoom !== afterPan.zoom)
  const afterPinch = await viewport()
  const pinchEvent = await evaluate(`window.__gestureTrace.at(-1)`)
  assert.equal(pinchEvent.deltaMode, 0, 'the pinch simulation should use pixel-mode wheel deltas')
  assert.equal(pinchEvent.ctrlKey, true, 'the pinch simulation should carry the browser trackpad pinch modifier')
  assert.equal(pinchEvent.trusted, true, 'the browser should receive a trusted pinch wheel event')
  assert.ok(afterPinch.zoom > afterPan.zoom, 'pinch (Ctrl+wheel) must zoom in the official demo')

  console.log(JSON.stringify({ officialDemo: target.url, simulatedGestures: { twoFingerScroll: panEvent, trackpadPinch: pinchEvent }, beforePan, afterPan, afterPinch }, null, 2))
} finally {
  if (socket?.readyState === WebSocket.OPEN && closeBrowser) {
    try { await closeBrowser('Browser.close') } catch { /* The browser may already have exited after a failed assertion. */ }
  }
  if (browser.exitCode === null) {
    await Promise.race([once(browser, 'exit'), delay(5000)])
  }
  if (browser.exitCode === null) {
    const killer = spawn('taskkill.exe', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    await Promise.race([once(killer, 'exit'), delay(5000)])
  }
  socket?.close()
  try { await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) }
  catch (error) { console.warn(`Could not immediately remove temporary Edge profile ${profile}: ${error.message}`) }
}

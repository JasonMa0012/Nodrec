import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import net from 'node:net'
import { mkdir, writeFile } from 'node:fs/promises'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manual = process.argv.includes('--manual')
const officialDemo = process.argv.includes('--official-demo')
const hardwareOutput = path.resolve(desktop, `../../out/ui-tests/touchpad-${officialDemo ? 'demo-' : ''}hardware.json`)
const hardwareTrace = { startedAt: new Date().toISOString(), status: 'starting', events: [], precisionTouchpadMessages: [] }
async function saveHardwareTrace() {
  await mkdir(path.dirname(hardwareOutput), { recursive: true })
  await writeFile(hardwareOutput, JSON.stringify(hardwareTrace, null, 2))
}
if (manual) {
  await saveHardwareTrace()
  process.on('uncaughtExceptionMonitor', (error) => {
    hardwareTrace.status = 'failed'
    hardwareTrace.error = error.stack ?? String(error)
    void saveHardwareTrace()
  })
}
const executable = path.join(desktop, 'src-tauri', 'target', 'release', 'nodrec-desktop.exe')
const configuredPort = process.env.NODREC_GESTURE_CDP_PORT
const port = configuredPort === undefined ? await freePort() : Number(configuredPort)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Invalid NODREC_GESTURE_CDP_PORT: ${configuredPort}`)
const endpoint = `http://127.0.0.1:${port}`
try {
  await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(500) })
  throw new Error(`Refusing to use occupied WebView2 debugging port ${port}.`)
} catch (error) { if (error.message.startsWith('Refusing')) throw error }

const webviewDataDirectory = path.join(desktop, 'src-tauri', 'target', 'release', `webview2-touchpad-${port}`)
const app = spawn(executable, [], { env: { ...process.env, ...(manual ? { NODREC_TOUCHPAD_TEST: '1' } : {}), WEBVIEW2_USER_DATA_FOLDER: webviewDataDirectory, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }, stdio: 'pipe', windowsHide: false })
let appOutput = ''
app.stdout.setEncoding('utf8').on('data', (chunk) => { appOutput += chunk })
app.stderr.setEncoding('utf8').on('data', (chunk) => { appOutput += chunk })
let socket

async function freePort() {
  const server = net.createServer()
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'object' && address) resolve(address.port)
      else reject(new Error('Could not reserve a local WebView2 DevTools port.'))
      server.close()
    })
  })
}

async function waitForTarget() {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (app.exitCode !== null) throw new Error(`Nodrec exited before opening (${app.exitCode}): ${appOutput}`)
    try {
      const response = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(500) })
      const targets = await response.json()
      const target = targets.find((item) => item.type === 'page' && item.url.includes('tauri.localhost'))
      if (target) return target
    } catch { /* WebView2's DevTools endpoint is not ready yet. */ }
    await delay(100)
  }
  throw new Error(`Timed out waiting for Nodrec's WebView2 DevTools endpoint: ${appOutput}`)
}

try {
  const target = await waitForTarget()
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const pending = new Map()
  socket.addEventListener('close', () => {
    for (const request of pending.values()) request.reject(new Error('WebView closed; hardware samples already saved remain available'))
    pending.clear()
  })
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
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
  const waitUntil = async (check, timeout = 12000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await check()) return
      await delay(80)
    }
    throw new Error(`Timed out waiting for Nodrec WebView: ${appOutput}`)
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
    assert.ok(stable >= 4, 'Nodrec viewport should settle before gesture input')
    return previous
  }
  const point = async () => evaluate(`(() => { const r = document.querySelector('.react-flow__pane')?.getBoundingClientRect(); if (!r) return null; for (let y = r.top + 60; y < r.bottom - 60; y += 18) for (let x = r.left + 24; x < r.right - 24; x += 18) { const el = document.elementFromPoint(x, y); if (!el?.closest('.react-flow__node, .react-flow__edge, .react-flow__background, .react-flow__controls, .react-flow__minimap, .details-panel, .graph-breadcrumb')) return { x, y } } return null })()`)
  const wheelAt = (position, deltaX, deltaY, modifiers = 0) => command('Input.dispatchMouseEvent', { type: 'mouseWheel', ...position, deltaX, deltaY, modifiers })

  await command('Page.enable')
  await command('Runtime.enable')
  await command('Page.bringToFront')
  if (officialDemo) {
    await command('Page.navigate', { url: 'https://example-apps.xyflow.com/react/learn/zoom-pan-2/index.html' })
  } else {
  await waitUntil(() => evaluate(`document.querySelector('.blueprint-nav-item.active .blueprint-name')?.textContent.trim() === 'Screen recording'`), 15000)
  await evaluate(`([...document.querySelectorAll('.workspace-tab button')].find((button) => button.textContent.trim() === 'Blueprint'))?.click()`)
  }
  await waitUntil(() => evaluate(`!!document.querySelector('.react-flow__pane')`))
  await waitForStableViewport()
  const blank = await point()
  assert.ok(blank, 'Nodrec should have a blank Blueprint canvas point for gesture tests')
    await evaluate(`(() => { window.__gestureTrace = []; window.__precisionTouchpadMessages = []; window.addEventListener('wheel', (event) => window.__gestureTrace.push({ deltaMode: event.deltaMode, deltaX: event.deltaX, deltaY: event.deltaY, ctrlKey: event.ctrlKey, trusted: event.isTrusted }), true); window.addEventListener('nodrec-precision-touchpad-pointer', (event) => window.__precisionTouchpadMessages.push(event.detail)) })()`)
  if (manual) {
    console.log('Keep this Nodrec Blueprint window focused. Start a two-finger gesture; once the first input arrives, record for 30 seconds. The trace records WebView wheel deltas and each native WM_POINTER message with its frame-query result.')
    console.log(`Saving continuously to: ${hardwareOutput}`)
    hardwareTrace.status = 'waiting-for-input'
    const capture = async () => {
      Object.assign(hardwareTrace, await evaluate(`({ userAgent: navigator.userAgent, documentHasFocus: document.hasFocus(), pageVisibility: document.visibilityState, axisLock: getComputedStyle(document.querySelector('.react-flow__pane')).getPropertyValue('scroll-axis-lock'), events: window.__gestureTrace, precisionTouchpadMessages: window.__precisionTouchpadMessages })`))
      hardwareTrace.nativeStartup = appOutput
      await saveHardwareTrace()
    }
    const waitDeadline = Date.now() + 120000
    while (Date.now() < waitDeadline && hardwareTrace.events.length + hardwareTrace.precisionTouchpadMessages.length === 0) {
      await capture()
      if (hardwareTrace.events.length + hardwareTrace.precisionTouchpadMessages.length === 0) await delay(500)
    }
    hardwareTrace.status = hardwareTrace.events.length + hardwareTrace.precisionTouchpadMessages.length === 0 ? 'complete-no-input' : 'recording'
    const recordUntil = Date.now() + 30000
    while (hardwareTrace.status === 'recording' && Date.now() < recordUntil) {
      await capture()
      await delay(500)
    }
    hardwareTrace.status = 'complete'
    hardwareTrace.wheelEventCount = hardwareTrace.events.length
    hardwareTrace.pointerMessageCount = hardwareTrace.precisionTouchpadMessages.length
    hardwareTrace.touchpadPointerMessageCount = hardwareTrace.precisionTouchpadMessages.filter(({ pointer_type }) => pointer_type === 5).length
    hardwareTrace.pointerFrameCount = hardwareTrace.precisionTouchpadMessages.filter(({ frame_read_succeeded }) => frame_read_succeeded).length
    if (hardwareTrace.wheelEventCount + hardwareTrace.pointerMessageCount === 0) hardwareTrace.status = 'complete-no-input'
    await saveHardwareTrace()
    console.log(`Hardware trace saved: ${hardwareOutput}`)
    if (hardwareTrace.status === 'complete-no-input') console.warn('No wheel or WM_POINTER events reached this window; this run cannot diagnose the axis lock.')
    process.exitCode = 0
  } else {

  const beforeMouseWheel = await viewport()
  const pageZoomBefore = await evaluate(`({ devicePixelRatio: window.devicePixelRatio, viewportScale: window.visualViewport?.scale ?? 1 })`)
  // Unlike Ctrl+wheel injection, this enters Chromium's touchpad gesture pipeline.
  await command('Input.synthesizePinchGesture', { ...blank, scaleFactor: 1.2, relativeSpeed: 400, gestureSourceType: 'mouse' })
  await waitUntil(async () => (await viewport()).zoom !== beforeMouseWheel.zoom)
  const afterNativePinch = await waitForStableViewport()
  assert.ok(afterNativePinch.zoom > beforeMouseWheel.zoom, 'browser touchpad pinch gesture should reach the canvas')
  assert.deepEqual(await evaluate(`({ devicePixelRatio: window.devicePixelRatio, viewportScale: window.visualViewport?.scale ?? 1 })`), pageZoomBefore, 'touchpad pinch must not scale the whole page')
  await wheelAt(blank, 0, -120)
  await waitUntil(async () => (await viewport()).zoom !== afterNativePinch.zoom)
  const afterMouseWheel = await viewport()
  const mouseWheelEvent = await evaluate(`window.__gestureTrace.at(-1)`)
  assert.ok(afterMouseWheel.zoom > afterNativePinch.zoom, 'a conventional mouse wheel tick should zoom the Nodrec canvas')
  assert.ok(Math.abs(afterMouseWheel.zoom / afterNativePinch.zoom - 2 ** .24) < .001, 'mouse wheel zoom should use React Flow default speed')
  assert.equal(mouseWheelEvent.trusted, true, 'the mouse wheel simulation should be a trusted browser input')
  assert.ok(Math.abs(mouseWheelEvent.deltaY) >= 80, 'the mouse wheel simulation should carry a coarse wheel delta')

  await wheelAt(blank, 0, 24)
  await waitUntil(async () => { const next = await viewport(); return next.x !== afterMouseWheel.x || next.y !== afterMouseWheel.y || next.zoom !== afterMouseWheel.zoom })
  const afterTrackpadScroll = await viewport()
  const trackpadEvent = await evaluate(`window.__gestureTrace.at(-1)`)
  assert.equal(afterTrackpadScroll.zoom, afterMouseWheel.zoom, 'two-finger pixel scrolling should pan Nodrec without changing zoom')
  assert.notEqual(afterTrackpadScroll.y, afterMouseWheel.y, 'vertical two-finger scrolling should pan Nodrec')
  assert.equal(trackpadEvent.deltaMode, 0, 'trackpad scrolling should use pixel-mode deltas')
  assert.ok(Math.abs(trackpadEvent.deltaY) < 80, 'trackpad scrolling should retain its continuous sub-notch delta')

  await wheelAt(blank, 24, 0)
  await waitUntil(async () => (await viewport()).x !== afterTrackpadScroll.x)
  const afterHorizontalScroll = await viewport()
  assert.equal(afterHorizontalScroll.zoom, afterMouseWheel.zoom, 'horizontal two-finger scrolling should pan without zooming')

  const canceled = await evaluate(`(() => { const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 24 }); document.elementFromPoint(${blank.x}, ${blank.y}).dispatchEvent(event); return event.defaultPrevented })()`)
  assert.equal(canceled, true, 'canvas pan must cancel native scrolling before the browser can latch an axis')
  for (const deltas of [[[0, 24], [24, 16], [24, 0]], [[24, 0], [16, 24], [0, 24]]]) {
    for (const [dx, dy] of deltas) {
      const before = await viewport()
      await wheelAt(blank, dx, dy)
      await waitUntil(async () => { const next = await viewport(); return next.x !== before.x || next.y !== before.y })
      const after = await viewport()
      assert.ok(Math.abs(after.x - before.x + dx * .5) < .05, 'changing direction must retain horizontal movement')
      assert.ok(Math.abs(after.y - before.y + dy * .5) < .05, 'changing direction must retain vertical movement')
      assert.equal(after.zoom, before.zoom)
    }
  }
  const beforeCtrlWheel = await viewport()
  await wheelAt(blank, 0, -48, 2)
  await waitUntil(async () => (await viewport()).zoom !== afterHorizontalScroll.zoom)
  const afterPinch = await viewport()
  const pinchEvent = await evaluate(`window.__gestureTrace.at(-1)`)
  assert.ok(afterPinch.zoom > afterHorizontalScroll.zoom, 'trackpad pinch (Ctrl+wheel) should zoom Nodrec')
  assert.ok(Math.abs(afterPinch.zoom / beforeCtrlWheel.zoom - 2 ** .384) < .001, 'pinch zoom exponent should be four times React Flow default on Windows')
  assert.equal(pinchEvent.ctrlKey, true, 'the pinch simulation should carry the browser trackpad pinch modifier')
  const pageZoomAfter = await evaluate(`({ devicePixelRatio: window.devicePixelRatio, viewportScale: window.visualViewport?.scale ?? 1 })`)
  assert.deepEqual(pageZoomAfter, pageZoomBefore, 'canvas gestures should not change the overall WebView page zoom')

  const dragPoint = await point()
  assert.ok(dragPoint, 'Nodrec should have a blank canvas point for right-drag testing after zoom')
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...dragPoint })
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...dragPoint, button: 'right', buttons: 2 })
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragPoint.x + 40, y: dragPoint.y + 24, button: 'right', buttons: 2 })
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dragPoint.x + 40, y: dragPoint.y + 24, button: 'right', buttons: 0 })
  await waitUntil(async () => { const next = await viewport(); return next.x !== afterPinch.x || next.y !== afterPinch.y })
  const afterRightDrag = await viewport()

  for (let attempt = 0; attempt < 5 && (await viewport()).zoom > .01; attempt++) {
    const beforeZoomOut = await viewport()
    await wheelAt(blank, 0, 1200)
    await waitUntil(async () => (await viewport()).zoom !== beforeZoomOut.zoom)
  }
  await waitUntil(async () => (await viewport()).zoom === .01)
  assert.equal((await viewport()).zoom, .01, 'zoom out should reach the 1% practical floor')

  console.log(JSON.stringify({ nodrec: target.url, nativeStartup: appOutput, simulatedGestures: { nativePinch: 'Input.synthesizePinchGesture (mouse source)', mouseWheel: mouseWheelEvent, twoFingerScroll: trackpadEvent, trackpadPinch: pinchEvent, rightButtonDrag: 'pan' }, beforeMouseWheel, afterNativePinch, afterMouseWheel, afterTrackpadScroll, afterHorizontalScroll, afterPinch, afterRightDrag }, null, 2))
  }
} catch (error) {
  if (manual) {
    hardwareTrace.status = 'failed'
    hardwareTrace.error = error.stack ?? String(error)
    await saveHardwareTrace()
  }
  throw error
} finally {
  socket?.close()
  if (app.exitCode === null) {
    app.kill()
    await Promise.race([once(app, 'exit'), delay(5000)])
  }
}

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = 9348
const endpoint = `http://127.0.0.1:${port}`
const fixture = path.join(desktop, 'src-tauri/target/graph-interactions-check')
await mkdir(path.join(fixture, 'blueprints/builtin'), { recursive: true })
await copyFile(path.join(desktop, 'src-tauri/target/release/nodrec-desktop.exe'), path.join(fixture, 'nodrec-desktop.exe'))
const document = JSON.parse(await readFile(path.join(desktop, 'blueprints/builtin/screen-recording.nodrec.json'), 'utf8'))
document.nodes = [
  { id: 'start', type: 'event', position: { x: 0, y: 0 }, data: { kind: 'event', label: 'Start', config: { eventId: 'event-initialize' } } },
  ...['a', 'b', 'unrelated'].map((id, i) => ({ id, type: 'log', position: { x: i === 2 ? 0 : 400, y: i * 160 }, data: { kind: 'log', label: id, config: { message: id } } })),
]
document.nodes.push(...['string-source', 'string-target'].map((id, index) => ({ id, type: 'make_string', position: { x: index * 400, y: 480 }, data: { kind: 'make_string', label: id, config: { value: 'test', exposedInputs: ['value'] } } })))
document.edges = [{ id: 'test-edge', source: 'start', sourceHandle: 'out:flow', target: 'a', targetHandle: 'in:flow', type: 'smoothstep' }]
document.edges.push({ id: 'string-edge', source: 'string-source', sourceHandle: 'out:value', target: 'string-target', targetHandle: 'in:param:value', type: 'smoothstep' })
await writeFile(path.join(fixture, 'blueprints/builtin/screen-recording.nodrec.json'), JSON.stringify(document))
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
  const pinStyles = await evaluate(`(() => {
    const inspect = (node, side) => { const handle = document.querySelector('.react-flow__node[data-id="' + node + '"] .react-flow__handle.' + side); const glyph = handle.querySelector('.pin-glyph'); const style = getComputedStyle(glyph); return { unconnected: handle.classList.contains('unconnected'), fill: style.fill, stroke: style.stroke }; };
    return { flowConnected: inspect('start', 'source'), flowEmpty: inspect('b', 'target'), dataConnected: inspect('string-source', 'source'), dataEmpty: inspect('string-source', 'target') };
  })()`)
  for (const prefix of ['flow', 'data']) {
    assert.equal(pinStyles[prefix + 'Connected'].unconnected, false)
    assert.equal(pinStyles[prefix + 'Connected'].fill, pinStyles[prefix + 'Connected'].stroke)
    assert.equal(pinStyles[prefix + 'Empty'].unconnected, true)
    assert.equal(pinStyles[prefix + 'Empty'].fill, 'none')
    assert.equal(pinStyles[prefix + 'Empty'].stroke, pinStyles[prefix + 'Connected'].stroke)
  }
  const screenshot = await command('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(fixture, 'pin-styles.png'), Buffer.from(screenshot.data, 'base64'))
  const point = selector => evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw Error('Missing: ' + ${JSON.stringify(selector)}); const r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  const mouse = (type, p, extra = {}) => command('Input.dispatchMouseEvent', { type, ...p, ...extra })
  const click = async (p, count = 1) => {
    await mouse('mouseMoved', p)
    await mouse('mousePressed', p, { button: 'left', buttons: 1, clickCount: count })
    await mouse('mouseReleased', p, { button: 'left', buttons: 0, clickCount: count })
    await delay(100)
  }
  const drag = async (from, to, button = 'left', modifiers = 0) => {
    const buttons = button === 'middle' ? 4 : button === 'right' ? 2 : 1
    await mouse('mouseMoved', from)
    await mouse('mousePressed', from, { button, buttons, modifiers, clickCount: 1 })
    for (let i = 1; i <= 6; i++) await mouse('mouseMoved', { x: from.x + (to.x - from.x) * i / 6, y: from.y + (to.y - from.y) * i / 6 }, { button, buttons, modifiers })
    await mouse('mouseReleased', to, { button, buttons: 0, modifiers, clickCount: 1 })
    await delay(150)
  }
  const resize = await point('.blueprint-details-resizer')
  await drag(resize, { x: resize.x + 250, y: resize.y })
  await drag({ x: 730, y: 650 }, { x: 590, y: 650 }, 'middle')
  const edgePoint = () => evaluate(`(() => { const path = document.querySelector('.react-flow__edge-path'); const p = path.getPointAtLength(path.getTotalLength() / 2); const screen = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()); return { x: screen.x, y: screen.y } })()`)
  await click(await point('.react-flow__node[data-id="start"] .node-title'))
  assert.ok(await evaluate(`document.querySelector('.react-flow__node[data-id="b"]').classList.contains('unrelated-node')`), 'unrelated node dims')
  assert.ok(!await evaluate(`document.querySelector('.react-flow__node[data-id="a"]').classList.contains('unrelated-node')`), 'connected node stays bright')
  const beforeRightPan = await point('.react-flow__node[data-id="start"]')
  const rightPanStart = await edgePoint()
  await drag(rightPanStart, { x: rightPanStart.x + 45, y: rightPanStart.y + 30 }, 'right')
  const afterRightPan = await point('.react-flow__node[data-id="start"]')
  assert.ok(afterRightPan.x > beforeRightPan.x + 35 && afterRightPan.y > beforeRightPan.y + 20, 'right drag starting on a wire must pan the canvas')
  assert.equal(await evaluate(`!!document.querySelector('.graph-context-menu')`), false, 'right dragging a wire must not open the context menu')
  const wireMenuPoint = await edgePoint()
  await mouse('mousePressed', wireMenuPoint, { button: 'right', buttons: 2, clickCount: 1 })
  await mouse('mouseReleased', wireMenuPoint, { button: 'right', buttons: 0, clickCount: 1 })
  await delay(100)
  assert.equal(await evaluate(`!!document.querySelector('.graph-context-menu')`), true, 'a stationary right click on a wire must still open the menu')
  await evaluate(`document.querySelector('.react-flow__pane').click()`)
  const line = await edgePoint()
  await mouse('mouseMoved', line)
  await delay(100)
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.react-flow__edge-path')).strokeWidth`), '3.5px', 'hover thickens edge')
  await click(line, 2)
  assert.equal(await evaluate(`document.querySelectorAll('.route-pin').length`), 1, 'double click creates routing pin')
  const pin = await point('.route-pin')
  await drag(pin, { x: pin.x + 20, y: pin.y + 35 })
  const movedPin = await point('.route-pin')
  assert.ok(movedPin.y > pin.y + 20, 'routing pin moves')
  await click(movedPin, 2)
  assert.equal(await evaluate(`document.querySelectorAll('.route-pin').length`), 0, 'double click removes routing pin')
  const from = await point('.react-flow__node[data-id="a"] .react-flow__handle.target')
  const to = await point('.react-flow__node[data-id="b"] .react-flow__handle.target')
  await drag(from, to, 'left', 2)
  assert.ok(await evaluate(`document.querySelector('.react-flow__node[data-id="b"] .react-flow__handle.target:not(.unconnected)') !== null`), 'Ctrl drag reconnects target')
  assert.ok(await evaluate(`document.querySelector('.react-flow__node[data-id="a"] .react-flow__handle.target.unconnected') !== null`), 'old target disconnects')
  const source = await point('.react-flow__node[data-id="start"] .react-flow__handle.source')
  await drag(source, { x: source.x + 35, y: source.y + 100 }, 'left', 2)
  assert.equal(await evaluate(`document.querySelectorAll('.react-flow__edge[data-id="test-edge"]').length`), 0, 'Ctrl drag released on empty space disconnects')
  const before = await point('.react-flow__node[data-id="start"]')
  await drag({ x: before.x, y: before.y + 110 }, { x: before.x + 35, y: before.y + 135 }, 'middle')
  const after = await point('.react-flow__node[data-id="start"]')
  assert.ok(after.x > before.x + 25, 'middle button pans canvas')
  assert.equal(errors.length, 0, JSON.stringify(errors))
  console.log('PASS: pin styles, node relevance, right drag on wire, right-click menu, wire hover, routing pins, Ctrl reconnect/disconnect, middle pan')
} finally {
  socket?.close()
  app.kill()
}


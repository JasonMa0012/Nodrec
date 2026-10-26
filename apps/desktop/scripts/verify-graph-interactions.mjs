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
const layoutNodes = [
  { id: 'layout-event', type: 'event', position: { x: 13, y: 27 }, data: { kind: 'event', label: 'Layout Event', config: { eventId: 'layout-event' } } },
  { id: 'layout-action', type: 'log', position: { x: 740, y: 620 }, data: { kind: 'log', label: 'Consumer with an exposed parameter', config: { message: 'Layout message', exposedInputs: ['message'] } } },
  { id: 'layout-next', type: 'log', position: { x: 1100, y: 250 }, data: { kind: 'log', label: 'Next Action', config: { message: 'A longer caption exercises the actual measured node bounds.' } } },
  { id: 'layout-value', type: 'make_string', position: { x: -300, y: 670 }, data: { kind: 'make_string', label: 'Single Parameter', config: { value: 'Hello' } } },
  { id: 'layout-other', type: 'log', position: { x: 1400, y: 800 }, data: { kind: 'log', label: 'Unrelated', config: { message: 'Keep my position' } } },
]
document.functions[0].graph = { nodes: layoutNodes, edges: [
  { id: 'layout-exec', source: 'layout-event', target: 'layout-action', sourceHandle: 'out:flow', targetHandle: 'in:flow', data: { routePoints: [{ x: 500, y: 300 }] } },
  { id: 'layout-exec-next', source: 'layout-action', target: 'layout-next', sourceHandle: 'out:flow', targetHandle: 'in:flow' },
  { id: 'layout-data', source: 'layout-value', target: 'layout-action', sourceHandle: 'out:value', targetHandle: 'in:param:message', data: { routePoints: [{ x: 500, y: 500 }] } },
] }
document.functions.push({ id: 'parameter-order', name: 'Parameter order', folderId: document.functions[0].folderId, graph: {
  nodes: [
    { id: 'order-screen', type: 'screen', position: { x: 0, y: 50 }, data: { kind: 'screen', label: 'Capture Screen', config: { cursor: true } } },
    { id: 'order-write', type: 'write', position: { x: 2000, y: 500 }, data: { kind: 'write', label: 'Write MP4', config: {} } },
    { id: 'order-encode', type: 'encode', position: { x: 700, y: 500 }, data: { kind: 'encode', label: 'Encode H.264', config: { encoder: 'H.264', fps: 60, resolution: 'Source Size', bitrate: '20', encodingMode: 'Hardware Auto', exposedInputs: ['fps', 'resolution', 'bitrate', 'encodingMode'] } } },
    ...['bitrate', 'encodingMode', 'fps', 'resolution'].map((name, i) => ({ id: `read-${name}`, type: 'read_parameter', position: { x: 0, y: 300 + i * 150 }, data: { kind: 'read_parameter', label: `Read ${name}`, config: { parameterId: name } } })),
    { id: 'order-path', type: 'path', position: { x: 1500, y: 700 }, data: { kind: 'path', label: 'Output Path', config: { directory: 'C:/Recordings', filename: '{blueprint}.mp4', exposedInputs: ['directory', 'filename'] } } },
    ...['filename', 'output'].map((name, i) => ({ id: `read-${name}`, type: 'read_parameter', position: { x: 1000, y: 750 + i * 150 }, data: { kind: 'read_parameter', label: `Read ${name}`, config: { parameterId: name } } })),
  ],
  edges: [
    { id: 'order-frames', source: 'order-screen', target: 'order-encode', sourceHandle: 'out:frames', targetHandle: 'in:frames' },
    { id: 'order-video', source: 'order-encode', target: 'order-write', sourceHandle: 'out:video', targetHandle: 'in:video' },
    { id: 'order-output', source: 'order-path', target: 'order-write', sourceHandle: 'out:path', targetHandle: 'in:path' },
    ...['bitrate', 'encodingMode', 'fps', 'resolution'].map(name => ({ id: `order-${name}`, source: `read-${name}`, target: 'order-encode', sourceHandle: 'out:value', targetHandle: `in:param:${name}` })),
    ...['filename', 'directory'].map(name => ({ id: `order-${name}`, source: `read-${name === 'directory' ? 'output' : name}`, target: 'order-path', sourceHandle: 'out:value', targetHandle: `in:param:${name}` })),
  ],
} })
document.functions.push({ id: 'branch-pins', name: 'Branch pins', folderId: document.functions[0].folderId, graph: {
  nodes: [
    { id: 'test-branch', type: 'branch', position: { x: 0, y: 0 }, data: { kind: 'branch', label: 'Branch', config: { condition: false, exposedInputs: ['condition'] } } },
    { id: 'test-select', type: 'select_region', position: { x: 350, y: 0 }, data: { kind: 'select_region', label: 'Select Region', config: { toolId: 'test-picker', display: 'Display 1' } } },
    ...['branch', 'select'].map((id, i) => ({ id: `done-${id}`, type: 'log', position: { x: 700, y: i * 200 }, data: { kind: 'log', label: `After ${id}`, config: { message: 'Done' } } })),
  ],
  edges: [{ id: 'branch-true', source: 'test-branch', sourceHandle: 'out:true', target: 'done-branch', targetHandle: 'in:flow' }, { id: 'select-selected', source: 'test-select', sourceHandle: 'out:selected', target: 'done-select', targetHandle: 'in:flow' }],
} })
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

  const key = async (key, modifiers = 0, code = 'KeyF', windowsVirtualKeyCode = 70) => {
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers })
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers })
    await delay(150)
  }
  const until = async predicate => {
    for (let attempt = 0; attempt < 80; attempt++) { if (await predicate()) return; await delay(100) }
    throw Error('Timed out waiting for graph layout')
  }
  const openFunction = async () => {
    await evaluate(`[...document.querySelectorAll('.library-section')].find(s => s.textContent.includes('Functions')).querySelector('.tree-item').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
    await until(() => evaluate(`document.querySelectorAll('.react-flow__node').length === 5 && !!document.querySelector('.react-flow__node[data-id="layout-action"] .react-flow__handle[data-handleid="in:param:message"]')`))
    await delay(200)
  }
  const graphState = () => evaluate(`(() => {
    const transform = document.querySelector('.react-flow__viewport').style.transform;
    const zoom = Number(transform.match(/scale\\(([^)]+)\\)/)[1]);
    const nodes = Object.fromEntries([...document.querySelectorAll('.react-flow__node')].map(node => {
      const position = [...node.style.transform.matchAll(/-?[\\d.]+/g)].map(match => Number(match[0]));
      const rect = node.getBoundingClientRect();
      const pins = Object.fromEntries([...node.querySelectorAll('.react-flow__handle')].map(pin => { const r = pin.getBoundingClientRect(); return [pin.dataset.handleid, { x: (r.x + r.width / 2 - rect.x) / zoom, y: (r.y + r.height / 2 - rect.y) / zoom }]; }));
      return [node.dataset.id, { x: position[0], y: position[1], width: rect.width / zoom, height: rect.height / zoom, pins }];
    }));
    return { transform, nodes, selected: [...document.querySelectorAll('.react-flow__node.selected')].map(node => node.dataset.id), routes: document.querySelectorAll('.route-pin').length };
  })()`)
  const positions = state => Object.fromEntries(Object.entries(state.nodes).map(([id, node]) => [id, { x: node.x, y: node.y }]))
  const clearGraphSelection = async () => {
    const blank = await evaluate(`(() => { const pane = document.querySelector('.react-flow__pane'); const r = pane.getBoundingClientRect(); for (let y = r.top + 40; y < r.bottom - 40; y += 20) for (let x = r.left + 40; x < r.right - 40; x += 20) if (document.elementFromPoint(x, y) === pane) return { x, y }; })()`)
    assert.ok(blank, 'a visible blank pane point is required to clear selection')
    await click(blank)
    await until(() => evaluate(`document.querySelectorAll('.react-flow__node.selected').length === 0`))
  }
  const selectLayoutNode = async id => {
    await clearGraphSelection()
    await click(await point(`.react-flow__node[data-id="${id}"] .node-title`))
    await evaluate(`document.querySelector('.graph-shell').focus()`)
    await until(() => evaluate(`document.querySelectorAll('.react-flow__node.selected').length === 1 && document.querySelector('.react-flow__node[data-id="${id}"]').classList.contains('selected')`))
  }
  await openFunction()
  const unformatted = await graphState()
  const beforeLayoutShot = await command('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(fixture, 'layout-before.png'), Buffer.from(beforeLayoutShot.data, 'base64'))
  await selectLayoutNode('layout-action')
  await key('F', 8)
  assert.deepEqual((await graphState()).nodes, unformatted.nodes, 'Shift+F on one node must not expand its scope')
  await evaluate(`document.querySelector('.details-panel input').focus()`)
  await key('f')
  assert.deepEqual((await graphState()).nodes, unformatted.nodes, 'F in a text field must not arrange nodes')
  await evaluate(`document.querySelector('.graph-shell').focus(); document.querySelector('.graph-shell').dispatchEvent(new KeyboardEvent('keydown', { key: 'f', repeat: true, bubbles: true }))`)
  await delay(100)
  assert.deepEqual((await graphState()).nodes, unformatted.nodes, 'holding F must not submit repeated layouts')
  const selectionBox = await evaluate(`(() => { const e = document.querySelector('.react-flow__node[data-id="layout-event"]').getBoundingClientRect(); const a = document.querySelector('.react-flow__node[data-id="layout-action"]').getBoundingClientRect(); return { from: { x: e.left - 10, y: e.top - 10 }, to: { x: a.right + 10, y: a.bottom + 10 } }; })()`)
  await drag(selectionBox.from, selectionBox.to)
  await until(async () => (await graphState()).selected.length === 2)
  assert.deepEqual((await graphState()).selected.sort(), ['layout-action', 'layout-event'])
  await evaluate(`document.querySelector('.graph-shell').focus()`)
  await key('F', 8)
  const partial = await graphState()
  assert.notEqual(partial.nodes['layout-action'].x, unformatted.nodes['layout-action'].x, 'Shift+F arranges the selected pair')
  for (const id of ['layout-event', 'layout-value', 'layout-next', 'layout-other']) assert.deepEqual(partial.nodes[id], unformatted.nodes[id], 'Shift+F preserves the Event and all unselected nodes')
  assert.equal(partial.routes, 1, 'Shift+F clears the internal route but preserves the unselected parameter boundary route')
  await selectLayoutNode('layout-action')
  await key('f')
  await until(async () => (await graphState()).nodes['layout-value'].x !== unformatted.nodes['layout-value'].x)
  const arranged = await graphState()
  assert.deepEqual(arranged.selected, ['layout-action'], 'arranging preserves selection')
  assert.equal(arranged.transform, unformatted.transform, 'arranging preserves viewport')
  assert.deepEqual(arranged.nodes['layout-event'], unformatted.nodes['layout-event'], 'Event input stays exactly fixed')
  assert.deepEqual(arranged.nodes['layout-other'], unformatted.nodes['layout-other'], 'unrelated node stays fixed')
  assert.equal(arranged.routes, 0, 'internal manual routing pins are cleared')
  const consumer = arranged.nodes['layout-action']
  const parameter = arranged.nodes['layout-value']
  assert.equal(parameter.x, consumer.x, 'one parameter helixes directly below its consumer')
  assert.ok(Math.abs(parameter.y - consumer.y - consumer.height - 25) < 1, 'Helixing uses measured node height')
  const entry = arranged.nodes['layout-event']
  assert.ok(Math.abs(entry.y + entry.pins['out:flow'].y - consumer.y - consumer.pins['in:flow'].y) < 1, 'execution pin centers align')
  const rectangles = Object.values(arranged.nodes)
  for (let i = 0; i < rectangles.length; i++) for (const other of rectangles.slice(i + 1)) {
    const a = rectangles[i]
    assert.ok(a.x + a.width <= other.x + .1 || other.x + other.width <= a.x + .1 || a.y + a.height <= other.y + .1 || other.y + other.height <= a.y + .1, 'rendered node bounds must not overlap')
  }
  await key('f')
  assert.deepEqual((await graphState()).nodes, arranged.nodes, 'repeated F is stable with real measurements')
  await key('s', 2, 'KeyS', 83)
  await until(() => evaluate(`!document.querySelector('.workspace-tab .unsaved-dot')`))
  const saved = JSON.parse(await readFile(path.join(fixture, 'blueprints/builtin/screen-recording.nodrec.json'), 'utf8'))
  assert.equal(saved.nodes.find(node => node.id === 'start').position.x, 0, 'function layout does not overwrite the Events graph')
  for (const node of saved.functions[0].graph.nodes) {
    assert.ok(Math.abs(node.position.x - arranged.nodes[node.id].x) < .02 && Math.abs(node.position.y - arranged.nodes[node.id].y) < .02, 'function layout persists within CSS transform serialization precision')
  }
  assert.ok(saved.functions[0].graph.edges.every(edge => !edge.data?.routePoints?.length))
  await key('f')
  assert.equal(await evaluate(`!!document.querySelector('.workspace-tab .unsaved-dot')`), false, 'reformatting a saved graph must not mark it dirty')
  await clearGraphSelection()
  const emptySelection = await graphState()
  await key('F', 8)
  assert.deepEqual(await graphState(), emptySelection, 'Shift+F without selection is a no-op')
  await key('f')
  assert.deepEqual(positions(await graphState()), positions(arranged), 'F without selection fits view without moving nodes')
  const afterLayoutShot = await command('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(fixture, 'layout-after.png'), Buffer.from(afterLayoutShot.data, 'base64'))
  await command('Page.reload')
  await until(() => evaluate(`!!document.querySelector('.blueprint-select')`))
  await evaluate(`document.querySelector('.blueprint-select').click()`)
  await delay(150)
  await evaluate(`[...document.querySelectorAll('.workspace-tab > button')].find(b => b.textContent === 'Blueprint').click()`)
  await openFunction()
  const reloaded = await graphState()
  for (const id of Object.keys(arranged.nodes)) assert.deepEqual({ x: reloaded.nodes[id].x, y: reloaded.nodes[id].y }, { x: arranged.nodes[id].x, y: arranged.nodes[id].y }, 'saved layout reloads')
  await evaluate(`[...document.querySelectorAll('.library-section .tree-item')].find(item => item.textContent === 'Parameter order').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await until(() => evaluate(`document.querySelectorAll('.react-flow__node').length === 10 && !!document.querySelector('.react-flow__node[data-id="order-encode"] [data-handleid="in:param:encodingMode"]')`))
  await delay(200)
  const beforeOrder = await graphState()
  await selectLayoutNode('order-encode')
  await key('f')
  const sortedParameters = await graphState()
  const pinNames = ['fps', 'resolution', 'bitrate', 'encodingMode']
  assert.deepEqual([...pinNames].sort((a, b) => sortedParameters.nodes[`read-${a}`].y - sortedParameters.nodes[`read-${b}`].y), pinNames, 'left parameters follow Encode input order')
  for (const name of pinNames) {
    const source = sortedParameters.nodes[`read-${name}`]
    assert.ok(sortedParameters.nodes['order-encode'].x - source.x - source.width >= 119.9, 'parameter column has at least 120 units of clearance')
    const encode = sortedParameters.nodes['order-encode']
    assert.ok(source.y >= encode.y + Math.max(encode.pins['in:frames'].y, encode.pins['in:audio'].y, encode.pins['out:video'].y) + 24.9, 'parameter bodies stay below the media pin band')
  }
  const write = sortedParameters.nodes['order-write']
  for (const id of ['order-path', 'read-output', 'read-filename']) assert.ok(sortedParameters.nodes[id].y >= write.y + write.pins['in:video'].y + 24.9, 'the entire Output Path tree stays below the video line')
  for (let i = 1; i < pinNames.length; i++) {
    const previous = sortedParameters.nodes[`read-${pinNames[i - 1]}`]
    assert.ok(sortedParameters.nodes[`read-${pinNames[i]}`].y - previous.y - previous.height >= 39.9, 'parameter rows have 40 units of clearance')
  }
  const crossingFans = await evaluate(`(() => {
    const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const paths = ${JSON.stringify(pinNames)}.map(name => {
      const path = document.querySelector('.react-flow__edge[data-id="order-' + name + '"] .react-flow__edge-path');
      const length = path.getTotalLength(); const points = [];
      for (let d = 0; d < length; d += 3) points.push(path.getPointAtLength(d));
      points.push(path.getPointAtLength(length));
      return points.slice(1).map((p, i) => [points[i], p]);
    });
    const collisions = [];
    for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
      if (paths[i].some(([a, b]) => paths[j].some(([c, d]) => cross(a, b, c) * cross(a, b, d) < -1e-5 && cross(c, d, a) * cross(c, d, b) < -1e-5))) collisions.push([i, j]);
    }
    return collisions;
  })()`)
  assert.deepEqual(crossingFans, [], 'rendered ordered parameter curves do not cross')
  assert.deepEqual(sortedParameters.nodes['order-encode'], beforeOrder.nodes['order-encode'], 'parameter reordering keeps the consumer anchor fixed')
  await key('f')
  assert.deepEqual(positions(await graphState()), positions(sortedParameters), 'parameter order is stable on repeated formatting')
  await selectLayoutNode('order-path')
  await key('f')
  const pathOrder = await graphState()
  assert.ok(pathOrder.nodes['read-output'].y < pathOrder.nodes['read-filename'].y, 'Directory precedes Filename on a pure value consumer')
  assert.deepEqual(pathOrder.nodes['order-path'], sortedParameters.nodes['order-path'], 'pure consumer anchor stays fixed')
  await clearGraphSelection()
  await key('f')
  const orderShot = await command('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(fixture, 'parameter-order.png'), Buffer.from(orderShot.data, 'base64'))
  await evaluate(`[...document.querySelectorAll('.library-section .tree-item')].find(item => item.textContent === 'Branch pins').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await until(() => evaluate(`!!document.querySelector('.react-flow__node[data-id="test-select"] .exec-port')`))
  const branchPins = await evaluate(`(() => {
    const inspect = id => {
      const node = document.querySelector('.react-flow__node[data-id="' + id + '"]');
      const title = node.querySelector('.node-title').getBoundingClientRect();
      const rows = [...node.querySelectorAll('.exec-port')];
      const zoom = Number(document.querySelector('.react-flow__viewport').style.transform.match(/scale\\(([^)]+)\\)/)[1]);
      return { titleInputs: node.querySelectorAll('.node-title .flow-handle.target').length, titleOutputs: node.querySelectorAll('.node-title .flow-handle.source').length,
        labels: rows.map(row => row.textContent.trim()),
        accessibleNames: rows.map(row => row.querySelector('.flow-handle').getAttribute('aria-label')),
        belowTitle: rows.every(row => row.getBoundingClientRect().top >= title.bottom),
        rowHeights: rows.map(row => row.getBoundingClientRect().height / zoom),
        alignedLabels: rows.every(row => { const label = row.querySelector('span').getBoundingClientRect(); const pin = row.querySelector('.flow-handle').getBoundingClientRect(); return Math.abs(label.y + label.height / 2 - pin.y - pin.height / 2) < 1; }),
        connected: rows.map(row => !row.querySelector('.flow-handle').classList.contains('unconnected')) };
    };
    return { branch: inspect('test-branch'), select: inspect('test-select'), singleOutputInTitle: document.querySelectorAll('.react-flow__node[data-id="done-branch"] .node-title .flow-handle.source').length };
  })()`)
  assert.deepEqual(branchPins.branch.labels, ['True', 'False'])
  assert.deepEqual(branchPins.select.labels, ['Selected', 'Cancelled'])
  for (const pins of [branchPins.branch, branchPins.select]) {
    assert.equal(pins.titleInputs, 1)
    assert.equal(pins.titleOutputs, 0)
    assert.equal(pins.belowTitle, true)
    assert.equal(pins.alignedLabels, true)
    assert.deepEqual(pins.accessibleNames, pins.labels)
    assert.ok(pins.rowHeights.every(height => height >= 21.9))
    assert.deepEqual(pins.connected, [true, false])
  }
  assert.equal(branchPins.singleOutputInTitle, 1)
  const branchShot = await command('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(fixture, 'branch-pins.png'), Buffer.from(branchShot.data, 'base64'))
  assert.equal(errors.length, 0, JSON.stringify(errors))
  console.log('PASS: graph interactions; F/Shift+F, measured pin alignment, single-parameter Helixing, fixed Event, stable viewport/selection, no overlaps, internal route reset, function isolation, save/reload; parameter input order, 120/40 spacing and non-crossing SVG fan curves')
} finally {
  socket?.close()
  app.kill()
}


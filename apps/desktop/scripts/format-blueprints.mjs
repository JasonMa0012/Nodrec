import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectedNodeIds } from '../src/graph-interactions.ts'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(desktop, 'blueprints/builtin')
const fixture = path.join(desktop, 'src-tauri/target', `format-blueprints-${Date.now()}`)
const endpoint = 'http://127.0.0.1:9357'
const documents = []
await mkdir(path.join(fixture, 'blueprints/builtin'), { recursive: true })
for (const name of (await readdir(source)).filter(name => name.endsWith('.nodrec.json'))) {
  const document = JSON.parse(await readFile(path.join(source, name), 'utf8'))
  documents.push({ name, document })
  await writeFile(path.join(fixture, 'blueprints/builtin', name), JSON.stringify(document))
}
assert.ok(documents.length, 'No built-in blueprints found')
try { await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(500) }); throw Error('Formatting CDP port is occupied') }
catch (error) { if (error.message === 'Formatting CDP port is occupied') throw error }
const executable = path.join(fixture, 'nodrec-desktop.exe')
await copyFile(path.join(desktop, 'src-tauri/target/release/nodrec-desktop.exe'), executable)
const app = spawn(executable, [], { env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(fixture, 'webview'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9357' }, windowsHide: true, stdio: 'ignore' })
let socket
async function until(check) {
  const end = Date.now() + 45000
  while (Date.now() < end) {
    if (app.exitCode !== null) throw Error(`Formatter app exited: ${app.exitCode}`)
    if (await check()) return
    await delay(100)
  }
  throw Error(`Timed out: ${check}`)
}
try {
  let target
  await until(async () => { try { target = (await (await fetch(`${endpoint}/json/list`)).json()).find(t => t.title === 'Nodrec'); return !!target } catch { return false } })
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', ({ data }) => {
    const result = JSON.parse(data), request = pending.get(result.id)
    if (!request) return
    pending.delete(result.id); clearTimeout(request.timer)
    if (result.error) request.reject(Error(result.error.message)); else request.resolve(result.result)
  })
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id
    pending.set(key, { resolve, reject, timer: setTimeout(() => { pending.delete(key); reject(Error(method)) }, 10000) })
    socket.send(JSON.stringify({ id: key, method, params }))
  })
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
  const key = async (key, code, virtual, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp']) await command('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: virtual, modifiers })
    await delay(300)
  }
  await until(() => evaluate(`!!document.querySelector('.blueprint-select')`))
  for (const { name, document } of documents) {
    await evaluate(`(() => { const buttons = [...document.querySelectorAll('.blueprint-select')].filter(b => b.textContent.trim() === ${JSON.stringify(document.name)}); if (buttons.length !== 1) throw Error('Ambiguous blueprint'); buttons[0].click() })()`)
    await until(() => evaluate(`document.querySelector('.blueprint-nav-item.active .blueprint-name')?.textContent === ${JSON.stringify(document.name)}`))
    await evaluate(`[...document.querySelectorAll('.workspace-tab button')].find(b => b.textContent.trim() === 'Blueprint').click()`)
    for (const graph of document.graphs) {
      if (!graph.nodes.length) continue
      await evaluate(`(() => { const buttons = [...document.querySelectorAll('.tree-item')].filter(b => b.textContent.trim() === ${JSON.stringify(graph.name)}); if (buttons.length !== 1) throw Error('Ambiguous graph'); buttons[0].click() })()`)
      await until(() => evaluate(`document.querySelectorAll('.react-flow__node').length === ${graph.nodes.length}`))
      await delay(500)
      const remaining = new Set(graph.nodes.map(node => node.id))
      while (remaining.size) {
        const nodeId = [...remaining][0]
        for (const member of connectedNodeIds([nodeId], graph.edges)) remaining.delete(member)
        await evaluate(`document.querySelector('.react-flow__node[data-id=${JSON.stringify(nodeId)}] .node-title').dispatchEvent(new MouseEvent('click', { bubbles: true })); document.querySelector('.graph-shell').focus()`)
        await until(() => evaluate(`document.querySelector('.react-flow__node[data-id=${JSON.stringify(nodeId)}]').classList.contains('selected')`))
        await key('f', 'KeyF', 70)
      }
      const positions = await evaluate(`Object.fromEntries([...document.querySelectorAll('.react-flow__node')].map(n => [n.dataset.id, n.style.transform]))`)
      await key('f', 'KeyF', 70)
      assert.deepEqual(await evaluate(`Object.fromEntries([...document.querySelectorAll('.react-flow__node')].map(n => [n.dataset.id, n.style.transform]))`), positions, 'Repeated formatting must be stable')
      const rectangles = await evaluate(`[...document.querySelectorAll('.react-flow__node')].map(n => { const r = n.getBoundingClientRect(); return { id: n.dataset.id, x: r.x, y: r.y, right: r.right, bottom: r.bottom } })`)
      for (let i = 0; i < rectangles.length; i++) for (const b of rectangles.slice(i + 1)) {
        const a = rectangles[i]
        assert.ok(a.right <= b.x + .1 || b.right <= a.x + .1 || a.bottom <= b.y + .1 || b.bottom <= a.y + .1, `${a.id} overlaps ${b.id}`)
      }
    }
    await key('s', 'KeyS', 83, 2)
    await until(() => evaluate(`!document.querySelector('.blueprint-save')`))
    const formatted = JSON.parse(await readFile(path.join(fixture, 'blueprints/builtin', name), 'utf8'))
    for (const graph of document.graphs) {
      const next = formatted.graphs.find(item => item.id === graph.id)
      assert.deepEqual(next.nodes.map(n => n.id), graph.nodes.map(n => n.id))
      assert.deepEqual(next.edges.map(e => [e.id, e.source, e.target, e.sourceHandle, e.targetHandle]), graph.edges.map(e => [e.id, e.source, e.target, e.sourceHandle, e.targetHandle]))
      for (const node of graph.nodes) node.position = next.nodes.find(item => item.id === node.id).position
      for (const edge of graph.edges) if (!next.edges.find(item => item.id === edge.id).data?.routePoints && edge.data) delete edge.data.routePoints
    }
    documents.find(item => item.name === name).output = `${JSON.stringify(document, null, 2)}\n`
    console.log(`Formatted ${name}: ${document.graphs.length} graph(s)`)
  }
  for (const { name, output } of documents) await writeFile(path.join(source, name), output)
} finally {
  socket?.close()
  app.kill()
}

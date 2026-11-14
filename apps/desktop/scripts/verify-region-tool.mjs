import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = path.join(desktop, 'src-tauri/target', `region-check-${Date.now()}`)
const port = 9354
await mkdir(path.join(fixture, 'blueprints/builtin'), { recursive: true })
await copyFile(path.join(desktop, 'src-tauri/target/release/nodrec-desktop.exe'), path.join(fixture, 'nodrec-desktop.exe'))
const document = JSON.parse(await readFile(path.join(desktop, 'blueprints/builtin/screen-recording.nodrec.json'), 'utf8'))
Object.assign(document.values, { output: path.join(fixture, 'recordings'), filename: 'region_{timestamp}.mp4', resolution:'Source Size' })
await writeFile(path.join(fixture, 'blueprints/builtin/screen-recording.nodrec.json'), JSON.stringify(document))
try { await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) }); throw Error('Debugging port is occupied') }
catch (error) { if (error.message === 'Debugging port is occupied') throw error }
const app = spawn(path.join(fixture, 'nodrec-desktop.exe'), [], { windowsHide: true, stdio: 'ignore', env: {
  ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(fixture, 'webview'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
} })
const sockets = []
const until = async (probe, name, timeout = 25000) => {
  const end = Date.now()+timeout
  while (Date.now() < end) { const result = await probe(); if (result) return result; await delay(100) }
  throw Error(`Timed out: ${name}`)
}
const targets = async () => { try { return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() } catch { return [] } }
async function connect(role) {
  const target = await until(async () => (await targets()).find(t => t.type === 'page' && /^(http:\/\/tauri\.localhost|tauri:\/\/localhost)/.test(t.url) && (role === 'main' ? !t.url.includes('regionRole') : t.url.includes(`regionRole=${role}`))), `${role} WebView`)
  const socket = new WebSocket(target.webSocketDebuggerUrl); sockets.push(socket)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let id = 0; const pending = new Map()
  socket.addEventListener('message', ({ data }) => { const m = JSON.parse(data); const p = pending.get(m.id); if (!p) return; pending.delete(m.id); clearTimeout(p.timer); if (m.error) p.reject(Error(m.error.message)); else p.resolve(m.result) })
  const command = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; const timer = setTimeout(() => { pending.delete(key); reject(Error(`CDP timeout ${method}`)) }, 30000); pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params })) })
  const evaluate = async expression => { const r = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); assert.equal(r.exceptionDetails, undefined, JSON.stringify(r.exceptionDetails)); return r.result.value }
  const invoke = (name, args = {}) => evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)},${JSON.stringify(args)})`)
  return { command, evaluate, invoke }
}
let main
try {
  main = await connect('main')
  await until(() => main.evaluate(`!!window.__TAURI_INTERNALS__`), 'Tauri bridge')
  await until(async () => (await main.invoke('runtime_snapshot')).controls.length === document.controls.length, 'blueprint activation')
  await until(async () => (await main.invoke('get_logs')).some(log => log.source === 'system' && log.message.startsWith('GPU 0:')), 'startup GPU diagnostics')
  await main.evaluate('console.warn("logging-regression: frontend warning"); console.error(new Error("logging-regression: stack trace"))')
  await main.evaluate('[...document.querySelectorAll(".titlebar button")].find(button=>button.textContent.trim()==="Record").click()')
  await until(async () => (await main.invoke('get_logs')).some(log => log.message.includes('Command dispatch_node_action failed')), 'command failure forwarded')
  assert.equal(await main.evaluate('document.querySelectorAll(".titlebar [role=alert]").length'),0,'errors do not expand toolbar controls')
  assert.ok(await main.evaluate('!!document.querySelector(".app-notice")'),'command errors remain in the main notification area')
  const startupLogs = await main.invoke('get_logs')
  for (const marker of ['Windows:', 'CPU:', 'RAM:', 'driver=', 'WebView=', 'logging-regression: frontend warning', 'logging-regression: stack trace']) assert.ok(startupLogs.some(log => log.message.includes(marker)), marker)
  const logPath = startupLogs.find(log => log.message.startsWith('Log file: ')).message.slice('Log file: '.length)
  const logFile = await readFile(logPath, 'utf8')
  assert.ok(logFile.includes('logging-regression: frontend warning'))
  assert.ok(logFile.includes('Command dispatch_node_action failed'))
  const select = () => main.invoke('dispatch_node_action', { graphId:'recording', nodeId:document.graphs[0].nodes.find(n=>n.data.kind==='select_region').id, action:'select' })
  await assert.rejects(() => main.invoke('dispatch_node_action', { graphId:'recording', nodeId:'screen', action:'start' }), /Select a region/)
  const initialWidth = await main.evaluate('outerWidth')
  await main.evaluate(`document.querySelector('.titlebar-drag-space').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,detail:2}))`)
  await until(() => main.evaluate(`outerWidth !== ${initialWidth}`), 'title blank double click maximizes')
  await main.evaluate(`document.querySelector('.titlebar-drag-space').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,detail:2}))`)
  await until(() => main.evaluate(`outerWidth === ${initialWidth}`), 'title blank double click restores')
  await select()
  const frame = await connect('frame'); let toolbar = await connect('toolbar')
  await until(() => frame.evaluate(`!!document.querySelector('.region-frame')`), 'picker UI')
  const initialTool = (await main.invoke('region_tool_state')).tool
  const draw = async (x,y,xx,yy,displayIndex=0) => {
    const {tool} = await main.invoke('region_tool_state')
    if (tool.picking) {
      const dpi = await frame.evaluate('devicePixelRatio')
      const display = tool.displays[displayIndex]
      const ox = display.x-tool.desktop.x, oy = display.y-tool.desktop.y
      ;[x,y,xx,yy] = [(ox+x*initialTool.scale)/dpi,(oy+y*initialTool.scale)/dpi,(ox+xx*initialTool.scale)/dpi,(oy+yy*initialTool.scale)/dpi]
    }
    await frame.command('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', clickCount:1 })
    await frame.command('Input.dispatchMouseEvent', { type:'mouseMoved', x:xx, y:yy, button:'left', buttons:1 })
    await frame.command('Input.dispatchMouseEvent', { type:'mouseReleased', x:xx, y:yy, button:'left', clickCount:1 })
  }
  const pickerSize = await frame.evaluate('({width:Math.round(innerWidth*devicePixelRatio),height:Math.round(innerHeight*devicePixelRatio)})')
  assert.ok(Math.abs(pickerSize.width-initialTool.desktop.width)<=2 && Math.abs(pickerSize.height-initialTool.desktop.height)<=2,'picker covers the entire virtual desktop')
  assert.equal(await frame.evaluate('document.querySelectorAll(".region-pick-hint").length'), initialTool.displays.length, 'each display shows selection instructions')
  if (initialTool.displays.length > 1) {
    await draw(100,100,500,300,1)
    const secondary = await until(async()=>{const s=await main.invoke('region_tool_state');return s.tool && !s.tool.picking ? s.tool : null},'secondary display selection')
    assert.equal(secondary.display.id,initialTool.displays[1].id)
    assert.equal(secondary.rect.x,Math.round(100*initialTool.scale))
    await delay(500)
    assert.equal((await main.invoke('region_tool_state')).tool.token,secondary.token,'committing a different display preserves the tool')
    await main.invoke('region_tool_action',{token:secondary.token,action:'reselect',rect:null})
    await until(()=>frame.evaluate(`!!document.querySelector('.region-frame.picking')`),'reselect all displays')
    await assert.rejects(()=>main.invoke('region_tool_action',{token:secondary.token,action:'select',rect:{x:0,y:0,width:initialTool.desktop.width,height:initialTool.desktop.height}}),/single display/)
  }
  await draw(100,100,500,300)
  let state = await until(async () => { const s = await main.invoke('region_tool_state'); return s.tool?.picking === false ? s : null }, 'selection completion')
  const scale = state.tool.scale; let token = state.tool.token
  assert.equal(state.tool.rect.width, Math.round(400*scale))
  assert.equal(state.tool.excluded, true)
  await until(() => frame.evaluate(`!!document.querySelector('.region-frame:not(.picking)')`), 'picker becomes draggable frame')
  await until(() => toolbar.evaluate(`!!document.querySelector('.region-toolbar')`), 'toolbar UI')
  assert.equal(await toolbar.evaluate(`!document.querySelector('[aria-label="Additional blueprint controls"]') && document.querySelectorAll('.region-custom .registered-display').length===2 && document.querySelector('.region-custom').getBoundingClientRect().right <= document.querySelector('[aria-label="More region actions"]').getBoundingClientRect().left`), true, 'status and time appear directly in the toolbar without overflow menu')

  await toolbar.evaluate(`document.querySelector('[aria-label="More region actions"]').click()`)
  await until(() => toolbar.evaluate(`!!document.querySelector('[aria-label="Exclude from capture"]')`), 'capture switch')
  assert.equal(await toolbar.evaluate(`(()=>{const p=document.querySelector('.region-settings'),r=p.getBoundingClientRect();return r.width<280 && r.height<60 && p.querySelectorAll('input').length===1 && !p.querySelector('button,.registered-display,.split-control') && document.querySelector('.region-capture-toggle').getBoundingClientRect().height<40})()`),true,'compact settings dropdown contains only the capture switch')
  assert.equal(await toolbar.evaluate(`(()=>{const label=document.querySelector('.region-capture-toggle'),toggle=label.querySelector('.checkbox-control');return toggle.getBoundingClientRect().right>label.getBoundingClientRect().right-2 && toggle.getBoundingClientRect().left>label.getBoundingClientRect().left+100})()`),true,'capture toggle is right aligned')
  await delay(200)
  const settingsShot = await toolbar.command('Page.captureScreenshot',{format:'png'})
  await writeFile(path.join(fixture,'settings.png'),Buffer.from(settingsShot.data,'base64'))

  await toolbar.evaluate(`document.querySelector('[aria-label="Exclude from capture"]').click()`)
  await until(async () => { const s = await main.invoke('region_tool_state'); return !s.tool.captureExclusion && !s.tool.excluded }, 'capture exclusion disabled')
  await main.invoke('region_tool_action', { token, action:'hide', rect:null })
  await main.invoke('region_tool_action', { token, action:'show', rect:null })
  assert.equal((await main.invoke('region_tool_state')).tool.captureExclusion, false)
  await until(() => toolbar.evaluate(`!document.querySelector('.region-settings')`), 'hide dismisses dropdown')
  await toolbar.evaluate(`document.querySelector('[aria-label="More region actions"]').click()`)
  await until(() => toolbar.evaluate(`!!document.querySelector('[aria-label="Exclude from capture"]')`), 'reopen capture dropdown')
  await toolbar.evaluate(`document.querySelector('[aria-label="Exclude from capture"]').click()`)
  await until(async () => { const s = await main.invoke('region_tool_state'); return s.tool.captureExclusion && s.tool.excluded }, 'capture exclusion enabled')
  await toolbar.evaluate(`document.querySelector('[aria-label="More region actions"]').click()`)
  assert.equal(await frame.evaluate(`(()=>{const h=document.querySelector('.region-handle'),o=document.querySelector('.region-outline'),r=h.getBoundingClientRect(),b=o.getBoundingClientRect(),c=getComputedStyle(o);return getComputedStyle(h).borderRadius==='50%' && c.outlineStyle==='dashed' && Math.abs(parseFloat(c.outlineWidth)-3)<0.5 && Math.abs(parseFloat(c.outlineOffset)+1.5)<0.5 && Math.abs(r.x+r.width/2-b.x)<0.5 && Math.abs(r.y+r.height/2-b.y)<0.5})()`), true)

  await until(() => main.evaluate(`document.querySelector('.titlebar-recording-actions').textContent.includes('Record')`), 'registered main time')
  const before = state.tool.rect
  await draw(140,100,160,115)
  state = await until(async () => { const s = await main.invoke('region_tool_state'); return s.tool?.rect.x !== before.x ? s : null }, 'border move')
  assert.equal(state.tool.rect.width, before.width)
  assert.equal(state.tool.rect.height, before.height)
  const moved = state.tool.rect
  await until(() => frame.evaluate(`Math.round(parseFloat(document.querySelector('.region-outline').style.left)*${scale}) === ${moved.x}`), 'frame move render')
  await draw((moved.x+moved.width)/scale,(moved.y+moved.height)/scale,(moved.x+moved.width)/scale+30,(moved.y+moved.height)/scale+20)
  state = await until(async () => { const s = await main.invoke('region_tool_state'); return s.tool?.rect.width > moved.width ? s : null }, 'round handle resize')
  await toolbar.evaluate(`document.querySelector('[aria-label="Region size"]').click()`)
  await until(() => toolbar.evaluate(`!!document.querySelector('[aria-label="Region width"]')`), 'size menu')
  await toolbar.evaluate(`document.querySelector('[aria-label="Region size"]').click()`)
  await main.invoke('region_tool_action',{token,action:'change',rect:{x:200,y:300,width:1280,height:720}})
  await delay(300)
  const toolbarY = () => toolbar.evaluate(`window.screenY + document.querySelector('.region-toolbar').getBoundingClientRect().top`)
  const anchorY = await toolbarY()
  const stableWindow = await toolbar.evaluate('[screenX,screenY,innerWidth,innerHeight]')
  await toolbar.evaluate(`document.querySelector('[aria-label="Region size"]').click()`)
  await delay(300)
  assert.ok(Math.abs(await toolbarY()-anchorY)<1,'opening size panel preserves toolbar anchor')
  assert.deepEqual(await toolbar.evaluate('[screenX,screenY,innerWidth,innerHeight]'),stableWindow,'opening panel keeps native bounds stable')
  assert.equal(await toolbar.evaluate(`(() => {const r=document.querySelector('.region-popup').getBoundingClientRect();const top=(screenY+r.top)*${scale},bottom=(screenY+r.bottom)*${scale};return r.height>180 && top>=${state.tool.work.y} && bottom<=${state.tool.work.y+state.tool.work.height}})()`),true,'fields panel has usable height and stays inside the work area')
  assert.equal(await toolbar.evaluate(`document.querySelectorAll('.region-popup .region-field-grid input').length`),8)
  assert.equal(await toolbar.evaluate(`(() => {const p=document.querySelector('.region-popup').getBoundingClientRect(),t=document.querySelector('.region-toolbar').getBoundingClientRect();return p.bottom<=t.top || p.top>=t.bottom})()`),true,'panel does not cover toolbar')
  await toolbar.evaluate(`const select=document.querySelector('[aria-label="Region units"]');select.value='%';select.dispatchEvent(new Event('change',{bubbles:true}))`)
  assert.ok(Math.abs(await toolbar.evaluate(`Number(document.querySelector('[aria-label="Region width"]').value)`)-1280/state.tool.display.width*100)<0.001)
  await delay(1100)
  assert.equal(await toolbar.evaluate(`document.querySelector('[aria-label="Region units"]').value`),'%','polling preserves field editing state')
  await toolbar.evaluate(`Array.from(document.querySelectorAll('.region-popup button')).find(b=>b.textContent.includes('Lock aspect ratio')).click()`)
  await until(async () => (await main.invoke('region_tool_state')).tool.aspectRatio > 0, 'aspect lock reaches the native frame session')
  await toolbar.evaluate(`Array.from(document.querySelectorAll('.region-popup button')).find(b=>b.textContent.includes('Lock aspect ratio')).click()`)
  await until(async () => (await main.invoke('region_tool_state')).tool.aspectRatio === 0, 'aspect unlock reaches the native frame session')
  const sizeShot = await toolbar.command('Page.captureScreenshot',{format:'png'})
  await writeFile(path.join(fixture,'region-fields.png'),Buffer.from(sizeShot.data,'base64'))
  await toolbar.evaluate(`document.querySelector('.region-popup form').requestSubmit()`)
  await delay(300)
  assert.ok(Math.abs(await toolbarY()-anchorY)<1,'applying size preserves toolbar anchor')
  await toolbar.evaluate(`document.querySelector('[aria-label="Region size"]').click()`)
  await main.invoke('region_tool_action',{token,action:'change',rect:{x:200,y:state.tool.display.height-100,width:1280,height:100}})
  await delay(300)
  const bottomAnchor = await toolbarY()
  await toolbar.evaluate(`document.querySelector('[aria-label="Region size"]').click()`)
  await delay(300)
  assert.ok(Math.abs(await toolbarY()-bottomAnchor)<1,'upward panel preserves toolbar anchor')
  assert.equal(await toolbar.evaluate(`document.querySelector('.region-toolbar-window').classList.contains('popups-up') && document.querySelector('.region-popup').getBoundingClientRect().bottom<=document.querySelector('.region-toolbar').getBoundingClientRect().top`),true,'panel opens above near bottom edge')
  await toolbar.evaluate(`document.querySelector('[aria-label="Region size"]').click()`)
  await main.invoke('region_tool_action', { token, action:'hide', rect:null })
  assert.equal((await main.invoke('region_tool_state')).tool.visible,false)
  await main.invoke('region_tool_action', { token, action:'show', rect:null })
  assert.equal((await main.invoke('region_tool_state')).runtime.controls.length,document.controls.length)
  await assert.rejects(() => main.invoke('region_tool_action', { token:'stale', action:'show', rect:null }), /expired/)
  // A known solid application surface underneath the floating toolbar proves capture exclusion.
  await main.evaluate(`document.querySelector('[aria-label="Maximize"]').click()`)
  await delay(300)
  await main.evaluate(`(()=>{const marker=document.createElement('div');marker.id='capture-exclusion-marker';Object.assign(marker.style,{position:'fixed',inset:'0',zIndex:'999999',background:'#203040'});document.body.append(marker)})()`)
  await main.command('Page.bringToFront')
  const markerShot = await main.command('Page.captureScreenshot',{format:'png'})
  await writeFile(path.join(fixture,'marker.png'),Buffer.from(markerShot.data,'base64'))
  await main.invoke('region_tool_action', { token, action:'change', rect:{ x:0,y:0,width:state.tool.display.width,height:state.tool.display.height } })
  if (process.env.NODREC_REGION_NATIVE_FOCUS === '1') {
    console.log(`Awaiting native focus: ${fixture}`)
    await until(async()=>{try{return await readFile(path.join(fixture,'native-focus.done'),'utf8')}catch{return null}},'native test window focus',180000)
  }
  await toolbar.invoke('region_tool_node_action', { token, controlId:'start-recording', action:'start' })
  await until(async () => { const s = await main.invoke('runtime_snapshot'); if (s.error) throw Error(s.error); return s.status === 'recording' }, 'native recording startup')
  await assert.rejects(() => main.invoke('region_tool_action', { token, action:'change', rect:{ x:1,y:1,width:800,height:450 } }), /Stop recording/)
  assert.equal(await toolbar.evaluate(`document.querySelectorAll('[aria-label="Recording time"]').length`),1)
  await delay(1200)
  await toolbar.invoke('region_tool_node_action', { token, controlId:'start-recording', action:'pause' })
  await until(async () => (await main.invoke('runtime_snapshot')).status === 'paused', 'pause')
  await delay(600)
  const paused = await main.invoke('runtime_snapshot'); await delay(1100)
  assert.equal((await main.invoke('runtime_snapshot')).recording.durationMs,paused.recording.durationMs)
  assert.equal(await toolbar.evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Resume')`),true)
  await toolbar.invoke('region_tool_node_action', { token, controlId:'start-recording', action:'resume' })
  await until(async () => (await main.invoke('runtime_snapshot')).status === 'recording', 'resume')
  await delay(700)
  await toolbar.invoke('region_tool_node_action', { token, controlId:'start-recording', action:'stop' })
  const stopped = await until(async () => { const s = await main.invoke('runtime_snapshot'); return s.status === 'ready' && s.recording?.finished ? s : null }, 'stop')
  assert.ok(stopped.recording.durationMs > paused.recording.durationMs)
  const recordingLogs = await main.invoke('get_logs')
  for (const marker of ['H.264 setup | mode=Hardware Auto', 'Hardware candidates:', 'Candidate:', 'CBR rate control', 'H.264 output type', 'NV12 input type', 'Selected:', 'Session finished']) assert.ok(recordingLogs.some(log => log.message.includes(marker)), marker)
  assert.ok(recordingLogs.every((log,index) => index === 0 || log.sequence > recordingLogs[index-1].sequence))
  const decoder = path.join(desktop,'src-tauri/target/release/examples/recording-smoke.exe')
  const decoded = await promisify(execFile)(decoder,['verify',stopped.recording.outputPath])
  assert.match(decoded.stdout,new RegExp(`Decoded H.264 MP4 ${state.tool.display.width}x${state.tool.display.height}`))
  const bmp = await readFile(`${stopped.recording.outputPath}.sample.bmp`)
  const pixelOffset = bmp.readUInt32LE(10), videoWidth = bmp.readUInt32LE(18)
  const calibration = pixelOffset+4*(Math.round(state.tool.display.height*0.6)*videoWidth+Math.round(state.tool.display.width*0.6))
  assert.ok(bmp[calibration]+bmp[calibration+1]+bmp[calibration+2]>0,'Native capture calibration is black: wake the display with real input, focus the test window, and rerun; a CDP render alone is insufficient')
  // The dock is inside the full-screen selection at y=8 logical px; sample a grid across it.
  const ratio = 1
  const offsetX = 0, offsetY = 0
  const logicalWidth = Math.min(760,state.tool.work.width/scale-16)
  const dockX = Math.max(state.tool.work.x+8*scale,(state.tool.display.width-logicalWidth*scale)/2)
  let checked = 0
  for (let lx=20;lx<logicalWidth-20;lx+=20) for(let ly=14;ly<44;ly+=8) {
    const x = Math.round(offsetX+(dockX+lx*scale)*ratio), y = Math.round(offsetY+(8*scale+ly*scale)*ratio)
    const index = pixelOffset+4*(y*videoWidth+x)
    const b=bmp[index],g=bmp[index+1],r=bmp[index+2]
    assert.ok(Math.abs(r-32)<12&&Math.abs(g-48)<12&&Math.abs(b-64)<12,`Overlay entered capture at ${x},${y}: ${r},${g},${b}`)
    checked++
  }
  await main.evaluate(`document.querySelector('#capture-exclusion-marker').remove()`)
  const capture = await toolbar.command('Page.captureScreenshot', { format:'png' })
  await writeFile(path.join(fixture,'toolbar.png'), Buffer.from(capture.data,'base64'))
  assert.equal(await toolbar.evaluate(`document.querySelector('[aria-label="Recording time"]').textContent`), '00:00:00')
  assert.equal(await main.evaluate(`document.querySelector('.titlebar [aria-label="Recording time"]').textContent`), '00:00:00')
  await toolbar.invoke('region_tool_node_action', { token, controlId:'start-recording', action:'start' })
  await until(async () => (await main.invoke('runtime_snapshot')).status === 'recording', 'record before closing tool')
  await delay(1100)
  await toolbar.evaluate(`document.querySelector('[aria-label="Close region tool"]').click()`)
  const closed = await until(async () => { const s = await main.invoke('region_tool_state'); return !s.tool && s.runtime.status === 'ready' && s.runtime.recording?.finished ? s.runtime : null }, 'close stops and finalizes recording')
  assert.equal(closed.error, null)
  await until(() => main.evaluate(`document.querySelector('.titlebar [aria-label="Recording time"]').textContent === "00:00:00"`), 'clock reset after closing')
  const closedDecoded = await promisify(execFile)(decoder,['verify',closed.recording.outputPath])
  assert.match(closedDecoded.stdout,/Decoded H.264 MP4/)
  await select()
  const reopened = await main.invoke('region_tool_state')
  token = reopened.tool.token
  assert.equal(reopened.tool.picking,true,'Select region always dims the desktop')
  await main.invoke('region_tool_action', { token, action:'cancel', rect:null })
  toolbar = await connect('toolbar')
  await until(() => toolbar.evaluate(`!!document.querySelector(".region-toolbar")`), 'toolbar after closing recording')
  await toolbar.invoke('region_tool_node_action', { token, controlId:'start-recording', action:'start' })
  await until(async () => (await main.invoke('runtime_snapshot')).status === 'recording', 'record before native window close')
  await delay(400)
  await toolbar.invoke('region_tool_node_action', { token, controlId:'start-recording', action:'pause' })
  await until(async () => (await main.invoke('runtime_snapshot')).status === 'paused', 'pause before native window close')
  await main.invoke('plugin:window|close', {label:'region-toolbar'})
  const nativeClosed = await until(async () => { const s = await main.invoke('region_tool_state'); return !s.tool && s.runtime.status === 'ready' && s.runtime.recording?.finished ? s.runtime : null }, 'native close stops paused recording')
  assert.equal(nativeClosed.error,null)
  const nativeClosedDecoded = await promisify(execFile)(decoder,['verify',nativeClosed.recording.outputPath])
  assert.match(nativeClosedDecoded.stdout,/Decoded H.264 MP4/)
  await select()
  token = (await main.invoke('region_tool_state')).tool.token
  await main.invoke('region_tool_action', { token, action:'cancel', rect:null })
  toolbar = await connect('toolbar')
  await until(() => toolbar.evaluate('!!document.querySelector(".region-toolbar")'), 'toolbar after native window close')
  const noUI = structuredClone(document)
  noUI.controls = []; noUI.displays = []; noUI.controlOrder = Object.fromEntries(Object.keys(noUI.controlOrder).map(key=>[key,[]]))
  const uiOnlyActivation = await main.invoke('activate_blueprint', { document:noUI })
  assert.deepEqual(uiOnlyActivation.diagnostics,[])
  assert.equal((await main.invoke('region_tool_state')).tool.token,token,'UI registration changes must preserve the selected region session')
  await until(()=> toolbar.evaluate(`document.querySelectorAll('.split-control,.registered-display').length === 0`),'live removal of registered UI')
  noUI.id = 'region-standalone-test'
  const activation = await main.invoke('activate_blueprint', { document:noUI })
  assert.deepEqual(activation.diagnostics,[])
  await select()
  const emptyFrame = await connect('frame')
  await until(() => emptyFrame.evaluate(`!!document.querySelector('.region-frame')`), 'standalone region picker')
  await emptyFrame.evaluate(`document.querySelector('.region-frame').focus()`)
  await emptyFrame.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await until(async()=> !(await main.invoke('region_tool_state')).tool?.picking,'cancelled picker')
  await select()
  await until(async()=> (await main.invoke('region_tool_state')).tool?.picking,'reopen cancelled picker')
  const emptyState = await main.invoke('region_tool_state')
  await main.invoke('region_tool_action', { token:emptyState.tool.token, action:'select', rect:{x:100+emptyState.tool.display.x-emptyState.tool.desktop.x,y:100+emptyState.tool.display.y-emptyState.tool.desktop.y,width:600,height:300} })
  await until(async()=> !(await main.invoke('region_tool_state')).tool?.picking,'selected region')
  const emptyToolbar = await connect('toolbar')
  await until(() => emptyToolbar.evaluate(`!!document.querySelector('.region-toolbar')`), 'standalone toolbar')
  assert.equal(await emptyToolbar.evaluate(`document.querySelectorAll('.split-control,.registered-display').length`),0)
  const native = await promisify(execFile)(path.join(desktop,'src-tauri/target/release/examples/region-window-probe.exe'),[String(app.pid),String(emptyState.tool.display.x),String(emptyState.tool.display.y),'100','100','600','300'])
  console.log(native.stdout.trim())
  await emptyToolbar.evaluate(`document.querySelector('[aria-label="Close region tool"]').click()`)
  await until(async()=> (await main.invoke('region_tool_state')).tool === null,'close destroys the tool session')
  assert.equal(await main.evaluate(`!!document.querySelector('.region-restore') || document.body.textContent.includes('Show region tool')`),false)
  await select()
  await until(async()=> {const s=await main.invoke('region_tool_state'); return s.tool && s.tool.token!==emptyState.tool.token && s.tool.rect?.width===600 && s.tool.picking},'selection node dims desktop while retaining remembered region for cancel')

  const initialSelection = structuredClone(noUI)
  initialSelection.id = 'region-initial-test'
  const selectNode = initialSelection.graphs[0].nodes.find(node => node.data.kind === 'select_region')
  selectNode.data.config.initialRegion = { display:emptyState.tool.display.id, x:100, y:100, width:600, height:300 }
  assert.deepEqual((await main.invoke('activate_blueprint',{document:initialSelection})).diagnostics,[])
  await select()
  await until(async()=> {const s=await main.invoke('region_tool_state'); return s.tool?.rect?.width===600 && s.tool.picking},'valid initial region is retained while selecting again')
  initialSelection.id = 'region-invalid-initial-test'
  selectNode.data.config.initialRegion.width = 15
  assert.deepEqual((await main.invoke('activate_blueprint',{document:initialSelection})).diagnostics,[])
  await select()
  await until(async()=> {const s=await main.invoke('region_tool_state'); return s.tool?.picking && s.tool.rect===null},'invalid initial region falls back to picker')
  await main.evaluate('for(let index=0;index<305;index++)console.debug("logging-retention-"+index); [...document.querySelectorAll("button")].find(button=>button.textContent.trim()==="Logs").click()')
  await until(() => main.evaluate('document.querySelector(".logs-window-list")?.textContent.includes("logging-retention-304")'), 'logs window receives all entries')
  const logWindowText = await main.evaluate('document.querySelector(".logs-window-list").textContent')
  assert.ok(logWindowText.includes('logging-retention-0'))
  assert.ok(logWindowText.includes('Windows:'))
  assert.ok(logWindowText.includes('logging-regression: frontend warning'))
  assert.ok((await main.invoke('get_logs')).some(log => log.message.includes('logging-regression: frontend warning')), 'switching blueprints preserves application logs')
  console.log(JSON.stringify({fixture, logPath, output:stopped.recording.outputPath, stats:stopped.recording, captureExclusionSamples:checked, decoded:decoded.stdout, checks:'virtual desktop overlay, secondary display auto-selection, cross-display rejection, errors outside controls, unified startup, console, command, disk and encoder diagnostics, selection, border move, round handle resize, centered dashed outline, capture exclusion toggle, compact dropdown, close and reopen, valid region restore, invalid region picker fallback, size menu, stale session, hide/restore, shared controls, native recording, locking, single timer, clock reset, close while recording finalizes MP4, native close while paused finalizes MP4, pause clock, standalone tool'},null,2))
  if (process.env.NODREC_REGION_KEEP_OPEN === '1') { console.log(`Keeping test application open for native UI inspection: ${app.pid}`); await delay(120000) }
} catch (error) {
  console.error(JSON.stringify({ targets: (await targets()).map(t=>t.url), state: main ? await main.invoke('region_tool_state').then(s=>({tool:s.tool,error:s.runtime.error})).catch(()=>null) : null },null,2))
  throw error
} finally {
  sockets.forEach(socket => socket.close())
  app.kill()
}

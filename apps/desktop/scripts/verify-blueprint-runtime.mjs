import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = path.join(desktop,'src-tauri/target',`blueprint-v2-check-${Date.now()}`)
await mkdir(path.join(fixture,'blueprints/builtin'),{recursive:true})
const executable = path.join(fixture,'nodrec-desktop.exe')
await copyFile(path.join(desktop,'src-tauri/target/release/nodrec-desktop.exe'),executable)
for (const name of ['screen-recording','operation-recording']) await copyFile(path.join(desktop,`blueprints/builtin/${name}.nodrec.json`),path.join(fixture,`blueprints/builtin/${name}.nodrec.json`))
const stored = path.join(fixture,'blueprints/builtin/screen-recording.nodrec.json')
const document = JSON.parse(await readFile(stored,'utf8'))
document.graphs[0].id = 'custom-recording-graph'
document.graphs[0].name = 'Custom Recording Graph'
document.controls.forEach(control=>{control.binding.graphId='custom-recording-graph'})
document.displays.forEach(display=>{display.binding.graphId='custom-recording-graph'})
const secondGraph=structuredClone(document.graphs[0])
secondGraph.id='second-graph';secondGraph.name='Second Graph'
for(const node of secondGraph.nodes){if(node.data.config?.toolId)node.data.config.toolId='second-capture-region';if(node.data.kind==='encode_media_foundation')node.data.config.resolution='1920 × 1080'}
secondGraph.edges=secondGraph.edges.filter(edge=>!(edge.target==='encode_media_foundation'&&edge.targetHandle==='in:param:resolution'))
document.graphs.push(secondGraph)
for(const id of ['unused-a','unused-b']) document.graphs[0].nodes.push({id,type:'make_integer',position:{x:3000,y:id==='unused-a'?100:500},data:{kind:'make_integer',label:id,config:{value:30}}})
for(const [source,target] of [['unused-a','unused-b'],['unused-b','unused-a']]) document.graphs[0].edges.push({id:`${source}-${target}`,source,sourceHandle:'out:value',target,targetHandle:'in:param:value'})
Object.assign(document.values,{output:path.join(fixture,'recordings'),regionMode:'Rectangle',width:897,height:360})
await writeFile(stored,JSON.stringify(document))
const localDocument=structuredClone(document)
localDocument.id='local-inline';localDocument.name='Local inline'
localDocument.graphs=[structuredClone(document.graphs[0])]
localDocument.graphs[0].nodes=localDocument.graphs[0].nodes.filter(node=>['screen','encode_media_foundation','write'].includes(node.data.kind))
localDocument.graphs[0].edges=localDocument.graphs[0].edges.filter(edge=>['in:frames','in:video'].includes(edge.targetHandle))
localDocument.graphs[0].nodes.find(node=>node.data.kind==='screen').data.config.region={display:'Display 1',mode:'Rectangle',x:100,y:100,width:640,height:480}
localDocument.graphs[0].nodes.find(node=>node.data.kind==='write').data.config.path={directory:path.join(fixture,'local-recordings'),filename:'local_{timestamp}.mp4'}
localDocument.controls=localDocument.controls.filter(control=>control.id==='start-recording').map(control=>({...control,targets:['main']}))
localDocument.displays=[];localDocument.controlOrder={main:['start-recording']}
await writeFile(path.join(fixture,'blueprints/builtin/local-inline.nodrec.json'),JSON.stringify(localDocument))
const port = Number(process.env.NODREC_CDP_PORT ?? 9332)
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535)
const endpoint = `http://127.0.0.1:${port}`
let occupied = false
try { occupied = (await fetch(`${endpoint}/json/list`,{signal:AbortSignal.timeout(500)})).ok } catch {}
assert.equal(occupied,false,'CDP port must be unused')
const app = spawn(executable,[],{env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:path.join(fixture,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`},stdio:'pipe',windowsHide:true})
let output = '',socket
const auxiliarySockets=[]
app.stdout.on('data',chunk=>output+=chunk); app.stderr.on('data',chunk=>output+=chunk)
async function until(check,timeout=15000) { const end=Date.now()+timeout; while(Date.now()<end){if(await check())return;await delay(75)}throw Error(`Timed out: ${check}\n${output}`) }
try {
  let target
  await until(async()=>{if(app.exitCode!==null)throw Error(`App exited: ${output}`);try{target=(await(await fetch(`${endpoint}/json/list`)).json()).find(item=>item.type==='page'&&item.title==='Nodrec'&&item.webSocketDebuggerUrl);return !!target}catch{return false}},45000)
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
  const pending=new Map();let id=0
  socket.addEventListener('message',({data})=>{const response=JSON.parse(data);const request=pending.get(response.id);if(!request)return;pending.delete(response.id);clearTimeout(request.timer);if(response.error)request.reject(Error(response.error.message));else request.resolve(response.result)})
  const command=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject,timer:setTimeout(()=>{pending.delete(key);reject(Error(`CDP timeout: ${method}`))},15000)});socket.send(JSON.stringify({id:key,method,params}))})
  const evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value}
  const runtime=()=>evaluate(`window.__TAURI_INTERNALS__.invoke('runtime_snapshot')`)
  const state=async value=>(await runtime()).status===value
  const click=async(selector,label)=>{let point;await until(async()=>{point=await evaluate(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)return null;const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);return !!point});await command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});await command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1})}
  const key=async(key,code,virtual,modifiers=0)=>{await command('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtual,modifiers});await command('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtual,modifiers})}
  const connectTool=async role=>{
    let target
    await until(async()=>{target=(await(await fetch(`${endpoint}/json/list`)).json()).find(item=>item.url.includes(`regionRole=${role}`));return !!target})
    const socket=new WebSocket(target.webSocketDebuggerUrl);auxiliarySockets.push(socket)
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
    const pending=new Map();let id=0
    socket.addEventListener('message',({data})=>{const response=JSON.parse(data),request=pending.get(response.id);if(!request)return;pending.delete(response.id);clearTimeout(request.timer);if(response.error)request.reject(Error(response.error.message));else request.resolve(response.result)})
    const command=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject,timer:setTimeout(()=>{pending.delete(key);reject(Error(`CDP timeout: ${method}`))},15000)});socket.send(JSON.stringify({id:key,method,params}))})
    const evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value}
    return {command,evaluate}
  }
  await until(async()=>evaluate(`!!document.querySelector('.overview-page')`))
  const displays=await evaluate(`window.__TAURI_INTERNALS__.invoke('list_displays')`)
  document.values.display=displays[0].id
  localDocument.graphs[0].nodes.find(node=>node.data.kind==='screen').data.config.region.display=displays[0].id
  await writeFile(path.join(fixture,'blueprints/builtin/local-inline.nodrec.json'),JSON.stringify(localDocument))
  await writeFile(stored,JSON.stringify(document))
  await command('Page.reload'); await delay(250)
  await until(async()=>evaluate(`!!document.querySelector('.overview-page')`))
  assert.equal(await evaluate(`document.querySelector('.workspace-tab.active button').textContent.trim()`),'Overview')
  await until(()=>evaluate(`document.querySelectorAll('.titlebar .control-shortcut').length===4`))
  assert.equal(await evaluate(`document.querySelectorAll('.titlebar [aria-label="Workflow status"],.titlebar [aria-label="Recording time"]').length`),2,'Overview initializes status and elapsed displays before visiting Blueprint')
  const dropdownStyles = await evaluate(`[...document.querySelectorAll('select')].map(select=>{const style=getComputedStyle(select);return {appearance:style.appearance,padding:style.paddingRight,position:style.backgroundPosition,image:style.backgroundImage}})`)
  assert.ok(dropdownStyles.length>=5)
  for(const style of dropdownStyles){assert.equal(style.appearance,'none');assert.equal(style.padding,'32px');assert.match(style.position,/10px/);assert.match(style.image,/svg/)}

  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.workspace-tab > button:first-child')].map(b=>b.textContent.trim())`),['Overview','Blueprint'])
  assert.equal(await evaluate(`!!document.querySelector('footer,.statusbar,.status-bar,.action-grip-slot:not([inert]) .action-drag-handle')`),false)
  assert.equal(await evaluate(`document.querySelectorAll('.workspace-tab button').length`),2,'core tabs cannot close')
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]})
  await evaluate(`(() => {
    const elements = [...document.querySelectorAll('.titlebar .control-shortcut, .titlebar .control-shortcut .button, .titlebar .registered-display')]
    const state = window.__toolbarAnimation = {running:true,samples:[],detached:false}
    const sample = () => {
      if (!state.running) return
      const bar = document.querySelector('.titlebar-recording-actions')
      const grip = bar.querySelector('.action-grip-slot')
      const status = bar.querySelector('.read-only-shortcut')
      state.detached ||= elements.some(element=>!element.isConnected)
      state.samples.push({width:bar.getBoundingClientRect().width,grip:grip.getBoundingClientRect().width,border:parseFloat(getComputedStyle(status).borderTopWidth),background:getComputedStyle(status).backgroundColor})
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })()`)
  const toolbarAnimation = []
  for (let cycle = 0; cycle < 4; cycle++) {
    for (const tab of ['Blueprint','Overview']) {
      await evaluate('window.__toolbarAnimation.samples=[]')
      await click('.workspace-tab button',tab)
      await until(() => evaluate(`document.querySelector('.workspace-tab.active button').textContent.trim()===${JSON.stringify(tab)}`))
      await delay(260)
      const samples = await evaluate('window.__toolbarAnimation.samples')
      assert.ok(samples.some(sample=>sample.grip>0.1&&sample.grip<21.9),'grip space animates through intermediate widths')
      assert.ok(samples.some(sample=>sample.background.startsWith('rgba(')&&sample.background!=='rgba(0, 0, 0, 0)'), 'read-only chrome fades during the transition')
      const last = samples.at(-1)
      assert.equal(last.grip,tab==='Blueprint'?22:0,'Overview leaves no handle space')
      if(tab==='Blueprint')assert.ok(last.border>0&&last.border<=1,'Blueprint shows the editing border at the current DPI')
      else assert.equal(last.border,0,'Overview read-only displays have no border')
      if(tab==='Overview')assert.equal(last.background,'rgba(0, 0, 0, 0)')
      toolbarAnimation.push({tab,frames:samples.length,start:samples[0],end:last})
    }
  }
  for (const tab of ['Blueprint','Overview','Blueprint','Overview']) {
    await click('.workspace-tab button',tab)
    await delay(50)
  }
  await delay(220)
  assert.equal(await evaluate('document.querySelector(".titlebar .action-grip-slot").getBoundingClientRect().width'),0,'rapid reversal finishes without leftover handle space')
  assert.equal(await evaluate('window.__toolbarAnimation.detached'),false,'tab switching preserves control DOM identity')
  await evaluate('window.__toolbarAnimation.running=false')
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await click('.workspace-tab button','Blueprint')
  await delay(50)
  assert.equal(await evaluate('document.querySelector(".titlebar .action-grip-slot").getBoundingClientRect().width'),22)
  await click('.workspace-tab button','Overview')
  await delay(50)
  assert.equal(await evaluate('document.querySelector(".titlebar .action-grip-slot").getBoundingClientRect().width'),0)
  await command('Emulation.setEmulatedMedia',{features:[]})
  await click('.workspace-tab button','Blueprint')
  await until(()=>evaluate(`!!document.querySelector('.react-flow__node[data-id="screen"] .action-drag-handle')`))
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.library-section:first-child .tree-item')].map(b=>b.textContent.trim())`),['Custom Recording Graph','Second Graph'])
  await delay(220)
  const integratedControls=await evaluate(`[...document.querySelectorAll('.action-control')].filter(item=>item.querySelector('.action-drag-handle')).map(item=>{const grip=item.querySelector('.action-drag-handle'),content=item.querySelector('.button,.registered-display'),box=item.getBoundingClientRect(),g=grip.getBoundingClientRect(),c=content.getBoundingClientRect();return {border:parseFloat(getComputedStyle(item).borderTopWidth),gripBorder:parseFloat(getComputedStyle(grip).borderTopWidth),gripBackground:getComputedStyle(grip).backgroundColor,sameColor:getComputedStyle(grip).color===getComputedStyle(content).color,encloses:box.left<=g.left&&box.right>=c.right,joined:Math.abs(g.right-c.left)<1}})`)
  assert.ok(integratedControls.length>=7)
  for(const item of integratedControls) {
    assert.ok(item.border>0&&item.gripBorder===0&&item.sameColor&&item.encloses&&item.joined,JSON.stringify(item))
    assert.equal(item.gripBackground,'rgba(0, 0, 0, 0)')
  }
  const shortcutLabels=()=>evaluate(`[...document.querySelectorAll('.titlebar .control-shortcut .button')].map(b=>b.textContent.trim())`)
  const removeRecord=async()=>{
    await evaluate(`document.querySelector('.titlebar [aria-label="Remove Record shortcut"]').click()`)
    await until(async()=>!(await shortcutLabels()).includes('Record'))
    assert.equal(await evaluate(`!!document.querySelector('.react-flow__node[data-id="screen"]')`),true,'removing a shortcut must preserve its node')
  }
  const drag=async(sourceSelector,destinationSelector,after=true)=>{
    const points=await evaluate(`(()=>{const a=document.querySelector(${JSON.stringify(sourceSelector)}).getBoundingClientRect(),b=document.querySelector(${JSON.stringify(destinationSelector)}).getBoundingClientRect();return {from:{x:a.x+a.width/2,y:a.y+a.height/2},to:{x:${after} ? b.right-5 : b.left+5,y:b.y+b.height/2}}})()`)
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',...points.from})
    await command('Input.dispatchMouseEvent',{type:'mousePressed',...points.from,button:'left',buttons:1,clickCount:1})
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:points.from.x+12,y:points.from.y,button:'left',buttons:1})
    await until(()=>evaluate(`!!document.querySelector('.action-drag-preview') && !!document.querySelector('.shortcut-dragging')`))
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.action-drag-preview')).pointerEvents`),'none')
    for(let step=1;step<=12;step++) {
      await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:points.from.x+(points.to.x-points.from.x)*step/12,y:points.from.y+(points.to.y-points.from.y)*step/12,button:'left',buttons:1})
      await delay(25)
    }
    await until(()=>evaluate(`!!document.querySelector('.titlebar .insert-after,.titlebar .insert-before,.node-actions .insert-after,.node-actions .insert-before')`))
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',...points.to,button:'left',buttons:0,clickCount:1})
    await until(()=>evaluate(`!document.querySelector('.action-drag-preview,.shortcut-dragging')`))
  }
  const nodeHandle='.react-flow__node[data-id="screen"] [data-node-action="record"] .action-drag-handle'
  assert.equal(await evaluate(`(()=>{const node=document.querySelector('.react-flow__node[data-id="screen"]');return node.querySelector('.node-actions').compareDocumentPosition(node.querySelector('.node-ports'))&Node.DOCUMENT_POSITION_FOLLOWING})()`),4)
  await drag('.react-flow__node[data-id="screen"] [data-node-action="elapsed"] .action-drag-handle','.react-flow__node[data-id="screen"] [data-node-action="record"]',false)
  await until(()=>evaluate(`document.querySelector('.react-flow__node[data-id="screen"] [data-node-action]').dataset.nodeAction==='elapsed'`))
  await evaluate(`document.querySelector('.react-flow__node[data-id="screen"] [data-node-action="elapsed"] .action-drag-handle').focus()`)
  await key('ArrowRight','ArrowRight',39,1)
  await until(()=>evaluate(`document.querySelector('.react-flow__node[data-id="screen"] [data-node-action]').dataset.nodeAction==='record'`))
  await key('ArrowLeft','ArrowLeft',37,1)
  await until(()=>evaluate(`document.querySelector('.react-flow__node[data-id="screen"] [data-node-action]').dataset.nodeAction==='elapsed'`))
  await removeRecord()
  await drag(nodeHandle,'.titlebar .control-shortcut',false)
  await until(async()=>JSON.stringify(await shortcutLabels())===JSON.stringify(['Record','Select region']))
  await drag(nodeHandle,'.titlebar .control-shortcut',false)
  assert.equal((await shortcutLabels()).length,2,'same node action must reuse the shortcut')
  await drag('.titlebar .control-shortcut .action-drag-handle','.titlebar [data-shortcut-id="select-region"]')
  await until(async()=>JSON.stringify(await shortcutLabels())===JSON.stringify(['Select region','Record']))
  await evaluate(`document.querySelector('.titlebar [aria-label="Drag Record shortcut"]').focus()`)
  await key('ArrowLeft','ArrowLeft',37,1)
  await until(async()=>JSON.stringify(await shortcutLabels())===JSON.stringify(['Record','Select region']))
  assert.equal((await runtime()).status,'ready','dragging and keyboard sorting must not record')
  for(const [label,source,id] of [['Recording status','status','recording-status'],['Recording time','elapsed','recording-time']]) {
    assert.equal(await evaluate(`!!document.querySelector('.react-flow__node[data-id="screen"] [aria-label="Drag ${label} shortcut"]')`),true)
    await evaluate(`document.querySelector('.titlebar [aria-label="Remove ${label} shortcut"]').click()`)
    await until(()=>evaluate(`!document.querySelector('.titlebar [data-shortcut-id="${id}"]')`))
    assert.equal(await evaluate(`!!document.querySelector('.react-flow__node[data-id="screen"] [aria-label="Drag ${label} shortcut"]')`),true)
    const destination=source==='status'?'select-region':'recording-status'
    await drag(`.react-flow__node[data-id="screen"] [aria-label="Drag ${label} shortcut"]`,`.titlebar [data-shortcut-id="${destination}"]`)
    await until(()=>evaluate(`document.querySelectorAll('.titlebar [data-shortcut-id="${id}"]').length===1`))
    await drag(`.react-flow__node[data-id="screen"] [aria-label="Drag ${label} shortcut"]`,`.titlebar [data-shortcut-id="${id}"]`,false)
    assert.equal(await evaluate(`document.querySelectorAll('.titlebar [data-shortcut-id="${id}"]').length`),1)
  }
  await drag('.titlebar [data-shortcut-id="recording-status"] .action-drag-handle','.titlebar [data-shortcut-id="start-recording"]',false)
  await until(()=>evaluate(`document.querySelector('.titlebar .control-shortcut').dataset.shortcutId==='recording-status'`))
  await drag('.titlebar [data-shortcut-id="recording-status"] .action-drag-handle','.titlebar [data-shortcut-id="select-region"]')
  assert.equal((await runtime()).status,'ready','read-only shortcuts cannot execute actions')
  await key('s','KeyS',83,2)
  await until(async()=>JSON.parse(await readFile(stored,'utf8')).controlOrder.main[0]==='start-recording')
  await command('Page.reload');await delay(250)
  await until(()=>evaluate(`!!document.querySelector('.overview-page')`))
  assert.equal(await evaluate(`!!document.querySelector('.titlebar .action-grip-slot:not([inert]) .action-drag-handle')`),false)
  await click('.workspace-tab button','Blueprint')
  await until(async()=>JSON.stringify(await shortcutLabels())===JSON.stringify(['Record','Select region']))
  assert.equal(await evaluate(`document.querySelector('.react-flow__node[data-id="screen"] [data-node-action]')?.dataset.nodeAction`),'elapsed','node control order must survive saving and reload')
  await until(async()=>evaluate(`document.querySelectorAll('.node-inline-config input,.node-inline-config select').length>0`))
  assert.equal(await evaluate(`!!document.querySelector('.node-title-flow-handle,.exec-port')`),false)
  await until(async()=>evaluate(`(()=>{const node=document.querySelector('.react-flow__node[data-id="screen"]');return node && node.getBoundingClientRect().width/node.offsetWidth >= .75})()`))
  assert.equal(await evaluate(`document.querySelector('.graph-breadcrumb .current').textContent.trim()`),'Recording graph')
  const provider = await evaluate(`window.__TAURI_INTERNALS__.invoke('list_node_types').then(types=>types.find(type=>type.kind==='encode_media_foundation'))`)
  assert.equal(provider.provider,'media_foundation')
  assert.deepEqual(provider.choices.codec,['H.264'])
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.react-flow__node[data-id="encode_media_foundation"] select[aria-label="Codec"] option')].map(option=>option.value)`),provider.choices.codec)
  assert.equal(await evaluate(`document.querySelector('.react-flow__node[data-id="screen"] [data-handleid="in:region"]')?.classList.contains('unconnected')`),false)
  assert.equal(await evaluate(`!!document.querySelector('.details-panel')`),false,'empty Details must not cover the graph')
  assert.equal(await evaluate(`(()=>{const node=document.querySelector('.react-flow__node[data-id="screen"]'), row=[...node.querySelectorAll('.port-row')].find(row=>row.textContent.includes('Fps'));return !!row&&!row.querySelector('input')&&!row.querySelector('.react-flow__handle').classList.contains('unconnected')})()`),true,'connected field remains on pin row and hides local editor')
  assert.equal((await runtime()).status,'ready','navigation and parameter rendering cannot record')
  await evaluate(`(()=>{const edge=[...document.querySelectorAll('.react-flow__edge')].find(edge=>edge.dataset.id==='e-parameter-fps-encode-param:fps');if(!edge)throw Error('FPS edge missing');edge.querySelector('path').dispatchEvent(new MouseEvent('click',{bubbles:true}));document.querySelector('.graph-shell').focus()})()`)
  await until(async()=>evaluate(`document.querySelector('.react-flow__edge[data-id="e-parameter-fps-encode-param:fps"]')?.classList.contains('selected')`))
  await key('Delete','Delete',46)
  await until(async()=>evaluate(`(()=>{const input=document.querySelector('.react-flow__node[data-id="screen"] input[aria-label="Fps"]');return input?.value==='60'&&!input.readOnly})()`))
  await command('Page.reload'); await delay(250)
  await until(async()=>evaluate(`!!document.querySelector('.overview-page')`))
  await click('.workspace-tab button','Blueprint')
  await until(async()=>evaluate(`!document.querySelector('.react-flow__node[data-id="screen"] [data-handleid="in:param:fps"]').classList.contains('unconnected')`))
  await command('Page.captureScreenshot',{format:'png'}).then(result=>writeFile(path.join(fixture,'recording-graph.png'),Buffer.from(result.data,'base64')))
  await click('.titlebar button','Record')
  await until(()=>state('recording'),25000)
  await delay(1100)
  await click('.titlebar button','Pause')
  await until(()=>state('paused'))
  await until(()=>evaluate(`document.querySelector('.react-flow__node[data-id="screen"] [aria-label="Workflow status"]')?.textContent.trim()==='Paused'&&document.querySelector('.titlebar [aria-label="Workflow status"]')?.textContent.trim()==='Paused'`))
  assert.equal(await evaluate(`document.querySelector('.react-flow__node[data-id="screen"] .registered-display[aria-label="Recording time"]').textContent`),await evaluate(`document.querySelector('.titlebar .registered-display[aria-label="Recording time"]').textContent`))
  const paused=(await runtime()).recording.durationMs
  await delay(700)
  assert.equal((await runtime()).recording.durationMs,paused)
  await click('.titlebar button','Resume')
  await until(()=>state('recording'))
  await delay(1100)
  await click('.titlebar button','Stop')
  await until(()=>state('ready'),25000)
  const result=await runtime()
  assert.ok(result.recording.outputs.length===1 && result.recording.outputs.every(item=>item.finished&&!item.error),JSON.stringify(result))
  assert.ok(result.recording.encodedFrames>0)
  const filesBeforeCancel=await readdir(path.join(fixture,'recordings'))
  await evaluate(`document.querySelector('.react-flow__node[data-id="screen"] input[aria-label="Start Delay Seconds"]').focus()`)
  await key('a','KeyA',65,2)
  await command('Input.insertText',{text:'2'})
  await until(async()=>evaluate(`document.querySelector('.react-flow__node[data-id="screen"] input[aria-label="Start Delay Seconds"]')?.value==='2'`))
  await delay(250)
  await click('.titlebar button','Record')
  await until(()=>state('starting'))
  assert.equal(await evaluate(`document.querySelector('.titlebar .split-control')?.textContent.includes('Preparing…')`),true)
  await click('.titlebar button','Cancel')
  await until(()=>state('ready'))
  await delay(2300)
  assert.equal((await runtime()).status,'ready')
  assert.equal((await runtime()).recording,null,'cancelled countdown must not create a recording session')
  assert.deepEqual(await readdir(path.join(fixture,'recordings')),filesBeforeCancel,'cancelled countdown must not create output files')
  await click('.workspace-tab button','Overview')
  await until(async()=>evaluate(`!!document.querySelector('.overview-page select[aria-label="Capture mode"]')`))
  assert.equal(await evaluate(`(()=>{const select=document.querySelector('.overview-page select[aria-label="Capture mode"]');if(!select)return false;select.value='Selected Region';select.dispatchEvent(new Event('change',{bubbles:true}));return true})()`),true)
  await delay(250)
  await click('.titlebar button','Select region')
  try { await until(async()=>evaluate(`window.__TAURI_INTERNALS__.invoke('region_tool_state').then(state=>!!state.tool)`),3000) }
  catch(error) { throw Error(`${error.message}
Region action diagnostics: ${JSON.stringify(await evaluate(`({alerts:[...document.querySelectorAll('[role="alert"]')].map(item=>item.textContent),buttons:[...document.querySelectorAll('.titlebar button')].map(item=>({text:item.textContent,disabled:item.disabled}))})`))}`) }
  const frame=await connectTool('frame'),toolbar=await connectTool('toolbar')
  await until(async()=>frame.evaluate(`!!document.querySelector('.region-frame.picking')`))
  await frame.command('Input.dispatchMouseEvent',{type:'mousePressed',x:100,y:100,button:'left',buttons:1,clickCount:1})
  await frame.command('Input.dispatchMouseEvent',{type:'mouseMoved',x:500,y:300,button:'left',buttons:1})
  await frame.command('Input.dispatchMouseEvent',{type:'mouseReleased',x:500,y:300,button:'left',buttons:0,clickCount:1})
  let selection
  await until(async()=>{selection=await evaluate(`window.__TAURI_INTERNALS__.invoke('region_tool_state')`);return selection.tool?.rect&&!selection.tool.picking})
  assert.equal(selection.tool.rect.width,Math.round(400*selection.tool.scale))
  assert.equal(selection.tool.rect.height,Math.round(200*selection.tool.scale))
  await click('.workspace-tab button','Overview')
  await until(()=>evaluate(`document.querySelector('.overview-page input[aria-label="Width (physical px)"]')?.value===String(${selection.tool.rect.width})`))
  assert.equal(await evaluate(`document.querySelector('.overview-page select[aria-label="Capture mode"]').value`),'Selected Region')
  await evaluate(`window.__TAURI_INTERNALS__.invoke('region_tool_action',{token:${JSON.stringify(selection.tool.token)},action:'reselect',rect:null})`)
  await until(()=>evaluate(`window.__TAURI_INTERNALS__.invoke('region_tool_state').then(state=>state.tool?.picking)`))
  await evaluate(`window.__TAURI_INTERNALS__.invoke('region_tool_action',{token:${JSON.stringify(selection.tool.token)},action:'cancel',rect:null})`)
  await until(()=>evaluate(`window.__TAURI_INTERNALS__.invoke('region_tool_state').then(state=>!state.tool?.picking)`))
  assert.equal(await evaluate(`document.querySelector('.overview-page input[aria-label="Width (physical px)"]').value`),String(selection.tool.rect.width),'cancel must preserve selected parameters')
  const toolClick=async label=>{
    const point=await toolbar.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)return null;const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    assert.ok(point,`Missing toolbar control ${label}`)
    await toolbar.command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1})
    await toolbar.command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1})
  }
  await until(async()=>toolbar.evaluate(`!!document.querySelector('.region-toolbar .split-control button')`))
  await toolClick('Record')
  await until(()=>state('recording'),25000)
  await delay(500)
  await click('.titlebar button','Pause')
  await until(async()=>toolbar.evaluate(`[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Resume')`))
  await toolClick('Resume')
  await until(()=>state('recording'))
  await delay(500)
  await click('.titlebar button','Stop')
  await until(()=>state('ready'),25000)
  const regionRecording=(await runtime()).recording
  assert.equal(regionRecording.width,(selection.tool.rect.width+1)&~1)
  assert.equal(regionRecording.height,(selection.tool.rect.height+1)&~1)
  assert.ok(regionRecording.outputs.every(output=>output.finished&&!output.error))
  await click('.workspace-tab button','Overview')
  await evaluate(`(()=>{const select=document.querySelector('.overview-page select[aria-label="Capture mode"]');select.value='Rectangle';select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await click('.workspace-tab button','Blueprint')
  await click('.library-section:first-child .tree-item','Second Graph')
  await removeRecord()
  await drag(nodeHandle,'.titlebar .control-shortcut',false)
  await until(async()=>{const snapshot=await runtime();return snapshot.controls.some(control=>control.binding.graphId==='second-graph'&&control.binding.nodeId==='screen'&&control.targets.includes('main'))})
  await click('.titlebar button','Record')
  await until(()=>state('recording'),25000)
  assert.equal((await runtime()).recording.width,1920,'action must use the bound graph, including duplicate node IDs')
  await delay(500)
  await click('.titlebar button','Stop');await until(()=>state('ready'),25000)
  const secondGraphRecording=(await runtime()).recording
  assert.equal(secondGraphRecording.width,1920)
  assert.ok(secondGraphRecording.outputs.every(output=>output.finished&&!output.error))
  await until(()=>evaluate(`!!document.querySelector('.titlebar .action-drag-handle')`))
  await command('Page.bringToFront')
  await evaluate(`document.querySelector('.graph-shell').focus()`)
  await key('s','KeyS',83,2)
  await until(async()=>{const saved=JSON.parse(await readFile(stored,'utf8'));return saved.graphs[0].id==='custom-recording-graph'&&saved.graphs[1].id==='second-graph'&&saved.controls.some(c=>c.binding.graphId==='second-graph'&&c.targets.includes('main'))})
  await evaluate(`[...document.querySelectorAll('.blueprint-select')].find(button=>button.querySelector('.blueprint-name')?.textContent==='Local inline').click()`)
  await until(async()=>(await runtime()).blueprintId==='local-inline')
  await click('.workspace-tab button','Blueprint')
  await until(()=>evaluate(`document.querySelectorAll('.react-flow__node').length===3&&!!document.querySelector('.react-flow__node[data-id="screen"] input[aria-label="Width"]')`))
  assert.equal(await evaluate(`document.querySelector('.react-flow__node[data-id="screen"] input[aria-label="Width"]').value`),'640')
  assert.equal(await evaluate(`document.querySelector('.react-flow__node[data-id="write"] input[aria-label="Directory"]').value`),path.join(fixture,'local-recordings'))
  const localGraphImage=await command('Page.captureScreenshot',{format:'png'})
  await writeFile(path.join(fixture,'local-inline.png'),Buffer.from(localGraphImage.data,'base64'))
  await evaluate(`(()=>{const input=document.querySelector('.react-flow__node[data-id="screen"] input[aria-label="Width"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'642');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await key('s','KeyS',83,2)
  await until(async()=>{const saved=JSON.parse(await readFile(path.join(fixture,'blueprints/builtin/local-inline.nodrec.json'),'utf8'));return saved.graphs[0].nodes.find(node=>node.id==='screen').data.config.region.width===642})
  await click('.titlebar button','Record');await until(()=>state('recording'),25000)
  assert.equal((await runtime()).recording.width,642)
  await delay(500);await click('.titlebar button','Stop');await until(()=>state('ready'),25000)
  const localRecording=(await runtime()).recording
  assert.ok(localRecording.outputPath.includes('local-recordings'))
  await evaluate(`(()=>{const input=document.querySelector('.react-flow__node[data-id="write"] input[aria-label="Filename"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'invalid_{unknown}.mp4');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await click('.titlebar button','Record');await until(()=>state('failed'))
  await until(()=>evaluate(`document.querySelector('.react-flow__node[data-id="screen"] .node-error')?.textContent.includes('Filename')&&[...document.querySelectorAll('.titlebar [role="alert"]')].some(alert=>alert.textContent.includes('Filename'))`))
  assert.ok((await runtime()).nodeErrors.some(error=>error.graphId==='custom-recording-graph'&&error.nodeId==='screen'))
  await evaluate(`(()=>{const input=document.querySelector('.react-flow__node[data-id="write"] input[aria-label="Filename"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'collision_{timestamp}.mp4');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await click('.titlebar button','Record');await until(()=>state('recording'),25000)
  const collisionPath=(await runtime()).recording.outputPath
  await writeFile(collisionPath,'preserve publication conflict')
  await delay(200);await click('.titlebar button','Stop');await until(()=>state('failed'),25000)
  await until(()=>evaluate(`!!document.querySelector('.react-flow__node[data-id="write"] .node-error')?.textContent`))
  await until(()=>evaluate(`!!document.querySelector('.titlebar [role="alert"]')?.textContent`))
  assert.ok((await runtime()).nodeErrors.some(error=>error.nodeId==='write'&&error.graphId==='custom-recording-graph'))
  assert.equal(await readFile(collisionPath,'utf8'),'preserve publication conflict')
  await writeFile(path.join(fixture,'result.json'),JSON.stringify({fixture,toolbarAnimation,shortcutToolbar:true,nodeReadOnlyShortcuts:true,nodeActionOrder:true,directRemoval:true,deduplication:true,mouseOrder:true,insertionIndicator:true,keyboardOrder:true,saveReload:true,inlineParameters:true,disconnectRestoresLocal:true,countdownCancelled:true,crossWindowControls:true,localRecording,secondGraphRecording,regionRecording,recording:result.recording},null,2))
  console.log(JSON.stringify({fixture,recording:result.recording},null,2))
} finally {
  socket?.close()
  auxiliarySockets.forEach(socket=>socket.close())
  if(app.exitCode===null){app.kill();await Promise.race([once(app,'exit'),delay(5000)])}
}

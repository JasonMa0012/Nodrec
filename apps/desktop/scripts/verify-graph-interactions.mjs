import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises'
import {once} from 'node:events'
import {setTimeout as delay} from 'node:timers/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const fixture=path.join(desktop,'src-tauri/target',`graph-v2-check-${Date.now()}`),port=9348,endpoint=`http://127.0.0.1:${port}`
await mkdir(path.join(fixture,'blueprints/builtin'),{recursive:true})
const executable=path.join(fixture,'nodrec-desktop.exe')
await copyFile(path.join(desktop,'src-tauri/target/release/nodrec-desktop.exe'),executable)
const base=JSON.parse(await readFile(path.join(desktop,'blueprints/builtin/screen-recording.nodrec.json'),'utf8'))
const node=(id,kind,x,y,config={})=>({id,type:kind,position:{x,y},data:{kind,label:id,config}})
const edge=(id,source,target,output,input)=>({id,source,target,sourceHandle:`out:${output}`,targetHandle:`in:${input}`})
const scalar=[node('a','make_string',100,100,{value:'original'}),node('b','make_string',600,100,{value:'local-b'}),node('c','make_string',600,500,{value:'local-c'}),node('unrelated','make_string',1500,100,{value:'unrelated'})]
const docs=[
 {...base,id:'screen-recording',name:'Data interactions',controls:[],displays:[],controlOrder:{main:[]},graphs:[{id:'recording',name:'Recording',nodes:scalar,edges:[edge('value-link','a','b','value','param:value')]}]},
 {...base,id:'layout',name:'Data layout',controls:[],displays:[],controlOrder:{main:[]},graphs:[{id:'recording',name:'Recording',nodes:[node('capture','screen',1000,300,{cursor:true,fps:60,startDelaySeconds:0}),node('encode','encode_media_foundation',100,700,{codec:'H.264',resolution:'Source Size',bitrate:'20',encodingMode:'Hardware Auto'}),node('write','write',1800,1200),node('region','region',500,0,{display:'Display 1',mode:'Rectangle',x:0,y:0,width:897,height:360}),node('path','path',200,1000,{directory:fixture,filename:'test.mp4'}),node('fps','make_integer',-600,1200,{value:30}),node('unrelated','make_string',2100,200,{value:'fixed'})],edges:[{...edge('frames','capture','encode','frames','frames'),data:{routePoints:[{x:500,y:300}]}},edge('video','encode','write','video','video'),edge('region','region','capture','region','region'),edge('path','path','write','path','path'),edge('fps','fps','capture','value','param:fps')]}]},
]
docs.push({...base,id:'parameters',name:'Parameter editing',graphs:[{id:'recording',name:'Recording',nodes:[node('read-fps','read_parameter',100,100,{parameterId:'fps'}),node('read-fps-copy','read_parameter',600,100,{parameterId:'fps'}),node('parameter-target','make_integer',100,400,{value:1}),node('read-cursor','read_parameter',600,400,{parameterId:'cursor'}),node('read-output','read_parameter',100,700,{parameterId:'output'}),node('local-path','path',600,700,{directory:fixture,filename:'test.mp4'})],edges:[edge('parameter-current','read-fps','parameter-target','value','param:value')]}]})
for(const doc of docs)await writeFile(path.join(fixture,`blueprints/builtin/${doc.id}.nodrec.json`),JSON.stringify(doc))
try{await fetch(`${endpoint}/json/list`,{signal:AbortSignal.timeout(500)});throw Error('CDP port is occupied')}catch(error){if(error.message==='CDP port is occupied')throw error}
const app=spawn(executable,[],{env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:path.join(fixture,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`},windowsHide:true,stdio:'pipe'})
let output='',socket
app.stdout.on('data',c=>output+=c);app.stderr.on('data',c=>output+=c)
async function until(check,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await delay(75)}throw Error(`Timed out: ${check}\n${output}`)}
try{
 let target
 await until(async()=>{if(app.exitCode!==null)throw Error(output);try{target=(await(await fetch(`${endpoint}/json/list`)).json()).find(t=>t.title==='Nodrec');return !!target}catch{return false}},45000)
 socket=new WebSocket(target.webSocketDebuggerUrl)
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
 const pending=new Map(),errors=[];let id=0
 socket.addEventListener('message',({data})=>{const r=JSON.parse(data);if(r.method==='Runtime.exceptionThrown')errors.push(r.params.exceptionDetails);const p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);if(r.error)p.reject(Error(r.error.message));else p.resolve(r.result)})
 const command=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject,timer:setTimeout(()=>{pending.delete(key);reject(Error(method))},10000)});socket.send(JSON.stringify({id:key,method,params}))})
 const evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value}
 const key=async(key,code,virtual,modifiers=0)=>{await command('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtual,modifiers});await command('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtual,modifiers});await delay(100)}
 const focus=()=>evaluate(`document.querySelector('.graph-shell').focus()`)
 const select=async id=>{await evaluate(`document.querySelector('.react-flow__node[data-id="${id}"] .node-title').dispatchEvent(new MouseEvent('click',{bubbles:true}));document.querySelector('.graph-shell').focus()`);await until(async()=>evaluate(`document.querySelector('.react-flow__node[data-id="${id}"]').classList.contains('selected')`))}
 const openGraph=async name=>{await evaluate(`([...document.querySelectorAll('.blueprint-select')].find(b=>b.textContent.trim()===${JSON.stringify(name)})).click()`);await until(async()=>evaluate(`document.querySelector('.blueprint-nav-item.active .blueprint-name')?.textContent===${JSON.stringify(name)}`));await evaluate(`[...document.querySelectorAll('.workspace-tab button')].find(b=>b.textContent.trim()==='Blueprint').click()`);await until(async()=>evaluate(`!!document.querySelector('.react-flow__node')`));await delay(250)}
 const geometry=()=>evaluate(`(()=>{const zoom=Number(document.querySelector('.react-flow__viewport').style.transform.match(/scale\\(([^)]+)\\)/)[1]);return Object.fromEntries([...document.querySelectorAll('.react-flow__node')].map(node=>{const p=[...node.style.transform.matchAll(/-?[\\d.]+/g)].map(m=>Number(m[0])),r=node.getBoundingClientRect();return[node.dataset.id,{x:p[0],y:p[1],width:r.width/zoom,height:r.height/zoom}]}))})()`)
 const save=async()=>{await focus();await key('s','KeyS',83,2);await until(async()=>evaluate(`!document.querySelector('.blueprint-save')`))}
 const point=selector=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
 const drag=async(from,to,modifiers=0)=>{await command('Input.dispatchMouseEvent',{type:'mouseMoved',...from});await command('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',buttons:1,clickCount:1,modifiers});for(let i=1;i<=8;i++)await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:from.x+(to.x-from.x)*i/8,y:from.y+(to.y-from.y)*i/8,button:'left',buttons:1,modifiers});await command('Input.dispatchMouseEvent',{type:'mouseReleased',...to,button:'left',buttons:0,clickCount:1,modifiers});await delay(150)}
 await command('Runtime.enable')
 await until(async()=>evaluate(`!!document.querySelector('.blueprint-select')`))
 await openGraph('Data interactions')
 const panFrom=async selector=>{
   const before=await evaluate(`document.querySelector('.react-flow__viewport').style.transform`),start=await point(selector)
   await command('Input.dispatchMouseEvent',{type:'mouseMoved',...start})
   await command('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'right',buttons:2,clickCount:1})
   for(let step=1;step<=8;step++)await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x+step*6,y:start.y+step*3,button:'right',buttons:2})
   await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:start.x+48,y:start.y+24,button:'right',buttons:0,clickCount:1})
   await until(async()=>await evaluate(`document.querySelector('.react-flow__viewport').style.transform`)!==before)
 }
 await panFrom('.react-flow__node[data-id="a"] .node-title')
 await panFrom('.react-flow__node[data-id="a"] input[aria-label="Value"]')
 assert.equal(await evaluate(`!!document.querySelector('.node-title-flow-handle,.exec-port')`),false)
 await select('a')
 assert.equal(await evaluate(`document.querySelector('.react-flow__node[data-id="unrelated"]').classList.contains('unrelated-node')`),true)
 await key('c','KeyC',67,2);await key('v','KeyV',86,2)
 await until(async()=>evaluate(`document.querySelectorAll('.react-flow__node').length===5`))
 const copied=await evaluate(`[...document.querySelectorAll('.react-flow__node')].find(n=>!['a','b','c','unrelated'].includes(n.dataset.id)).dataset.id`)
 await evaluate(`document.querySelector('.details-panel input[aria-label="Value"]').focus()`)
 await key('a','KeyA',65,2);await command('Input.insertText',{text:'copied'})
 await save()
 let saved=JSON.parse(await readFile(path.join(fixture,'blueprints/builtin/screen-recording.nodrec.json'),'utf8'))
 assert.equal(saved.graphs[0].nodes.find(n=>n.id==='a').data.config.value,'original')
 assert.equal(saved.graphs[0].nodes.find(n=>n.id===copied).data.config.value,'copied')
 await focus();await key('Delete','Delete',46)
 await until(async()=>evaluate(`document.querySelectorAll('.react-flow__node').length===4`))
 await evaluate(`document.querySelector('.react-flow__pane').dispatchEvent(new MouseEvent('click',{bubbles:true}))`)
 await until(async()=>evaluate(`!document.querySelector('.details-panel')`))
 await focus();await key('f','KeyF',70)
 await command('Page.captureScreenshot',{format:'png'}).then(result=>writeFile(path.join(fixture,'before-rewire.png'),Buffer.from(result.data,'base64')))
 assert.equal(await evaluate(`!!document.querySelector('.react-flow__node .node-inline-config input[aria-label="Enabled"]')`),false)
 assert.equal(await evaluate(`(()=>{const h=document.querySelector('.react-flow__node[data-id="a"] [data-handleid="out:value"]'),r=h.getBoundingClientRect();return h.offsetWidth>=26&&document.elementFromPoint(r.x+2,r.y+r.height/2)?.closest('.react-flow__handle')===h})()`),true)
 const from=await point('.react-flow__node[data-id="a"] [data-handleid="out:value"]'),to=await point('.react-flow__node[data-id="c"] [data-handleid="in:param:value"]')
 await drag({x:from.x-3,y:from.y},{x:to.x+3,y:to.y})
 await until(()=>evaluate(`!document.querySelector('.react-flow__node[data-id="c"] [data-handleid="in:param:value"]').classList.contains('unconnected')`))
 await evaluate(`(()=>{const edge=[...document.querySelectorAll('.react-flow__edge')].find(e=>e.dataset.id!=='value-link');edge.querySelector('path').dispatchEvent(new MouseEvent('click',{bubbles:true}));document.querySelector('.graph-shell').focus()})()`)
 await key('Delete','Delete',46)
 await until(()=>evaluate(`document.querySelector('.react-flow__node[data-id="c"] [data-handleid="in:param:value"]').classList.contains('unconnected')`))
 await drag(await point('.react-flow__node[data-id="b"] [data-handleid="in:param:value"]'),await point('.react-flow__node[data-id="c"] [data-handleid="in:param:value"]'),2)
 await until(async()=>evaluate(`!document.querySelector('.react-flow__node[data-id="c"] [data-handleid="in:param:value"]').classList.contains('unconnected')`))
 await save()
 saved=JSON.parse(await readFile(path.join(fixture,'blueprints/builtin/screen-recording.nodrec.json'),'utf8'))
 assert.equal(saved.graphs[0].edges.find(e=>e.id==='value-link').target,'c')
 await select('a')
 assert.equal(await evaluate(`document.querySelector('.details-panel').textContent.includes('Enabled')`),false)
 await command('Input.dispatchMouseEvent',{type:'mousePressed',...await point('.react-flow__node[data-id="a"] .node-title'),button:'right',buttons:2,clickCount:1})
 await command('Input.dispatchMouseEvent',{type:'mouseReleased',...await point('.react-flow__node[data-id="a"] .node-title'),button:'right',buttons:0,clickCount:1})
 await until(()=>evaluate(`!!document.querySelector('[aria-label="Node actions"]')`))
 await evaluate(`[...document.querySelectorAll('[aria-label="Node actions"] button')].find(button=>button.textContent==='Disable').click()`)
 await until(async()=>evaluate(`document.querySelector('.react-flow__node[data-id="a"] .node-disabled')!==null`))
 await save()
 assert.equal(JSON.parse(await readFile(path.join(fixture,'blueprints/builtin/screen-recording.nodrec.json'),'utf8')).graphs[0].nodes.find(n=>n.id==='a').data.enabled,false)
 await openGraph('Data layout')
 await select('capture')
 const before=await geometry()
 await key('F','KeyF',70,8)
 assert.deepEqual(await geometry(),before,'Shift+F must not extend a single-node selection')
 await key('f','KeyF',70)
 await until(async()=>JSON.stringify(await geometry())!==JSON.stringify(before))
 const formatted=await geometry()
 assert.deepEqual(formatted.capture,before.capture,'selected capture remains the anchor')
 assert.deepEqual(formatted.unrelated,before.unrelated,'unrelated component remains fixed')
 assert.ok(formatted.capture.x<formatted.encode.x&&formatted.encode.x<formatted.write.x)
 const entries=Object.entries(formatted)
 for(let i=0;i<entries.length;i++)for(const [id,b]of entries.slice(i+1)){const[aId,a]=entries[i];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,`${aId} overlaps ${id}`)}
 await key('f','KeyF',70)
 assert.deepEqual(await geometry(),formatted,'repeated format is stable')
 await save()
 const layout=JSON.parse(await readFile(path.join(fixture,'blueprints/builtin/layout.nodrec.json'),'utf8'))
 assert.equal(layout.graphs[0].edges.find(e=>e.id==='frames').data?.routePoints?.length??0,0)
 for(const n of layout.graphs[0].nodes)assert.deepEqual(n.position,{x:formatted[n.id].x,y:formatted[n.id].y})
 await command('Page.reload');await delay(250)
 await until(async()=>evaluate(`!!document.querySelector('.blueprint-select')`))
 await openGraph('Data layout')
 const restored=await geometry()
 for(const id of Object.keys(formatted))assert.deepEqual({x:restored[id].x,y:restored[id].y},{x:formatted[id].x,y:formatted[id].y})
 await openGraph('Parameter editing')
 await select('read-fps')
 assert.equal(await evaluate(`document.querySelector('.react-flow__node[data-id="read-fps"] .node-title').textContent`),'Frame rate')
 assert.equal(await evaluate(`document.querySelector('.react-flow__node[data-id="read-fps"] .port-label')`),null)
 assert.equal(await evaluate(`(()=>{const n=document.querySelector('.react-flow__node[data-id="read-fps"]'),input=n.querySelector('select').getBoundingClientRect(),pin=n.querySelector('.react-flow__handle').getBoundingClientRect();return Math.abs((pin.top+pin.height/2)-(input.top+input.height/2))<3})()`),true)
 assert.equal(await evaluate(`document.querySelector('.react-flow__node[data-id="read-fps"] .parameter-label')`),null)
 assert.equal(await evaluate(`document.querySelector('.node-inline-config').textContent.includes('Parameter Id')`),false)
 await evaluate(`(()=>{const input=document.querySelector('.react-flow__node[data-id="read-fps"] select');input.value='30';input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
 await until(()=>evaluate(`document.querySelector('.react-flow__node[data-id="read-fps-copy"] select').value==='30' && document.querySelector('.details-panel select[aria-label="Frame rate"]').value==='30'`))
 await select('parameter-target')
 assert.equal(await evaluate(`document.querySelector('.details-panel [aria-label="Value current value"]').textContent`),'30')
 assert.equal(await evaluate(`document.querySelector('.details-panel [aria-label="Value current value"]').getAttribute('aria-disabled')`),'true')
 await select('read-cursor')
 assert.equal(await evaluate(`[...document.querySelectorAll('.react-flow__node[data-id="read-cursor"] .checkbox-control,.details-panel .checkbox-control')].every(element=>getComputedStyle(element).borderTopWidth==='0px' && getComputedStyle(element).backgroundColor==='rgba(0, 0, 0, 0)')`),true)
 const toggle=await point('.react-flow__node[data-id="read-cursor"] .toggle-track')
 await command('Input.dispatchMouseEvent',{type:'mousePressed',...toggle,button:'left',buttons:1,clickCount:1})
 await command('Input.dispatchMouseEvent',{type:'mouseReleased',...toggle,button:'left',buttons:0,clickCount:1})
 await until(()=>evaluate(`!document.querySelector('.react-flow__node[data-id="read-cursor"] input').checked && !document.querySelector('.details-panel input[aria-label="Show cursor"]').checked`))
 for(const id of ['read-output','local-path']) {
   await select(id)
   for(const scope of [`.react-flow__node[data-id="${id}"]`,'.details-panel']) {
     assert.equal(await evaluate(`!!document.querySelector('${scope} [aria-label^="Browse "]') && !!document.querySelector('${scope} [aria-label$="in File Explorer"]')`),true)
   }
 }
 for(const path of ['', 'relative-folder',fixture+'/missing-folder',fixture+'/blueprints/builtin/parameters.nodrec.json']) {
   const error=await evaluate(`window.__TAURI_INTERNALS__.invoke('open_folder',{path:${JSON.stringify(path)}}).then(()=>null,error=>String(error))`)
   assert.equal(typeof error,'string','invalid folders must report errors without opening Explorer')
 }
 await save()
 assert.equal(JSON.parse(await readFile(path.join(fixture,'blueprints/builtin/parameters.nodrec.json'),'utf8')).values.fps,30)
 assert.deepEqual(errors,[])
 await writeFile(path.join(fixture,'result.json'),JSON.stringify({copyPaste:true,copyIsolation:true,newConnection:true,expandedHitArea:true,rightDragNodesAndFields:true,reconnect:true,disablePersists:true,strictSelection:true,measuredDataLayout:true,nonOverlapping:true,stableFormatting:true,routeReset:true,saveReload:true,borderlessToggles:true,togglePointerHitArea:true,folderActions:true,invalidFolderErrors:true},null,2))
 console.log(`V2 graph interaction checks passed: ${fixture}`)
}finally{socket?.close();if(app.exitCode===null){app.kill();await Promise.race([once(app,'exit'),delay(5000)])}}

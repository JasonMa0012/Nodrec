import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import ts from 'typescript'

const temporary = new URL(`./.workflow-controls-test-${process.pid}.mjs`, import.meta.url)
let ControlButton, RuntimeDisplay
let Toggle, FolderActions
try {
  const source = await readFile(new URL('./WorkflowControls.tsx', import.meta.url),'utf8')
  const compiled = ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText.replace("'./region-geometry'","'./region-geometry.ts'").replace("'./tauri'","'./tauri.ts'")
  await writeFile(temporary,compiled)
  ;({ControlButton, RuntimeDisplay} = await import(temporary.href))
  const fields = await readFile(new URL('./FieldControls.tsx', import.meta.url),'utf8')
  await writeFile(temporary,ts.transpileModule(fields,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText.replace("'./tauri'","'./tauri.ts'"))
  ;({Toggle,FolderActions} = await import(`${temporary.href}?fields`))
} finally { await unlink(temporary).catch(() => {}) }
const control = {id:'record',label:'Record',icon:'play',enabled:true,binding:{graphId:'recording',nodeId:'screen',action:'record'}}
const render = (status,props={}) => renderToStaticMarkup(createElement(ControlButton,{control,status,disabled:false,durationMs:65000,...props}))

test('recording control renders each session state without unrelated actions', () => {
  assert.match(render('ready'),/>Record</)
  assert.match(render('starting'),/Preparing…/)
  assert.match(render('starting'),/>Cancel</)
  assert.doesNotMatch(render('starting'),/>Pause</)
  assert.match(render('recording'),/>Pause</)
  assert.match(render('recording'),/>Stop</)
  assert.doesNotMatch(render('recording'),/Recording time/)
  assert.match(render('paused'),/>Resume</)
  assert.doesNotMatch(render('paused'),/Recording time/)
  assert.match(render('stopping'),/Saving…/)
  assert.doesNotMatch(render('stopping'),/<button/)
  assert.match(render('failed'),/>Record</)
  assert.match(render('ready',{control:{...control,binding:undefined}}),/Invalid node action binding/)
})

test('recording errors never expand action controls', () => {
  const props = {control:{...control,error:'Output queue full'}}
  assert.doesNotMatch(render('failed',props),/Output queue full/)
  assert.doesNotMatch(render('failed',{...props,token:'region-token'}),/Output queue full/)
})

test('elapsed displays reset once recording ends', () => {
  const display = {source:'elapsed'}
  for (const status of ['ready','failed','recording','paused','stopping']) {
    const html = renderToStaticMarkup(createElement(RuntimeDisplay,{display,status,durationMs:65000}))
    assert.match(html, ['ready','failed'].includes(status) ? /00:00:00/ : /00:01:05/)
  }
})

test('toggles share an accessible switch without the text input wrapper', () => {
  const html = renderToStaticMarkup(createElement(Toggle,{label:'Show cursor',checked:true,onChange:()=>{}}))
  assert.match(html,/role="switch"/)
  assert.match(html,/aria-label="Show cursor"/)
  assert.match(html,/checked=""/)
  assert.doesNotMatch(html,/field-control/)
})

test('folder fields offer separate picker and Explorer actions, including read-only values', () => {
  globalThis.isTauri = true
  try {
    const props = {label:'Output folder',value:'C:/Folder with spaces/录制'}
    const html = renderToStaticMarkup(createElement(FolderActions,{...props,onChange:()=>{}}))
    assert.match(html,/aria-label="Browse Output folder"/)
    assert.match(html,/aria-label="Open Output folder in File Explorer"/)
    assert.doesNotMatch(html,/disabled/)
    const readonly = renderToStaticMarkup(createElement(FolderActions,props))
    assert.doesNotMatch(readonly,/Browse/)
    assert.match(readonly,/Open Output folder in File Explorer/)
    assert.match(renderToStaticMarkup(createElement(FolderActions,{...props,value:''})),/disabled=""/)
  } finally {
    delete globalThis.isTauri
  }
})

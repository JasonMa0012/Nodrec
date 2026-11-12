import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const executable=path.join(desktop,'src-tauri/target/release/examples/recording-smoke.exe')
const directory=path.join(desktop,'src-tauri/target',`output-isolation-${Date.now()}`)
await mkdir(directory,{recursive:true})
const reports=[]
for(const secondEncoder of [false,true]){
  const name=secondEncoder?'two-encoders':'shared-encoder'
  const healthy=path.join(directory,`${name}.mp4`),conflict=path.join(directory,`${name}-conflict.mp4`)
  const run=spawnSync(executable,[healthy,'2','hardware','odd','--copy-output',conflict,'--block-publish',...(secondEncoder?['--second-encoder']:[])],{cwd:desktop,encoding:'utf8',timeout:45000,windowsHide:true})
  await writeFile(path.join(directory,`${name}.log`),run.stdout+'\n'+run.stderr)
  assert.equal(run.status,0,run.error?.message??run.stderr)
  const start=run.stdout.lastIndexOf('\n{\n  "outputs"')
  assert.ok(start>=0,'Missing final output statistics')
  const stats=JSON.parse(run.stdout.slice(start))
  assert.equal(stats.outputs.length,2)
  assert.ok(stats.outputs[0].finished&&!stats.outputs[0].error)
  assert.match(stats.outputs[1].error,/could not publish/)
  assert.ok(stats.stopMs !== null,'Failed completion must retain stop timing')
  assert.ok(stats.error.includes(stats.outputs[1].partialPath),'Failure must locate the retained partial file')
  assert.ok(!stats.error.includes(stats.outputs[0].partialPath),'Failure must not claim a healthy published file remains partial')
  assert.equal(await readFile(conflict,'utf8'),'publication-conflict-sentinel')
  const decodes=[]
  for(const file of [healthy,stats.outputs[1].partialPath]){
    const decode=spawnSync(executable,['verify',file],{encoding:'utf8',timeout:30000,windowsHide:true})
    assert.equal(decode.status,0,decode.stderr)
    decodes.push(decode.stdout.trim())
  }
  reports.push({name,stats,decodes})
}
await writeFile(path.join(directory,'result.json'),JSON.stringify(reports,null,2))
console.log(JSON.stringify({directory,reports},null,2))

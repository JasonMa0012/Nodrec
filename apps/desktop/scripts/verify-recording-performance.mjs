import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir,readFile,writeFile,copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const run=promisify(execFile)
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const repo=path.resolve(desktop,'../..')
const baseline=process.argv[2]??'0398b0ac45fb72d035248ce7f935d578db7087b2'
const fixture=path.join(desktop,'src-tauri/target',`performance-${Date.now()}`)
await mkdir(path.join(fixture,'src'),{recursive:true})
for(const name of ['baseline','current']){
  await mkdir(path.join(fixture,'src',name),{recursive:true})
  for(const file of ['recording.rs','recording/windows.rs']){
    const source=`apps/desktop/src-tauri/src/${file}`
    const data=name==='baseline'?(await run('git',['show',`${baseline}:${source}`],{cwd:repo,maxBuffer:4*1024*1024})).stdout:await readFile(path.join(repo,source),'utf8')
    await writeFile(path.join(fixture,'src',file==='recording.rs'?`${name}.rs`:`${name}/windows.rs`),data)
  }
}
const manifest=await readFile(path.join(desktop,'src-tauri/Cargo.toml'),'utf8')
const dependencies=manifest.slice(manifest.indexOf("[target.'cfg(windows)'.dependencies]"))
  .replace('"Win32_System_Com"','"Win32_System_Ole", "Win32_System_Com"')
  .replace('"Win32_Storage_FileSystem",','"Win32_Storage_FileSystem", "Win32_System_ProcessStatus",')
await writeFile(path.join(fixture,'Cargo.toml'),'[package]\nname="nodrec-performance"\nversion="0.0.0"\nedition="2021"\n[dependencies]\nserde={version="1",features=["derive"]}\nserde_json="1"\n'+dependencies)
await copyFile(path.join(desktop,'scripts/fixtures/recording-performance.rs'),path.join(fixture,'src/main.rs'))
const cargoTarget=path.join(desktop,'src-tauri/target/performance-build')
await run('cargo',['build','--release','--offline','--manifest-path',path.join(fixture,'Cargo.toml'),'--target-dir',cargoTarget],{cwd:repo,maxBuffer:4*1024*1024})
const executable=path.join(cargoTarget,'release/nodrec-performance.exe')
const results=[]
for(let iteration=0;iteration<3;iteration++)for(const mode of ['baseline','single','shared','dual']){
  const output=path.join(fixture,`${iteration}-${mode}.mp4`)
  const {stdout}=await run(executable,[mode,output],{timeout:30000,maxBuffer:1024*1024})
  const result=JSON.parse(stdout.trim().split('\n').at(-1))
  assert.ok(result.stats.finished&&!result.stats.error)
  assert.ok(result.stats.encodedFrames>0&&result.stats.durationMs>=3900)
  if(mode==='baseline'||mode==='single')assert.ok(result.stats.encodedFrames>=230)
  results.push({...result,iteration})
  await writeFile(path.join(fixture,'results.json'),JSON.stringify({baseline,results},null,2))
  console.log(`${mode} #${iteration+1}: CPU=${result.cpuPercentOneCore.toFixed(1)}% peak=${result.peakWorkingSetMiB.toFixed(1)} MiB frames=${result.stats.encodedFrames}`)
}
const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)]
const summary=Object.fromEntries(['baseline','single','shared','dual'].map(mode=>{const rows=results.filter(row=>row.mode===mode);return[mode,Object.fromEntries(['cpuPercentOneCore','peakWorkingSetMiB','setupMs','wallSeconds'].map(key=>[key,median(rows.map(row=>row[key]))]))]}))
await run('cargo',['build','--release','--manifest-path',path.join(desktop,'src-tauri/Cargo.toml'),'--example','recording-smoke'],{cwd:repo,maxBuffer:4*1024*1024})
const decoded=[]
for(const result of results)for(const output of result.stats.outputs??[{path:result.stats.outputPath}]){
  const {stdout}=await run(path.join(desktop,'src-tauri/target/release/examples/recording-smoke.exe'),['verify',output.path],{timeout:30000,maxBuffer:1024*1024})
  assert.match(stdout,/Decoded H\.264 MP4 (898x360|640x360): 2\d\d frames/)
  decoded.push({path:output.path,result:stdout.trim()})
}
await writeFile(path.join(fixture,'decoded.json'),JSON.stringify(decoded,null,2))
await writeFile(path.join(fixture,'summary.json'),JSON.stringify({baseline,fixture,summary},null,2))
console.log(JSON.stringify({fixture,summary},null,2))

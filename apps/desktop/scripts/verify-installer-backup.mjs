import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, writeFile, readFile, readdir, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const fixture=path.join(desktop,'src-tauri/target',`installer-backup-check-${Date.now()}`)
await mkdir(fixture,{recursive:true})
const compiler=path.join(process.env.LOCALAPPDATA,'tauri/NSIS/makensis.exe')
const include=path.join(desktop,'src-tauri/installer-backup.nsh')
const replacement=path.join(fixture,'replacement.json')
await writeFile(replacement,'{"schemaVersion":2,"name":"replacement"}')
const executable=path.join(fixture,'backup-probe.exe')
const source=path.join(fixture,'backup-probe.nsi')
await writeFile(source,[
  'Unicode true','Name "Nodrec backup probe"','RequestExecutionLevel user','SilentInstall silent',`OutFile "${executable}"`,`!include "${include}"`,
  'Function .onInit','Call NodrecBackupBuiltins','FunctionEnd','Section',
  'Delete "$INSTDIR\\blueprints\\builtin\\*.nodrec.json"',
  'Call NodrecBackupBuiltins','SetOutPath "$INSTDIR\\blueprints\\builtin"',
  `File /oname=screen-recording.nodrec.json "${replacement}"`,'SectionEnd',
].join('\n'))
const compile=spawnSync(compiler,['/V2',source],{encoding:'utf8',windowsHide:true})
assert.equal(compile.status,0,compile.stdout+compile.stderr)
const run=directory=>spawnSync(executable,['/S',`/D=${directory}`],{windowsHide:true,timeout:15000})
const oldRoot=path.join(fixture,'existing')
await mkdir(path.join(oldRoot,'blueprints/builtin'),{recursive:true})
const oldFile=path.join(oldRoot,'blueprints/builtin/screen-recording.nodrec.json')
const oldBytes=Buffer.from('{"schemaVersion":1,"custom":"用户修改"}\r\n')
await writeFile(oldFile,oldBytes)
assert.equal(run(oldRoot).status,0)
const backups=path.join(oldRoot,'blueprints/.backups')
const names=await readdir(backups)
assert.equal(names.length,1,'init and preinstall must share one backup for the same directory')
assert.deepEqual(await readFile(path.join(backups,names[0],'screen-recording.nodrec.json')),oldBytes)
assert.deepEqual(await readFile(oldFile),await readFile(replacement))
assert.equal(run(oldRoot).status,0)
assert.equal((await readdir(backups)).length,2,'later installs must create a new backup')
assert.deepEqual(await readFile(path.join(backups,names[0],'screen-recording.nodrec.json')),oldBytes)
const blocked=path.join(fixture,'blocked')
await mkdir(path.join(blocked,'blueprints/builtin'),{recursive:true})
const blockedFile=path.join(blocked,'blueprints/builtin/screen-recording.nodrec.json')
await writeFile(blockedFile,oldBytes)
await writeFile(path.join(blocked,'blueprints/.backups'),'block-backup-directory')
assert.notEqual(run(blocked).status,0,'backup failure must stop installation')
assert.deepEqual(await readFile(blockedFile),oldBytes,'backup failure must preserve original files')
const fresh=path.join(fixture,'fresh')
assert.equal(run(fresh).status,0)
await assert.rejects(access(path.join(fresh,'blueprints/.backups')))
const template=await readFile(path.join(desktop,'src-tauri/installer-template.nsi'),'utf8')
const upstream=template.replaceAll('\r\n','\n').split('\n').slice(3).join('\n').replace(/\n  ; Nodrec backup begin:[\s\S]*?  ; Nodrec backup end/,'')
assert.equal(createHash('sha256').update(upstream).digest('hex'),'166f9677d42e81c7f712a1bf80d9d8c089c21d2967d8398474768b5eac14b494','Keep upstream installer behavior intact outside the documented backup call')
assert.equal(JSON.parse(await readFile(path.join(desktop,'node_modules/@tauri-apps/cli/package.json'),'utf8')).version,'2.12.2','Refresh the pinned installer template and its tests when upgrading Tauri CLI')
assert.match(template,/Function \.onInit[\s\S]*?Call NodrecBackupBuiltins[\s\S]*?FunctionEnd/)
const hooks=await readFile(path.join(desktop,'src-tauri/installer-hooks.nsh'),'utf8')
assert.match(hooks,/!macro NSIS_HOOK_PREINSTALL\s+Call NodrecBackupBuiltins/)
const redirected=path.join(fixture,'redirected')
const previous=path.join(redirected,'previous')
await mkdir(path.join(previous,'blueprints/builtin'),{recursive:true})
await writeFile(path.join(previous,'blueprints/builtin/screen-recording.nodrec.json'),oldBytes)
const registryKey=`Software\\NodrecInstallerBackupTest\\${process.pid}-${Date.now()}`
const initBlock=template.match(/  ; Nodrec backup begin:[\s\S]*?  ; Nodrec backup end/)[0].replace('SHCTX "${MANUPRODUCTKEY}"',`HKCU "${registryKey}"`)
const redirectedExecutable=path.join(fixture,'redirected-probe.exe')
const redirectedScript=path.join(fixture,'redirected-probe.nsi')
await writeFile(redirectedScript,(await readFile(source,'utf8')).replace(executable,redirectedExecutable)
  .replace('Function .onInit\nCall NodrecBackupBuiltins',`Function .onInit\nWriteRegStr HKCU "${registryKey}" "" "$INSTDIR\\previous"\n${initBlock}\nDeleteRegKey HKCU "${registryKey}"`)
  .replace('Delete "$INSTDIR\\blueprints\\builtin\\*.nodrec.json"','Delete "$INSTDIR\\previous\\blueprints\\builtin\\*.nodrec.json"'))
const redirectedCompile=spawnSync(compiler,['/V2',redirectedScript],{encoding:'utf8',windowsHide:true})
assert.equal(redirectedCompile.status,0,redirectedCompile.stdout+redirectedCompile.stderr)
try {
  assert.equal(spawnSync(redirectedExecutable,['/S',`/D=${redirected}`],{windowsHide:true,timeout:15000}).status,0)
  const previousBackups=path.join(previous,'blueprints/.backups')
  const [backup]=await readdir(previousBackups)
  assert.deepEqual(await readFile(path.join(previousBackups,backup,'screen-recording.nodrec.json')),oldBytes,'/D must not bypass backup of the previous registered install')
  await assert.rejects(access(path.join(previous,'blueprints/builtin/screen-recording.nodrec.json')))
} finally { spawnSync('reg.exe',['delete',`HKCU\\${registryKey}`,'/f'],{windowsHide:true,stdio:'ignore'}) }
await writeFile(path.join(fixture,'result.json'),JSON.stringify({byteExactBackup:true,oncePerDirectory:true,repeatedInstall:true,backupFailurePreservesOriginal:true,freshInstall:true,redirectedInstallPreservesPrevious:true},null,2))
console.log(`Installer backup checks passed: ${fixture}`)

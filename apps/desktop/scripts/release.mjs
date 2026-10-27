import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const configPath = path.join(desktop, 'src-tauri/tauri.conf.json')
const config = JSON.parse(await readFile(configPath, 'utf8'))
const buildOnly = process.argv.includes('--build-only')
const repository = 'JasonMa0012/Nodrec'
const api = `https://api.github.com/repos/${repository}`
const token = process.env.MOOATOON_ENGINE_TOKEN || process.env.GITHUB_TOKEN
const key = process.env.TAURI_SIGNING_PRIVATE_KEY || path.join(homedir(), '.tauri/nodrec.key')
const cli = path.join(desktop, 'node_modules/@tauri-apps/cli/tauri.js')
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: desktop, env, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status})`)
}
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...options.headers }, signal: AbortSignal.timeout(180000) })
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${(await response.text()).slice(0, 800)}`)
  return response.status === 204 ? null : response.json()
}

let version = config.version
let notes = ''
if (!buildOnly) {
  if (!token) throw new Error('Set MOOATOON_ENGINE_TOKEN (or GITHUB_TOKEN) before publishing.')
  const input = createInterface({ input: process.stdin, output: process.stdout })
  try {
    version = process.argv[2] || await input.question(`Version (current ${config.version}): `)
    notes = process.argv[3] || await input.question('Release notes: ')
  } finally { input.close() }
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Use a version such as 0.1.0.')
  if (!notes.trim()) throw new Error('Release notes cannot be empty.')
  // Check authorization and an existing release before changing versions or building.
  const repositoryInfo = await request(api)
  if (repositoryInfo.private) throw new Error('Release repository is private. Anonymous in-app updates require a public release repository; no token is embedded in Nodrec.')
  const releases = await request(`${api}/releases?per_page=100`)
  if (releases.some(release => release.tag_name === `v${version}`)) throw new Error(`Release v${version} already exists; choose a new version.`)
}
if (!existsSync(key)) throw new Error(`Missing signing key: ${key}. Restore the original Nodrec key before building.`)
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  const publicKey = (await readFile(`${key}.pub`, 'utf8')).trim()
  if (publicKey !== config.plugins.updater.pubkey) throw new Error('Signing public key does not match tauri.conf.json.')
}
if (!buildOnly) {
  config.version = version
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
  const packagePath = path.join(desktop, 'package.json')
  const pkg = JSON.parse(await readFile(packagePath, 'utf8')); pkg.version = version
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)
  const lockPath = path.join(desktop, 'package-lock.json')
  const lock = JSON.parse(await readFile(lockPath, 'utf8')); lock.version = version; lock.packages[''].version = version
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
  const cargoPath = path.join(desktop, 'src-tauri/Cargo.toml')
  await writeFile(cargoPath, (await readFile(cargoPath, 'utf8')).replace(/^(version\s*=\s*")[^"]+("\s*)$/m, `$1${version}$2`))
}
run(process.execPath, [cli, 'build', '--bundles', 'nsis'], { ...process.env, TAURI_SIGNING_PRIVATE_KEY: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || '' })
run(process.execPath, [path.join(desktop, 'scripts/stage-blueprints.mjs'), 'release'])
const bundle = path.join(desktop, 'src-tauri/target/release/bundle/nsis')
const installer = (await readdir(bundle)).find(name => name === `Nodrec_${version}_x64-setup.exe`)
if (!installer) throw new Error(`Missing installer for ${version}`)
console.log(`Built ${path.join(bundle, installer)}`)
if (!buildOnly) {
  const manifest = { version, notes, pub_date: new Date().toISOString(), platforms: { 'windows-x86_64': { signature: (await readFile(path.join(bundle, `${installer}.sig`), 'utf8')).trim(), url: `https://github.com/${repository}/releases/download/v${version}/${installer}` } } }
  const output = path.join(desktop, 'src-tauri/target/release/release-assets')
  await mkdir(output, { recursive: true })
  await writeFile(path.join(output, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const release = await request(`${api}/releases`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag_name: `v${version}`, name: `Nodrec ${version}`, body: notes, draft: true }) })
  // Keep incomplete uploads as drafts; the latest endpoint changes only after all assets exist.
  for (const [name, file] of [[installer, path.join(bundle, installer)], [`${installer}.sig`, path.join(bundle, `${installer}.sig`)], ['latest.json', path.join(output, 'latest.json')]]) {
    await request(`${release.upload_url.split('{')[0]}?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await readFile(file) })
  }
  const published = await request(`${api}/releases/${release.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: false, make_latest: 'true' }) })
  console.log(`Published ${published.html_url}`)
}

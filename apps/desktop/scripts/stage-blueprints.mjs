import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const profile = process.argv[2]
if (!['debug', 'release'].includes(profile)) throw new Error('Pass the target profile: debug or release')

const source = path.join(desktop, 'blueprints', 'builtin')
const target = path.join(desktop, 'src-tauri', 'target', profile, 'blueprints', 'builtin')
const trashed = path.join(desktop, 'src-tauri', 'target', profile, 'blueprints', '.trash')
const files = await readdir(source)
const trashNames = await readdir(trashed).catch(() => [])
await mkdir(target, { recursive: true })
for (const name of files.filter((file) => file.endsWith('.nodrec.json'))) {
  if (trashNames.some((file) => file.startsWith(`${name.slice(0, -'.nodrec.json'.length)}-`))) continue
  try { await copyFile(path.join(source, name), path.join(target, name), constants.COPYFILE_EXCL) }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    if (name === 'operation-recording.nodrec.json') {
      const destination = path.join(target, name)
      const existing = (await readFile(destination, 'utf8')).replaceAll('\r\n', '\n')
      // Only replace the exact shipped empty preview; edited blueprints belong to the user.
      if (createHash('sha256').update(existing).digest('hex') === '7f3fb1d250bae1bc28f9c8396801271395a227540f5f48f92a34d62aa37e2470') {
        await copyFile(path.join(source, name), destination)
      }
    }
  }
}

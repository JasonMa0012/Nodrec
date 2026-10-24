import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const messages = []
const events = new Map()
const timers = []
const addEventListener = (name, handler) => events.set(name, handler)
const window = {
  addEventListener,
  __TAURI_INTERNALS__: { invoke: async (command, args) => {
    assert.equal(command, 'startup_log')
    messages.push(args.stage)
  } },
}
vm.runInNewContext(await readFile(new URL('../src-tauri/startup.js', import.meta.url), 'utf8'), {
  window,
  document: { addEventListener, readyState: 'loading', getElementById: () => null },
  performance: { now: () => 123, getEntriesByType: () => [{ name: 'http://localhost/src/main.tsx?token=secret', duration: 500, startTime: 10 }] },
  console: { info() {}, error: assert.fail },
  URL,
  setTimeout: (callback, delay) => timers.push({ callback, delay }),
})
assert.match(messages[0], /page \+123.0ms document initialization/)
window.__nodrecStartupLog('React ready')
events.get('DOMContentLoaded')()
events.get('load')()
events.get('error')({ message: 'test error' })
events.get('unhandledrejection')({ reason: 'test rejection' })
assert.deepEqual(timers.map(({ delay }) => delay), [2000, 5000, 10000, 20000, 60000])
timers[0].callback()
for (const expected of ['React ready', 'DOMContentLoaded', 'window load', 'duration=500.0ms', 'test error', 'test rejection', 'readyState=loading rootChildren=0']) {
  assert.ok(messages.some((message) => message.includes(expected)), expected)
}
assert.ok(messages.every((message) => !message.includes('secret')))
console.log('Startup logging self-check passed')

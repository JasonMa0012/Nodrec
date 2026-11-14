import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

test('startup bridge forwards console and page failures without recursion', async () => {
  const entries = [], handlers = new Map()
  const window = {
    __TAURI_INTERNALS__: { invoke: async (command, args) => {
      if (command === 'app_log') { entries.push(args); return }
      if (command === 'bad_command') throw Error('original command failed')
      return 'original result'
    } },
    addEventListener: (name, handler) => handlers.set(name, handler),
  }
  const context = vm.createContext({
    window, Error, URL, devicePixelRatio: 2.25,
    console: Object.fromEntries(['debug', 'info', 'log', 'warn', 'error'].map(method => [method, () => {}])),
    performance: { now: () => 12, getEntriesByType: () => [] },
    navigator: { userAgent: 'test WebView', languages: ['en-US'] },
    document: { addEventListener: () => {} }, setTimeout: () => {},
  })
  vm.runInContext(await readFile(new URL('../src-tauri/startup.js', import.meta.url), 'utf8'), context)
  context.console.warn('warning', { detail: 1 })
  context.console.error(Error('with stack'))
  handlers.get('error')({ message: 'page failure', filename: 'test.js' })
  handlers.get('unhandledrejection')({ reason: Error('rejected promise') })
  await assert.rejects(window.__TAURI_INTERNALS__.invoke('bad_command'), /original command failed/)
  assert.equal(await window.__TAURI_INTERNALS__.invoke('good_command'), 'original result')
  assert.ok(entries.some(log => log.message.includes('WebView=test WebView')))
  assert.ok(entries.some(log => log.level === 'warn' && log.message === 'warning {"detail":1}'))
  assert.ok(entries.some(log => log.level === 'error' && log.message.includes('with stack')))
  assert.ok(entries.some(log => log.message.includes('Page error: page failure test.js')))
  assert.ok(entries.some(log => log.message.includes('Unhandled rejection: Error: rejected promise')))
  const count = entries.length
  window.__TAURI_INTERNALS__.invoke = undefined
  window.__nodrecStartupLog('still uses the original bridge')
  assert.equal(entries.length, count + 1)
})


test('Tauri command logging preserves arguments, results and original failures', async () => {
  const { invoke } = await import('./tauri.ts')
  const originalWindow = globalThis.window
  const originalError = console.error
  const errors = []
  const failure = Error('command failed')
  globalThis.window = {__TAURI_INTERNALS__:{invoke:async (command,args) => { if(command === 'bad') throw failure; return args }}}
  console.error = (...args) => errors.push(args)
  try {
    assert.deepEqual(await invoke('good',{value:7}),{value:7})
    await assert.rejects(invoke('bad'),error => error === failure)
    assert.equal(errors[0][0], 'Command bad failed')
    assert.equal(errors[0][1], failure)
  } finally { globalThis.window = originalWindow; console.error = originalError }
})

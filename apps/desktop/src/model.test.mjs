import assert from 'node:assert/strict'
import test from 'node:test'
import { moveParameterLayout } from './model.ts'

test('dropping beside a parameter creates a column without resizing first', () => {
  const rows = [
    { pinned: true, columns: [{ id: 'display', weight: 1 }, { id: 'region', weight: 1 }] },
    { pinned: false, columns: [{ id: 'cursor', weight: 1 }] },
  ]
  const next = moveParameterLayout(rows, 'cursor', 'display', 'right')

  assert.deepEqual(next, [{ pinned: true, columns: [{ id: 'display', weight: 0.25 }, { id: 'cursor', weight: 0.25 }, { id: 'region', weight: 0.5 }] }])
})

test('moving a field out of a shared row removes the blank space and normalizes widths', () => {
  const rows = [
    { pinned: true, columns: [{ id: 'display', weight: 0.5 }, { id: 'region', weight: 0.5 }] },
    { pinned: false, columns: [{ id: 'cursor', weight: 0.5 }, { id: 'delay', weight: 0.5 }] },
  ]
  const next = moveParameterLayout(rows, 'display', 'delay', 'above')

  assert.deepEqual(next, [
    { pinned: true, columns: [{ id: 'region', weight: 1 }] },
    { pinned: false, columns: [{ id: 'display', weight: 1 }] },
    { pinned: false, columns: [{ id: 'cursor', weight: 0.5 }, { id: 'delay', weight: 0.5 }] },
  ])
})

test('dropping across pinned zones updates the pin state and appends a solo row', () => {
  const rows = [
    { pinned: true, columns: [{ id: 'display', weight: 0.5 }, { id: 'region', weight: 0.5 }] },
    { pinned: false, columns: [{ id: 'delay', weight: 1 }] },
  ]

  assert.deepEqual(moveParameterLayout(rows, 'display', null, 'end', false), [
    { pinned: true, columns: [{ id: 'region', weight: 1 }] },
    { pinned: false, columns: [{ id: 'delay', weight: 1 }] },
    { pinned: false, columns: [{ id: 'display', weight: 1 }] },
  ])
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { verticalCompactor } from 'react-grid-layout'
import { createBlueprint, moveOverviewCardVertically, moveParameterLayout, placeOverviewCardBeside, swapOverviewCardPositions } from './model.ts'
import { overviewCollisionDetection, overviewDropPlacement } from './overview-dnd.ts'

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

test('blueprints keep independent wide and single-column overview layouts', () => {
  const screen = createBlueprint('screen', 'Screen recording')
  const replay = createBlueprint('replay', 'Record and replay', true)

  assert.deepEqual(screen.overviewLayouts.wide.map(({ i, x, w }) => [i, x, w]), [
    ['recording', 0, 6], ['video', 6, 6], ['audio', 0, 6], ['output', 6, 6],
  ])
  assert.equal(screen.overviewLayouts.wide[0].h, 12)
  assert.equal(screen.overviewLayouts.wide[1].h, 10)
  assert.ok(screen.overviewLayouts.narrow.every(({ x, w }) => x === 0 && w === 1))
  assert.equal(replay.overviewLayouts.wide.length, replay.cards.length)
  assert.notEqual(screen.overviewLayouts.wide, replay.overviewLayouts.wide)
})

test('overview cards swap positions without changing their sizes', () => {
  const layout = [
    { i: 'recording', x: 0, y: 0, w: 8, h: 12 },
    { i: 'video', x: 8, y: 0, w: 4, h: 10 },
    { i: 'audio', x: 0, y: 12, w: 6, h: 8 },
  ]
  const swapped = swapOverviewCardPositions(layout, 'recording', 'video')

  assert.deepEqual(swapped.map(({ i, x, y, w, h }) => [i, x, y, w, h]), [
    ['recording', 8, 0, 8, 12], ['video', 0, 0, 4, 10], ['audio', 0, 12, 6, 8],
  ])
  assert.equal(swapOverviewCardPositions(layout, 'recording', 'missing'), layout)
  assert.equal(swapOverviewCardPositions(layout, 'recording', 'recording'), layout)
})

test('overview card swaps survive responsive grid compaction', () => {
  const blueprint = createBlueprint('screen', 'Screen recording')
  for (const [breakpoint, columns] of [['wide', 12], ['narrow', 1]]) {
    const layout = blueprint.overviewLayouts[breakpoint]
    const videoBefore = layout.find(({ i }) => i === 'video')
    const audioBefore = layout.find(({ i }) => i === 'audio')
    const compacted = verticalCompactor.compact(swapOverviewCardPositions(layout, 'video', 'audio'), columns)
    const videoAfter = compacted.find(({ i }) => i === 'video')
    const audioAfter = compacted.find(({ i }) => i === 'audio')

    assert.deepEqual([videoAfter.x, videoAfter.y], [audioBefore.x, audioBefore.y])
    assert.deepEqual([audioAfter.x, audioAfter.y], [videoBefore.x, videoBefore.y])
  }
})

test('overview uses card overlap when the pointer remains outside the drop target', () => {
  const sourceId = 'overview:audio'
  const targetId = 'overview:video'
  const rect = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top })
  const collisions = overviewCollisionDetection({
    active: { id: sourceId },
    collisionRect: rect(50, 20, 150, 120),
    droppableRects: new Map([[sourceId, rect(0, 0, 100, 100)], [targetId, rect(80, 0, 180, 100)]]),
    droppableContainers: [{ id: sourceId }, { id: targetId }],
    pointerCoordinates: { x: 20, y: 20 },
  })

  assert.deepEqual(collisions.map(({ id }) => id), [targetId])
})

test('overview cards prefer a card over the full grid end drop target', () => {
  const rect = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top })
  const collisions = overviewCollisionDetection({
    active: { id: 'overview:audio' },
    collisionRect: rect(150, 110, 180, 140),
    droppableRects: new Map([
      ['overview:audio', rect(0, 0, 100, 100)],
      ['overview:video', rect(100, 100, 200, 160)],
      ['overview:end', rect(0, 170, 300, 234)],
    ]),
    droppableContainers: [{ id: 'overview:audio' }, { id: 'overview:video' }, { id: 'overview:end' }],
    pointerCoordinates: { x: 160, y: 120 },
  })

  assert.deepEqual(collisions.map(({ id }) => id), ['overview:video'])

  const endCollision = overviewCollisionDetection({
    active: { id: 'overview:audio' },
    collisionRect: rect(150, 145, 180, 175),
    droppableRects: new Map([
      ['overview:audio', rect(0, 0, 100, 100)],
      ['overview:video', rect(100, 100, 200, 160)],
      ['overview:end', rect(0, 170, 300, 234)],
    ]),
    droppableContainers: [{ id: 'overview:audio' }, { id: 'overview:video' }, { id: 'overview:end' }],
    pointerCoordinates: { x: 160, y: 180 },
  })
  assert.deepEqual(endCollision.map(({ id }) => id), ['overview:end'])
})

test('dropping beside a card reuses the parameter row insertion and auto-sizes three cards', () => {
  const layout = [
    { i: 'recording', x: 0, y: 12, w: 6, h: 10, minW: 3 },
    { i: 'video', x: 6, y: 12, w: 6, h: 8, minW: 3 },
    { i: 'audio', x: 0, y: 22, w: 12, h: 9, minW: 3 },
    { i: 'output', x: 6, y: 22, w: 6, h: 6, minW: 3 },
  ]
  const moved = placeOverviewCardBeside(layout, 'audio', 'video', 'right', 12)
  const compacted = verticalCompactor.compact(moved, 12)
  const video = compacted.find(({ i }) => i === 'video')
  const audio = compacted.find(({ i }) => i === 'audio')
  const recording = compacted.find(({ i }) => i === 'recording')

  assert.equal(video.y, audio.y)
  assert.equal(video.x + video.w, audio.x)
  assert.equal(recording.y, video.y)
  assert.equal(recording.w + video.w + audio.w, 12)
  assert.equal(recording.x, 0)
  const insertedLeft = verticalCompactor.compact(placeOverviewCardBeside(layout, 'audio', 'video', 'left', 12), 12)
  const leftVideo = insertedLeft.find(({ i }) => i === 'video')
  const leftAudio = insertedLeft.find(({ i }) => i === 'audio')
  assert.equal(leftVideo.y, leftAudio.y)
  assert.equal(leftAudio.x + leftAudio.w, leftVideo.x)
  assert.deepEqual(placeOverviewCardBeside(layout, 'audio', 'video', 'right', 1), layout)
})

test('side insertion auto-fills a row even when both cards were previously narrow', () => {
  const layout = [
    { i: 'recording', x: 0, y: 0, w: 3, h: 10, minW: 3 },
    { i: 'video', x: 0, y: 10, w: 3, h: 8, minW: 3 },
  ]
  const moved = placeOverviewCardBeside(layout, 'video', 'recording', 'right', 12)
  const recording = moved.find(({ i }) => i === 'recording')
  const video = moved.find(({ i }) => i === 'video')

  assert.equal(recording.w + video.w, 12)
  assert.equal(recording.x + recording.w, video.x)
  assert.equal(recording.y, video.y)
})

test('overview drop feedback distinguishes horizontal and vertical insertion', () => {
  const target = { left: 100, top: 100, width: 400, height: 200 }
  assert.equal(overviewDropPlacement({ left: 125, top: 150, width: 100, height: 100 }, target), 'left')
  assert.equal(overviewDropPlacement({ left: 250, top: 150, width: 100, height: 100 }, target), null)
  assert.equal(overviewDropPlacement({ left: 475, top: 150, width: 100, height: 100 }, target), 'right')
  assert.equal(overviewDropPlacement({ left: 200, top: 15, width: 100, height: 50 }, target), 'above')
  assert.equal(overviewDropPlacement({ left: 200, top: 335, width: 100, height: 50 }, target), 'below')
})

test('overview vertical insertions create rows and a blank-area drop appends the card', () => {
  const layout = [
    { i: 'recording', x: 0, y: 0, w: 6, h: 5, minW: 3 },
    { i: 'video', x: 6, y: 0, w: 6, h: 4, minW: 3 },
    { i: 'audio', x: 0, y: 5, w: 6, h: 6, minW: 3 },
    { i: 'output', x: 6, y: 5, w: 6, h: 3, minW: 3 },
  ]
  const above = moveOverviewCardVertically(layout, 'audio', 'recording', 'above', 12)
  const aboveAudio = above.find(({ i }) => i === 'audio')
  const aboveRecording = above.find(({ i }) => i === 'recording')
  const aboveVideo = above.find(({ i }) => i === 'video')
  const aboveOutput = above.find(({ i }) => i === 'output')
  assert.deepEqual([aboveAudio.x, aboveAudio.y, aboveAudio.w], [0, 0, 12])
  assert.equal(aboveRecording.y, aboveVideo.y)
  assert.equal(aboveRecording.y, aboveAudio.y + aboveAudio.h)
  assert.equal(aboveOutput.y, aboveRecording.y + Math.max(aboveRecording.h, aboveVideo.h))

  const below = moveOverviewCardVertically(layout, 'audio', 'recording', 'below', 12)
  const belowRecording = below.find(({ i }) => i === 'recording')
  const belowVideo = below.find(({ i }) => i === 'video')
  const belowAudio = below.find(({ i }) => i === 'audio')
  const belowOutput = below.find(({ i }) => i === 'output')
  assert.equal(belowAudio.y, belowRecording.y + Math.max(belowRecording.h, belowVideo.h))
  assert.equal(belowOutput.y, belowAudio.y + belowAudio.h)

  const appended = moveOverviewCardVertically(above, 'video', null, 'end', 12)
  const video = appended.find(({ i }) => i === 'video')
  const last = Math.max(...appended.filter(({ i }) => i !== 'video').map(({ y, h }) => y + h))
  assert.equal(video.y, last)
  assert.equal(video.w, 12)
})

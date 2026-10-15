import assert from 'node:assert/strict'
import test from 'node:test'
import { verticalCompactor } from 'react-grid-layout'
import { allParameters, createBlueprint, hydrateBlueprint, moveOverviewCardVertically, moveParameterLayout, overviewCardContentHeight, overviewGridHeight, pinTypeColor, pinTypeForValue, placeOverviewCardBeside, serializeBlueprint, swapOverviewCardPositions, syncBlueprintEvents } from './model.ts'
import { overviewCollisionDetection, overviewDropPlacement } from './overview-dnd.ts'

test('blueprint documents persist workflow graphs and controls, but reset editor and runtime state', () => {
  const blueprint = createBlueprint('capture-test', 'Capture test')
  blueprint.recordState = 'recording'
  blueprint.selectedNode = 'pipeline-start'
  const document = serializeBlueprint(blueprint)
  const restored = hydrateBlueprint(document, 'builtin', 'revision-token')

  assert.equal(document.schemaVersion, 1)
  assert.equal('recordState' in document, false)
  assert.deepEqual(restored.nodes, blueprint.nodes)
  assert.deepEqual(restored.edges, blueprint.edges)
  assert.equal(restored.recordState, 'ready')
  assert.equal(restored.selectedNode, null)
  assert.equal(restored.revision, 'revision-token')
  assert.ok(restored.nodes.some((node) => node.data.kind === 'register_control'))
})

test('workspaces open both editor tabs and registered controls carry explicit sort order', () => {
  const blueprint = createBlueprint('capture-test', 'Capture test')
  const controls = blueprint.nodes.filter((node) => node.data.kind === 'register_control').map((node) => node.data.config.control.order)
  const restored = hydrateBlueprint(serializeBlueprint(blueprint), 'user', 'revision-token')

  assert.deepEqual(blueprint.tabs.map(({ id }) => id), ['overview', 'blueprint'])
  assert.equal(blueprint.activeTab, 'overview')
  assert.deepEqual(controls, [0, 1, 2, 3])
  assert.ok(blueprint.nodes.some((node) => node.data.kind === 'register_menu' && node.data.config.path === 'Capture Target/Display 1'))
  assert.ok(blueprint.nodes.filter((node) => node.data.kind === 'register_control').every((node) => !('menu' in node.data.config.control)))
  assert.deepEqual(restored.tabs.map(({ id }) => id), ['overview', 'blueprint'])
})

test('Blueprint pin colors and primitive value types match Unreal pin categories', () => {
  const pinTypes = ['flow', 'boolean', 'byte', 'class', 'integer', 'integer64', 'float', 'double', 'name', 'delegate', 'object', 'soft_object', 'soft_class', 'interface', 'string', 'text', 'struct', 'value', 'vector', 'rotator', 'transform']
  assert.deepEqual(pinTypes.map(pinTypeColor), ['#FFFFFF', '#950000', '#006F65', '#5900BC', '#1FE3AF', '#ACE3AF', '#A1FF45', '#38D500', '#CD82FF', '#FF3838', '#00AAF5', '#95FFFF', '#FF95FF', '#F1FFAA', '#FF00D4', '#E77CAA', '#0059CB', '#817A7A', '#FFCA23', '#A0B4FF', '#FF7300'])
  assert.equal(pinTypeColor('region'), pinTypeColor('struct'))
  assert.equal(pinTypeColor('path'), pinTypeColor('string'))
  assert.equal(pinTypeColor('video_frames'), pinTypeColor('object'))
  assert.deepEqual([pinTypeForValue(false), pinTypeForValue(4), pinTypeForValue(4.5), pinTypeForValue('Record')], ['boolean', 'integer', 'float', 'string'])
})

test('legacy nested menus migrate to one registration node per slash-separated path', () => {
  const document = serializeBlueprint(createBlueprint('capture-test', 'Capture test'))
  const oldMenuNodes = new Set(document.nodes.filter((node) => node.data.kind === 'register_menu').map((node) => node.id))
  document.nodes = document.nodes.filter((node) => !oldMenuNodes.has(node.id))
  document.edges = document.edges.filter((edge) => !oldMenuNodes.has(edge.source) && !oldMenuNodes.has(edge.target))
  document.nodes = document.nodes.map((node) => node.id === 'register-select' ? {
    ...node,
    data: { ...node.data, config: { ...node.data.config, control: { ...node.data.config.control, menu: [{
      id: 'target', label: 'Capture Target', icon: 'monitor', eventId: 'event-select-display', children: [
        { id: 'display-1', label: 'Display 1', icon: 'monitor', eventId: 'event-select-display-1' },
      ],
    }] } } },
  } : node)

  const restored = hydrateBlueprint(document, 'user', 'revision-token')
  const registrations = restored.nodes.filter((node) => node.data.kind === 'register_menu')

  assert.deepEqual(registrations.map((node) => node.data.config.path), ['Capture Target', 'Capture Target/Display 1'])
  assert.ok(restored.nodes.find((node) => node.id === 'register-select').data.config.control.menu === undefined)
  assert.ok(restored.edges.some((edge) => edge.source === 'register-stop' && edge.target === registrations[0].id))
})

test('older blueprints infer a visual Order from their registration sequence', () => {
  const document = serializeBlueprint(createBlueprint('capture-test', 'Capture test'))
  document.nodes = document.nodes.map((node) => {
    if (node.data.kind !== 'register_control') return node
    const control = { ...node.data.config.control }
    delete control.order
    return { ...node, data: { ...node.data, config: { ...node.data.config, control } } }
  })
  const restored = hydrateBlueprint(document, 'builtin', 'revision-token')

  assert.deepEqual(restored.nodes.filter((node) => node.data.kind === 'register_control').map((node) => node.data.config.control.order), [0, 1, 2, 3])
})

test('transient React Flow selection and dragging state do not dirty a blueprint', () => {
  const blueprint = createBlueprint('capture-test', 'Capture test')
  const edited = { ...blueprint, nodes: blueprint.nodes.map((node, index) => index === 0 ? { ...node, selected: true, dragging: true, resizing: true, measured: { width: 100, height: 80 }, width: 100, height: 80 } : node) }

  assert.deepEqual(serializeBlueprint(edited), serializeBlueprint(blueprint))
})

test('event library stays in sync with Event nodes and drops deleted events', () => {
  const blueprint = createBlueprint('capture-test', 'Capture test')
  const customEvent = { ...blueprint.nodes.find((node) => node.data.kind === 'event'), id: 'event-custom', data: { kind: 'event', label: 'On Custom Event', config: { eventId: 'event-custom' } } }
  const nodes = [...blueprint.nodes.map((node) => node.data.config?.eventId === 'event-start' ? { ...node, data: { ...node.data, label: 'On Recording Start' } } : node), customEvent]
  const synced = syncBlueprintEvents({ ...blueprint, nodes, events: [...blueprint.events, { id: 'orphan', name: 'Orphan', folderId: 'recording' }], selection: { kind: 'event', key: 'event-start' } })

  assert.deepEqual(synced.events.map(({ id, name }) => [id, name]), nodes.filter((node) => node.data.kind === 'event').map((node) => [node.data.config.eventId, node.data.label]))
  assert.equal(synced.events.some(({ id }) => id === 'orphan'), false)
  assert.equal(syncBlueprintEvents({ ...synced, nodes: nodes.filter((node) => node.data.config?.eventId !== 'event-start') }).selection, null)
})

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
  assert.equal(screen.overviewLayouts.wide[0].h, 9)
  assert.equal(screen.overviewLayouts.wide[1].h, 8)
  assert.equal(overviewCardContentHeight([], allParameters(screen)), 112)
  assert.deepEqual([overviewGridHeight(172), overviewGridHeight(145)], [9, 8])
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

    if (breakpoint === 'wide') {
      assert.deepEqual([videoAfter.x, videoAfter.y], [audioBefore.x, audioBefore.y])
      assert.deepEqual([audioAfter.x, audioAfter.y], [videoBefore.x, videoBefore.y])
    } else {
      assert.ok(audioAfter.y < videoAfter.y, 'the swapped cards should reverse their order in the single-column layout')
    }
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

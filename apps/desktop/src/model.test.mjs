import assert from 'node:assert/strict'
import test from 'node:test'
import { verticalCompactor } from 'react-grid-layout'
import { allParameters, createBlueprint, hydrateBlueprint, moveOverviewCardVertically, moveParameterLayout, overviewCardContentHeight, overviewGridHeight, pinTypeColor, pinTypeForValue, placeOverviewCardBeside, serializeBlueprint, swapOverviewCardPositions, syncBlueprintEvents } from './model.ts'
import { connectedNodeIds, ribbonOffsets, routePoints, roundedPath } from './graph-interactions.ts'
import { overviewCollisionDetection, overviewDropPlacement } from './overview-dnd.ts'
import { hitRegion, handlePoint, handles, selectionRect, transformRegion, dockRegion, expandToolbar, editRegionField, elapsedText } from './region-geometry.ts'

test('only square handles resize; the rest of the border moves and the interior passes through', () => {
  const r = { x: 100, y: 100, width: 400, height: 300 }
  for (const h of handles) {
    const p = handlePoint(r, h)
    assert.equal(hitRegion(r, p.x + 5, p.y + 5, 1), h)
  }
  assert.equal(hitRegion(r, 150, 100, 1), 'move')
  assert.equal(hitRegion(r, 500, 150, 1), 'move')
  assert.equal(hitRegion(r, 300, 250, 1), null)
  assert.equal(hitRegion(r, 150, 95, 1), null)
  assert.equal(hitRegion(r, 105, 105, 2.25), 'nw')
})

test('region operations stay within display bounds and retain aspect ratio', () => {
  const r = { x: 100, y: 100, width: 400, height: 300 }
  const bounds = { x: 0, y: 0, width: 1920, height: 1080 }
  assert.deepEqual(selectionRect({x:100,y:100},{x:9999,y:9999},bounds),{x:100,y:100,width:1820,height:980})
  assert.deepEqual(selectionRect({x:100,y:100},{x:-99,y:-99},bounds),{x:0,y:0,width:100,height:100})
  for (const h of [...handles, 'move']) for (const delta of [-5000, -50, 50, 5000]) {
    const next = transformRegion(r, h, delta, delta, bounds)
    assert.ok(next.x >= 0 && next.y >= 0 && next.x + next.width <= 1920 && next.y + next.height <= 1080)
    assert.ok(next.width >= 16 && next.height >= 16)
  }
  const next = transformRegion(r, 'se', 100, 0, bounds, 4/3)
  assert.ok(Math.abs(next.width/next.height - 4/3) < 0.01)
  assert.deepEqual(transformRegion(r, 'move', -500, -500, bounds), { ...r, x: 0, y: 0 })
})

test('toolbar docks inside the work area, avoids the top edge and uses hysteresis', () => {
  const work = { x: 0, y: 0, width: 1920, height: 1040 }
  const r = { x: 100, y: 0, width: 1280, height: 720 }
  assert.equal(dockRegion(r, work, 700, 56, 8).side, 1)
  const full = dockRegion({ x: 0, y: 0, width:1920,height:1080 }, work, 700, 56, 8)
  assert.equal(full.side, 2)
  for (const x of [0, 1800]) for (const y of [0,1000]) {
    const dock = dockRegion({ ...r, x, y }, work, 700, 400, 8)
    assert.ok(dock.x >= 0 && dock.y >= 0 && dock.x+700 <= 1920 && dock.y+400 <= 1040)
  }
  assert.equal(dockRegion({ ...r, y: 200 }, work, 700, 56, 8, 1).side, 1)
  assert.equal(elapsedText(3_661_900), '01:01:01')
})

test('default recording UI is registered by blueprint and reads a live selected region', () => {
  const doc = serializeBlueprint(createBlueprint('test', 'Test'))
  assert.ok(doc.nodes.some(n => n.data.kind === 'select_region'))
  assert.ok(doc.nodes.some(n => n.data.kind === 'get_selected_region'))
  assert.deepEqual(doc.nodes.filter(n => n.data.kind === 'register_display').map(n => n.data.config.display.source), ['status', 'elapsed'])
  assert.deepEqual(doc.nodes.find(n => n.id === 'register-start').data.config.control.targets, ['main', 'region:capture-region'])
  assert.equal(doc.values.regionMode, 'Selected Region')
  assert.equal('_selectedRegions' in doc, false)
})

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

test('recording templates connect editable parameters to the real silent pipeline', () => {
  const blueprint = createBlueprint('recording', 'Recording')
  assert.equal(typeof blueprint.values.fps, 'number')
  assert.equal(typeof blueprint.values.width, 'number')
  assert.equal(blueprint.values.encodingMode, 'Hardware Auto')
  assert.equal(blueprint.nodes.find(node => node.id === 'encode').data.config.encoder, 'H.264')
  assert.equal(blueprint.edges.some(edge => edge.target === 'encode' && edge.targetHandle === 'in:audio'), false)
  for (const [target, field, parameter] of [['region', 'width', 'width'], ['encode', 'fps', 'fps'], ['path', 'directory', 'output']]) {
    const reader = blueprint.nodes.find(node => node.data.kind === 'read_parameter' && node.data.config.parameterId === parameter)
    assert.ok(blueprint.edges.some(edge => edge.source === reader.id && edge.target === target && edge.targetHandle === `in:param:${field}`))
  }
  assert.equal(hydrateBlueprint(serializeBlueprint(blueprint), 'user', 'v1').values.width, 897)
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
  for (const item of screen.overviewLayouts.wide) {
    assert.equal(item.h, overviewGridHeight(overviewCardContentHeight(screen.layouts[item.i].filter((row) => row.pinned), allParameters(screen))))
  }
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
      assert.equal(videoAfter.x, audioBefore.x)
      assert.equal(audioAfter.x, videoBefore.x)
      assert.ok(audioAfter.y < videoAfter.y, 'the tall capture card may compact the other column independently')
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


test('function graphs persist independently and discard transient node state', () => {
  const blueprint = createBlueprint('functions-test', 'Functions test')
  const node = { ...structuredClone(blueprint.nodes[0]), selected: true, measured: { width: 100, height: 60 } }
  blueprint.functions[0].graph = { nodes: [node], edges: [] }
  const document = serializeBlueprint(blueprint)
  const restored = hydrateBlueprint(document, 'user', 'revision')
  assert.equal(restored.functions[0].graph.nodes.length, 1)
  assert.equal('selected' in document.functions[0].graph.nodes[0], false)
  assert.equal('measured' in document.functions[0].graph.nodes[0], false)
  assert.deepEqual(restored.nodes, serializeBlueprint(blueprint).nodes)
  assert.equal(hydrateBlueprint({ ...document, functions: [{ id: 'legacy', name: 'Legacy', folderId: 'utilities' }] }, 'user', 'revision').functions[0].graph, undefined)
})


test('selection relevance traverses both directions, cycles and multiple components', () => {
  const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'c', target: 'a' }, { source: 'd', target: 'e' }]
  assert.deepEqual([...connectedNodeIds(['b'], edges)].sort(), ['a', 'b', 'c'])
  assert.equal(connectedNodeIds(['b', 'd'], edges).size, 5)
  assert.equal(connectedNodeIds([], edges).size, 0)
})

test('routing points round trip without changing executable edge endpoints', () => {
  const blueprint = createBlueprint('route-test', 'Routing test')
  const edge = blueprint.edges[0]
  edge.data = { routePoints: [{ x: 12, y: 34 }, { x: -10, y: 99 }] }
  const restored = hydrateBlueprint(serializeBlueprint(blueprint), 'user', 'revision')
  assert.deepEqual(restored.edges[0], edge)
  assert.deepEqual(routePoints({ routePoints: [null, { x: Infinity, y: 2 }, { x: 1, y: 2 }] }), [{ x: 1, y: 2 }])
})

test('rounded Subway paths retain 45 degree straight sections and soften their junctions', () => {
  for (const end of [{ x: 300, y: 100 }, { x: 50, y: 300 }, { x: 300, y: -100 }, { x: 300, y: 0 }, { x: 0, y: 100 }, { x: -100, y: 0 }, { x: -100, y: -100 }, { x: 0, y: 0 }]) {
    const path = roundedPath({ x: 0, y: 0 }, end)
    assert.ok(!/NaN|Infinity|C/.test(path))
    const values = path.match(/-?\d+(?:\.\d+)?/g).map(Number)
    assert.deepEqual(values.slice(0, 2), [0, 0])
    assert.deepEqual(values.slice(-2), [end.x, end.y])
    let previous = [0, 0]
    for (const segment of path.matchAll(/([LQ]) ([\d. -]+)/g)) {
      const coordinates = segment[2].trim().split(/\s+/).map(Number)
      if (segment[1] === 'L') {
        const dx = Math.abs(coordinates[0] - previous[0])
        const dy = Math.abs(coordinates[1] - previous[1])
        assert.ok(dx < 1e-8 || dy < 1e-8 || Math.abs(dx - dy) < 1e-8, path)
      }
      previous = coordinates.slice(-2)
    }
  }
  assert.match(roundedPath({ x: 0, y: 0 }, { x: 300, y: 100 }), /Q/)
  assert.equal(roundedPath({ x: 0, y: 0 }, { x: 300, y: 0 }).includes('Q'), false)
  for (const end of [{ x: 300, y: 100 }, { x: 4, y: 2 }]) {
    const path = roundedPath({ x: 0, y: 0 }, end)
    let previous = [0, 0]
    let diagonal = false
    for (const segment of path.matchAll(/([LQ]) ([\d. -]+)/g)) {
      const values = segment[2].trim().split(/\s+/).map(Number)
      if (segment[1] === 'L' && Math.abs(values[0] - previous[0]) > 1e-8 && Math.abs(values[1] - previous[1]) > 1e-8) diagonal = true
      previous = values.slice(-2)
    }
    assert.ok(diagonal && path.includes('Q'), 'both a diagonal straight section and curved junctions must remain')
  }
})

test('Ribbon separates overlapping corridors deterministically and reuses clear lanes', () => {
  const routes = [
    { id: 'a', start: { x: 0, y: 500 }, end: { x: 400, y: 0 } },
    { id: 'b', start: { x: 0, y: 540 }, end: { x: 400, y: 40 } },
    { id: 'c', start: { x: 0, y: 580 }, end: { x: 400, y: 80 } },
    { id: 'd', start: { x: 0, y: 800 }, end: { x: 400, y: 900 } },
  ]
  const offsets = ribbonOffsets(routes)
  assert.equal(new Set(['a', 'b', 'c'].map(id => offsets.get(id))).size, 3)
  assert.equal(offsets.get('d'), 0)
  assert.deepEqual(ribbonOffsets([...routes].reverse()), offsets)
  for (const route of routes) {
    const path = roundedPath(route.start, route.end, offsets.get(route.id))
    assert.ok(path.startsWith(`M ${route.start.x} ${route.start.y}`))
    assert.ok(path.endsWith(`L ${route.end.x} ${route.end.y}`))
  }
  const aligned = { start: { x: 0, y: 0 }, end: { x: 400, y: 0 } }
  const alignedOffsets = ribbonOffsets([{ id: 'a', ...aligned }, { id: 'b', ...aligned }])
  assert.notEqual(roundedPath(aligned.start, aligned.end, alignedOffsets.get('a')), roundedPath(aligned.start, aligned.end, alignedOffsets.get('b')))
})

test('ordered parameter fans retain non-crossing curved Subway paths in both directions', () => {
  const polyline = path => {
    const tokens = path.match(/[MLQ]|-?(?:\d*\.?\d+)(?:e[+-]?\d+)?/gi)
    const points = []
    let p = { x: 0, y: 0 }
    for (let i = 0; i < tokens.length;) {
      const command = tokens[i++]
      const a = { x: Number(tokens[i++]), y: Number(tokens[i++]) }
      const end = command === 'Q' ? { x: Number(tokens[i++]), y: Number(tokens[i++]) } : a
      if (command === 'Q') for (let n = 1; n < 12; n++) {
        const t = n / 12
        points.push({ x: (1 - t) ** 2 * p.x + 2 * (1 - t) * t * a.x + t * t * end.x, y: (1 - t) ** 2 * p.y + 2 * (1 - t) * t * a.y + t * t * end.y })
      }
      points.push(end); p = end
    }
    return points.slice(1).map((point, i) => [points[i], point])
  }
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  for (const sign of [-1, 1]) {
    const routes = ['z', 'a', 'x', 'b', 'c'].map((id, i) => ({ id, start: { x: 0, y: sign * (100 + i * 120) }, end: { x: 120, y: sign * i * 24 } }))
    const offsets = ribbonOffsets(routes)
    assert.deepEqual(ribbonOffsets([...routes].reverse()), offsets)
    const paths = routes.map(route => polyline(roundedPath(route.start, route.end, offsets.get(route.id))))
    for (let i = 0; i < paths.length; i++) for (const other of paths.slice(i + 1)) for (const [a, b] of paths[i]) for (const [c, d] of other) {
      assert.ok(!(cross(a, b, c) * cross(a, b, d) < -1e-6 && cross(c, d, a) * cross(c, d, b) < -1e-6), 'ordered fan curves must not intersect')
    }
  }
})

test('expanding a toolbar preserves its anchor and stays within the work area', () => {
  const work = {x:0,y:0,width:1920,height:1080}
  for (const y of [8,200,600,1016]) {
    const dock = {x:100,y,side:0}
    const expanded = expandToolbar(dock, work, 56, 410, 4)
    assert.equal(expanded.y + expanded.offset, y)
    assert.ok(expanded.y >= work.y)
    assert.ok(expanded.y + expanded.height <= work.height)
    assert.ok(expanded.height >= 56)
  }
})

test('region fields use display percentages and preserve opposite edges', () => {
  const bounds = {x:0,y:0,width:1920,height:1080}, r = {x:100,y:100,width:600,height:300}
  assert.deepEqual(editRegionField(r,bounds,'centerX',50,'%'), {...r,x:660})
  assert.deepEqual(editRegionField(r,bounds,'height',50,'%'), {...r,height:540})
  assert.deepEqual(editRegionField(r,bounds,'minX',200,'px'), {...r,x:200,width:500})
  assert.deepEqual(editRegionField(r,bounds,'maxY',500,'px'), {...r,height:400})
  assert.deepEqual(editRegionField(r,bounds,'height',200,'px',2), {...r,width:400,height:200})
  const dock = dockRegion({x:200,y:650,width:800,height:200}, bounds,760,56,8)
  assert.ok(expandToolbar(dock,bounds,56,410,4).offset > 0)
})

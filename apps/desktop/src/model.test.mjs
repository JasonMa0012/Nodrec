import assert from 'node:assert/strict'
import { copyNamedValues } from './model.ts'
import { controlOrder, insertControl, reorderControls, setControlTargets, dropNodeShortcut, removeNodeShortcut, reconcileNodeShortcuts } from './control-order.ts'
import test from 'node:test'
import { createNodeControl } from './model.ts'
import { connectedInputValue, parameterSources } from './model.ts'
import { selectBlueprintGraph } from './model.ts'

test('default graph explicitly connects region selection to the capture path',()=>{
  const graph=createBlueprint('region-connection','Region')
  const link=graph.edges.find(edge=>edge.source==='log-select-region'&&edge.target==='selected-region')
  assert.equal(link?.sourceHandle,'out:region')
  assert.equal(link?.targetHandle,'in:selected')
  assert.ok(graph.edges.some(edge=>edge.source==='region'&&edge.target==='selected-region'&&edge.targetHandle==='in:fallback'))
  assert.ok(graph.edges.some(edge=>edge.source==='selected-region'&&edge.target==='screen'&&edge.targetHandle==='in:region'))
})

test('toolbar shortcuts deduplicate node actions and remove only the displayed target', () => {
  const blueprint=createBlueprint('shortcut-test','Shortcuts')
  const original=structuredClone(blueprint)
  const binding=blueprint.controls.find(control=>control.id==='start-recording').binding
  const removed=removeNodeShortcut(blueprint,'start-recording','main')
  assert.deepEqual(removed.controls.find(control=>control.id==='start-recording').targets,['region:capture-region'])
  assert.deepEqual(removed.nodes,blueprint.nodes)
  const restored=dropNodeShortcut(removed,binding,'main','ignored-id','select-region',false)
  assert.deepEqual(restored.controlOrder.main,['start-recording','select-region','recording-status','recording-time'])
  assert.equal(restored.controls.length,blueprint.controls.length)
  assert.equal(dropNodeShortcut(restored,binding,'main','duplicate-id').controls.length,blueprint.controls.length)
  assert.deepEqual(dropNodeShortcut(restored,binding,'main','duplicate-id','start-recording').controlOrder,restored.controlOrder)
  assert.equal(dropNodeShortcut(blueprint,{...binding,nodeId:'missing'},'main','invalid'),blueprint)
  assert.deepEqual(blueprint,original)
})

test('read-only shortcuts belong to capture nodes and share toolbar ordering without duplicating',()=>{
  const blueprint=createBlueprint('display-shortcuts','Displays')
  const display=blueprint.displays[0]
  const binding={...display.binding,source:display.source}
  const removed=removeNodeShortcut(blueprint,display.id,'main')
  assert.deepEqual(removed.displays[0].targets,['region:capture-region'])
  const moved=dropNodeShortcut(removed,binding,'main','ignored','select-region',false)
  assert.equal(moved.controlOrder.main[0],display.id)
  assert.equal(moved.displays.length,2)
  assert.deepEqual(hydrateBlueprint(serializeBlueprint(moved),'user','v').controlOrder,moved.controlOrder)
  const erased=removeNodeShortcut(removeNodeShortcut(moved,display.id,'main'),display.id,'region:capture-region')
  assert.equal(erased.displays.length,1)
  assert.deepEqual(erased.nodes,blueprint.nodes)
  assert.equal(dropNodeShortcut(blueprint,{graphId:'recording',nodeId:'log-select-region',action:'select',source:'status'},'main','invalid'),blueprint)
  const legacy=serializeBlueprint(blueprint)
  legacy.displays.forEach(display=>delete display.binding)
  legacy.controlOrder.main=legacy.controlOrder.main.filter(id=>!id.startsWith('recording-'))
  const loaded=hydrateBlueprint(legacy,'user','v')
  assert.equal(loaded.displays[0].binding.nodeId,'screen')
  assert.ok(loaded.controlOrder.main.includes('recording-status'))
})

test('deleting a source node removes its shortcuts and obsolete toolbar targets', () => {
  const blueprint=createBlueprint('shortcut-cleanup','Cleanup')
  const withoutCapture=reconcileNodeShortcuts({...blueprint,nodes:blueprint.nodes.filter(node=>node.data.kind!=='screen')})
  assert.ok(!withoutCapture.controls.some(control=>control.binding.action==='record'))
  assert.ok(!withoutCapture.controlOrder.main.includes('start-recording'))
  assert.equal(withoutCapture.displays.length,0)
  assert.ok(!withoutCapture.controlOrder.main.includes('recording-status'))
  const withoutTool=reconcileNodeShortcuts({...blueprint,nodes:blueprint.nodes.filter(node=>node.data.kind!=='select_region')})
  assert.deepEqual(withoutTool.controls.find(control=>control.id==='start-recording').targets,['main'])
  assert.ok(!('region:capture-region' in withoutTool.controlOrder))
  assert.ok(withoutTool.displays.every(display=>display.targets.every(target=>target==='main')))
})

test('graph navigation preserves serialized order and edits only the chosen graph', () => {
  const original = createBlueprint('graph-navigation','Graphs')
  original.additionalGraphs = [{id:'second',name:'Second',nodes:structuredClone(original.nodes),edges:structuredClone(original.edges)}]
  original.graphOrder.push('second')
  const before = serializeBlueprint(original)
  const selected = selectBlueprintGraph(original,'second')
  assert.equal(selected.graphId,'second')
  assert.deepEqual(serializeBlueprint(selected),before)
  assert.equal(acceptBlueprintEdit(original,selected,true),selected)
  selected.nodes = selected.nodes.map(node=>({...node,data:{...node.data,label:'Changed in second'}}))
  const returned = selectBlueprintGraph(selected,'recording')
  assert.deepEqual(returned.nodes,original.nodes)
  assert.equal(serializeBlueprint(returned).graphs[1].nodes[0].data.label,'Changed in second')
  assert.equal(selectBlueprintGraph(returned,'missing'),returned)
})

test('saving preserves graph identities and graphs outside the current editor', () => {
  const document = serializeBlueprint(createBlueprint('graph-ids','Graph IDs'))
  document.graphs[0].id = 'custom-capture'
  document.graphs[0].name = 'Custom Capture'
  document.controls.forEach(control => { control.binding.graphId = 'custom-capture' })
  document.graphs.push({id:'another-capture',name:'Another Capture',nodes:[],edges:[]})
  const blueprint = hydrateBlueprint(document,'user','revision')
  blueprint.controls.push(createNodeControl(blueprint.nodes.find(node=>node.data.kind==='screen'),'main','added',blueprint.graphId))
  const saved = serializeBlueprint(blueprint)
  assert.deepEqual(saved.graphs,document.graphs)
  assert.ok(saved.controls.every(control=>control.binding.graphId==='custom-capture'))
  assert.equal('graphId' in saved,false)
  assert.equal('additionalGraphs' in saved,false)
  assert.equal('graphName' in saved,false)
})

test('wired fields show their source while preserving local values for disconnection', () => {
  const blueprint = createBlueprint('sources','Sources')
  const capture = blueprint.nodes.find(node => node.id === 'screen')
  const before = structuredClone(capture.data.config)
  assert.deepEqual(parameterSources(blueprint,['screen'],'fps'),['Read fps · value'])
  blueprint.edges = blueprint.edges.filter(edge => !(edge.target === 'screen' && edge.targetHandle === 'in:param:fps'))
  assert.deepEqual(parameterSources(blueprint,['screen'],'fps'),['Local value'])
  assert.deepEqual(capture.data.config,before)
  blueprint.edges.push({source:'missing',sourceHandle:'out:value',target:'screen',targetHandle:'in:param:fps'})
  assert.deepEqual(parameterSources(blueprint,['screen'],'fps'),['Missing node (missing) · value'])
  assert.deepEqual(parameterSources(blueprint,['screen','region'],'fps'),['Missing node (missing) · value','Local value'])
})

test('domain inputs show their source and keep local structured values after disconnecting', () => {
  const blueprint = createBlueprint('domain-source','Sources')
  const capture = blueprint.nodes.find(node=>node.data.kind==='screen')
  capture.data.config.region={display:'Display 1',mode:'Rectangle',x:10,y:20,width:640,height:480}
  const before=structuredClone(capture.data.config.region)
  assert.notDeepEqual(parameterSources(blueprint,[capture.id],'region'),['Local value'])
  blueprint.edges=blueprint.edges.filter(edge=>!(edge.target===capture.id&&edge.targetHandle==='in:region'))
  assert.deepEqual(parameterSources(blueprint,[capture.id],'region'),['Local value'])
  assert.deepEqual(capture.data.config.region,before)
})

test('changing control targets preserves independent orders and appends newly visible controls', () => {
  const blueprint = createBlueprint('target-test','Targets')
  blueprint.displays=[]
  blueprint.controlOrder={main:['select-region','start-recording'],'region:capture-region':['start-recording']}
  const before = structuredClone(blueprint)
  const both = setControlTargets(blueprint,'select-region',['main','region:capture-region'])
  assert.deepEqual(both.controlOrder.main,['select-region','start-recording'])
  assert.deepEqual(both.controlOrder['region:capture-region'],['start-recording','select-region'])
  const hidden = setControlTargets(both,'select-region',[])
  assert.deepEqual(hidden.controlOrder.main,['start-recording'])
  assert.deepEqual(hidden.controlOrder['region:capture-region'],['start-recording'])
  assert.deepEqual(setControlTargets(hidden,'select-region',['main']).controlOrder.main,['start-recording','select-region'])
  assert.deepEqual(blueprint,before)
})

test('control drop inserts on the indicated side in either direction', () => {
  const ids = ['a','b','c','d']
  assert.deepEqual(insertControl(ids,'a','c',false),['b','a','c','d'])
  assert.deepEqual(insertControl(ids,'a','c',true),['b','c','a','d'])
  assert.deepEqual(insertControl(ids,'d','b',false),['a','d','b','c'])
  assert.deepEqual(insertControl(ids,'d','b',true),['a','b','d','c'])
  assert.deepEqual(insertControl(ids,'a','a',true),ids)
  assert.deepEqual(insertControl(ids,'missing','b',true),ids)
  assert.deepEqual(ids,['a','b','c','d'])
})

test('new controls bind node actions and persist without geometry', () => {
  const blueprint = createBlueprint('controls-test','Controls')
  const source = blueprint.nodes.find(node => node.data.kind === 'screen')
  const control = createNodeControl(source,'main','new-record')
  assert.deepEqual(control.binding,{graphId:'recording',nodeId:source.id,action:'record'})
  assert.deepEqual(control.targets,['main'])
  assert.equal('width' in control,false)
  assert.equal('position' in control,false)
  blueprint.controls.push(control)
  assert.deepEqual(hydrateBlueprint(serializeBlueprint(blueprint),'user','revision').controls.at(-1),control)
  blueprint.controls.at(-1).order = 99
  assert.equal('order' in serializeBlueprint(blueprint).controls.at(-1),false)
  blueprint.controls.at(-1).error='Runtime only'
  assert.equal('error' in serializeBlueprint(blueprint).controls.at(-1),false)
  const writer = blueprint.nodes.find(node => node.data.kind === 'write')
  assert.throws(() => createNodeControl(writer,'main','invalid'),/no control action/)
})
import { outputStatusText } from './output-status.ts'

test('output status preserves partial failures after completion', () => {
  const output = {path:'main.mp4',partialPath:'main.partial.mp4',finished:false,error:null}
  assert.equal(outputStatusText(output),'Writing')
  assert.equal(outputStatusText({...output,finished:true}),'Saved')
  assert.equal(outputStatusText({...output,finished:true,error:'Publish failed'}),'Failed')
})
import { acceptBlueprintEdit } from './model.ts'

test('running blueprints allow navigation but reject executable edits', () => {
  const current = createBlueprint('locked', 'Locked')
  const navigate = {...current,activeTab:'blueprint',selection:{kind:'node',key:'screen'}}
  assert.equal(acceptBlueprintEdit(current,navigate,true),navigate)
  const parameter = {...current,values:{...current.values,fps:30}}
  assert.equal(acceptBlueprintEdit(current,parameter,true),current)
  assert.equal(acceptBlueprintEdit(current,parameter,false),parameter)
  const reorder = {...current,controlOrder:{main:['changed']}}
  assert.equal(acceptBlueprintEdit(current,reorder,true),current)
})

test('V2 stores graph arrays and rejects legacy top-level graph documents', () => {
  const document = serializeBlueprint(createBlueprint('v2', 'V2'))
  assert.equal(document.schemaVersion, 2)
  assert.equal('nodes' in document, false)
  assert.equal('edges' in document, false)
  assert.equal(document.graphs[0].id, 'recording')
  assert.throws(() => hydrateBlueprint({...document,schemaVersion:1},'user','revision'), /Unsupported blueprint/)
})

test('copying named values remaps internal references and keeps external references', () => {
  const definition = { id: 'definition', position: { x:0,y:0 }, data: { kind:'define_value', config:{name:'Answer'} } }
  const reader = { id: 'reader', position: {x:0,y:0}, data: {kind:'read_value',config:{definitionId:'definition'}} }
  const existing = [definition, {...definition,id:'another',data:{...definition.data,config:{name:'Answer 2'}}}]
  const [copiedDefinition,copiedReader] = copyNamedValues([definition,reader],existing,new Map([['definition','new-definition'],['reader','new-reader']]))
  assert.equal(copiedDefinition.data.config.name,'Answer 3')
  assert.equal(copiedReader.data.config.definitionId,'new-definition')
  assert.equal(copyNamedValues([reader],existing,new Map([['reader','new-reader']]))[0].data.config.definitionId,'definition')
  assert.equal(definition.data.config.name,'Answer')
  assert.equal(reader.data.config.definitionId,'definition')
})

test('control ordering is independent per display target and persists', () => {
  const blueprint = createBlueprint('ordered', 'Ordered')
  blueprint.displays=[]
  blueprint.controlOrder = { main: ['record', 'region'], 'region:capture-region': ['region', 'record'] }
  const moved = reorderControls(blueprint.controlOrder.main, 'region', 'record')
  assert.deepEqual(moved, ['region', 'record'])
  assert.deepEqual(blueprint.controlOrder.main, ['record', 'region'])
  assert.deepEqual(reorderControls(moved, 'missing', 'record'), moved)
  assert.equal(controlOrder({ id: 'record', order: 7 }, moved), 1)
  assert.deepEqual(hydrateBlueprint(serializeBlueprint(blueprint), 'user', 'revision').controlOrder, blueprint.controlOrder)
})
import { verticalCompactor } from 'react-grid-layout'
import { allParameters, createBlueprint, hydrateBlueprint, moveOverviewCardVertically, moveParameterLayout, overviewCardContentHeight, overviewGridHeight, pinTypeColor, pinTypeForValue, placeOverviewCardBeside, serializeBlueprint, swapOverviewCardPositions } from './model.ts'
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
  assert.ok(doc.graphs[0].nodes.some(n => n.data.kind === 'select_region'))
  assert.ok(doc.graphs[0].nodes.some(n => n.data.kind === 'get_selected_region'))
  assert.deepEqual(doc.displays.map(display => display.source), ['status', 'elapsed'])
  assert.deepEqual(doc.controls.find(control => control.id === 'start-recording').targets, ['main', 'region:capture-region'])
  assert.equal(doc.values.regionMode, 'Selected Region')
  assert.equal('_selectedRegions' in doc, false)
})

test('blueprint documents persist workflow graphs and controls, but reset editor and runtime state', () => {
  const blueprint = createBlueprint('capture-test', 'Capture test')
  blueprint.recordState = 'recording'
  blueprint.selectedNode = 'pipeline-start'
  const document = serializeBlueprint(blueprint)
  const restored = hydrateBlueprint(document, 'builtin', 'revision-token')

  assert.equal(document.schemaVersion, 2)
  assert.equal('recordState' in document, false)
  assert.deepEqual(restored.nodes, blueprint.nodes)
  assert.deepEqual(restored.edges, blueprint.edges)
  assert.equal(restored.recordState, 'ready')
  assert.equal(restored.selectedNode, null)
  assert.equal(restored.revision, 'revision-token')
  assert.ok(restored.controls.some(control => control.binding?.action === 'record'))
})

test('recording templates connect editable parameters to the real silent pipeline', () => {
  const blueprint = createBlueprint('recording', 'Recording')
  assert.equal(typeof blueprint.values.fps, 'number')
  assert.equal(typeof blueprint.values.width, 'number')
  assert.equal(blueprint.values.encodingMode, 'Hardware Auto')
  assert.equal(blueprint.nodes.find(node => node.id === 'encode_media_foundation').data.config.codec, 'H.264')
  assert.equal(blueprint.edges.some(edge => edge.target === 'encode_media_foundation' && edge.targetHandle === 'in:audio'), false)
  for (const [target, field, parameter] of [['region', 'width', 'width'], ['screen', 'fps', 'fps'], ['path', 'directory', 'output']]) {
    const reader = blueprint.nodes.find(node => node.data.kind === 'read_parameter' && node.data.config.parameterId === parameter)
    assert.ok(blueprint.edges.some(edge => edge.source === reader.id && edge.target === target && edge.targetHandle === `in:param:${field}`))
  }
  assert.equal(hydrateBlueprint(serializeBlueprint(blueprint), 'user', 'v1').values.width, 897)
})

test('workspaces open both editor tabs and registered controls carry explicit sort order', () => {
  const blueprint = createBlueprint('capture-test', 'Capture test')
  const controls = blueprint.controls.map(control => control.id)
  const restored = hydrateBlueprint(serializeBlueprint(blueprint), 'user', 'revision-token')

  assert.deepEqual(blueprint.tabs.map(({ id }) => id), ['overview', 'blueprint'])
  assert.equal(blueprint.activeTab, 'overview')
  assert.equal(restored.activeTab, 'overview')
  assert.deepEqual(controls, ['select-region','start-recording'])
  assert.ok(blueprint.nodes.every(node => !['event','register_control','update_control','register_menu'].includes(node.data.kind)))
  assert.ok(blueprint.nodes.filter((node) => node.data.kind === 'register_control').every((node) => !('menu' in node.data.config.control)))
  assert.deepEqual(restored.tabs.map(({ id }) => id), ['overview', 'blueprint'])
})

test('Blueprint pin colors and primitive value types match Unreal pin categories', () => {
  const pinTypes = ['boolean', 'byte', 'class', 'integer', 'integer64', 'float', 'double', 'name', 'delegate', 'object', 'soft_object', 'soft_class', 'interface', 'string', 'text', 'struct', 'value', 'vector', 'rotator', 'transform']
  assert.deepEqual(pinTypes.map(pinTypeColor), ['#950000', '#006F65', '#5900BC', '#1FE3AF', '#ACE3AF', '#A1FF45', '#38D500', '#CD82FF', '#FF3838', '#00AAF5', '#95FFFF', '#FF95FF', '#F1FFAA', '#FF00D4', '#E77CAA', '#0059CB', '#817A7A', '#FFCA23', '#A0B4FF', '#FF7300'])
  assert.equal(pinTypeColor('region'), pinTypeColor('struct'))
  assert.equal(pinTypeColor('path'), pinTypeColor('string'))
  assert.equal(pinTypeColor('video_frames'), pinTypeColor('object'))
  assert.deepEqual([pinTypeForValue(false), pinTypeForValue(4), pinTypeForValue(4.5), pinTypeForValue('Record')], ['boolean', 'integer', 'float', 'string'])
})


test('transient React Flow selection and dragging state do not dirty a blueprint', () => {
  const blueprint = createBlueprint('capture-test', 'Capture test')
  const edited = { ...blueprint, nodes: blueprint.nodes.map((node, index) => index === 0 ? { ...node, selected: true, dragging: true, resizing: true, measured: { width: 100, height: 80 }, width: 100, height: 80 } : node) }

  assert.deepEqual(serializeBlueprint(edited), serializeBlueprint(blueprint))
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


test('V2 drops execution library fields and rejects obsolete document shapes', () => {
  const document = serializeBlueprint(createBlueprint('clean-v2','Clean V2'))
  for (const key of ['eventFolders','events','functionFolders','functions']) {
    assert.equal(key in document,false)
    assert.throws(() => hydrateBlueprint({...document,[key]:[]},'user','revision'),/Unsupported blueprint schema/)
  }
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


test('output folder control keeps its string path through save and reload', () => {
  const blueprint = createBlueprint('folder-test', 'Folder test')
  assert.equal(allParameters(blueprint).find(item => item.id === 'output').kind, 'folder')
  blueprint.values.output = 'C:/录屏/My recordings'
  const stored = serializeBlueprint(blueprint)
  assert.equal(stored.values.output, blueprint.values.output)
  assert.equal(hydrateBlueprint(stored, 'user', null).values.output, blueprint.values.output)
})

 test('connected input preview follows current parameters and named values, preserving false and rejecting cycles', () => {
  const blueprint = createBlueprint('preview', 'Preview')
  blueprint.nodes = [
    {id:'reader',position:{x:0,y:0},data:{kind:'read_parameter',label:'Read fps',config:{parameterId:'fps'}}},
    {id:'target',position:{x:0,y:0},data:{kind:'make_integer',label:'Target',config:{value:10}}},
  ]
  blueprint.edges = [{id:'link',source:'reader',target:'target',sourceHandle:'out:value',targetHandle:'in:param:value'}]
  blueprint.values.fps = 30
  assert.equal(connectedInputValue(blueprint,'target','value'),30)
  blueprint.values.fps = 60
  assert.equal(connectedInputValue(blueprint,'target','value'),60)
  blueprint.nodes[0].data.config.parameterId='cursor'
  blueprint.values.cursor=false
  assert.equal(connectedInputValue(blueprint,'target','value'),false)
  blueprint.nodes[0].data={kind:'define_value',label:'Named',config:{name:'Example'}}
  blueprint.edges.push({id:'cycle',source:'target',target:'reader',sourceHandle:'out:value',targetHandle:'in:value'})
  assert.equal(connectedInputValue(blueprint,'target','value'),undefined)
  blueprint.nodes[1].data={kind:'define_value',label:'Cycle',config:{name:'Cycle'}}
  assert.equal(connectedInputValue(blueprint,'target','value'),undefined)
 })

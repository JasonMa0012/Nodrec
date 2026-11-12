import assert from 'node:assert/strict'
import test from 'node:test'
import { formatGraph } from './graph-layout.ts'

const port = (id, valueType) => ({ id, label: id, valueType })
const node = (id, kind, x, y, inputs, outputs) => ({ id, position: { x, y }, data: { kind, inputs, outputs } })
const capture = (id, x = 0, y = 0) => node(id, 'screen', x, y, [], [port('stream', 'video_frames')])
const stage = (id, x, y, extra = []) => node(id, 'encode_media_foundation', x, y, [port('stream', 'video_frames'), ...extra], [port('stream', 'video_frames')])
const value = (id, x, y, inputs = []) => node(id, 'make_string', x, y, inputs, [port('value', 'string')])
const edge = (source, target, sourceHandle = 'stream', targetHandle = sourceHandle, points = []) => ({ id: `${source}-${target}`, source, target, sourceHandle: `out:${sourceHandle}`, targetHandle: `in:${targetHandle}`, data: { routePoints: points, retained: true } })
const geometry = nodes => new Map(nodes.map(n => [n.id, { width: 220, height: 100 + n.data.inputs.length * 15, handles: Object.fromEntries([
  ...n.data.inputs.map((p, i) => [`in:${p.id}`, { x: 0, y: 20 + i * 25 }]),
  ...n.data.outputs.map((p, i) => [`out:${p.id}`, { x: 220, y: 20 + i * 25 }]),
]) }]))
const apply = (nodes, result) => nodes.map(n => ({ ...n, position: result.positions.get(n.id) ?? n.position }))
const formatted = (nodes, edges, selected, only = false, sizes = geometry(nodes)) => {
  const result = formatGraph(nodes, edges, sizes, selected, only)
  assert.ok(result)
  const next = apply(nodes, result)
  assert.equal(formatGraph(next, edges.map(e => result.resetRouteEdgeIds.has(e.id) ? { ...e, data: {} } : e), sizes, selected, only).positions.size, 0, 'formatting must be idempotent')
  return { result, nodes: next, pos: id => next.find(n => n.id === id).position }
}
const disjoint = (nodes, sizes = geometry(nodes)) => {
  for (let i = 0; i < nodes.length; i++) for (const other of nodes.slice(i + 1)) {
    const a = { ...nodes[i].position, ...sizes.get(nodes[i].id) }
    const b = { ...other.position, ...sizes.get(other.id) }
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `${nodes[i].id} overlaps ${other.id}`)
  }
}

test('F lays out the connected media chain and preserves the selected node', () => {
  const nodes = [capture('e', 13, 27), stage('a', -400, 550), stage('b', -700, 20)]
  const edges = [edge('e', 'a'), edge('a', 'b')]
  const { pos, nodes: next } = formatted(nodes, edges, ['b'])
  assert.deepEqual(pos('b'), nodes[2].position)
  assert.equal(pos('a').x, -1020)
  assert.equal(pos('a').y, 20)
  assert.equal(pos('e').x, -1340)
  disjoint(next)
})

test('Shift+F is strict for single nodes and cannot traverse an unselected bridge', () => {
  const nodes = [capture('e'), stage('a', 600, 400), stage('b', 900, 100), stage('c', 1200, 600)]
  const edges = [edge('e', 'a'), edge('a', 'b'), edge('b', 'c')]
  assert.equal(formatted(nodes, edges, ['a'], true).result.positions.size, 0)
  assert.equal(formatted(nodes, edges, ['a', 'c'], true).result.positions.size, 0)
  const { pos } = formatted(nodes, edges, ['a', 'b'], true)
  assert.deepEqual(pos('e'), nodes[0].position)
  assert.deepEqual(pos('c'), nodes[3].position)
  assert.deepEqual(pos('a'), nodes[1].position)
  assert.equal(pos('b').x, 920)
})

test('only a complete single dedicated parameter tree is helixed below its consumer', () => {
  const nodes = [capture('e'), stage('a', 800, 500, [port('text', 'string')]), value('v', -900, 700)]
  const edges = [edge('e', 'a'), edge('v', 'a', 'value', 'text')]
  const { pos, nodes: next } = formatted(nodes, edges, ['a'])
  assert.equal(pos('v').x, pos('a').x)
  assert.equal(pos('v').y, pos('a').y + geometry(nodes).get('a').height + 40)
  disjoint(next)
})

test('multiple parameters and parameter chains stay to the left', () => {
  const nodes = [capture('e'), stage('a', 800, 500, [port('first', 'string'), port('second', 'string')]), value('v', -900, 700), value('w', -600, 800)]
  const edges = [edge('e', 'a'), edge('v', 'a', 'value', 'first'), edge('w', 'a', 'value', 'second')]
  const { pos, nodes: next } = formatted(nodes, edges, ['a'])
  assert.ok(pos('v').x < pos('a').x)
  assert.ok(pos('w').x < pos('a').x)
  disjoint(next)
  const chained = [nodes[0], nodes[1], value('v', -900, 700, [port('text', 'string')]), nodes[3]]
  const chainEdges = [edges[0], edges[1], edge('w', 'v', 'value', 'text')]
  const chain = formatted(chained, chainEdges, ['a'])
  assert.ok(chain.pos('w').x < chain.pos('v').x && chain.pos('v').x < chain.pos('a').x)
  disjoint(chain.nodes)
})

test('left parameters follow consumer pin order instead of node IDs or array order', () => {
  const names = ['fps', 'resolution', 'bitrate', 'encodingMode']
  const consumer = node('encode_media_foundation', 'encode_media_foundation', 700, 100, names.map(name => port(name, 'string')), [port('video', 'encoded_video')])
  const nodes = [consumer, ...['bitrate', 'encodingMode', 'fps', 'resolution'].map((name, i) => value(`read-${name}`, 0, 300 + i * 150))]
  const edges = names.map(name => edge(`read-${name}`, 'encode_media_foundation', 'value', name)).reverse()
  const layout = formatted(nodes, edges, ['encode_media_foundation'])
  const sorted = [...names].sort((a, b) => layout.pos(`read-${a}`).y - layout.pos(`read-${b}`).y)
  assert.deepEqual(sorted, names)
  const sizes = geometry(nodes)
  for (const name of names) assert.ok(layout.pos('encode_media_foundation').x - layout.pos(`read-${name}`).x - sizes.get(`read-${name}`).width >= 120, 'parameter column needs at least 120 units of horizontal space')
  for (let i = 1; i < names.length; i++) assert.ok(layout.pos(`read-${names[i]}`).y - layout.pos(`read-${names[i - 1]}`).y - sizes.get(`read-${names[i - 1]}`).height >= 40, 'parameter rows need 40 units of space')
  disjoint(layout.nodes)
  const reversed = formatted([...nodes].reverse(), [...edges].reverse(), ['encode_media_foundation'])
  for (const n of nodes) assert.deepEqual(reversed.pos(n.id), layout.pos(n.id), 'storage order must not affect layout')
})

test('pure value consumers also order their inputs and nested parameter trees by target pins', () => {
  const nodes = [node('path', 'path', 700, 100, [port('directory', 'string'), port('filename', 'string')], [port('path', 'path')]), value('a-filename', 0, 0), value('z-directory', 0, 300, [port('text', 'string')]), value('directory-input', -500, 500)]
  const edges = [edge('a-filename', 'path', 'value', 'filename'), edge('z-directory', 'path', 'value', 'directory'), edge('directory-input', 'z-directory', 'value', 'text')]
  const layout = formatted(nodes, edges, ['path'])
  assert.ok(layout.pos('z-directory').y < layout.pos('a-filename').y)
  assert.ok(layout.pos('directory-input').x < layout.pos('z-directory').x)
  disjoint(layout.nodes)
})

test('parameter trees stay below the media mainline including the nested Output Path tree', () => {
  const nodes = [
    node('screen', 'screen', 0, 0, [], [port('frames', 'video_frames')]),
    node('encode_media_foundation', 'encode_media_foundation', 700, 0, [port('frames', 'video_frames'), port('fps', 'string'), port('bitrate', 'string')], [port('video', 'encoded_video')]),
    node('write', 'write', 1600, 0, [port('video', 'encoded_video'), port('path', 'path')], []),
    node('path', 'path', 1200, 0, [port('directory', 'string'), port('filename', 'string')], [port('path', 'path')]),
    ...['fps', 'bitrate', 'directory', 'filename'].map((id, i) => value(id, 100, i * 170)),
  ]
  const edges = [edge('screen', 'encode_media_foundation', 'frames'), edge('encode_media_foundation', 'write', 'video'), edge('path', 'write', 'path'), ...['fps', 'bitrate'].map(id => edge(id, 'encode_media_foundation', 'value', id)), ...['directory', 'filename'].map(id => edge(id, 'path', 'value', id))]
  const { pos, nodes: next } = formatted(nodes, edges, ['encode_media_foundation'])
  for (const id of ['fps', 'bitrate']) assert.ok(pos(id).y >= pos('encode_media_foundation').y + 45, `${id} must clear the media pin band by 25 units`)
  for (const id of ['path', 'directory', 'filename']) assert.ok(pos(id).y >= pos('write').y + 45, `${id} must clear the Write video line`)
  disjoint(next)
})

test('capture input trees align to their consumer instead of sinking below the outgoing media line', () => {
  const nodes = [
    node('capture', 'screen', 900, 50, [port('region', 'region'), port('cursor', 'boolean')], [port('frames', 'video_frames')]),
    node('selected', 'selected', 300, 400, [port('region', 'region'), port('mode', 'string')], [port('region', 'region')]),
    node('region', 'region', 0, 600, [port('display', 'string'), port('x', 'string')], [port('region', 'region')]),
    ...['display', 'x', 'mode', 'cursor'].map(id => value(id, -500, 800)),
  ]
  const edges = [edge('region', 'selected', 'region'), edge('selected', 'capture', 'region'), edge('display', 'region', 'value', 'display'), edge('x', 'region', 'value', 'x'), edge('mode', 'selected', 'value', 'mode'), edge('cursor', 'capture', 'value', 'cursor')]
  const { pos, nodes: next } = formatted(nodes, edges, ['capture'])
  for (const id of ['display', 'region', 'selected']) assert.equal(pos(id).y, pos('capture').y, `${id} must stay aligned with the capture input`)
  disjoint(next)
})

test('a partially selected parameter tree does not qualify for Helixing', () => {
  const nodes = [stage('a', 800, 500, [port('text', 'string')]), value('v', 100, 700, [port('text', 'string')]), value('w', -900, 100)]
  const { pos } = formatted(nodes, [edge('v', 'a', 'value', 'text'), edge('w', 'v', 'value', 'text')], ['v', 'a'], true)
  assert.ok(pos('v').x < pos('a').x)
  assert.deepEqual(pos('w'), nodes[2].position)
})

function sharedGraph() {
  const nodes = [capture('e1'), capture('e2', 0, 600), stage('a', 1000, 100, [port('text', 'string')]), stage('b', 1000, 900, [port('text', 'string')]), value('shared', -600, 400, [port('text', 'string')]), value('upstream', -1000, 900)]
  const edges = [edge('e1', 'a'), edge('e2', 'b'), edge('shared', 'a', 'value', 'text'), edge('shared', 'b', 'value', 'text'), edge('upstream', 'shared', 'value', 'text')]
  return { nodes, edges }
}

test('strict formatting leaves unselected consumers and shared inputs fixed', () => {
  const { nodes, edges } = sharedGraph()
  const { result } = formatted(nodes, edges, ['a'], true)
  assert.deepEqual([...result.positions.keys()], [])
})

test('selecting shared data formats its whole connected component', () => {
  const { nodes, edges } = sharedGraph()
  const { result, pos } = formatted(nodes, edges, ['shared'])
  assert.ok(result.positions.has('upstream') && result.positions.has('a') && result.positions.has('b'))
  assert.deepEqual(pos('shared'), nodes[4].position)
})

test('whole-component formatting includes shared and dedicated inputs', () => {
  const { nodes, edges } = sharedGraph()
  nodes.push(value('exclusive', 600, 1000, [port('text', 'string')]))
  edges.splice(2, 1, edge('shared', 'exclusive', 'value', 'text'), edge('exclusive', 'a', 'value', 'text'))
  const { result } = formatted(nodes, edges, ['a'])
  assert.ok(result.positions.has('exclusive'))
  assert.ok(result.positions.has('shared') && result.positions.has('upstream') && result.positions.has('b'))
})

test('selecting multiple capture sources arranges the connected shared-value component', () => {
  const { nodes, edges } = sharedGraph()
  const { result } = formatted(nodes, edges, ['e1', 'e2'])
  assert.ok(result.positions.has('a') && result.positions.has('b') && result.positions.has('shared'))
})

test('media nodes form a horizontal main chain', () => {
  const nodes = [node('screen', 'screen', 100, 30, [], [port('frames', 'video_frames')]), node('encode_media_foundation', 'encode_media_foundation', -1000, 400, [port('frames', 'video_frames'), port('fps', 'string')], [port('video', 'encoded_video')]), node('write', 'write', -2000, 400, [port('video', 'encoded_video')], []), value('fps', -1800, 900)]
  const edges = [edge('screen', 'encode_media_foundation', 'frames'), edge('encode_media_foundation', 'write', 'video'), edge('fps', 'encode_media_foundation', 'value', 'fps')]
  const { pos, nodes: next } = formatted(nodes, edges, ['encode_media_foundation'])
  assert.deepEqual(pos('encode_media_foundation'), nodes[1].position)
  assert.ok(pos('screen').x < pos('encode_media_foundation').x && pos('encode_media_foundation').x < pos('write').x)
  assert.equal(pos('fps').x, pos('encode_media_foundation').x)
  assert.ok(pos('fps').y > pos('encode_media_foundation').y)
  disjoint(next)
})

test('data output port order is preserved and a merge follows all predecessors', () => {
  const branch = node('branch', 'screen', 0, 0, [port('stream', 'video_frames')], [port('first', 'video_frames'), port('second', 'video_frames')])
  const nodes = [capture('e', 17, 21), branch, stage('z-true', 800, 900), stage('a-false', 400, 300), stage('merge', 10, 800)]
  const edges = [edge('e', 'branch'), edge('branch', 'z-true', 'first', 'stream'), edge('branch', 'a-false', 'second', 'stream'), edge('z-true', 'merge'), edge('a-false', 'merge')]
  const { pos, nodes: next } = formatted(nodes, edges, ['merge'])
  assert.ok(pos('z-true').y < pos('a-false').y)
  assert.ok(pos('merge').x > pos('z-true').x && pos('merge').x > pos('a-false').x)
  disjoint(next)
})

test('immutable nearby nodes are obstacles and repeated formatting is stable', () => {
  const nodes = [capture('e'), stage('a', 900, 900), stage('obstacle', 260, 0)]
  const { pos, nodes: next } = formatted(nodes, [edge('e', 'a')], ['a'])
  assert.deepEqual(pos('obstacle'), nodes[2].position)
  assert.ok(pos('a').y > 115)
  disjoint(next)
})

test('only internal manual routes are reset; graph data is never mutated', () => {
  const nodes = [capture('e'), stage('a', 900, 900), stage('b', 800, 200)]
  const edges = [edge('e', 'a', 'stream', 'stream', [{ x: 5, y: 5 }]), edge('a', 'b', 'stream', 'stream', [{ x: 500, y: 500 }])]
  const before = structuredClone({ nodes, edges })
  const result = formatGraph(nodes, edges, geometry(nodes), ['a', 'b'], true)
  assert.deepEqual([...result.resetRouteEdgeIds], ['a-b'])
  assert.deepEqual({ nodes, edges }, before)
})

test('missing measurements and dynamic handles defer rather than guessing', () => {
  const nodes = [capture('e'), stage('a', 900, 900)]
  const edges = [edge('e', 'a')]
  const sizes = geometry(nodes)
  sizes.delete('a')
  assert.equal(formatGraph(nodes, edges, sizes, ['a'], false), null)
  const missingHandle = geometry(nodes)
  delete missingHandle.get('a').handles['in:stream']
  assert.equal(formatGraph(nodes, edges, missingHandle, ['a'], false), null)
  const unmeasuredOutput = geometry(nodes)
  delete unmeasuredOutput.get('a').handles['out:stream']
  assert.equal(formatGraph(nodes, edges, unmeasuredOutput, ['a'], false), null)
  assert.equal(formatGraph(nodes, edges, geometry(nodes), [], false).positions.size, 0)
})

test('editing cycles terminate without modifying the connections', () => {
  const nodes = [stage('a', 10, 20), stage('b', -300, 900), stage('c', 1000, 800)]
  const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]
  const before = structuredClone(edges)
  const { pos, nodes: next } = formatted(nodes, edges, ['a'])
  assert.deepEqual(pos('a'), nodes[0].position)
  assert.deepEqual(edges, before)
  disjoint(next)
})

test('all component anchors are obstacles before any component is arranged', () => {
  const nodes = [capture('e1'), stage('a', 900, 900), capture('e2', 260, 0), stage('b', 1200, 400)]
  const { nodes: next, pos } = formatted(nodes, [edge('e1', 'a'), edge('e2', 'b')], ['e1', 'e2'])
  assert.deepEqual(pos('e2'), nodes[2].position)
  disjoint(next)
})

test('manual routes reset even when all node positions are already arranged', () => {
  const nodes = [capture('e'), stage('a', 320, 0)]
  const result = formatGraph(nodes, [edge('e', 'a', 'stream', 'stream', [{ x: 1, y: 2 }])], geometry(nodes), ['a'], false)
  assert.equal(result.positions.size, 0)
  assert.deepEqual([...result.resetRouteEdgeIds], ['e-a'])
})

test('configuration references do not connect unwired media nodes', () => {
  const nodes = [capture('e'), stage('a', 900, 900), node('write', 'write', 400, 800, [port('video', 'encoded_video')], [])]
  nodes[1].data.config = { outputNodeId: 'write' }
  const { result } = formatted(nodes, [edge('e', 'a')], ['a'])
  assert.ok(!result.positions.has('write'))
})

test('different node sizes align the actual port center and round measurement noise', () => {
  const nodes = [capture('e', 13, 27), stage('a', 900, 900)]
  const sizes = geometry(nodes)
  sizes.get('a').width = 375
  sizes.get('a').height = 207
  sizes.get('a').handles['in:stream'].y = 35.000019
  const { pos } = formatted(nodes, [edge('e', 'a')], ['e'], false, sizes)
  assert.equal(pos('a').y, 12)
})

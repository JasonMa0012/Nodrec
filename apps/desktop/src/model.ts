import type { Edge, Node } from '@xyflow/react'
import type { LayoutItem, ResponsiveLayouts } from 'react-grid-layout'

export type Value = string | boolean | number
export type ParameterKind = 'readonly' | 'text' | 'folder' | 'choice' | 'boolean' | 'number'
export type ParameterDefinition = {
  id: string
  label: string
  kind: ParameterKind
  options?: string[]
  initial: Value
}
export type ParameterColumn = { id: string; weight: number }
export type ParameterRow = { pinned: boolean; columns: ParameterColumn[] }
export type ParameterDropPlacement = 'above' | 'below' | 'left' | 'right' | 'end'
export type OverviewLayouts = ResponsiveLayouts<'wide' | 'narrow'>
export type ParameterCard = { id: string; name: string; parameters: string[] }
export type TreeFolder = { id: string; name: string }
export type BlueprintSelection = { kind: 'nodes'; keys: string[] } | { kind: 'node' | 'parameter' | 'card' | 'folder'; key: string } | null
export type NodeKind = 'define_value' | 'read_value' | 'select_region' | 'get_selected_region' | 'read_parameter' | 'constant' | 'make_boolean' | 'make_byte' | 'make_integer' | 'make_integer64' | 'make_float' | 'make_double' | 'make_name' | 'make_string' | 'make_text' | 'compare' | 'region' | 'path' | 'screen' | 'audio' | 'encode_media_foundation' | 'write'
export type BlueprintNodeData = { label: string; kind: NodeKind; enabled?: boolean; actionOrder?: string[]; note?: string; config?: Record<string, unknown> }
export type BlueprintNode = Node<BlueprintNodeData>

export function createNodeControl(node: BlueprintNode, target: string, id: string, graphId = 'recording'): RegisteredControl {
  if (node.data.kind !== 'screen' && node.data.kind !== 'select_region') throw new Error('Node has no control action')
  return { id, label:node.data.kind === 'screen' ? 'Record' : 'Select region', icon:node.data.kind === 'screen' ? 'play' : 'crop', enabled:true, targets:[target], binding:{graphId,nodeId:node.id,action:node.data.kind === 'screen' ? 'record' : 'select'} }
}

export function copyNamedValues(nodes: BlueprintNode[], existing: readonly BlueprintNode[], ids: ReadonlyMap<string, string>): BlueprintNode[] {
  const names = new Set(existing.filter(node => node.data.kind === 'define_value').map(node => String(node.data.config?.name ?? '').trim()))
  return nodes.map(node => {
    const config = { ...node.data.config }
    if (node.data.kind === 'read_value' && typeof config.definitionId === 'string') config.definitionId = ids.get(config.definitionId) ?? config.definitionId
    if (node.data.kind === 'define_value') {
      const base = String(config.name ?? 'Value').trim() || 'Value'
      let name = base
      for (let suffix = 2; names.has(name); suffix++) name = `${base} ${suffix}`
      names.add(name)
      config.name = name
    }
    return { ...node, data: { ...node.data, config } }
  })
}
export type BlueprintScope = 'builtin' | 'user'
export type PinValueType = 'value' | 'boolean' | 'byte' | 'integer' | 'integer64' | 'float' | 'double' | 'name' | 'string' | 'text' | 'object' | 'soft_object' | 'class' | 'soft_class' | 'interface' | 'delegate' | 'struct' | 'vector' | 'rotator' | 'transform' | 'region' | 'path' | 'video_frames' | 'audio_samples' | 'encoded_video'
export type NodePortDefinition = { id: string; label: string; valueType: PinValueType }
export type NodeTypeDefinition = { provider?: string | null; actions?: string[]; choices?: Record<string, string[]>; kind: NodeKind; label: string; category: string; inputs: NodePortDefinition[]; outputs: NodePortDefinition[]; inputParameters: string[]; defaultConfig: Record<string, unknown> }
export type RegisteredDisplay = { binding?:RegisteredControl['binding']; targetOrder?: Record<string, number>; id: string; targets: string[]; order: number; source: 'status' | 'elapsed'; format: 'text' | 'HH:mm:ss' }
export type RegisteredControl = { error?: string; binding: { graphId: string; nodeId: string; action: 'record' | 'select' }; targetOrder?: Record<string, number>; id: string; label: string; icon: string; order?: number; enabled: boolean; targets?: string[] }
export type EditorTab = { id: string; kind: 'overview' | 'blueprint' | 'card'; cardId?: string }
export type BlueprintGraph = { id: string; name: string; nodes: BlueprintNode[]; edges: Edge[] }
export type Blueprint = {
  graphOrder: string[]
  graphId: string
  graphName: string
  additionalGraphs: BlueprintGraph[]
  displays: RegisteredDisplay[]
  controls: RegisteredControl[]
  controlOrder: Record<string, string[]>
  id: string
  name: string
  replay: boolean
  values: Record<string, Value>
  labels: Record<string, string>
  cards: ParameterCard[]
  customParameters: ParameterDefinition[]
  overviewLayouts: OverviewLayouts
  variableFolders: TreeFolder[]
  layouts: Record<string, ParameterRow[]>
  tabs: EditorTab[]
  activeTab: string
  nodes: BlueprintNode[]
  edges: Edge[]
  recordState: 'ready' | 'starting' | 'recording' | 'paused' | 'stopping' | 'failed'
  supported: boolean
  scope: BlueprintScope
  revision: string | null
  selectedParameter: string | null
  selectedNode: string | null
  detailCard: string | null
  selection: BlueprintSelection
  openFolders: Record<string, boolean>
}

// Unreal GraphEditorSettings defaults converted from linear color to CSS sRGB.
const uePinColors: Record<string, string> = {
  boolean: '#950000', byte: '#006F65', class: '#5900BC', integer: '#1FE3AF', integer64: '#ACE3AF',
  float: '#A1FF45', double: '#38D500', name: '#CD82FF', delegate: '#FF3838', object: '#00AAF5', soft_object: '#95FFFF',
  soft_class: '#FF95FF', interface: '#F1FFAA', string: '#FF00D4', text: '#E77CAA', struct: '#0059CB', wildcard: '#817A7A',
  vector: '#FFCA23', rotator: '#A0B4FF', transform: '#FF7300', default: '#E1CBAA',
}

export function pinTypeColor(valueType: string): string {
  const type = valueType === 'value' ? 'wildcard'
    : valueType === 'region' ? 'struct'
      : valueType === 'path' ? 'string'
        : ['video_frames', 'audio_samples', 'encoded_video'].includes(valueType) ? 'object' : valueType
  return uePinColors[type] ?? uePinColors.default!
}

export function configPathId(path: readonly (string | number)[]): string {
  return path.map(String).join('.')
}

export function parameterInputPortId(_kind: NodeKind, pathId: string): string {
  return `param:${pathId}`
}

export function parameterSources(blueprint: Pick<Blueprint,'nodes' | 'edges'>, nodeIds: string[], path: string): string[] {
  return [...new Set(nodeIds.map(id => {
    const edge = blueprint.edges.find(edge => edge.target === id && (edge.targetHandle === `in:param:${path}` || edge.targetHandle === `in:${path}`))
    if (!edge) return 'Local value'
    const source = blueprint.nodes.find(node => node.id === edge.source)
    return `${source?.data.label ?? `Missing node (${edge.source})`} · ${edge.sourceHandle?.replace(/^out:/,'') ?? 'output'}`
  }))]
}

export function connectedInputValue(blueprint: Blueprint, nodeId: string, path: string, visiting = new Set<string>()): unknown {
  const edge = blueprint.edges.find(edge => edge.target === nodeId && (edge.targetHandle === 'in:param:' + path || edge.targetHandle === 'in:' + path))
  if (!edge) return undefined
  const source = blueprint.nodes.find(node => node.id === edge.source)
  if (!source || source.data.enabled === false || visiting.has(source.id) || visiting.size >= 128) return undefined
  const next = new Set(visiting).add(source.id)
  const config = source.data.config ?? {}
  const input = (key: string) => connectedInputValue(blueprint, source.id, key, next)
  if (source.data.kind === 'read_parameter') {
    const parameter = allParameters(blueprint).find(parameter => parameter.id === config.parameterId)
    return parameter ? blueprint.values[parameter.id] ?? parameter.initial : undefined
  }
  if (source.data.kind === 'constant' || source.data.kind.startsWith('make_')) return blueprint.edges.some(edge => edge.target === source.id && edge.targetHandle === 'in:param:value') ? input('value') : config.value
  if (source.data.kind === 'define_value') return input('value')
  if (source.data.kind === 'read_value') return connectedInputValue(blueprint, String(config.definitionId), 'value', next)
  if (source.data.kind === 'compare') {
    const left = input('left'), right = input('right')
    if (left === undefined || right === undefined) return undefined
    if (config.operator === 'contains') return typeof left === 'string' && typeof right === 'string' && left.includes(right)
    if (config.operator === 'not_equal') return JSON.stringify(left) !== JSON.stringify(right)
    if (!config.operator || config.operator === 'equal') return JSON.stringify(left) === JSON.stringify(right)
  }
  // shortcut: runtime media and selected-region outputs have no editor snapshot, show unavailable until runtime exposes them.
  return undefined
}

export function pinTypeForValue(value: unknown): PinValueType | null {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'float'
  return typeof value === 'string' ? 'string' : null
}

export const parameters: ParameterDefinition[] = [
  { id: 'display', label: 'Display', kind: 'choice', initial: 'Display 1' },
  { id: 'regionMode', label: 'Capture mode', kind: 'choice', initial: 'Selected Region', options: ['Selected Region', 'Full Display', 'Rectangle'] },
  { id: 'x', label: 'X (physical px)', kind: 'number', initial: 0 },
  { id: 'y', label: 'Y (physical px)', kind: 'number', initial: 0 },
  { id: 'width', label: 'Width (physical px)', kind: 'number', initial: 897 },
  { id: 'height', label: 'Height (physical px)', kind: 'number', initial: 360 },
  { id: 'region', label: 'Region', kind: 'readonly', initial: 'x: 0, y: 0, w: 2560, h: 1440' },
  { id: 'cursor', label: 'Show cursor', kind: 'boolean', initial: true },
  { id: 'delay', label: 'Start delay (s)', kind: 'choice', initial: '0', options: ['0', '3', '5'] },
  { id: 'resolution', label: 'Resolution', kind: 'choice', initial: 'Source Size', options: ['Source Size', '1920 × 1080', '2560 × 1440'] },
  { id: 'fps', label: 'Frame rate', kind: 'choice', initial: 60, options: ['24', '30', '60', '120'] },
  { id: 'codec', label: 'Codec', kind: 'choice', initial: 'H.264', options: ['H.264'] },
  { id: 'encodingMode', label: 'Encoding mode', kind: 'choice', initial: 'Hardware Auto', options: ['Hardware Auto', 'Software'] },
  { id: 'bitrate', label: 'Bitrate (Mbps)', kind: 'text', initial: '20' },
  { id: 'systemAudio', label: 'System audio', kind: 'readonly', initial: 'Not available yet' },
  { id: 'microphone', label: 'Microphone', kind: 'readonly', initial: 'Not available yet' },
  { id: 'device', label: 'Device', kind: 'readonly', initial: 'Not available yet' },
  { id: 'sampleRate', label: 'Sample rate', kind: 'readonly', initial: 'Not available yet' },
  { id: 'output', label: 'Output folder', kind: 'folder', initial: 'C:/Recordings' },
  { id: 'filename', label: 'Filename pattern', kind: 'text', initial: '{blueprint}_{timestamp}' },
  { id: 'pointer', label: 'Pointer mode', kind: 'choice', initial: 'Semantic + absolute fallback', options: ['Semantic + absolute fallback', 'Absolute coordinates'] },
  { id: 'keyboard', label: 'Keyboard input', kind: 'boolean', initial: true },
  { id: 'mouse', label: 'Mouse input', kind: 'boolean', initial: true },
  { id: 'threshold', label: 'Pixel threshold', kind: 'choice', initial: 'Low tolerance', options: ['Exact', 'Low tolerance', 'Medium tolerance'] },
]

export function overviewGridHeight(contentHeight: number): number {
  return Math.ceil((contentHeight + 14) / 22)
}

export function overviewCardContentHeight(rows: readonly ParameterRow[], definitions: readonly ParameterDefinition[]): number {
  if (rows.length === 0) return 112
  const rowHeights = rows.map((row) => Math.max(0, ...row.columns.map(({ id }) => definitions.find((item) => item.id === id)?.kind === 'boolean' ? 18 : 34)))
  return 68 + rowHeights.reduce((sum, height) => sum + height, 9 * (rows.length - 1))
}

export function swapOverviewCardPositions(layout: readonly LayoutItem[], sourceId: string, targetId: string): readonly LayoutItem[] {
  const source = layout.find((item) => item.i === sourceId)
  const target = layout.find((item) => item.i === targetId)
  if (!source || !target || sourceId === targetId) return layout
  return layout.map((item) => item.i === sourceId ? { ...item, x: target.x, y: target.y } : item.i === targetId ? { ...item, x: source.x, y: source.y } : item)
}

export function placeOverviewCardBeside(layout: readonly LayoutItem[], sourceId: string, targetId: string, side: 'left' | 'right', cols: number): readonly LayoutItem[] {
  const source = layout.find((item) => item.i === sourceId)
  const target = layout.find((item) => item.i === targetId)
  if (!source || !target || sourceId === targetId || cols < 2) return layout

  const targetRow = layout.filter((item) => item.y === target.y && item.i !== sourceId).sort((a, b) => a.x - b.x)
  const sourceColumn = { id: sourceId, weight: source.w }
  const rows = moveParameterLayout([
    { pinned: false, columns: targetRow.map((item) => ({ id: item.i, weight: item.w })) },
    { pinned: false, columns: [sourceColumn] },
  ], sourceId, targetId, side)
  const columns = rows[0]?.columns
  if (!columns || columns.reduce((sum, column) => sum + Math.max(1, layout.find((item) => item.i === column.id)?.minW ?? 1), 0) > cols) return layout

  const widths = allocateOverviewWidths(columns, layout, cols)
  let x = 0
  const positions = new Map(columns.map((column, index) => {
    const position = { x, w: widths[index] ?? 1 }
    x += position.w
    return [column.id, position] as const
  }))
  const pairHeight = Math.max(...columns.map(({ id }) => layout.find((item) => item.i === id)?.h ?? 1))
  const nextLayout = layout.map((item) => {
    const position = positions.get(item.i)
    return position ? { ...item, ...position, y: target.y } : item
  })
  const placed = nextLayout.filter((item) => positions.has(item.i))
  const overlaps = (a: LayoutItem, b: LayoutItem) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

  return nextLayout.map((item) => placed.some((placedItem) => placedItem.i !== item.i && overlaps(item, placedItem))
    ? { ...item, y: Math.max(item.y, target.y + pairHeight) }
    : item)
}

export function moveOverviewCardVertically(layout: readonly LayoutItem[], sourceId: string, targetId: string | null, placement: 'above' | 'below' | 'end', cols: number): readonly LayoutItem[] {
  const source = layout.find((item) => item.i === sourceId)
  if (!source || (placement !== 'end' && (!targetId || !layout.some((item) => item.i === targetId))) || sourceId === targetId || cols < 1) return layout

  const grouped = new Map<number, LayoutItem[]>()
  for (const item of layout) grouped.set(item.y, [...(grouped.get(item.y) ?? []), item])
  const originalRows = [...grouped.values()].map((items) => items.sort((a, b) => a.x - b.x))
  const rows = originalRows.map((items) => ({ pinned: false, columns: items.map(({ i, w }) => ({ id: i, weight: w })) }))
  const movedRows = moveParameterLayout(rows, sourceId, targetId, placement)
  if (movedRows === rows || movedRows.some((row) => row.columns.reduce((sum, { id }) => sum + Math.max(1, layout.find((item) => item.i === id)?.minW ?? 1), 0) > cols)) return layout

  const byId = new Map(layout.map((item) => [item.i, item]))
  let y = 0
  return movedRows.flatMap((row) => {
    const ids = row.columns.map(({ id }) => id)
    const unchanged = !ids.includes(sourceId) && originalRows.find((items) => items.length === ids.length && items.every((item, index) => item.i === ids[index]))
    const widths = unchanged ? null : allocateOverviewWidths(row.columns, layout, cols)
    let x = 0
    const items = row.columns.map((column, index) => {
      const item = byId.get(column.id)!
      const width = unchanged ? item.w : widths?.[index] ?? cols
      const position = unchanged ? item.x : x
      x += width
      return { ...item, x: position, y, w: width }
    })
    y += Math.max(...items.map((item) => item.h))
    return items
  })
}

function allocateOverviewWidths(columns: ParameterColumn[], layout: readonly LayoutItem[], cols: number): number[] {
  const minimums = columns.map(({ id }) => Math.max(1, layout.find((item) => item.i === id)?.minW ?? 1))
  const minimumTotal = minimums.reduce((sum, width) => sum + width, 0)
  const widths = Array(columns.length).fill(0) as number[]
  const active = new Set(columns.map((_, index) => index))
  let remaining = cols

  while (active.size) {
    const weightTotal = [...active].reduce((sum, index) => sum + (columns[index]?.weight ?? 0), 0)
    const undersized = [...active].filter((index) => remaining * (columns[index]?.weight ?? 0) / weightTotal < (minimums[index] ?? 1))
    if (!undersized.length) break
    for (const index of undersized) {
      widths[index] = minimums[index] ?? 1
      remaining -= widths[index] ?? 1
      active.delete(index)
    }
  }

  if (minimumTotal > cols) return minimums
  const weightTotal = [...active].reduce((sum, index) => sum + (columns[index]?.weight ?? 0), 0)
  const fractions: { index: number; fraction: number }[] = []
  for (const index of active) {
    const exact = remaining * (columns[index]?.weight ?? 0) / weightTotal
    widths[index] = Math.floor(exact)
    fractions.push({ index, fraction: exact - (widths[index] ?? 0) })
  }
  let leftover = remaining - [...active].reduce((sum, index) => sum + (widths[index] ?? 0), 0)
  fractions.sort((a, b) => b.fraction - a.fraction)
  for (let index = 0; index < leftover; index++) {
    const target = fractions[index % fractions.length]?.index
    if (target !== undefined) widths[target] = (widths[target] ?? 0) + 1
  }
  return widths
}

const pinMap: Record<string, string[]> = {
  recording: ['display', 'regionMode', 'x', 'y', 'width', 'height', 'cursor'],
  video: ['resolution', 'fps', 'encodingMode', 'bitrate'],
  audio: ['systemAudio', 'microphone'],
  output: ['output'],
  input: ['pointer', 'keyboard', 'mouse'],
  verification: ['threshold'],
}

const cardList = (replay: boolean): ParameterCard[] => [
  { id: 'recording', name: 'Recording settings', parameters: ['display', 'regionMode', 'x', 'y', 'width', 'height', 'cursor'] },
  { id: 'video', name: 'Video', parameters: ['resolution', 'fps', 'codec', 'encodingMode', 'bitrate'] },
  { id: 'audio', name: 'Audio (not available yet)', parameters: ['systemAudio', 'microphone', 'device', 'sampleRate'] },
  { id: 'output', name: 'Output', parameters: ['output', 'filename'] },
  ...(replay ? [
    { id: 'input', name: 'Input recording', parameters: ['pointer', 'keyboard', 'mouse'] },
    { id: 'verification', name: 'Replay & verification', parameters: ['threshold'] },
  ] : []),
]

function graph(): { nodes: BlueprintNode[]; edges: Edge[] } {
  const nodes: BlueprintNode[] = []
  const edges: Edge[] = []
  const add = (id: string, kind: NodeKind, label: string, x: number, y: number, config: Record<string, unknown> = {}) => nodes.push({
    id, type: kind, position: { x, y }, data: { kind, label, config },
  })
  const value = (source: string, output: string, target: string, input: string) => edges.push({ id: `e-${source}-${target}-${input}`, source, sourceHandle: `out:${output}`, target, targetHandle: `in:${input}`, type: 'smoothstep' })
  add('log-select-region', 'select_region', 'Select Region', -400, 900, { toolId: 'capture-region', display: 'Display 1', initialRegion: null })
  add('picker-display', 'read_parameter', 'Read Display', -920, 900, { parameterId: 'display' })
  value('picker-display', 'value', 'log-select-region', 'param:display')

  add('region', 'region', 'Screen Region', -920, 120, { display: 'Display 1', mode: 'Rectangle', x: 0, y: 0, width: 897, height: 360 })
  add('screen', 'screen', 'Capture Screen', 120, 120, { cursor: true, fps:60, startDelaySeconds:0 })
  add('encode_media_foundation', 'encode_media_foundation', 'Media Foundation Encode', 640, 120, { codec: 'H.264', resolution: 'Source Size', bitrate: '20', encodingMode: 'Hardware Auto' })
  add('path', 'path', 'Output Path', 1160, 900, { directory: 'C:/Recordings', filename: '{blueprint}_{timestamp}.mp4' })
  add('write', 'write', 'Write MP4', 1160, 120)
  add('selected-region', 'get_selected_region', 'Get Selected Region', -400, 120, { toolId: 'capture-region', mode: 'Selected Region' })
  value('log-select-region', 'region', 'selected-region', 'selected')
  value('region', 'region', 'selected-region', 'fallback')
  value('selected-region', 'region', 'screen', 'region')
  value('screen', 'frames', 'encode_media_foundation', 'frames')
  value('encode_media_foundation', 'video', 'write', 'video')
  value('path', 'path', 'write', 'path')
  for (const [target, input, parameterId] of [
    ['region', 'display', 'display'], ['selected-region', 'mode', 'regionMode'],
    ['region', 'x', 'x'], ['region', 'y', 'y'], ['region', 'width', 'width'], ['region', 'height', 'height'],
    ['screen', 'cursor', 'cursor'], ['screen', 'fps', 'fps'], ['encode_media_foundation', 'resolution', 'resolution'],
    ['encode_media_foundation', 'bitrate', 'bitrate'], ['encode_media_foundation', 'encodingMode', 'encodingMode'],
    ['path', 'directory', 'output'], ['path', 'filename', 'filename'],
  ] as const) {
    const targetNode = nodes.find((node) => node.id === target)!
    const id = `parameter-${parameterId}`
    add(id, 'read_parameter', `Read ${parameterId}`, targetNode.position.x, targetNode.position.y + 900 + edges.filter(edge => edge.target === target && edge.targetHandle?.startsWith('in:param:')).length * 260, { parameterId })
    value(id, 'value', target!, `param:${input}`)
  }
  return { nodes, edges }
}

export function createBlueprint(id: string, name: string, replay = false): Blueprint {
  const cards = cardList(replay)
  const values = Object.fromEntries(parameters.map(({ id: key, initial }) => [key, initial]))
  const layouts = Object.fromEntries(cards.map((card) => [card.id, card.parameters.map((parameter) => ({
    pinned: pinMap[card.id]?.includes(parameter) ?? false,
    columns: [{ id: parameter, weight: 1 }],
  }))]))
  const cardHeight = (cardId: string) => overviewGridHeight(overviewCardContentHeight(layouts[cardId]?.filter((row) => row.pinned) ?? [], parameters))
  const wide: LayoutItem[] = []
  let wideY = 0
  for (let index = 0; index < cards.length; index += 2) {
    const left = cards[index]!
    const right = cards[index + 1]
    const leftHeight = cardHeight(left.id)
    const rightHeight = right ? cardHeight(right.id) : 1
    wide.push({ i: left.id, x: 0, y: wideY, w: 6, h: leftHeight, minW: 3, maxW: 12 })
    if (right) wide.push({ i: right.id, x: 6, y: wideY, w: 6, h: rightHeight, minW: 3, maxW: 12 })
    wideY += Math.max(leftHeight, rightHeight)
  }
  let narrowY = 0
  const narrow: LayoutItem[] = cards.map((card) => {
    const h = cardHeight(card.id)
    const item = { i: card.id, x: 0, y: narrowY, w: 1, h, minW: 1, maxW: 1, isResizable: false }
    narrowY += h
    return item
  })
  const overviewLayouts: OverviewLayouts = { wide, narrow }
  const flow = graph()
  const blueprint: Blueprint = {
    displays: [{id:'recording-status',targets:['main','region:capture-region'],order:2,source:'status',format:'text',binding:{graphId:'recording',nodeId:'screen',action:'record'}},{id:'recording-time',targets:['main','region:capture-region'],order:3,source:'elapsed',format:'HH:mm:ss',binding:{graphId:'recording',nodeId:'screen',action:'record'}}],
    controls: [createNodeControl(flow.nodes.find(node => node.data.kind === 'select_region')!,'main','select-region'),{...createNodeControl(flow.nodes.find(node => node.data.kind === 'screen')!,'main','start-recording'),targets:['main','region:capture-region']}],
    controlOrder: {main:['select-region','start-recording','recording-status','recording-time'],'region:capture-region':['start-recording','recording-status','recording-time']},
    id, name, replay, values, labels: Object.fromEntries(parameters.map((item) => [item.id, item.label])), cards, layouts, overviewLayouts, customParameters: [],
    variableFolders: [{ id: 'capture', name: 'Capture' }, { id: 'video', name: 'Video' }, { id: 'audio', name: 'Audio' }, { id: 'output', name: 'Output' }, ...(replay ? [{ id: 'input', name: 'Input' }] : [])],
    tabs: [{ id: 'overview', kind: 'overview' }, { id: 'blueprint', kind: 'blueprint' }], activeTab: 'overview',
    graphOrder: ['recording'], graphId: 'recording', graphName: 'Recording', additionalGraphs: [], nodes: flow.nodes, edges: flow.edges, recordState: 'ready', supported: !replay, scope: 'user', revision: null, selectedParameter: null, selectedNode: null, detailCard: null,
    selection: null, openFolders: { recording: true, utilities: true, capture: true, video: true, audio: true, output: true, input: true },
  }
  return blueprint
}

export type BlueprintDocument = Omit<Blueprint, 'recordState' | 'selectedParameter' | 'selectedNode' | 'detailCard' | 'selection' | 'openFolders' | 'tabs' | 'activeTab' | 'scope' | 'revision' | 'nodes' | 'edges' | 'graphId' | 'graphName' | 'additionalGraphs' | 'graphOrder'> & { schemaVersion: 2; graphs: { id: string; name: string; nodes: BlueprintNode[]; edges: Edge[] }[] }

export function serializeBlueprint(blueprint: Blueprint): BlueprintDocument {
  const { recordState: _recordState, selectedParameter: _selectedParameter, selectedNode: _selectedNode, detailCard: _detailCard, selection: _selection, openFolders: _openFolders, tabs: _tabs, activeTab: _activeTab, scope: _scope, revision: _revision, nodes: _nodes, edges: _edges, graphId: _graphId, graphName: _graphName, additionalGraphs: _additionalGraphs, graphOrder: _graphOrder, ...document } = blueprint
  const cleanNodes = (nodes: BlueprintNode[]) => nodes.map(({ selected: _selected, dragging: _dragging, resizing: _resizing, measured: _measured, width: _width, height: _height, ...node }) => node)
  return { ...document, controls:blueprint.controls.map(({order: _order,error: _error,...control}) => control), graphs: blueprintGraphs(blueprint).map(graph => ({...graph,nodes:cleanNodes(graph.nodes)})), schemaVersion: 2 }
}

export function blueprintGraphs(blueprint: Blueprint): BlueprintGraph[] {
  return [{id:blueprint.graphId,name:blueprint.graphName,nodes:blueprint.nodes,edges:blueprint.edges},...blueprint.additionalGraphs]
    .sort((a,b)=>blueprint.graphOrder.indexOf(a.id)-blueprint.graphOrder.indexOf(b.id))
}

export function selectBlueprintGraph(blueprint: Blueprint, id: string): Blueprint {
  if (id === blueprint.graphId) return blueprint
  const graphs = blueprintGraphs(blueprint)
  const graph = graphs.find(graph=>graph.id===id)
  if (!graph) return blueprint
  return {...blueprint,graphId:graph.id,graphName:graph.name,nodes:graph.nodes,edges:graph.edges,additionalGraphs:graphs.filter(item=>item.id!==id),selectedNode:null,selection:null}
}

export function acceptBlueprintEdit(current: Blueprint, next: Blueprint, locked: boolean): Blueprint {
  return locked && JSON.stringify(serializeBlueprint(next)) !== JSON.stringify(serializeBlueprint(current)) ? current : next
}

export function hydrateBlueprint(document: BlueprintDocument, scope: BlueprintScope, revision: string): Blueprint {
  if (document.schemaVersion !== 2 || !Array.isArray(document.graphs) || document.graphs.length === 0 || ['eventFolders','events','functionFolders','functions'].some(key => key in document)) throw new Error('Unsupported blueprint schema: expected V2 graphs')
  const { schemaVersion: _schemaVersion, graphs, ...blueprint } = document
  const migrated = graphs[0] ?? { nodes: [], edges: [] }
  const nodes = migrated.nodes
  const ownerGraph=graphs.find(graph=>graph.nodes.some(node=>node.data.kind==='screen'))
  const owner=ownerGraph?.nodes.find(node=>node.data.kind==='screen')
  const displays=blueprint.displays.map(display=>display.binding||!owner||!ownerGraph?display:{...display,binding:{graphId:ownerGraph.id,nodeId:owner.id,action:'record' as const}})
  const controlOrder={...blueprint.controlOrder}
  for(const display of displays)for(const target of display.targets)if(!controlOrder[target]?.includes(display.id))controlOrder[target]=[...(controlOrder[target]??[]),display.id]
  return { ...blueprint, displays, controlOrder, graphOrder: graphs.map(graph=>graph.id), graphId: migrated.id, graphName: migrated.name, additionalGraphs: graphs.slice(1), nodes, edges: migrated.edges, scope, revision, recordState: 'ready', selectedParameter: null, selectedNode: null, detailCard: null, selection: null, tabs: [{ id: 'overview', kind: 'overview' }, { id: 'blueprint', kind: 'blueprint' }], activeTab: 'overview', openFolders: { recording: true, utilities: true, capture: true, video: true, audio: true, output: true, input: true } }
}

export function exposedParameters(blueprint: Blueprint, cardId: string): string[] {
  return blueprint.cards.find((card) => card.id === cardId)?.parameters ?? []
}

export function allParameters(blueprint: Blueprint): ParameterDefinition[] {
  return [...parameters, ...blueprint.customParameters].map((item) => ({ ...item, label: blueprint.labels[item.id] ?? item.label }))
}

export function isPinned(blueprint: Blueprint, cardId: string, parameterId: string): boolean {
  return blueprint.layouts[cardId]?.some((row) => row.pinned && row.columns.some((column) => column.id === parameterId)) ?? false
}

export function setPinned(blueprint: Blueprint, cardId: string, parameterId: string, pinned: boolean): Blueprint {
  const layout = moveParameterLayout(blueprint.layouts[cardId] ?? [], parameterId, null, 'end', pinned)
  return { ...blueprint, layouts: { ...blueprint.layouts, [cardId]: layout } }
}

export function moveParameterLayout(rows: ParameterRow[], sourceId: string, targetId: string | null, placement: ParameterDropPlacement, targetPinned = false): ParameterRow[] {
  const sourceRow = rows.find((row) => row.columns.some((column) => column.id === sourceId))
  const sourceColumn = sourceRow?.columns.find((column) => column.id === sourceId)
  if (!sourceRow || !sourceColumn || sourceId === targetId) return rows

  const remaining = rows.flatMap((row) => {
    const columns = row.columns.filter((column) => column.id !== sourceId)
    return columns.length ? [{ ...row, columns: normalizeColumns(columns) }] : []
  })
  if (targetId === null || placement === 'end') {
    return normalizeRows([...remaining, { pinned: targetPinned, columns: [{ id: sourceId, weight: 1 }] }])
  }

  const targetIndex = remaining.findIndex((row) => row.columns.some((column) => column.id === targetId))
  if (targetIndex < 0) return rows
  const targetRow = remaining[targetIndex]
  if (!targetRow) return rows

  if (placement === 'above' || placement === 'below') {
    const insertAt = targetIndex + (placement === 'below' ? 1 : 0)
    remaining.splice(insertAt, 0, { pinned: targetRow.pinned, columns: [{ id: sourceId, weight: 1 }] })
    return normalizeRows(remaining)
  }

  const columnIndex = targetRow.columns.findIndex((column) => column.id === targetId)
  const targetColumn = targetRow.columns[columnIndex]
  if (!targetColumn) return rows
  const half = targetColumn.weight / 2
  const movedColumn = { ...sourceColumn, weight: half }
  const columns = [...targetRow.columns]
  columns[columnIndex] = { ...targetColumn, weight: half }
  columns.splice(columnIndex + (placement === 'right' ? 1 : 0), 0, movedColumn)
  remaining[targetIndex] = { ...targetRow, columns: normalizeColumns(columns) }
  return normalizeRows(remaining)
}

function normalizeColumns(columns: ParameterColumn[]): ParameterColumn[] {
  const total = columns.reduce((sum, column) => sum + Math.max(0, column.weight), 0)
  return columns.map((column) => ({ ...column, weight: total ? Math.max(0, column.weight) / total : 1 / columns.length }))
}

function normalizeRows(rows: ParameterRow[]): ParameterRow[] {
  const normalized = rows.filter((row) => row.columns.length).map((row) => ({ ...row, columns: normalizeColumns(row.columns) }))
  return [...normalized.filter((row) => row.pinned), ...normalized.filter((row) => !row.pinned)]
}

export function exposeParameter(blueprint: Blueprint, cardId: string, parameterId: string): Blueprint {
  const card = blueprint.cards.find((item) => item.id === cardId)
  if (!card || card.parameters.includes(parameterId) || !allParameters(blueprint).some((item) => item.id === parameterId)) return blueprint
  const cards = blueprint.cards.map((item) => item.id === cardId ? { ...item, parameters: [...item.parameters, parameterId] } : item)
  const layouts = { ...blueprint.layouts, [cardId]: [...(blueprint.layouts[cardId] ?? []), { pinned: false, columns: [{ id: parameterId, weight: 1 }] }] }
  return { ...blueprint, cards, layouts }
}


import type { Edge, Node } from '@xyflow/react'
import type { LayoutItem, ResponsiveLayouts } from 'react-grid-layout'

export type Value = string | boolean
export type ParameterKind = 'readonly' | 'text' | 'choice' | 'boolean'
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
export type TreeItem = { id: string; name: string; folderId: string }
export type BlueprintSelection = { kind: 'nodes'; keys: string[] } | { kind: 'node' | 'parameter' | 'card' | 'event' | 'function' | 'folder'; key: string } | null
export type NodeKind = 'event' | 'register_control' | 'register_menu' | 'update_control' | 'log' | 'delay' | 'branch' | 'read_parameter' | 'constant' | 'make_boolean' | 'make_byte' | 'make_integer' | 'make_integer64' | 'make_float' | 'make_double' | 'make_name' | 'make_string' | 'make_text' | 'compare' | 'start_pipeline' | 'pause_pipeline' | 'resume_pipeline' | 'stop_pipeline' | 'region' | 'path' | 'screen' | 'audio' | 'encode' | 'write'
export type BlueprintNodeData = { label: string; kind: NodeKind; note?: string; config?: Record<string, unknown> }
export type BlueprintNode = Node<BlueprintNodeData>
export type BlueprintScope = 'builtin' | 'user'
export type PinValueType = 'flow' | 'value' | 'boolean' | 'byte' | 'integer' | 'integer64' | 'float' | 'double' | 'name' | 'string' | 'text' | 'object' | 'soft_object' | 'class' | 'soft_class' | 'interface' | 'delegate' | 'struct' | 'vector' | 'rotator' | 'transform' | 'region' | 'path' | 'video_frames' | 'audio_samples' | 'encoded_video'
export type NodePortDefinition = { id: string; label: string; valueType: PinValueType }
export type NodeTypeDefinition = { kind: NodeKind; label: string; category: string; inputs: NodePortDefinition[]; outputs: NodePortDefinition[]; inputParameters: string[]; defaultConfig: Record<string, unknown> }
export type ControlMenuItem = { id: string; label: string; icon: string; eventId: string; children?: ControlMenuItem[] }
export type RegisteredControl = { id: string; label: string; icon: string; eventId: string; order: number; enabled: boolean; menu: ControlMenuItem[] }
export type EditorTab = { id: string; kind: 'overview' | 'blueprint' | 'card'; cardId?: string }
export type Blueprint = {
  id: string
  name: string
  replay: boolean
  values: Record<string, Value>
  labels: Record<string, string>
  cards: ParameterCard[]
  customParameters: ParameterDefinition[]
  overviewLayouts: OverviewLayouts
  eventFolders: TreeFolder[]
  functionFolders: TreeFolder[]
  variableFolders: TreeFolder[]
  events: TreeItem[]
  functions: TreeItem[]
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
  flow: '#FFFFFF', boolean: '#950000', byte: '#006F65', class: '#5900BC', integer: '#1FE3AF', integer64: '#ACE3AF',
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

export function parameterInputPortId(kind: NodeKind, pathId: string): string {
  return kind === 'branch' && pathId === 'condition' ? pathId : `param:${pathId}`
}

export function exposedInputIds(kind: NodeKind, config: Record<string, unknown>): string[] {
  if (Array.isArray(config.exposedInputs)) return [...new Set(config.exposedInputs.filter((item): item is string => typeof item === 'string'))]
  return kind === 'branch' ? ['condition'] : []
}

export function pinTypeForValue(value: unknown): PinValueType | null {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'float'
  return typeof value === 'string' ? 'string' : null
}

export function syncBlueprintEvents(blueprint: Blueprint): Blueprint {
  const existing = new Map(blueprint.events.map((event) => [event.id, event]))
  const folders = new Set(blueprint.eventFolders.map((folder) => folder.id))
  const events = blueprint.nodes.flatMap((node) => {
    if (node.data.kind !== 'event' || typeof node.data.config?.eventId !== 'string' || !node.data.config.eventId.trim()) return []
    const id = node.data.config.eventId
    const previous = existing.get(id)
    return [{ id, name: node.data.label, folderId: previous && folders.has(previous.folderId) ? previous.folderId : blueprint.eventFolders[0]?.id ?? '' }]
  })
  const selectedEventId = blueprint.selection?.kind === 'event' ? blueprint.selection.key : null
  const selection = selectedEventId && !events.some((event) => event.id === selectedEventId) ? null : blueprint.selection
  return { ...blueprint, events, selection }
}

export const parameters: ParameterDefinition[] = [
  { id: 'display', label: 'Display', kind: 'readonly', initial: 'Display 1 · 2560 × 1440' },
  { id: 'region', label: 'Region', kind: 'readonly', initial: 'x: 0, y: 0, w: 2560, h: 1440' },
  { id: 'cursor', label: 'Show cursor', kind: 'boolean', initial: true },
  { id: 'delay', label: 'Start delay (s)', kind: 'choice', initial: '0', options: ['0', '3', '5'] },
  { id: 'resolution', label: 'Resolution', kind: 'choice', initial: '1920 × 1080', options: ['Source size', '1920 × 1080', '2560 × 1440', '3840 × 2160'] },
  { id: 'fps', label: 'Frame rate', kind: 'choice', initial: '60', options: ['24', '30', '60', '120'] },
  { id: 'encoder', label: 'Encoder', kind: 'choice', initial: 'H.264', options: ['H.264', 'HEVC', 'AV1'] },
  { id: 'bitrate', label: 'Bitrate (Mbps)', kind: 'text', initial: '20' },
  { id: 'systemAudio', label: 'System audio', kind: 'boolean', initial: true },
  { id: 'microphone', label: 'Microphone', kind: 'boolean', initial: false },
  { id: 'device', label: 'Device', kind: 'choice', initial: 'System default', options: ['System default', 'Headphones'] },
  { id: 'sampleRate', label: 'Sample rate', kind: 'choice', initial: '48 kHz', options: ['48 kHz', '44.1 kHz'] },
  { id: 'output', label: 'Output folder', kind: 'text', initial: 'C:/Recordings' },
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
  recording: ['display', 'region', 'cursor'],
  video: ['resolution', 'fps'],
  audio: ['systemAudio', 'microphone'],
  output: ['output'],
  input: ['pointer', 'keyboard', 'mouse'],
  verification: ['threshold'],
}

const cardList = (replay: boolean): ParameterCard[] => [
  { id: 'recording', name: 'Recording settings', parameters: ['display', 'region', 'cursor', 'delay'] },
  { id: 'video', name: 'Video', parameters: ['resolution', 'fps', 'encoder', 'bitrate'] },
  { id: 'audio', name: 'Audio', parameters: ['systemAudio', 'microphone', 'device', 'sampleRate'] },
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
  const flow = (source: string, target: string) => edges.push({ id: `e-${source}-${target}`, source, sourceHandle: 'out:flow', target, targetHandle: 'in:flow', type: 'smoothstep' })
  const value = (source: string, output: string, target: string, input: string) => edges.push({ id: `e-${source}-${target}-${input}`, source, sourceHandle: `out:${output}`, target, targetHandle: `in:${input}`, type: 'smoothstep' })
  const control = (id: string, label: string, icon: string, eventId: string, enabled: boolean, order: number) => ({ id, label, icon, eventId, order, enabled })

  add('initialize', 'event', 'On Initialize', 0, 40, { eventId: 'event-initialize' })
  add('register-select', 'register_control', 'Register Select Region', 330, 0, { control: control('select-region', 'Select Region', 'crop', 'event-select-region', true, 0) })
  add('register-start', 'register_control', 'Register Start', 620, 0, { control: control('start-recording', 'Start recording', 'play', 'event-start', true, 1) })
  add('register-pause', 'register_control', 'Register Pause', 910, 0, { control: control('pause-recording', 'Pause', 'pause', 'event-pause', false, 2) })
  add('register-stop', 'register_control', 'Register Stop', 1200, 0, { control: control('stop-recording', 'Stop', 'stop-circle', 'event-stop', false, 3) })
  add('menu-capture-target', 'register_menu', 'Register Capture Target Menu', 1490, 1800, { controlId: 'select-region', path: 'Capture Target', icon: 'monitor', eventId: 'event-select-display' })
  add('menu-display-1', 'register_menu', 'Register Display 1 Menu', 1780, 1800, { controlId: 'select-region', path: 'Capture Target/Display 1', icon: 'monitor', eventId: 'event-select-display-1' })
  add('menu-active-window', 'register_menu', 'Register Active Window Menu', 2070, 1800, { controlId: 'select-region', path: 'Capture Target/Active Window', icon: 'mouse-pointer-2', eventId: 'event-select-window' })
  add('menu-start', 'register_menu', 'Register Start Menu', 2360, 1800, { controlId: 'start-recording', path: 'Start', icon: 'play', eventId: 'event-start' })
  add('menu-delayed-start', 'register_menu', 'Register Delayed Start Menu', 2650, 1800, { controlId: 'start-recording', path: 'Start/Start after 3 seconds', icon: 'clock-3', eventId: 'event-start-delayed' })
  flow('initialize', 'register-select'); flow('register-select', 'register-start'); flow('register-start', 'register-pause'); flow('register-pause', 'register-stop')
  flow('register-stop', 'menu-capture-target'); flow('menu-capture-target', 'menu-display-1'); flow('menu-display-1', 'menu-active-window'); flow('menu-active-window', 'menu-start'); flow('menu-start', 'menu-delayed-start')

  add('event-select-region', 'event', 'On Select Region', 0, 230, { eventId: 'event-select-region' })
  add('log-select-region', 'log', 'Log Region Selection', 330, 230, { message: 'Screen region selection requested (simulation)' })
  flow('event-select-region', 'log-select-region')
  for (const [id, label, message, y] of [
    ['event-select-display', 'On Select Display', 'Display selection requested (simulation)', 370],
    ['event-select-display-1', 'On Select Display 1', 'Display 1 selected (simulation)', 510],
    ['event-select-window', 'On Select Window', 'Window selection requested (simulation)', 650],
  ] as const) {
    add(id, 'event', label, 0, y, { eventId: id })
    const logId = `log-${id}`
    add(logId, 'log', `Log ${label.replace('On ', '')}`, 330, y, { message })
    flow(id, logId)
  }

  add('event-start', 'event', 'On Start Recording', 0, 850, { eventId: 'event-start' })
  add('log-start', 'log', 'Log Start', 330, 850, { message: 'Recording started (simulation)' })
  add('pipeline-start', 'start_pipeline', 'Start Media Pipeline', 610, 850, { outputNodeId: 'write' })
  add('control-start-recording', 'update_control', 'Update Start Control', 910, 850, { controlId: 'start-recording', patch: { label: 'Recording', icon: 'square', enabled: false } })
  add('control-enable-pause', 'update_control', 'Enable Pause Control', 1200, 850, { controlId: 'pause-recording', patch: { label: 'Pause', icon: 'pause', eventId: 'event-pause', enabled: true } })
  add('control-enable-stop', 'update_control', 'Enable Stop Control', 1490, 850, { controlId: 'stop-recording', patch: { enabled: true } })
  flow('event-start', 'log-start'); flow('log-start', 'pipeline-start'); flow('pipeline-start', 'control-start-recording'); flow('control-start-recording', 'control-enable-pause'); flow('control-enable-pause', 'control-enable-stop')

  add('event-start-delayed', 'event', 'On Start After Delay', 0, 1030, { eventId: 'event-start-delayed' })
  add('log-delayed', 'log', 'Log Delayed Start', 330, 1030, { message: 'Recording will start after 3 seconds (simulation)' })
  add('control-starting-delayed', 'update_control', 'Disable Start During Delay', 610, 1030, { controlId: 'start-recording', patch: { label: 'Starting…', icon: 'clock-3', enabled: false } })
  add('control-enable-stop-delayed', 'update_control', 'Enable Stop During Delay', 910, 1030, { controlId: 'stop-recording', patch: { enabled: true } })
  add('delay-start', 'delay', 'Wait 3 Seconds', 1200, 1030, { milliseconds: 3000 })
  add('pipeline-start-delayed', 'start_pipeline', 'Start Media Pipeline', 1490, 1030, { outputNodeId: 'write' })
  add('control-start-delayed', 'update_control', 'Update Start Control', 1780, 1030, { controlId: 'start-recording', patch: { label: 'Recording', icon: 'square', enabled: false } })
  add('control-pause-delayed', 'update_control', 'Enable Pause Control', 2070, 1030, { controlId: 'pause-recording', patch: { label: 'Pause', icon: 'pause', eventId: 'event-pause', enabled: true } })
  add('control-stop-delayed', 'update_control', 'Enable Stop Control', 2360, 1030, { controlId: 'stop-recording', patch: { enabled: true } })
  flow('event-start-delayed', 'log-delayed'); flow('log-delayed', 'control-starting-delayed'); flow('control-starting-delayed', 'control-enable-stop-delayed'); flow('control-enable-stop-delayed', 'delay-start'); flow('delay-start', 'pipeline-start-delayed'); flow('pipeline-start-delayed', 'control-start-delayed'); flow('control-start-delayed', 'control-pause-delayed'); flow('control-pause-delayed', 'control-stop-delayed')

  add('event-pause', 'event', 'On Pause Recording', 0, 1260, { eventId: 'event-pause' })
  add('pipeline-pause', 'pause_pipeline', 'Pause Media Pipeline', 330, 1260)
  add('control-resume', 'update_control', 'Show Resume Control', 610, 1260, { controlId: 'pause-recording', patch: { label: 'Resume', icon: 'play', eventId: 'event-resume', enabled: true } })
  flow('event-pause', 'pipeline-pause'); flow('pipeline-pause', 'control-resume')
  add('event-resume', 'event', 'On Resume Recording', 0, 1430, { eventId: 'event-resume' })
  add('pipeline-resume', 'resume_pipeline', 'Resume Media Pipeline', 330, 1430)
  add('control-pause', 'update_control', 'Show Pause Control', 610, 1430, { controlId: 'pause-recording', patch: { label: 'Pause', icon: 'pause', eventId: 'event-pause', enabled: true } })
  flow('event-resume', 'pipeline-resume'); flow('pipeline-resume', 'control-pause')

  add('event-stop', 'event', 'On Stop Recording', 0, 1600, { eventId: 'event-stop' })
  add('pipeline-stop', 'stop_pipeline', 'Stop Media Pipeline', 330, 1600)
  add('control-reset-start', 'update_control', 'Reset Start Control', 610, 1600, { controlId: 'start-recording', patch: { label: 'Start recording', icon: 'play', enabled: true } })
  add('control-reset-pause', 'update_control', 'Disable Pause Control', 910, 1600, { controlId: 'pause-recording', patch: { label: 'Pause', icon: 'pause', eventId: 'event-pause', enabled: false } })
  add('control-reset-stop', 'update_control', 'Disable Stop Control', 1200, 1600, { controlId: 'stop-recording', patch: { enabled: false } })
  flow('event-stop', 'pipeline-stop'); flow('pipeline-stop', 'control-reset-start'); flow('control-reset-start', 'control-reset-pause'); flow('control-reset-pause', 'control-reset-stop')

  add('region', 'region', 'Screen Region', 1940, 30, { display: 'Display 1', x: 0, y: 0, width: 2560, height: 1440 })
  add('screen', 'screen', 'Capture Screen', 1940, 230)
  add('audio', 'audio', 'Capture Audio', 1940, 430)
  add('encode', 'encode', 'Encode Media', 2250, 280, { encoder: 'H.264', fps: 60 })
  add('path', 'path', 'Output Path', 2250, 500, { directory: 'C:/Recordings', filename: '{blueprint}_{timestamp}.mp4' })
  add('write', 'write', 'Write Output', 2560, 370)
  value('region', 'region', 'screen', 'region')
  value('screen', 'frames', 'encode', 'frames')
  value('audio', 'audio', 'encode', 'audio')
  value('encode', 'video', 'write', 'video')
  value('path', 'path', 'write', 'path')
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
    id, name, replay, values, labels: Object.fromEntries(parameters.map((item) => [item.id, item.label])), cards, layouts, overviewLayouts, customParameters: [],
    eventFolders: [{ id: 'recording', name: 'Recording' }],
    functionFolders: [{ id: 'utilities', name: 'Utilities' }],
    variableFolders: [{ id: 'capture', name: 'Capture' }, { id: 'video', name: 'Video' }, { id: 'audio', name: 'Audio' }, { id: 'output', name: 'Output' }, ...(replay ? [{ id: 'input', name: 'Input' }] : [])],
    events: [],
    functions: [{ id: 'function-path', name: 'Prepare Output Path', folderId: 'utilities' }],
    tabs: [{ id: 'overview', kind: 'overview' }, { id: 'blueprint', kind: 'blueprint' }], activeTab: 'overview',
    nodes: flow.nodes, edges: flow.edges, recordState: 'ready', supported: !replay, scope: 'user', revision: null, selectedParameter: null, selectedNode: null, detailCard: null,
    selection: null, openFolders: { recording: true, utilities: true, capture: true, video: true, audio: true, output: true, input: true },
  }
  return syncBlueprintEvents(blueprint)
}

export type BlueprintDocument = Omit<Blueprint, 'recordState' | 'selectedParameter' | 'selectedNode' | 'detailCard' | 'selection' | 'openFolders' | 'tabs' | 'activeTab' | 'scope' | 'revision'> & { schemaVersion: 1 }

export function serializeBlueprint(blueprint: Blueprint): BlueprintDocument {
  const { recordState: _recordState, selectedParameter: _selectedParameter, selectedNode: _selectedNode, detailCard: _detailCard, selection: _selection, openFolders: _openFolders, tabs: _tabs, activeTab: _activeTab, scope: _scope, revision: _revision, ...document } = blueprint
  const nodes = blueprint.nodes.map(({ selected: _selected, dragging: _dragging, resizing: _resizing, measured: _measured, width: _width, height: _height, ...node }) => node)
  return { ...document, nodes, events: syncBlueprintEvents(blueprint).events, schemaVersion: 1 }
}

export function hydrateBlueprint(document: BlueprintDocument, scope: BlueprintScope, revision: string): Blueprint {
  const { schemaVersion: _schemaVersion, ...blueprint } = document
  const migrated = migrateLegacyMenus(blueprint.nodes, blueprint.edges)
  let registrationOrder = 0
  const nodes = migrated.nodes.map((node) => {
    if (node.data.kind !== 'register_control') return node
    const order = registrationOrder++
    const control = node.data.config?.control
    if (!control || typeof control !== 'object' || Array.isArray(control) || 'order' in control) return node
    return { ...node, data: { ...node.data, config: { ...node.data.config, control: { ...control, order } } } }
  })
  return syncBlueprintEvents({ ...blueprint, nodes, edges: migrated.edges, scope, revision, recordState: 'ready', selectedParameter: null, selectedNode: null, detailCard: null, selection: null, tabs: [{ id: 'overview', kind: 'overview' }, { id: 'blueprint', kind: 'blueprint' }], activeTab: 'overview', openFolders: { recording: true, utilities: true, capture: true, video: true, audio: true, output: true, input: true } })
}

function migrateLegacyMenus(nodes: BlueprintNode[], edges: Edge[]): { nodes: BlueprintNode[]; edges: Edge[] } {
  const registrations: Array<{ controlId: string; path: string; icon: string; eventId: string; nodeId: string }> = []
  const nextNodes = nodes.map((node) => {
    if (node.data.kind !== 'register_control') return node
    const value = node.data.config?.control
    if (!value || typeof value !== 'object' || Array.isArray(value)) return node
    const control = value as Record<string, unknown>
    if (!Array.isArray(control.menu)) return node
    const id = typeof control.id === 'string' ? control.id : ''
    const migrated: typeof registrations = []
    const visit = (items: unknown[], parents: string[], indexes: number[]): boolean => {
      for (const [index, item] of items.entries()) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false
        const menu = item as Record<string, unknown>
        if (typeof menu.label !== 'string' || !menu.label || menu.label.includes('/') || typeof menu.icon !== 'string' || typeof menu.eventId !== 'string' || ('children' in menu && !Array.isArray(menu.children))) return false
        const segments = [...parents, menu.label]
        migrated.push({ controlId: id, path: segments.join('/'), icon: menu.icon, eventId: menu.eventId, nodeId: `register-menu-${node.id}-${[...indexes, index].join('-')}` })
        if (Array.isArray(menu.children) && !visit(menu.children, segments, [...indexes, index])) return false
      }
      return true
    }
    if (!visit(control.menu, [], [])) return node
    registrations.push(...migrated)
    const { menu: _menu, ...nextControl } = control
    return { ...node, data: { ...node.data, config: { ...node.data.config, control: nextControl } } }
  })
  if (registrations.length === 0) return { nodes: nextNodes, edges }

  const usedIds = new Set(nextNodes.map((node) => node.id))
  for (const registration of registrations) {
    const baseId = registration.nodeId
    let suffix = 2
    while (usedIds.has(registration.nodeId)) registration.nodeId = `${baseId}-${suffix++}`
    usedIds.add(registration.nodeId)
  }
  const initId = nextNodes.find((node) => node.data.kind === 'event' && node.data.config?.eventId === 'event-initialize')?.id
  let tail = initId
  const visited = new Set<string>()
  while (tail && !visited.has(tail)) {
    visited.add(tail)
    const edge = edges.find((item) => item.source === tail && item.sourceHandle === 'out:flow')
    if (!edge) break
    tail = edge.target
  }
  const nextEdges = [...edges]
  for (const [index, registration] of registrations.entries()) {
    nextNodes.push({ id: registration.nodeId, type: 'register_menu', position: { x: (index % 4) * 290, y: 1800 + Math.floor(index / 4) * 150 }, data: { kind: 'register_menu', label: `Register ${registration.path} Menu`, config: { controlId: registration.controlId, path: registration.path, icon: registration.icon, eventId: registration.eventId } } })
    if (tail) nextEdges.push({ id: `e-${tail}-${registration.nodeId}`, source: tail, sourceHandle: 'out:flow', target: registration.nodeId, targetHandle: 'in:flow', type: 'smoothstep' })
    tail = registration.nodeId
  }
  return { nodes: nextNodes, edges: nextEdges }
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


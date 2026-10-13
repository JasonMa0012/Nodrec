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
export type BlueprintSelection = { kind: 'node' | 'parameter' | 'card' | 'event' | 'function' | 'folder'; key: string } | null
export type NodeKind = 'event' | 'region' | 'screen' | 'audio' | 'encode' | 'write' | 'path'
export type BlueprintNodeData = { label: string; kind: NodeKind; note?: string }
export type BlueprintNode = Node<BlueprintNodeData>
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
  recordState: 'ready' | 'recording' | 'paused'
  selectedParameter: string | null
  selectedNode: string | null
  detailCard: string | null
  selection: BlueprintSelection
  openFolders: Record<string, boolean>
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

export function overviewGridHeight(pinnedRows: number): number {
  // shortcut: estimate card height from row count; measure content if controls become variable-height.
  return Math.ceil((82 + pinnedRows * 48 + Math.max(0, pinnedRows - 1) * 11 + 14) / 22)
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

const graph = (): { nodes: BlueprintNode[]; edges: Edge[] } => {
  const nodes: BlueprintNode[] = [
    { id: 'start', type: 'event', position: { x: 20, y: 80 }, data: { label: 'On Start Recording', kind: 'event' } },
    { id: 'region', type: 'region', position: { x: 20, y: 300 }, data: { label: 'Select Screen Region', kind: 'region' } },
    { id: 'screen', type: 'screen', position: { x: 390, y: 60 }, data: { label: 'Capture Screen', kind: 'screen' } },
    { id: 'audio', type: 'audio', position: { x: 390, y: 340 }, data: { label: 'Capture Audio', kind: 'audio' } },
    { id: 'encode', type: 'encode', position: { x: 760, y: 130 }, data: { label: 'Encode Video', kind: 'encode' } },
    { id: 'write', type: 'write', position: { x: 1100, y: 170 }, data: { label: 'Write Output', kind: 'write' } },
  ]
  const edges: Edge[] = [
    { id: 'e-start-screen', source: 'start', sourceHandle: 'out:flow', target: 'screen', targetHandle: 'in:flow', type: 'smoothstep' },
    { id: 'e-region-screen', source: 'region', sourceHandle: 'out:rect', target: 'screen', targetHandle: 'in:rect', type: 'smoothstep' },
    { id: 'e-screen-encode', source: 'screen', sourceHandle: 'out:video', target: 'encode', targetHandle: 'in:video', type: 'smoothstep' },
    { id: 'e-audio-encode', source: 'audio', sourceHandle: 'out:audio', target: 'encode', targetHandle: 'in:audio', type: 'smoothstep' },
    { id: 'e-encode-write', source: 'encode', sourceHandle: 'out:encoded', target: 'write', targetHandle: 'in:encoded', type: 'smoothstep' },
  ]
  return { nodes, edges }
}

export function createBlueprint(id: string, name: string, replay = false): Blueprint {
  const cards = cardList(replay)
  const values = Object.fromEntries(parameters.map(({ id: key, initial }) => [key, initial]))
  const layouts = Object.fromEntries(cards.map((card) => [card.id, card.parameters.map((parameter) => ({
    pinned: pinMap[card.id]?.includes(parameter) ?? false,
    columns: [{ id: parameter, weight: 1 }],
  }))]))
  const cardHeight = (cardId: string) => overviewGridHeight(layouts[cardId]?.filter((row) => row.pinned).length ?? 0)
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
  return {
    id, name, replay, values, labels: Object.fromEntries(parameters.map((item) => [item.id, item.label])), cards, layouts, overviewLayouts, customParameters: [],
    eventFolders: [{ id: 'recording', name: 'Recording' }],
    functionFolders: [{ id: 'utilities', name: 'Utilities' }],
    variableFolders: [{ id: 'capture', name: 'Capture' }, { id: 'video', name: 'Video' }, { id: 'audio', name: 'Audio' }, { id: 'output', name: 'Output' }, ...(replay ? [{ id: 'input', name: 'Input' }] : [])],
    events: [
      { id: 'event-region', name: 'On Select Region', folderId: 'recording' },
      { id: 'event-start', name: 'On Start Recording', folderId: 'recording' },
      { id: 'event-pause', name: 'On Pause Recording', folderId: 'recording' },
      { id: 'event-stop', name: 'On Stop Recording', folderId: 'recording' },
      { id: 'event-frame', name: 'On Recording Frame', folderId: 'recording' },
    ],
    functions: [{ id: 'function-path', name: 'Prepare Output Path', folderId: 'utilities' }],
    tabs: [{ id: 'overview', kind: 'overview' }], activeTab: 'overview',
    nodes: flow.nodes, edges: flow.edges, recordState: 'ready', selectedParameter: null, selectedNode: null, detailCard: null,
    selection: null, openFolders: { recording: true, utilities: true, capture: true, video: true, audio: true, output: true, input: true },
  }
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

export function addNode(blueprint: Blueprint, kind: NodeKind): Blueprint {
  const titles: Record<NodeKind, string> = { event: 'On Recording Frame', region: 'Select Screen Region', screen: 'Capture Screen', audio: 'Capture Audio', encode: 'Encode Video', write: 'Write Output', path: 'Make Unique Path' }
  const id = `${kind}-${crypto.randomUUID().slice(0, 8)}`
  const position = { x: 100 + (blueprint.nodes.length % 3) * 310, y: 60 + Math.floor(blueprint.nodes.length / 3) * 210 }
  return { ...blueprint, nodes: [...blueprint.nodes, { id, type: kind, position, data: { kind, label: titles[kind] } }] }
}


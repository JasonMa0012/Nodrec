import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  addEdge, applyEdgeChanges, applyNodeChanges, Background, BackgroundVariant, BaseEdge, Handle, Position, reconnectEdge,
  ReactFlow, ReactFlowProvider, SelectionMode, useReactFlow, useNodesInitialized, useStore, useUpdateNodeInternals,
  type Connection, type ConnectionLineComponentProps, type Edge, type EdgeProps, type EdgeChange, type Node, type NodeChange, type NodeProps,
} from '@xyflow/react'
import {
  AudioLines, Copy, FileOutput, FolderOpen, GitBranch, ListPlus, Monitor, MousePointer2,
  Settings, Square, Video, Workflow,
} from 'lucide-react'
import { connectedNodeIds, ribbonOffsets, routePoints, roundedPath, type RoutePoint } from './graph-interactions'
import { formatGraph, type NodeGeometry } from './graph-layout'
import { allParameters, copyNamedValues, parameterInputPortId, pinTypeColor, pinTypeForValue, type Blueprint, type BlueprintNodeData, type BlueprintSelection, type NodePortDefinition, type NodeTypeDefinition } from './model'

type CanvasNodeData = BlueprintNodeData & { configEditor: ReactNode; actionEditor: ReactNode;
  inputEditor: (port:NodePortDefinition) => ReactNode
  inputs: NodePortDefinition[]
  outputs: NodePortDefinition[]
  connectedHandles: string[]
  recordState: Blueprint['recordState']
  editTitle: (nodeId: string) => void
}
type CanvasNode = Node<CanvasNodeData>

type RoutedEdgeData = { routePoints?: RoutePoint[]; ribbonOffset: number; setPoints: (id: string, points: RoutePoint[]) => void; locked: boolean }

function RoutedEdge({ id, sourceX, sourceY, targetX, targetY, style, markerEnd, data }: EdgeProps<Edge<RoutedEdgeData>>) {
  const { screenToFlowPosition } = useReactFlow()
  const points = routePoints(data)
  const anchors = [{ x: sourceX, y: sourceY }, ...points, { x: targetX, y: targetY }]
  return <>
    {anchors.slice(1).map((end, index) => {
      const start = anchors[index]!
      const path = roundedPath(start, end, points.length ? 0 : data?.ribbonOffset)
      return <g key={index} onDoubleClick={(event) => {
        event.stopPropagation()
        if (!data || data.locked) return
        const point = screenToFlowPosition({ x: event.clientX, y: event.clientY })
        data.setPoints(id, [...points.slice(0, index), point, ...points.slice(index)])
      }}><BaseEdge path={path} style={style} markerEnd={index === anchors.length - 2 ? markerEnd : undefined} interactionWidth={16} /></g>
    })}
    {points.map((point, index) => <circle key={index} className="route-pin nodrag nopan" cx={point.x} cy={point.y} r={5} fill={style?.stroke ?? '#fff'} tabIndex={0} role="button" aria-label="Routing pin: drag to move, double-click or Delete to remove" onPointerDown={(event) => {
      event.stopPropagation()
      if (!data || data.locked || event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
    }} onPointerMove={(event) => {
      if (!data || data.locked || !event.currentTarget.hasPointerCapture(event.pointerId)) return
      event.stopPropagation()
      data.setPoints(id, points.map((item, i) => i === index ? screenToFlowPosition({ x: event.clientX, y: event.clientY }) : item))
    }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onDoubleClick={(event) => { event.stopPropagation(); if (data && !data.locked) data.setPoints(id, points.filter((_, i) => i !== index)) }} onKeyDown={(event) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      event.stopPropagation(); event.preventDefault()
      if (data && !data.locked) data.setPoints(id, points.filter((_, i) => i !== index))
    }} />)}
  </>
}
const edgeTypes = { routed: RoutedEdge }

function RoundedConnection({ fromX, fromY, toX, toY, connectionLineStyle }: ConnectionLineComponentProps) {
  return <path className="react-flow__connection-path" d={roundedPath({ x: fromX, y: fromY }, { x: toX, y: toY })} fill="none" style={connectionLineStyle} />
}

const icons = {
  define_value: Square, read_value: Square,
  select_region: MousePointer2, get_selected_region: MousePointer2,
  read_parameter: Settings, constant: Square, make_boolean: Square, make_byte: Square, make_integer: Square, make_integer64: Square, make_float: Square, make_double: Square, make_name: Square, make_string: Square, make_text: Square, compare: GitBranch,
  region: MousePointer2, path: FileOutput, screen: Monitor,
  audio: AudioLines, encode_media_foundation: Video, write: FileOutput,
}

function Port({ port, side, connected, editor, hideLabel = false }: { hideLabel?: boolean; port: NodePortDefinition; side: 'in' | 'out'; connected: boolean; editor?:ReactNode }) {
  const color = pinTypeColor(port.valueType)
  const glyph = <svg className="pin-glyph" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4" /></svg>
  return <div className={`port-row ${side}`}>
    {side === 'in' && <Handle className={connected ? '' : ' unconnected'} id={`in:${port.id}`} type="target" position={Position.Left} title={port.label} aria-label={port.label} style={{ color }}>{glyph}</Handle>}
    {!hideLabel && <span className="port-label">{port.label}</span>}{side==='in'&&!connected&&editor}
    {side === 'out' && <Handle className={connected ? '' : ' unconnected'} id={`out:${port.id}`} type="source" position={Position.Right} title={port.label} aria-label={port.label} style={{ color }}>{glyph}</Handle>}
  </div>
}

function configInputPorts(node: Blueprint['nodes'][number], definition: NodeTypeDefinition): NodePortDefinition[] {
  const config = node.data.config ?? {}
  const exposed = definition.inputParameters
  const inputs = definition.inputs.filter((port) => !definition.inputParameters.includes(port.id) || exposed.includes(port.id))
  return [...inputs, ...exposed.flatMap((id) => {
    if (definition.inputs.some((port) => port.id === id)) return []
    const currentValue = id.split('.').reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, config)
    const schema = node.data.kind === 'constant' && id === 'value' ? config : definition.defaultConfig
    const value = id.split('.').reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, schema)
    const valueType = node.data.kind.startsWith('make_') && id === 'value' ? definition.outputs.find((port) => port.id === 'value')?.valueType ?? null : pinTypeForValue(value)
    if (!valueType || currentValue === undefined) return []
    const name = id.split('.').at(-1) ?? id
    const label = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())
    return [{ id: parameterInputPortId(node.data.kind, id), label, valueType }]
  })]
}

function configOutputPorts(node: Blueprint['nodes'][number], definition: NodeTypeDefinition, values: Blueprint['values']): NodePortDefinition[] {
  return definition.outputs.map((port) => {
    if (port.valueType !== 'value') return port
    const value = node.data.kind === 'constant' ? node.data.config?.value
      : node.data.kind === 'read_parameter' && typeof node.data.config?.parameterId === 'string' ? values[node.data.config.parameterId] : undefined
    return { ...port, valueType: pinTypeForValue(value) ?? port.valueType }
  })
}

function WorkflowNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const updateNodeInternals = useUpdateNodeInternals()
  const portIds = [...data.inputs.map(port => `in:${port.id}`), ...data.outputs.map(port => `out:${port.id}`)].join('|')
  const previousPortIds = useRef(portIds)
  useEffect(() => {
    if (previousPortIds.current === portIds) return
    previousPortIds.current = portIds
    updateNodeInternals(id)
  }, [id, portIds, updateNodeInternals])
  const Icon = icons[data.kind] ?? Square
  const caption = data.note
  const inputs = data.inputs
  const outputs = data.outputs
  return <div data-kind={data.kind} className={`flow-node${data.enabled === false ? ' node-disabled' : ''}${selected ? ' selected' : ''}`}>
    <div className="node-title" title="Double-click to rename" onDoubleClick={(event) => { event.stopPropagation(); data.editTitle(id) }}>
      <Icon size={15} />{data.label}{data.enabled === false && <span> · Disabled</span>}
    </div>
    <div className="node-body">
      {data.actionEditor}
      {data.kind === 'read_parameter' ? <div className="parameter-node-value"><div className="node-inline-config nodrag nowheel nopan">{data.configEditor}</div>{outputs.map(port => <Port hideLabel key={port.id} port={port} side="out" connected={data.connectedHandles.includes(`out:${port.id}`)} />)}</div> : (inputs.length > 0 || outputs.length > 0) && <div className="node-ports">
        <div className="port-column input-ports">{inputs.map((port) => <Port key={`in:${port.id}`} port={port} side="in" connected={data.connectedHandles.includes(`in:${port.id}`)} editor={data.inputEditor(port)} />)}</div>
        <div className="port-column output-ports">{outputs.map((port) => <Port key={`out:${port.id}`} port={port} side="out" connected={data.connectedHandles.includes(`out:${port.id}`)} />)}</div>
      </div>}
      {caption && <div className="node-note">{caption}</div>}{data.kind !== 'read_parameter' && <div className="node-inline-config nodrag nowheel nopan">{data.configEditor}</div>}
    </div>
  </div>
}

function withoutSelectedNodes(selection: BlueprintSelection, removed: Set<string>): BlueprintSelection {
  if (selection?.kind === 'node') return removed.has(selection.key) ? null : selection
  if (selection?.kind !== 'nodes') return selection
  const keys = selection.keys.filter((id) => !removed.has(id))
  return keys.length > 1 ? { kind: 'nodes', keys } : keys.length === 1 ? { kind: 'node', key: keys[0]! } : null
}

function Canvas({ blueprint, update, selectNode, selectNodes, editNodeTitle, catalog, locked, focusRequest, graphName, renderNodeConfig, renderNodeActions, renderNodeInput }: {
  renderNodeConfig: (node: Blueprint['nodes'][number]) => ReactNode
  renderNodeActions: (node: Blueprint['nodes'][number]) => ReactNode
  renderNodeInput: (node: Blueprint['nodes'][number],port:NodePortDefinition) => ReactNode
  focusRequest?: { id: string; sequence: number } | null
  graphName?: string
  blueprint: Blueprint
  update: (value: Blueprint | ((current: Blueprint) => Blueprint)) => void
  selectNode: (id: string | null) => void
  selectNodes: (ids: string[]) => void
  editNodeTitle: (id: string) => void
  catalog: NodeTypeDefinition[]
  locked: boolean
}) {
  const { fitView, getViewport, getInternalNode, screenToFlowPosition, setViewport } = useReactFlow<CanvasNode>()
  const measuredNodes = useStore(state => JSON.stringify([...state.nodeLookup.values()].map(node => [node.id, node.measured, node.internals.positionAbsolute, node.internals.handleBounds])))
  const [formatRequest, setFormatRequest] = useState<{ selectedIds: string[]; onlySelected: boolean } | null>(null)
  const initialized = useNodesInitialized()
  const initialViewport = useRef(false)
  useEffect(() => {
    if (!initialized || initialViewport.current) return
    initialViewport.current = true
    const entry = blueprint.nodes.find(node => node.id === blueprint.selectedNode) ?? blueprint.nodes.find(node => node.data.kind === 'screen') ?? blueprint.nodes[0]
    if (entry) void setViewport({ x:64-entry.position.x*.9, y:88-entry.position.y*.9, zoom:.9 })
  }, [initialized, blueprint.nodes, blueprint.selectedNode, setViewport])
  useEffect(() => {
    if (initialized && focusRequest) void fitView({ nodes: [{ id: focusRequest.id }], minZoom: 1, maxZoom: 1, duration: 250 })
  }, [fitView, initialized, focusRequest])
  const shellRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return
    const pan = (wheel: WheelEvent) => {
      // shortcut: browsers do not expose the wheel device; recalibrate if hardware deltas overlap.
      const mouseWheel = wheel.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || Math.max(Math.abs(wheel.deltaX), Math.abs(wheel.deltaY)) >= 80
      if (!(wheel.target instanceof Element) || !wheel.target.closest('.react-flow') || wheel.target.closest('.nowheel')) return
      wheel.preventDefault()
      wheel.stopPropagation()
      const viewport = getViewport()
      if (wheel.ctrlKey || mouseWheel) {
        const bounds = wheel.target.closest('.react-flow')!.getBoundingClientRect()
        const factor = wheel.ctrlKey && /Mac/.test(navigator.platform) ? 10 : 1
        const delta = -wheel.deltaY * (wheel.deltaMode === 1 ? .05 : wheel.deltaMode ? 1 : .002) * factor * (wheel.ctrlKey ? 4 : 1)
        const zoom = Math.max(.01, Math.min(1.6, viewport.zoom * 2 ** delta))
        const x = wheel.clientX - bounds.left
        const y = wheel.clientY - bounds.top
        void setViewport({ x: x - (x - viewport.x) * zoom / viewport.zoom, y: y - (y - viewport.y) * zoom / viewport.zoom, zoom })
        return
      }
      void setViewport({ x: viewport.x - wheel.deltaX * .5, y: viewport.y - wheel.deltaY * .5, zoom: viewport.zoom })
    }
    // React wheel listeners are passive; native handling must be able to cancel page scrolling/zooming.
    shell.addEventListener('wheel', pan, { capture: true, passive: false })
    return () => shell.removeEventListener('wheel', pan, true)
  }, [getViewport, setViewport])
  const rightDragStart = useRef<{ x: number; y: number } | null>(null)
  const rightDrag = useRef(false)
  const rightPointerDown = useRef(false)
  const pendingContextMenu = useRef<{ x: number; y: number; nodeId: string | null; flowPosition: { x: number; y: number } } | null>(null)
  const clipboardRef = useRef<{ nodes: Blueprint['nodes']; edges: Blueprint['edges'] } | null>(null)
  const pasteCountRef = useRef(0)
  const [hasClipboard, setHasClipboard] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string | null; flowPosition: { x: number; y: number } } | null>(null)
  useEffect(() => {
    if (!contextMenu) return
    const dismiss = (event: Event) => {
      const target = event.target
      if (target instanceof Element && target.closest('.graph-context-menu')) return
      setContextMenu(null)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [contextMenu])
  const reconnecting = useRef<{ id: string; completed: boolean } | null>(null)
  const setRoutePoints = useCallback((id: string, points: RoutePoint[]) => {
    if (!locked) update((current) => ({ ...current, edges: current.edges.map((edge) => edge.id === id ? { ...edge, data: { ...edge.data, routePoints: points } } : edge) }))
  }, [locked, update])
  const related = useMemo(() => {
    const selected = blueprint.nodes.filter((node) => node.selected).map((node) => node.id)
    if (blueprint.selectedNode && !selected.includes(blueprint.selectedNode)) selected.push(blueprint.selectedNode)
    return selected.length ? connectedNodeIds(selected, blueprint.edges) : null
  }, [blueprint.nodes, blueprint.edges, blueprint.selectedNode])
  const definitions = useMemo(() => new Map(catalog.map((definition) => [definition.kind, definition])), [catalog])
  const nodes = useMemo(() => blueprint.nodes.map((node) => ({
    ...node,
    className: related && !related.has(node.id) ? 'unrelated-node' : undefined,
    data: {
      ...node.data,
      label: node.data.kind === 'read_parameter' ? allParameters(blueprint).find(parameter => parameter.id === node.data.config?.parameterId)?.label ?? node.data.label : node.data.label,
      inputs: definitions.get(node.data.kind) ? configInputPorts(node, definitions.get(node.data.kind)!) : [],
      outputs: definitions.get(node.data.kind) ? configOutputPorts(node, definitions.get(node.data.kind)!, blueprint.values) : [],
      connectedHandles: blueprint.edges.flatMap((edge) => [
        edge.source === node.id ? edge.sourceHandle : undefined,
        edge.target === node.id ? edge.targetHandle : undefined,
      ].filter((handle): handle is string => typeof handle === 'string')),
      recordState: blueprint.recordState,
      editTitle: editNodeTitle, inputEditor: (port:NodePortDefinition)=>renderNodeInput(node,port), configEditor: renderNodeConfig(node), actionEditor: renderNodeActions(node),
    },
  })), [blueprint, definitions, editNodeTitle, related, renderNodeConfig, renderNodeActions, renderNodeInput])
  useEffect(() => {
    if (!formatRequest) return
    const frame = requestAnimationFrame(() => {
      if (locked) { setFormatRequest(null); return }
      if (!initialized || measuredNodes === '[]') return
      const geometry = new Map<string, NodeGeometry>()
      for (const node of nodes) {
        const internal = getInternalNode(node.id)
        if (!internal?.measured?.width || !internal.measured.height) return
        geometry.set(node.id, {
          width: internal.measured.width, height: internal.measured.height,
          handles: Object.fromEntries([...(internal.internals.handleBounds?.source ?? []), ...(internal.internals.handleBounds?.target ?? [])].map(handle => [handle.id, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }])),
        })
      }
      const result = formatGraph(nodes, blueprint.edges, geometry, formatRequest.selectedIds, formatRequest.onlySelected)
      if (!result) return
      setFormatRequest(null)
      if (!result.positions.size && !result.resetRouteEdgeIds.size) return
      update(current => ({ ...current,
        nodes: current.nodes.map(node => result.positions.has(node.id) ? { ...node, position: result.positions.get(node.id)! } : node),
        edges: current.edges.map(edge => {
          if (!result.resetRouteEdgeIds.has(edge.id)) return edge
          const data = { ...edge.data }
          delete data.routePoints
          return { ...edge, data }
        }),
      }))
    })
    return () => cancelAnimationFrame(frame)
  }, [formatRequest, initialized, locked, measuredNodes, nodes, blueprint.edges, getInternalNode, update])
  const offsets = useMemo(() => {
    if (measuredNodes === '[]') return new Map<string, number>()
    return ribbonOffsets(blueprint.edges.flatMap(edge => {
      if (routePoints(edge.data).length) return []
      const source = getInternalNode(edge.source)
      const target = getInternalNode(edge.target)
      const from = source?.internals.handleBounds?.source?.find(handle => handle.id === edge.sourceHandle)
      const to = target?.internals.handleBounds?.target?.find(handle => handle.id === edge.targetHandle)
      if (!source || !target || !from || !to) return []
      return [{ id: edge.id,
        start: { x: source.internals.positionAbsolute.x + from.x + from.width / 2, y: source.internals.positionAbsolute.y + from.y + from.height / 2 },
        end: { x: target.internals.positionAbsolute.x + to.x + to.width / 2, y: target.internals.positionAbsolute.y + to.y + to.height / 2 },
      }]
    }))
  }, [blueprint.edges, measuredNodes, getInternalNode])
  const edges = useMemo(() => blueprint.edges.map((edge) => {
    const source = nodes.find((node) => node.id === edge.source)
    const target = nodes.find((node) => node.id === edge.target)
    const sourcePort = source?.data.outputs.find((port) => `out:${port.id}` === edge.sourceHandle)
    const targetPort = target?.data.inputs.find((port) => `in:${port.id}` === edge.targetHandle)
    const valueType = sourcePort?.valueType === 'value' ? targetPort?.valueType : sourcePort?.valueType
    const type = valueType ?? 'value'
    return { ...edge, type: 'routed', data: { ...edge.data, ribbonOffset: offsets.get(edge.id) ?? 0, setPoints: setRoutePoints, locked }, className: related && !related.has(edge.source) ? 'unrelated-edge' : undefined, style: { ...edge.style, stroke: pinTypeColor(type), strokeWidth: 1.7 } }
  }), [blueprint.edges, nodes, setRoutePoints, locked, related, offsets])
  const nodeTypes = useMemo(() => Object.fromEntries(catalog.map((definition) => [
    definition.kind,
    WorkflowNode,
  ])), [catalog])
  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    if (!locked) update((current) => ({ ...current, nodes: applyNodeChanges(changes, current.nodes) as Blueprint['nodes'] }))
  }, [locked, update])
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (!locked) update((current) => ({ ...current, edges: applyEdgeChanges(changes, current.edges) }))
  }, [locked, update])
  const onSelectionChange = useCallback(({ nodes: selected }: { nodes: CanvasNode[] }) => selectNodes(selected.map((node) => node.id)), [selectNodes])
  const onNodesDelete = useCallback((deleted: CanvasNode[]) => {
    if (locked) return
    update((current) => {
      const ids = new Set(deleted.map((node) => node.id))
      return { ...current, nodes: current.nodes.filter((node) => !ids.has(node.id)), edges: current.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)), selectedNode: current.selectedNode && !ids.has(current.selectedNode) ? current.selectedNode : null, selection: withoutSelectedNodes(current.selection, ids) }
    })
  }, [locked, update])
  const onConnect = useCallback((connection: Connection) => {
    if (!locked) update((current) => ({ ...current, edges: addEdge({ ...connection, type: 'smoothstep' }, current.edges) }))
  }, [locked, update])
  const copyNodes = useCallback((nodeIds?: string[]) => {
    const selected = new Set(nodeIds ?? blueprint.nodes.filter((node) => node.selected).map((node) => node.id))
    if (selected.size === 0 && blueprint.selectedNode) selected.add(blueprint.selectedNode)
    const copied = blueprint.nodes.filter((node) => selected.has(node.id))
    if (copied.length === 0) return false
    clipboardRef.current = {
      nodes: structuredClone(copied),
      edges: structuredClone(blueprint.edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target))),
    }
    setHasClipboard(true)
    pasteCountRef.current = 0
    return true
  }, [blueprint.edges, blueprint.nodes, blueprint.selectedNode])
  const pasteNodes = useCallback(() => {
    const clipboard = clipboardRef.current
    if (locked || !clipboard) return
    const nodeIds = new Map(clipboard.nodes.map((node) => [node.id, `node-${crypto.randomUUID()}`]))
    const offset = 32 * ++pasteCountRef.current
    const pasted = copyNamedValues(structuredClone(clipboard.nodes), blueprint.nodes, nodeIds).map((node) => {
      const config = node.data.config ?? {}
      return { ...node, id: nodeIds.get(node.id)!, position: { x: node.position.x + offset, y: node.position.y + offset }, selected: true, data: { ...node.data, config } }
    })
    const edges = structuredClone(clipboard.edges).map((edge) => ({ ...edge, id: `edge-${crypto.randomUUID()}`, source: nodeIds.get(edge.source)!, target: nodeIds.get(edge.target)!, data: { ...edge.data, routePoints: routePoints(edge.data).map((point) => ({ x: point.x + offset, y: point.y + offset })) } }))
    update((current) => ({ ...current, nodes: [...current.nodes.map((node) => ({ ...node, selected: false })), ...pasted], edges: [...current.edges, ...edges] }))
    selectNodes(pasted.map((node) => node.id))
    setContextMenu(null)
  }, [blueprint.nodes, locked, selectNodes, update])
  const removeNode = (id: string) => {
    if (locked) return
    update((current) => ({ ...current, nodes: current.nodes.filter((node) => node.id !== id), edges: current.edges.filter((edge) => edge.source !== id && edge.target !== id), selectedNode: current.selectedNode === id ? null : current.selectedNode, selection: withoutSelectedNodes(current.selection, new Set([id])) }))
    selectNode(null)
    setContextMenu(null)
  }
  const openContextMenu = (event: ReactMouseEvent<Element> | globalThis.MouseEvent, nodeId: string | null) => {
    event.preventDefault()
    event.stopPropagation()
    if (rightDrag.current) { rightDragStart.current = null; return }
    const next = { x: event.clientX, y: event.clientY, nodeId, flowPosition: screenToFlowPosition({ x: event.clientX, y: event.clientY }) }
    if (rightPointerDown.current) { pendingContextMenu.current = next; return }
    if (nodeId) selectNode(nodeId)
    setContextMenu(next)
  }
  const onGraphKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('input, textarea, select, button, [contenteditable]:not([contenteditable="false"])')) return
    if (event.key === 'Escape') { setContextMenu(null); return }
    if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault()
      if (event.repeat) return
      const selectedIds = blueprint.nodes.filter(node => node.selected).map(node => node.id)
      if (blueprint.selectedNode && !selectedIds.includes(blueprint.selectedNode)) selectedIds.push(blueprint.selectedNode)
      if (!selectedIds.length) { if (!event.shiftKey) void fitView({ padding: .2 }); return }
      if (!locked) { setContextMenu(null); setFormatRequest({ selectedIds, onlySelected: event.shiftKey }) }
      return
    }
    if (event.key.toLowerCase() === 'c' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); copyNodes(); return }
    if (event.key.toLowerCase() === 'v' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); pasteNodes() }
  }
  const isValidConnection = useCallback((connection: Edge | Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target || !connection.sourceHandle || !connection.targetHandle) return false
    const source = nodes.find((node) => node.id === connection.source)
    const target = nodes.find((node) => node.id === connection.target)
    const sourcePort = source?.data.outputs.find((port) => `out:${port.id}` === connection.sourceHandle)
    const targetPort = target?.data.inputs.find((port) => `in:${port.id}` === connection.targetHandle)
    if (!sourcePort || !targetPort || (sourcePort.valueType !== targetPort.valueType && (sourcePort.valueType !== 'value' && targetPort.valueType !== 'value'))) return false
    const otherEdges = blueprint.edges.filter((edge) => edge.id !== reconnecting.current?.id)
    return !otherEdges.some((edge) => edge.target === connection.target && edge.targetHandle === connection.targetHandle)
  }, [blueprint.edges, nodes])
  const addNode = (definition: NodeTypeDefinition, position?: { x: number; y: number }) => {
    const id = `node-${crypto.randomUUID()}`
    const config = structuredClone(definition.defaultConfig)
    update((current) => ({ ...current, nodes: [...current.nodes, {
      id, type: definition.kind, position: position ?? { x: 80 + current.nodes.length % 6 * 35, y: 80 + Math.floor(current.nodes.length / 6) * 55 },
      data: { kind: definition.kind, label: definition.label, config },
    }] }))
    selectNode(id)
  }

  return <div className="graph-shell" ref={shellRef} tabIndex={0} onKeyDownCapture={onGraphKeyDown} onMouseDownCapture={(event) => {
    if (event.button === 2 && event.target instanceof Element && event.target.closest('.react-flow__edge,.react-flow__node')) {
      const pane = shellRef.current?.querySelector('.react-flow__pane')
      if (pane) {
        // Start canvas panning when the gesture begins over a node or edge.
        event.preventDefault(); event.stopPropagation()
        pane.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, view: window, button: 2, buttons: 2, clientX: event.clientX, clientY: event.clientY }))
      }
      return
    }
    if (locked || !event.ctrlKey || event.button !== 0 || !(event.target instanceof Element)) return
    const handle = event.target.closest<HTMLElement>('.react-flow__handle')
    if (!handle) return
    const nodeId = handle.dataset.nodeid
    const handleId = handle.dataset.handleid
    const side = handle.classList.contains('source') ? 'source' : 'target'
    const edge = blueprint.edges.find((edge) => side === 'source' ? edge.source === nodeId && edge.sourceHandle === handleId : edge.target === nodeId && edge.targetHandle === handleId)
    if (!edge) return
    const wrapper = [...(shellRef.current?.querySelectorAll<SVGGElement>('.react-flow__edge') ?? [])].find((element) => element.dataset.id === edge.id)
    const anchor = wrapper?.querySelector(`.react-flow__edgeupdater-${side}`)
    if (!anchor) return
    event.preventDefault(); event.stopPropagation()
    // Reuse React Flow's reconnect gesture from a Ctrl-dragged node handle.
    anchor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1, clientX: event.clientX, clientY: event.clientY, ctrlKey: true }))
  }} onPointerDownCapture={(event) => {
    if (event.button === 0 && event.target instanceof Element && event.target.closest('.react-flow') && !event.target.closest('input,select,textarea,button,[contenteditable]')) shellRef.current?.focus({ preventScroll: true })
    if (event.button === 2) {
      rightDragStart.current = { x: event.clientX, y: event.clientY }
      rightDrag.current = false
      rightPointerDown.current = true
      pendingContextMenu.current = null
    }
  }} onPointerMoveCapture={(event) => {
    const start = rightDragStart.current
    if (rightPointerDown.current && start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) {
      rightDrag.current = true
      pendingContextMenu.current = null
    }
  }} onPointerUpCapture={(event) => {
    if (event.button !== 2) return
    rightPointerDown.current = false
    rightDragStart.current = null
    const pending = pendingContextMenu.current
    pendingContextMenu.current = null
    if (pending && !rightDrag.current) {
      if (pending.nodeId) selectNode(pending.nodeId)
      setContextMenu(pending)
    }
  }} onContextMenu={(event) => {
    event.preventDefault()
    const target = event.target
    if (rightDrag.current || !(target instanceof Element) || !target.closest('.react-flow')) return
    const node = target.closest<HTMLElement>('.react-flow__node')
    openContextMenu(event, node?.dataset.id ?? null)
  }}>
        <div className="graph-canvas">
      <div className="graph-breadcrumb" aria-label={`Current path: ${blueprint.name} / ${graphName ?? 'Recording graph'}`}>
        <span className="graph-breadcrumb-item"><Workflow size={14} />{blueprint.name}</span>
        <span className="graph-breadcrumb-divider" aria-hidden="true">/</span>
        <span className="graph-breadcrumb-item current"><FolderOpen size={14} />{graphName ?? 'Recording graph'}</span>
      </div>
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} connectionLineComponent={RoundedConnection} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onNodesDelete={onNodesDelete}
        onConnect={onConnect} isValidConnection={isValidConnection} connectionRadius={30}
        edgesReconnectable={!locked}
        onReconnectStart={(_, edge) => { reconnecting.current = { id: edge.id, completed: false } }}
        onReconnect={(edge, connection) => {
          if (locked) return
          if (reconnecting.current) reconnecting.current.completed = true
          update((current) => ({ ...current, edges: reconnectEdge(current.edges.find((item) => item.id === edge.id)!, connection, current.edges, { shouldReplaceId: false }) }))
        }}
        onReconnectEnd={(_, edge) => {
          if (!locked && reconnecting.current?.id === edge.id && !reconnecting.current.completed) update((current) => ({ ...current, edges: current.edges.filter((item) => item.id !== edge.id) }))
          reconnecting.current = null
        }}
        onSelectionChange={onSelectionChange}
        onNodeClick={(event, node) => { selectNode(node.id); setContextMenu(null); if (!(event.target instanceof Element) || !event.target.closest('input,select,textarea,button,[contenteditable]')) shellRef.current?.focus({ preventScroll: true }) }}
        onPaneClick={() => { selectNode(null); setContextMenu(null); shellRef.current?.focus({ preventScroll: true }) }}
        nodesDraggable={!locked} nodesConnectable={!locked} panOnDrag={[1, 2]} zoomOnDoubleClick={false} panOnScroll={false} zoomOnPinch zoomOnScroll selectionOnDrag={!locked} selectionMode={SelectionMode.Partial} deleteKeyCode={locked ? null : ['Backspace', 'Delete']} minZoom={.01} maxZoom={1.6}
        proOptions={{ hideAttribution: true }} defaultEdgeOptions={{ style: { stroke: '#8492a9', strokeWidth: 1.6 } }}
      >
        <Background variant={BackgroundVariant.Lines} gap={22} size={1} color="#2c2d32" />
      </ReactFlow>
    </div>
    {contextMenu && createPortal(<div className={`graph-context-menu${contextMenu.nodeId ? '' : ' create-node-menu'}`} role="menu" aria-label={contextMenu.nodeId ? 'Node actions' : 'Create node'} style={{ left: Math.max(8, Math.min(window.innerWidth - (contextMenu.nodeId ? 184 : 236), contextMenu.x)), top: Math.max(8, Math.min(window.innerHeight - (contextMenu.nodeId ? 202 : Math.min(window.innerHeight * .65, 520) + 16), contextMenu.y)) }} onContextMenu={(event) => event.preventDefault()}>
      {contextMenu.nodeId ? <>
        <button role="menuitem" onClick={() => { copyNodes([contextMenu.nodeId!]); setContextMenu(null) }}><Copy size={13} />Copy <small>Ctrl+C</small></button>
        <button role="menuitem" disabled={locked} onClick={() => { copyNodes([contextMenu.nodeId!]); pasteNodes() }}><Copy size={13} />Duplicate</button>
        <button role="menuitem" disabled={locked} onClick={() => {
          update(current => ({ ...current, nodes: current.nodes.map(node => node.id === contextMenu.nodeId ? { ...node, data: { ...node.data, enabled: node.data.enabled === false } } : node) }))
          setContextMenu(null)
        }}>{blueprint.nodes.find(node => node.id === contextMenu.nodeId)?.data.enabled === false ? 'Enable' : 'Disable'}</button>
        <div className="graph-context-divider" />
        <button role="menuitem" disabled={locked} className="danger-action" onClick={() => removeNode(contextMenu.nodeId!)}><Square size={12} />Delete</button>
        {hasClipboard && <><div className="graph-context-divider" /><button role="menuitem" disabled={locked} onClick={pasteNodes}><ListPlus size={13} />Paste <small>Ctrl+V</small></button></>}
      </> : <>
        <div className="graph-context-heading">Create node</div>
        {catalog.map((definition) => <button key={definition.kind} role="menuitem" disabled={locked} onClick={() => { addNode(definition, contextMenu.flowPosition); setContextMenu(null) }}><span>{definition.label}</span><small>{definition.category}</small></button>)}
        {hasClipboard && <><div className="graph-context-divider" /><button role="menuitem" disabled={locked} onClick={pasteNodes}><ListPlus size={13} />Paste <small>Ctrl+V</small></button></>}
      </>}
    </div>, document.body)}
  </div>
}

export default function GraphEditor(props: {
  renderNodeConfig: (node: Blueprint['nodes'][number]) => ReactNode
  renderNodeActions: (node: Blueprint['nodes'][number]) => ReactNode
  renderNodeInput: (node: Blueprint['nodes'][number],port:NodePortDefinition) => ReactNode
  focusRequest?: { id: string; sequence: number } | null
  graphName?: string
  blueprint: Blueprint
  update: (value: Blueprint | ((current: Blueprint) => Blueprint)) => void
  selectNode: (id: string | null) => void
  selectNodes: (ids: string[]) => void
  editNodeTitle: (id: string) => void
  catalog: NodeTypeDefinition[]
  locked: boolean
}) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>
}

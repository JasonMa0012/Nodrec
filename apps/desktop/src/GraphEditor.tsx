import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  addEdge, applyEdgeChanges, applyNodeChanges, Background, BackgroundVariant, Handle, Position,
  ReactFlow, ReactFlowProvider, SelectionMode, useReactFlow,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps,
} from '@xyflow/react'
import {
  AudioLines, CirclePlay, Clock3, Copy, FileOutput, GitBranch, ListPlus, Monitor, MousePointer2,
  Pause, Play, Settings, Square, StopCircle, Video,
} from 'lucide-react'
import { exposedInputIds, parameterInputPortId, pinTypeColor, pinTypeForValue, type Blueprint, type BlueprintNodeData, type BlueprintSelection, type NodePortDefinition, type NodeTypeDefinition } from './model'

type CanvasNodeData = BlueprintNodeData & {
  inputs: NodePortDefinition[]
  outputs: NodePortDefinition[]
  recordState: Blueprint['recordState']
  editTitle: (nodeId: string) => void
}
type CanvasNode = Node<CanvasNodeData>

const icons = {
  event: CirclePlay, register_control: Settings, register_menu: Settings, update_control: Settings, log: FileOutput,
  delay: Clock3, branch: GitBranch, read_parameter: Settings, constant: Square, make_boolean: Square, make_byte: Square, make_integer: Square, make_integer64: Square, make_float: Square, make_double: Square, make_name: Square, make_string: Square, make_text: Square, compare: GitBranch,
  start_pipeline: Play, pause_pipeline: Pause, resume_pipeline: Play,
  stop_pipeline: StopCircle, region: MousePointer2, path: FileOutput, screen: Monitor,
  audio: AudioLines, encode: Video, write: FileOutput,
}

function Port({ port, side }: { port: NodePortDefinition; side: 'in' | 'out' }) {
  const execution = port.valueType === 'flow'
  const color = pinTypeColor(port.valueType)
  return <div className={`port-row ${side}${execution ? ' exec-port' : ''}`}>
    {side === 'in' && <Handle className={execution ? 'flow-handle' : ''} id={`in:${port.id}`} type="target" position={Position.Left} style={{ background: color }} />}
    {side === 'in' && !execution && <span>{port.label}</span>}
    {side === 'out' && !execution && <span>{port.label}</span>}
    {side === 'out' && <Handle className={execution ? 'flow-handle' : ''} id={`out:${port.id}`} type="source" position={Position.Right} style={{ background: color }} />}
  </div>
}

function configInputPorts(node: Blueprint['nodes'][number], definition: NodeTypeDefinition): NodePortDefinition[] {
  const config = node.data.config ?? {}
  const exposed = exposedInputIds(node.data.kind, config).filter((id) => definition.inputParameters.includes(id))
  const inputs = definition.inputs.filter((port) => port.valueType === 'flow' || exposed.includes(port.id))
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
  const Icon = icons[data.kind] ?? Square
  const config = data.config ?? {}
  const caption = typeof config.message === 'string' ? config.message
    : typeof config.control === 'object' && config.control && 'label' in config.control ? String(config.control.label)
      : data.kind === 'register_menu' && typeof config.path === 'string' ? config.path
      : typeof config.milliseconds === 'number' ? `${config.milliseconds} ms`
        : data.kind.endsWith('_pipeline') ? data.recordState : data.note
  const executionInputs = data.inputs.filter((port) => port.valueType === 'flow')
  const executionOutputs = data.outputs.filter((port) => port.valueType === 'flow')
  const inputs = data.inputs.filter((port) => port.valueType !== 'flow')
  const outputs = data.outputs.filter((port) => port.valueType !== 'flow')
  const executionY = (index: number, count: number) => `${(index + 1) * 100 / (count + 1)}%`
  return <div className={`flow-node${data.kind === 'event' ? ' event-node' : ''}${selected ? ' selected' : ''}`}>
    <div className={`node-title${executionOutputs.length ? ' has-execution-output' : ''}`} title="Double-click to rename" onDoubleClick={(event) => { event.stopPropagation(); data.editTitle(id) }}>
      {executionInputs.map((port, index) => <Handle key={`in:${port.id}`} className="flow-handle node-title-flow-handle" id={`in:${port.id}`} type="target" position={Position.Left} title={port.label} aria-label={port.label} style={{ top: executionY(index, executionInputs.length), background: pinTypeColor('flow') }} />)}
      <Icon size={15} />{data.label}
      {executionOutputs.map((port, index) => <Handle key={`out:${port.id}`} className="flow-handle node-title-flow-handle" id={`out:${port.id}`} type="source" position={Position.Right} title={port.label} aria-label={port.label} style={{ top: executionY(index, executionOutputs.length), background: pinTypeColor('flow') }} />)}
    </div>
    <div className="node-body">
      {(inputs.length > 0 || outputs.length > 0) && <div className="node-ports">
        <div className="port-column input-ports">{inputs.map((port) => <Port key={`in:${port.id}`} port={port} side="in" />)}</div>
        <div className="port-column output-ports">{outputs.map((port) => <Port key={`out:${port.id}`} port={port} side="out" />)}</div>
      </div>}
      {caption && <div className="node-note">{caption}</div>}
    </div>
  </div>
}

function remapEventId(value: unknown, eventIds: Map<string, string>) {
  return typeof value === 'string' ? eventIds.get(value) ?? value : value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function withoutSelectedNodes(selection: BlueprintSelection, removed: Set<string>): BlueprintSelection {
  if (selection?.kind === 'node') return removed.has(selection.key) ? null : selection
  if (selection?.kind !== 'nodes') return selection
  const keys = selection.keys.filter((id) => !removed.has(id))
  return keys.length > 1 ? { kind: 'nodes', keys } : keys.length === 1 ? { kind: 'node', key: keys[0]! } : null
}

function Canvas({ blueprint, update, selectNode, selectNodes, editNodeTitle, catalog, locked }: {
  blueprint: Blueprint
  update: (value: Blueprint | ((current: Blueprint) => Blueprint)) => void
  selectNode: (id: string | null) => void
  selectNodes: (ids: string[]) => void
  editNodeTitle: (id: string) => void
  catalog: NodeTypeDefinition[]
  locked: boolean
}) {
  const { fitView, screenToFlowPosition } = useReactFlow<CanvasNode>()
  const shellRef = useRef<HTMLDivElement>(null)
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
  const definitions = useMemo(() => new Map(catalog.map((definition) => [definition.kind, definition])), [catalog])
  const nodes = useMemo(() => blueprint.nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      inputs: definitions.get(node.data.kind) ? configInputPorts(node, definitions.get(node.data.kind)!) : [],
      outputs: definitions.get(node.data.kind) ? configOutputPorts(node, definitions.get(node.data.kind)!, blueprint.values) : [],
      recordState: blueprint.recordState,
      editTitle: editNodeTitle,
    },
  })), [blueprint.nodes, blueprint.recordState, blueprint.values, definitions, editNodeTitle])
  const edges = useMemo(() => blueprint.edges.map((edge) => {
    const source = nodes.find((node) => node.id === edge.source)
    const target = nodes.find((node) => node.id === edge.target)
    const sourcePort = source?.data.outputs.find((port) => `out:${port.id}` === edge.sourceHandle)
    const targetPort = target?.data.inputs.find((port) => `in:${port.id}` === edge.targetHandle)
    const valueType = sourcePort?.valueType === 'value' ? targetPort?.valueType : sourcePort?.valueType
    const type = valueType ?? 'value'
    return { ...edge, style: { ...edge.style, stroke: pinTypeColor(type), strokeWidth: type === 'flow' ? 2 : 1.7 } }
  }), [blueprint.edges, nodes])
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
    const eventIds = new Map(clipboard.nodes.flatMap((node) => {
      const id = node.data.kind === 'event' ? node.data.config?.eventId : null
      return typeof id === 'string' ? [[id, `event-${crypto.randomUUID()}`] as const] : []
    }))
    const controlIds = new Map(clipboard.nodes.flatMap((node) => {
      const control = node.data.kind === 'register_control' ? node.data.config?.control : null
      return isRecord(control) && typeof control.id === 'string' ? [[control.id, `control-${crypto.randomUUID()}`] as const] : []
    }))
    const offset = 32 * ++pasteCountRef.current
    const pasted = structuredClone(clipboard.nodes).map((node) => {
      const config = node.data.config ?? {}
      if (node.data.kind === 'event') config.eventId = remapEventId(config.eventId, eventIds)
      if (node.data.kind === 'register_control' && isRecord(config.control)) {
        const control = config.control
        const oldId = typeof control.id === 'string' ? control.id : ''
        config.control = { ...control, id: controlIds.get(oldId) ?? oldId, eventId: remapEventId(control.eventId, eventIds) }
      }
      if (node.data.kind === 'register_menu') {
        if (typeof config.controlId === 'string') config.controlId = controlIds.get(config.controlId) ?? config.controlId
        config.eventId = remapEventId(config.eventId, eventIds)
      }
      if (node.data.kind === 'update_control') {
        if (typeof config.controlId === 'string') config.controlId = controlIds.get(config.controlId) ?? config.controlId
        if (isRecord(config.patch) && typeof config.patch.eventId === 'string') config.patch = { ...config.patch, eventId: remapEventId(config.patch.eventId, eventIds) }
      }
      if (node.data.kind === 'start_pipeline' && typeof config.outputNodeId === 'string') config.outputNodeId = nodeIds.get(config.outputNodeId) ?? config.outputNodeId
      return { ...node, id: nodeIds.get(node.id)!, position: { x: node.position.x + offset, y: node.position.y + offset }, selected: true, data: { ...node.data, config } }
    })
    const edges = structuredClone(clipboard.edges).map((edge) => ({ ...edge, id: `edge-${crypto.randomUUID()}`, source: nodeIds.get(edge.source)!, target: nodeIds.get(edge.target)! }))
    update((current) => ({ ...current, nodes: [...current.nodes.map((node) => ({ ...node, selected: false })), ...pasted], edges: [...current.edges, ...edges] }))
    selectNodes(pasted.map((node) => node.id))
    setContextMenu(null)
  }, [locked, selectNodes, update])
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
    if ((event.target as HTMLElement).closest('input, textarea, select, button')) return
    if (event.key === 'Escape') { setContextMenu(null); return }
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); void fitView({ padding: .2 }); return }
    if (event.key.toLowerCase() === 'c' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); copyNodes(); return }
    if (event.key.toLowerCase() === 'v' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); pasteNodes() }
  }
  const isValidConnection = useCallback((connection: Edge | Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target || !connection.sourceHandle || !connection.targetHandle) return false
    const source = nodes.find((node) => node.id === connection.source)
    const target = nodes.find((node) => node.id === connection.target)
    const sourcePort = source?.data.outputs.find((port) => `out:${port.id}` === connection.sourceHandle)
    const targetPort = target?.data.inputs.find((port) => `in:${port.id}` === connection.targetHandle)
    if (!sourcePort || !targetPort || (sourcePort.valueType !== targetPort.valueType && (sourcePort.valueType === 'flow' || targetPort.valueType === 'flow' || (sourcePort.valueType !== 'value' && targetPort.valueType !== 'value')))) return false
    return !blueprint.edges.some((edge) => edge.target === connection.target && edge.targetHandle === connection.targetHandle)
      && (sourcePort.valueType !== 'flow' || !blueprint.edges.some((edge) => edge.source === connection.source && edge.sourceHandle === connection.sourceHandle))
  }, [blueprint.edges, nodes])
  const addNode = (definition: NodeTypeDefinition, position?: { x: number; y: number }) => {
    const id = `node-${crypto.randomUUID()}`
    const config = structuredClone(definition.defaultConfig)
    if (definition.kind === 'event') config.eventId = `event-${crypto.randomUUID()}`
    update((current) => ({ ...current, nodes: [...current.nodes, {
      id, type: definition.kind, position: position ?? { x: 80 + current.nodes.length % 6 * 35, y: 80 + Math.floor(current.nodes.length / 6) * 55 },
      data: { kind: definition.kind, label: definition.label, config },
    }] }))
    selectNode(id)
  }

  return <div className="graph-shell" ref={shellRef} tabIndex={0} onKeyDownCapture={onGraphKeyDown} onPointerDownCapture={(event) => {
    if (event.button === 0 && event.target instanceof Element && event.target.closest('.react-flow')) shellRef.current?.focus({ preventScroll: true })
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
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onNodesDelete={onNodesDelete}
        onConnect={onConnect} isValidConnection={isValidConnection}
        onSelectionChange={onSelectionChange}
        onNodeClick={(_, node) => { selectNode(node.id); setContextMenu(null); shellRef.current?.focus({ preventScroll: true }) }}
        onPaneClick={() => { selectNode(null); setContextMenu(null); shellRef.current?.focus({ preventScroll: true }) }}
        nodesDraggable={!locked} nodesConnectable={!locked} panOnDrag={[2]} panOnScroll={false} zoomOnScroll selectionOnDrag={!locked} selectionMode={SelectionMode.Partial} fitView fitViewOptions={{ padding: .2 }} deleteKeyCode={locked ? null : ['Backspace', 'Delete']} minZoom={.3} maxZoom={1.6}
        proOptions={{ hideAttribution: true }} defaultEdgeOptions={{ style: { stroke: '#8492a9', strokeWidth: 1.6 } }}
      >
        <Background variant={BackgroundVariant.Lines} gap={24} size={1} color="#262c37" />
      </ReactFlow>
    </div>
    {contextMenu && createPortal(<div className={`graph-context-menu${contextMenu.nodeId ? '' : ' create-node-menu'}`} role="menu" aria-label={contextMenu.nodeId ? 'Node actions' : 'Create node'} style={{ left: Math.max(8, Math.min(window.innerWidth - (contextMenu.nodeId ? 184 : 236), contextMenu.x)), top: Math.max(8, Math.min(window.innerHeight - (contextMenu.nodeId ? 166 : Math.min(window.innerHeight * .65, 520) + 16), contextMenu.y)) }} onContextMenu={(event) => event.preventDefault()}>
      {contextMenu.nodeId ? <>
        <button role="menuitem" onClick={() => { copyNodes([contextMenu.nodeId!]); setContextMenu(null) }}><Copy size={13} />Copy <small>Ctrl+C</small></button>
        <button role="menuitem" disabled={locked} onClick={() => { copyNodes([contextMenu.nodeId!]); pasteNodes() }}><Copy size={13} />Duplicate</button>
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

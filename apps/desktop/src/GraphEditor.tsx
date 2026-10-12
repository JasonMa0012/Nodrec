import { useCallback, useMemo } from 'react'
import {
  addEdge, applyEdgeChanges, applyNodeChanges, Background, BackgroundVariant, Controls,
  Handle, MiniMap, Position, ReactFlow, ReactFlowProvider,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps,
} from '@xyflow/react'
import { AudioLines, CirclePlay, FileOutput, Monitor, MousePointer2, Pause, Play, Video } from 'lucide-react'
import { type Blueprint, type BlueprintNodeData } from './model'

type CanvasNodeData = BlueprintNodeData & {
  recordState: Blueprint['recordState']
  onRecordChange: (action: 'start' | 'pause' | 'stop') => void
}
type CanvasNode = Node<CanvasNodeData>

const colors: Record<string, string> = {
  flow: '#d68c8c', rect: '#52b6d3', video: '#a48ae2', audio: '#68c5a1', encoded: '#bd9b57', path: '#db9f4d', text: '#8ba0b5',
}

function Port({ id, name, side, color }: { id: string; name: string; side: 'in' | 'out'; color: string }) {
  return <div className={`port-row ${side}`}>
    {side === 'in' && <Handle id={`in:${id}`} type="target" position={Position.Left} style={{ background: color }} />}
    {side === 'in' && <span>{name}</span>}
    {side === 'out' && <span>{name}</span>}
    {side === 'out' && <Handle id={`out:${id}`} type="source" position={Position.Right} style={{ background: color }} />}
  </div>
}

function EventNode({ data, selected }: NodeProps<CanvasNode>) {
  return <div className={`flow-node event-node${selected ? ' selected' : ''}`}>
    <div className="node-title"><CirclePlay size={15} />{data.label}</div>
    <div className="node-body"><Port id="flow" name="Then" side="out" color={colors.flow} /></div>
  </div>
}

function RegionNode({ data, selected }: NodeProps<CanvasNode>) {
  return <div className={`flow-node region-node${selected ? ' selected' : ''}`}>
    <div className="node-title"><MousePointer2 size={15} />{data.label}</div>
    <div className="node-body">
      <button className="node-button nodrag" onClick={(event) => event.stopPropagation()}><MousePointer2 size={13} />Select Region</button>
      <Port id="rect" name="Display / Region" side="out" color={colors.rect} />
      <div className="node-note">Display 1 · (0, 0, 2560, 1440)</div>
    </div>
  </div>
}

function CaptureNode({ data, selected }: NodeProps<CanvasNode>) {
  const screen = data.kind === 'screen'
  const status = data.recordState
  return <div className={`flow-node capture-node${selected ? ' selected' : ''}`}>
    <div className="node-title">{screen ? <Monitor size={15} /> : <AudioLines size={15} />}{data.label}</div>
    <div className="node-body">
      <Port id="flow" name="Execute" side="in" color={colors.flow} />
      {screen && <Port id="rect" name="Region" side="in" color={colors.rect} />}
      <div className="node-action-row nodrag">
        <button className={status === 'recording' ? 'on' : ''} onClick={(event) => { event.stopPropagation(); data.onRecordChange('start') }}><Play size={11} />Start</button>
        <button className={status === 'paused' ? 'on' : ''} onClick={(event) => { event.stopPropagation(); data.onRecordChange('pause') }}><Pause size={11} />Pause</button>
        <button onClick={(event) => { event.stopPropagation(); data.onRecordChange('stop') }}>Stop</button>
      </div>
      <Port id={screen ? 'video' : 'audio'} name={screen ? 'Frames' : 'Audio'} side="out" color={colors[screen ? 'video' : 'audio']} />
      <div className="node-note">{status === 'recording' ? 'Recording' : status === 'paused' ? 'Paused' : 'Ready'}</div>
    </div>
  </div>
}

function ProcessNode({ data, selected }: NodeProps<CanvasNode>) {
  const isEncode = data.kind === 'encode'
  return <div className={`flow-node process-node${selected ? ' selected' : ''}`}>
    <div className="node-title">{isEncode ? <Video size={15} /> : <FileOutput size={15} />}{data.label}</div>
    <div className="node-body">
      {isEncode ? <>
        <Port id="video" name="Frames" side="in" color={colors.video} />
        <Port id="audio" name="Audio" side="in" color={colors.audio} />
        <Port id="encoded" name="Video" side="out" color={colors.encoded} />
      </> : <>
        <Port id="encoded" name="Video" side="in" color={colors.encoded} />
        <Port id="path" name="Path" side="in" color={colors.path} />
      </>}
      <div className="node-note">{isEncode ? 'Media output · UI example' : 'Output path · UI example'}</div>
    </div>
  </div>
}

function PathNode({ data, selected }: NodeProps<CanvasNode>) {
  return <div className={`flow-node process-node${selected ? ' selected' : ''}`}>
    <div className="node-title"><FileOutput size={15} />{data.label}</div>
    <div className="node-body"><Port id="path" name="Unique path" side="out" color={colors.path} /><div className="node-note">Text utility · UI example</div></div>
  </div>
}

const nodeTypes = { event: EventNode, region: RegionNode, screen: CaptureNode, audio: CaptureNode, encode: ProcessNode, write: ProcessNode, path: PathNode }
const portType = (handle: string | null | undefined) => handle?.split(':')[1]

function Canvas({ blueprint, update, selectNode }: { blueprint: Blueprint; update: (value: Blueprint | ((current: Blueprint) => Blueprint)) => void; selectNode: (id: string | null) => void }) {
  const setRecord = useCallback((action: 'start' | 'pause' | 'stop') => {
    update((current) => ({ ...current, recordState: action === 'start' ? 'recording' : action === 'pause' ? (current.recordState === 'recording' ? 'paused' : 'recording') : 'ready' }))
  }, [update])
  const nodes = useMemo(() => blueprint.nodes.map((node) => ({ ...node, data: { ...node.data, recordState: blueprint.recordState, onRecordChange: setRecord } })), [blueprint.nodes, blueprint.recordState, setRecord])
  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => update((current) => ({ ...current, nodes: applyNodeChanges(changes, current.nodes) as Blueprint['nodes'] })), [update])
  const onEdgesChange = useCallback((changes: EdgeChange[]) => update((current) => ({ ...current, edges: applyEdgeChanges(changes, current.edges) })), [update])
  const onNodesDelete = useCallback((deleted: CanvasNode[]) => update((current) => {
    const ids = new Set(deleted.map((node) => node.id))
    return { ...current, nodes: current.nodes.filter((node) => !ids.has(node.id)), edges: current.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)), selectedNode: null, selection: current.selection?.kind === 'node' && ids.has(current.selection.key) ? null : current.selection }
  }), [update])
  const onConnect = useCallback((connection: Connection) => update((current) => ({ ...current, edges: addEdge({ ...connection, type: 'smoothstep' }, current.edges) })), [update])
  const isValidConnection = useCallback((connection: Edge | Connection) => Boolean(connection.source && connection.target && connection.source !== connection.target && portType(connection.sourceHandle) && portType(connection.sourceHandle) === portType(connection.targetHandle) && !blueprint.edges.some((edge) => edge.target === connection.target && edge.targetHandle === connection.targetHandle) && !blueprint.edges.some((edge) => edge.source === connection.source && edge.sourceHandle === connection.sourceHandle && edge.target === connection.target && edge.targetHandle === connection.targetHandle)), [blueprint.edges])
  return <div className="graph-shell">
    <div className="graph-canvas">
      <span className="graph-counter">{blueprint.nodes.length} nodes <i /> {blueprint.edges.length} links</span>
      <ReactFlow
        nodes={nodes} edges={blueprint.edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onNodesDelete={onNodesDelete}
        onConnect={onConnect} isValidConnection={isValidConnection} onNodeClick={(_, node) => selectNode(node.id)} onPaneClick={() => selectNode(null)}
        fitView fitViewOptions={{ padding: .2 }} deleteKeyCode={['Backspace', 'Delete']} minZoom={.3} maxZoom={1.6}
        proOptions={{ hideAttribution: true }} defaultEdgeOptions={{ style: { stroke: '#8492a9', strokeWidth: 1.6 } }}
      >
        <Background variant={BackgroundVariant.Lines} gap={24} size={1} color="#262c37" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={(node) => node.type === 'event' ? '#65485b' : node.type === 'region' ? '#715734' : '#303b4c'} />
      </ReactFlow>
    </div>
  </div>
}

export default function GraphEditor(props: { blueprint: Blueprint; update: (value: Blueprint | ((current: Blueprint) => Blueprint)) => void; selectNode: (id: string | null) => void }) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>
}


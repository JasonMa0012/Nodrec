import { Fragment, useCallback, useState, type DragEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { Group, Panel, Separator } from 'react-resizable-panels'
import {
  AudioLines, ChevronDown, ChevronRight, CircleHelp, Clock3, Copy, Ellipsis, FileVideo2, Folder,
  FolderPlus, GripVertical, LayoutGrid, ListTree, Minus, Monitor, MousePointer2,
  Pin, Plus, Settings, Square, X, Workflow, Keyboard, Play, Pause, StopCircle,
} from 'lucide-react'
import GraphEditor from './GraphEditor'
import {
  allParameters, createBlueprint as makeBlueprint, exposeParameter, isPinned, moveParameterLayout, setPinned,
  type Blueprint, type BlueprintSelection, type EditorTab, type ParameterDefinition, type ParameterDropPlacement, type ParameterRow, type TreeItem,
} from './model'

type Page = 'workspace' | 'runs' | 'settings'
type NameDialog = { kind: 'new' | 'rename'; blueprintId?: string } | null

function isTauriWindow() { return '__TAURI_INTERNALS__' in window }
function withWindow(action: 'minimize' | 'toggleMaximize' | 'close') {
  if (!isTauriWindow()) return
  const appWindow = getCurrentWindow()
  void appWindow[action]().catch((error) => console.error(`Tauri window ${action} failed`, error))
}

function TitleBar({ blueprint, update, sidebarOpen, toggleSidebar, navigate }: { blueprint: Blueprint; update: BlueprintUpdate; sidebarOpen: boolean; toggleSidebar: () => void; navigate: (page: Page) => void }) {
  const dragWindow = () => { if (isTauriWindow()) void getCurrentWindow().startDragging().catch((error) => console.error('Tauri window dragging failed', error)) }
  const setRecordingState = (action: 'start' | 'pause' | 'stop') => update((current) => ({ ...current, recordState: action === 'start' ? 'recording' : action === 'stop' ? 'ready' : current.recordState === 'recording' ? 'paused' : 'recording' }))
  const active = blueprint.recordState === 'recording'
  return <header className="titlebar" data-tauri-drag-region onMouseDown={(event) => { if (event.button === 0 && !(event.target as HTMLElement).closest('button, summary, a, input, select')) dragWindow() }} onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest('button, summary, a, input, select')) withWindow('toggleMaximize') }}>
    <div className="titlebar-start">
      <details className="brand-menu">
        <summary className="brand-menu-trigger" aria-label="Open Nodrec menu"><span className="brand-mark"><span>N</span></span><span className="brand-name">NODREC</span><ChevronDown size={13} /></summary>
        <div className="brand-menu-popover">
          <button onClick={(event) => { navigate('workspace'); event.currentTarget.closest('details')?.removeAttribute('open') }}><Workflow size={14} />Workspace</button>
          <button onClick={(event) => { navigate('runs'); event.currentTarget.closest('details')?.removeAttribute('open') }}><Clock3 size={14} />Runs</button>
          <button onClick={(event) => { navigate('settings'); event.currentTarget.closest('details')?.removeAttribute('open') }}><Settings size={14} />Settings</button>
        </div>
      </details>
      <button className="icon-button sidebar-toggle" title={sidebarOpen ? 'Collapse blueprint list' : 'Expand blueprint list'} aria-label="Toggle blueprint list" onClick={toggleSidebar}><PanelGlyph collapsed={!sidebarOpen} /></button>
      <span className="titlebar-divider" />
      <div className="titlebar-recording-actions">
        <button className="button secondary" title="Select region" onClick={() => undefined}><MousePointer2 size={14} /><span>Select Region</span></button>
        <button className={`button primary${active ? ' recording' : ''}`} onClick={() => setRecordingState('start')}>{active ? <><span className="live-dot" /><span>Recording</span></> : <><Play size={14} fill="currentColor" /><span>Start recording</span></>}</button>
        <button className="button secondary" title={blueprint.recordState === 'paused' ? 'Resume recording' : 'Pause recording'} disabled={blueprint.recordState === 'ready'} onClick={() => setRecordingState('pause')}>{blueprint.recordState === 'paused' ? <Play size={13} /> : <Pause size={13} />}<span>{blueprint.recordState === 'paused' ? 'Resume' : 'Pause'}</span></button>
        <button className="button secondary" disabled={blueprint.recordState === 'ready'} onClick={() => setRecordingState('stop')}><StopCircle size={14} /><span>Stop</span></button>
      </div>
    </div>
    <div className="titlebar-drag-space" data-tauri-drag-region />
    <div className="window-controls">
      <button aria-label="Minimize" onClick={() => withWindow('minimize')}><Minus size={14} /></button>
      <button aria-label="Maximize" onClick={() => withWindow('toggleMaximize')}><Square size={12} /></button>
      <button className="close-window" aria-label="Close" onClick={() => withWindow('close')}><X size={15} /></button>
    </div>
  </header>
}

function PanelGlyph({ collapsed }: { collapsed: boolean }) {
  return collapsed ? <PanelOpenIcon /> : <PanelCloseIcon />
}
function PanelOpenIcon() { return <span className="panel-glyph"><span /></span> }
function PanelCloseIcon() { return <span className="panel-glyph open"><span /></span> }

function ParameterControl({ definition, value, onChange, compact = false }: { definition: ParameterDefinition; value: string | boolean; onChange: (value: string | boolean) => void; compact?: boolean }) {
  if (definition.kind === 'boolean') return <label className={`field-control checkbox-control${compact ? ' compact' : ''}`}><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-track"><i /></span></label>
  if (definition.kind === 'choice') return <select className="field-control" value={String(value)} onChange={(event) => onChange(event.target.value)}>{definition.options?.map((option) => <option key={option}>{option}</option>)}</select>
  if (definition.kind === 'readonly') return <div className="readonly-value" title={String(value)}>{String(value)}</div>
  return <input className="field-control" value={String(value)} onChange={(event) => onChange(event.target.value)} />
}

type BlueprintUpdate = (value: Blueprint | ((current: Blueprint) => Blueprint)) => void

function parameterRowTemplate(row: ParameterRow) {
  return row.columns.map((column) => `${Math.max(1, column.weight * 100)}fr`).join(' ')
}

function ParameterCard({ definition, value, pinned, onChange, selected = false, onSelect, onPin, dragProps, preview = false }: { definition: ParameterDefinition; value: string | boolean; pinned: boolean; onChange: (value: string | boolean) => void; selected?: boolean; onSelect?: () => void; onPin?: () => void; dragProps?: Record<string, unknown>; preview?: boolean }) {
  return <div className={`layout-parameter${selected ? ' selected' : ''}${preview ? ' drag-preview' : ''}`} data-parameter-id={definition.id} onClick={onSelect}>
    <div className="layout-field-heading">
      {dragProps ? <button type="button" className="parameter-drag-handle" aria-label={`Drag ${definition.label}`} {...dragProps}><GripVertical size={13} /></button> : <GripVertical size={13} />}
      <span>{definition.label}</span>
      <button type="button" className={`icon-button pin-button${pinned ? ' pinned' : ''}`} aria-label={pinned ? 'Unpin parameter' : 'Pin parameter'} onClick={(event) => { event.stopPropagation(); onPin?.() }}><Pin size={14} /></button>
    </div>
    <ParameterControl definition={definition} value={value} onChange={onChange} compact />
  </div>
}

function ParameterDropEdge({ parameterId, placement, disabled }: { parameterId: string; placement: Exclude<ParameterDropPlacement, 'end'>; disabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `field:${parameterId}:${placement}`,
    data: { kind: 'field-placement', parameterId, placement },
    disabled,
  })
  return <div ref={setNodeRef} className={`layout-drop-edge ${placement}${isOver ? ' is-over' : ''}`} aria-hidden="true" />
}

function ParameterZoneEnd({ pinned, dragging }: { pinned: boolean; dragging: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `zone-end:${pinned}`, data: { kind: 'zone-end', pinned } })
  return <div ref={setNodeRef} className={`layout-zone-end${dragging ? ' enabled' : ''}${isOver ? ' is-over' : ''}`} aria-hidden="true">{dragging ? 'Drop to add a row' : null}</div>
}

function DraggableParameterCard({ blueprint, cardId, definition, update, activeId }: { blueprint: Blueprint; cardId: string; definition: ParameterDefinition; update: BlueprintUpdate; activeId: string | null }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `parameter:${definition.id}`, data: { parameterId: definition.id } })
  const pinned = isPinned(blueprint, cardId, definition.id)
  const select = () => update((current) => ({ ...current, selectedParameter: definition.id, selection: { kind: 'parameter', key: definition.id } }))
  const pin = () => update((current) => setPinned(current, cardId, definition.id, !isPinned(current, cardId, definition.id)))
  return <div ref={setNodeRef} className={`layout-parameter-wrap${isDragging ? ' drag-source' : ''}`}>
    <ParameterCard
      definition={definition}
      value={blueprint.values[definition.id] ?? definition.initial}
      pinned={pinned}
      onChange={(value) => update((current) => ({ ...current, values: { ...current.values, [definition.id]: value } }))}
      selected={blueprint.selectedParameter === definition.id}
      onSelect={select}
      onPin={pin}
      dragProps={{ ...attributes, ...listeners }}
    />
    {(['above', 'below', 'left', 'right'] as const).map((placement) => <ParameterDropEdge key={placement} parameterId={definition.id} placement={placement} disabled={activeId === definition.id} />)}
  </div>
}

function ResizableParameterRow({ row, blueprint, cardId, update, activeId }: { row: ParameterRow; blueprint: Blueprint; cardId: string; update: BlueprintUpdate; activeId: string | null }) {
  const rowId = row.columns.map((column) => column.id).join(':')
  const defaultLayout = Object.fromEntries(row.columns.map(({ id, weight }) => [id, weight * 100]))
  const definitions = allParameters(blueprint)
  return <Group
    key={rowId}
    id={`parameter-row:${cardId}:${rowId}`}
    className="layout-parameter-row"
    orientation="horizontal"
    defaultLayout={defaultLayout}
    style={{ height: 'auto', overflow: 'visible' }}
    resizeTargetMinimumSize={{ fine: 8, coarse: 12 }}
    onLayoutChanged={(sizes, meta) => {
      if (!meta.isUserInteraction) return
      const total = Object.values(sizes).reduce((sum, size) => sum + size, 0) || 1
      const weights = Object.fromEntries(Object.entries(sizes).map(([id, size]) => [id, size / total]))
      update((current) => {
        const rows = current.layouts[cardId] ?? []
        const next = rows.map((candidate) => candidate.columns.map((column) => column.id).join(':') === rowId
          ? { ...candidate, columns: candidate.columns.map((column) => ({ ...column, weight: weights[column.id] ?? column.weight })) }
          : candidate)
        return { ...current, layouts: { ...current.layouts, [cardId]: next } }
      })
    }}
  >
    {row.columns.map((column, index) => {
      const definition = definitions.find((item) => item.id === column.id)
      return <Fragment key={column.id}>
        <Panel id={column.id} minSize={8} className="layout-parameter-panel">
          {definition && <DraggableParameterCard blueprint={blueprint} cardId={cardId} definition={definition} update={update} activeId={activeId} />}
        </Panel>
        {index < row.columns.length - 1 && <Separator className="parameter-resize-separator" aria-label="Resize parameter columns" />}
      </Fragment>
    })}
  </Group>
}

function ParameterDropZone({ pinned, rows, blueprint, cardId, update, activeId }: { pinned: boolean; rows: ParameterRow[]; blueprint: Blueprint; cardId: string; update: BlueprintUpdate; activeId: string | null }) {
  const zoneRows = rows.filter((row) => row.pinned === pinned)
  return <section className={`layout-zone${activeId ? ' dragging' : ''}`}>
    <div className="layout-zone-title"><Pin size={13} className={pinned ? 'pin-active' : ''} /><span>{pinned ? 'Pinned · visible in Overview' : 'Details only'}</span><i /></div>
    {zoneRows.map((row) => <ResizableParameterRow key={row.columns.map((column) => column.id).join(':')} row={row} blueprint={blueprint} cardId={cardId} update={update} activeId={activeId} />)}
    {zoneRows.length === 0 && <div className="layout-zone-empty">{activeId ? 'Drop here to create a row' : 'No parameters'}</div>}
    <ParameterZoneEnd pinned={pinned} dragging={activeId !== null} />
  </section>
}

function ParameterField({ blueprint, definition, update, compact = false }: { blueprint: Blueprint; definition: ParameterDefinition; update: (value: Blueprint | ((current: Blueprint) => Blueprint)) => void; compact?: boolean }) {
  return <label className={`parameter-field${compact ? ' compact' : ''}`}>
    <span className="parameter-label">{definition.label}</span>
    <ParameterControl definition={definition} value={blueprint.values[definition.id] ?? definition.initial} onChange={(value) => update((current) => ({ ...current, values: { ...current.values, [definition.id]: value } }))} compact={compact} />
  </label>
}

function cardRows(blueprint: Blueprint, cardId: string, pinned?: boolean) {
  return (blueprint.layouts[cardId] ?? []).filter((row) => pinned === undefined || row.pinned === pinned)
}

function OverviewCard({ blueprint, cardId, update, openLayout }: { blueprint: Blueprint; cardId: string; update: (value: Blueprint | ((current: Blueprint) => Blueprint)) => void; openLayout: (cardId: string) => void }) {
  const card = blueprint.cards.find((item) => item.id === cardId)
  if (!card) return null
  const rows = cardRows(blueprint, cardId, true)
  const definitions = allParameters(blueprint)
  return <section className="settings-card">
    <div className="settings-card-head">
      <div className="card-heading"><span className="card-symbol">{cardId === 'audio' ? <AudioLines size={17} /> : cardId === 'video' ? <FileVideo2 size={17} /> : cardId === 'input' ? <Keyboard size={17} /> : cardId === 'recording' ? <Monitor size={17} /> : <Folder size={17} />}</span><h2>{card.name}</h2></div>
      <button className="icon-button" title="Card details" aria-label={`${card.name} details`} onClick={() => update((current) => ({ ...current, detailCard: cardId }))}><Ellipsis size={17} /></button>
    </div>
    <div className="settings-card-body">
      {rows.length === 0 ? <div className="empty-card">No pinned parameters yet. Open details to show all.</div> : rows.map((row, index) => <div className="preview-row" key={`${cardId}-row-${index}`} style={{ gridTemplateColumns: parameterRowTemplate(row) }}>
        {row.columns.map((column) => {
          const definition = definitions.find((item) => item.id === column.id)
          return definition ? <ParameterField key={column.id} blueprint={blueprint} definition={definition} update={update} compact /> : null
        })}
      </div>)}
    </div>
    <button className="card-layout-shortcut" onClick={() => openLayout(cardId)}><LayoutGrid size={13} />Edit layout</button>
  </section>
}

function CardDetails({ blueprint, update, close, editLayout }: { blueprint: Blueprint; update: (value: Blueprint | ((current: Blueprint) => Blueprint)) => void; close: () => void; editLayout: (id: string) => void }) {
  const cardId = blueprint.detailCard
  const card = blueprint.cards.find((item) => item.id === cardId)
  if (!card) return null
  const definitions = allParameters(blueprint)
  return <div className="detail-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) close() }}>
    <aside className="card-details-panel" aria-label={`${card.name} details`}>
      <header className="panel-heading"><div><span className="eyebrow">CARD DETAILS</span><h2>{card.name}</h2></div><div className="panel-actions"><button className="icon-button" title="Edit layout" aria-label="Edit layout" onClick={() => editLayout(card.id)}><LayoutGrid size={16} /></button><button className="icon-button" title="Close" aria-label="Close details" onClick={close}><X size={17} /></button></div></header>
      <div className="card-details-scroll">
        {[true, false].map((pinned) => <section className="detail-parameter-group" key={String(pinned)}>
          <div className="detail-group-title">{pinned ? 'Pinned on overview' : 'Details only'}<span>{cardRows(blueprint, card.id, pinned).reduce((sum, row) => sum + row.columns.length, 0)}</span></div>
          {cardRows(blueprint, card.id, pinned).map((row, rowIndex) => <div className="detail-layout-row" key={`${pinned ? 'p' : 'd'}-${rowIndex}`} style={{ gridTemplateColumns: parameterRowTemplate(row) }}>
            {row.columns.map((column) => {
              const definition = definitions.find((item) => item.id === column.id)
              return definition ? <div className="detail-parameter" key={column.id}>
                <ParameterField blueprint={blueprint} definition={definition} update={update} />
                <button className={`icon-button pin-button${pinned ? ' pinned' : ''}`} title={pinned ? 'Unpin from overview' : 'Pin to overview'} aria-label={pinned ? `Unpin ${definition.label}` : `Pin ${definition.label}`} onClick={() => update((current) => setPinned(current, card.id, definition.id, !pinned))}><Pin size={15} /></button>
              </div> : null
            })}
          </div>)}
        </section>)}
      </div>
    </aside>
  </div>
}

function CardLayoutEditor({ blueprint, cardId, update }: { blueprint: Blueprint; cardId: string; update: (value: Blueprint | ((current: Blueprint) => Blueprint)) => void }) {
  const card = blueprint.cards.find((item) => item.id === cardId)
  const definitions = allParameters(blueprint)
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )
  if (!card) return <div className="empty-state">This card is no longer available.</div>
  const handleDragStart = (event: DragStartEvent) => setActiveId(typeof event.active.data.current?.parameterId === 'string' ? event.active.data.current.parameterId : null)
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const sourceId = active.data.current?.parameterId
    const target = over?.data.current as { kind?: string; parameterId?: string; placement?: ParameterDropPlacement; pinned?: boolean } | undefined
    setActiveId(null)
    if (typeof sourceId !== 'string' || !target) return
    if (target.kind === 'field-placement' && target.parameterId && target.placement) {
      update((current) => ({ ...current, layouts: { ...current.layouts, [cardId]: moveParameterLayout(current.layouts[cardId] ?? [], sourceId, target.parameterId!, target.placement!) } }))
    } else if (target.kind === 'zone-end') {
      update((current) => ({ ...current, layouts: { ...current.layouts, [cardId]: moveParameterLayout(current.layouts[cardId] ?? [], sourceId, null, 'end', target.pinned ?? false) } }))
    }
  }
  const activeDefinition = definitions.find((item) => item.id === activeId)
  return <div className="card-layout-editor">
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragCancel={() => setActiveId(null)} onDragEnd={handleDragEnd}>
      <div className="layout-canvas">
        <div className="layout-editor-heading"><div><span className="eyebrow">CARD LAYOUT</span><h2>{card.name}</h2></div><span className="layout-tip"><GripVertical size={14} />Drag fields to arrange</span></div>
        <div className="layout-zones">
          <ParameterDropZone pinned rows={blueprint.layouts[cardId] ?? []} blueprint={blueprint} cardId={cardId} update={update} activeId={activeId} />
          <ParameterDropZone pinned={false} rows={blueprint.layouts[cardId] ?? []} blueprint={blueprint} cardId={cardId} update={update} activeId={activeId} />
        </div>
      </div>
      <DetailsPanel blueprint={blueprint} update={update} />
      {createPortal(<DragOverlay className="parameter-drag-overlay" dropAnimation={null}>{activeDefinition && <ParameterCard definition={activeDefinition} value={blueprint.values[activeDefinition.id] ?? activeDefinition.initial} pinned={isPinned(blueprint, cardId, activeDefinition.id)} onChange={() => {}} preview />}</DragOverlay>, document.body)}
    </DndContext>
  </div>
}

function SectionTitle({ title, addMenu }: { title: string; addMenu?: ReactNode }) {
  return <div className="library-section-title"><span>{title}</span>{addMenu}</div>
}

function PlusMenu({ label, children }: { label: string; children: ReactNode }) {
  return <details className="plus-menu"><summary title={`Add to ${label}`} aria-label={`Add to ${label}`}><Plus size={14} /></summary><div className="plus-popover" onClick={(event) => { if ((event.target as HTMLElement).closest('button')) event.currentTarget.closest('details')?.removeAttribute('open') }}>{children}</div></details>
}

function FolderLine({ name, open, selected, onToggle, onSelect, onDoubleClick, children, onDrop }: { name: string; open: boolean; selected: boolean; onToggle: () => void; onSelect: () => void; onDoubleClick?: () => void; children?: ReactNode; onDrop?: (event: DragEvent<HTMLDivElement>) => void }) {
  return <div className="library-folder" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
    <div className={`folder-row${selected ? ' active' : ''}`}>
      <button className="folder-arrow" aria-label={open ? 'Collapse folder' : 'Expand folder'} onClick={onToggle}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
      <button className="folder-name" onClick={onSelect} onDoubleClick={onDoubleClick}><Folder size={14} />{name}</button>
    </div>
    {open && <div className="folder-children">{children}</div>}
  </div>
}

function LibraryEditor({ blueprint, update, openCard }: { blueprint: Blueprint; update: (value: Blueprint | ((current: Blueprint) => Blueprint)) => void; openCard: (id: string) => void }) {
  const definitions = allParameters(blueprint)
  const exposedParameters = new Set(blueprint.cards.flatMap((card) => card.parameters))
  const setSelection = (selection: BlueprintSelection) => update((current) => ({ ...current, selection, selectedParameter: selection?.kind === 'parameter' ? selection.key : null, selectedNode: null }))
  const toggleFolder = (folderId: string) => update((current) => ({ ...current, openFolders: { ...current.openFolders, [folderId]: !(current.openFolders[folderId] ?? true) } }))
  const createFolder = (kind: 'events' | 'functions' | 'variables' | 'parameters') => update((current) => {
    const id = `${kind}-folder-${crypto.randomUUID().slice(0, 6)}`
    if (kind === 'parameters') {
      const card = { id, name: 'New card', parameters: [] }
      return { ...current, cards: [...current.cards, card], layouts: { ...current.layouts, [id]: [] }, openFolders: { ...current.openFolders, [id]: true }, selection: { kind: 'card', key: id } }
    }
    const key = kind === 'events' ? 'eventFolders' : kind === 'functions' ? 'functionFolders' : 'variableFolders'
    const folders = current[key]
    return { ...current, [key]: [...folders, { id, name: 'New folder' }], openFolders: { ...current.openFolders, [id]: true }, selection: { kind: 'folder', key: id } }
  })
  const createTreeItem = (kind: 'events' | 'functions') => update((current) => {
    const id = `${kind}-${crypto.randomUUID().slice(0, 6)}`
    const folders = kind === 'events' ? current.eventFolders : current.functionFolders
    const items = kind === 'events' ? current.events : current.functions
    const folderId = folders[0]?.id ?? ''
    const item: TreeItem = { id, name: kind === 'events' ? 'New Event' : 'New Function', folderId }
    return { ...current, [kind]: [...items, item], selection: { kind: kind === 'events' ? 'event' : 'function', key: id } }
  })
  const createVariable = () => update((current) => {
    const id = `variable-${crypto.randomUUID().slice(0, 6)}`
    const definition: ParameterDefinition = { id, label: 'New variable', kind: 'text', initial: '' }
    const customFolder = current.variableFolders.find((folder) => folder.id === 'custom')
    return { ...current, customParameters: [...current.customParameters, definition], values: { ...current.values, [id]: '' }, variableFolders: customFolder ? current.variableFolders : [...current.variableFolders, { id: 'custom', name: 'Custom' }], selection: { kind: 'parameter', key: id } }
  })
  const folderForVariable = (id: string) => id.startsWith('variable-') ? 'custom' : id === 'display' || id === 'region' || id === 'cursor' || id === 'delay' ? 'capture' : ['resolution', 'fps', 'encoder', 'bitrate'].includes(id) ? 'video' : ['systemAudio', 'microphone', 'device', 'sampleRate'].includes(id) ? 'audio' : ['output', 'filename'].includes(id) ? 'output' : 'input'

  const sectionPlus = (title: string, kind: 'events' | 'functions' | 'variables' | 'parameters') => <PlusMenu label={title}>
    <button onClick={() => createFolder(kind)}><FolderPlus size={14} />Folder</button>
    {kind === 'events' && <button onClick={() => createTreeItem('events')}>Event</button>}
    {kind === 'functions' && <button onClick={() => createTreeItem('functions')}>Function</button>}
    {kind === 'variables' && <button onClick={createVariable}>Variable</button>}
    {kind === 'parameters' && <div className="menu-nested-label">Add variable to card</div>}
    {kind === 'parameters' && blueprint.cards.map((card) => <details className="menu-submenu" key={card.id}><summary>{card.name}<ChevronRight size={13} /></summary><div>{definitions.filter((definition) => !card.parameters.includes(definition.id)).map((definition) => <button key={definition.id} onClick={() => update((current) => exposeParameter(current, card.id, definition.id))}>{definition.label}</button>)}</div></details>)}
  </PlusMenu>

  return <aside className="blueprint-library">
    <div className="library-scroll">
      <section className="library-section"><SectionTitle title="Events" addMenu={sectionPlus('Events', 'events')}>
      </SectionTitle>
        {blueprint.eventFolders.map((folder) => <FolderLine key={folder.id} name={folder.name} open={blueprint.openFolders[folder.id] ?? true} selected={blueprint.selection?.kind === 'folder' && blueprint.selection.key === folder.id} onToggle={() => toggleFolder(folder.id)} onSelect={() => setSelection({ kind: 'folder', key: folder.id })}>
          {blueprint.events.filter((event) => event.folderId === folder.id).map((event) => <button className={`tree-item${blueprint.selection?.key === event.id ? ' selected' : ''}`} key={event.id} onClick={() => setSelection({ kind: 'event', key: event.id })}><CircleHelp size={13} />{event.name}</button>)}
        </FolderLine>)}
      </section>
      <section className="library-section"><SectionTitle title="Functions" addMenu={sectionPlus('Functions', 'functions')} />
        {blueprint.functionFolders.map((folder) => <FolderLine key={folder.id} name={folder.name} open={blueprint.openFolders[folder.id] ?? true} selected={blueprint.selection?.kind === 'folder' && blueprint.selection.key === folder.id} onToggle={() => toggleFolder(folder.id)} onSelect={() => setSelection({ kind: 'folder', key: folder.id })}>
          {blueprint.functions.filter((item) => item.folderId === folder.id).map((item) => <button className={`tree-item${blueprint.selection?.key === item.id ? ' selected' : ''}`} key={item.id} onClick={() => setSelection({ kind: 'function', key: item.id })}><Workflow size={13} />{item.name}</button>)}
        </FolderLine>)}
      </section>
      <section className="library-section"><SectionTitle title="Parameters" addMenu={sectionPlus('Parameters', 'parameters')} />
        {blueprint.cards.map((card) => <FolderLine key={card.id} name={card.name} open={blueprint.openFolders[card.id] ?? true} selected={blueprint.selection?.kind === 'card' && blueprint.selection.key === card.id} onToggle={() => toggleFolder(card.id)} onSelect={() => setSelection({ kind: 'card', key: card.id })} onDoubleClick={() => openCard(card.id)} onDrop={(event) => {
          const id = event.dataTransfer.getData('application/x-nodrec-variable')
          if (id) { event.preventDefault(); update((current) => exposeParameter(current, card.id, id)) }
        }}>
          {card.parameters.map((id) => { const definition = definitions.find((item) => item.id === id); if (!definition) return null; const pinned = isPinned(blueprint, card.id, id)
            return <div className="library-parameter" key={id} draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-nodrec-parameter', id); event.dataTransfer.effectAllowed = 'move' }}>
              <button className={`tree-item${blueprint.selectedParameter === id ? ' selected' : ''}`} onClick={() => setSelection({ kind: 'parameter', key: id })}><span className="parameter-status">{pinned ? <Pin size={12} /> : <span />}</span>{definition.label}</button>
              <button className={`tiny-pin${pinned ? ' active' : ''}`} title={pinned ? 'Unpin from overview' : 'Pin to overview'} onClick={() => update((current) => setPinned(current, card.id, id, !pinned))}><Pin size={12} /></button>
            </div>
          })}
        </FolderLine>)}
      </section>
      <section className="library-section"><SectionTitle title="Variables" addMenu={sectionPlus('Variables', 'variables')} />
        {blueprint.variableFolders.map((folder) => {
          const inFolder = definitions.filter((definition) => !exposedParameters.has(definition.id) && (folder.id.startsWith('variables-') ? false : folderForVariable(definition.id) === folder.id || (folder.id === 'input' && ['pointer', 'keyboard', 'mouse', 'threshold'].includes(definition.id))))
          return <FolderLine key={folder.id} name={folder.name} open={blueprint.openFolders[folder.id] ?? true} selected={blueprint.selection?.kind === 'folder' && blueprint.selection.key === folder.id} onToggle={() => toggleFolder(folder.id)} onSelect={() => setSelection({ kind: 'folder', key: folder.id })}>
            {inFolder.map((definition) => <button className={`tree-item variable-item${blueprint.selection?.key === definition.id ? ' selected' : ''}`} key={definition.id} draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-nodrec-variable', definition.id); event.dataTransfer.effectAllowed = 'copy' }} onClick={() => setSelection({ kind: 'parameter', key: definition.id })}><span className="variable-token">v</span>{definition.label}</button>)}
          </FolderLine>
        })}
      </section>
    </div>
  </aside>
}

function DetailsPanel({ blueprint, update, compact = false }: { blueprint: Blueprint; update: (value: Blueprint | ((current: Blueprint) => Blueprint)) => void; compact?: boolean }) {
  const selection = blueprint.selection
  const selectedNode = selection?.kind === 'node' ? blueprint.nodes.find((node) => node.id === selection.key) : null
  const selectedParameter = selection?.kind === 'parameter' ? allParameters(blueprint).find((item) => item.id === selection.key) : null
  const selectedCard = selection?.kind === 'card' ? blueprint.cards.find((item) => item.id === selection.key) : null
  const selectedEvent = selection?.kind === 'event' ? blueprint.events.find((item) => item.id === selection.key) : null
  const selectedFunction = selection?.kind === 'function' ? blueprint.functions.find((item) => item.id === selection.key) : null
  const title = selectedParameter?.label ?? selectedNode?.data.label ?? selectedCard?.name ?? selectedEvent?.name ?? selectedFunction?.name ?? 'Details'
  const updateName = (name: string) => update((current) => {
    if (!selection) return current
    if (selection.kind === 'card') return { ...current, cards: current.cards.map((card) => card.id === selection.key ? { ...card, name } : card) }
    if (selection.kind === 'event') return { ...current, events: current.events.map((item) => item.id === selection.key ? { ...item, name } : item) }
    if (selection.kind === 'function') return { ...current, functions: current.functions.map((item) => item.id === selection.key ? { ...item, name } : item) }
    if (selection.kind === 'folder') return { ...current, eventFolders: current.eventFolders.map((item) => item.id === selection.key ? { ...item, name } : item), functionFolders: current.functionFolders.map((item) => item.id === selection.key ? { ...item, name } : item), variableFolders: current.variableFolders.map((item) => item.id === selection.key ? { ...item, name } : item), cards: current.cards.map((item) => item.id === selection.key ? { ...item, name } : item) }
    if (selection.kind === 'parameter') return { ...current, labels: { ...current.labels, [selection.key]: name }, customParameters: current.customParameters.map((item) => item.id === selection.key ? { ...item, label: name } : item) }
    if (selection.kind === 'node') return { ...current, nodes: current.nodes.map((node) => node.id === selection.key ? { ...node, data: { ...node.data, label: name } } : node) }
    return current
  })
  return <aside className={`details-panel${compact ? ' details-compact' : ''}`}>
    <div className="details-title"><div><span className="eyebrow">DETAILS</span><h2>{title}</h2></div><Ellipsis size={16} /></div>
    {!selection ? <div className="details-empty">Select a node, variable, event, function or card to edit its details.</div> : selectedNode ? <div className="details-form">
      <label className="parameter-field"><span className="parameter-label">Node title</span><input className="field-control" value={selectedNode.data.label} onChange={(event) => updateName(event.target.value)} /></label>
      <div className="detail-block"><span className="detail-label">Node type</span><div className="detail-value">{selectedNode.data.kind}</div></div>
      <div className="detail-block"><span className="detail-label">Description</span><div className="detail-value">{selectedNode.data.note || 'UI example node · no workflow execution'}</div></div>
      <div className="detail-block"><span className="detail-label">Position</span><div className="detail-value">{Math.round(selectedNode.position.x)}, {Math.round(selectedNode.position.y)}</div></div>
      <div className="detail-note">The editor stores graph changes locally for this session.</div>
    </div> : selectedParameter ? <div className="details-form">
      <label className="parameter-field"><span className="parameter-label">Variable name</span><input className="field-control" value={selectedParameter.label} onChange={(event) => updateName(event.target.value)} /></label>
      <div className="detail-block"><span className="detail-label">Variable ID</span><div className="detail-value mono">{selectedParameter.id}</div></div>
      <div className="detail-block"><span className="detail-label">Type</span><div className="detail-value">{selectedParameter.kind}</div></div>
      <div className="detail-block"><span className="detail-label">Current value</span><ParameterControl definition={selectedParameter} value={blueprint.values[selectedParameter.id] ?? selectedParameter.initial} onChange={(value) => update((current) => ({ ...current, values: { ...current.values, [selectedParameter.id]: value } }))} /></div>
      {selectedParameter.kind === 'choice' && <div className="detail-note">Choices are part of this example blueprint.</div>}
    </div> : selectedCard ? <div className="details-form">
      <label className="parameter-field"><span className="parameter-label">Card name</span><input className="field-control" value={selectedCard.name} onChange={(event) => updateName(event.target.value)} /></label>
      <div className="detail-block"><span className="detail-label">Parameters</span><div className="detail-value">{selectedCard.parameters.length} exposed</div></div>
      <div className="detail-note">Double-click the folder to open its card layout.</div>
    </div> : selectedEvent || selectedFunction ? <div className="details-form">
      <label className="parameter-field"><span className="parameter-label">Name</span><input className="field-control" value={(selectedEvent ?? selectedFunction)!.name} onChange={(event) => updateName(event.target.value)} /></label>
      <div className="detail-note">Metadata example only; this event or function does not execute yet.</div>
    </div> : <div className="details-form"><label className="parameter-field"><span className="parameter-label">Folder name</span><input className="field-control" value={[...blueprint.eventFolders, ...blueprint.functionFolders, ...blueprint.variableFolders].find((item) => item.id === selection?.key)?.name ?? blueprint.cards.find((item) => item.id === selection?.key)?.name ?? ''} onChange={(event) => updateName(event.target.value)} /></label></div>}
  </aside>
}

function CardDetailsPreview({ blueprint, update }: { blueprint: Blueprint; update: (value: Blueprint | ((current: Blueprint) => Blueprint)) => void }) {
  const card = blueprint.cards.find((item) => item.id === blueprint.detailCard)
  return card ? <CardDetails blueprint={blueprint} update={update} close={() => update((current) => ({ ...current, detailCard: null }))} editLayout={(id) => {
    update((current) => {
      const tabId = `card:${id}`
      const existing = current.tabs.find((tab) => tab.id === tabId)
      return { ...current, detailCard: null, tabs: existing ? current.tabs : [...current.tabs, { id: tabId, kind: 'card', cardId: id }], activeTab: tabId }
    })
  }} /> : null
}

function BlueprintContent({ blueprint, update, openCard }: { blueprint: Blueprint; update: (value: Blueprint | ((current: Blueprint) => Blueprint)) => void; openCard: (id: string) => void }) {
  const editorTab = blueprint.tabs.find((tab) => tab.id === blueprint.activeTab) ?? blueprint.tabs[0]
  if (editorTab.kind === 'card' && editorTab.cardId) return <CardLayoutEditor key={`${blueprint.id}:${editorTab.cardId}`} blueprint={blueprint} cardId={editorTab.cardId} update={update} />
  if (editorTab.kind === 'blueprint') return <div className="blueprint-workbench">
    <LibraryEditor blueprint={blueprint} update={update} openCard={openCard} />
    <GraphEditor blueprint={blueprint} update={update} selectNode={(id) => update((current) => ({ ...current, selectedNode: id, selection: id ? { kind: 'node', key: id } : null }))} />
    <DetailsPanel blueprint={blueprint} update={update} />
  </div>
  return <main className="overview-page">
    <div className="settings-grid">{blueprint.cards.map((card) => <OverviewCard key={card.id} blueprint={blueprint} cardId={card.id} update={update} openLayout={openCard} />)}</div>
  </main>
}

function EmptyPage({ page }: { page: 'runs' | 'settings' }) {
  const settings = page === 'settings'
  return <main className="empty-page"><div className="empty-icon">{settings ? <Settings size={24} /> : <Clock3 size={24} />}</div><span className="eyebrow">NODREC</span><h1>{settings ? 'Settings' : 'Runs'}</h1><p>{settings ? 'Application preferences will live here.' : 'Recording sessions and replay results will appear here.'}</p><span className="coming-soon">UI preview</span></main>
}

function BlueprintDialog({ dialog, initialName, onClose, onSave }: { dialog: NameDialog; initialName: string; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(initialName)
  if (!dialog) return null
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><form className="name-dialog" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSave(name.trim()) }}>
    <span className="eyebrow">BLUEPRINT</span><h2>{dialog.kind === 'new' ? 'Create blueprint' : 'Rename blueprint'}</h2><label className="parameter-field"><span className="parameter-label">Name</span><input autoFocus className="field-control" value={name} onChange={(event) => setName(event.target.value)} /></label><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" type="submit">{dialog.kind === 'new' ? 'Create' : 'Save'}</button></div>
  </form></div>
}

export default function App() {
  const [blueprints, setBlueprints] = useState<Blueprint[]>(() => [makeBlueprint('screen', 'Screen recording'), makeBlueprint('replay', 'Record & replay', true)])
  const [activeBlueprintId, setActiveBlueprintId] = useState('screen')
  const [page, setPage] = useState<Page>('workspace')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [dialog, setDialog] = useState<NameDialog>(null)
  const [menuBlueprint, setMenuBlueprint] = useState<string | null>(null)
  const [undoBlueprint, setUndoBlueprint] = useState<Blueprint | null>(null)
  const activeBlueprint = blueprints.find((blueprint) => blueprint.id === activeBlueprintId) ?? blueprints[0]
  const updateBlueprint = useCallback((value: Blueprint | ((current: Blueprint) => Blueprint)) => setBlueprints((current) => current.map((blueprint) => blueprint.id === activeBlueprintId ? (typeof value === 'function' ? value(blueprint) : value) : blueprint)), [activeBlueprintId])

  const openTab = (kind: EditorTab['kind'], cardId?: string) => {
    updateBlueprint((current) => {
      const id = kind === 'card' ? `card:${cardId}` : kind
      const existing = current.tabs.find((tab) => tab.id === id)
      return { ...current, tabs: existing ? current.tabs : [...current.tabs, { id, kind, cardId }], activeTab: id }
    })
    setPage('workspace')
  }
  const selectTab = (tabId: string) => updateBlueprint((current) => ({ ...current, activeTab: tabId }))
  const closeTab = (tabId: string) => updateBlueprint((current) => {
    const tabs = current.tabs.filter((tab) => tab.id !== tabId)
    return { ...current, tabs, activeTab: current.activeTab === tabId ? tabs[Math.max(0, current.tabs.findIndex((tab) => tab.id === tabId) - 1)]?.id ?? 'overview' : current.activeTab }
  })
  const selectPage = (nextPage: Page) => setPage(nextPage)
  const createBlueprint = (name: string) => {
    const id = `blueprint-${crypto.randomUUID().slice(0, 8)}`
    const blueprint = makeBlueprint(id, name)
    setBlueprints((current) => [...current, blueprint]); setActiveBlueprintId(id); setPage('workspace'); setDialog(null); setUndoBlueprint(null)
  }
  const saveName = (name: string) => {
    if (dialog?.kind === 'new') { createBlueprint(name); return }
    if (dialog?.blueprintId) setBlueprints((current) => current.map((blueprint) => blueprint.id === dialog.blueprintId ? { ...blueprint, name } : blueprint))
    setDialog(null)
  }
  const removeBlueprint = (id: string) => {
    if (blueprints.length < 2) return
    const index = blueprints.findIndex((item) => item.id === id)
    setUndoBlueprint(blueprints[index]); setBlueprints((current) => current.filter((item) => item.id !== id))
    if (activeBlueprintId === id) setActiveBlueprintId(blueprints[index === 0 ? 1 : index - 1].id)
    setMenuBlueprint(null)
  }
  const duplicateBlueprint = (id: string) => {
    const original = blueprints.find((item) => item.id === id)
    if (!original) return
    const copy: Blueprint = structuredClone(original)
    copy.id = `blueprint-${crypto.randomUUID().slice(0, 8)}`; copy.name += ' copy'; copy.detailCard = null
    setBlueprints((current) => [...current, copy]); setActiveBlueprintId(copy.id); setMenuBlueprint(null)
  }
  const undoDelete = () => {
    if (!undoBlueprint) return
    setBlueprints((current) => [...current, undoBlueprint]); setActiveBlueprintId(undoBlueprint.id); setUndoBlueprint(null)
  }

  if (!activeBlueprint) return null
  return <div className="desktop-window">
    <TitleBar blueprint={activeBlueprint} update={updateBlueprint} sidebarOpen={sidebarOpen} toggleSidebar={() => setSidebarOpen((current) => !current)} navigate={selectPage} />
    <div className={`app-layout${sidebarOpen ? '' : ' sidebar-collapsed'}`}>
      <aside className="blueprint-sidebar">
        <div className="blueprint-list">{blueprints.map((blueprint) => <div className={`blueprint-nav-item${blueprint.id === activeBlueprintId ? ' active' : ''}`} key={blueprint.id}>
            <button className="blueprint-select" onClick={() => { setActiveBlueprintId(blueprint.id); setPage('workspace'); setMenuBlueprint(null) }}><span className="blueprint-icon"><Workflow size={15} /></span><span className="blueprint-name">{blueprint.name}</span></button>
            <button className="blueprint-edit" title="Edit blueprint" aria-label={`Edit ${blueprint.name}`} onClick={() => { setActiveBlueprintId(blueprint.id); openTab('blueprint') }}><ListTree size={14} /></button>
            <div className="blueprint-more-wrap"><button className="blueprint-more" title="More actions" aria-label={`More actions for ${blueprint.name}`} onClick={() => setMenuBlueprint((value) => value === blueprint.id ? null : blueprint.id)}><Ellipsis size={16} /></button>
              {menuBlueprint === blueprint.id && <div className="context-menu"><button onClick={() => { setActiveBlueprintId(blueprint.id); setDialog({ kind: 'rename', blueprintId: blueprint.id }); setMenuBlueprint(null) }}>Rename</button><button onClick={() => duplicateBlueprint(blueprint.id)}><Copy size={13} />Duplicate</button><button className="danger-action" disabled={blueprints.length < 2} onClick={() => removeBlueprint(blueprint.id)}>Delete</button></div>}
            </div>
          </div>)}</div>
        <button className="new-blueprint" onClick={() => setDialog({ kind: 'new' })}><Plus size={15} />New blueprint</button>
        {undoBlueprint && <button className="undo-delete" onClick={undoDelete}><span>{undoBlueprint.name} deleted</span><b>Undo</b></button>}
      </aside>
      <section className="work-area">
        {page === 'workspace' ? <>
          <div className="workspace-tabs"><div className="tabs-list">{activeBlueprint.tabs.map((tab) => <div className={`workspace-tab${tab.id === activeBlueprint.activeTab ? ' active' : ''}`} key={tab.id}>
            <button onClick={() => selectTab(tab.id)}>{tab.kind === 'overview' ? 'Overview' : tab.kind === 'blueprint' ? 'Blueprint' : activeBlueprint.cards.find((card) => card.id === tab.cardId)?.name ?? 'Card'}</button>
            {tab.kind !== 'overview' && <button className="tab-close" aria-label={`Close ${tab.kind} tab`} onClick={() => closeTab(tab.id)}><X size={12} /></button>}
          </div>)}</div></div>
          <div className="workspace-content">
            <BlueprintContent blueprint={activeBlueprint} update={updateBlueprint} openCard={(id) => openTab('card', id)} />
            <CardDetailsPreview blueprint={activeBlueprint} update={updateBlueprint} />
          </div>
        </> : <EmptyPage page={page} />}
      </section>
    </div>
    <BlueprintDialog key={`${dialog?.kind ?? 'none'}-${dialog?.blueprintId ?? ''}`} dialog={dialog} initialName={dialog?.kind === 'rename' ? blueprints.find((blueprint) => blueprint.id === dialog.blueprintId)?.name ?? '' : ''} onClose={() => setDialog(null)} onSave={saveName} />
  </div>
}


import { Fragment, createContext, useContext, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { invoke } from '@tauri-apps/api/core'
import { startupLog } from './startup'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragMoveEvent, type DragOverEvent, type DragStartEvent } from '@dnd-kit/core'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { Responsive, useContainerWidth, verticalCompactor, type Layout } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import {
  ArrowRightToLine, AudioLines, ChevronDown, ChevronRight, CircleHelp, Clock3, Copy, Ellipsis, FileVideo2, Folder,
  FolderPlus, GripVertical, LayoutGrid, Minus, Monitor,
  Pin, Plus, Save, ScrollText, Settings, Square, Undo2, X, Workflow, Keyboard, Video,
} from 'lucide-react'
import GraphEditor from './GraphEditor'
import { ControlButton, RuntimeDisplay } from './WorkflowControls'
import { overviewCollisionDetection, overviewDropPlacement } from './overview-dnd'
import {
  allParameters, configPathId, createBlueprint as makeBlueprint, exposedInputIds, exposeParameter, hydrateBlueprint, isPinned, moveOverviewCardVertically, moveParameterLayout, overviewCardContentHeight, overviewGridHeight, parameterInputPortId, placeOverviewCardBeside, serializeBlueprint, setPinned, swapOverviewCardPositions, syncBlueprintEvents,
  type Blueprint, type BlueprintDocument, type BlueprintScope, type BlueprintSelection, type EditorTab, type NodeTypeDefinition, type OverviewLayouts, type ParameterDefinition, type ParameterDropPlacement, type ParameterRow, type RegisteredControl, type RegisteredDisplay, type TreeItem, type Value,
} from './model'

type Page = 'workspace' | 'runs' | 'settings'
type NameDialog = { kind: 'new' | 'rename'; blueprintId?: string } | null
type OverviewCardDropPlacement = 'left' | 'right' | 'above' | 'below'
type OverviewDropInfo = { cardId: string | null; placement: OverviewCardDropPlacement | 'swap' | 'end' } | null
type BlueprintIndex = { blueprints: { scope: BlueprintScope; id: string; name: string; revision: string; document: BlueprintDocument | null; error: string | null; runnable: boolean }[]; diagnostics: string[] }
type RuntimeLog = { sequence: number; blueprintId: string; runId: string | null; message: string }
type RecordingStats = { encoder: string; adapter: string; width: number; height: number; fps: number; durationMs: number; encodedFrames: number; droppedFrames: number; repeatedFrames: number; outputPath: string; stopMs: number | null; error: string | null; finished: boolean }
type DisplayInfo = { id: string; name: string; width: number; height: number; x: number; y: number; hdr: boolean }
const DisplayContext = createContext<DisplayInfo[]>([])
type RuntimeSnapshot = { blueprintId: string | null; runId: string | null; status: Blueprint['recordState']; frameCount: number; controls: RegisteredControl[]; displays: RegisteredDisplay[]; logs: RuntimeLog[]; error: string | null; recording: RecordingStats | null }
type RemovedBlueprint = { blueprint: Blueprint; trashName: string | null; savedDocument: string | null }
type Activation = { controls: RegisteredControl[]; diagnostics: string[] }
const overviewWideBreakpoint = 740
const sidebarMinWidth = 160
const sidebarMaxWidth = 400

function getSidebarMaxWidth() {
  return Math.max(sidebarMinWidth, Math.min(sidebarMaxWidth, window.innerWidth - 800))
}

function useDragSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )
}

function isTauriWindow() { return '__TAURI_INTERNALS__' in window }
function withWindow(action: 'minimize' | 'toggleMaximize' | 'close') {
  if (!isTauriWindow()) return
  const appWindow = getCurrentWindow()
  void appWindow[action]().catch((error) => console.error(`Tauri window ${action} failed`, error))
}


function closeNestedMenus(menu: HTMLDetailsElement) {
  menu.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(submenu => { submenu.open = false })
}

function TitleBar({ controls, displays, durationMs, status, controlsDisabled, onControlEvent, sidebarOpen, toggleSidebar, navigate, showLogs }: {
  controls: RegisteredControl[]; displays: RegisteredDisplay[]; durationMs: number; status: Blueprint['recordState']; hasBlueprint: boolean; controlsDisabled: boolean; onControlEvent: (eventId: string) => void
  sidebarOpen: boolean; toggleSidebar: () => void; navigate: (page: Page) => void; showLogs: () => void
}) {
  const dragWindow = () => { if (isTauriWindow()) void getCurrentWindow().startDragging().catch((error) => console.error('Tauri window dragging failed', error)) }
  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      const targetMenu = event.target instanceof Element ? event.target.closest<HTMLDetailsElement>('.brand-menu, .control-menu, .plus-menu') : null
      document.querySelectorAll<HTMLDetailsElement>('.brand-menu[open], .control-menu[open], .plus-menu[open]').forEach((menu) => {
        if (menu !== targetMenu) { closeNestedMenus(menu); menu.open = false }
      })
    }
    document.addEventListener('pointerdown', closeMenus)
    return () => document.removeEventListener('pointerdown', closeMenus)
  }, [])
  return <header className="titlebar" onMouseDown={(event) => { if (event.button === 0 && !(event.target as HTMLElement).closest('button, summary, a, input, select')) { if (event.detail === 2) withWindow('toggleMaximize'); else dragWindow() } }}>
    <div className="titlebar-start">
      <details className="brand-menu" name="global-dropdown-menu" onToggle={(event) => { if (!event.currentTarget.open) closeNestedMenus(event.currentTarget) }}>
        <summary className="brand-menu-trigger" aria-label="Open Nodrec menu"><span className="brand-mark"><span>N</span></span><span className="brand-name">NODREC</span><ChevronDown size={13} /></summary>
        <div className="brand-menu-popover">
          <button onClick={(event) => { navigate('workspace'); event.currentTarget.closest('details')?.removeAttribute('open') }}><Workflow size={14} />Workspace</button>
          <button onClick={(event) => { navigate('runs'); event.currentTarget.closest('details')?.removeAttribute('open') }}><Clock3 size={14} />Runs</button>
          <button onClick={(event) => { navigate('settings'); event.currentTarget.closest('details')?.removeAttribute('open') }}><Settings size={14} />Settings</button>
          <details className="brand-menu-submenu" onPointerEnter={(event) => { event.currentTarget.open = true }} onPointerLeave={(event) => { event.currentTarget.open = false }}>
            <summary><LayoutGrid size={14} /><span>Windows</span><ChevronRight size={13} /></summary>
            <div className="brand-menu-submenu-popover"><button onClick={(event) => { showLogs(); event.currentTarget.closest('.brand-menu-submenu')?.removeAttribute('open'); event.currentTarget.closest('.brand-menu')?.removeAttribute('open') }}><ScrollText size={14} />Logs</button></div>
          </details>
        </div>
      </details>
      <button className="icon-button sidebar-toggle" title={sidebarOpen ? 'Collapse blueprint list' : 'Expand blueprint list'} aria-label="Toggle blueprint list" onClick={toggleSidebar}><PanelGlyph collapsed={!sidebarOpen} /></button>
      <span className="titlebar-divider" />
      <div className="titlebar-recording-actions">
        {[...controls, ...displays].filter(item => !item.targets || item.targets.includes('main')).sort((a,b) => a.order-b.order).map(item => 'source' in item ? <RuntimeDisplay key={item.id} display={item} status={status} durationMs={durationMs} /> : <ControlButton key={item.id} control={item} primary={item.id === 'start-recording'} dispatch={onControlEvent} disabled={controlsDisabled} />)}
      </div>
    </div>
    <div className="titlebar-drag-space" />
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

function LogsWindow({ logs, onClose }: { logs: RuntimeLog[]; onClose: () => void }) {
  const listRef = useRef<HTMLDivElement>(null)
  const latestSequence = logs[logs.length - 1]?.sequence
  useLayoutEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [latestSequence])
  return <section className="logs-window" aria-label="Logs window">
    <header className="logs-window-header"><div><ScrollText size={14} /><strong>Logs</strong><span>{logs.length} {logs.length === 1 ? 'entry' : 'entries'}</span></div><button type="button" aria-label="Close Logs window" onClick={onClose}><X size={14} /></button></header>
    <div className="logs-window-list" ref={listRef} role="log" aria-live="polite">
      {logs.length ? logs.map((log) => <div className="logs-window-entry" key={log.sequence}>{log.message}</div>) : <div className="logs-window-empty">No logs yet.</div>}
    </div>
  </section>
}

function useParameterSizing(value: unknown) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const control = ref.current
    const row = control?.parentElement
    const label = row?.querySelector<HTMLElement>(':scope > .parameter-label')
    if (!control || !row || !label) return
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')!
    const measure = () => {
      const field = control.querySelector<HTMLElement>('.field-control, .readonly-value')
      if (!field) return
      const labelStyle = getComputedStyle(label)
      context.font = `${labelStyle.fontWeight} ${labelStyle.fontSize} ${labelStyle.fontFamily}`
      const labelWidth = context.measureText(label.textContent ?? '').width
      const fieldStyle = getComputedStyle(field)
      context.font = `${fieldStyle.fontWeight} ${fieldStyle.fontSize} ${fieldStyle.fontFamily}`
      const text = field instanceof HTMLSelectElement ? field.selectedOptions[0]?.textContent ?? '' : field instanceof HTMLInputElement ? field.value : field.textContent ?? ''
      const fieldWidth = field.classList.contains('checkbox-control') ? 31 : Math.ceil(context.measureText(text).width) + (field instanceof HTMLSelectElement ? 38 : field instanceof HTMLInputElement && field.type === 'number' ? 38 : 20)
      const extras = row.classList.contains('layout-field-heading') ? 88 : row.classList.contains('config-field') ? 38 : 10
      const width = row.clientWidth
      const stacked = labelWidth + fieldWidth + 22 + extras > width
      const compact = labelWidth + width / 2 + 22 + extras > width
      row.classList.toggle('stacked-parameter', stacked)
      row.style.setProperty('--content-field-width', `${Math.min(width - (row.classList.contains('layout-field-heading') ? 72 : 0), Math.max(stacked || compact ? 0 : width / 2 + 22, fieldWidth + 22))}px`)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    measure()
    return () => observer.disconnect()
  }, [value])
  return ref
}

function ParameterControl({ definition, value, onChange, compact = false }: { definition: ParameterDefinition; value: Value; onChange: (value: Value) => void; compact?: boolean }) {
  const displays = useContext(DisplayContext)
  const changed = definition.kind !== 'readonly' && value !== definition.initial
  const sizingRef = useParameterSizing(JSON.stringify([value, displays]))
  return <span className="parameter-control-wrap" ref={sizingRef}>
    {definition.kind === 'boolean' ? <span className={`field-control checkbox-control${compact ? ' compact' : ''}`}><input aria-label={definition.label} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-track"><i /></span></span>
      : definition.id === 'display' ? <select className="field-control" aria-label={definition.label} value={String(value)} onChange={(event) => onChange(event.target.value)}>
        {!displays.some((display) => display.id === value) && <option value={String(value)}>{String(value)} (select a display)</option>}
        {displays.map((display) => <option key={display.id} value={display.id}>{display.name} · {display.width} × {display.height}{display.hdr ? ' (HDR unsupported)' : ''}</option>)}
      </select>
      : definition.kind === 'choice' ? <select className="field-control" aria-label={definition.label} value={String(value)} onChange={(event) => onChange(typeof definition.initial === 'number' ? Number(event.target.value) : event.target.value)}>{definition.options?.map((option) => <option key={option} value={option}>{option === 'Software' ? 'Software (CPU; higher CPU usage)' : option}</option>)}</select>
        : definition.kind === 'readonly' ? <span className="readonly-value" title={String(value)}>{String(value)}</span>
          : <input className="field-control" type={definition.kind === 'number' ? 'number' : 'text'} min={definition.kind === 'number' ? 0 : undefined} step="1" aria-label={definition.label} value={String(value)} onChange={(event) => onChange(definition.kind === 'number' ? Number(event.target.value) : event.target.value)} />}
    {changed ? <button type="button" className="parameter-reset" aria-label={`Reset ${definition.label}`} title="Reset to default" onClick={(event) => { event.stopPropagation(); onChange(definition.initial) }}><Undo2 size={13} /></button> : <span className="parameter-reset-space" aria-hidden="true" />}
  </span>
}

type BlueprintUpdate = (value: Blueprint | ((current: Blueprint) => Blueprint)) => void

function parameterRowTemplate(row: ParameterRow) {
  return row.columns.map((column) => `${Math.max(1, column.weight * 100)}fr`).join(' ')
}

function ParameterCard({ definition, value, pinned, onChange, selected = false, onSelect, onPin, dragProps, preview = false }: { definition: ParameterDefinition; value: Value; pinned: boolean; onChange: (value: Value) => void; selected?: boolean; onSelect?: () => void; onPin?: () => void; dragProps?: Record<string, unknown>; preview?: boolean }) {
  return <div className={`layout-parameter${selected ? ' selected' : ''}${preview ? ' drag-preview' : ''}`} data-parameter-id={definition.id} onClick={onSelect}>
    <div className="layout-field-heading">
      {dragProps ? <button type="button" className="parameter-drag-handle" aria-label={`Drag ${definition.label}`} {...dragProps}><GripVertical size={13} /></button> : <GripVertical size={13} />}
      <span className="parameter-label">{definition.label}</span>
      <ParameterControl definition={definition} value={value} onChange={onChange} compact />
      <button type="button" className={`icon-button pin-button${pinned ? ' pinned' : ''}`} aria-label={pinned ? 'Unpin parameter' : 'Pin parameter'} onClick={(event) => { event.stopPropagation(); onPin?.() }}><Pin size={14} /></button>
    </div>
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

function ParameterField({ blueprint, definition, update, compact = false, inline = false }: { blueprint: Blueprint; definition: ParameterDefinition; update: (value: Blueprint | ((current: Blueprint) => Blueprint)) => void; compact?: boolean; inline?: boolean }) {
  const value = blueprint.values[definition.id] ?? definition.initial
  const changed = definition.kind !== 'readonly' && value !== definition.initial
  return <label className={`parameter-field${compact ? ' compact' : ''}${inline ? ' inline' : ''}${definition.kind === 'boolean' ? ' boolean-field' : ''}${changed ? ' has-reset' : ''}`}>
    <span className="parameter-label">{definition.label}</span>
    <ParameterControl definition={definition} value={value} onChange={(value) => update((current) => ({ ...current, values: { ...current.values, [definition.id]: value } }))} compact={compact} />
  </label>
}

function cardRows(blueprint: Blueprint, cardId: string, pinned?: boolean) {
  return (blueprint.layouts[cardId] ?? []).filter((row) => pinned === undefined || row.pinned === pinned)
}

function OverviewCard({ blueprint, cardId, update, cardRef, onMeasuredHeight, dragProps, dragSource = false, dropTarget = false, dropPlacement, preview = false, dragHint }: { blueprint: Blueprint; cardId: string; update: BlueprintUpdate; cardRef?: (node: HTMLElement | null) => void; onMeasuredHeight?: (cardId: string, contentHeight: number) => void; dragProps?: Record<string, unknown>; dragSource?: boolean; dropTarget?: boolean; dropPlacement?: OverviewCardDropPlacement | null; preview?: boolean; dragHint?: string }) {
  const headRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const head = headRef.current
    const body = bodyRef.current
    if (!head || !body || !onMeasuredHeight || preview) return
    const measure = () => onMeasuredHeight(cardId, head.getBoundingClientRect().height + body.getBoundingClientRect().height + 2)
    const observer = new ResizeObserver(measure)
    observer.observe(head)
    observer.observe(body)
    measure()
    return () => observer.disconnect()
  }, [cardId, onMeasuredHeight, preview])
  const card = blueprint.cards.find((item) => item.id === cardId)
  if (!card) return null
  const rows = cardRows(blueprint, cardId, true)
  const definitions = allParameters(blueprint)
  return <section ref={cardRef} className={`settings-card${dragSource ? ' drag-source' : ''}${dropTarget ? ' drop-target' : ''}${dropTarget && dropPlacement ? ` drop-target-${dropPlacement}` : ''}${preview ? ' drag-preview' : ''}`}>
    {!preview && <button className="overview-card-drag-handle" type="button" title={`Move ${card.name}`} aria-label={`Move ${card.name}`} {...dragProps}><GripVertical size={20} /></button>}
    {preview && dragHint && <span className="overview-drag-hint">{dragHint}</span>}
    <div className="settings-card-head" ref={headRef}>
      <div className="card-heading"><span className="card-symbol">{cardId === 'audio' ? <AudioLines size={17} /> : cardId === 'video' ? <FileVideo2 size={17} /> : cardId === 'input' ? <Keyboard size={17} /> : cardId === 'recording' ? <Monitor size={17} /> : <Folder size={17} />}</span><h2>{card.name}</h2></div>
      <button className="icon-button" disabled={preview} title="Card details" aria-label={`${card.name} details`} onClick={() => update((current) => ({ ...current, detailCard: cardId }))}><Ellipsis size={17} /></button>
    </div>
    <div className="settings-card-body" ref={bodyRef}>
      {rows.length === 0 ? <div className="empty-card">No pinned parameters yet. Open details to show all.</div> : rows.map((row, index) => <div className="preview-row" key={`${cardId}-row-${index}`} style={{ gridTemplateColumns: parameterRowTemplate(row) }}>
        {row.columns.map((column) => {
          const definition = definitions.find((item) => item.id === column.id)
          return definition ? <ParameterField key={column.id} blueprint={blueprint} definition={definition} update={update} compact inline /> : null
        })}
      </div>)}
    </div>
  </section>
}

function DraggableOverviewCard({ blueprint, cardId, update, activeCardId, dropInfo, onMeasuredHeight }: { blueprint: Blueprint; cardId: string; update: BlueprintUpdate; activeCardId: string | null; dropInfo: OverviewDropInfo; onMeasuredHeight: (cardId: string, contentHeight: number) => void }) {
  const id = `overview:${cardId}`
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id, data: { cardId } })
  const { setNodeRef: setDropRef } = useDroppable({ id, data: { cardId } })
  const setNodeRef = useCallback((node: HTMLElement | null) => { setDragRef(node); setDropRef(node) }, [setDragRef, setDropRef])
  const isTarget = dropInfo?.cardId === cardId && activeCardId !== cardId
  const placement = isTarget && dropInfo && dropInfo.placement !== 'swap' && dropInfo.placement !== 'end' ? dropInfo.placement : null
  return <OverviewCard blueprint={blueprint} cardId={cardId} update={update} cardRef={setNodeRef} onMeasuredHeight={onMeasuredHeight} dragProps={{ ...attributes, ...listeners }} dragSource={isDragging} dropTarget={isTarget} dropPlacement={placement} />
}

function OverviewEndDropZone({ active }: { active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'overview:end', data: { placement: 'end' } })
  return <div ref={setNodeRef} className={`overview-end-drop-zone${active ? ' active' : ''}${isOver ? ' over' : ''}`}>{active ? 'Drop to move to end' : ''}</div>
}

function OverviewCards({ blueprint, update }: { blueprint: Blueprint; update: BlueprintUpdate }) {
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 1280, measureBeforeMount: true })
  const [activeCardId, setActiveCardId] = useState<string | null>(null)
  const [dropInfo, setDropInfo] = useState<OverviewDropInfo>(null)
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({})
  const sensors = useDragSensors()
  const definitions = useMemo(() => allParameters(blueprint), [blueprint])
  const pinnedRows = useMemo(() => Object.fromEntries(blueprint.cards.map((card) => [card.id, (blueprint.layouts[card.id] ?? []).filter((row) => row.pinned)])), [blueprint.cards, blueprint.layouts])
  const onMeasuredHeight = useCallback((cardId: string, contentHeight: number) => {
    const height = overviewGridHeight(contentHeight)
    setMeasuredHeights((current) => current[cardId] === height ? current : { ...current, [cardId]: height })
  }, [])
  const layouts = useMemo(() => Object.fromEntries(Object.entries(blueprint.overviewLayouts).map(([breakpoint, layout]) => {
    const cols = breakpoint === 'wide' ? 12 : 1
    const sized = (layout ?? []).map((item) => {
      const rows = pinnedRows[item.i] ?? []
      const estimatedHeight = overviewGridHeight(overviewCardContentHeight(rows, definitions))
      return { ...item, h: measuredHeights[item.i] ?? estimatedHeight }
    })
    return [breakpoint, verticalCompactor.compact(sized, cols)]
  })), [blueprint.overviewLayouts, definitions, measuredHeights, pinnedRows])
  const onLayoutChange = useCallback((_layout: Layout, nextLayouts: OverviewLayouts) => {
    update((current) => {
      let changed = false
      const overviewLayouts = { ...current.overviewLayouts }
      for (const breakpoint of ['wide', 'narrow'] as const) {
        const next = nextLayouts[breakpoint]
        if (!next) continue
        const previous = current.overviewLayouts[breakpoint] ?? []
        overviewLayouts[breakpoint] = previous.map((item) => {
          const updated = next.find((candidate) => candidate.i === item.i)
          if (!updated || (updated.x === item.x && updated.w === item.w)) return item
          changed = true
          return { ...item, x: updated.x, w: updated.w }
        })
      }
      return changed ? { ...current, overviewLayouts } : current
    })
  }, [update])
  const updateDropFeedback = (active: DragMoveEvent['active'], over: DragMoveEvent['over']) => {
    const sourceId = active.data.current?.cardId
    if (over?.id === 'overview:end') {
      setDropInfo((current) => current?.placement === 'end' ? current : { cardId: null, placement: 'end' })
      return
    }
    const targetId = over?.data.current?.cardId
    if (typeof targetId !== 'string' || typeof sourceId !== 'string' || sourceId === targetId || !over) {
      setDropInfo((current) => current === null ? current : null)
      return
    }
    const detected = overviewDropPlacement(active.rect.current.translated, over.rect)
    const placement = width >= overviewWideBreakpoint || detected === 'above' || detected === 'below' ? detected : null
    const next: Exclude<OverviewDropInfo, null> = { cardId: targetId, placement: placement ?? 'swap' }
    setDropInfo((current) => current?.cardId === next.cardId && current.placement === next.placement ? current : next)
  }
  const handleDragMove = ({ active, over }: DragMoveEvent) => updateDropFeedback(active, over)
  const handleDragOver = ({ active, over }: DragOverEvent) => updateDropFeedback(active, over)
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const sourceId = active.data.current?.cardId
    const targetId = over?.data.current?.cardId
    setActiveCardId(null)
    setDropInfo(null)
    if (typeof sourceId !== 'string') return
    const breakpoint = width >= overviewWideBreakpoint ? 'wide' : 'narrow'
    const cols = breakpoint === 'wide' ? 12 : 1
    if (over?.id !== 'overview:end' && (typeof targetId !== 'string' || sourceId === targetId)) return
    update((current) => {
      const layout = current.overviewLayouts[breakpoint] ?? []
      const detected = over?.id === 'overview:end' ? null : overviewDropPlacement(active.rect.current.translated, over!.rect)
      const placement = cols > 1 || detected === 'above' || detected === 'below' ? detected : null
      const moved = over?.id === 'overview:end'
        ? moveOverviewCardVertically(layout, sourceId, null, 'end', cols)
        : placement === 'left' || placement === 'right'
          ? placeOverviewCardBeside(layout, sourceId, targetId as string, placement, cols)
          : placement === 'above' || placement === 'below'
            ? moveOverviewCardVertically(layout, sourceId, targetId as string, placement, cols)
            : swapOverviewCardPositions(layout, sourceId, targetId as string)
      return moved === layout ? current : { ...current, overviewLayouts: { ...current.overviewLayouts, [breakpoint]: verticalCompactor.compact(moved, cols) } }
    })
  }
  const activeCard = blueprint.cards.find((card) => card.id === activeCardId)
  const dropCard = blueprint.cards.find((card) => card.id === dropInfo?.cardId)
  const dragHint = dropInfo?.placement === 'end' ? 'Move to end' : dropCard && dropInfo ? dropInfo.placement === 'swap' ? `Drop to swap with ${dropCard.name}` : `Insert ${dropInfo.placement} of ${dropCard.name}` : undefined

  return <DndContext sensors={sensors} collisionDetection={overviewCollisionDetection} onDragStart={(event) => { setActiveCardId(String(event.active.data.current?.cardId ?? '')); setDropInfo(null) }} onDragMove={handleDragMove} onDragOver={handleDragOver} onDragCancel={() => { setActiveCardId(null); setDropInfo(null) }} onDragEnd={handleDragEnd}>
    <div className={`settings-grid${dropInfo?.placement === 'end' ? ' drop-target-end' : ''}`} ref={containerRef}>
    {mounted && <Responsive
      className="overview-layout-grid"
      layouts={layouts}
      breakpoints={{ wide: overviewWideBreakpoint, narrow: 0 }}
      cols={{ wide: 12, narrow: 1 }}
      width={width}
      rowHeight={8}
      margin={{ wide: [14, 14], narrow: [0, 14] }}
      containerPadding={[0, 0]}
      dragConfig={{ enabled: false }}
      resizeConfig={{ enabled: width >= overviewWideBreakpoint, handles: ['e', 'w'] }}
      onLayoutChange={onLayoutChange}
    >
      {blueprint.cards.map((card) => {
        const columns = width >= overviewWideBreakpoint ? 12 : 1
        const item = layouts[columns === 12 ? 'wide' : 'narrow']?.find((entry) => entry.i === card.id)
        const edgeClasses = [item?.x === 0 && 'overview-grid-left-edge', item && item.x + item.w >= columns && 'overview-grid-right-edge'].filter(Boolean).join(' ')
        return <div key={card.id} className={edgeClasses}><DraggableOverviewCard blueprint={blueprint} cardId={card.id} update={update} activeCardId={activeCardId} dropInfo={dropInfo} onMeasuredHeight={onMeasuredHeight} /></div>
      })}
    </Responsive>}
    <OverviewEndDropZone active={activeCardId !== null} />
    </div>
    {createPortal(<DragOverlay className="overview-drag-overlay" dropAnimation={null}>{activeCard && <OverviewCard blueprint={blueprint} cardId={activeCard.id} update={update} preview dragHint={dragHint} />}</DragOverlay>, document.body)}
  </DndContext>
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
                <ParameterField blueprint={blueprint} definition={definition} update={update} compact inline />
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
  const sensors = useDragSensors()
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

function SectionTitle({ title, addMenu, open, onToggle }: { title: string; addMenu?: ReactNode; open: boolean; onToggle: () => void }) {
  return <div className="library-section-title"><button type="button" className="library-section-toggle" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`} onClick={onToggle}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span>{title}</span></button>{addMenu}</div>
}

function PlusMenu({ label, children }: { label: string; children: ReactNode }) {
  return <details className="plus-menu" name="global-dropdown-menu" onToggle={(event) => { if (!event.currentTarget.open) closeNestedMenus(event.currentTarget) }}><summary title={`Add to ${label}`} aria-label={`Add to ${label}`}><Plus size={14} /></summary><div className="plus-popover" onClick={(event) => { if ((event.target as HTMLElement).closest('button')) event.currentTarget.closest('details')?.removeAttribute('open') }}>{children}</div></details>
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

function LibraryEditor({ blueprint, update, openCard, openEvent, openFunction }: { blueprint: Blueprint; update: (value: Blueprint | ((current: Blueprint) => Blueprint)) => void; openCard: (id: string) => void; openEvent: (id: string) => void; openFunction: (id: string) => void }) {
  const definitions = allParameters(blueprint)
  const exposedParameters = new Set(blueprint.cards.flatMap((card) => card.parameters))
  const setSelection = (selection: BlueprintSelection) => update((current) => ({ ...current, selection, selectedParameter: selection?.kind === 'parameter' ? selection.key : null, selectedNode: null }))
  const toggleFolder = (folderId: string) => update((current) => ({ ...current, openFolders: { ...current.openFolders, [folderId]: !(current.openFolders[folderId] ?? true) } }))
  const sectionsOpen = Object.fromEntries(['events', 'functions', 'parameters', 'variables'].map((section) => [section, blueprint.openFolders[`section-${section}`] ?? true])) as Record<'events' | 'functions' | 'parameters' | 'variables', boolean>
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
    const id = kind === 'events' ? `event-${crypto.randomUUID()}` : `function-${crypto.randomUUID()}`
    const folders = kind === 'events' ? current.eventFolders : current.functionFolders
    const folderId = folders[0]?.id ?? ''
    const item: TreeItem = { id, name: kind === 'events' ? 'New Event' : 'New Function', folderId }
    if (kind === 'events') return { ...current, events: [...current.events, item], nodes: [...current.nodes, { id, type: 'event', position: { x: 80 + current.nodes.length % 6 * 35, y: 80 + Math.floor(current.nodes.length / 6) * 55 }, data: { kind: 'event', label: item.name, config: { eventId: id } } }], selection: { kind: 'event', key: id } }
    return { ...current, functions: [...current.functions, item], selection: { kind: 'function', key: id } }
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
    {kind === 'parameters' && blueprint.cards.map((card) => <details className="menu-submenu" name="plus-menu-submenu" key={card.id}><summary>{card.name}<ChevronRight size={13} /></summary><div>{definitions.filter((definition) => !card.parameters.includes(definition.id)).map((definition) => <button key={definition.id} onClick={() => update((current) => exposeParameter(current, card.id, definition.id))}>{definition.label}</button>)}</div></details>)}
  </PlusMenu>

  return <aside className="blueprint-library">
    <div className="library-scroll">
      <section className="library-section"><SectionTitle title="Events" open={sectionsOpen.events} onToggle={() => toggleFolder('section-events')} addMenu={sectionPlus('Events', 'events')} />
        {sectionsOpen.events && blueprint.eventFolders.map((folder) => <FolderLine key={folder.id} name={folder.name} open={blueprint.openFolders[folder.id] ?? true} selected={blueprint.selection?.kind === 'folder' && blueprint.selection.key === folder.id} onToggle={() => toggleFolder(folder.id)} onSelect={() => setSelection({ kind: 'folder', key: folder.id })}>
          {blueprint.events.filter((event) => event.folderId === folder.id).map((event) => <button className={`tree-item${blueprint.selection?.kind === 'event' && blueprint.selection.key === event.id ? ' selected' : ''}`} key={event.id} onClick={() => setSelection({ kind: 'event', key: event.id })} onDoubleClick={() => openEvent(event.id)}><CircleHelp size={13} />{event.name}</button>)}
        </FolderLine>)}
      </section>
      <section className="library-section"><SectionTitle title="Functions" open={sectionsOpen.functions} onToggle={() => toggleFolder('section-functions')} addMenu={sectionPlus('Functions', 'functions')} />
        {sectionsOpen.functions && blueprint.functionFolders.map((folder) => <FolderLine key={folder.id} name={folder.name} open={blueprint.openFolders[folder.id] ?? true} selected={blueprint.selection?.kind === 'folder' && blueprint.selection.key === folder.id} onToggle={() => toggleFolder(folder.id)} onSelect={() => setSelection({ kind: 'folder', key: folder.id })}>
          {blueprint.functions.filter((item) => item.folderId === folder.id).map((item) => <button className={`tree-item${blueprint.selection?.kind === 'function' && blueprint.selection.key === item.id ? ' selected' : ''}`} key={item.id} onClick={() => setSelection({ kind: 'function', key: item.id })} onDoubleClick={() => openFunction(item.id)}><Workflow size={13} />{item.name}</button>)}
        </FolderLine>)}
      </section>
      <section className="library-section"><SectionTitle title="Parameters" open={sectionsOpen.parameters} onToggle={() => toggleFolder('section-parameters')} addMenu={sectionPlus('Parameters', 'parameters')} />
        {sectionsOpen.parameters && blueprint.cards.map((card) => <FolderLine key={card.id} name={card.name} open={blueprint.openFolders[card.id] ?? true} selected={blueprint.selection?.kind === 'card' && blueprint.selection.key === card.id} onToggle={() => toggleFolder(card.id)} onSelect={() => setSelection({ kind: 'card', key: card.id })} onDoubleClick={() => openCard(card.id)} onDrop={(event) => {
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
      <section className="library-section"><SectionTitle title="Variables" open={sectionsOpen.variables} onToggle={() => toggleFolder('section-variables')} addMenu={sectionPlus('Variables', 'variables')} />
        {sectionsOpen.variables && blueprint.variableFolders.map((folder) => {
          const inFolder = definitions.filter((definition) => !exposedParameters.has(definition.id) && (folder.id.startsWith('variables-') ? false : folderForVariable(definition.id) === folder.id || (folder.id === 'input' && ['pointer', 'keyboard', 'mouse', 'threshold'].includes(definition.id))))
          return <FolderLine key={folder.id} name={folder.name} open={blueprint.openFolders[folder.id] ?? true} selected={blueprint.selection?.kind === 'folder' && blueprint.selection.key === folder.id} onToggle={() => toggleFolder(folder.id)} onSelect={() => setSelection({ kind: 'folder', key: folder.id })}>
          {inFolder.map((definition) => <button className={`tree-item variable-item${blueprint.selection?.kind === 'parameter' && blueprint.selection.key === definition.id ? ' selected' : ''}`} key={definition.id} draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-nodrec-variable', definition.id); event.dataTransfer.effectAllowed = 'copy' }} onClick={() => setSelection({ kind: 'parameter', key: definition.id })}><span className="variable-token">v</span>{definition.label}</button>)}
          </FolderLine>
        })}
      </section>
    </div>
  </aside>
}

type ConfigPath = (string | number)[]
type ConfigOption = { value: string; label: string }

function isConfigObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function configFieldLabel(name: string) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())
}

function writeConfigPath(current: unknown, path: ConfigPath, next: unknown): unknown {
  if (path.length === 0) return next
  const [key, ...rest] = path
  if (typeof key === 'number') {
    const array = Array.isArray(current) ? current : []
    return array.map((item, index) => index === key ? writeConfigPath(item, rest, next) : item)
  }
  const object = isConfigObject(current) ? current : {}
  return { ...object, [key]: writeConfigPath(object[key], rest, next) }
}

function readConfigPath(current: unknown, path: ConfigPath): { found: boolean; value?: unknown } {
  let value = current
  for (const key of path) {
    if (typeof key === 'number') {
      if (!Array.isArray(value) || !(key in value)) return { found: false }
    } else if (!isConfigObject(value) || !Object.hasOwn(value, key)) return { found: false }
    value = (value as Record<string | number, unknown>)[key]
  }
  return { found: true, value }
}

function removeConfigPath(current: unknown, path: ConfigPath): unknown {
  if (path.length === 0) return current
  const [key, ...rest] = path
  if (typeof key === 'number') return Array.isArray(current) ? current.filter((_, index) => index !== key) : current
  if (!isConfigObject(current)) return current
  if (rest.length === 0) {
    const { [key]: _removed, ...remaining } = current
    return remaining
  }
  return { ...current, [key]: removeConfigPath(current[key], rest) }
}

function sameConfigValue(left: unknown, right: unknown) {
  return Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right)
}

function canRenderConfig(name: string, values: unknown[]): boolean {
  if (name === 'menu' || name === 'children' || values.length === 0) return false
  const value = values[0]

  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
  if (values.some((item) => (Array.isArray(item) ? 'array' : item === null ? 'null' : typeof item) !== type)) return false
  if (isConfigObject(value)) return Object.keys(value).some((key) => canRenderConfig(key, values.map((item) => isConfigObject(item) ? item[key] : undefined)))
  return value !== undefined
}

function configOptions(name: string, blueprint: Blueprint, displays: DisplayInfo[]): ConfigOption[] {
  if (name === 'eventId') return blueprint.nodes.flatMap((node) => {
    const id = node.data.kind === 'event' ? node.data.config?.eventId : null
    return typeof id === 'string' ? [{ value: id, label: node.data.label }] : []
  })
  if (name === 'controlId') return blueprint.nodes.flatMap((node) => {
    const control = node.data.kind === 'register_control' ? node.data.config?.control : null
    return isConfigObject(control) && typeof control.id === 'string' ? [{ value: control.id, label: String(control.label ?? control.id) }] : []
  })
  if (name === 'parameterId') return allParameters(blueprint).map((parameter) => ({ value: parameter.id, label: parameter.label }))
  if (name === 'outputNodeId') return blueprint.nodes.filter((node) => node.data.kind === 'write').map((node) => ({ value: node.id, label: node.data.label }))
  if (name === 'icon') return ['circle-help', 'crop', 'monitor', 'play', 'pause', 'square', 'stop-circle', 'settings', 'video', 'folder', 'mouse-pointer-2', 'audio-lines', 'clock-3'].map((value) => ({ value, label: configFieldLabel(value) }))
  if (name === 'operator') return ['equal', 'not_equal', 'contains'].map((value) => ({ value, label: configFieldLabel(value) }))
  if (name === 'display') return displays.map((display) => ({ value: display.id, label: `${display.name} · ${display.width} × ${display.height}${display.hdr ? ' (HDR unsupported)' : ''}` }))
  if (name === 'source') return ['status', 'elapsed'].map(value => ({ value, label: value }))
  if (name === 'format') return ['text', 'HH:mm:ss'].map(value => ({ value, label: value }))
  if (name === 'mode') return ['Selected Region', 'Full Display', 'Rectangle'].map((value) => ({ value, label: value }))
  if (name === 'encodingMode') return [{ value: 'Hardware Auto', label: 'Hardware Auto' }, { value: 'Software', label: 'Software (CPU; higher CPU usage)' }]
  if (name === 'resolution') return ['Source Size', '1920 × 1080', '2560 × 1440'].map((value) => ({ value, label: value }))
  if (name === 'encoder') return [{ value: 'H.264', label: 'H.264' }]
  return []
}

function ConfigField({ name, values, path, blueprint, defaultConfigs, eventNodeSelected, inputParameters, exposedInputsByNode, toggleInput, updateValue, resetValue }: {
  name: string; values: unknown[]; path: ConfigPath; blueprint: Blueprint; defaultConfigs: Record<string, unknown>[]; eventNodeSelected: boolean; inputParameters: string[]; exposedInputsByNode: Set<string>[]; toggleInput: (path: ConfigPath, enabled: boolean) => void; updateValue: (path: ConfigPath, value: unknown) => void; resetValue: (path: ConfigPath) => void
}) {
  const displays = useContext(DisplayContext)
  const sizingRef = useParameterSizing(JSON.stringify([values, displays]))
  const label = configFieldLabel(name)
  if (name === 'menu' || name === 'children' || name === 'exposedInputs') return null
  const value = values[0]
  if (name === 'targets') {
    const selected = Array.isArray(value) ? value as string[] : ['main']
    const targets = ['main', ...blueprint.nodes.filter(node => node.data.kind === 'select_region').map(node => `region:${node.data.config?.toolId ?? ''}`)]
    const changed = values.some((item, index) => !sameConfigValue(item, readConfigPath(defaultConfigs[index] ?? {}, path).value ?? ['main']))
    return <div className="parameter-field config-field"><span className="parameter-label">Targets</span><span className="parameter-input-button-space" aria-hidden="true" /><span ref={sizingRef} className="parameter-control-wrap"><span className="field-control target-checkboxes">{[...new Set(targets)].map(target => <label key={target}><input type="checkbox" checked={selected.includes(target)} onChange={event => updateValue(path, event.target.checked ? [...selected, target] : selected.filter(item => item !== target))} />{target === 'main' ? 'Main window' : blueprint.nodes.find(node => node.data.kind === 'select_region' && `region:${node.data.config?.toolId ?? ''}` === target)?.data.label ?? target}</label>)}</span>{changed ? <button className="parameter-reset" aria-label="Reset Targets" title="Reset to default" onClick={() => resetValue(path)}><Undo2 size={13} /></button> : <span className="parameter-reset-space" aria-hidden="true" />}</span></div>
  }
  if (value === undefined || !canRenderConfig(name, values)) return null
  const multiple = values.some((item) => !sameConfigValue(item, value))
  if (Array.isArray(value) && multiple) return <div className="parameter-field config-field"><span className="parameter-label">{label}</span><span className="readonly-value">Multiple values</span></div>
  if (Array.isArray(value)) return <details className="config-group config-array" open>
    <summary><ChevronDown size={14} />{label}</summary>
    <div className="config-group-content">{value.map((item, index) => <div className="config-array-item" key={isConfigObject(item) && typeof item.id === 'string' ? item.id : index}>
      <ConfigField name={`${label} ${index + 1}`} values={values.map((array) => (array as unknown[])[index])} path={[...path, index]} blueprint={blueprint} defaultConfigs={defaultConfigs} eventNodeSelected={eventNodeSelected} inputParameters={inputParameters} exposedInputsByNode={exposedInputsByNode} toggleInput={toggleInput} updateValue={updateValue} resetValue={resetValue} />
      <button type="button" className="config-remove" aria-label={`Remove ${label} ${index + 1}`} onClick={() => updateValue(path, value.filter((_, itemIndex) => itemIndex !== index))}><X size={12} /></button>
    </div>)}
    <button type="button" className="config-add" onClick={() => updateValue(path, [...value, ''])}><Plus size={12} />Add item</button></div>
  </details>
  if (isConfigObject(value)) {
    const keys = Object.keys(value).filter((key) => canRenderConfig(key, values.map((item) => isConfigObject(item) ? item[key] : undefined)))
    if (keys.length === 0) return null
    return <details className="config-group" open>
      <summary><ChevronDown size={14} />{label}</summary>
      <div className="config-group-content">{keys.map((key) => <ConfigField key={`${path.join('.')}.${key}`} name={key} values={values.map((item) => (item as Record<string, unknown>)[key])} path={[...path, key]} blueprint={blueprint} defaultConfigs={defaultConfigs} eventNodeSelected={eventNodeSelected} inputParameters={inputParameters} exposedInputsByNode={exposedInputsByNode} toggleInput={toggleInput} updateValue={updateValue} resetValue={resetValue} />)}</div>
    </details>
  }

  const options = configOptions(name, blueprint, displays)
  const readOnlyEventId = eventNodeSelected && name === 'eventId' && path.length === 1
  const inputId = configPathId(path)
  const canExposeInput = inputParameters.includes(inputId)
  const inputEnabled = canExposeInput && exposedInputsByNode.length > 0 && exposedInputsByNode.every((inputs) => inputs.has(inputId))
  const inputMixed = canExposeInput && exposedInputsByNode.some((inputs) => inputs.has(inputId)) && !inputEnabled
  const inputLocked = inputEnabled || inputMixed
  const defaultValues = defaultConfigs.map((config) => readConfigPath(config, path))
  const showReset = !readOnlyEventId && !inputLocked && values.some((item, index) => defaultValues[index]?.found ? !sameConfigValue(item, defaultValues[index].value) : item !== undefined)
  return <div className={`parameter-field config-field${inputLocked ? ' input-bound' : ''}${inputMixed ? ' input-mixed' : ''}`}><span className="parameter-label">{label}</span>
    {canExposeInput ? <button type="button" className={`parameter-input-button${inputEnabled ? ' active' : ''}${inputMixed ? ' mixed' : ''}`} aria-pressed={inputMixed ? 'mixed' : inputEnabled} aria-label={`${inputEnabled ? 'Disable' : 'Enable'} ${label} node input`} title={inputEnabled ? 'Node input enabled' : 'Enable node input'} onClick={() => toggleInput(path, !inputEnabled || inputMixed)}><ArrowRightToLine size={15} /></button> : <span className="parameter-input-button-space" aria-hidden="true" />}
    <span ref={sizingRef} className={`parameter-control-wrap${inputLocked ? ' input-bound' : ''}${typeof value === 'boolean' && !multiple ? ' boolean-control' : ''}`}>
      {typeof value === 'boolean' && multiple ? <select className="field-control" aria-label={label} value="" disabled={inputLocked} onChange={(event) => updateValue(path, event.target.value === 'true')}>
        <option value="">Multiple values</option><option value="true">On</option><option value="false">Off</option>
      </select> : typeof value === 'boolean' ? <span className="field-control checkbox-control compact"><input aria-label={label} type="checkbox" checked={value} disabled={inputLocked} onChange={(event) => updateValue(path, event.target.checked)} /><span className="toggle-track"><i /></span></span>
        : typeof value === 'number' ? <input className="field-control" aria-label={label} type="number" step={Number.isInteger(value) ? '1' : 'any'} min={name === 'milliseconds' ? 0 : undefined} max={name === 'milliseconds' ? 60000 : undefined} value={multiple ? '' : value} placeholder={multiple ? 'Multiple values' : undefined} readOnly={inputLocked} onChange={(event) => updateValue(path, event.target.value === '' ? 0 : Number(event.target.value))} />
          : options.length > 0 ? <select className="field-control" aria-label={label} value={multiple ? '' : String(value ?? '')} disabled={readOnlyEventId || inputLocked} onChange={(event) => updateValue(path, event.target.value)}>
            {multiple && <option value="">Multiple values</option>}
            {!multiple && !options.some((option) => option.value === String(value ?? '')) && <option value={String(value ?? '')}>{String(value ?? '')} (unresolved)</option>}
            {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
            : <input className="field-control" aria-label={label} value={multiple ? '' : String(value ?? '')} placeholder={multiple ? 'Multiple values' : undefined} readOnly={readOnlyEventId || inputLocked} onChange={(event) => updateValue(path, event.target.value)} />}
      {showReset ? <button type="button" className="parameter-reset" aria-label={`Reset ${label}`} title="Reset to default" onClick={(event) => { event.stopPropagation(); resetValue(path) }}><Undo2 size={13} /></button> : <span className="parameter-reset-space" aria-hidden="true" />}
    </span>
  </div>
}

function NodeConfigEditor({ nodes, blueprint, catalog, update }: { nodes: Blueprint['nodes'][number][]; blueprint: Blueprint; catalog: NodeTypeDefinition[]; update: BlueprintUpdate }) {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const defaultConfigs = nodes.map((node) => catalog.find((definition) => definition.kind === node.data.kind)?.defaultConfig ?? {})
  const nodeConfigs: Record<string, unknown>[] = nodes.map((node, index) => ({ ...defaultConfigs[index], ...(node.data.kind === 'region' && !node.data.config?.mode ? { mode: 'Rectangle' } : {}), ...node.data.config, ...(node.data.kind === 'register_control' ? { control: { targets: ['main'], ...(node.data.config?.control as Record<string, unknown> ?? {}) } } : {}) }))
  const inputParameters = nodes.length > 0 ? (catalog.find((definition) => definition.kind === nodes[0]!.data.kind)?.inputParameters ?? []).filter((id) => nodes.every((node) => catalog.find((definition) => definition.kind === node.data.kind)?.inputParameters.includes(id))) : []
  const exposedInputsByNode = nodes.map((node) => new Set(exposedInputIds(node.data.kind, node.data.config ?? {})))
  const updateValue = (path: ConfigPath, value: unknown) => update((current) => ({ ...current, nodes: current.nodes.map((node) => nodeIds.has(node.id) ? { ...node, data: { ...node.data, config: writeConfigPath(node.data.config ?? {}, path, value) as Record<string, unknown> } } : node) }))
  const toggleInput = (path: ConfigPath, enabled: boolean) => {
    const id = configPathId(path)
    update((current) => {
      const nextNodes = current.nodes.map((node) => {
        if (!nodeIds.has(node.id)) return node
        const config = { ...catalog.find((definition) => definition.kind === node.data.kind)?.defaultConfig, ...node.data.config }
        const exposed = new Set(exposedInputIds(node.data.kind, config))
        if (enabled) exposed.add(id); else exposed.delete(id)
        const nextConfig = { ...config }
        if (exposed.size || node.data.kind === 'branch') nextConfig.exposedInputs = [...exposed]
        else delete nextConfig.exposedInputs
        return { ...node, data: { ...node.data, config: nextConfig } }
      })
      const edges = enabled ? current.edges : current.edges.filter((edge) => !nodeIds.has(edge.target) || edge.targetHandle !== `in:${parameterInputPortId(current.nodes.find((node) => node.id === edge.target)?.data.kind ?? 'event', id)}`)
      return { ...current, nodes: nextNodes, edges }
    })
  }
  const resetValue = (path: ConfigPath) => update((current) => ({ ...current, nodes: current.nodes.map((node) => {
    const index = nodes.findIndex((selected) => selected.id === node.id)
    if (index < 0) return node
    const defaultValue = readConfigPath(defaultConfigs[index], path)
    const config = defaultValue.found ? writeConfigPath(nodeConfigs[index] ?? {}, path, defaultValue.value) : removeConfigPath(nodeConfigs[index] ?? {}, path)
    return { ...node, data: { ...node.data, config: config as Record<string, unknown> } }
  }) }))
  const keys = Object.keys(nodeConfigs[0] ?? {}).filter((key) => canRenderConfig(key, nodeConfigs.map((config) => config[key])))
  if (keys.length === 0) return <div className="detail-note">{nodes.length > 1 ? 'Selected nodes have no common editable parameters.' : 'This node has no configurable parameters.'}</div>
  return <div className="visual-config">{keys.map((key) => <ConfigField key={key} name={key} values={nodeConfigs.map((config) => config[key])} path={[key]} blueprint={blueprint} defaultConfigs={defaultConfigs} eventNodeSelected={nodes.some((node) => node.data.kind === 'event')} inputParameters={inputParameters} exposedInputsByNode={exposedInputsByNode} toggleInput={toggleInput} updateValue={updateValue} resetValue={resetValue} />)}</div>
}

function DetailsPanel({ blueprint, update, catalog = [], compact = false, width, onWidthChange, editingNodeId = null, onEditingNodeTitleChange }: { blueprint: Blueprint; update: (value: Blueprint | ((current: Blueprint) => Blueprint)) => void; catalog?: NodeTypeDefinition[]; compact?: boolean; width?: number; onWidthChange?: (width: number) => void; editingNodeId?: string | null; onEditingNodeTitleChange?: (id: string | null) => void }) {
  const resizeStart = useRef<{ x: number; width: number } | null>(null)
  const selection = blueprint.selection
  const selectedNodes = selection?.kind === 'nodes' ? selection.keys.flatMap((key) => blueprint.nodes.filter((node) => node.id === key)) : selection?.kind === 'node' ? blueprint.nodes.filter((node) => node.id === selection.key) : []
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null
  const selectedParameter = selection?.kind === 'parameter' ? allParameters(blueprint).find((item) => item.id === selection.key) : null
  const selectedCard = selection?.kind === 'card' ? blueprint.cards.find((item) => item.id === selection.key) : null
  const selectedEvent = selection?.kind === 'event' ? blueprint.events.find((item) => item.id === selection.key) : null
  const selectedFunction = selection?.kind === 'function' ? blueprint.functions.find((item) => item.id === selection.key) : null
  const selectedFolderName = selection?.kind === 'folder' ? [...blueprint.eventFolders, ...blueprint.functionFolders, ...blueprint.variableFolders].find((item) => item.id === selection.key)?.name ?? blueprint.cards.find((item) => item.id === selection.key)?.name ?? '' : ''
  const nodeKinds = new Set(selectedNodes.map((node) => node.data.kind))
  const title = selectedNodes.length > 1 ? `${selectedNodes.length} nodes selected` : selectedParameter?.label ?? selectedNode?.data.label ?? selectedCard?.name ?? selectedEvent?.name ?? selectedFunction?.name ?? 'Details'
  const updateName = (name: string) => update((current) => {
    if (!selection) return current
    if (selection.kind === 'card') return { ...current, cards: current.cards.map((card) => card.id === selection.key ? { ...card, name } : card) }
    if (selection.kind === 'event') return { ...current, events: current.events.map((item) => item.id === selection.key ? { ...item, name } : item), nodes: current.nodes.map((node) => node.data.kind === 'event' && node.data.config?.eventId === selection.key ? { ...node, data: { ...node.data, label: name } } : node) }
    if (selection.kind === 'function') return { ...current, functions: current.functions.map((item) => item.id === selection.key ? { ...item, name } : item) }
    if (selection.kind === 'folder') return { ...current, eventFolders: current.eventFolders.map((item) => item.id === selection.key ? { ...item, name } : item), functionFolders: current.functionFolders.map((item) => item.id === selection.key ? { ...item, name } : item), variableFolders: current.variableFolders.map((item) => item.id === selection.key ? { ...item, name } : item), cards: current.cards.map((item) => item.id === selection.key ? { ...item, name } : item) }
    if (selection.kind === 'parameter') return { ...current, labels: { ...current.labels, [selection.key]: name }, customParameters: current.customParameters.map((item) => item.id === selection.key ? { ...item, label: name } : item) }
    if (selection.kind === 'node') return { ...current, nodes: current.nodes.map((node) => node.id === selection.key ? { ...node, data: { ...node.data, label: name } } : node) }
    return current
  })
  const isEditingNodeTitle = selectedNode && editingNodeId === selectedNode.id
  return <aside className={`details-panel${compact ? ' details-compact' : ''}`} style={width ? { width: `min(${width}px, calc(100% - 24px))` } : undefined}>
    {width && onWidthChange && <div className="blueprint-details-resizer" role="separator" aria-orientation="vertical" aria-label="Resize Details panel" aria-valuenow={width} tabIndex={0}
      onPointerDown={(event) => { event.preventDefault(); resizeStart.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={(event) => { if (!resizeStart.current || !onWidthChange) return; const maximum = Math.max(220, Math.min(640, window.innerWidth - 260)); onWidthChange(Math.max(220, Math.min(maximum, resizeStart.current.width + resizeStart.current.x - event.clientX))) }}
      onPointerUp={() => { resizeStart.current = null }} onPointerCancel={() => { resizeStart.current = null }}
      onKeyDown={(event) => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault(); onWidthChange(Math.max(220, Math.min(640, width + (event.key === 'ArrowLeft' ? 16 : -16)))) }} />}
    <div className="details-title"><div className="details-title-content"><span className="eyebrow">DETAILS</span>{isEditingNodeTitle ? <input autoFocus className="details-title-input" aria-label="Node title" value={selectedNode.data.label} onChange={(event) => updateName(event.target.value)} onBlur={() => onEditingNodeTitleChange?.(null)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur() }} /> : <h2 className={selectedNode ? 'editable-node-title' : undefined} role={selectedNode ? 'button' : undefined} tabIndex={selectedNode ? 0 : undefined} onClick={selectedNode ? () => onEditingNodeTitleChange?.(selectedNode.id) : undefined} onKeyDown={selectedNode ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onEditingNodeTitleChange?.(selectedNode.id) } } : undefined}>{title}</h2>}</div><div className="details-title-meta">{selectedNodes.length > 0 && <span className="details-node-type">{nodeKinds.size === 1 ? selectedNodes[0]?.data.kind : 'multiple types'}</span>}<Ellipsis size={16} /></div></div>
    {!selection ? <div className="details-empty">Select a node, variable, event, function or card to edit its details.</div> : selectedNodes.length > 1 ? <div className="details-form">
      <NodeConfigEditor key={selectedNodes.map((node) => node.id).join(':')} nodes={selectedNodes} blueprint={blueprint} catalog={catalog} update={update} />
      <div className="detail-note">Edits apply to all selected nodes.</div>
    </div> : selectedNode ? <div className="details-form">
      <NodeConfigEditor key={selectedNode.id} nodes={[selectedNode]} blueprint={blueprint} catalog={catalog} update={update} />
      <div className="detail-note">Node settings and execution links are saved with this blueprint.</div>
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
      <div className="detail-note">{selectedEvent ? 'Connect this event node to execution nodes to define its behavior.' : 'Functions are listed here for future subgraph support.'}</div>
    </div> : selection.kind === 'folder' ? <div className="details-form"><label className="parameter-field"><span className="parameter-label">Folder name</span><input className="field-control" value={selectedFolderName} onChange={(event) => updateName(event.target.value)} /></label></div> : <div className="details-empty">Select an item to edit its details.</div>}
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

const emptyGraph: Pick<Blueprint, 'nodes' | 'edges'> = { nodes: [], edges: [] }

function BlueprintContent({ blueprint, update, openCard, catalog, locked }: { blueprint: Blueprint; update: (value: Blueprint | ((current: Blueprint) => Blueprint)) => void; openCard: (id: string) => void; catalog: NodeTypeDefinition[]; locked: boolean }) {
  const [focusRequest, setFocusRequest] = useState<{ id: string; sequence: number } | null>(null)
  const editorTab = blueprint.tabs.find((tab) => tab.id === blueprint.activeTab) ?? blueprint.tabs[0]!
  const functionId = editorTab.kind === 'function' ? editorTab.functionId : undefined
  const activeFunction = functionId ? blueprint.functions.find((item) => item.id === functionId) : undefined
  const graphBlueprint = activeFunction ? { ...blueprint, nodes: activeFunction.graph?.nodes ?? emptyGraph.nodes, edges: activeFunction.graph?.edges ?? emptyGraph.edges } : blueprint
  const updateGraph: typeof update = useCallback((value) => update((current) => {
    if (!functionId) return typeof value === 'function' ? value(current) : value
    const item = current.functions.find((item) => item.id === functionId)
    if (!item) return current
    const scoped = { ...current, nodes: item.graph?.nodes ?? emptyGraph.nodes, edges: item.graph?.edges ?? emptyGraph.edges }
    const next = typeof value === 'function' ? value(scoped) : value
    if (next === scoped) return current
    return { ...next, nodes: current.nodes, edges: current.edges, functions: next.functions.map((item) => item.id === functionId ? { ...item, graph: { nodes: next.nodes, edges: next.edges } } : item) }
  }), [functionId, update])
  const openEvent = (id: string) => {
    const node = blueprint.nodes.find((node) => node.data.kind === 'event' && node.data.config?.eventId === id)
    if (!node) return
    update((current) => ({ ...current, activeTab: 'blueprint', tabs: current.tabs.some((tab) => tab.id === 'blueprint') ? current.tabs : [...current.tabs, { id: 'blueprint', kind: 'blueprint' }], selection: { kind: 'event', key: id }, selectedNode: node.id, nodes: current.nodes.map((item) => ({ ...item, selected: item.id === node.id })) }))
    setFocusRequest((previous) => ({ id: node.id, sequence: (previous?.sequence ?? 0) + 1 }))
  }
  const openFunction = (id: string) => update((current) => {
    const tabId = `function:${id}`
    return { ...current, tabs: current.tabs.some((tab) => tab.id === tabId) ? current.tabs : [...current.tabs, { id: tabId, kind: 'function', functionId: id }], activeTab: tabId, selectedNode: null, selection: { kind: 'function', key: id } }
  })
  const [detailsWidth, setDetailsWidth] = useState(380)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const selectGraphNodes = useCallback((ids: string[]) => {
    setEditingNodeId(null)
    updateGraph((current) => {
      const keys = [...new Set(ids)].filter((id) => current.nodes.some((node) => node.id === id))
      const previousKeys = current.selection?.kind === 'nodes' ? current.selection.keys : current.selection?.kind === 'node' ? [current.selection.key] : []
      if (keys.length === previousKeys.length && keys.every((id) => previousKeys.includes(id)) && current.selectedNode === (keys.length === 1 ? keys[0] : null)) return current
      const selection: BlueprintSelection = keys.length > 1 ? { kind: 'nodes', keys } : keys.length === 1 ? { kind: 'node', key: keys[0]! } : null
      return { ...current, selectedNode: keys.length === 1 ? keys[0]! : null, selection }
    })
  }, [updateGraph])
  const selectGraphNode = useCallback((id: string | null) => selectGraphNodes(id ? [id] : []), [selectGraphNodes])
  const editGraphNodeTitle = useCallback((id: string) => {
    if (locked) return
    selectGraphNode(id)
    setEditingNodeId(id)
  }, [locked, selectGraphNode])
  if (editorTab.kind === 'card' && editorTab.cardId) return <CardLayoutEditor key={`${blueprint.id}:${editorTab.cardId}`} blueprint={blueprint} cardId={editorTab.cardId} update={update} />
  if (editorTab.kind === 'blueprint' || activeFunction) return <div className="blueprint-workbench">
    <LibraryEditor blueprint={blueprint} update={update} openCard={openCard} openEvent={openEvent} openFunction={openFunction} />
    <GraphEditor key={`${blueprint.id}:${editorTab.id}`} graphName={activeFunction?.name} focusRequest={activeFunction ? null : focusRequest} blueprint={graphBlueprint} update={updateGraph} selectNode={selectGraphNode} selectNodes={selectGraphNodes} editNodeTitle={editGraphNodeTitle} catalog={catalog} locked={locked} />
    <DetailsPanel blueprint={graphBlueprint} update={updateGraph} catalog={catalog} width={detailsWidth} onWidthChange={setDetailsWidth} editingNodeId={editingNodeId} onEditingNodeTitleChange={setEditingNodeId} />
  </div>
  return <main className="overview-page"><OverviewCards blueprint={blueprint} update={update} /></main>
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
  const [blueprints, setBlueprints] = useState<Blueprint[]>([])
  const [activeBlueprintId, setActiveBlueprintId] = useState<string | null>(null)
  const [page, setPage] = useState<Page>('workspace')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const savedWidth = localStorage.getItem('nodrec.blueprint-sidebar-width')
    const width = savedWidth === null ? Number.NaN : Number(savedWidth)
    return Number.isFinite(width) ? Math.max(sidebarMinWidth, Math.min(getSidebarMaxWidth(), width)) : Math.min(220, getSidebarMaxWidth())
  })
  const [dialog, setDialog] = useState<NameDialog>(null)
  const [menuBlueprint, setMenuBlueprint] = useState<{ id: string; top: number; left: number } | null>(null)
  const [undoBlueprint, setUndoBlueprint] = useState<RemovedBlueprint | null>(null)
  const [catalog, setCatalog] = useState<NodeTypeDefinition[]>([])
  const [savedDocuments, setSavedDocuments] = useState<Record<string, string>>({})
  const [savingBlueprints, setSavingBlueprints] = useState<Set<string>>(() => new Set())
  const [diagnostics, setDiagnostics] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(() => isTauriWindow() ? null : 'Blueprint files are loaded by the Nodrec desktop app.')
  const [loading, setLoading] = useState(isTauriWindow)
  const [controls, setControls] = useState<RegisteredControl[]>([])
  const [registeredDisplays, setRegisteredDisplays] = useState<RegisteredDisplay[]>([])
  const [status, setStatus] = useState<Blueprint['recordState']>('ready')
  const [frameCount, setFrameCount] = useState(0)
  const [recording, setRecording] = useState<RecordingStats | null>(null)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  useEffect(() => {
    if (!isTauriWindow()) return
    const refresh = () => { void invoke<DisplayInfo[]>('list_displays').then(setDisplays).catch((error) => setNotice(`Cannot enumerate displays: ${String(error)}`)) }
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])
  const [logs, setLogs] = useState<RuntimeLog[]>([])
  const [logsOpen, setLogsOpen] = useState(false)
  const logsPanelRef = usePanelRef()
  const activeBlueprint = blueprints.find((blueprint) => blueprint.id === activeBlueprintId)
  const activeBlueprintIdRef = useRef(activeBlueprintId)
  const sidebarResizeRef = useRef<{ x: number; width: number } | null>(null)
  const activatedDocumentRef = useRef('')
  const activeDocument = useMemo(() => activeBlueprint ? serializeBlueprint(activeBlueprint) : null, [activeBlueprint])
  const activeDocumentJson = activeDocument ? JSON.stringify(activeDocument) : ''
  const activeBlueprintDirty = !!activeBlueprint && savedDocuments[activeBlueprint.id] !== activeDocumentJson
  const activationKey = activeBlueprintId && activeDocumentJson ? `${activeBlueprintId}:${activeDocumentJson}` : ''
  const runtimeLocked = ['starting', 'recording', 'paused', 'stopping'].includes(status)
  const updateBlueprint = useCallback((value: Blueprint | ((current: Blueprint) => Blueprint)) => {
    if (!activeBlueprintId) return
    setBlueprints((current) => current.map((blueprint) => {
      if (blueprint.id !== activeBlueprintId) return blueprint
      return syncBlueprintEvents(typeof value === 'function' ? value(blueprint) : value)
    }))
  }, [activeBlueprintId])

  useEffect(() => { activeBlueprintIdRef.current = activeBlueprintId }, [activeBlueprintId])
  useLayoutEffect(() => {
    if (logsOpen) logsPanelRef.current?.expand()
    else logsPanelRef.current?.collapse()
  }, [logsOpen, logsPanelRef])
  useEffect(() => { localStorage.setItem('nodrec.blueprint-sidebar-width', String(sidebarWidth)) }, [sidebarWidth])
  useEffect(() => {
    const clampSidebarWidth = () => setSidebarWidth((width) => Math.min(width, getSidebarMaxWidth()))
    window.addEventListener('resize', clampSidebarWidth)
    return () => window.removeEventListener('resize', clampSidebarWidth)
  }, [])
  useEffect(() => {
    if (!menuBlueprint) return
    const dismiss = (event: Event) => {
      const target = event.target
      if (target instanceof Element && target.closest('.blueprint-more, .context-menu')) return
      setMenuBlueprint(null)
    }
    const close = () => setMenuBlueprint(null)
    document.addEventListener('pointerdown', dismiss)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menuBlueprint])
  const toggleBlueprintMenu = (id: string, button: HTMLButtonElement) => {
    if (menuBlueprint?.id === id) { setMenuBlueprint(null); return }
    const rect = button.getBoundingClientRect()
    const menuWidth = 176
    const menuHeight = 120
    const top = rect.bottom + menuHeight + 8 <= window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - menuHeight - 4)
    const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth))
    setMenuBlueprint({ id, top, left })
  }

  useEffect(() => {
    if (!isTauriWindow()) return
    let live = true
    startupLog('App mounted; requesting blueprint index and node catalog')
    void Promise.all([
      invoke<BlueprintIndex>('list_blueprints').then((index) => { startupLog(`blueprint index received: ${index.blueprints.length} files`); return index }),
      invoke<NodeTypeDefinition[]>('list_node_types').then((types) => { startupLog(`node catalog received: ${types.length} types`); return types }),
    ]).then(async ([index, nodeTypes]) => {
      if (!live) return
      const seen = new Set<string>()
      const valid = index.blueprints.flatMap((item) => {
        if (!item.document || item.error) return []
        if (seen.has(item.id)) { index.diagnostics.push(`Duplicate blueprint ID '${item.id}' across storage folders`); return [] }
        seen.add(item.id)
        const document = { ...item.document, supported: item.runnable }
        return [hydrateBlueprint(document, item.scope, item.revision)]
      })
      setBlueprints(valid)
      setCatalog(nodeTypes)
      setDiagnostics([...index.diagnostics, ...index.blueprints.filter((item) => item.error).map((item) => `${item.name}: ${item.error}`)])
      setSavedDocuments(Object.fromEntries(valid.map((blueprint) => [blueprint.id, JSON.stringify(serializeBlueprint(blueprint))])))
      const initial = valid.find((blueprint) => blueprint.id === 'screen-recording') ?? valid[0]
      startupLog(`blueprints hydrated: ${valid.length}; initializing controls`)
      if (initial) {
        try {
          const document = serializeBlueprint(initial)
          const activation = await invoke<Activation>('activate_blueprint', { document })
          startupLog('initial blueprint activation returned; requesting runtime snapshot')
          const snapshot = await invoke<RuntimeSnapshot>('runtime_snapshot')
          startupLog('initial runtime snapshot received')
          if (!live) return
          activatedDocumentRef.current = `${initial.id}:${JSON.stringify(document)}`
          setControls(activation.controls)
          setStatus(snapshot.status)
          setFrameCount(snapshot.frameCount); setRecording(snapshot.recording)
          setLogs(snapshot.logs)
          if (activation.diagnostics.length) setNotice(activation.diagnostics.join(' · '))
          else if (initial.supported && activation.controls.length === 0) setNotice('This blueprint has no controls registered by On Initialize.')
        } catch (error) { startupLog(`initialization failed: ${String(error)}`); if (live) setNotice(`Cannot initialize blueprint controls: ${String(error)}`) }
      }
      setActiveBlueprintId(initial?.id ?? null)
    }).catch((error) => { startupLog(`blueprint loading failed: ${String(error)}`); if (live) setNotice(`Cannot load Nodrec blueprints: ${String(error)}`) }).finally(() => { if (live) { startupLog('initialization finished; updating React state'); setLoading(false) } })
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!loading) requestAnimationFrame(() => startupLog('React committed initialized UI; animation frame reached'))
  }, [loading])

  useEffect(() => {
    if (!isTauriWindow()) return
    let disposed = false
    let unlisten: (() => void)[] = []
    const apply = (snapshot: RuntimeSnapshot) => {
      if (snapshot.blueprintId !== activeBlueprintIdRef.current) return
      setStatus(snapshot.status)
      setControls(snapshot.controls); setRegisteredDisplays(snapshot.displays ?? [])
      setFrameCount(snapshot.frameCount); setRecording(snapshot.recording)
      setLogs(snapshot.logs)
      setBlueprints((current) => current.map((blueprint) => blueprint.id === snapshot.blueprintId ? { ...blueprint, recordState: snapshot.status } : blueprint))
      if (snapshot.error) setNotice(snapshot.error)
    }
    void Promise.all([
      listen<RuntimeSnapshot>('workflow-status', (event) => apply(event.payload)),
      listen<RuntimeLog>('workflow-log', (event) => {
        setLogs((current) => current.some((log) => log.sequence === event.payload.sequence) ? current : [...current, event.payload].slice(-300))
      }),
    ]).then((listeners) => { if (disposed) listeners.forEach((stop) => stop()); else unlisten = listeners })
    return () => { disposed = true; unlisten.forEach((stop) => stop()) }
  }, [])

  useEffect(() => {
    if (!runtimeLocked || !activeBlueprintId || !isTauriWindow()) return
    const poll = () => void invoke<RuntimeSnapshot>('runtime_snapshot').then((snapshot) => {
      if (snapshot.blueprintId !== activeBlueprintIdRef.current) return
      setStatus(snapshot.status); setControls(snapshot.controls); setRegisteredDisplays(snapshot.displays ?? []); setFrameCount(snapshot.frameCount); setRecording(snapshot.recording)
      setLogs(snapshot.logs)
    }).catch((error) => setNotice(String(error)))
    poll()
    const timer = window.setInterval(poll, 500)
    return () => window.clearInterval(timer)
  }, [runtimeLocked, activeBlueprintId])

  useEffect(() => {
    if (!activationKey || !activeDocumentJson || !isTauriWindow() || activationKey === activatedDocumentRef.current) return
    let live = true
    const supported = (JSON.parse(activeDocumentJson) as BlueprintDocument).supported
    const timer = window.setTimeout(() => {
      void invoke<Activation>('activate_blueprint', { document: JSON.parse(activeDocumentJson) as BlueprintDocument }).then((activation) => {
        if (!live) return
        activatedDocumentRef.current = activationKey
        setControls(activation.controls)
        setStatus('ready')
        if (activation.diagnostics.length) setNotice(activation.diagnostics.join(' · '))
        else if (supported && activation.controls.length === 0) setNotice('This blueprint has no controls registered by On Initialize.')
        return invoke<RuntimeSnapshot>('runtime_snapshot').then((snapshot) => { if (live) {
          setFrameCount(snapshot.frameCount); setRecording(snapshot.recording); setLogs(snapshot.logs); setStatus(snapshot.status); setControls(snapshot.controls); setRegisteredDisplays(snapshot.displays ?? [])
        } })
      }).catch((error) => { if (live) setNotice(`Cannot initialize blueprint controls: ${String(error)}`) })
    }, 120)
    return () => { live = false; window.clearTimeout(timer) }
  }, [activationKey, activeBlueprintId, activeDocumentJson])

  const dispatchEvent = (eventId: string) => {
    setNotice(null)
    void invoke('dispatch_blueprint_event', { eventId })
      .then(() => invoke<RuntimeSnapshot>('runtime_snapshot'))
      .then((snapshot) => {
        if (snapshot.blueprintId !== activeBlueprintIdRef.current) return
        setStatus(snapshot.status); setControls(snapshot.controls); setRegisteredDisplays(snapshot.displays ?? []); setFrameCount(snapshot.frameCount); setRecording(snapshot.recording)
        setLogs(snapshot.logs)
      })
      .catch((error) => setNotice(String(error)))
  }

  const saveBlueprint = useCallback(async (id: string) => {
    const blueprint = blueprints.find((item) => item.id === id)
    if (!blueprint || !isTauriWindow() || runtimeLocked && id === activeBlueprintId || savingBlueprints.has(id)) return
    const document = serializeBlueprint(blueprint)
    const serialized = JSON.stringify(document)
    if (savedDocuments[id] === serialized) return
    setSavingBlueprints((current) => new Set(current).add(id)); setNotice(null)
    try {
      const revision = await invoke<string>('save_blueprint', { scope: blueprint.scope, id: blueprint.id, document, expectedRevision: blueprint.revision })
      setBlueprints((current) => current.map((item) => item.id === id ? { ...item, revision } : item))
      setSavedDocuments((current) => ({ ...current, [id]: serialized }))
    } catch (error) { setNotice(`Save failed: ${String(error)}`) } finally {
      setSavingBlueprints((current) => { const next = new Set(current); next.delete(id); return next })
    }
  }, [blueprints, runtimeLocked, activeBlueprintId, savingBlueprints, savedDocuments])

  useEffect(() => {
    const save = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat && page === 'workspace' && !dialog && activeBlueprintId) void saveBlueprint(activeBlueprintId)
    }
    window.addEventListener('keydown', save, true)
    return () => window.removeEventListener('keydown', save, true)
  }, [page, dialog, activeBlueprintId, saveBlueprint])

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
    setControls([]); setFrameCount(0); setStatus('ready')
    setBlueprints((current) => [...current, blueprint]); setActiveBlueprintId(id); setPage('workspace'); setDialog(null); setUndoBlueprint(null)
  }
  const saveName = (name: string) => {
    if (dialog?.kind === 'new') { createBlueprint(name); return }
    if (dialog?.blueprintId) setBlueprints((current) => current.map((blueprint) => blueprint.id === dialog.blueprintId ? { ...blueprint, name } : blueprint))
    setDialog(null)
  }
  const removeBlueprint = async (id: string) => {
    const index = blueprints.findIndex((item) => item.id === id)
    const removed = blueprints[index]
    if (!removed || runtimeLocked && id === activeBlueprintId) return
    try {
      const trashName = removed.revision === null ? null : await invoke<string>('delete_blueprint', { scope: removed.scope, id: removed.id })
      setUndoBlueprint({ blueprint: removed, trashName, savedDocument: savedDocuments[id] ?? null })
      setBlueprints((current) => current.filter((item) => item.id !== id))
      setSavedDocuments((current) => { const next = { ...current }; delete next[id]; return next })
      if (activeBlueprintId === id) {
        setControls([]); setFrameCount(0)
        setActiveBlueprintId(blueprints.find((item) => item.id !== id)?.id ?? null)
      }
    } catch (error) { setNotice(`Delete failed: ${String(error)}`) }
    setMenuBlueprint(null)
  }
  const duplicateBlueprint = (id: string) => {
    const original = blueprints.find((item) => item.id === id)
    if (!original || runtimeLocked) return
    const copy: Blueprint = structuredClone(original)
    copy.id = `blueprint-${crypto.randomUUID().slice(0, 8)}`; copy.name += ' copy'; copy.detailCard = null; copy.scope = 'user'; copy.revision = null; copy.recordState = 'ready'
    setControls([]); setFrameCount(0)
    setBlueprints((current) => [...current, copy]); setActiveBlueprintId(copy.id); setMenuBlueprint(null)
  }
  const undoDelete = async () => {
    if (!undoBlueprint) return
    try {
      if (undoBlueprint.trashName) await invoke('restore_blueprint', { scope: undoBlueprint.blueprint.scope, id: undoBlueprint.blueprint.id, trashName: undoBlueprint.trashName })
      setControls([]); setFrameCount(0); setStatus('ready')
      setBlueprints((current) => [...current, undoBlueprint.blueprint]); setActiveBlueprintId(undoBlueprint.blueprint.id); setUndoBlueprint(null)
      if (undoBlueprint.savedDocument) setSavedDocuments((current) => ({ ...current, [undoBlueprint.blueprint.id]: undoBlueprint.savedDocument! }))
    } catch (error) { setNotice(`Undo failed: ${String(error)}`) }
  }

  const switchBlueprint = (id: string) => {
    if (runtimeLocked) return
    if (id === activeBlueprintId) { setPage('workspace'); setMenuBlueprint(null); return }
    setControls([]); setFrameCount(0); setStatus('ready'); setNotice(null)
    setActiveBlueprintId(id); setPage('workspace'); setMenuBlueprint(null)
  }
  const showLogs = () => { setLogsOpen(true); logsPanelRef.current?.expand() }
  const contextBlueprint = menuBlueprint ? blueprints.find((blueprint) => blueprint.id === menuBlueprint.id) : null
  return <DisplayContext.Provider value={displays}><div className="desktop-window">
    <TitleBar displays={registeredDisplays} durationMs={recording?.durationMs ?? 0} controls={controls} status={status} hasBlueprint={Boolean(activeBlueprint)} controlsDisabled={!activeBlueprint?.supported} onControlEvent={dispatchEvent} sidebarOpen={sidebarOpen} toggleSidebar={() => setSidebarOpen((current) => !current)} navigate={selectPage} showLogs={showLogs} />
    <Group className="desktop-panels" orientation="vertical" defaultLayout={{ workspace: 78, logs: 22 }} resizeTargetMinimumSize={{ fine: 8, coarse: 12 }}>
    <Panel id="workspace" minSize="35%" className="desktop-main-panel">
    <div className={`app-layout${sidebarOpen ? '' : ' sidebar-collapsed'}`} style={{ gridTemplateColumns: sidebarOpen ? `${sidebarWidth}px 6px minmax(0, 1fr)` : '0px 0px minmax(0, 1fr)' }}>
      <aside className="blueprint-sidebar">
        <div className="blueprint-list">{blueprints.map((blueprint) => {
          const dirty = savedDocuments[blueprint.id] !== JSON.stringify(serializeBlueprint(blueprint))
          return <div className={`blueprint-nav-item${blueprint.id === activeBlueprintId ? ' active' : ''}`} key={blueprint.id}>
            <button className="blueprint-select" disabled={runtimeLocked && blueprint.id !== activeBlueprintId} onClick={() => switchBlueprint(blueprint.id)}><span className="blueprint-icon"><Workflow size={15} /></span><span className="blueprint-name">{blueprint.name}</span>{dirty && <span className="unsaved-dot" role="img" aria-label="Unsaved changes" title="Unsaved changes" />}</button>
            {dirty && <button className="blueprint-save" title={`Save ${blueprint.name}`} aria-label={`Save ${blueprint.name}`} disabled={savingBlueprints.has(blueprint.id) || runtimeLocked && blueprint.id === activeBlueprintId} onClick={() => { void saveBlueprint(blueprint.id) }}><Save size={14} /></button>}
            <button className="blueprint-more" title="More actions" aria-label={`More actions for ${blueprint.name}`} disabled={runtimeLocked} onClick={(event) => toggleBlueprintMenu(blueprint.id, event.currentTarget)}><Ellipsis size={16} /></button>
          </div>
        })}</div>
        <button className="new-blueprint" disabled={runtimeLocked} onClick={() => setDialog({ kind: 'new' })}><Plus size={15} />New blueprint</button>
        {undoBlueprint && <button className="undo-delete" onClick={() => { void undoDelete() }}><span>{undoBlueprint.blueprint.name} deleted</span><b>Undo</b></button>}
      </aside>
      <button type="button" className="sidebar-resizer" role="separator" aria-label="Resize blueprint list" aria-orientation="vertical" aria-valuemin={sidebarMinWidth} aria-valuemax={getSidebarMaxWidth()} aria-valuenow={Math.round(sidebarWidth)} onPointerDown={(event) => { sidebarResizeRef.current = { x: event.clientX, width: sidebarWidth }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={(event) => {
        const start = sidebarResizeRef.current
        if (!start) return
        setSidebarWidth(Math.max(sidebarMinWidth, Math.min(getSidebarMaxWidth(), start.width + event.clientX - start.x)))
      }} onPointerUp={(event) => { sidebarResizeRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={() => { sidebarResizeRef.current = null }} onDoubleClick={() => setSidebarWidth(Math.min(220, getSidebarMaxWidth()))} onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setSidebarWidth((width) => Math.max(sidebarMinWidth, Math.min(getSidebarMaxWidth(), width + (event.key === 'ArrowRight' ? 12 : -12)))) }
      }} />
      <section className="work-area">
        {notice && <div className="app-notice" role="status">{notice}<button aria-label="Dismiss message" onClick={() => setNotice(null)}><X size={13} /></button></div>}
        {diagnostics.length > 0 && <div className="app-diagnostics">{diagnostics.map((item, index) => <div key={`${index}:${item}`}>{item}</div>)}</div>}
        {page !== 'workspace' ? <EmptyPage page={page} /> : !activeBlueprint ? <main className="empty-blueprints"><div className="empty-icon"><Workflow size={24} /></div><span className="eyebrow">BLUEPRINTS</span><h1>{loading ? 'Loading blueprints' : 'No blueprints found'}</h1><p>{loading ? 'Reading files beside the application.' : 'Create a blueprint to start building a workflow.'}</p><button className="button primary" disabled={loading} onClick={() => setDialog({ kind: 'new' })}><Plus size={14} />New blueprint</button></main>
          : runtimeLocked ? <main className="runtime-locked"><div className="empty-icon"><Video size={24} /></div><span className="eyebrow">{activeBlueprint.name}</span><h1>{status === 'paused' ? 'Recording paused' : status === 'starting' ? 'Starting workflow' : status === 'stopping' ? 'Finalizing MP4' : 'Recording'}</h1><p>{frameCount} encoded frames. Use the blueprint controls above to continue or stop.</p>{recording && <><p>{recording.encoder} · {recording.adapter}<br />{recording.width} × {recording.height} · {recording.fps} fps · {(recording.durationMs / 1000).toFixed(1)} s<br />{recording.droppedFrames} dropped · {recording.repeatedFrames} repeated</p><p>{recording.outputPath}</p></>}</main>
            : <>
              <div className="workspace-tabs"><div className="tabs-list">{activeBlueprint.tabs.map((tab) => <div className={`workspace-tab${tab.id === activeBlueprint.activeTab ? ' active' : ''}`} key={tab.id} title={activeBlueprintDirty ? `Unsaved changes in ${activeBlueprint.name} (Ctrl+S to save)` : undefined}>
                <button onClick={() => selectTab(tab.id)}>{tab.kind === 'overview' ? 'Overview' : tab.kind === 'blueprint' ? 'Blueprint' : tab.kind === 'function' ? activeBlueprint.functions.find((item) => item.id === tab.functionId)?.name ?? 'Function' : activeBlueprint.cards.find((card) => card.id === tab.cardId)?.name ?? 'Card'}</button>
                {activeBlueprintDirty && <span className="unsaved-dot" role="img" aria-label="Unsaved changes" />}
                {tab.kind !== 'overview' && <button className="tab-close" aria-label={`Close ${tab.kind} tab`} onClick={() => closeTab(tab.id)}><X size={12} /></button>}
              </div>)}</div></div>
              <div className="workspace-content">
                <BlueprintContent blueprint={activeBlueprint} update={updateBlueprint} openCard={(id) => openTab('card', id)} catalog={catalog} locked={runtimeLocked} />
                <CardDetailsPreview blueprint={activeBlueprint} update={updateBlueprint} />
              </div>
            </>}
      </section>
    </div>
    </Panel>
    <Separator className={`logs-resize-separator${logsOpen ? '' : ' closed'}`} disabled={!logsOpen} aria-label="Resize Logs window" />
    <Panel id="logs" className="desktop-logs-panel" panelRef={logsPanelRef} collapsible collapsedSize="0%" minSize="12%" maxSize="60%">
      {logsOpen && <LogsWindow logs={logs} onClose={() => setLogsOpen(false)} />}
    </Panel>
    </Group>
    {menuBlueprint && contextBlueprint && createPortal(<div className="context-menu" role="menu" style={{ position: 'fixed', top: menuBlueprint.top, left: menuBlueprint.left }} onContextMenu={(event) => event.preventDefault()}>
      <button role="menuitem" disabled={runtimeLocked} onClick={() => { switchBlueprint(contextBlueprint.id); setDialog({ kind: 'rename', blueprintId: contextBlueprint.id }); setMenuBlueprint(null) }}>Rename</button>
      <button role="menuitem" disabled={runtimeLocked} onClick={() => duplicateBlueprint(contextBlueprint.id)}><Copy size={13} />Duplicate</button>
      <button role="menuitem" className="danger-action" disabled={runtimeLocked && contextBlueprint.id === activeBlueprintId} onClick={() => { void removeBlueprint(contextBlueprint.id) }}>Delete</button>
    </div>, document.body)}
    <BlueprintDialog key={`${dialog?.kind ?? 'none'}-${dialog?.blueprintId ?? ''}`} dialog={dialog} initialName={dialog?.kind === 'rename' ? blueprints.find((blueprint) => blueprint.id === dialog.blueprintId)?.name ?? '' : ''} onClose={() => setDialog(null)} onSave={saveName} />
  </div></DisplayContext.Provider>
}


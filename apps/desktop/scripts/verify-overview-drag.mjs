import { mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const executable = path.join(desktop, 'src-tauri', 'target', 'release', 'nodrec-desktop.exe')
const port = Number(process.env.NODREC_CDP_PORT ?? 9331)
const endpoint = `http://127.0.0.1:${port}`
const webviewDataDirectory = path.join(desktop, 'src-tauri', 'target', 'release', `webview2-test-${port}`)
const artifacts = path.resolve(desktop, '..', '..', 'out', 'ui-tests')
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Invalid NODREC_CDP_PORT: ${port}`)
try {
  await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(500) })
  throw new Error(`Refusing to use occupied WebView2 debugging port ${port}.`)
} catch (error) {
  if (error.message.startsWith('Refusing')) throw error
}
const app = spawn(executable, [], {
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: webviewDataDirectory, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  stdio: 'pipe',
  windowsHide: false,
})
let appOutput = ''
app.stdout.setEncoding('utf8').on('data', (chunk) => { appOutput += chunk })
app.stderr.setEncoding('utf8').on('data', (chunk) => { appOutput += chunk })

let socket
try {
  const devtoolsTarget = await waitForTarget()
  socket = new WebSocket(devtoolsTarget.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const pending = new Map()
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  let nextId = 0
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }
  await command('Page.enable')
  await command('Runtime.enable')
  await command('Page.bringToFront')
  await until(async () => (await evaluate(`document.querySelectorAll('.overview-layout-grid .settings-card').length`)) >= 4)
  await until(async () => evaluate(`(() => {
    const grid = document.querySelector('.settings-grid')?.getBoundingClientRect()
    const items = [...document.querySelectorAll('.overview-layout-grid .react-grid-item')].map(item => item.getBoundingClientRect())
    return !!grid && items.length >= 4 && items.every(rect => rect.left >= grid.left - 2 && rect.right <= grid.right + 2)
  })()`))

  if (!await evaluate(`(() => { const button = document.querySelector('button[aria-label="Recording settings details"]'); button?.click(); return !!button })()`)) throw new Error('Recording settings details could not be opened.')
  await until(async () => evaluate(`!!document.querySelector('.card-details-panel .detail-parameter')`))
  const cardDetailsStyles = await evaluate(`(() => { const panel = document.querySelector('.card-details-panel'); const rows = [...panel.querySelectorAll('.detail-parameter')].map(row => { const field = row.querySelector('.parameter-field.inline'); const label = field?.querySelector('.parameter-label'); const wrap = field?.querySelector('.parameter-control-wrap'); const control = wrap?.querySelector('.checkbox-control, .field-control, .readonly-value'); const track = control?.querySelector('.toggle-track'); const pin = row.querySelector(':scope > .pin-button'); const labelRect = label.getBoundingClientRect(); const wrapRect = wrap.getBoundingClientRect(); const controlRect = control.getBoundingClientRect(); const pinRect = pin.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(label); const controlStyle = getComputedStyle(control); const toggleStyle = track && getComputedStyle(control); return { label: label.textContent.trim(), labelWidth: labelRect.width, labelLines: range.getClientRects().length, labelFont: parseFloat(getComputedStyle(label).fontSize), controlFont: parseFloat(controlStyle.fontSize), controlX: wrapRect.left, controlWidth: controlRect.width, controlAfterLabel: controlRect.left >= labelRect.right - 1, pinAfterControl: pinRect.left >= controlRect.right - 1, toggleWidth: track?.getBoundingClientRect().width, toggleBorder: toggleStyle?.borderTopWidth, toggleBackground: toggleStyle?.backgroundColor } }); return { panelBackground: getComputedStyle(panel).backgroundColor, groupFont: parseFloat(getComputedStyle(panel.querySelector('.detail-group-title')).fontSize), rows } })()`)
  const cardControlXs = cardDetailsStyles.rows.map(row => row.controlX)
  const cardDetailsValid = cardDetailsStyles.panelBackground === 'rgb(36, 37, 38)' && cardDetailsStyles.groupFont >= 12 && cardDetailsStyles.rows.length >= 3 && Math.max(...cardControlXs) - Math.min(...cardControlXs) <= 2 && cardDetailsStyles.rows.every(row => row.labelWidth >= 36 && row.labelLines >= 1 && row.labelFont >= 12 && row.controlFont >= 12 && row.controlAfterLabel && row.pinAfterControl && (row.toggleWidth === undefined ? row.controlWidth >= 84 : row.toggleBorder === '0px' && row.toggleBackground === 'rgba(0, 0, 0, 0)'))
  if (!cardDetailsValid) throw new Error(`Card Details parameters should use the shared inline label and field style: ${JSON.stringify(cardDetailsStyles)}`)
  await saveScreenshot(command, 'card-details-parameters.png')
  if (!await evaluate(`(() => { const button = document.querySelector('.card-details-panel button[aria-label="Edit layout"]'); button?.click(); return !!button })()`)) throw new Error('The card layout editor could not be opened.')
  await until(async () => evaluate(`!!document.querySelector('.card-layout-editor .layout-parameter')`))
  const layoutEditorStyles = await evaluate(`(() => { const editor = document.querySelector('.card-layout-editor'); const tiles = [...editor.querySelectorAll('.layout-parameter:not(.drag-preview)')].map(tile => { const header = tile.querySelector('.layout-field-heading'); const label = header?.querySelector('.parameter-label'); const wrap = header?.querySelector('.parameter-control-wrap'); const control = wrap?.querySelector('.checkbox-control, .field-control, .readonly-value'); const track = control?.querySelector('.toggle-track'); const pin = header?.querySelector('.pin-button'); const labelRect = label.getBoundingClientRect(); const controlRect = control.getBoundingClientRect(); const pinRect = pin.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(label); const controlStyle = getComputedStyle(control); const toggleStyle = track && getComputedStyle(control); return { label: label.textContent.trim(), labelWidth: labelRect.width, labelLines: range.getClientRects().length, labelFont: parseFloat(getComputedStyle(label).fontSize), controlFont: parseFloat(controlStyle.fontSize), controlWidth: controlRect.width, controlAfterLabel: controlRect.left >= labelRect.right - 1, pinAfterControl: pinRect.left >= controlRect.right - 1, toggleWidth: track?.getBoundingClientRect().width, toggleBorder: toggleStyle?.borderTopWidth, toggleBackground: toggleStyle?.backgroundColor } }); return { tileBackground: tiles.length ? getComputedStyle(editor.querySelector('.layout-parameter')).backgroundColor : '', tiles } })()`)
  const layoutEditorValid = layoutEditorStyles.tileBackground === 'rgb(43, 44, 48)' && layoutEditorStyles.tiles.length >= 4 && layoutEditorStyles.tiles.every(tile => tile.labelWidth >= 72 && tile.labelLines >= 1 && tile.labelFont >= 12 && tile.controlFont >= 12 && tile.controlAfterLabel && tile.pinAfterControl && (tile.toggleWidth === undefined ? tile.controlWidth >= 84 : tile.toggleBorder === '0px' && tile.toggleBackground === 'rgba(0, 0, 0, 0)'))
  if (!layoutEditorValid) throw new Error(`Card layout parameters should use an inline, readable label and field: ${JSON.stringify(layoutEditorStyles)}`)
  await saveScreenshot(command, 'card-layout-editor-parameters.png')
  await evaluate(`([...document.querySelectorAll('.workspace-tab > button')].find(button => button.textContent.trim() === 'Overview'))?.click()`)
  await until(async () => evaluate(`!!document.querySelector('.overview-layout-grid .settings-card')`))
  await delay(250)

  const before = await evaluate(`(() => ({
    dpr: devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight },
    gridWidth: document.querySelector('.settings-grid')?.getBoundingClientRect().width,
    cards: [...document.querySelectorAll('.overview-layout-grid .settings-card')].map(card => {
      const rect = card.getBoundingClientRect()
      return { name: card.querySelector('.settings-card-head h2')?.textContent, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
    })
  }))()`)
  const source = before.cards.find((card) => card.name === 'Audio')
  const targetCard = before.cards.find((card) => card.name === 'Recording settings')
  if (!source || !targetCard) throw new Error('Expected Audio and Recording settings cards were not found.')
  const longLabel = 'Select the preferred display surface and source when several monitor endpoints are present'
  const longLabelProbe = await evaluate(`(() => {
    const card = [...document.querySelectorAll('.overview-layout-grid .settings-card')].find(item => item.querySelector('.settings-card-head h2')?.textContent === 'Recording settings')
    const field = card?.querySelector('.parameter-field.inline')
    const label = field?.querySelector('.parameter-label')
    const control = field?.querySelector('.parameter-control-wrap > .field-control, .parameter-control-wrap > .readonly-value')
    if (!card || !field || !label || !control) return null
    const rect = element => { const value = element.getBoundingClientRect(); return { x: value.x, right: value.right, width: value.width, height: value.height } }
    const before = { label: rect(label), control: rect(control) }
    const original = label.textContent
    label.textContent = ${JSON.stringify(longLabel)}
    const after = {
      label: rect(label),
      control: rect(control),
      field: rect(field),
      fullText: label.textContent,
      horizontalOverflow: label.scrollWidth > label.clientWidth + 1,
      verticalOverflow: label.scrollHeight > label.clientHeight + 1,
      whiteSpace: getComputedStyle(label).whiteSpace,
      cardClipped: card.scrollHeight > card.clientHeight + 1,
    }
    label.textContent = original
    return { before, after }
  })()`)
  if (!longLabelProbe || longLabelProbe.after.fullText !== longLabel || longLabelProbe.after.horizontalOverflow || longLabelProbe.after.verticalOverflow || longLabelProbe.after.whiteSpace !== 'normal' || longLabelProbe.after.control.width < 83 || longLabelProbe.after.control.x < longLabelProbe.after.label.right + 8 || longLabelProbe.after.control.right > longLabelProbe.after.field.right + 1 || longLabelProbe.after.control.width >= longLabelProbe.before.control.width || longLabelProbe.after.cardClipped) throw new Error(`Long parameter labels must wrap fully while shrinking the editor without clipping the card: ${JSON.stringify(longLabelProbe)}`)
  const resizeProbe = await evaluate(`(() => {
    const card = [...document.querySelectorAll('.overview-layout-grid .settings-card')].find(card => card.querySelector('.settings-card-head h2')?.textContent === 'Recording settings')
    const gridItem = card?.parentElement
    const handle = gridItem?.querySelector('.react-resizable-handle-e')
    const cardRect = card.getBoundingClientRect(), itemRect = gridItem.getBoundingClientRect(), resizeRect = handle.getBoundingClientRect()
    const neighbor = [...gridItem.parentElement.children].find(item => item !== gridItem && Math.abs(item.getBoundingClientRect().top - itemRect.top) < 2 && item.getBoundingClientRect().left > itemRect.right)
    const neighborRect = neighbor?.getBoundingClientRect()
    const neighborHandleRect = neighbor?.querySelector('.react-resizable-handle-w')?.getBoundingClientRect()
    const grip = getComputedStyle(handle, '::after')
    return {
      center: { x: cardRect.x + cardRect.width / 2, y: cardRect.y + cardRect.height / 2 },
      edge: { x: resizeRect.x + resizeRect.width / 2, y: resizeRect.y + resizeRect.height / 2 },
      handleWidth: resizeRect.width,
      handleHeight: resizeRect.height,
      gripHeight: grip.height,
      gap: neighborRect ? neighborRect.left - itemRect.right : null,
      eastEdgeError: Math.abs((resizeRect.left + resizeRect.width / 2) - itemRect.right),
      westEdgeError: neighborHandleRect && neighborRect ? Math.abs((neighborHandleRect.left + neighborHandleRect.width / 2) - neighborRect.left) : null,
      gripCenterSeparation: neighborHandleRect ? Math.abs((resizeRect.left + resizeRect.width / 2) - (neighborHandleRect.left + neighborHandleRect.width / 2)) : null,
      handleSeparation: neighborHandleRect ? neighborHandleRect.left - resizeRect.right : null,
      hitAreasOverlap: neighborHandleRect ? resizeRect.right > neighborHandleRect.left : true,
      drag: (() => { const rect = [...document.querySelectorAll('.overview-layout-grid .settings-card')].find(item => item.querySelector('.settings-card-head h2')?.textContent === 'Audio').querySelector('.overview-card-drag-handle').getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } })(),
      handleFound: !!handle,
      buttonBorder: getComputedStyle(card.querySelector('.overview-card-drag-handle')).borderTopWidth,
      dragIconTransform: getComputedStyle(card.querySelector('.overview-card-drag-handle svg')).transform,
      resizeTransform: getComputedStyle(handle).transform,
      resizeBackgroundImage: getComputedStyle(handle).backgroundImage,
      resizeGripBorders: (() => { const style = getComputedStyle(handle, '::after'); return [style.borderRightWidth, style.borderBottomWidth] })(),
    }
  })()`)
  if (!resizeProbe.handleFound || resizeProbe.handleWidth < 12 || resizeProbe.handleHeight < 80 || Number.parseFloat(resizeProbe.gripHeight) < 50 || resizeProbe.gap === null || resizeProbe.eastEdgeError > 1 || resizeProbe.westEdgeError > 1 || resizeProbe.gripCenterSeparation < 10 || resizeProbe.handleSeparation < 1 || resizeProbe.hitAreasOverlap) throw new Error(`Overview resize handles must sit on separate card edges without overlapping: ${JSON.stringify(resizeProbe)}`)
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...resizeProbe.center })
  const handleAtCardCenter = await evaluate(`getComputedStyle(document.querySelector('.overview-layout-grid .react-resizable-handle-e')).opacity`)
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...resizeProbe.edge })
  const handleAtEdge = await evaluate(`(() => { const handle = document.querySelector('.overview-layout-grid .react-resizable-handle:hover'); return handle && getComputedStyle(handle).opacity })()`)
  await saveScreenshot(command, 'overview-resize-handle-hover.png')
  const points = await evaluate(`(() => {
    const source = [...document.querySelectorAll('.overview-layout-grid .settings-card')].find(card => card.querySelector('.settings-card-head h2')?.textContent === 'Audio')
    const target = [...document.querySelectorAll('.overview-layout-grid .settings-card')].find(card => card.querySelector('.settings-card-head h2')?.textContent === 'Recording settings')
    const b = target.getBoundingClientRect()
    return { start: ${JSON.stringify(resizeProbe.drag)}, end: { x: b.right - 12, y: b.y + b.height / 2 } }
  })()`)
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.start })
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.start, button: 'left', buttons: 1, clickCount: 1 })
  for (let step = 1; step <= 12; step++) {
    const t = step / 12
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.start.x + (points.end.x - points.start.x) * t, y: points.start.y + (points.end.y - points.start.y) * t, button: 'left', buttons: 1 })
    await delay(35)
  }
  await delay(250)
  const during = await evaluate(`(() => {
    const preview = document.querySelector('.overview-drag-overlay .settings-card')
    const target = document.querySelector('.overview-layout-grid .settings-card.drop-target')
    const rect = preview?.getBoundingClientRect()
    return { preview: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, targetFeedback: !!target, sideFeedback: !!target?.classList.contains('drop-target-right'), hint: preview?.querySelector('.overview-drag-hint')?.textContent }
  })()`)
  await saveScreenshot(command, 'overview-drag-during.png')
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.end, button: 'left', buttons: 0, clickCount: 1 })
  await delay(900)
  const after = await evaluate(`(() => [...document.querySelectorAll('.overview-layout-grid .settings-card')].map(card => {
    const rect = card.getBoundingClientRect()
    return { name: card.querySelector('.settings-card-head h2')?.textContent, x: rect.x, y: rect.y, width: rect.width }
  }))()`)
  await saveScreenshot(command, 'overview-drag-after.png')
  const moved = after.find((card) => card.name === 'Audio')
  const target = after.find((card) => card.name === 'Recording settings')
  const firstRow = after.filter((card) => Math.abs(card.y - target.y) < 8 && ['Audio', 'Recording settings', 'Video'].includes(card.name))
  const rowWidthWithGaps = firstRow.reduce((width, card) => width + card.width, 0) + 14 * Math.max(0, firstRow.length - 1)
  const fillsGrid = Math.abs(rowWidthWithGaps - before.gridWidth) < 12
  const previewContainsPointer = during.preview && points.end.x >= during.preview.x && points.end.x <= during.preview.x + during.preview.width && points.end.y >= during.preview.y && points.end.y <= during.preview.y + during.preview.height
  const horizontalVerified = handleAtCardCenter === '0' && handleAtEdge === '1' && resizeProbe.buttonBorder === '0px' && resizeProbe.dragIconTransform !== 'none' && resizeProbe.resizeTransform === 'none' && resizeProbe.resizeBackgroundImage === 'none' && resizeProbe.resizeGripBorders.every((width) => width === '0px') && during.preview && previewContainsPointer && during.targetFeedback && during.sideFeedback && during.hint?.includes('right') && moved && target && firstRow.length === 3 && fillsGrid && moved.x > target.x
  if (!horizontalVerified) throw new Error('Overview drag did not satisfy local-handle visibility, handle styling, pointer preview, side feedback and three-card auto-sizing checks.')

  const verticalStart = await evaluate(`(() => { const card = [...document.querySelectorAll('.overview-layout-grid .settings-card')].find(item => item.querySelector('.settings-card-head h2')?.textContent === 'Audio'); const rect = card.querySelector('.overview-card-drag-handle').getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } })()`)
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...verticalStart })
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...verticalStart, button: 'left', buttons: 1, clickCount: 1 })
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: verticalStart.x + 7, y: verticalStart.y + 5, button: 'left', buttons: 1 })
  await until(async () => evaluate(`document.querySelector('.overview-end-drop-zone')?.classList.contains('active')`))
  const endPoint = await evaluate(`(() => { const rect = document.querySelector('.overview-end-drop-zone').getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } })()`)
  for (let step = 1; step <= 12; step++) {
    const t = step / 12
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: verticalStart.x + 7 + (endPoint.x - verticalStart.x - 7) * t, y: verticalStart.y + 5 + (endPoint.y - verticalStart.y - 5) * t, button: 'left', buttons: 1 })
    await delay(35)
  }
  await delay(250)
  const endDuring = await evaluate(`(() => {
    const preview = document.querySelector('.overview-drag-overlay .settings-card')
    const rect = preview?.getBoundingClientRect()
    const zone = document.querySelector('.overview-end-drop-zone')
    return { hint: preview?.querySelector('.overview-drag-hint')?.textContent, endFeedback: zone.classList.contains('over'), preview: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
  })()`)
  await saveScreenshot(command, 'overview-drag-end-during.png')
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...endPoint, button: 'left', buttons: 0, clickCount: 1 })
  await delay(900)
  const afterEnd = await evaluate(`(() => [...document.querySelectorAll('.overview-layout-grid .settings-card')].map(card => { const rect = card.getBoundingClientRect(); return { name: card.querySelector('.settings-card-head h2')?.textContent, x: rect.x, y: rect.y, width: rect.width } }))()`)
  await saveScreenshot(command, 'overview-drag-end-after.png')
  const movedToEnd = afterEnd.find((card) => card.name === 'Audio')
  const lastOtherY = Math.max(...afterEnd.filter((card) => card.name !== 'Audio').map((card) => card.y))
  const endPreviewContainsPointer = endDuring.preview && endPoint.x >= endDuring.preview.x && endPoint.x <= endDuring.preview.x + endDuring.preview.width && endPoint.y >= endDuring.preview.y && endPoint.y <= endDuring.preview.y + endDuring.preview.height
  const verticalVerified = endDuring.hint === 'Move to end' && endDuring.endFeedback && endPreviewContainsPointer && movedToEnd && movedToEnd.y > lastOtherY
  const abovePoints = await evaluate(`(() => {
    const output = [...document.querySelectorAll('.overview-layout-grid .settings-card')].find(card => card.querySelector('.settings-card-head h2')?.textContent === 'Output')
    const target = [...document.querySelectorAll('.overview-layout-grid .settings-card')].find(card => card.querySelector('.settings-card-head h2')?.textContent === 'Recording settings')
    const start = output.querySelector('.overview-card-drag-handle').getBoundingClientRect(), rect = target.getBoundingClientRect()
    return { start: { x: start.x + start.width / 2, y: start.y + start.height / 2 }, end: { x: rect.x + rect.width / 2, y: rect.y - 8 } }
  })()`)
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...abovePoints.start })
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...abovePoints.start, button: 'left', buttons: 1, clickCount: 1 })
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: abovePoints.start.x + 7, y: abovePoints.start.y + 5, button: 'left', buttons: 1 })
  for (let step = 1; step <= 12; step++) {
    const t = step / 12
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: abovePoints.start.x + 7 + (abovePoints.end.x - abovePoints.start.x - 7) * t, y: abovePoints.start.y + 5 + (abovePoints.end.y - abovePoints.start.y - 5) * t, button: 'left', buttons: 1 })
    await delay(35)
  }
  await delay(250)
  const aboveDuring = await evaluate(`(() => {
    const preview = document.querySelector('.overview-drag-overlay .settings-card')
    const target = [...document.querySelectorAll('.overview-layout-grid .settings-card')].find(card => card.querySelector('.settings-card-head h2')?.textContent === 'Recording settings')
    return { hint: preview?.querySelector('.overview-drag-hint')?.textContent, targetFeedback: target?.classList.contains('drop-target-above'), preview: !!preview }
  })()`)
  await saveScreenshot(command, 'overview-drag-insert-above-during.png')
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...abovePoints.end, button: 'left', buttons: 0, clickCount: 1 })
  await delay(900)
  const afterAbove = await evaluate(`(() => [...document.querySelectorAll('.overview-layout-grid .settings-card')].map(card => { const rect = card.getBoundingClientRect(); return { name: card.querySelector('.settings-card-head h2')?.textContent, x: rect.x, y: rect.y, width: rect.width } }))()`)
  await saveScreenshot(command, 'overview-drag-insert-above-after.png')
  const movedAbove = afterAbove.find((card) => card.name === 'Output')
  const recordingAfterAbove = afterAbove.find((card) => card.name === 'Recording settings')
  const aboveVerified = aboveDuring.hint === 'Insert above of Recording settings' && aboveDuring.targetFeedback && aboveDuring.preview && movedAbove && recordingAfterAbove && movedAbove.y < recordingAfterAbove.y
  const belowPoints = await evaluate(`(() => {
    const output = [...document.querySelectorAll('.overview-layout-grid .settings-card')].find(card => card.querySelector('.settings-card-head h2')?.textContent === 'Output')
    const target = [...document.querySelectorAll('.overview-layout-grid .settings-card')].find(card => card.querySelector('.settings-card-head h2')?.textContent === 'Recording settings')
    const start = output.querySelector('.overview-card-drag-handle').getBoundingClientRect(), rect = target.getBoundingClientRect()
    return { start: { x: start.x + start.width / 2, y: start.y + start.height / 2 }, end: { x: rect.x + rect.width / 2, y: rect.bottom - 8 } }
  })()`)
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...belowPoints.start })
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...belowPoints.start, button: 'left', buttons: 1, clickCount: 1 })
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: belowPoints.start.x + 7, y: belowPoints.start.y + 5, button: 'left', buttons: 1 })
  for (let step = 1; step <= 12; step++) {
    const t = step / 12
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: belowPoints.start.x + 7 + (belowPoints.end.x - belowPoints.start.x - 7) * t, y: belowPoints.start.y + 5 + (belowPoints.end.y - belowPoints.start.y - 5) * t, button: 'left', buttons: 1 })
    await delay(35)
  }
  await delay(250)
  const belowDuring = await evaluate(`(() => {
    const preview = document.querySelector('.overview-drag-overlay .settings-card')
    const target = [...document.querySelectorAll('.overview-layout-grid .settings-card')].find(card => card.querySelector('.settings-card-head h2')?.textContent === 'Recording settings')
    return { hint: preview?.querySelector('.overview-drag-hint')?.textContent, targetFeedback: target?.classList.contains('drop-target-below'), preview: !!preview }
  })()`)
  await saveScreenshot(command, 'overview-drag-insert-below-during.png')
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...belowPoints.end, button: 'left', buttons: 0, clickCount: 1 })
  await delay(900)
  const afterBelow = await evaluate(`(() => [...document.querySelectorAll('.overview-layout-grid .settings-card')].map(card => { const rect = card.getBoundingClientRect(); return { name: card.querySelector('.settings-card-head h2')?.textContent, x: rect.x, y: rect.y, width: rect.width } }))()`)
  await saveScreenshot(command, 'overview-drag-insert-below-after.png')
  const outputAfterBelow = afterBelow.find((card) => card.name === 'Output')
  const recordingAfterBelow = afterBelow.find((card) => card.name === 'Recording settings')
  const audioAfterBelow = afterBelow.find((card) => card.name === 'Audio')
  const belowVerified = belowDuring.hint === 'Insert below of Recording settings' && belowDuring.targetFeedback && belowDuring.preview && outputAfterBelow && recordingAfterBelow && audioAfterBelow && outputAfterBelow.y > recordingAfterBelow.y && audioAfterBelow.y > outputAfterBelow.y
  const resizePoints = await evaluate(`(() => {
    const item = [...document.querySelectorAll('.overview-layout-grid .react-grid-item')].find(item => [...item.querySelectorAll('.settings-card-head h2')].some(title => title.textContent === 'Recording settings'))
    const handle = item?.querySelector('.react-resizable-handle-e')
    const rect = handle.getBoundingClientRect(), itemRect = item.getBoundingClientRect()
    return {
      start: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      cards: [...document.querySelectorAll('.overview-layout-grid .settings-card')].map(card => ({ name: card.querySelector('.settings-card-head h2')?.textContent, width: card.getBoundingClientRect().width })),
    }
  })()`)
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...resizePoints.start })
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...resizePoints.start, button: 'left', buttons: 1, clickCount: 1 })
  for (let step = 1; step <= 8; step++) {
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: resizePoints.start.x + step * 8, y: resizePoints.start.y, button: 'left', buttons: 1 })
    await delay(35)
  }
  const resizing = await evaluate(`(() => {
    const placeholder = document.querySelector('.overview-layout-grid .react-grid-item.react-grid-placeholder')
    return { placeholder: !!placeholder, background: placeholder && getComputedStyle(placeholder).backgroundColor, opacity: placeholder && getComputedStyle(placeholder).opacity }
  })()`)
  await saveScreenshot(command, 'overview-resize-during.png')
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: resizePoints.start.x + 64, y: resizePoints.start.y, button: 'left', buttons: 0, clickCount: 1 })
  await delay(700)
  const resizedCards = await evaluate(`(() => [...document.querySelectorAll('.overview-layout-grid .settings-card')].map(card => ({ name: card.querySelector('.settings-card-head h2')?.textContent, width: card.getBoundingClientRect().width })))()`)
  const horizontalOverflow = await evaluate(`(() => { const page = document.querySelector('.overview-page'); return { scrollWidth: page.scrollWidth, clientWidth: page.clientWidth, overflow: page.scrollWidth > page.clientWidth + 2 } })()`)
  await saveScreenshot(command, 'overview-resize-after.png')
  const resizeChanged = resizePoints.cards.some((card) => Math.abs((resizedCards.find((item) => item.name === card.name)?.width ?? card.width) - card.width) > 10)
  const resizeVerified = resizing.placeholder && resizing.background.includes('244, 143, 177') && resizing.opacity === '1' && resizeChanged && !horizontalOverflow.overflow
  const verified = cardDetailsValid && layoutEditorValid && horizontalVerified && verticalVerified && aboveVerified && belowVerified && resizeVerified
  console.log(JSON.stringify({ target: { title: devtoolsTarget.title, url: devtoolsTarget.url }, cardDetailsStyles, cardDetailsValid, layoutEditorStyles, layoutEditorValid, before, longLabelProbe, resizeProbe, handleAtCardCenter, handleAtEdge, points, during, after, firstRow, rowWidthWithGaps, fillsGrid, horizontalVerified, verticalStart, endPoint, endDuring, afterEnd, verticalVerified, abovePoints, aboveDuring, afterAbove, aboveVerified, belowPoints, belowDuring, afterBelow, belowVerified, resizePoints, resizing, resizedCards, resizeChanged, horizontalOverflow, resizeVerified, verified, screenshots: artifacts }, null, 2))
  if (!verified) throw new Error('Overview drag did not complete horizontal grouping, end drop, vertical above/below insertion, and resize-handle style checks.')
} finally {
  socket?.close()
  if (app.exitCode === null) {
    app.kill()
    await Promise.race([once(app, 'exit'), delay(5000)])
  }
}

async function waitForTarget() {
  const endAt = Date.now() + 45000
  while (Date.now() < endAt) {
    if (app.exitCode !== null) throw new Error(`Nodrec exited before WebView2 debugging was ready (${app.exitCode}).\n${appOutput}`)
    try {
      const response = await fetch(`${endpoint}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const target = targets.find((item) => item.type === 'page' && item.title === 'Nodrec' && item.url.startsWith('http://tauri.localhost') && item.webSocketDebuggerUrl)
        if (target) return target
      }
    } catch { /* WebView2 is still starting. */ }
    await delay(250)
  }
  throw new Error(`No WebView2 DevTools target at ${endpoint}; check the WebView2 runtime and port availability.`)
}

async function until(check) {
  const endAt = Date.now() + 15000
  while (Date.now() < endAt) {
    if (await check()) return
    await delay(100)
  }
  throw new Error('Overview cards did not finish rendering.')
}

async function saveScreenshot(command, name) {
  await mkdir(artifacts, { recursive: true })
  const result = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(path.join(artifacts, name), Buffer.from(result.data, 'base64'))
}

export type Rect = { x: number; y: number; width: number; height: number }
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'
export const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
export function selectionRect(start: { x: number; y: number }, end: { x: number; y: number }, bounds: Rect): Rect {
  const x = Math.max(0, Math.min(end.x, bounds.width)), y = Math.max(0, Math.min(end.y, bounds.height))
  return { x: Math.min(start.x,x), y: Math.min(start.y,y), width: Math.abs(x-start.x), height: Math.abs(y-start.y) }
}
export function handlePoint(r: Rect, h: Handle) {
  return { x: r.x + (h.includes('w') ? 0 : h.includes('e') ? r.width : r.width / 2), y: r.y + (h.includes('n') ? 0 : h.includes('s') ? r.height : r.height / 2) }
}
export function hitRegion(r: Rect, x: number, y: number, scale: number): Handle | null {
  const near = handles.map(h => ({ h, p: handlePoint(r, h) })).filter(({ p }) => Math.abs(p.x - x) <= 6 * scale && Math.abs(p.y - y) <= 6 * scale)
  near.sort((a, b) => Math.hypot(a.p.x - x, a.p.y - y) - Math.hypot(b.p.x - x, b.p.y - y))
  if (near[0]) return near[0].h
  const band = 4 * scale
  if (x < r.x - band || y < r.y - band || x > r.x + r.width + band || y > r.y + r.height + band) return null
  return Math.min(Math.abs(x - r.x), Math.abs(x - r.x - r.width), Math.abs(y - r.y), Math.abs(y - r.y - r.height)) <= band ? 'move' : null
}
export function transformRegion(r: Rect, h: Handle, dx: number, dy: number, bounds: Rect, ratio = 0): Rect {
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
  if (h === 'move') return { ...r, x: clamp(Math.round(r.x + dx), 0, bounds.width - r.width), y: clamp(Math.round(r.y + dy), 0, bounds.height - r.height) }
  let width = clamp(Math.round(r.width + (h.includes('w') ? -dx : h.includes('e') ? dx : 0)), 16, h.includes('w') ? r.x + r.width : bounds.width - r.x)
  let height = clamp(Math.round(r.height + (h.includes('n') ? -dy : h.includes('s') ? dy : 0)), 16, h.includes('n') ? r.y + r.height : bounds.height - r.y)
  if (ratio) {
    if (h === 'n' || h === 's' || Math.abs(dy) > Math.abs(dx)) width = height * ratio
    else height = width / ratio
    const maxW = h.includes('w') ? r.x + r.width : h.includes('e') ? bounds.width - r.x : 2 * Math.min(r.x + r.width / 2, bounds.width - r.x - r.width / 2)
    const maxH = h.includes('n') ? r.y + r.height : h.includes('s') ? bounds.height - r.y : 2 * Math.min(r.y + r.height / 2, bounds.height - r.y - r.height / 2)
    width = clamp(width, Math.max(16, 16 * ratio), Math.min(maxW, maxH * ratio)); height = width / ratio
  }
  width = Math.round(width); height = Math.round(height)
  return { x: Math.round(h.includes('w') ? r.x + r.width - width : !h.includes('e') && ratio ? r.x + (r.width - width) / 2 : r.x), y: Math.round(h.includes('n') ? r.y + r.height - height : !h.includes('s') && ratio ? r.y + (r.height - height) / 2 : r.y), width, height }
}
export type Dock = { x: number; y: number; side: number }
export function dockRegion(r: Rect, work: Rect, width: number, height: number, gap: number, previous?: number): Dock {
  const positions = [r.y - gap - height, r.y + r.height + gap, r.y + gap, r.y + r.height - gap - height]
  const fits = (i: number, margin: number) => positions[i]! >= work.y + margin && positions[i]! + height <= work.y + work.height - margin
  const side = previous !== undefined && fits(previous, gap) ? previous : positions.findIndex((_, i) => fits(i, gap * 2))
  const y = positions[side < 0 ? 2 : side]!
  return { side: side < 0 ? 2 : side, x: Math.max(work.x + gap, Math.min(r.x + (r.width - width) / 2, work.x + work.width - width - gap)), y: Math.max(work.y + gap, Math.min(y, work.y + work.height - height - gap)) }
}
export function elapsedText(ms: number) {
  const seconds = Math.floor(ms / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(v => String(v).padStart(2, '0')).join(':')
}

export function expandToolbar(dock: Dock, work: Rect, baseHeight: number, requestedHeight: number, gap: number) {
  const below = Math.max(0, work.y + work.height - gap - dock.y - baseHeight)
  const above = Math.max(0, dock.y - work.y - gap)
  const extra = Math.max(0, requestedHeight - baseHeight)
  const up = dock.side === 0 ? above > 0 : dock.side === 1 ? below === 0 : below < extra && above > below
  const extension = Math.min(extra, up ? above : below)
  return { y: dock.y - (up ? extension : 0), height: baseHeight + extension, offset: up ? extension : 0 }
}

export function editRegionField(r: Rect, bounds: Rect, field: string, value: number, unit: string, ratio = 0): Rect {
  const vertical = field.endsWith('Y') || field === 'height'
  const v = value * (unit === '%' ? (vertical ? bounds.height : bounds.width) / 100 : 1)
  const next = { ...r }
  if (field === 'centerX') next.x = Math.round(v - r.width / 2)
  if (field === 'centerY') next.y = Math.round(v - r.height / 2)
  if (field === 'width') { next.width = Math.round(v); if (ratio) next.height = Math.round(v / ratio) }
  if (field === 'height') { next.height = Math.round(v); if (ratio) next.width = Math.round(v * ratio) }
  if (field === 'minX') { next.x = Math.round(v); next.width = r.x + r.width - next.x }
  if (field === 'minY') { next.y = Math.round(v); next.height = r.y + r.height - next.y }
  if (field === 'maxX') next.width = Math.round(v) - r.x
  if (field === 'maxY') next.height = Math.round(v) - r.y
  return next
}

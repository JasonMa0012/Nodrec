import type { Edge } from '@xyflow/react'

export type RoutePoint = { x: number; y: number }

export function ribbonOffsets(routes: { id: string; start: RoutePoint; end: RoutePoint }[]): Map<string, number> {
  const occupied: { x: number; top: number; bottom: number }[] = []
  const offsets = new Map<string, number>()
  for (const { id, start, end } of [...routes].sort((a, b) => a.id.localeCompare(b.id))) {
    const middleX = (start.x + end.x) / 2
    const top = Math.min(start.y, end.y) - 6
    const bottom = Math.max(start.y, end.y) + 6
    let lane = 0
    let offset = 0
    while (occupied.some(other => Math.abs(other.x - middleX - offset) < 10 && other.top < bottom && other.bottom > top)) {
      lane++
      offset = Math.ceil(lane / 2) * 12 * (lane % 2 ? 1 : -1)
    }
    occupied.push({ x: middleX + offset, top, bottom })
    offsets.set(id, offset)
  }
  return offsets
}

export function roundedPath(start: RoutePoint, end: RoutePoint, offset = 0): string {
  const middleX = (start.x + end.x) / 2 + offset
  const middleY = (start.y === end.y ? start.y + 48 : (start.y + end.y) / 2) + offset
  const corners = start.y === end.y && offset !== 0 && end.x > start.x
    ? [start, { x: start.x + (end.x - start.x) / 4, y: start.y }, { x: start.x + (end.x - start.x) / 4, y: start.y + offset }, { x: end.x - (end.x - start.x) / 4, y: start.y + offset }, { x: end.x - (end.x - start.x) / 4, y: end.y }, end]
    : end.x >= start.x
    ? [start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end]
    : [start, { x: start.x + 24 + Math.abs(offset), y: start.y }, { x: start.x + 24 + Math.abs(offset), y: middleY }, { x: end.x - 24 - Math.abs(offset), y: middleY }, { x: end.x - 24 - Math.abs(offset), y: end.y }, end]
  const orthogonal = corners.filter((point, index) => index === 0 || point.x !== corners[index - 1]!.x || point.y !== corners[index - 1]!.y)
  const beveled = orthogonal.flatMap((corner, index) => {
    const previous = orthogonal[index - 1]
    const next = orthogonal[index + 1]
    if (!previous || !next) return [corner]
    const before = Math.hypot(corner.x - previous.x, corner.y - previous.y)
    const after = Math.hypot(next.x - corner.x, next.y - corner.y)
    const bevel = Math.min(before, after) / 2
    return [
      { x: corner.x + (previous.x - corner.x) / before * bevel, y: corner.y + (previous.y - corner.y) / before * bevel },
      { x: corner.x + (next.x - corner.x) / after * bevel, y: corner.y + (next.y - corner.y) / after * bevel },
    ]
  })
  const points = beveled.filter((point, index) => index === 0 || point.x !== beveled[index - 1]!.x || point.y !== beveled[index - 1]!.y)
  const path = [`M ${start.x} ${start.y}`]
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1]!
    const corner = points[i]!
    const next = points[i + 1]!
    if ((corner.x - previous.x) * (next.y - corner.y) === (corner.y - previous.y) * (next.x - corner.x)) {
      path.push(`L ${corner.x} ${corner.y}`)
      continue
    }
    const before = Math.hypot(corner.x - previous.x, corner.y - previous.y)
    const after = Math.hypot(next.x - corner.x, next.y - corner.y)
    const radius = Math.min(8, before / 4, after / 4)
    path.push(`L ${corner.x + (previous.x - corner.x) / before * radius} ${corner.y + (previous.y - corner.y) / before * radius}`)
    path.push(`Q ${corner.x} ${corner.y} ${corner.x + (next.x - corner.x) / after * radius} ${corner.y + (next.y - corner.y) / after * radius}`)
  }
  path.push(`L ${end.x} ${end.y}`)
  return path.join(' ')
}

export function connectedNodeIds(selected: string[], edges: Pick<Edge, 'source' | 'target'>[]): Set<string> {
  const neighbors = new Map<string, string[]>()
  for (const { source, target } of edges) {
    neighbors.set(source, [...(neighbors.get(source) ?? []), target])
    neighbors.set(target, [...(neighbors.get(target) ?? []), source])
  }
  const connected = new Set(selected)
  const pending = [...connected]
  for (let i = 0; i < pending.length; i++) {
    for (const id of neighbors.get(pending[i]!) ?? []) {
      if (!connected.has(id)) { connected.add(id); pending.push(id) }
    }
  }
  return connected
}

export function routePoints(data: Edge['data']): RoutePoint[] {
  return Array.isArray(data?.routePoints) ? data.routePoints.filter((point): point is RoutePoint => point && typeof point === 'object' && Number.isFinite(point.x) && Number.isFinite(point.y)) : []
}

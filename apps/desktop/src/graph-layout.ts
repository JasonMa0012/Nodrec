import type { Edge } from '@xyflow/react'
import type { BlueprintNode, NodePortDefinition } from './model'
import { connectedNodeIds, type RoutePoint } from './graph-interactions.ts'

type LayoutNode = Pick<BlueprintNode, 'id' | 'position'> & {
  data: Pick<BlueprintNode['data'], 'kind'> & { inputs: NodePortDefinition[]; outputs: NodePortDefinition[] }
}
export type NodeGeometry = { width: number; height: number; handles: Record<string, RoutePoint> }
type Rect = RoutePoint & { width: number; height: number }
type Link = { source: string; target: string; sourceHandle: string; targetHandle: string; flow: boolean }
type Group = { root: string; members: string[]; positions: Map<string, RoutePoint>; bounds: Rect }

const mediaTypes = new Set(['video_frames', 'audio_samples', 'encoded_video'])
const byId = (a: string, b: string) => a.localeCompare(b)
const intersects = (a: Rect, b: Rect, gap: number) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y

function bounds(ids: string[], positions: ReadonlyMap<string, RoutePoint>, geometry: ReadonlyMap<string, NodeGeometry>): Rect {
  const x = Math.min(...ids.map(id => positions.get(id)!.x))
  const y = Math.min(...ids.map(id => positions.get(id)!.y))
  return { x, y, width: Math.max(...ids.map(id => positions.get(id)!.x + geometry.get(id)!.width)) - x, height: Math.max(...ids.map(id => positions.get(id)!.y + geometry.get(id)!.height)) - y }
}

// Ignore DFS back edges only for placement; editing an unfinished cycle must not lose links or loop.
function orderedGraph(ids: string[], links: Link[]) {
  const visited = new Set<string>()
  const active = new Set<string>()
  const order: string[] = []
  const forward: Link[] = []
  const outgoing = new Map(ids.map(id => [id, links.filter(link => link.source === id)]))
  const visit = (id: string) => {
    if (visited.has(id)) return
    visited.add(id); active.add(id)
    for (const link of [...(outgoing.get(id) ?? [])].reverse()) {
      if (active.has(link.target)) continue
      forward.push(link)
      visit(link.target)
    }
    active.delete(id); order.push(id)
  }
  ids.forEach(visit)
  return { order: order.reverse(), links: links.filter(link => forward.includes(link)) }
}

function eventOwners(nodes: LayoutNode[], links: Link[], execution: Set<string>) {
  const owners = new Map(nodes.map(node => [node.id, new Set<string>()]))
  const events = new Set(nodes.filter(node => node.data.kind === 'event').map(node => node.id))
  for (const event of events) {
    const queue = [event]
    owners.get(event)!.add(event)
    for (let i = 0; i < queue.length; i++) {
      for (const link of links.filter(link => link.flow && link.source === queue[i])) {
        const target = owners.get(link.target)!
        if (events.has(link.target) || target.has(event)) continue
        target.add(event); queue.push(link.target)
      }
    }
  }
  const dataLinks = links.filter(link => !link.flow)
  const inherit = (target: Set<string>, source: Set<string>) => {
    const size = target.size
    source.forEach(owner => target.add(owner))
    return size !== target.size
  }
  // A value belongs to the Events of its eventual execution consumers, not every sibling consumer.
  let changed = true
  while (changed) {
    changed = false
    for (const link of dataLinks) {
      if (!execution.has(link.source)) changed = inherit(owners.get(link.source)!, owners.get(link.target)!) || changed
    }
  }
  // Terminal data/media outputs can have a producer Event without an execution consumer.
  const producers = new Map(nodes.map(node => [node.id, new Set(execution.has(node.id) ? owners.get(node.id) : [])]))
  changed = true
  while (changed) {
    changed = false
    for (const link of dataLinks) {
      if (!execution.has(link.target)) changed = inherit(producers.get(link.target)!, producers.get(link.source)!) || changed
    }
  }
  for (const node of nodes) if (!owners.get(node.id)!.size) inherit(owners.get(node.id)!, producers.get(node.id)!)
  return owners
}

export function formatGraph(nodes: LayoutNode[], edges: Edge[], geometry: ReadonlyMap<string, NodeGeometry>, selectedIds: string[], onlySelected: boolean) {
  const nodeMap = new Map(nodes.map(node => [node.id, node]))
  const selected = [...new Set(selectedIds)].filter(id => nodeMap.has(id)).sort(byId)
  const positions = new Map<string, RoutePoint>()
  const resetRouteEdgeIds = new Set<string>()
  if (!selected.length) return { positions, resetRouteEdgeIds }
  const execution = new Set(nodes.filter(node => [...node.data.inputs, ...node.data.outputs].some(port => port.valueType === 'flow')).map(node => node.id))
  const main = new Set(nodes.filter(node => execution.has(node.id) || [...node.data.inputs, ...node.data.outputs].some(port => mediaTypes.has(port.valueType))).map(node => node.id))
  const links: Link[] = edges.flatMap(edge => {
    const source = nodeMap.get(edge.source)?.data.outputs.find(port => `out:${port.id}` === edge.sourceHandle)
    const target = nodeMap.get(edge.target)?.data.inputs.find(port => `in:${port.id}` === edge.targetHandle)
    return source && target ? [{ source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle!, targetHandle: edge.targetHandle!, flow: source.valueType === 'flow' && target.valueType === 'flow' }] : []
  }).sort((a, b) => {
    const ports = nodeMap.get(a.source)!.data.outputs
    return byId(a.source, b.source) || ports.findIndex(port => `out:${port.id}` === a.sourceHandle) - ports.findIndex(port => `out:${port.id}` === b.sourceHandle) || byId(a.target, b.target) || byId(a.targetHandle, b.targetHandle)
  })
  const owners = eventOwners(nodes, links, execution)
  const scope = new Set<string>()
  for (const id of selected) {
    if (onlySelected) { scope.add(id); continue }
    const events = owners.get(id)!
    if (events.size === 1) {
      const event = [...events][0]!
      for (const [other, owned] of owners) if (owned.size === 1 && owned.has(event)) scope.add(other)
    } else {
      const allowed = (other: string) => events.size > 1
        ? !execution.has(other) && owners.get(other)!.size > 1
        : owners.get(other)!.size === 0
      const local = links.filter(link => allowed(link.source) && allowed(link.target))
      connectedNodeIds([id], local).forEach(other => scope.add(other))
    }
  }
  if (nodes.some(node => !geometry.has(node.id))) return null
  if (nodes.some(node => scope.has(node.id) && (
    node.data.inputs.some(port => (port.valueType === 'flow' || mediaTypes.has(port.valueType)) && !geometry.get(node.id)!.handles[`in:${port.id}`]) ||
    node.data.outputs.some(port => (port.valueType === 'flow' || mediaTypes.has(port.valueType)) && !geometry.get(node.id)!.handles[`out:${port.id}`])
  ))) return null
  if (links.some(link => (scope.has(link.source) || scope.has(link.target)) && (!geometry.get(link.source)?.handles[link.sourceHandle] || !geometry.get(link.target)?.handles[link.targetHandle]))) return null
  if ([...geometry.values()].some(size => !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0)) return null

  const spatial = (a: string, b: string) => nodeMap.get(a)!.position.y - nodeMap.get(b)!.position.y || nodeMap.get(a)!.position.x - nodeMap.get(b)!.position.x || byId(a, b)
  const pending = new Set([...scope].sort(spatial))
  const components: { ids: string[]; anchor: string; fixed: Set<string> }[] = []
  while (pending.size) {
    // Components are restricted before traversal so an unselected node cannot bridge a selection.
    const component = [...connectedNodeIds([[...pending][0]!], links.filter(link => scope.has(link.source) && scope.has(link.target)))].sort(byId)
    component.forEach(id => pending.delete(id))
    const localLinks = links.filter(link => component.includes(link.source) && component.includes(link.target))
    const events = component.filter(id => nodeMap.get(id)!.data.kind === 'event').sort(spatial)
    const seeds = selected.filter(id => component.includes(id))
    const roots = component.filter(id => !localLinks.some(link => link.target === id)).sort(spatial)
    const anchor = events[0] ?? (seeds.length === 1 ? seeds[0]! : roots[0] ?? [...component].sort(spatial)[0]!)
    components.push({ ids: component, anchor, fixed: new Set([anchor, ...events]) })
  }
  const allFixed = new Set(components.flatMap(component => [...component.fixed]))
  const obstacles: Rect[] = nodes.filter(node => !scope.has(node.id) || allFixed.has(node.id)).map(node => ({ ...node.position, ...geometry.get(node.id)! }))
  for (const { ids: component, anchor, fixed } of components) {
    const componentSet = new Set(component)
    const localLinks = links.filter(link => componentSet.has(link.source) && componentSet.has(link.target))
    const groupOf = new Map<string, string>()
    const mainIds = component.filter(id => main.has(id) || !localLinks.some(link => link.source === id))
    for (const id of mainIds) groupOf.set(id, id)
    for (const id of component) {
      if (groupOf.has(id)) continue
      const queue = [id]
      const visited = new Set(queue)
      let root: string | undefined
      for (let i = 0; i < queue.length && !root; i++) {
        const current = queue[i]!
        if (mainIds.includes(current)) { root = current; break }
        for (const link of localLinks.filter(link => link.source === current)) {
          if (!visited.has(link.target)) { visited.add(link.target); queue.push(link.target) }
        }
      }
      groupOf.set(id, root ?? id)
    }
    const groups = new Map<string, Group>()
    for (const root of new Set(groupOf.values())) {
      const members = component.filter(id => groupOf.get(id) === root)
      const params = members.filter(id => id !== root)
      const mainPinYs = nodeMap.get(root)!.data.inputs
        .filter(port => (port.valueType === 'flow' || mediaTypes.has(port.valueType)) && links.some(link => link.target === root && link.targetHandle === `in:${port.id}`))
        .map(port => geometry.get(root)!.handles[`in:${port.id}`]!.y)
      const parameterBaseline = mainPinYs.length ? Math.max(...mainPinYs) + 25 : -Infinity
      const local = new Map<string, RoutePoint>([[root, { x: 0, y: 0 }]])
      const single = params[0]
      const helix = params.length === 1 && !links.some(link => link.target === single && !main.has(link.source)) && new Set(links.filter(link => link.source === single).map(link => link.target)).size === 1
      if (helix) local.set(single!, { x: 0, y: geometry.get(root)!.height + 25 })
      else {
        const parameterGap = Math.max(120, 40 + 12 * (params.length - 1))
        const graph = orderedGraph(members, localLinks.filter(link => members.includes(link.source) && members.includes(link.target)))
        const placed: Rect[] = [{ x: 0, y: 0, ...geometry.get(root)! }]
        const remaining = new Set(graph.order.filter(id => id !== root))
        const inputY = (link: Link) => local.get(link.target)!.y + geometry.get(link.target)!.handles[link.targetHandle]!.y
        while (remaining.size) {
          const ready = [...remaining].filter(id => graph.links.filter(link => link.source === id).every(link => local.has(link.target)))
          const priority = (id: string) => Math.min(...graph.links.filter(link => link.source === id).map(inputY))
          ready.sort((a, b) => priority(a) - priority(b) || byId(a, b))
          const id = ready[0]!
          remaining.delete(id)
          const size = geometry.get(id)!
          const outgoing = graph.links.filter(link => link.source === id && local.has(link.target)).sort((a, b) => inputY(a) - inputY(b) || byId(a.target, b.target) || byId(a.targetHandle, b.targetHandle))
          const link = outgoing[0]
          const target = link ? local.get(link.target)! : { x: 0, y: 0 }
          const x = Math.min(0, ...outgoing.map(link => local.get(link.target)!.x)) - size.width - parameterGap
          let y = Math.max(parameterBaseline, link ? target.y + geometry.get(link.target)!.handles[link.targetHandle]!.y - size.handles[link.sourceHandle]!.y : 0)
          let hit: Rect | undefined
          while ((hit = placed.find(rect => intersects({ x, y, ...size }, rect, 40)))) y = hit.y + hit.height + 40
          local.set(id, { x, y }); placed.push({ x, y, ...size })
        }
      }
      groups.set(root, { root, members, positions: local, bounds: bounds(members, local, geometry) })
    }
    const groupLinks = localLinks.filter(link => groupOf.get(link.source) !== groupOf.get(link.target)).map(link => ({ ...link, source: groupOf.get(link.source)!, target: groupOf.get(link.target)! }))
    const graph = orderedGraph([...groups.keys()].sort(byId), groupLinks)
    const origins = new Map<string, RoutePoint>()
    const placed: Rect[] = []
    for (const root of graph.order) {
      const group = groups.get(root)!
      const incoming = graph.links.filter(link => link.target === root)
      const parent = incoming[0]
      const x = incoming.length ? Math.max(...incoming.map(link => origins.get(link.source)!.x + groups.get(link.source)!.bounds.x + groups.get(link.source)!.bounds.width + 100)) - group.bounds.x : 0
      const actual = parent && localLinks.find(link => groupOf.get(link.source) === parent.source && groupOf.get(link.target) === root)
      let y = actual ? origins.get(parent!.source)!.y + groups.get(parent!.source)!.positions.get(actual.source)!.y + geometry.get(actual.source)!.handles[actual.sourceHandle]!.y - group.positions.get(actual.target)!.y - geometry.get(actual.target)!.handles[actual.targetHandle]!.y : 0
      let hit: Rect | undefined
      while ((hit = placed.find(rect => intersects({ ...group.bounds, x: x + group.bounds.x, y: y + group.bounds.y }, rect, 60)))) y = hit.y + hit.height + 60 - group.bounds.y
      origins.set(root, { x, y }); placed.push({ ...group.bounds, x: x + group.bounds.x, y: y + group.bounds.y })
    }
    const anchorGroup = groups.get(groupOf.get(anchor)!)!
    const origin = origins.get(anchorGroup.root)!
    const localAnchor = anchorGroup.positions.get(anchor)!
    const delta = { x: nodeMap.get(anchor)!.position.x - origin.x - localAnchor.x, y: nodeMap.get(anchor)!.position.y - origin.y - localAnchor.y }
    for (const group of groups.values()) {
      const origin = origins.get(group.root)!
      for (const [id, point] of group.positions) positions.set(id, fixed.has(id) ? { ...nodeMap.get(id)!.position } : { x: point.x + origin.x + delta.x, y: point.y + origin.y + delta.y })
    }
    const fixedGroups = [...groups.values()].filter(group => group.members.some(id => fixed.has(id)))
    for (const group of [...fixedGroups, ...graph.order.map(id => groups.get(id)!).filter(group => !fixedGroups.includes(group))]) {
      const anchored = group.members.some(id => fixed.has(id))
      if (anchored) {
        for (const id of group.members.filter(id => !fixed.has(id))) {
          const size = geometry.get(id)!
          const point = positions.get(id)!
          let hit: Rect | undefined
          while ((hit = obstacles.find(rect => intersects({ ...point, ...size }, rect, 40)))) point.y = hit.y + hit.height + 40
          obstacles.push({ ...point, ...size })
        }
      } else {
        const rect = bounds(group.members, positions, geometry)
        let shift = 0
        let hit: Rect | undefined
        while ((hit = obstacles.find(other => intersects({ ...rect, y: rect.y + shift }, other, 60)))) shift = hit.y + hit.height + 60 - rect.y
        for (const id of group.members) positions.get(id)!.y += shift
        obstacles.push({ ...rect, y: rect.y + shift })
      }
    }
  }
  for (const [id, point] of positions) {
    if (!allFixed.has(id)) {
      // Match CSS layout precision so measured pin round-off cannot dirty an already arranged graph.
      point.x = Math.round(point.x * 64) / 64
      point.y = Math.round(point.y * 64) / 64
    }
    const before = nodeMap.get(id)!.position
    if (before.x === point.x && before.y === point.y) positions.delete(id)
  }
  for (const edge of edges) {
    if (scope.has(edge.source) && scope.has(edge.target) && Array.isArray(edge.data?.routePoints) && edge.data.routePoints.length) resetRouteEdgeIds.add(edge.id)
  }
  return { positions, resetRouteEdgeIds }
}

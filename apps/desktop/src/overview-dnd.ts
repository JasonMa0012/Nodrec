import { pointerWithin, rectIntersection, type CollisionDetection } from '@dnd-kit/core'

type Rect = { left: number; top: number; width: number; height: number }

export const overviewCollisionDetection: CollisionDetection = (args) => {
  const withoutSource = (collisions: ReturnType<typeof pointerWithin>) => collisions.filter(({ id }) => id !== args.active.id)
  const pointerHits = withoutSource(pointerWithin(args))
  const end = args.droppableContainers.find(({ id }) => id === 'overview:end')
  const endRect = end && (args.droppableRects.get(end.id) ?? end.rect.current)
  const pointer = args.pointerCoordinates
  if (end && endRect && pointer && pointer.x >= endRect.left && pointer.x <= endRect.right && pointer.y >= endRect.top && pointer.y <= endRect.bottom) {
    return [pointerHits.find(({ id }) => id === end.id) ?? { id: end.id, data: { droppableContainer: end, value: 1 } }]
  }
  const preferCard = (collisions: ReturnType<typeof pointerWithin>) => {
    const eligible = withoutSource(collisions)
    const cards = eligible.filter(({ id }) => id !== 'overview:end')
    return cards.length ? cards : eligible
  }
  const cardPointerHits = preferCard(pointerHits)
  return cardPointerHits.length ? cardPointerHits : preferCard(rectIntersection(args))
}

export function overviewDropPlacement(active: Rect | null, target: Rect, threshold = 0.18): 'left' | 'right' | 'above' | 'below' | null {
  if (!active || target.width <= 0 || target.height <= 0) return null
  const x = (active.left + active.width / 2 - target.left - target.width / 2) / target.width
  const y = (active.top + active.height / 2 - target.top - target.height / 2) / target.height
  if (Math.max(Math.abs(x), Math.abs(y)) < threshold) return null
  if (Math.abs(y) > Math.abs(x)) return y < 0 ? 'above' : 'below'
  return x < 0 ? 'left' : 'right'
}

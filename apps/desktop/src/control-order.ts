export function reorderControls(ids: readonly string[], source: string, destination: string): string[] {
  const from = ids.indexOf(source), to = ids.indexOf(destination)
  if (from < 0 || to < 0 || from === to) return [...ids]
  const result = [...ids]
  result.splice(from, 1)
  result.splice(to, 0, source)
  return result
}

export function controlOrder(control: { id: string; order?: number }, ids: readonly string[] = []): number {
  const index = ids.indexOf(control.id)
  return index < 0 ? ids.length + (control.order ?? 0) : index
}

export function insertControl(ids: readonly string[], source: string, destination: string, after: boolean): string[] {
  if (!ids.includes(source) || !ids.includes(destination) || source === destination) return [...ids]
  const result = ids.filter(id => id !== source)
  result.splice(result.indexOf(destination) + Number(after), 0, source)
  return result
}
import type { Blueprint, RegisteredDisplay } from './model.ts'
import { blueprintGraphs, createNodeControl, type RegisteredControl } from './model.ts'

export function nodeShortcut(blueprint: Blueprint, binding: RegisteredControl['binding']) {
  if (!binding) return null
  const graph = blueprintGraphs(blueprint).find(graph=>graph.id===binding.graphId)
  const node = graph?.nodes.find(node=>node.id===binding.nodeId)
  if (!node || !['screen','select_region'].includes(node.data.kind)) return null
  const action = createNodeControl(node,'main','shortcut',binding.graphId)
  return action.binding.action===binding.action ? {...action,enabled:node.data.enabled!==false} : null
}

export type ShortcutBinding=RegisteredControl['binding'] & {source?:RegisteredDisplay['source']}

export function dropNodeShortcut(blueprint: Blueprint, binding: ShortcutBinding, target: string, id: string, destination?: string, after = false): Blueprint {
  const action = nodeShortcut(blueprint,binding)
  if (!action || (binding.source && action.binding.action!=='record')) return blueprint
  if(binding.source && !['status','elapsed'].includes(binding.source))return blueprint
  const existing = (binding.source?blueprint.displays:blueprint.controls).find(control=>control.binding?.graphId===binding.graphId&&control.binding?.nodeId===binding.nodeId&&control.binding?.action===binding.action&&(!binding.source||('source' in control&&control.source===binding.source)))
  let next:Blueprint = existing ? setControlTargets(blueprint,existing.id,[...new Set([...(existing.targets??['main']),target])]) : binding.source ? {...blueprint,displays:[...blueprint.displays,{id,source:binding.source,format:binding.source==='status'?'text':'HH:mm:ss',order:0,targets:[target],binding:{graphId:binding.graphId,nodeId:binding.nodeId,action:'record'}}]} : {...blueprint,controls:[...blueprint.controls,{...action,id,targets:[target]}]}
  const controlId=existing?.id??id
  if (destination===controlId) return next
  const ids=[...(next.controlOrder[target]??[])].filter(item=>item!==controlId)
  const index=destination ? ids.indexOf(destination) : -1
  ids.splice(index<0?ids.length:index+Number(after),0,controlId)
  next={...next,controlOrder:{...next.controlOrder,[target]:ids}}
  return next
}

export function removeNodeShortcut(blueprint: Blueprint, id: string, target: string): Blueprint {
  const control=[...blueprint.controls,...blueprint.displays].find(control=>control.id===id)
  if (!control) return blueprint
  const next=setControlTargets(blueprint,id,(control.targets??['main']).filter(item=>item!==target))
  return {...next,controls:next.controls.filter(control=>control.targets?.length),displays:next.displays.filter(display=>display.targets.length)}
}

export function reconcileNodeShortcuts(blueprint: Blueprint): Blueprint {
  const targets=new Set(['main',...blueprintGraphs(blueprint).flatMap(graph=>graph.nodes.filter(node=>node.data.kind==='select_region').map(node=>`region:${node.data.config?.toolId}`))])
  const valid=blueprint.controls.filter(control=>nodeShortcut(blueprint,control.binding))
  const controls=valid.map(control=>{const next=(control.targets??['main']).filter(target=>targets.has(target));return next.length===(control.targets??['main']).length?control:{...control,targets:next}}).filter(control=>!control.targets||control.targets.length)
  const displays=blueprint.displays.filter(display=>display.binding&&nodeShortcut(blueprint,display.binding)?.binding.action==='record').map(display=>display.targets.every(target=>targets.has(target))?display:{...display,targets:display.targets.filter(target=>targets.has(target))})
  if(controls.length===blueprint.controls.length&&controls.every((control,index)=>control===blueprint.controls[index])&&displays.length===blueprint.displays.length&&displays.every((display,index)=>display===blueprint.displays[index]))return blueprint
  return {...blueprint,controls,displays,controlOrder:Object.fromEntries(Object.entries(blueprint.controlOrder).filter(([target])=>targets.has(target)).map(([target,order])=>[target,order.filter(id=>[...controls,...displays].some(control=>control.id===id&&control.targets?.includes(target)))]))}
}

export function setControlTargets(blueprint: Blueprint, id: string, targets: string[]): Blueprint {
  if (![...blueprint.controls,...blueprint.displays].some(control => control.id === id)) return blueprint
  const controlOrder = { ...blueprint.controlOrder }
  for (const target of new Set([...Object.keys(controlOrder), ...targets])) {
    const ids = controlOrder[target] ?? []
    controlOrder[target] = targets.includes(target) ? ids.includes(id) ? ids : [...ids,id] : ids.filter(item => item !== id)
  }
  return { ...blueprint, controlOrder, controls:blueprint.controls.map(control => control.id === id ? {...control,targets} : control),displays:blueprint.displays.map(display=>display.id===id?{...display,targets}:display) }
}

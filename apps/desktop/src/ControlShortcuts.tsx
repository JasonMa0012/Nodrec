import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GripVertical, X } from 'lucide-react'
import { ControlButton, RuntimeDisplay } from './WorkflowControls'
import { controlOrder, dropNodeShortcut, nodeShortcut, removeNodeShortcut, type ShortcutBinding } from './control-order'
import type { Blueprint, RegisteredControl, RegisteredDisplay } from './model'

export const actionDragEvent='nodrec-action-drag'
export type ActionDrag = {binding:ShortcutBinding;x:number;y:number;phase:'move'|'drop'|'cancel'}
export function ActionDragHandle({binding,disabled=false,label}:{binding:ShortcutBinding;disabled?:boolean;label:string}) {
  const [preview,setPreview]=useState<{x:number;y:number;content:HTMLElement}|null>(null)
  const drag=useRef<{x:number;y:number;active:boolean}|null>(null)
  const emit=(phase:ActionDrag['phase'],x:number,y:number)=>window.dispatchEvent(new CustomEvent<ActionDrag>(actionDragEvent,{detail:{binding,x,y,phase}}))
  return <><button type="button" className="action-drag-handle nodrag nopan" aria-label={`Drag ${label} shortcut`} title="Drag to the control bar" disabled={disabled}
    onClick={event=>event.stopPropagation()}
    onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,y:event.clientY,active:false}}}
    onPointerMove={event=>{
      const start=drag.current
      if(!start)return
      const {clientX:x,clientY:y}=event
      if(Math.hypot(x-start.x,y-start.y)>4)start.active=true
      if(!start.active)return
      const source=event.currentTarget.closest<HTMLElement>('.control-shortcut, .node-action-control')!
      setPreview(current=>({x,y,content:current?.content??source.cloneNode(true) as HTMLElement}))
      emit('move',x,y)
    }}
    onPointerUp={event=>{if(drag.current?.active)emit('drop',event.clientX,event.clientY);drag.current=null;setPreview(null)}}
    onLostPointerCapture={()=>{drag.current=null;setPreview(null);emit('cancel',0,0)}}
    onPointerCancel={()=>{drag.current=null;setPreview(null);emit('cancel',0,0)}}><GripVertical size={13}/></button>{preview&&createPortal(<div className="action-drag-preview" aria-hidden="true" inert style={{left:preview.x+14,top:preview.y+14}} ref={element=>{if(element)element.replaceChildren(preview.content)}}/>,document.body)}</>
}

export default function ControlShortcuts({blueprint,controls,displays,status,durationMs,disabled,editing,update}:{blueprint:Blueprint|null;controls:RegisteredControl[];displays:RegisteredDisplay[];status:Blueprint['recordState'];durationMs:number;disabled:boolean;editing:boolean;update:(value:(current:Blueprint)=>Blueprint)=>void}) {
  const [dragging,setDragging]=useState(false)
  const [over,setOver]=useState(false)
  const [insertion,setInsertion]=useState<{id:string;after:boolean}|null>(null)
  const visible=blueprint?[...(editing?blueprint.controls:controls),...(editing?blueprint.displays:displays)].filter(control=>control.targets?.includes('main')??true).sort((a,b)=>controlOrder(a,blueprint.controlOrder.main)-controlOrder(b,blueprint.controlOrder.main)):[]
  const bar=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    const receive=(event:Event)=>{
      const {binding,x,y,phase}=(event as CustomEvent<ActionDrag>).detail
      setDragging(editing&&phase==='move')
      const element=document.elementFromPoint(x,y)
      setOver(editing&&phase==='move'&&!!element&&!!bar.current?.contains(element))
      if(!editing||phase==='cancel'||!element||!bar.current?.contains(element)){setInsertion(null);return}
      const item=element.closest<HTMLElement>('[data-shortcut-id]')
      const position=item?{id:item.dataset.shortcutId!,after:x>item.getBoundingClientRect().left+item.getBoundingClientRect().width/2}:null
      setInsertion(phase==='drop'?null:position)
      if(phase==='drop')update(current=>dropNodeShortcut(current,binding,'main',`control-${crypto.randomUUID()}`,position?.id,position?.after))
    }
    window.addEventListener(actionDragEvent,receive)
    return ()=>window.removeEventListener(actionDragEvent,receive)
  },[editing,update])
  return <div ref={bar} className={`titlebar-recording-actions${editing?' shortcut-editing':''}${dragging?' shortcut-dragging':''}${over?' shortcut-drag-over':''}`} aria-label="Control bar">
    {visible.map(control=>{
      const display='source' in control?control:null
      const binding=display?.binding?{...display.binding,source:display.source}:!display?control.binding:null
      const action=blueprint&&binding&&nodeShortcut(blueprint,binding)
      if(!action||!binding)return null
      const label=display?display.source==='status'?'Recording status':'Recording time':action.label
      const runtime=controls.find(item=>item.id===control.id)
      return <div key={control.id} className={`control-shortcut${insertion?.id===control.id?insertion.after?' insert-after':' insert-before':''}`} data-shortcut-id={control.id}>
        {editing&&<span onKeyDown={event=>{if(event.altKey&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const other=visible[visible.indexOf(control)+(event.key==='ArrowLeft'?-1:1)];if(other)update(current=>dropNodeShortcut(current,binding,'main',control.id,other.id,event.key==='ArrowRight'))}}}><ActionDragHandle binding={binding} label={label}/></span>}
        {display?<RuntimeDisplay display={display} status={status} durationMs={durationMs}/>:<ControlButton control={{...control as RegisteredControl,label:action.label,icon:action.icon,enabled:(control as RegisteredControl).enabled&&action.enabled,error:runtime?.error}} status={status} durationMs={durationMs} disabled={disabled}/>}
        {editing&&<button className="shortcut-remove" aria-label={`Remove ${label} shortcut`} title="Remove shortcut" onClick={()=>update(current=>removeNodeShortcut(current,control.id,'main'))}><X size={10}/></button>}
      </div>
    })}
    {editing&&visible.length===0&&<span className="shortcut-drop-hint">Drag a node action here</span>}
  </div>
}

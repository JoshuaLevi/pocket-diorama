import { fitInView } from "./ViewPlacement";
import { GbCanvas, DMG_GREYS, SHADE_NONE } from "./GbCanvas";
import { GbScreenView } from "./GbScreenView";
import { drawCentred, drawText, textWidth } from "./TinyFont";
import { loadPressableKit, TouchPresser } from "../Pressable";
import { CodeKeyGesture } from "./CodeKeyboardLayout";
import { SpatialHandle } from "./SpatialHandle";
import type { HandSample, SpatialTarget } from "../SpatialInput";

export interface PageKey { id: string; label: string; x: number; y: number; w: number; h: number; enabled?: boolean; }
export interface PageModel { context: string; title: string; text?: string; keys: PageKey[]; selected?: string; }
export function pageKey(id: string, label: string, x: number, y: number, w: number, h: number): PageKey {
  return {id,label,x,y,w,h};
}
export function listPage(context: string, title: string, rows: string[], selected: number): PageModel {
  return {context,title,selected:"row:"+selected,keys: rows.slice(0,6).map((label,i)=>
    pageKey("row:"+i,label.trim(),3,19+i*17,154,14)).concat([
      pageKey("up","UP",3,124,45,16), pageKey("down","DOWN",53,124,48,16),
      pageKey("back","BACK",106,124,51,16)])};
}

/** Separate, directly targeted pages. Same angular size and release-to-type rule as world-code entry. */
export class SpatialPage {
  private view: GbScreenView;
  private canvas = new GbCanvas();
  private holders: SceneObject[] = [];
  private model: PageModel = null;
  private layout = "";
  private stamp = "";
  private hover = -1;
  private pressed = -1;
  private owner: any = null;
  private gesture = new CodeKeyGesture();
  private quietUntil = 0;
  private editor = TouchPresser.wanted();
  private enabled = false;
  private parent:SceneObject;
  private placedContext="";
  private handle: SpatialHandle;
  private dragging = false;
  private positions: {[key:string]:vec3} = {};
  private events: {context:string;id:string}[] = [];
  constructor(script: ScriptComponent, camera: Camera, material: (t:Texture)=>Material) {
    this.parent=script.getSceneObject();
    this.view = new GbScreenView(this.parent,material,72,160,true,"SpatialPage");
    this.handle = new SpatialHandle(this.view.surfaceObject(),"MenuGrip",72,6,material,"PINCH HERE TO MOVE");
    this.handle.root.getTransform().setLocalPosition(new vec3(0,36,0.3));
    this.handle.enabled(false);
    if (this.editor) {
      script.createEvent("HoverEvent").bind((e:HoverEvent)=>{this.hover=this.pick(camera,e.getHoverPosition());});
      script.createEvent("TouchStartEvent").bind((e:TouchStartEvent)=>this.begin(this.pick(camera,e.getTouchPosition()),"mouse"));
      script.createEvent("TouchMoveEvent").bind((e:TouchMoveEvent)=>{
        this.hover=this.pick(camera,e.getTouchPosition());
        if(this.hover!==this.pressed)this.cancel();
      });
      script.createEvent("TouchEndEvent").bind((e:TouchEndEvent)=>this.end(this.pick(camera,e.getTouchPosition()),"mouse"));
    }
  }
  private accepts(i:number):boolean {return this.enabled && !!this.model && i>=0 && i<this.model.keys.length && this.model.keys[i].enabled!==false;}
  private cancel():void {this.gesture.cancel();this.owner=null;this.pressed=-1;}
  private begin(i:number,owner:any):void {
    if(this.dragging||!this.accepts(i)||this.gesture.active()||getTime()<this.quietUntil)return;
    this.owner=owner;this.pressed=i;this.gesture.begin(i);
  }
  private end(i:number,owner:any):void {
    if(owner!==this.owner)return;
    const key=this.gesture.end(i);this.cancel();
    if(!this.accepts(key))return;
    this.events.push({context:this.model.context,id:this.model.keys[key].id});
    this.quietUntil=getTime()+0.16;
  }
  take(context:string):string {
    const event=this.events.shift();
    return event && event.context===context ? event.id : "";
  }
  interacting():boolean { return (this.enabled && (this.hover>=0 || this.gesture.active())) || getTime()<this.quietUntil; }
  blocksPinch():boolean {return this.enabled||getTime()<this.quietUntil;}
  isEnabled():boolean {return this.enabled;}
  target(hand:HandSample):SpatialTarget {
    return this.enabled && !this.gesture.active() && this.handle && this.handle.targeted(hand) ? "menu" : "";
  }
  setDragging(on:boolean):void {
    if(on){this.cancel();this.hover=-1;this.events=[];}
    if(this.dragging&&!on)this.quietUntil=getTime()+0.2;
    this.dragging=on;
    if(this.handle)this.handle.highlight(on);
  }
  moveBy(delta:vec3):void {
    if(!this.enabled)return;
    const transform=this.view.surfaceObject().getTransform(),at=transform.getWorldPosition();
    const next=new vec3(at.x+delta.x,at.y+delta.y,at.z+delta.z);
    transform.setWorldPosition(next);
    this.positions[this.placedContext]=next;
    this.view.pinAt(this.parent,next);
  }
  hide():void {
    if(!this.enabled)return;
    this.enabled=false;this.view.setEnabled(false);this.cancel();this.hover=-1;
    this.dragging=false;if(this.handle)this.handle.enabled(false);
    this.events=[];this.quietUntil=getTime()+0.16;this.stamp="";
  }
  show(model:PageModel,camera:Camera,dt:number):void {
    const signature=model.context+JSON.stringify(model.keys);
    this.model=model;
    if(signature!==this.layout){
      this.cancel();this.hover=-1;this.events=[];
      // Keep SIK targets alive when text or layouts change: cursors may retain a target until the next frame.
      const kit=loadPressableKit("SpatialPage");
      for(let i=0;i<model.keys.length;i++){
        const k=model.keys[i];
        let h=this.holders[i];
        const added=!h;
        if(added){h=global.scene.createSceneObject("PageTarget_"+i);h.setParent(this.view.surfaceObject());this.holders.push(h);}
        const collider=(added?h.createComponent("Physics.ColliderComponent"):h.getComponent("Physics.ColliderComponent")) as ColliderComponent;
        const box=Shape.createBoxShape();box.size=new vec3(k.w*0.45,k.h*0.45,0.5);
        collider.shape=box;collider.fitVisual=false;collider.enabled=k.enabled!==false;
        h.enabled=true;
        h.getTransform().setLocalPosition(new vec3((k.x+k.w/2-80)*0.45,(72-k.y-k.h/2)*0.45,0.15));
        if(added&&kit.interactable){
          const control:any=h.createComponent(kit.interactable.getTypeName());
          control.onHoverEnter.add(()=>{if(!this.editor&&this.accepts(i))this.hover=i;});
          control.onHoverExit.add(()=>{if(!this.editor&&this.hover===i)this.hover=-1;if(!this.editor&&this.pressed===i)this.cancel();});
          control.onInteractorTriggerStart.add((e:any)=>{if(!this.editor)this.begin(i,e.interactor);});
          control.onInteractorTriggerEnd.add((e:any)=>{if(!this.editor)this.end(i,e.interactor);});
          const cancel=(e:any)=>{if(this.pressed===i&&(!e||e.interactor===this.owner))this.cancel();};
          control.onInteractorTriggerEndOutside.add(cancel);control.onTriggerCanceled.add(cancel);
        }
      }
      for(let i=model.keys.length;i<this.holders.length;i++)this.holders[i].enabled=false;
      this.layout=signature;
    }
    // START and battle menus have independent placements; submenus retain them.
    const context=model.context==="menu"?model.context+":"+model.title:model.context;
    let firstPlacement=false;
    if(!this.enabled||this.placedContext!==context){
      this.stamp="";
      this.view.unpin();
      const compact=model.context!=="name" && model.context!=="options" && model.context!=="choice";
      const scale=compact?0.55:1;
      this.view.surfaceObject().getTransform().setLocalScale(new vec3(scale,scale,scale));
      const saved=this.positions[context];
      if(saved)this.view.pinAt(this.parent,saved);
      else if(compact) {
        this.view.pinAt(this.parent,camera.screenSpaceToWorldSpace(new vec2(0.2,0.28),145));
        firstPlacement=true;
      }
      this.placedContext=context;
    }
    if(!this.enabled){this.enabled=true;this.view.setEnabled(true);this.quietUntil=getTime()+0.16;}
    if(this.handle)this.handle.enabled(model.context!=="name");
    if(!this.dragging && this.hover<0&&!this.gesture.active()){
      this.view.place(camera,dt);
      if(firstPlacement){
        fitInView(camera,this.view.surfaceObject(),39.6,42.9);
        const at=this.view.surfaceObject().getTransform().getWorldPosition();
        this.positions[context]=at;this.view.pinAt(this.parent,at);
      }
    }
    const stamp=JSON.stringify(model)+":"+this.hover+":"+this.pressed;
    if(stamp===this.stamp)return;this.stamp=stamp;
    this.canvas.clear(model.context==="menu"?SHADE_NONE:0);
    this.canvas.fillRect(3,1,154,12,0);drawCentred(this.canvas,model.title,3,3,1,true);
    if(model.text)model.text.split("\n").slice(0,2).forEach((line,i)=>drawCentred(this.canvas,line,20+i*10,3,1,true));
    model.keys.forEach((k,i)=>{
      const hot=i===this.hover||i===this.pressed,active=k.enabled!==false;
      this.canvas.fillRect(k.x,k.y,k.w,k.h,active?1:0);
      if(hot&&active){this.canvas.fillRect(k.x,k.y,k.w,k.h,3);this.canvas.fillRect(k.x+1,k.y+1,k.w-2,k.h-2,i===this.pressed?1:0);}
      if(model.selected===k.id)this.canvas.fillRect(k.x,k.y+k.h-1,k.w,1,3);
      const label=k.label.substring(0,Math.floor((k.w-4)/6));
      drawText(this.canvas,label,k.x+Math.max(2,Math.round((k.w-textWidth(label,1))/2)),k.y+Math.floor((k.h-7)/2),active?3:1,1,true);
    });
    this.view.upload(this.canvas,()=>DMG_GREYS);
  }
  private pick(camera:Camera,at:vec2):number {
    if(!this.enabled||!this.model)return -1;
    const inv=this.view.surfaceObject().getTransform().getInvertedWorldTransform();
    const a=inv.multiplyPoint(camera.screenSpaceToWorldSpace(at,1)),b=inv.multiplyPoint(camera.screenSpaceToWorldSpace(at,500));
    if(Math.abs(b.z-a.z)<1e-5)return -1;
    const t=-a.z/(b.z-a.z);if(t<0||t>1)return -1;
    const x=80+(a.x+t*(b.x-a.x))/0.45,y=72-(a.y+t*(b.y-a.y))/0.45;
    return this.model.keys.findIndex(k=>k.enabled!==false&&x>=k.x&&x<k.x+k.w&&y>=k.y&&y<k.y+k.h);
  }
}

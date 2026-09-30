import assert from 'node:assert/strict';
import { NamingController } from '../Scripts/play/screen/NamingScreen.ts';
import { namePage } from '../Scripts/play/screen/NamePage.ts';
import { SpatialPage, listPage } from '../Scripts/play/screen/SpatialPage.ts';
import { CodeKeyGesture } from '../Scripts/play/screen/CodeKeyboardLayout.ts';
import { blocksSight, faceBounds, occludingFaces, splitFaces } from '../Scripts/world/VisibilityCutaway.ts';
let checks=0;const check=(value,label)=>{assert.ok(value,label);checks++;};
for(const [title,presets,limit] of [['YOUR NAME?',['RED','ASH','JACK'],7],["RIVAL'S NAME?",['BLUE','GARY','JOHN'],7],['NICKNAME?',[],10]]){
 const n=new NamingController(title,presets,limit);
 if(presets.length){check(namePage(n,false).keys.length===4,'preset choices targeted');n.spatialPick('preset:0');}
 for(const symbols of [false,true]){
  const p=namePage(n,symbols);check(p.title===title,'correct prompt');
  for(let i=0;i<p.keys.length;i++)for(let j=i+1;j<p.keys.length;j++){
   const a=p.keys[i],b=p.keys[j];check(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,'keys never overlap');
  }
 }
 check(namePage(n,false).keys.find(k=>k.id==='done').enabled===false,'empty names not accepted');
 n.spatialPick('char:J');n.spatialPick('case');n.spatialPick('char:o');n.spatialPick('char:s');
 check(n.typed()==='Jos','mixed case retained');n.spatialPick('delete');check(n.typed()==='Jo','delete one character');
 for(let i=0;i<20;i++)n.spatialPick('char:a');check(n.typed().length===limit,'cartridge name limit');
 check(namePage(n,false).keys.filter(k=>k.id.startsWith('char:')&&k.id!=='char: ').every(k=>!k.enabled),'full name disables letter targets');
 n.spatialPick('done');check(!n.isOpen()&&n.result().startsWith('Jo'),'direct entry commits');
}
let now=1;globalThis.getTime=()=>now;
function page(){return Object.assign(Object.create(SpatialPage.prototype),{enabled:true,model:listPage('menu','MENU',['ONE','TWO'],0),gesture:new CodeKeyGesture(),events:[],quietUntil:0,pressed:-1,owner:null,view:{setEnabled(){}}});}
{
 const p=page();p.begin(0,'left');p.end(0,'right');check(!p.take('menu'),'other hand cannot commit');p.end(0,'left');check(p.take('menu')==='row:0','owner commits once');p.end(0,'left');check(!p.take('menu'),'duplicate release ignored');
 now+=.2;p.begin(0,'left');p.end(1,'left');check(!p.take('menu'),'release outside original row cancels');
 p.begin(0,'left');p.cancel();p.end(0,'left');check(!p.take('menu'),'lost target cancels');
 p.begin(0,'left');p.hide();p.end(0,'left');check(!p.take('menu')&&p.blocksPinch(),'closing page cancels and shields generic A');now+=.2;check(!p.blocksPinch(),'shield expires');
}
{
 const t={x:0,y:1.5,z:0,ground:0};
 check(blocksSight([-1,0,4],[1,3,5],[0,2,10],t),'front wall occludes');
 check(!blocksSight([-1,0,4],[1,0,5],[0,2,10],t),'floor remains solid');
 check(!blocksSight([-1,0,-5],[1,3,-4],[0,2,10],t),'wall behind target stays solid');
 check(!blocksSight([-1,0,4],[1,3,5],[0,2,-10],t),'turning around restores wall');
 check(blocksSight([4,0,-1],[5,3,1],[10,2,0],t),'side angle occludes');
 const v=[-1,0,4,0,0,1,0,4,1,0,1,3,4,1,1,-1,3,4,0,1],i=[0,1,2,0,2,3];
 const bounds=faceBounds(v,i),faces=occludingFaces(bounds,[0,2,10],[t]);
 check(faces.length===1,'face selected');const faded=splitFaces(v,i,faces);check(faded.solid.length===0&&faded.indices.length===6&&faded.verts.length===20,'face moves once to faded mesh');
 const restored=splitFaces(v,i,[]);check(restored.solid.join()===i.join()&&!restored.indices.length,'unobstructed view restores original triangles');
}
console.log(`SPATIAL PAGES: ${checks} checks passed`);

// Real controllers: pointing selects a visible row, then the ordinary action commits it.
const {readFileSync}=await import('node:fs');
const bundle=JSON.parse(readFileSync('Assets/Generated/kanto.json','utf8'));
const {newPlayState}=await import('../Scripts/play/PlayState.ts');
const {makeWildMon}=await import('../Scripts/play/battle/Stats.ts');
const {MenuController}=await import('../Scripts/play/MenuController.ts');
const {ShopController}=await import('../Scripts/play/ShopController.ts');
const {PcController}=await import('../Scripts/play/PcController.ts');
const {ChoiceController}=await import('../Scripts/play/ChoiceController.ts');
const {MoveLearnController}=await import('../Scripts/play/MoveLearnController.ts');
const {glyphRows}=await import('../Scripts/play/screen/TinyFont.ts');
const neutral={up:false,down:false,left:false,right:false};
const state=newPlayState(bundle.romSha1);state.party=[makeWildMon(bundle,'BULBASAUR',14,()=>.5)];
function ready(c){for(let i=0;i<25&&!c.rows().length;i++)c.step(neutral,true,false,1/60);assert(c.rows().length);return c;}
for(const c of [ready(new ShopController(bundle,state,['POTION','POKE_BALL'])),ready(new PcController(bundle,state,'full')),new ChoiceController(['CHOOSE'],['ONE','TWO','THREE'],[])]){
 check(!c.pointRow(-1)&&!c.pointRow(c.rows().length),'invalid target rejected');
 check(c.pointRow(1)&&c.cursorRow()===1,'point selects second row immediately');
 c.step(neutral,true,false,1/60);
}
{
 const c=new ChoiceController(['CHOOSE'],Array.from({length:12},(_,i)=>String(i)),[]);
 for(let i=0;i<8;i++){c.step({...neutral,down:true},false,false,1/60);c.step(neutral,false,false,1/60);}
 const row=c.rows()[1];c.pointRow(1);c.step(neutral,true,false,1/60);check(String(c.picked())===row,'scrolled row selects its absolute item');
 const m=new MenuController(bundle,state);m.openOverworld(state.party);check(m.pointRow(1)&&m.cursorRow()===1,'root menu target');
 const learn=ready(new MoveLearnController(bundle,state.party[0],'RAZOR_LEAF'));check(learn.pointRow(1)&&learn.cursorRow()===1,'move question NO can be targeted');
 check(glyphRows('a',true).join()!==glyphRows('A',true).join(),'lowercase visible in names');
 for(const c of '¥♂♀')check(glyphRows(c).some(Boolean),'price and gender glyphs render');
}
// Layout edits reuse the actual page targets, including targets retained by SIK.
const {GbCanvas}=await import('../Scripts/play/screen/GbCanvas.ts');
let created=0;globalThis.print=()=>{};
globalThis.vec3=class{constructor(x,y,z){Object.assign(this,{x,y,z});}};
globalThis.Shape={createBoxShape:()=>({})};
const transform={setLocalScale(){},setLocalPosition(){}};
const holder=()=>{const collider={};return {enabled:true,setParent(){},getTransform:()=>transform,createComponent:()=>collider,getComponent:()=>collider,destroy(){throw Error('target destroyed');}};};
globalThis.scene={createSceneObject:()=>{created++;return holder();}};
{
 const p=page();p.holders=[];p.canvas=new GbCanvas();p.layout='';p.stamp='';p.placedContext='name';p.hover=-1;
 p.view={surfaceObject:holder,place(){},upload(){},unpin(){},setEnabled(){}};
 let m={context:'name',title:'NAME',keys:[{id:'char:A',label:'A',x:3,y:39,w:14,h:14},{id:'done',label:'DONE',x:111,y:112,w:46,h:14}]};
 p.show(m,{},1/60);const first=p.holders[0];m={...m,keys:m.keys.map(k=>({...k,label:k.label.toLowerCase()}))};p.show(m,{},1/60);
 check(created===2&&first===p.holders[0],'changing labels reuses targets');
 p.show({...m,keys:m.keys.slice(0,1)}, {},1/60);check(!p.holders[1].enabled,'unused target disabled');
 p.show(m,{},1/60);check(created===2&&p.holders[1].enabled,'returning target reuses collider');
}
console.log(`SPATIAL PAGES EXTENDED: ${checks} checks passed`);

{
 const p=page();let at=new vec3(4,8,-100),pin=null;
 p.parent={};p.positions={'menu:MENU':new vec3(-30,12,-100)};p.placedContext='menu:BATTLE';
 p.holders=[];p.layout='menu[]';p.canvas=new GbCanvas();p.stamp='';p.hover=-1;
 const transform={getWorldPosition:()=>at,setWorldPosition:v=>{at=v;},setLocalScale(){}};
 p.view={surfaceObject:()=>({getTransform:()=>transform}),setEnabled(){},unpin(){},pinAt:(_,v)=>{pin=v;},place(){if(pin)at=pin;},upload(){}};
 p.setDragging(true);p.moveBy(new vec3(7,3,-2));
 check(at.x===11&&at.y===11&&at.z===-102,'drag moves actual menu transform');
 p.begin(0,'left');p.end(0,'left');check(!p.take('menu'),'drag cannot also select a row');
 p.setDragging(false);p.hide();p.show({context:'menu',title:'BATTLE',keys:[]},{},1/60);
 check(at.x===11&&at.z===-102,'battle menu returns at user position');
 p.hide();p.show({context:'menu',title:'MENU',keys:[]},{},1/60);
 check(at.x===-30&&at.y===12,'START menu keeps its separate saved position');
 p.hide();p.show({context:'menu',title:'BATTLE',keys:[]},{},1/60);
 check(at.x===11,'switching between START and battle retains both positions');
}
console.log(`SPATIAL PAGES DRAG: ${checks} checks passed`);

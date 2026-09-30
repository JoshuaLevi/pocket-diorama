// Replays the established cartridge road through Brock with real terrain
// generation and the shipping PokemonAR presentation methods on every frame.
// GPU uploads are stubbed; battles here use HeadlessLens's instant outcome.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { HeadlessLens } from '../../test/headless.mjs';
import { VoxelTerrain, curveDrop, VOXEL } from '../Scripts/world/VoxelTerrain.ts';
import { tileStatsFor } from '../Scripts/world/VoxelPalette.ts';
import { spriteHeightUnits } from '../Scripts/world/SpritePalettes.ts';
import { isObjectHidden } from '../Scripts/world/WorldData.ts';
import { planRoad } from '../../tools/oracle/road.mjs';

globalThis.print=()=>{};
globalThis.vec3=class {constructor(x,y,z){Object.assign(this,{x,y,z});}};
globalThis.MeshTopology={Triangles:0};globalThis.MeshIndexType={UInt16:0};
globalThis.MeshBuilder=class {
  n=0;i=0;getVerticesCount(){return this.n;}getIndicesCount(){return this.i;}
  eraseVertices(){this.n=0;}eraseIndices(){this.i=0;}
  appendVerticesInterleaved(v){assert(v.every(Number.isFinite));this.n+=v.length/5;}
  appendIndices(v){this.i+=v.length;}updateMesh(){}getMesh(){return {};}
};
function holder(){let p=new vec3(0,0,0);return {enabled:true,setParent(){},destroy(){},createComponent(){return {};},getTransform(){return {getLocalPosition:()=>p,setLocalPosition:v=>{p=v;}};}};}
globalThis.scene={createSceneObject:holder};
const source=readFileSync('Assets/Scripts/PokemonAR.ts','utf8');
function method(name){const a=source.indexOf('  private '+name+'(');assert(a>=0);return source.slice(a,source.indexOf('\n  }',a)+4);}
const code='class Presentation {'+['updatePlayerTransform','refreshNpcGround','npcGroundY','groundY','cullNpcsToWindow'].map(method).join('\n')+'}\nPresentation';
const Presentation=vm.runInNewContext(stripTypeScriptTypes(code),{vec3,curveDrop,VOXEL,spriteHeightUnits,CHARACTER_TILES:2.2,print:()=>{}});
const bundle=JSON.parse(readFileSync('Assets/Generated/kanto.json','utf8'));
const rom=JSON.parse(readFileSync('tools/oracle/state/after-brock.rom.json','utf8'));
const lens=new HeadlessLens(bundle,{wanderers:false});
const p=new Presentation();
p.terrain=new VoxelTerrain(holder());p.terrain.setMaterial({});
p.overworld=lens.overworld;p.playerObject=holder();p.playerBillboard=null;
p.isGameBoyMode=()=>false;p.applyDioramaScroll=()=>{};p.npcByName={};
let previousMap=null, samples=0,scriptedSamples=0, groundChecks=0, maxBuildBurst=0;
const maps=new Set();
p.updateNpcMotion=()=>{
  const map=lens.overworld.map;
  for(const o of map.def.objects){
    if(isObjectHidden(map.def.id,o,lens.loop.reveals()))continue;
    assert(bundle.sprites[o.sprite],`missing ${o.sprite} on ${map.def.id}`);
    if(!p.npcByName[o.name])p.npcByName[o.name]={holder:holder(),object:o};
    const pose=lens.npcMotion.pose(o.name);
    const x=-map.widthTiles/2+(pose?pose.visualX:o.x)*2+1;
    const z=-map.heightTiles/2+(pose?pose.visualY:o.y)*2+1;
    p.npcByName[o.name].holder.getTransform().setLocalPosition(new vec3(x,p.npcGroundY(o.sprite,x,z),z));
  }
  for(const name of Object.keys(p.npcByName)){
    const o=map.def.objects.find(o=>o.name===name);
    if(!o||isObjectHidden(map.def.id,o,lens.loop.reveals()))delete p.npcByName[name];
  }
  p.cullNpcsToWindow();
};
const oldFrame=lens.frame.bind(lens);
lens.frame=(dt)=>{
  oldFrame(dt);const map=lens.overworld.map;
  if(map!==previousMap){
    previousMap=map;maps.add(map.def.id);p.npcByName={};
    p.terrain.setMap(map,tileStatsFor(bundle.tilesets[map.def.tileset]),0,20,false);
    p.terrain.update(lens.overworld.cellX*2,lens.overworld.cellY*2);p.terrain.flush();
  }
  const before=p.terrain.buildCount();p.updatePlayerTransform(dt||1/60);
  maxBuildBurst=Math.max(maxBuildBurst,p.terrain.buildCount()-before);
  const w=p.terrain.currentWindow(),x=lens.overworld.cellX*2,z=lens.overworld.cellY*2;
  assert(x>=w.minTileX&&x<=w.maxTileX&&z>=w.minTileZ&&z<=w.maxTileZ,
    `player outside drawn world: ${map.def.id} ${x},${z}`);
  if(lens.overworld.isWalkingScripted())scriptedSamples++;
  for(const e of Object.values(p.npcByName)){
    const at=e.holder.getTransform().getLocalPosition();
    assert.equal(e.holder.enabled,p.terrain.coversPoint(at.x,at.z));
    if(e.holder.enabled){const y=spriteHeightUnits(e.object.sprite,2.2)<2.2?p.terrain.propSurfaceY(at.x,at.z):p.terrain.surfaceY(at.x,at.z);assert(y!==null);assert.equal(at.y,y);groundChecks++;}
  }
  samples++;
};
lens.play.playerName='RED';lens.play.rivalName='BLUE';lens.clearText();
const scenario=name=>JSON.parse(readFileSync('tools/oracle/scenarios/'+name+'.json','utf8')).actions;
lens.run(scenario('oak-escort'));
assert.equal(lens.overworld.mapId,'OAKS_LAB');
lens.run([{walk:'down',n:1},{walk:'right',n:3},{face:'up'},
 {text:'BULBASAUR?',max:40},{press:'a'},{text:'nickname',max:40},{press:'a'},
 {wait:60},{press:'b'},{text:'CHARMANDER!',max:40},{press:'a'},{wait:120}]);
lens.clearText();lens.run([{walk:'down',n:1},{walk:'left',n:3}]);
for(let i=0;i<8;i++){lens.run([{walk:'down',n:1}]);if(lens.pageWaiting||lens.loop.isBusy())break;}
lens.run([{text:'take',max:40},{press:'a'},{text:'later',max:60},{press:'a'},{wait:300}]);
lens.run(scenario('viridian-mart-parcel'));
const cell=()=>[lens.overworld.mapId,lens.overworld.cellX,lens.overworld.cellY];
const same=(a,b)=>a.every((v,i)=>v===b[i]);
for(const leg of rom.legs){
  for(let attempt=0;attempt<12&&!same(cell(),leg.to);attempt++){
    const [map,x,y]=cell();const road=planRoad(bundle,{map,x,y},{map:leg.to[0],x:leg.to[1],y:leg.to[2]},
      {...leg.options,lastMap:lens.overworld.lastMapId});assert(road,leg.name+': no road');
    for(let i=0;i<road.actions.length;i++){
      lens.run([road.actions[i]]);
      if(lens.pageWaiting||lens.loop.isBusy()){lens.clearText();lens.settle();}
      if(!same(cell(),road.ends[i])){lens.frames(120);break;}
    }
  }
  assert(same(cell(),leg.to),leg.name+': stopped at '+cell());
  if(leg.name==='mart-to-oak'){
    lens.run([{face:'up'},{text:'Gramps!',max:60},{text:'call me for',max:400},
      {text:'Leave it',max:200},{text:'Hahaha',max:60},{press:'a'},{wait:900}]);
    lens.clearText();lens.settle();
  }else if(leg.to[0].includes('POKECENTER')||leg.name==='pewter-center-to-brock'){
    lens.run([{face:'up'},{press:'a'}]);lens.clearText();lens.settle();
  }
  console.log('WAYPOINT',leg.name,cell().join(' '));
}
assert(lens.play.flags.EVENT_BEAT_BROCK&&lens.play.badges[0]);
assert(lens.play.bag.some(s=>s.id==='TM_BIDE'));
assert(scriptedSamples>50);assert(maxBuildBurst<=3);
console.log('FIRST GYM WORLD PASS',JSON.stringify({samples,scriptedSamples,groundChecks,maxBuildBurst,maps:[...maps]}));

// A stationary NPC starts outside the column field, then enters the view.
// Its initial fallback height must be replaced by the newly loaded ground.
{
  const { MapRuntime }=await import('../Scripts/world/MapRuntime.ts');
  const map=new MapRuntime(bundle.maps.VIRIDIAN_CITY,bundle.tilesets[bundle.maps.VIRIDIAN_CITY.tileset]);
  const q=new Presentation();q.terrain=new VoxelTerrain(holder());q.terrain.setMaterial({});
  q.terrain.setMap(map,tileStatsFor(bundle.tilesets[map.def.tileset]),0,14,false);
  q.terrain.update(36,60);q.terrain.flush();
  const object=holder(),x=-map.widthTiles/2+17*2+1,z=-map.heightTiles/2+9*2+1;
  object.getTransform().setLocalPosition(new vec3(x,q.groundY(x,z),z));
  const initial=object.getTransform().getLocalPosition().y;
  q.overworld={map,cellX:18,cellY:12,visualCell:()=>[18,12]};
  q.npcByName={desk:{holder:object,object:{sprite:"SPRITE_OAK"}}};q.playerObject=holder();q.playerBillboard=null;
  q.isGameBoyMode=()=>false;q.applyDioramaScroll=()=>{};q.updateNpcMotion=()=>q.cullNpcsToWindow();
  q.updatePlayerTransform(1/60);
  const final=object.getTransform().getLocalPosition().y;
  assert(object.enabled);assert.equal(final,q.terrain.surfaceY(x,z));assert.notEqual(final,initial);
  console.log('STATIONARY NPC GROUND PASS',JSON.stringify({initial,final}));
}

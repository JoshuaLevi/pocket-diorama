import assert from 'node:assert/strict';
import {VoxelTerrain} from '../Scripts/world/VoxelTerrain.ts';
import {faceBounds} from '../Scripts/world/VisibilityCutaway.ts';
globalThis.vec3=class {constructor(x,y,z){Object.assign(this,{x,y,z});}};
globalThis.vec4=class {constructor(x,y,z,w){Object.assign(this,{x,y,z,w});}};
globalThis.BlendMode={Normal:1};globalThis.MeshTopology={Triangles:0};globalThis.MeshIndexType={UInt16:0};
globalThis.MeshBuilder=class {
 vertices=[];indices=[];uploads=0;
 getVerticesCount(){return this.vertices.length/5;}getIndicesCount(){return this.indices.length;}
 eraseVertices(){this.vertices=[];}eraseIndices(){this.indices=[];}
 appendVerticesInterleaved(v){this.vertices.push(...v);}appendIndices(v){this.indices.push(...v);}
 updateMesh(){this.uploads++;}getMesh(){return {};}
};
const objects=[];globalThis.scene={createSceneObject:()=>{const o={enabled:true,setParent(){},createComponent:()=>({})};objects.push(o);return o;}};
const terrain=new VoxelTerrain({getTransform:()=>({getInvertedWorldTransform:()=>({multiplyPoint:p=>p})})});
const palette={live:true};terrain.setMaterial({mainPass:{baseTex:palette},clone:()=>({mainPass:{}})});
const verts=[-1,0,4,0,0,1,0,4,1,0,1,3,4,1,1,-1,3,4,0,1],indices=[0,1,2,0,2,3];
const e={object:{},bounds:faceBounds(verts,indices),drawnVerts:verts,drawnIndices:indices,builder:new MeshBuilder(),key:'wall',faded:''};terrain.chunks=[e];
e.builder.vertices=verts.slice();
e.builder.appendVerticesInterleaved=()=>{throw Error('unchanged solid vertices were uploaded again');};
const target={x:0,y:1.5,z:0,ground:0};terrain.cutaway(new vec3(0,2,10),[target],1/60);
assert(e.fade.enabled);assert.equal(e.builder.indices.length,0);assert.equal(e.fadeBuilder.indices.length,6);
assert.equal(terrain.fadeMaterial.mainPass.baseTex,palette);assert.equal(terrain.fadeMaterial.mainPass.depthWrite,false);
const uploads=e.fadeBuilder.uploads;terrain.cutaway(new vec3(0,2,10),[target],1/60);assert.equal(e.fadeBuilder.uploads,uploads);
terrain.cutaway(new vec3(0,2,-10),[target],0.1);assert(!e.fade.enabled);assert.deepEqual(e.builder.indices,indices);
terrain.cutaway(new vec3(0,2,10),[target],0.1);assert(e.fade.enabled);assert.equal(objects.length,1);
let scans=0;
const chunks=Array.from({length:12},(_,i)=>{
 let stamp='';const chunk={...e,key:'budget'+i,object:{enabled:i<8},bounds:null,faded:'',fade:null,builder:new MeshBuilder()};
 Object.defineProperty(chunk,'sightStamp',{get:()=>stamp,set:v=>{scans++;stamp=v;}});return chunk;
});
terrain.chunks=chunks;
for(let i=0;i<120;i++)terrain.cutaway(new vec3(10+i,3,10),[target],1/60);
assert(scans<=40,'visibility budget must not scale with headset frame rate');
assert(chunks.slice(8).every(c=>c.bounds===null),'invisible chunks must not build face bounds');
console.log('VISIBILITY BUDGET:',scans,'chunk scans in 120 frames; zero solid vertex reuploads');
console.log('VISIBILITY RUNTIME: palette, bounded uploads, angular restore and mesh reuse PASS');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { SpatialInput, PinchJoystick } from '../Scripts/play/SpatialInput.ts';
import { StickSource } from '../Scripts/play/StickSource.ts';
import { ViewCompass, turnPress } from '../Scripts/play/ViewRelativeInput.ts';
import { Overworld } from '../Scripts/play/Overworld.ts';
const source=readFileSync('Assets/Scripts/PokemonAR.ts','utf8');
function method(name){const a=source.indexOf('  private '+name+'(');return source.slice(a,source.indexOf('\n  }',a)+4);}
class Vec {constructor(x,y,z){Object.assign(this,{x,y,z});}}
const Runtime=vm.runInNewContext(stripTypeScriptTypes('class Runtime {'+method('driveWorldHands')+method('updateCompass')+'}\nRuntime'),
 {vec3:Vec,COMPASS_REACH_CM:8,print:()=>{}});
let checks=0;
for(const worldDegrees of [0,90,180,270])for(const wearerDegrees of [0,90,180,270]){
 const yaw=worldDegrees*Math.PI/180,theta=wearerDegrees*Math.PI/180;
 const eye=new Vec(80*Math.sin(theta),30,80*Math.cos(theta));
 const h={id:2,tracked:true,pinching:false,x:100,y:20,z:100};
 const r=new Runtime();Object.assign(r,{pad:null,hands:{samples:()=>[h]},overworld:{viewTurns:0,directionHeld:false,isMoving:()=>false},
   camera:{getTransform:()=>({getWorldPosition:()=>eye,forward:new Vec(0,0,1)})},
   compass:new ViewCompass(),spatialInput:new SpatialInput(),pinchJoystick:new PinchJoystick(),stick:new StickSource(),
   isGameBoyMode:()=>false,worldIsBusy:()=>false,viewRelativeControls:()=>true,
   dioramaCentre:()=>[0,0,0],dioramaAnchor:new Vec(0,0,0),dioramaYaw:()=>yaw,
   repaintNpcFacings:()=>{},sayRimHint:()=>{},onDioramaRim:()=>false,overDiorama:()=>false,
   stopSteering:()=>r.stick.release(),padShadowsTap:()=>false});
 r.updateCompass();r.stick.setViewTurns(r.overworld.viewTurns);
 r.driveWorldHands(1/60);h.pinching=true;r.driveWorldHands(1/60);
 // Push the hand away from this wearer's side of the table.
 h.x-=Math.sin(theta)*5;h.z-=Math.cos(theta)*5;
 for(let i=0;i<8;i++)r.driveWorldHands(1/60);
 const got=Overworld.heldDirection(r.stick,r.overworld.viewTurns);
 const upMap=turnPress('up',r.overworld.viewTurns);
 assert.equal(got,upMap,`hand and Xbox up disagree: world=${worldDegrees} wearer=${wearerDegrees}`);checks++;
 h.pinching=false;r.driveWorldHands(1/60);assert(!r.stick.isActive());checks++;
}
// Ensure the shipping frame order cannot regress to compensating against the
// previous compass and consuming against the new one.
const frame=method('onUpdate');
assert(frame.indexOf('this.updateCompass()')<frame.indexOf('this.stick.setViewTurns'));
assert(frame.indexOf('this.stick.setViewTurns')<frame.indexOf('this.input.update()'));checks+=2;
console.log('CONTROLS ORIENTATION:',checks,'checks passed');

import assert from 'node:assert/strict';
import { SpatialInput, PinchJoystick } from '../Scripts/play/SpatialInput.ts';
import { StickSource } from '../Scripts/play/StickSource.ts';
import { LooseButtons } from '../Scripts/play/screen/LooseButtons.ts';

let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
function rig() {
  const input = new SpatialInput(), stick = new StickSource(), joystick = new PinchJoystick();
  const hands = [1,2].map(id => ({id,tracked:true,pinching:false,x:0,y:0,z:0,target:''}));
  const seen = {taps:0, recalls:0, moves:[], spans:[]};
  const cb = {target:h=>h.target,blocked:false,walking:true,
    onStickStart:()=>joystick.reset(),
    onStick:(dx,dz,dt)=>stick.hold(joystick.aim(dx,dz,dt)),
    onStop:()=>{stick.release();joystick.reset();},
    onMove:(...v)=>seen.moves.push(v),onSpan:(...v)=>seen.spans.push(v),
    onTap:()=>seen.taps++,onRecall:()=>seen.recalls++};
  const step = (n=1) => {for(let i=0;i<n;i++)input.update(hands,1/60,cb);};
  step();
  return {input,stick,joystick,hands,seen,cb,step};
}

{
 const r=rig(),a=r.hands[0],b=r.hands[1];r.cb.walking=false;
 a.target='menu';a.pinching=true;r.step();a.target='';a.x+=4;r.step();
 check(r.seen.moves.at(-1)[0]==='menu'&&r.seen.moves.at(-1)[1]===4,'menu keeps drag ownership outside header');
 b.target='world';b.pinching=true;r.step();b.x+=7;r.step();
 check(!r.seen.spans.length&&r.seen.moves.every(m=>m[0]==='menu'),'other hand cannot turn a menu drag into world scaling');
 a.tracked=false;r.step();const count=r.seen.moves.length;a.tracked=true;a.x+=5;r.step();
 check(r.seen.moves.length===count,'lost menu hand must open before dragging again');
 a.pinching=false;b.pinching=false;r.step();check(!r.seen.taps,'menu drag never sends A on release');
}

// A hand beside the world starts neutral, walks promptly, stays held, releases without A.
for (const origin of [[0,0,0],[90,140,-80],[-300,25,10]]) {
  const r=rig(), h=r.hands[1]; [h.x,h.y,h.z]=origin; h.pinching=true; r.step();
  check(!r.stick.isActive(),'pinch position itself is neutral anywhere in the room');
  h.x+=5; r.step(4);
  check(r.stick.dpad().right,'movement starts within 67ms without a 600ms hold');
  r.step(120);check(r.stick.dpad().right,'a stationary displaced hand keeps walking');
  h.x=origin[0];r.step(12);check(!r.stick.isActive(),'return to the origin stops');
  h.z-=5;r.step(8);check(r.stick.dpad().up,'away from the origin means forward');
  h.pinching=false;r.step();check(!r.stick.isActive() && r.seen.taps===0,'release stops without A');
  check(r.seen.moves.length===0 && r.seen.spans.length===0,'walking never moves the world');
}
{
  const r=rig(),h=r.hands[1];h.pinching=true;r.step();h.x=5;r.step(6);
  h.tracked=false;r.step();check(!r.stick.isActive() && !r.seen.taps,'loss cancels without a tap');
  h.tracked=true;h.x=15;r.step(30);check(!r.stick.isActive(),'reacquired closed hand cannot resume');
  h.pinching=false;r.step();h.pinching=true;r.step();h.x+=5;r.step(5);
  check(r.stick.isActive(),'open then pinch permits a fresh origin');
}
{
  const r=rig(),h=r.hands[1];r.cb.blocked=true;h.pinching=true;r.step();r.cb.blocked=false;h.x=8;r.step(60);
  check(!r.stick.isActive() && !r.seen.taps,'UI-owned pinch stays owned after its pulse expires');
  h.pinching=false;r.step();h.pinching=true;r.step();h.x+=4;r.step(5);
  check(r.stick.isActive(),'a new pinch after a button needs no 900ms lockout');
  r.cb.walking=false;r.step();r.cb.walking=true;r.step(30);
  check(!r.stick.isActive(),'dialogue interrupt cannot silently resume walking');
}
{
  const r=rig(),h=r.hands[0];h.pinching=true;h.target='world';r.step();
  h.target='';h.x+=2;r.step();check(r.seen.moves.at(-1)[1]===2,'grip owns drag even after ray leaves it');
  check(!r.stick.isActive(),'world drag does not walk');
  const b=r.hands[1];b.x=20;b.target='world';b.pinching=true;r.step();
  b.x=22;r.step();check(r.seen.spans.length===1 && r.seen.spans[0][0]>1,'two grips scale continuously');
  b.z=2;r.step();check(r.seen.spans.at(-1)[1]!==0,'two grips rotate');
  b.pinching=false;const moves=r.seen.moves.length;r.step();h.x+=3;r.step();
  check(r.seen.moves.length===moves,'one remaining hand after a span cannot jump into dragging');
  h.pinching=false;r.step();check(!r.seen.taps,'grips never confirm on release');
}
{
  const r=rig(),a=r.hands[0],b=r.hands[1];a.pinching=true;r.step();a.x=4;r.step(8);
  b.pinching=true;b.target='world';r.step(2);b.x=10;r.step();
  check(r.seen.moves.length===0 && r.seen.spans.length===0,'second hand cannot steal joystick as world drag');
  a.tracked=false;r.step();check(!r.stick.isActive(),'hand loss cannot transfer joystick ownership');
}
{
  const r=rig(),a=r.hands[0],b=r.hands[1];a.pinching=true;b.pinching=true;r.step();a.x=3;b.x=-3;r.step(8);
  check(!r.seen.spans.length && !r.seen.moves.length,'two ordinary pinches never resize the world');
}
{
  const r=rig(),h=r.hands[1];h.target='controls';h.pinching=true;r.step();h.z-=3;r.step();
  check(r.seen.moves.at(-1)[0]==='controls','frame drag is a different owner from world drag');
  h.pinching=false;r.step();h.target='recall';h.pinching=true;r.step(40);
  check(r.seen.recalls===1 && !r.seen.taps,'recovery fires once per pinch');
}
{
  const r=rig(),h=r.hands[1];r.cb.walking=false;h.pinching=true;r.step(5);h.pinching=false;r.step();
  check(r.seen.taps===1,'a short new pinch can still advance dialogue');
  h.pinching=true;r.step();check(r.seen.taps===2,'dialogue confirms on the first pinch frame');
  r.step(120);check(r.seen.taps===2,'holding cannot repeat or skip dialogue');
  h.tracked=false;r.step();h.tracked=true;r.step(30);check(r.seen.taps===2,'tracking loss and closed-hand reacquisition never add confirmation');
}
{
  const j=new PinchJoystick();for(let i=0;i<15;i++)j.aim(5,0,1/60);
  for(let i=0;i<60;i++)check(j.aim(4,4+(i%2?0.15:-0.15),1/60)==='right','diagonal jitter preserves direction');
  for(let i=0;i<15;i++)j.aim(2,6,1/60);
  check(j.aim(2,6,1/60)==='down','deliberate axis change still works');
  j.reset();for(let i=0;i<60;i++)check(j.aim(0.7,-0.7,1/60)==='','small resting-hand jitter stays neutral');
}

{
  const r=rig(),h=r.hands[1];h.pinching=true;r.step();h.x=5;r.step(6);
  check(r.stick.isActive(),'walking before tracking discontinuity');
  h.x+=30;r.step();check(!r.stick.isActive(),'tracking jump stops walking in the same frame');
  r.step(30);check(!r.stick.isActive(),'tracking jump remains cancelled until release');
}

// Tap-versus-walk ownership, and the restored two-hand surface gesture.
{
  const r=rig(),h=r.hands[1];h.pinching=true;r.step(8);h.pinching=false;r.step();
  check(r.seen.taps===1 && !r.stick.isActive(),'short stationary pinch is A while free to walk');
  h.pinching=true;r.step();h.x+=4;r.step(4);h.x-=4;r.step(4);h.pinching=false;r.step();
  check(r.seen.taps===1,'moving out and back never becomes A');
  h.pinching=true;r.step(40);h.pinching=false;r.step();
  check(r.seen.taps===1,'a long neutral hold never becomes A');
}
for(const owner of ['', 'world', 'controls']) {
  const r=rig(),a=r.hands[0],b=r.hands[1];r.cb.overWorld=()=>true;
  a.target=owner;a.pinching=true;r.step();b.x=15;b.pinching=true;r.step();
  b.x+=2;r.step();
  check(r.seen.spans.length===(owner==='controls'?0:1),'two pinches over surface can span unless a UI drag owns them');
  b.pinching=false;r.step();a.x+=3;r.step();
  check(!r.stick.isActive(),'span release cannot leave a walking hand behind');
  a.pinching=false;r.step();check(!r.seen.taps,'surface gestures never confirm');
}
{
  const r=rig(),a=r.hands[0],b=r.hands[1];r.cb.overWorld=()=>true;
  a.pinching=true;r.step();r.cb.blocked=true;r.step();r.cb.blocked=false;
  b.pinching=true;b.x=15;r.step();b.x+=2;r.step();
  check(!r.seen.spans.length,'UI-cancelled pinch cannot join a span after suppression expires');
}

// Exercise the actual panel placement method: after placement both position and
// orientation stay unchanged by head motion, menus and world motion.
globalThis.vec2=class {constructor(x,y){Object.assign(this,{x,y});}};
globalThis.vec3=class {
  constructor(x,y,z){Object.assign(this,{x,y,z});}
  add(p){return new vec3(this.x+p.x,this.y+p.y,this.z+p.z);}
  uniformScale(s){return new vec3(this.x*s,this.y*s,this.z*s);}
};
{
  const p=Object.create(LooseButtons.prototype);let pos=new vec3(0,0,0),writes=0,faces=0;
  const transform={getWorldPosition:()=>pos,setWorldPosition:v=>{pos=v;writes++;},right:new vec3(1,0,0),up:new vec3(0,1,0)};
  p.root={enabled:true,getTransform:()=>transform};p.frameWidth=12;p.frameHeight=10;p.lostSeconds=0;p.following=false;
  p.recallHandle={enabled:()=>{},place:()=>{}};p.faceEye=()=>faces++;
  let eye=new vec3(0,150,0);let f=new vec3(0,0,1);
  const camera={getTransform:()=>({getWorldPosition:()=>eye,forward:f,getInvertedWorldTransform:()=>({multiplyPoint:p=>p}),getWorldTransform:()=>({multiplyPoint:p=>p})}),screenSpaceToWorldSpace:(p,z)=>new vec3((p.x-.5)*z,(.5-p.y)*z,-z),worldSpaceToScreenSpace:()=>({x:0.5,y:0.6})};
  p.follow(camera,1/60,new vec3(0,100,-80));const start=pos;
  check(writes===1 && faces===1,'frame initially placed once');
  eye=new vec3(30,170,10);f=new vec3(0.2,0,0.98);
  for(let i=0;i<120;i++)p.follow(camera,1/60,new vec3(50,80,-100));
  check(pos===start && writes===1 && faces===1,'head and world movement cannot chase the frame');
  p.setEnabled(false);p.setEnabled(true);p.follow(camera,1/60,null);
  check(writes===1,'menus preserve frame placement');
  p.moveBy(new vec3(10,0,0));check(pos.x===start.x+10,'explicit grip movement moves frame');
  p.recall();p.follow(camera,1/60,null);check(writes===3 && faces===3,'only explicit drag and recovery reposition the frame');
}
console.log(`SPATIAL CONTROLS: ${checks} checks passed`);

// Before surface tracking settles, a wearer looking down still sees the world.
const {DioramaPlacer}=await import('../Scripts/play/DioramaPlacer.ts');
for(const editor of [true,false])for(const pitch of [0,0.3,0.7,1.2]){
 globalThis.deviceInfoSystem={isEditor:()=>editor};
 let placed;const forward=new vec3(0,Math.sin(pitch),Math.cos(pitch));
 const c={getTransform:()=>({getWorldPosition:()=>new vec3(0,0,0),forward})};
 const p=new DioramaPlacer({getTransform:()=>({setWorldPosition:v=>placed=v})},c);
 p.placeInFront();
 check(placed.y<=-105*Math.sin(pitch)+1e-6,'fallback follows downward gaze');
 check(placed.z<=0&&Number.isFinite(placed.y),'finite placement ahead');
}
console.log(`SPATIAL CONTROLS EXTENDED: ${checks} checks passed`);

// Overlapping fingertip volumes choose one direction and retain it through boundary jitter.
const {FingerPresser}=await import('../Scripts/play/Pressable.ts');
{
 const held=new Set();const fingers=new FingerPresser({press:n=>held.add(n),release:n=>held.delete(n)});
 function target(name,x,y){return {box:{name,width:3,height:3,depth:1},holder:{isEnabledInHierarchy:true,getTransform:()=>({getInvertedWorldTransform:()=>({multiplyPoint:p=>new vec3(p.x-x,p.y-y,p.z)})})}};}
 fingers.add(target('down',0,-1));fingers.add(target('right',1,0));
 fingers.update([new vec3(.7,-1.1,0)]);check(held.has('down')&&held.size===1,'one fingertip presses only intended down');
 fingers.update([new vec3(.8,-.7,0)]);check(held.has('down')&&held.size===1,'boundary jitter retains down');
 fingers.update([]);check(!held.size,'lifting finger releases direction');
 fingers.update([new vec3(1.1,0,0)]);check(held.has('right')&&held.size===1,'deliberate new touch selects right');
}
console.log(`SPATIAL CONTROLS FINAL: ${checks} checks passed`);

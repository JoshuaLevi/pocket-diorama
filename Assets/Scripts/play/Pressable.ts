// A pressable volume: a box collider carrying a SIK Interactable whose
// trigger is one button of a PanelSource.
//
// The face plate (PadPanelView) and the Game Boy the setup pages live in
// (GameBoyShell) both build their buttons out of these, so the three ways of
// pressing are decided in one place and each is treated by what it can do:
//   a hand      onTriggerStart .. onTriggerEnd    -> held until released
//   the mouse   onTriggerStart only, measured     -> one pulse per click
//   anything    onHoverExit / onTriggerCanceled   -> released, always
//
// Measured on SIK 0.18: the editor's MouseInteractor only fires a trigger for
// a click on a button it was ALREADY hovering. A real mouse hovers first (the
// runtime's HoverEvent), so a person clicking a button gets the press; a
// synthetic tap that lands cold gets only the hover, and needs a second tap.
// That is how InjectPreviewGesture has to drive these: park, then tap.
//
// The SIK Interactable is required by name inside a try, because the 5.15
// project takes its own SIK and a mismatch there must cost a plate its
// buttons, not the lens its start. The keyboard keeps working either way.

import { PanelSource, HOLD_UNTIL_RELEASED, MOUSE_PULSE_SECONDS } from "./PadPanel";

/** SIK's InteractorInputType.Mouse, for a build where the enum cannot be read. */
const INPUT_TYPE_MOUSE: number = 32;

/** What SIK gave us: the Interactable class (or null) and the mouse's input type. */
export interface PressableKit {
  interactable: any;
  mouseType: number;
}

/** One volume: centre and size in centimetres, in the parent's own axes. */
export interface PressableBox {
  name: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  /** What the volume stands for when that is not just its button: "lcd". */
  tag?: string;
}

/** What makePressable built: the holder, and whether SIK will press it. */
export interface Pressable {
  holder: SceneObject;
  box: PressableBox;
  wired: boolean;
}

/** Loads SIK once for a set of buttons. `tag` names the caller in the log. */
export function loadPressableKit(tag: string): PressableKit {
  let interactable: any = null;
  let mouseType: number = INPUT_TYPE_MOUSE;
  try {
    const module: any = require(
      "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
    );
    interactable = module ? module.Interactable : null;
  } catch (e) {
    print("[" + tag + "] SIK Interactable unavailable (" + e + "); keyboard only");
  }
  try {
    const types: any = require("SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor");
    if (types && types.InteractorInputType && typeof types.InteractorInputType.Mouse === "number") {
      mouseType = types.InteractorInputType.Mouse;
    }
  } catch (e) {
    // The baked constant stands.
  }
  return { interactable: interactable, mouseType: mouseType };
}

/**
 * Builds one volume under `parent` whose presses go to `source` as
 * `box.name`. `wired` is true when SIK will deliver them; false leaves a
 * collider that nothing can press, which is what a build without SIK gets.
 */
export function makePressable(kit: PressableKit, parent: SceneObject, box: PressableBox,
                              source: PanelSource, tag: string): Pressable {
  const holder = global.scene.createSceneObject(tag + "_" + box.name);
  holder.setParent(parent);
  holder.getTransform().setLocalPosition(new vec3(box.x, box.y, box.z));

  const collider = holder.createComponent("Physics.ColliderComponent") as ColliderComponent;
  const shape = Shape.createBoxShape();
  shape.size = new vec3(box.width, box.height, box.depth);
  collider.shape = shape;
  collider.fitVisual = false;
  collider.debugDrawEnabled = false;

  const made: Pressable = { holder: holder, box: box, wired: false };
  if (!kit.interactable) {
    return made;
  }
  try {
    const interactable: any = holder.createComponent(kit.interactable.getTypeName());
    wire(interactable, box.name, kit.mouseType, source);
    // SIK fills `colliders` when the interactable wakes. Under an enabled
    // parent that is now, and zero means nothing can ever hit this button;
    // under a disabled one (the Game Boy before its entrance) it wakes with
    // the parent and finds the collider then, so there is nothing to report.
    const count = interactable.colliders ? interactable.colliders.length : -1;
    if (count !== 1 && holder.isEnabledInHierarchy) {
      print("[" + tag + "] " + box.name + " registered with " + count + " colliders");
    }
    made.wired = true;
  } catch (e) {
    print("[" + tag + "] could not wire " + box.name + ": " + e);
  }
  return made;
}

// ------------------------------------------------------- the editor's mouse
//
// SIK's MouseInteractor only presses a button it was already hovering, and
// in the 5.15 project's SIK (0.16.4) the hover moves only with a touch: a
// first click parks the cursor and the second one presses. A person testing
// in the preview clicks once and sees nothing happen. TouchPresser is the
// editor's own path: on the touch that starts a click it casts the ray from
// the camera through the click and presses the first volume it meets, as a
// mouse pulse. A press SIK also delivers for the same click is a repeat of
// the same pulse, which PanelSource extends rather than doubles. Never on
// the glasses: there the hands press through SIK, and there is no mouse.

/** Where a ray meets an axis-aligned box about the origin: the distance along it, or -1. */
export function rayHitsBox(origin: number[], direction: number[], half: number[]): number {
  let near = -Infinity;
  let far = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const o = origin[axis];
    const d = direction[axis];
    const h = half[axis];
    if (Math.abs(d) < 1e-9) {
      if (o < -h || o > h) {
        return -1;
      }
      continue;
    }
    let t0 = (-h - o) / d;
    let t1 = (h - o) / d;
    if (t0 > t1) {
      const swap = t0;
      t0 = t1;
      t1 = swap;
    }
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) {
      return -1;
    }
  }
  if (far < 0) {
    return -1;
  }
  return near >= 0 ? near : 0;
}

export class TouchPresser {
  private targets: Pressable[] = [];
  private bound: boolean = false;
  private script: ScriptComponent;
  private camera: Camera;
  private source: PanelSource;
  private allow: (box: PressableBox) => boolean;

  /**
   * `allow` is asked before a press, with the box: PokemonAR keeps a click
   * on the LCD from being A while the code grid is up, where A would type.
   */
  constructor(script: ScriptComponent, camera: Camera, source: PanelSource,
              allow: (box: PressableBox) => boolean = () => true) {
    this.script = script;
    this.camera = camera;
    this.source = source;
    this.allow = allow;
  }

  /** Whether this path is wanted at all: the editor has a mouse, the glasses do not. */
  static wanted(): boolean {
    try {
      const info: any = (global as any).deviceInfoSystem;
      return !!(info && typeof info.isEditor === "function" && info.isEditor());
    } catch (e) {
      return false;
    }
  }

  add(target: Pressable): void {
    this.targets.push(target);
  }

  /** Starts listening. Idempotent. */
  bind(): void {
    if (this.bound) {
      return;
    }
    this.bound = true;
    this.script.createEvent("TouchStartEvent").bind((ev: TouchStartEvent) => this.onTouch(ev));
  }

  private onTouch(ev: TouchStartEvent): void {
    const pos = ev.getTouchPosition();
    const near = this.camera.screenSpaceToWorldSpace(pos, 1);
    const far = this.camera.screenSpaceToWorldSpace(pos, 500);
    const hit = this.pick(near, far);
    if (hit && this.allow(hit.box)) {
      this.source.press(hit.box.name, MOUSE_PULSE_SECONDS);
    }
  }

  /** The nearest enabled volume along the ray from `near` to `far`, or null. */
  pick(near: vec3, far: vec3): Pressable | null {
    let best: Pressable = null;
    let bestT = Infinity;
    for (let i = 0; i < this.targets.length; i++) {
      const target = this.targets[i];
      if (!target.holder.isEnabledInHierarchy) {
        continue;
      }
      const inv = target.holder.getTransform().getInvertedWorldTransform();
      const o = inv.multiplyPoint(near);
      const p = inv.multiplyPoint(far);
      const d = [p.x - o.x, p.y - o.y, p.z - o.z];
      const t = rayHitsBox([o.x, o.y, o.z], d,
                           [target.box.width / 2, target.box.height / 2, target.box.depth / 2]);
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = target;
      }
    }
    return best;
  }
}

// ------------------------------------------------------------ a fingertip
//
// SIK presses these volumes with a PINCH: its ray meets the collider and the
// pinch is the trigger. On the glasses of 30 September that was the only way
// -- a finger pushed against a button did nothing -- and a button is a thing
// you press. FingerPresser is the lens's own path for that: each frame it
// takes the tracked index fingertips (the same HandInputData DioramaHands
// reads) into each volume's own axes and holds the button while a tip is
// over it and near its face. A pinch still works; the two agree, because a
// press of a button that is already down is not a second press.

/**
 * A tip presses once it is this near the volume's middle plane (which
 * stands a little proud of the button's face), counted toward the wearer...
 */
export const FINGER_PRESS_CM: number = 0.4;
/** ...and lets go only once it has withdrawn past this, so a trembling hand does not stutter. */
export const FINGER_RELEASE_CM: number = 1.0;
/** A button that is down forgives this much sideways drift of the tip. */
export const FINGER_SIDE_SLACK_CM: number = 0.5;
/** How far behind the volume's back a tip may be and still be a press, not a hand behind the Game Boy. */
export const FINGER_THROUGH_CM: number = 3;

/**
 * Whether a fingertip at `local` -- centimetres about the volume's centre,
 * +z toward the wearer -- holds the button, given whether it held it last
 * frame. Pure, so the feel of a press is stated in a test.
 */
export function fingerHolds(local: number[], half: number[], wasHeld: boolean): boolean {
  const slack = wasHeld ? FINGER_SIDE_SLACK_CM : 0;
  if (Math.abs(local[0]) > half[0] + slack || Math.abs(local[1]) > half[1] + slack) {
    return false;
  }
  if (local[2] < -half[2] - FINGER_THROUGH_CM) {
    return false;
  }
  return local[2] <= (wasHeld ? FINGER_RELEASE_CM : FINGER_PRESS_CM);
}

export class FingerPresser {
  private targets: Pressable[] = [];
  private held: boolean[] = [];
  private source: PanelSource;

  constructor(source: PanelSource) {
    this.source = source;
  }

  add(target: Pressable): void {
    this.targets.push(target);
    this.held.push(false);
  }

  /**
   * One frame: `tips` are the tracked index fingertips in world space.
   * Returns how many buttons a finger is holding. A volume that is switched
   * off lets go of whatever a finger had on it.
   */
  update(tips: vec3[]): number {
    const next=this.targets.map(()=>false);
    for(const tip of tips) {
      let best=-1,score=Infinity;
      for(let i=0;i<this.targets.length;i++) {
        const target=this.targets[i];if(!target.holder.isEnabledInHierarchy)continue;
        const p=target.holder.getTransform().getInvertedWorldTransform().multiplyPoint(tip);
        const half=[target.box.width/2,target.box.height/2,target.box.depth/2];
        if(!fingerHolds([p.x,p.y,p.z],half,this.held[i]))continue;
        const candidate=(this.held[i]?-100:0)+(p.x/half[0])**2+(p.y/half[1])**2;
        if(candidate<score){score=candidate;best=i;}
      }
      if(best>=0)next[best]=true;
    }
    // Aggregate names: releasing one surface cannot release the same button held on another.
    const before:{[key:string]:boolean}={},after:{[key:string]:boolean}={};
    this.targets.forEach((target,i)=>{
      before[target.box.name]=before[target.box.name]||this.held[i];
      after[target.box.name]=after[target.box.name]||next[i];
    });
    for(const name in after) {
      if(after[name]&&!before[name])this.source.press(name,HOLD_UNTIL_RELEASED);
      else if(!after[name]&&before[name])this.source.release(name);
    }
    this.held=next;
    return next.filter(Boolean).length;
  }

}

function wire(interactable: any, name: string, mouseType: number, source: PanelSource): void {
  interactable.onTriggerStart.add((args: any) => {
    const interactor = args ? args.interactor : null;
    const isMouse = interactor && interactor.inputType === mouseType;
    source.press(name, isMouse ? MOUSE_PULSE_SECONDS : HOLD_UNTIL_RELEASED);
  });
  const release = () => { source.release(name); };
  interactable.onTriggerEnd.add(release);
  interactable.onTriggerCanceled.add(release);
  interactable.onHoverExit.add(release);
}

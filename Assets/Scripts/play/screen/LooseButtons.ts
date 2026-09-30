import { fitInView } from "./ViewPlacement";
// Compact Game Boy controls in a movable frame, anchored in the room after placement.

import { SpatialHandle, spatialRects, spatialMaterial } from "./SpatialHandle";
import type { HandSample } from "../SpatialInput";
import type { PanelSource } from "../PadPanel";
import type { TouchPresser, FingerPresser } from "../Pressable";
import type { ViewSettings } from "./ViewOptions";
import { looseButtonsShown } from "./ViewOptions";
import { GameBoyShell, buttonBoxes, modelToCm, MODEL_SCALE, MODEL_LCD_CENTRE } from "./GameBoyShell";
import { GameBoyLabels, sheetSlots, labelSizeCm, FACE_Z } from "./GameBoyLabels";
import { ButtonCaps } from "./ButtonCaps";
import { BUTTON_UP, BUTTON_DOWN, BUTTON_LEFT, BUTTON_RIGHT } from "../PadPanel";

/** How far ahead of the eye the group hangs: inside an arm's reach. */
export const LOOSE_AHEAD_CM: number = 50;
/** Below the direction of the world's centre by this much... */
export const RIDE_BELOW_WORLD_DEGREES: number = 9;
/** ...and never above, or below, these. The editor's camera sees less far down. */
export const RIDE_MIN_DEGREES: number = 12;
export const RIDE_MAX_DEGREES: number = 40;
export const RIDE_MAX_EDITOR_DEGREES: number = 15;
/** The face is tipped up toward the eye by this much, like a tray held out. */
export const LOOSE_TILT_DEGREES: number = 40;
/** The group re-centres only once the head has moved this far from its spot. */
export const LOOSE_DEADBAND_CM: number = 14;
/** Fraction of the remaining distance closed per second, as a time constant. */
export const LOOSE_SETTLE_SECONDS: number = 0.35;

export interface LooseBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The box round all eight buttons, in the shell's own centimetres. */
export function looseButtonsBounds(): LooseBounds {
  const boxes = buttonBoxes();
  const out: LooseBounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    out.minX = Math.min(out.minX, b.x - b.width / 2);
    out.maxX = Math.max(out.maxX, b.x + b.width / 2);
    out.minY = Math.min(out.minY, b.y - b.height / 2);
    out.maxY = Math.max(out.maxY, b.y + b.height / 2);
  }
  return out;
}

/**
 * The middle of the group in the shell's centimetres. The shell's origin is
 * between its LCD and its buttons; with no LCD the group is hung by its own
 * middle instead.
 */
export function looseButtonsCentreCm(): number[] {
  const b = looseButtonsBounds();
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

/**
 * The chip each button sits on: a piece of the Game Boy's pale shell, a
 * little larger than the button and its print together.
 *
 * It is there because of the display, not the design. The glasses draw with
 * light, so black is see-through: the model's near-black D-pad and its
 * maroon and slate print, with no body behind them, would hang in the air
 * as a ghost of a control. On the Game Boy they are dark on pale grey; the
 * chip keeps exactly that, one button at a time, and nothing joins them up.
 */
export interface Chip {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}
/** The shell's own pale grey. */
export const CHIP_RGB: number[] = [206, 202, 196];
/** How far a chip reaches past what stands on it. */
export const CHIP_MARGIN_CM: number = 0.22;

/** The five chips, in the shell's centimetres: the cross, A, B, SELECT, START. */
export function looseChips(): Chip[] {
  const boxes = buttonBoxes();
  const slots = sheetSlots();
  const arms = [BUTTON_UP, BUTTON_DOWN, BUTTON_LEFT, BUTTON_RIGHT];
  const order = ["dpad", "a", "b", "select", "start"];
  const chips: Chip[] = [];
  for (let n = 0; n < order.length; n++) {
    const name = order[n];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const take = (x: number, y: number, w: number, h: number): void => {
      minX = Math.min(minX, x - w / 2);
      maxX = Math.max(maxX, x + w / 2);
      minY = Math.min(minY, y - h / 2);
      maxY = Math.max(maxY, y + h / 2);
    };
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const mine = name === "dpad" ? arms.indexOf(b.name) >= 0 : b.name === name;
      if (mine) {
        take(b.x, b.y, b.width, b.height);
      }
    }
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].label.text.toLowerCase() === name) {
        const at = modelToCm(slots[i].label.x, slots[i].label.y);
        const size = labelSizeCm(slots[i]);
        take(at[0], at[1], size[0], size[1]);
      }
    }
    const width = maxX - minX + 2 * CHIP_MARGIN_CM;
    const height = maxY - minY + 2 * CHIP_MARGIN_CM;
    chips.push({
      name: name,
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      width: width,
      height: height,
      // A softened square for the cross, a capsule under the round buttons,
      // and corners small enough under the two words that no letter is cut.
      radius: Math.min(width, height) * (name === "dpad" ? 0.22 : name === "a" || name === "b" ? 0.45 : 0.18),
    });
  }
  return chips;
}

/**
 * A chip as one triangle fan at depth `z`: its centre, then `segments`
 * steps round each of the four corners.
 */
export function roundedRectMesh(chip: Chip, z: number, segments: number): { positions: number[]; indices: number[] } {
  const positions: number[] = [chip.x, chip.y, z];
  const hx = chip.width / 2 - chip.radius;
  const hy = chip.height / 2 - chip.radius;
  // Corner centres, anticlockwise from the top right, and where each arc starts.
  const corners = [[hx, hy, 0], [-hx, hy, 90], [-hx, -hy, 180], [hx, -hy, 270]];
  for (let c = 0; c < corners.length; c++) {
    for (let i = 0; i <= segments; i++) {
      const a = (corners[c][2] + 90 * i / segments) * Math.PI / 180;
      positions.push(chip.x + corners[c][0] + chip.radius * Math.cos(a),
                     chip.y + corners[c][1] + chip.radius * Math.sin(a), z);
    }
  }
  const rim = corners.length * (segments + 1);
  const indices: number[] = [];
  for (let i = 0; i < rim; i++) {
    indices.push(0, 1 + i, 1 + (i + 1) % rim);
  }
  return { positions: positions, indices: indices };
}

/**
 * Degrees below the eye line at which the group hangs, given where the
 * world is: a little under its centre, clamped so a world at the wearer's
 * feet cannot swing the buttons out of reach.
 */
export function rideAngleDegrees(eye: number[], worldCentre: number[], editor: boolean): number {
  const max = editor ? RIDE_MAX_EDITOR_DEGREES : RIDE_MAX_DEGREES;
  let deg = RIDE_MAX_DEGREES;
  if (worldCentre) {
    const dx = worldCentre[0] - eye[0];
    const dz = worldCentre[2] - eye[2];
    const flat = Math.sqrt(dx * dx + dz * dz);
    const down = eye[1] - worldCentre[1];
    deg = Math.atan2(down, Math.max(flat, 1)) * 180 / Math.PI + RIDE_BELOW_WORLD_DEGREES;
  }
  return deg < RIDE_MIN_DEGREES ? RIDE_MIN_DEGREES : deg > max ? max : deg;
}

/** Where the group's middle goes: LOOSE_AHEAD_CM from the eye, along the flat heading, `degrees` down. */
export function rideTarget(eye: number[], heading: number[], degrees: number): number[] {
  const a = degrees * Math.PI / 180;
  return [
    eye[0] + heading[0] * LOOSE_AHEAD_CM * Math.cos(a),
    eye[1] - LOOSE_AHEAD_CM * Math.sin(a),
    eye[2] + heading[1] * LOOSE_AHEAD_CM * Math.cos(a),
  ];
}

/**
 * Whether the loose buttons belong on screen this frame.
 *
 * `gameBoyOnScreen` is the Game Boy itself being in view -- the title, the
 * naming screen, GAME BOY mode -- where its own buttons are real and a second
 * set beside them would be two A buttons to choose between.
 */
export function looseButtonsWanted(settings: ViewSettings, controllerConnected: boolean,
                                   gameBoyOnScreen: boolean): boolean {
  if (gameBoyOnScreen) {
    return false;
  }
  return looseButtonsShown(settings, controllerConnected);
}

function isEditor(): boolean {
  try {
    const system: any = (global as any).deviceInfoSystem;
    return !!(system && system.isEditor && system.isEditor());
  } catch (e) {
    return false;
  }
}

/**
 * The group in the scene: a root this places, and under it a buttons-only
 * shell shifted so the group's middle is the root's origin.
 */
export class LooseButtons {
  private root: SceneObject;
  private shell: GameBoyShell;
  /** The shaded caps on A, B, SELECT and START: the same ones the Game Boy wears. */
  private caps: ButtonCaps;
  private wired: number = 0;
  private following: boolean = false;
  private handle: SpatialHandle;
  private recallHandle: SpatialHandle;
  private frameWidth: number = 0;
  private frameHeight: number = 0;
  private grips: SpatialHandle[] = [];
  private lostSeconds = 0;
  private eye: vec3 = null;

  constructor(parent: SceneObject, prefab: ObjectPrefab, source: PanelSource,
              makeDecal: (texture: Texture) => Material,
              makeFlat: (texture: Texture) => Material, presser: TouchPresser = null,
              fingers: FingerPresser = null) {
    this.root = global.scene.createSceneObject("LooseButtons");
    this.root.setParent(parent);
    this.shell = new GameBoyShell(this.root, prefab, null, true);
    const c = looseButtonsCentreCm();
    this.shell.root.getTransform().setLocalPosition(new vec3(-c[0], -c[1], 0));
    this.shell.setEnabled(true);
    // Under each button its chip of pale shell, then the same print as on
    // the Game Boy: A, B, SELECT, START.
    LooseButtons.buildChips(this.shell.body(), makeFlat);
    new GameBoyLabels(this.shell.body(), makeDecal);
    this.caps = new ButtonCaps(this.shell.body(), makeDecal);
    this.wired = this.shell.buildButtons(source, presser, false, fingers);
    // Scale the complete group, including button colliders, together.
    this.root.getTransform().setLocalScale(new vec3(0.65, 0.65, 0.65));
    const chips = looseChips();
    const left = Math.min(...chips.map(b => b.x-b.width/2))-c[0]-0.7;
    const right = Math.max(...chips.map(b => b.x+b.width/2))-c[0]+0.7;
    const bottom = Math.min(...chips.map(b => b.y-b.height/2))-c[1]-0.7;
    const top = Math.max(...chips.map(b => b.y+b.height/2))-c[1]+0.7;
    this.frameWidth = (right-left)*0.65;
    this.frameHeight = (top-bottom+3)*0.65;
    const z = (FACE_Z-MODEL_LCD_CENTRE[2])*MODEL_SCALE;
    spatialRects(this.root, "ControlsFrame", [
      [(left+right)/2,top,right-left,0.2,z], [(left+right)/2,bottom,right-left,0.2,z],
      [left,(top+bottom)/2,0.2,top-bottom,z], [right,(top+bottom)/2,0.2,top-bottom,z],
    ], spatialMaterial(makeFlat));
    this.handle = new SpatialHandle(this.root,"ControlsGrip",8,2,makeFlat,"MOVE");
    this.handle.root.getTransform().setLocalPosition(new vec3((left+right)/2,bottom-1.7,z));
    for (const edge of [[(left+right)/2,top+0.6,right-left+2,1.6],
      [(left+right)/2,bottom-0.6,right-left+2,1.6],
      [left-0.6,(top+bottom)/2,1.6,top-bottom], [right+0.6,(top+bottom)/2,1.6,top-bottom]]) {
      const grip = new SpatialHandle(this.root,"ControlsEdge",edge[2],edge[3],makeFlat,"");
      grip.root.getTransform().setLocalPosition(new vec3(edge[0],edge[1],z));
      this.grips.push(grip);
    }
    this.recallHandle = new SpatialHandle(parent,"RecallControls",7,2,makeFlat,"CONTROLS");
    this.recallHandle.enabled(false);
    print("[SpatialControls] compact anchored frame; grips=" + this.handle.wired + ", recall=" + this.recallHandle.wired);
    // Clone imported materials: controls are legible in front of scene geometry.
    const overlay = (o: SceneObject) => {
      const visuals = o.getComponents("Component.RenderMeshVisual") as RenderMeshVisual[];
      for (const v of visuals) {
        const materials: Material[] = [];
        for (let i=0;i<v.getMaterialsCount();i++) {
          const m=o.name.indexOf("Controls")===0 ? v.getMaterial(i) : v.getMaterial(i).clone();m.mainPass.depthTest=false;m.mainPass.depthWrite=false;
          materials.push(m);
        }
        v.clearMaterials();for(const m of materials)v.addMaterial(m);
        v.renderOrder = o.name.indexOf("Chip")>=0 ? 108 : o.name.indexOf("Cap")>=0 ? 112 : 110;
      }
      for(let i=0;i<o.getChildrenCount();i++)overlay(o.getChild(i));
    };
    overlay(this.root);
    overlay(this.recallHandle.root);
    this.root.enabled = false;
  }

  /** The five chips as one mesh on the face plane, behind the print and under the buttons. */
  private static buildChips(parent: SceneObject, makeFlat: (texture: Texture) => Material): void {
    const texture = ProceduralTextureProvider.createWithFormat(1, 1, TextureFormat.RGBA8Unorm);
    (texture.control as ProceduralTextureProvider).setPixels(0, 0, 1, 1,
      new Uint8Array([CHIP_RGB[0], CHIP_RGB[1], CHIP_RGB[2], 255]));
    const builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    builder.topology = MeshTopology.Triangles;
    builder.indexType = MeshIndexType.UInt16;
    // The shell's face, in the body holder's centimetres: where the print lies, less a hair.
    const z = (FACE_Z - MODEL_LCD_CENTRE[2]) * MODEL_SCALE;
    const chips = looseChips();
    const verts: number[] = [];
    const indices: number[] = [];
    let base = 0;
    for (let i = 0; i < chips.length; i++) {
      const mesh = roundedRectMesh(chips[i], z, 6);
      for (let v = 0; v < mesh.positions.length; v += 3) {
        verts.push(mesh.positions[v], mesh.positions[v + 1], mesh.positions[v + 2], 0.5, 0.5);
      }
      for (let k = 0; k < mesh.indices.length; k++) {
        indices.push(base + mesh.indices[k]);
      }
      base += mesh.positions.length / 3;
    }
    builder.appendVerticesInterleaved(verts);
    builder.appendIndices(indices);
    const object = global.scene.createSceneObject("LooseButtonChips");
    object.setParent(parent);
    const visual = object.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mesh = builder.getMesh();
    builder.updateMesh();
    visual.mainMaterial = makeFlat(texture);
  }

  /** How many of the eight got a working SIK interactable. */
  wiredButtons(): number {
    return this.wired;
  }

  setEnabled(on: boolean): void {
    if (this.root.enabled === on) {
      return;
    }
    this.root.enabled = on;
    // Preserve placement across menus, controller changes and battles.
    if (!on) this.recallHandle.enabled(false);
  }

  isEnabled(): boolean {
    return this.root.enabled;
  }

  /** The buttons sink under whatever holds them; returns how many went down this frame. */
  press(source: PanelSource, dt: number): number {
    this.caps.update(source);
    return this.shell.pressButtons(source, dt);
  }

  /** Initial placement only. Head movement never changes an already placed frame. */
  follow(camera: Camera, dt: number, worldCentre: vec3): void {
    if (!camera) return;
    const ct = camera.getTransform(), eye = ct.getWorldPosition();
    this.eye=eye;
    const f = ct.forward;
    const length = Math.sqrt(f.x*f.x+f.z*f.z);
    if (length < 0.001) return;
    const hx = -f.x/length, hz = -f.z/length;
    if (!this.following) {
      // Use the current camera pitch for initial placement and explicit recall.
      // A horizontal-world angle can put the frame above a downward-looking
      // wearer's view. Once placed, this transform remains anchored in the room.
      const at = camera.screenSpaceToWorldSpace(new vec2(0.26,0.78),85);
      this.root.getTransform().setWorldPosition(at); this.faceEye(eye,at);
      fitInView(camera,this.root,this.frameWidth,this.frameHeight);
      this.following = true;
    }
    // Actual corner bounds, camera-local front test and delay avoid a flickering recall tab.
    const transform=this.root.getTransform();
    const point=transform.getWorldPosition();
    const front=ct.getInvertedWorldTransform().multiplyPoint(point).z<0;
    const projected=[[-this.frameWidth/2,-this.frameHeight/2],[this.frameWidth/2,this.frameHeight/2],
      [-this.frameWidth/2,this.frameHeight/2],[this.frameWidth/2,-this.frameHeight/2]].map(p=>
      camera.worldSpaceToScreenSpace(point.add(transform.right.uniformScale(p[0])).add(transform.up.uniformScale(p[1]))));
    const visible=front && Math.min(...projected.map(p=>p.x))>0.01 && Math.max(...projected.map(p=>p.x))<0.99 &&
      Math.min(...projected.map(p=>p.y))>0.01 && Math.max(...projected.map(p=>p.y))<0.99;
    this.lostSeconds=visible?0:this.lostSeconds+dt;
    const lost=this.lostSeconds>0.8;
    this.recallHandle.enabled(lost);
    if (lost) {
      // Only the small recovery tab follows the head, and only while the
      // actual controls are outside the view. It never brings them back itself.
      const at = ct.getWorldTransform().multiplyPoint(new vec3(8,-8,-65));
      this.recallHandle.place(at,eye);
    }
  }

  target(hand: HandSample): "controls" | "recall" | "" {
    if (!this.isEnabled()) return "";
    if (this.handle.targeted(hand) || this.grips.some(g=>g.targeted(hand))) return "controls";
    return this.recallHandle.targeted(hand) ? "recall" : "";
  }
  moveBy(delta: vec3): void {
    const t = this.root.getTransform(); t.setWorldPosition(t.getWorldPosition().add(delta));
    if(this.eye)this.faceEye(this.eye,t.getWorldPosition());
  }
  highlight(held: boolean): void { this.handle.highlight(held); this.grips.forEach(g=>g.highlight(held)); this.recallHandle.highlight(false); }
  recall(): void { this.following = false; this.lostSeconds=0; }

  /** Keep reading surfaces above this freely placed frame, without moving the user's controls. */
  avoidPanel(object: SceneObject, width: number, height: number): void {
    if(!this.isEnabled()||!object.enabled)return;
    const panel=object.getTransform(), controls=this.root.getTransform();
    const inv=panel.getInvertedWorldTransform();
    const corners=[[-this.frameWidth/2,-this.frameHeight/2],[this.frameWidth/2,this.frameHeight/2],
      [-this.frameWidth/2,this.frameHeight/2],[this.frameWidth/2,-this.frameHeight/2]].map(p=>
      inv.multiplyPoint(controls.getWorldPosition().add(controls.right.uniformScale(p[0])).add(controls.up.uniformScale(p[1]))));
    const x0=Math.min(...corners.map(p=>p.x)),x1=Math.max(...corners.map(p=>p.x));
    const y0=Math.min(...corners.map(p=>p.y)),y1=Math.max(...corners.map(p=>p.y));
    if(x1>-width/2-1&&x0<width/2+1&&y1>-height/2-2&&y0<height/2+2)
      panel.setWorldPosition(panel.getWorldPosition().add(panel.up.uniformScale(y1+height/2+2)));
  }

  /**
   * Tips the face up toward the eye. The buttons' face looks along the
   * root's +Z, as the plate's did, so this is the plate's own basis: the
   * normal LOOSE_TILT_DEGREES off vertical toward the wearer.
   */
  private faceEye(eye: vec3, at: vec3): void {
    let hx = eye.x - at.x;
    let hz = eye.z - at.z;
    const hl = Math.sqrt(hx * hx + hz * hz);
    if (hl < 1e-4) {
      return;
    }
    hx /= hl;
    hz /= hl;
    const tilt = LOOSE_TILT_DEGREES * Math.PI / 180;
    const n = new vec3(hx * Math.sin(tilt), Math.cos(tilt), hz * Math.sin(tilt));
    const r = new vec3(hz, 0, -hx);
    const u = n.cross(r);
    const transform = this.root.getTransform();
    let rotation = quat.lookAt(n, u);
    transform.setWorldRotation(rotation);
    // lookAt's convention differs between engines; if it faced the buttons
    // away, they would be pressed from behind. Check and flip.
    const f = transform.forward;
    if (f.x * n.x + f.y * n.y + f.z * n.z < 0) {
      rotation = quat.lookAt(new vec3(-n.x, -n.y, -n.z), u);
      transform.setWorldRotation(rotation);
    }
  }
}

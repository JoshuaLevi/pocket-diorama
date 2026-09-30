// The Game Boy the screen lives in, and how it arrives.
//
// Until 28 September the Game Boy screen was a bare quad hanging on the line
// of sight. The first thing a new wearer now sees is a Game Boy rising into
// view in front of them and switching on, with the setup pages on its LCD:
// the object explains the lens before a word does. The model is Joshua's own
// (Assets/Models/gameboy.glb, a Sketchfab DMG), instantiated here and scaled
// so its LCD is LCD_WIDTH_CM across; the GbScreenView's quad is mounted in
// that window, and PanelAnchor places the whole shell instead of the quad.
//
// The numbers below are measured off the model's mesh (tools: a UV island of
// the bezel window at z=40.2 spans x -85..108, y 39..190 in the model's own
// units; the body is 254 wide and 421 tall). They are the model's, so a
// different model means different numbers here and nowhere else.
//
// Pure arithmetic is kept out in `entrance()`, so a test can state the curve
// without a scene: the shell starts a little below and behind its resting
// place, tilted back, and settles with a small overshoot in ENTRANCE_SECONDS.
//
// The Game Boy's own buttons are real: `buttonBoxes()` lays a pressable
// volume (Pressable.ts) over each of the eight, so the editor's mouse clicks
// A to turn a page and a hand pokes or pinches it on the glasses. The
// positions are measured off the mesh like the LCD's.

import type { PressableBox, Pressable, TouchPresser, FingerPresser } from "../Pressable";
import { loadPressableKit, makePressable } from "../Pressable";
import type { PanelSource } from "../PadPanel";
import {
  BUTTON_UP, BUTTON_DOWN, BUTTON_LEFT, BUTTON_RIGHT,
  BUTTON_A, BUTTON_B, BUTTON_SELECT, BUTTON_START,
} from "../PadPanel";

/** A moving part as found in the instantiated model, with where it rests. */
interface MovingPart {
  spec: MovingPartSpec;
  object: SceneObject;
  restPosition: vec3;
  restRotation: quat;
  amount: number;
  tiltRight: number;
  tiltUp: number;
  /** Whether any of its buttons was held last frame, for the press edge. */
  held: boolean;
}

/** The first object named `name` under `root`, depth first, or null. */
function findNamed(root: SceneObject, name: string): SceneObject {
  if (root.name === name) {
    return root;
  }
  const count = root.getChildrenCount();
  for (let i = 0; i < count; i++) {
    const hit = findNamed(root.getChild(i), name);
    if (hit) {
      return hit;
    }
  }
  return null;
}

/** Where the LCD sits in the model's own units, and how big it is. */
export const MODEL_LCD_CENTRE: number[] = [11, 120, 41];
export const MODEL_LCD_WIDTH: number = 152;
/** The model's body, for the report and for keeping the plate clear of it. */
export const MODEL_BODY_WIDTH: number = 254;
export const MODEL_BODY_HEIGHT: number = 421;

/**
 * The model's buttons, in its own units, measured off the mesh the same way
 * as the LCD: a centre x, y on the face for each. A and B are round; the
 * D-pad is a cross MODEL_DPAD_SPAN across with arms MODEL_DPAD_ARM wide;
 * SELECT and START are pills. The face they stand on is at MODEL_FACE_Z.
 */
export const MODEL_BUTTON_A: number[] = [104.6, -34.7];
export const MODEL_BUTTON_B: number[] = [60.2, -53.5];
export const MODEL_AB_DIAMETER: number = 33.7;
export const MODEL_DPAD_CENTRE: number[] = [-63.2, -49.2];
export const MODEL_DPAD_SPAN: number = 62;
export const MODEL_DPAD_ARM: number = 22;
export const MODEL_SELECT: number[] = [-24.4, -112.4];
export const MODEL_START: number[] = [19, -112.4];
export const MODEL_PILL_SIZE: number[] = [30, 14];
export const MODEL_FACE_Z: number = 44.6;

/**
 * How wide the LCD is, and how far ahead the shell hangs. Together they are
 * decided by the glasses' display: from the LCD's top edge to the bottom of
 * the D-pad must fit its height (about 28 degrees tall), or the buttons are
 * out of the picture and cannot be pressed -- and a glyph of the 5x7 font
 * (5 of the LCD's 160 pixels) must still be half a degree across. 14 cm at
 * 52 cm meets both; 20 cm at 58 cm, the first cut, put A and B below the
 * bottom of the preview.
 */
export const LCD_WIDTH_CM: number = 14;
export const SHELL_AHEAD_CM: number = 52;
/** The scale that makes the model's LCD LCD_WIDTH_CM wide. */
export const MODEL_SCALE: number = LCD_WIDTH_CM / MODEL_LCD_WIDTH;
/** The LCD's height in the model's units: the Game Boy's 160x144. */
export const MODEL_LCD_HEIGHT: number = MODEL_LCD_WIDTH * 144 / 160;
/**
 * Where the anchor holds the shell: not the LCD's centre but the middle of
 * the span that has to be in view, the LCD's top edge to the D-pad's bottom.
 * The LCD then sits LCD_RISE_CM above the line of sight and the buttons
 * below it, and both are seen without moving the head.
 */
export const MODEL_VIEW_CENTRE_Y: number =
  ((MODEL_LCD_CENTRE[1] + MODEL_LCD_HEIGHT / 2) + (MODEL_DPAD_CENTRE[1] - MODEL_DPAD_SPAN / 2)) / 2;
export const LCD_RISE_CM: number = (MODEL_LCD_CENTRE[1] - MODEL_VIEW_CENTRE_Y) * MODEL_SCALE;

/** A hit volume is a little larger than its button, and deep enough for a fingertip. */
export const HIT_MARGIN_CM: number = 0.4;
export const HIT_DEPTH_CM: number = 2.5;

/**
 * The parts of the model that move, by the node names tools/gameboy-split.py
 * gives them, the pad buttons each answers to, and how far it sinks when
 * pressed, in the model's units (A and B stand 2 above their plate).
 */
export interface MovingPartSpec {
  node: string;
  buttons: string[];
  sinkUnits: number;
}
/** The node that is everything except the moving parts. */
export const MODEL_BODY_NODE: string = "Body";
export const MOVING_PARTS: MovingPartSpec[] = [
  { node: "ButtonA", buttons: [BUTTON_A], sinkUnits: 2 },
  { node: "ButtonB", buttons: [BUTTON_B], sinkUnits: 2 },
  { node: "Dpad", buttons: [BUTTON_UP, BUTTON_DOWN, BUTTON_LEFT, BUTTON_RIGHT], sinkUnits: 1.5 },
  { node: "Select", buttons: [BUTTON_SELECT], sinkUnits: 2.5 },
  { node: "Start", buttons: [BUTTON_START], sinkUnits: 2.5 },
];
/** The D-pad rocks about its centre towards the pressed arm, by this much. */
export const DPAD_TILT_DEGREES: number = 5;
/** A press goes down, and comes back, with this time constant. */
export const PRESS_SECONDS: number = 0.04;
/**
 * The part nodes sit under the model's "Plane" node, whose own transform
 * turns the mesh's raw axes into the measured frame: raw +X is RIGHT, raw
 * +Z is UP, and the face looks along raw -Y. So a part sinks along raw +Y,
 * and one raw unit is a hundred measured ones.
 */
export const RAW_UNITS_PER_MODEL_UNIT: number = 0.01;

/** One frame of a press: `amount` eases towards `target` (0 up, 1 down). */
export function pressAmount(amount: number, target: number, dt: number): number {
  const k = dt <= 0 ? 0 : Math.min(1, dt / PRESS_SECONDS);
  const next = amount + (target - amount) * k;
  return Math.abs(next - target) < 0.002 ? target : next;
}

/**
 * How the D-pad tilts for the arms held, in degrees: [about RIGHT, about UP].
 * Pressing the top arm turns the pad so its top goes IN, which is a negative
 * turn about RIGHT (a positive one lifts the top towards the eye); pressing
 * the left arm is a negative turn about UP. Opposite arms cancel.
 */
export function dpadTilt(up: boolean, down: boolean, left: boolean, right: boolean): number[] {
  const aboutRight = DPAD_TILT_DEGREES * ((down ? 1 : 0) - (up ? 1 : 0));
  const aboutUp = DPAD_TILT_DEGREES * ((right ? 1 : 0) - (left ? 1 : 0));
  return [aboutRight, aboutUp];
}

/** The entrance: how long it takes and where it starts from. */
export const ENTRANCE_SECONDS: number = 1.1;
export const ENTRANCE_DROP_CM: number = 28;
export const ENTRANCE_BACK_CM: number = 10;
export const ENTRANCE_TILT_DEGREES: number = 22;
/** How long after the entrance the LCD stays dark before the first page. */
export const POWER_ON_DELAY_SECONDS: number = 0.25;

/**
 * The entrance curve at `t` seconds: how far below and behind rest, how far
 * tilted back, and how bright the power LED is. Ease-out with a small
 * overshoot (back-ease), the way something set down by a hand settles.
 */
export function entrance(t: number): { dropCm: number; backCm: number; tiltDegrees: number; led: number } {
  const x = t <= 0 ? 0 : t >= ENTRANCE_SECONDS ? 1 : t / ENTRANCE_SECONDS;
  const s = 1.4;
  const eased = 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
  const remaining = 1 - eased;
  const led = t < ENTRANCE_SECONDS ? 0 : Math.min(1, (t - ENTRANCE_SECONDS) / 0.2);
  return {
    dropCm: ENTRANCE_DROP_CM * remaining,
    backCm: ENTRANCE_BACK_CM * remaining,
    tiltDegrees: ENTRANCE_TILT_DEGREES * remaining,
    led: led,
  };
}

/** True once the entrance is over and the LCD may light. */
export function poweredOn(t: number): boolean {
  return t >= ENTRANCE_SECONDS + POWER_ON_DELAY_SECONDS;
}

/** A model point in centimetres about the root, whose origin is the view centre. */
export function modelToCm(x: number, y: number): number[] {
  return [(x - MODEL_LCD_CENTRE[0]) * MODEL_SCALE, (y - MODEL_VIEW_CENTRE_Y) * MODEL_SCALE];
}

function buttonBox(name: string, centre: number[], width: number, height: number,
                   marginCm: number): PressableBox {
  const c = modelToCm(centre[0], centre[1]);
  return {
    name: name,
    x: c[0],
    y: c[1],
    // Most of the volume stands proud of the face, the rest is in the body,
    // so a fingertip pushing in stays inside it and a ray meets it first.
    z: (MODEL_FACE_Z - MODEL_LCD_CENTRE[2]) * MODEL_SCALE + HIT_DEPTH_CM / 4,
    width: width * MODEL_SCALE + marginCm,
    height: height * MODEL_SCALE + marginCm,
    depth: HIT_DEPTH_CM,
  };
}

/** The LCD's face as a box about the root: the editor's click on the page is A. */
export function lcdBox(): PressableBox {
  return {
    name: BUTTON_A,
    tag: "lcd",
    x: 0,
    y: LCD_RISE_CM,
    z: 0.3,
    width: LCD_WIDTH_CM,
    height: LCD_WIDTH_CM * 144 / 160,
    depth: 1,
  };
}

/**
 * The eight buttons as volumes about the root, in centimetres: what a
 * fingertip or the editor's mouse presses. The D-pad is four arms about a
 * hub nobody presses. Pure, so a test can hold the layout against the LCD
 * and against itself without a scene.
 */
export function buttonBoxes(): PressableBox[] {
  const cx = MODEL_DPAD_CENTRE[0];
  const cy = MODEL_DPAD_CENTRE[1];
  const reach = (MODEL_DPAD_SPAN + MODEL_DPAD_ARM) / 4;
  const armLength = (MODEL_DPAD_SPAN - MODEL_DPAD_ARM) / 2;
  // The arms take no margin: they meet at the hub's corners, and a margin
  // there would make one press two directions. They are wide enough as is.
  return [
    buttonBox(BUTTON_UP, [cx, cy + reach], MODEL_DPAD_ARM, armLength, 0),
    buttonBox(BUTTON_DOWN, [cx, cy - reach], MODEL_DPAD_ARM, armLength, 0),
    buttonBox(BUTTON_LEFT, [cx - reach, cy], armLength, MODEL_DPAD_ARM, 0),
    buttonBox(BUTTON_RIGHT, [cx + reach, cy], armLength, MODEL_DPAD_ARM, 0),
    buttonBox(BUTTON_A, MODEL_BUTTON_A, MODEL_AB_DIAMETER, MODEL_AB_DIAMETER, HIT_MARGIN_CM),
    buttonBox(BUTTON_B, MODEL_BUTTON_B, MODEL_AB_DIAMETER, MODEL_AB_DIAMETER, HIT_MARGIN_CM),
    buttonBox(BUTTON_SELECT, MODEL_SELECT, MODEL_PILL_SIZE[0], MODEL_PILL_SIZE[1], HIT_MARGIN_CM),
    buttonBox(BUTTON_START, MODEL_START, MODEL_PILL_SIZE[0], MODEL_PILL_SIZE[1], HIT_MARGIN_CM),
  ];
}

/**
 * The shell in the scene: a root the anchor places, the model under it,
 * offset so the LCD centre sits at the root's origin, and a slot the screen
 * quad is mounted in.
 */
export class GameBoyShell {
  readonly root: SceneObject;
  /** The mount for the screen quad: at the LCD, LCD_RISE_CM up, facing +Z, LCD_WIDTH_CM wide. */
  readonly screenMount: SceneObject;
  private model: SceneObject = null;
  private parts: MovingPart[] = [];
  private led: SceneObject = null;
  private ledMaterial: Material = null;
  private elapsed: number = 0;
  private playing: boolean = false;
  private restLocal: vec3 = vec3.zero();

  /**
   * `buttonsOnly` is the shell with no Game Boy in it: the model's body is
   * switched off and the five moving parts are left where they stand, which
   * is what LooseButtons hangs in front of the wearer in the game.
   */
  constructor(parent: SceneObject, prefab: ObjectPrefab, ledMaterial: Material = null,
              buttonsOnly: boolean = false) {
    this.root = global.scene.createSceneObject(buttonsOnly ? "LooseButtonsShell" : "GameBoyShell");
    this.root.setParent(parent);
    const body = global.scene.createSceneObject("GameBoyBody");
    body.setParent(this.root);
    if (prefab) {
      this.model = prefab.instantiate(body);
      const t = this.model.getTransform();
      t.setLocalScale(new vec3(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE));
      // The view centre goes to the root's origin, so the anchor's line of
      // sight lands between the screen and the buttons, with both in view,
      // and not on the model's own origin.
      t.setLocalPosition(new vec3(
        -MODEL_LCD_CENTRE[0] * MODEL_SCALE,
        -MODEL_VIEW_CENTRE_Y * MODEL_SCALE,
        -MODEL_LCD_CENTRE[2] * MODEL_SCALE));
      this.parts = GameBoyShell.findParts(this.model);
      if (buttonsOnly) {
        // The parts are the body's siblings under the model's "Plane" node
        // (tools/gameboy-split.py), so the body goes and they stay.
        const bodyNode = findNamed(this.model, MODEL_BODY_NODE);
        if (bodyNode) {
          bodyNode.enabled = false;
        } else {
          print("[GameBoyShell] no node named " + MODEL_BODY_NODE + " in the model; the loose buttons keep their Game Boy");
        }
      }
      if (this.parts.length !== MOVING_PARTS.length) {
        print("[GameBoyShell] " + this.parts.length + " of " + MOVING_PARTS.length +
              " moving parts found in the model; the rest will not press");
      }
    }
    this.screenMount = global.scene.createSceneObject("GameBoyScreenMount");
    this.screenMount.setParent(this.root);
    // At the LCD, a hair in front of the glass so the quad never z-fights the bezel.
    this.screenMount.getTransform().setLocalPosition(new vec3(0, LCD_RISE_CM, 0.15));
    if (ledMaterial) {
      this.ledMaterial = ledMaterial;
      this.led = GameBoyShell.makeLed(this.root, ledMaterial);
    }
    this.root.enabled = false;
  }

  /** The model's moving parts, by name, remembering where each rests. */
  private static findParts(model: SceneObject): MovingPart[] {
    const found: MovingPart[] = [];
    for (let i = 0; i < MOVING_PARTS.length; i++) {
      const object = findNamed(model, MOVING_PARTS[i].node);
      if (!object) {
        continue;
      }
      const t = object.getTransform();
      found.push({
        spec: MOVING_PARTS[i],
        object: object,
        restPosition: t.getLocalPosition(),
        restRotation: t.getLocalRotation(),
        amount: 0,
        tiltRight: 0,
        tiltUp: 0,
        held: false,
      });
    }
    return found;
  }

  /**
   * One frame of the buttons: each part sinks while any of its buttons is
   * held on `source` (by a hand, the mouse or a key) and comes back when
   * it is let go; the D-pad also rocks towards the arm held. This is the
   * feedback a press gets -- the pages turn a moment later, the button
   * moves now. Returns how many parts went down this frame, so the caller
   * can give each press its click.
   */
  pressButtons(source: PanelSource, dt: number): number {
    if (!source || this.parts.length === 0) {
      return 0;
    }
    let pressed = 0;
    for (let i = 0; i < this.parts.length; i++) {
      const part = this.parts[i];
      let held = false;
      for (let b = 0; b < part.spec.buttons.length; b++) {
        if (source.isHeld(part.spec.buttons[b])) {
          held = true;
        }
      }
      if (held && !part.held) {
        pressed++;
      }
      part.held = held;
      const amount = pressAmount(part.amount, held ? 1 : 0, dt);
      let tiltRight = 0;
      let tiltUp = 0;
      if (part.spec.buttons.length === 4) {
        const tilt = dpadTilt(source.isHeld(BUTTON_UP), source.isHeld(BUTTON_DOWN),
                              source.isHeld(BUTTON_LEFT), source.isHeld(BUTTON_RIGHT));
        tiltRight = pressAmount(part.tiltRight, tilt[0], dt);
        tiltUp = pressAmount(part.tiltUp, tilt[1], dt);
      }
      if (amount === part.amount && tiltRight === part.tiltRight && tiltUp === part.tiltUp) {
        continue;
      }
      part.amount = amount;
      part.tiltRight = tiltRight;
      part.tiltUp = tiltUp;
      const t = part.object.getTransform();
      // Into the face is raw +Y; see RAW_UNITS_PER_MODEL_UNIT.
      const sink = part.spec.sinkUnits * RAW_UNITS_PER_MODEL_UNIT * amount;
      t.setLocalPosition(part.restPosition.add(new vec3(0, sink, 0)));
      if (part.spec.buttons.length === 4) {
        const toRadians = Math.PI / 180;
        const turn = quat.angleAxis(tiltRight * toRadians, vec3.right())
          .multiply(quat.angleAxis(tiltUp * toRadians, new vec3(0, 0, 1)));
        t.setLocalRotation(turn.multiply(part.restRotation));
      }
    }
    return pressed;
  }

  /** The battery LED: a small quad left of the screen, lit by the entrance. */
  private static makeLed(parent: SceneObject, material: Material): SceneObject {
    const led = global.scene.createSceneObject("GameBoyLed");
    led.setParent(parent);
    const builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    builder.topology = MeshTopology.Triangles;
    builder.indexType = MeshIndexType.UInt16;
    const r = 0.45;
    builder.appendVerticesInterleaved([
      -r, -r, 0, 0, 0,
      r, -r, 0, 1, 0,
      r, r, 0, 1, 1,
      -r, r, 0, 0, 1,
    ]);
    builder.appendIndices([0, 1, 2, 0, 2, 3]);
    const mesh = builder.getMesh();
    builder.updateMesh();
    const visual = led.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mesh = mesh;
    visual.mainMaterial = material;
    visual.renderOrder = 101;
    // Left of the LCD, at the height of its upper third: where the DMG's is.
    led.getTransform().setLocalPosition(new vec3(-LCD_WIDTH_CM * 0.62, LCD_RISE_CM + LCD_WIDTH_CM * 0.16, 0.2));
    return led;
  }

  /**
   * Makes the Game Boy's own buttons press the pad: the editor's mouse clicks
   * them, a hand pokes or pinches them, and each is the button of its name.
   * They ride under the body, so they arrive with it and go with it. Returns
   * how many got a working SIK interactable; zero is a keyboard-only build.
   */
  buildButtons(source: PanelSource, presser: TouchPresser = null, withLcd: boolean = true,
               fingers: FingerPresser = null): number {
    const body = this.root.getChild(0);
    const kit = loadPressableKit("GameBoy");
    const boxes = buttonBoxes();
    let wired = 0;
    for (let i = 0; i < boxes.length; i++) {
      const made = makePressable(kit, body, boxes[i], source, "GameBoy");
      if (made.wired) {
        wired++;
      }
      if (presser) {
        presser.add(made);
      }
      // A fingertip presses the button itself, never the LCD behind it.
      if (fingers) {
        fingers.add(made);
      }
    }
    if (presser && withLcd) {
      // The editor's mouse may also click the page itself to turn it: the
      // LCD is A there, with no collider of its own, so a hand's ray meets
      // nothing it did not before. PokemonAR keeps it off the code grid.
      presser.add(this.lcdPressable());
    }
    return wired;
  }

  /** The LCD as a volume the editor's click can meet: A, tagged "lcd". */
  private lcdPressable(): Pressable {
    const box = lcdBox();
    const holder = global.scene.createSceneObject("GameBoy_lcd");
    holder.setParent(this.root.getChild(0));
    holder.getTransform().setLocalPosition(new vec3(box.x, box.y, box.z));
    return { holder: holder, box: box, wired: false };
  }

  /** The holder the model and its print hang under, in centimetres about the view centre. */
  body(): SceneObject {
    return this.root.getChild(0);
  }

  setEnabled(on: boolean): void {
    this.root.enabled = on;
    if (!on) {
      this.playing = false;
    }
  }

  isEnabled(): boolean {
    return this.root.enabled;
  }

  /** Starts the entrance from below; the anchor's placement is the rest pose. */
  beginEntrance(): void {
    this.elapsed = 0;
    this.playing = true;
    this.apply(entrance(0));
  }

  /** True while the shell is still arriving; the LCD stays dark until then. */
  entering(): boolean {
    return this.playing && !poweredOn(this.elapsed);
  }

  /**
   * One frame. The anchor has already placed the root; this offsets the
   * BODY under it so the screen mount (and so the anchor's contract) is
   * untouched by the animation, and only the model appears to arrive.
   */
  step(dt: number): void {
    if (!this.playing) {
      return;
    }
    this.elapsed += dt > 0 ? dt : 0;
    const e = entrance(this.elapsed);
    this.apply(e);
    if (this.elapsed >= ENTRANCE_SECONDS + POWER_ON_DELAY_SECONDS + 0.5) {
      this.playing = false;
    }
  }

  private apply(e: { dropCm: number; backCm: number; tiltDegrees: number; led: number }): void {
    const body = this.root.getChild(0);
    if (body) {
      const t = body.getTransform();
      t.setLocalPosition(new vec3(0, -e.dropCm, -e.backCm));
      t.setLocalRotation(quat.angleAxis(-e.tiltDegrees * Math.PI / 180, vec3.right()));
    }
    if (this.ledMaterial) {
      const c = 0.15 + 0.85 * e.led;
      this.ledMaterial.mainPass.baseColor = new vec4(c, c * 0.12, c * 0.1, 1);
    }
  }
}

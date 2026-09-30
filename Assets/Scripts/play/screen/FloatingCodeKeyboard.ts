import { GbCanvas, DMG_GREEN } from "./GbCanvas";
import { GbScreenView } from "./GbScreenView";
import { loadPressableKit, TouchPresser } from "../Pressable";
import {
  codeKeys, keyEnabled, keyAtPixel, paintCodeKeyboard, CodeKeyGesture,
  KEYBOARD_WIDTH_CM, KEYBOARD_AHEAD_CM, KEYBOARD_CM_PER_PIXEL,
} from "./CodeKeyboardLayout";

/** A spatial keyboard: targeted keys own the gesture; there is no pinch-anywhere action. */
export class FloatingCodeKeyboard {
  private view: GbScreenView;
  private canvas: GbCanvas = new GbCanvas();
  private keys = codeKeys();
  private colliders: ColliderComponent[] = [];
  private hover: number = -1;
  private pressed: number = -1;
  private owner: any = null;
  private gesture = new CodeKeyGesture();
  private code: string = "";
  private painted: string = "";
  private enabled: boolean = false;
  private editor: boolean = TouchPresser.wanted();
  private quietUntil: number = 0;
  private picked: (row: number, column: number) => void;

  constructor(script: ScriptComponent, camera: Camera,
              material: (texture: Texture) => Material,
              picked: (row: number, column: number) => void) {
    this.picked = picked;
    this.view = new GbScreenView(script.getSceneObject(), material,
      KEYBOARD_WIDTH_CM, KEYBOARD_AHEAD_CM, false, "WorldCodeKeyboard");
    const kit = loadPressableKit("WorldCodeKeyboard");
    let wired = 0;
    for (let i = 0; i < this.keys.length; i++) {
      const key = this.keys[i];
      const holder = global.scene.createSceneObject("CodeKey_" + key.label.replace(/ /g, "_"));
      holder.setParent(this.view.surfaceObject());
      holder.getTransform().setLocalPosition(new vec3(
        (key.x + key.width / 2 - 80) * KEYBOARD_CM_PER_PIXEL,
        (72 - key.y - key.height / 2) * KEYBOARD_CM_PER_PIXEL, 0.1));
      const collider = holder.createComponent("Physics.ColliderComponent") as ColliderComponent;
      const shape = Shape.createBoxShape();
      shape.size = new vec3(key.width * KEYBOARD_CM_PER_PIXEL, key.height * KEYBOARD_CM_PER_PIXEL, 0.5);
      collider.shape = shape;
      collider.fitVisual = false;
      this.colliders.push(collider);
      if (kit.interactable) {
        const control: any = holder.createComponent(kit.interactable.getTypeName());
        control.onHoverEnter.add(() => { if (!this.editor && this.accepts(i)) this.hover = i; });
        control.onHoverExit.add(() => {
          if (!this.editor && this.hover === i) this.hover = -1;
          if (!this.editor && this.pressed === i) this.cancel();
        });
        control.onInteractorTriggerStart.add((args: any) => {
          if (!this.editor) this.begin(i, args ? args.interactor : control);
        });
        control.onInteractorTriggerEnd.add((args: any) => {
          if (!this.editor) this.end(i, args ? args.interactor : control);
        });
        const cancelOwner = (args: any) => {
          if (this.pressed === i && (!args || args.interactor === this.owner)) this.cancel();
        };
        control.onInteractorTriggerEndOutside.add(cancelOwner);
        control.onTriggerCanceled.add(cancelOwner);
        wired++;
      }
    }
    // The editor has a direct ray path; ignore SIK's simulated mouse to avoid double input.
    if (this.editor && camera) {
      script.createEvent("HoverEvent").bind((ev: HoverEvent) => {
        this.hover = this.pick(camera, ev.getHoverPosition());
      });
      script.createEvent("TouchStartEvent").bind((ev: TouchStartEvent) => {
        const key = this.pick(camera, ev.getTouchPosition());
        this.hover = key;
        this.begin(key, "mouse");
      });
      script.createEvent("TouchMoveEvent").bind((ev: TouchMoveEvent) => {
        const key = this.pick(camera, ev.getTouchPosition());
        this.hover = key;
        if (key !== this.pressed) this.cancel();
      });
      script.createEvent("TouchEndEvent").bind((ev: TouchEndEvent) => {
        this.end(this.pick(camera, ev.getTouchPosition()), "mouse");
      });
    }
    print("[WorldCodeKeyboard] " + wired + "/34 targeted keys; release to type, gaps cancel");
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.cancel();
    this.hover = -1;
    this.painted = "";
    this.view.setEnabled(enabled);
  }

  isEnabled(): boolean { return this.enabled; }

  /** The release that submitted a code cannot also press A on the following page. */
  blocksUntargetedPinch(): boolean { return this.enabled || getTime() < this.quietUntil; }

  update(camera: Camera, dt: number, code: string, cursor: number[]): void {
    if (!this.enabled) return;
    this.code = code;
    for (let i = 0; i < this.keys.length; i++) {
      this.colliders[i].enabled = keyEnabled(this.keys[i], code);
    }
    if (!this.accepts(this.hover)) this.hover = -1;
    if (!this.accepts(this.pressed)) this.cancel();
    // Hold position AND orientation while targeted: the key must not move under a pinch.
    if (this.hover < 0 && !this.gesture.active()) this.view.place(camera, dt);
    const stamp = code + ":" + this.hover + ":" + this.pressed + ":" + cursor.join(",");
    if (stamp !== this.painted) {
      this.painted = stamp;
      paintCodeKeyboard(this.canvas, this.keys, code, this.hover, this.pressed, cursor);
      this.view.upload(this.canvas, () => DMG_GREEN);
    }
  }

  private accepts(key: number): boolean {
    return this.enabled && key >= 0 && key < this.keys.length && keyEnabled(this.keys[key], this.code);
  }

  private begin(key: number, owner: any): void {
    if (!this.accepts(key) || this.gesture.active() || getTime() < this.quietUntil) return;
    this.owner = owner;
    this.pressed = key;
    this.gesture.begin(key);
  }

  private end(key: number, owner: any): void {
    if (owner !== this.owner) return;
    const selected = this.gesture.end(key);
    this.cancel();
    if (!this.accepts(selected)) return;
    this.quietUntil = getTime() + 0.15;
    const cell = this.keys[selected];
    this.picked(cell.row, cell.column);
  }

  private cancel(): void {
    this.gesture.cancel();
    this.pressed = -1;
    this.owner = null;
  }

  private pick(camera: Camera, at: vec2): number {
    if (!this.enabled) return -1;
    const inv = this.view.surfaceObject().getTransform().getInvertedWorldTransform();
    const near = inv.multiplyPoint(camera.screenSpaceToWorldSpace(at, 1));
    const far = inv.multiplyPoint(camera.screenSpaceToWorldSpace(at, 500));
    const dz = far.z - near.z;
    if (Math.abs(dz) < 0.00001) return -1;
    const t = -near.z / dz;
    if (t < 0 || t > 1) return -1;
    const x = 80 + (near.x + t * (far.x - near.x)) / KEYBOARD_CM_PER_PIXEL;
    const y = 72 - (near.y + t * (far.y - near.y)) / KEYBOARD_CM_PER_PIXEL;
    const key = keyAtPixel(this.keys, x, y);
    return this.accepts(key) ? key : -1;
  }
}

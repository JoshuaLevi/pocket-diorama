import { SpatialHandle } from "./SpatialHandle";
import type { HandSample } from "../SpatialInput";

/** Two small grips outside the near edge, independent of the scrolling terrain. */
export class WorldHandles {
  private left: SpatialHandle;
  private right: SpatialHandle;
  constructor(parent: SceneObject, make: (t: Texture) => Material) {
    this.left = new SpatialHandle(parent,"WorldGripLeft",10,2.5,make,"WORLD");
    this.right = new SpatialHandle(parent,"WorldGripRight",10,2.5,make,"WORLD");
    this.setEnabled(false);
    print("[SpatialControls] world grips: " + this.left.wired + ", " + this.right.wired);
  }
  setEnabled(on: boolean): void { this.left.enabled(on); this.right.enabled(on); }
  place(anchor: vec3, half: number, yaw: number, camera: Camera, held: boolean): void {
    const rotation = quat.angleAxis(yaw,new vec3(0,1,0));
    const eye = camera.getTransform().getWorldPosition();
    // Clearance includes the grip's half width. Keep the two targets disjoint
    // even when the user shrinks the world right down.
    const spread = Math.max(7,half*0.55);
    const depth = half+5;
    this.left.place(anchor.add(rotation.multiplyVec3(new vec3(-spread,-2,depth))),eye);
    this.right.place(anchor.add(rotation.multiplyVec3(new vec3(spread,-2,depth))),eye);
    this.left.highlight(held); this.right.highlight(held);
  }
  targeted(hand: HandSample): boolean { return this.left.targeted(hand) || this.right.targeted(hand); }
}

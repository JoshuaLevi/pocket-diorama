import { loadPressableKit } from "../Pressable";
import type { HandSample } from "../SpatialInput";
import { TINY_CHARSET, TINY_GLYPHS } from "./TinyFont";

/** Quads only where the border is: no filled panel across the game. */
export function spatialRects(parent: SceneObject, name: string, rects: number[][],
                             material: Material): SceneObject {
  const object = global.scene.createSceneObject(name);
  object.setParent(parent);
  const builder = new MeshBuilder([{name: "position", components: 3}, {name: "texture0", components: 2}]);
  builder.topology = MeshTopology.Triangles;
  builder.indexType = MeshIndexType.UInt16;
  const vertices: number[] = [], indices: number[] = [];
  for (const r of rects) {
    const x = r[0], y = r[1], w = r[2]/2, h = r[3]/2, z = r[4];
    const i = vertices.length/5;
    vertices.push(x-w,y-h,z,0,0, x+w,y-h,z,1,0, x+w,y+h,z,1,1, x-w,y+h,z,0,1);
    indices.push(i,i+1,i+2,i,i+2,i+3);
  }
  builder.appendVerticesInterleaved(vertices); builder.appendIndices(indices);
  const visual = object.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
  visual.mesh = builder.getMesh(); builder.updateMesh(); visual.mainMaterial = material;
  return object;
}

export function spatialMaterial(make: (t: Texture) => Material, label: string = ""): Material {
  const width = Math.max(1, label.length*6+8), height = label ? 15 : 1;
  const pixels = new Uint8Array(width*height*4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([115,210,218,255], i);
  for (let c = 0; c < label.length; c++) {
    const glyph = TINY_GLYPHS[TINY_CHARSET.indexOf(label[c])];
    if (!glyph) continue;
    for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++)
      if ((glyph[y] & (1 << (4-x))) !== 0) pixels.set([12,30,36,255], ((height-1-(y+4))*width+c*6+x+4)*4);
  }
  const texture = ProceduralTextureProvider.createWithFormat(width,height,TextureFormat.RGBA8Unorm);
  (texture.control as ProceduralTextureProvider).setPixels(0,0,width,height,pixels);
  return make(texture);
}

/** The same visible grip can be reached directly or targeted by a SIK hand ray. */
export class SpatialHandle {
  readonly root: SceneObject;
  private hover: number = 0;
  private material: Material;
  private width: number;
  private height: number;
  readonly wired: boolean;
  constructor(parent: SceneObject, name: string, width: number, height: number,
              make: (t: Texture) => Material, label: string) {
    this.width = width; this.height = height;
    this.material = spatialMaterial(make, label);
    this.root = spatialRects(parent,name,[[0,0,width,height,0]],this.material);
    const collider = this.root.createComponent("Physics.ColliderComponent") as ColliderComponent;
    const shape = Shape.createBoxShape(); shape.size = new vec3(width,height,2);
    collider.shape = shape; collider.fitVisual = false;
    const kit = loadPressableKit(name);
    this.wired = false;
    if (kit.interactable) {
      const control: any = this.root.createComponent(kit.interactable.getTypeName());
      control.onInteractorHoverEnter.add((e: any) => { this.hover |= e.interactor.inputType; });
      control.onInteractorHoverExit.add((e: any) => { this.hover &= ~e.interactor.inputType; });
      this.wired = true;
    }
  }
  enabled(on: boolean): void {
    this.root.enabled = on;
    if (!on) this.hover = 0;
  }
  targeted(hand: HandSample): boolean {
    if (!this.root.isEnabledInHierarchy || !hand.tracked) return false;
    if ((this.hover & hand.id) !== 0) return true;
    const at = this.root.getTransform().getInvertedWorldTransform().multiplyPoint(new vec3(hand.x,hand.y,hand.z));
    return Math.abs(at.x) <= this.width/2 && Math.abs(at.y) <= this.height/2 && Math.abs(at.z) <= 2;
  }
  highlight(held: boolean): void {
    this.material.mainPass.baseColor = held ? new vec4(1,1,0.45,1) : this.hover ? new vec4(1,1,1,1) : new vec4(0.8,0.8,0.8,1);
  }
  place(at: vec3, eye: vec3): void {
    const t = this.root.getTransform(); t.setWorldPosition(at);
    const n = new vec3(eye.x-at.x,eye.y-at.y,eye.z-at.z).normalize();
    t.setWorldRotation(quat.lookAt(n,vec3.up()));
    if (t.forward.dot(n) < 0) t.setWorldRotation(quat.lookAt(n.uniformScale(-1),vec3.up()));
  }
}

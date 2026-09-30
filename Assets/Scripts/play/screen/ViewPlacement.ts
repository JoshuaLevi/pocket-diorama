/** Fit a newly placed surface to the actual camera viewport; never run on anchored head motion. */
export function fitInView(camera:Camera,object:SceneObject,width:number,height:number):void {
  const t=object.getTransform(),at=t.getWorldPosition();
  const projected=[[-1,-1],[-1,1],[1,-1],[1,1]].map(p=>camera.worldSpaceToScreenSpace(
    at.add(t.right.uniformScale(p[0]*width/2)).add(t.up.uniformScale(p[1]*height/2))));
  const shift=(lo:number,hi:number):number=>hi-lo>0.92?0.5-(lo+hi)/2:lo<0.04?0.04-lo:hi>0.96?0.96-hi:0;
  const dx=shift(Math.min(...projected.map(p=>p.x)),Math.max(...projected.map(p=>p.x)));
  const dy=shift(Math.min(...projected.map(p=>p.y)),Math.max(...projected.map(p=>p.y)));
  if(Math.abs(dx)+Math.abs(dy)<0.0001)return;
  const centre=camera.worldSpaceToScreenSpace(at);
  const depth=-camera.getTransform().getInvertedWorldTransform().multiplyPoint(at).z;
  if(depth<=0)return;
  const before=camera.screenSpaceToWorldSpace(centre,depth);
  const after=camera.screenSpaceToWorldSpace(new vec2(centre.x+dx,centre.y+dy),depth);
  t.setWorldPosition(at.add(after.sub(before)));
}

/** Camera/target segments in terrain-local tile units. Only elevated faces on those rays fade. */
export interface SightPoint { x:number; y:number; z:number; ground:number; }
export function blocksSight(lo:number[],hi:number[],eye:number[],target:SightPoint):boolean {
  // Floors and the underside stay solid. A wall's tall vertical face may extend to the floor.
  if(hi[1] <= target.ground+0.12)return false;
  let near=0.015,far=0.98;
  for(let k=0;k<3;k++){
    const end=k===0?target.x:k===1?target.y:target.z;
    const padding=k===1?0.45:0.7;
    const d=end-eye[k],a=lo[k]-padding,b=hi[k]+padding;
    if(Math.abs(d)<1e-7){if(eye[k]<a||eye[k]>b)return false;continue;}
    const p=(a-eye[k])/d,q=(b-eye[k])/d;
    near=Math.max(near,Math.min(p,q));far=Math.min(far,Math.max(p,q));
    if(near>far)return false;
  }
  return true;
}
export interface FaceBound { lo:number[]; hi:number[]; }
export function faceBounds(verts:number[],indices:number[]):FaceBound[] {
  const out:FaceBound[]=[];
  for(let i=0;i<indices.length;i+=6){
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(let j=i;j<i+6;j++)for(let k=0;k<3;k++){
      const p=verts[indices[j]*5+k];lo[k]=Math.min(lo[k],p);hi[k]=Math.max(hi[k],p);
    }
    out.push({lo,hi});
  }
  return out;
}
export function occludingFaces(bounds:FaceBound[],eye:number[],targets:SightPoint[]):number[] {
  const out:number[]=[];
  for(let q=0;q<bounds.length;q++) {
    const b=bounds[q];
    for(let t=0;t<targets.length;t++)if(blocksSight(b.lo,b.hi,eye,targets[t])){out.push(q);break;}
  }
  return out;
}
export function splitFaces(verts:number[],indices:number[],faces:number[]):{solid:number[];verts:number[];indices:number[]} {
  const selected=new Set(faces),solid:number[]=[],fverts:number[]=[],findices:number[]=[];
  for(let q=0;q<indices.length/6;q++){
    if(!selected.has(q)){for(let j=0;j<6;j++)solid.push(indices[q*6+j]);continue;}
    const mapped:{[key:number]:number}={};
    for(let j=0;j<6;j++){
      const from=indices[q*6+j];
      if(mapped[from]===undefined){mapped[from]=fverts.length/5;for(let k=0;k<5;k++)fverts.push(verts[from*5+k]);}
      findices.push(mapped[from]);
    }
  }
  return {solid,verts:fverts,indices:findices};
}

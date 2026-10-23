import type { Region, RegionMetric } from '../codec/types.ts';

export function validateRegions(regions: readonly Region[]): void {
  if(!Array.isArray(regions)||regions.length>16)throw new Error('保护区域数量不正确。');
  const ids=new Set<string>();
  for(const region of regions){
    const b=region?.bounds;
    if(typeof region?.id!=='string'||!region.id||region.id.length>40||ids.has(region.id)||typeof region.name!=='string'||region.name.length>40||typeof region.description!=='string'||region.description.length>240||
      !b||![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.x<0||b.y<0||b.width<=0||b.height<=0||b.x+b.width>1.000000001||b.y+b.height>1.000000001){
      throw new Error('保护区域无效或超出图像边界。');
    }
    ids.add(region.id);
  }
}

export function regionFromPixels(a:{x:number;y:number},b:{x:number;y:number},width:number,height:number):Region|null{
  const x0=Math.max(0,Math.min(width,Math.min(a.x,b.x))),y0=Math.max(0,Math.min(height,Math.min(a.y,b.y)));
  const x1=Math.max(0,Math.min(width,Math.max(a.x,b.x))),y1=Math.max(0,Math.min(height,Math.max(a.y,b.y)));
  if(![x0,y0,x1,y1].every(Number.isFinite)||x1-x0<8||y1-y0<8)return null;
  return {id:'custom',name:'我的框选',description:'由你亲手划定的保留范围。',bounds:{x:x0/width,y:y0/height,width:(x1-x0)/width,height:(y1-y0)/height}};
}

interface Measured {mse:number;regions:RegionMetric[];frame:{width:number;height:number}}
function change(before:number,after:number):number|null{return before>0?(after-before)/before*100:after===0?0:null;}
export function tradeoff(uniform:Measured,current:Measured,id:string|null):{insideChange:number|null;outsideChange:number|null;insideBefore:number;insideAfter:number;outsideBefore:number|null;outsideAfter:number|null}{
  const a=uniform.regions.find(r=>r.id===id),b=current.regions.find(r=>r.id===id);
  if(!a||!b)return {insideChange:0,outsideChange:null,insideBefore:0,insideAfter:0,outsideBefore:null,outsideAfter:null};
  const count=uniform.frame.width*uniform.frame.height,outside=count-a.pixels;
  const oa=outside>0?Math.max(0,(uniform.mse*count-a.mse*a.pixels)/outside):null;
  const ob=outside>0?Math.max(0,(current.mse*count-b.mse*b.pixels)/outside):null;
  return {insideChange:change(a.mse,b.mse),outsideChange:oa===null||ob===null?null:change(oa,ob),insideBefore:a.mse,insideAfter:b.mse,outsideBefore:oa,outsideAfter:ob};
}

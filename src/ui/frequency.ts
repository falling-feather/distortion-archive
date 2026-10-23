import { DCT_BASIS, reconstructLuma } from '../codec/engine.ts';
import type { JpegFrame } from '../codec/types.ts';

export class FrequencyView {
  canvas: HTMLCanvasElement;
  basisCanvas: HTMLCanvasElement;
  selected = 9;
  coefficients = new Int16Array(64);
  baseline = new Int16Array(64);
  table: Uint16Array = new Uint16Array(64).fill(1);
  onChange: () => void;
  hits: { k: number; x: number; y: number }[] = [];

  constructor(canvas: HTMLCanvasElement, basisCanvas: HTMLCanvasElement, onChange: () => void) {
    this.canvas = canvas; this.basisCanvas = basisCanvas; this.onChange = onChange;
    canvas.width = 660; canvas.height = 340;
    canvas.addEventListener('click', event => {
      const r = canvas.getBoundingClientRect();
      const x = (event.clientX-r.left)/r.width*canvas.width, y = (event.clientY-r.top)/r.height*canvas.height;
      const hit = [...this.hits].sort((a,b) => Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))[0];
      if (hit && Math.hypot(hit.x-x,hit.y-y) < 44) { this.selected = hit.k; this.draw(); this.onChange(); }
    });
    canvas.addEventListener('keydown', event => {
      const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 };
      if (steps[event.key] === undefined) return;
      event.preventDefault(); this.selected = Math.max(0,Math.min(63,this.selected+steps[event.key]));
      this.draw(); this.onChange();
    });
  }

  update(frame: JpegFrame, baseline: JpegFrame, bx: number, by: number): void {
    const offset = (by*Math.ceil(frame.width/8)+bx)*192;
    this.coefficients = frame.coefficients.slice(offset,offset+64);
    this.baseline = baseline.coefficients.slice(offset,offset+64);
    this.table = frame.tables[0];
    this.draw();
  }

  draw(): void {
    const ctx=this.canvas.getContext('2d')!;
    ctx.clearRect(0,0,660,340);
    this.hits=[];
    const values=Array.from(this.coefficients,(q,k)=>Math.abs(q*this.table[k]));
    const max=Math.max(1,...values.slice(1));
    const cw=30,ch=12,origin={x:330,y:93};
    const project=(u:number,v:number,h=0)=>({x:origin.x+(u-v)*cw,y:origin.y+(u+v)*ch-h});
    const polygon=(points:{x:number;y:number}[],fill:string,stroke?:string)=>{
      ctx.beginPath(); points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); ctx.closePath();
      ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}
    };
    for(let sum=0;sum<=14;sum++)for(let v=0;v<8;v++){
      const u=sum-v;if(u<0||u>7)continue;const k=v*8+u,q=this.coefficients[k];
      const h=k===0?18:(q===0?2:7+values[k]/max*70);
      const a=project(u,v,h),b=project(u+.86,v,h),c=project(u+.86,v+.86,h),d=project(u,v+.86,h);
      const b0=project(u+.86,v),c0=project(u+.86,v+.86),d0=project(u,v+.86);
      const selected=k===this.selected;
      polygon([d,c,c0,d0],q===0?'#263732':q>0?'#42675b':'#805c46');
      polygon([b,c,c0,b0],q===0?'#1e2f2a':q>0?'#335347':'#634b3d');
      polygon([a,b,c,d],q===0?'#34483e':q>0?'#a5c3ad':'#d4a17f',selected?'#fff1c8':'#10251d');
      this.hits.push({k,x:(a.x+c.x)/2,y:(a.y+c.y)/2});
      if(selected){ctx.fillStyle='#f5e9ce';ctx.font='11px monospace';ctx.textAlign='center';ctx.fillText(`${u},${v}`,a.x+10,a.y-9);}
    }
    ctx.font='11px monospace';ctx.fillStyle='#b4bcb1';ctx.textAlign='center';
    ctx.fillText('低频  →  水平频率  →  高频',450,305);
    ctx.save();ctx.translate(190,301);ctx.rotate(.40);ctx.fillText('垂直频率',0,0);ctx.restore();
    this.drawBasis();
  }

  drawBasis(): void {
    const ctx=this.basisCanvas.getContext('2d')!;
    this.basisCanvas.width=8;this.basisCanvas.height=8;
    const data=new Uint8ClampedArray(256);
    const basis=DCT_BASIS[this.selected];
    const max=Math.max(...basis.map(Math.abs));
    for(let p=0;p<64;p++){const value=Math.round(128+basis[p]/max*110);data.set([value,value,value,255],p*4);}
    ctx.putImageData(new ImageData(data,8,8),0,0);
  }

  reconstructionError(frame:JpegFrame,bx:number,by:number):number{
    const pixels=reconstructLuma(this.coefficients,this.table);
    let error=0;
    for(let y=0;y<8;y++)for(let x=0;x<8;x++){
      if(bx*8+x>=frame.width||by*8+y>=frame.height)continue;
      error=Math.max(error,Math.abs(pixels[y*8+x]-frame.luma[(by*8+y)*frame.width+bx*8+x]));
    }
    return error;
  }
}

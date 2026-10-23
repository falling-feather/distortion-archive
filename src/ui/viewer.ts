import type { PixelImage, Region } from '../codec/types.ts';
import { regionFromPixels } from '../domain/regions.ts';

export type CompareMode = 'uniform' | 'original' | 'archive';
export function pixelCanvas(image: PixelImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return canvas;
}

export class ImageViewer {
  canvas: HTMLCanvasElement;
  original: HTMLCanvasElement;
  current?: HTMLCanvasElement;
  uniform?: HTMLCanvasElement;
  archive?: HTMLCanvasElement;
  region?: Region;
  mode: CompareMode = 'uniform';
  split = 0.5;
  zoom = false;
  difference = false;
  block = { x: 24, y: 24 };
  onBlock: (x: number, y: number) => void;
  onSplit: (value: number) => void;
  dragging = false;
  suppressClick = false;
  drawMode=false;
  onRegion?: (region:Region|null)=>void;
  private selectionStart:{x:number;y:number}|null=null;
  private draft:Region|null=null;

  constructor(canvas: HTMLCanvasElement, original: HTMLCanvasElement, onBlock: (x: number, y: number) => void, onSplit: (value: number) => void) {
    this.canvas = canvas; this.original = original; this.onBlock = onBlock; this.onSplit = onSplit;
    canvas.width = original.width; canvas.height = original.height;
    canvas.addEventListener('pointerdown', event => {
      this.suppressClick = false;
      if(this.drawMode){this.selectionStart=this.imagePoint(event);this.draft=null;this.suppressClick=true;canvas.setPointerCapture(event.pointerId);event.preventDefault();return;}
      const rect = canvas.getBoundingClientRect();
      if (!this.difference && Math.abs(event.clientX - rect.left - this.split * rect.width) <= 18) {
        this.dragging = true; this.suppressClick = true;
        canvas.setPointerCapture(event.pointerId); event.preventDefault();
      }
    });
    canvas.addEventListener('pointermove', event => {
      const rect = canvas.getBoundingClientRect();
      if(this.selectionStart){this.draft=regionFromPixels(this.selectionStart,this.imagePoint(event),this.original.width,this.original.height);this.draw();return;}
      if (this.dragging) {
        this.split = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        this.onSplit(this.split); this.draw();
      }
      canvas.style.cursor = this.dragging || (!this.difference && Math.abs(event.clientX - rect.left - this.split * rect.width) <= 18) ? 'ew-resize' : 'crosshair';
    });
    const finishDrag = (event: PointerEvent) => {
      if(this.selectionStart){const selection=event.type==='pointercancel'?null:this.draft;this.selectionStart=null;this.draft=null;this.drawMode=false;this.onRegion?.(selection);this.draw();}
      this.dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerup', finishDrag);
    canvas.addEventListener('pointercancel', finishDrag);
    canvas.addEventListener('click', e => {
      if (this.suppressClick) { this.suppressClick = false; return; }
      const rect = canvas.getBoundingClientRect(), v = this.viewport();
      const x = Math.min(this.original.width - 1, Math.max(0, Math.floor(v.x + (e.clientX - rect.left) / rect.width * v.width)));
      const y = Math.min(this.original.height - 1, Math.max(0, Math.floor(v.y + (e.clientY - rect.top) / rect.height * v.height)));
      this.block = { x: Math.floor(x / 8), y: Math.floor(y / 8) };
      this.onBlock(this.block.x, this.block.y); this.draw();
    });
    canvas.addEventListener('keydown', e => {
      const directions: Record<string, [number, number]> = { ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1] };
      if (!directions[e.key]) return;
      e.preventDefault(); const [dx,dy] = directions[e.key];
      this.block.x = Math.max(0, Math.min(Math.ceil(this.original.width / 8) - 1, this.block.x + dx));
      this.block.y = Math.max(0, Math.min(Math.ceil(this.original.height / 8) - 1, this.block.y + dy));
      this.onBlock(this.block.x, this.block.y); this.draw();
    });
  }

  private imagePoint(event:PointerEvent):{x:number;y:number}{const r=this.canvas.getBoundingClientRect(),v=this.viewport();return {x:v.x+(event.clientX-r.left)/r.width*v.width,y:v.y+(event.clientY-r.top)/r.height*v.height};}

  viewport(): { x: number; y: number; width: number; height: number } {
    const width = this.original.width, height = this.original.height;
    if (!this.zoom || !this.region) return { x: 0, y: 0, width, height };
    const b = this.region.bounds;
    const viewWidth = Math.min(width, Math.max(b.width * width * 1.22, b.height * height * 1.22 * width / height));
    const viewHeight = viewWidth * height / width;
    return { x: Math.max(0, Math.min(width - viewWidth, (b.x + b.width / 2) * width - viewWidth / 2)),
      y: Math.max(0, Math.min(height - viewHeight, (b.y + b.height / 2) * height - viewHeight / 2)), width: viewWidth, height: viewHeight };
  }

  draw(): void {
    const ctx = this.canvas.getContext('2d')!, { width, height } = this.canvas;
    const v = this.viewport();
    const draw = (image: HTMLCanvasElement) => ctx.drawImage(image, v.x, v.y, v.width, v.height, 0, 0, width, height);
    ctx.imageSmoothingEnabled = !this.zoom;
    draw(this.current ?? this.original);
    if (this.difference && this.current) {
      const a = this.original.getContext('2d')!.getImageData(0,0,width,height);
      const b = this.current.getContext('2d')!.getImageData(0,0,width,height);
      const diff = new Uint8ClampedArray(a.data.length);
      for (let i = 0; i < diff.length; i += 4) {
        const d = Math.min(255, (Math.abs(a.data[i]-b.data[i]) + Math.abs(a.data[i+1]-b.data[i+1]) + Math.abs(a.data[i+2]-b.data[i+2])) / 3 * 4);
        diff[i] = d; diff[i+1] = d; diff[i+2] = d; diff[i+3] = 255;
      }
      draw(pixelCanvas({ width, height, data: diff }));
    } else {
      const reference = this.mode === 'original' ? this.original : this.mode === 'archive' ? this.archive : this.uniform;
      if (reference) { ctx.save(); ctx.beginPath(); ctx.rect(0,0,width*this.split,height); ctx.clip(); draw(reference); ctx.restore(); }
      ctx.fillStyle = '#f4eee5'; ctx.fillRect(width*this.split-0.6,0,1.2,height);
      const cx = width * this.split, cy = height / 2;
      ctx.fillStyle = '#f9f5ed'; ctx.beginPath(); ctx.arc(cx,cy,15,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle = '#2b3b35'; ctx.lineWidth = 1.2;
      for (const d of [-1,1]) { ctx.beginPath(); ctx.moveTo(cx+d*3,cy-4); ctx.lineTo(cx+d*7,cy); ctx.lineTo(cx+d*3,cy+4); ctx.stroke(); }
    }
    const highlighted=this.draft??this.region;
    if (highlighted) {
      const b = highlighted.bounds;
      ctx.strokeStyle = '#e5b99d'; ctx.lineWidth = 1.3; ctx.setLineDash([5,4]);
      ctx.strokeRect((b.x*width-v.x)/v.width*width,(b.y*height-v.y)/v.height*height,b.width*width/v.width*width,b.height*height/v.height*height);
      ctx.setLineDash([]);
    }
    const bx = (this.block.x*8-v.x)/v.width*width, by = (this.block.y*8-v.y)/v.height*height;
    const bw = 8/v.width*width, bh = 8/v.height*height;
    ctx.fillStyle = '#faf4df33'; ctx.fillRect(bx,by,bw,bh);
    ctx.strokeStyle = '#fff6cb'; ctx.lineWidth = 1.5; ctx.strokeRect(bx,by,bw,bh);
  }
}

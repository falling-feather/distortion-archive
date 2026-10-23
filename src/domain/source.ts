import type { PixelImage } from '../codec/types.ts';
import type { ArchiveSource } from '../archive/schema.ts';
import { sha256 } from '../archive/schema.ts';
import type { Scene } from '../scene.ts';

export interface WorkingSource {metadata:ArchiveSource;pixels:PixelImage;canvas:HTMLCanvasElement}
async function decodePng(metadata:ArchiveSource):Promise<WorkingSource>{
  const bitmap=await createImageBitmap(new Blob([new Uint8Array(metadata.png)],{type:'image/png'}));
  if(bitmap.width!==metadata.width||bitmap.height!==metadata.height){bitmap.close();throw new Error('母图尺寸与档案记录不一致。');}
  const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
  const context=canvas.getContext('2d',{willReadFrequently:true})!;context.drawImage(bitmap,0,0);bitmap.close();
  return {metadata,canvas,pixels:{width:canvas.width,height:canvas.height,data:context.getImageData(0,0,canvas.width,canvas.height).data}};
}
export async function builtInSource(scene:Scene):Promise<WorkingSource>{
  const response=await fetch(scene.image);if(!response.ok)throw new Error('演示图加载失败。');
  const png=new Uint8Array(await response.arrayBuffer());
  return decodePng({id:scene.id,name:scene.title,width:scene.width,height:scene.height,png,hash:await sha256(png),aiGenerated:true,attribution:`ImageGen 虚构情境；来源与提示词 ${scene.sourceReference}`});
}
export async function archivedSource(source:ArchiveSource):Promise<WorkingSource>{return decodePng(source);}
export async function localSource(file:File):Promise<WorkingSource>{
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>12*1024*1024)throw new Error('请选择 12 MiB 以内的 PNG、JPEG 或 WebP 图像。');
  const bitmap=await createImageBitmap(file);
  if(bitmap.width*bitmap.height>25_000_000){bitmap.close();throw new Error('这张图像超过 2500 万像素，请先缩小后导入。');}
  const originalWidth=bitmap.width,originalHeight=bitmap.height;
  const scale=Math.min(1,768/originalWidth,512/originalHeight);
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(originalWidth*scale));canvas.height=Math.max(1,Math.round(originalHeight*scale));
  const context=canvas.getContext('2d',{willReadFrequently:true})!;context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(result=>result?resolve(result):reject(new Error('图像转换失败。')),'image/png'));
  const png=new Uint8Array(await blob.arrayBuffer());
  return {canvas,pixels:{width:canvas.width,height:canvas.height,data:context.getImageData(0,0,canvas.width,canvas.height).data},metadata:{id:`local-${crypto.randomUUID()}`,name:file.name.slice(0,100),width:canvas.width,height:canvas.height,png,hash:await sha256(png),aiGenerated:false,attribution:`本机导入；原始 ${originalWidth}×${originalHeight}，处理母图 ${canvas.width}×${canvas.height}；原文件未修改、未上传。`}};
}

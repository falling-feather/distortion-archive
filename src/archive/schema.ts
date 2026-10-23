import { readJpeg } from '../codec/engine.ts';
import { validateRegions } from '../domain/regions.ts';
import type { Region } from '../codec/types.ts';

export const CODEC_ID='jpeg-js-0.4.4/ac-priority-1';
export const MAX_BOOK_ENTRIES=24;
export const MAX_BOOK_BYTES=64*1024*1024;
export interface ArchiveSource {id:string;name:string;width:number;height:number;png:Uint8Array;hash:string;aiGenerated:boolean;attribution:string}
export interface Recipe {codec:string;budget:number;priority:string|null;regions:Region[]}
export interface ArchiveEntry {
  formatVersion:1;id:string;createdAt:string;title:string;question:string;reason:string;
  source:ArchiveSource;recipe:Recipe;jpeg:Uint8Array;jpegHash:string;trashed:boolean;
}
export interface EntryInput {title:string;question:string;reason:string;source:Omit<ArchiveSource,'hash'>;recipe:Recipe;jpeg:Uint8Array}
export async function sha256(bytes:Uint8Array):Promise<string>{
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function text(value:unknown,label:string,max:number):string{
  if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(`${label}缺失或过长。`);
  return value;
}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('档案结构损坏。');return value as Record<string,unknown>;}
function bytes(value:unknown,label:string):Uint8Array{
  if(!(value instanceof Uint8Array)||value.length<8||value.length>4*1024*1024)throw new Error(`${label}缺失或超出大小限制。`);
  return value;
}
export async function validateEntry(raw:unknown):Promise<ArchiveEntry>{
  const e=object(raw),s=object(e.source),r=object(e.recipe);
  if(e.formatVersion!==1)throw new Error('档案版本暂不支持；原数据不会被覆盖。');
  if(r.codec!==CODEC_ID)throw new Error('档案编码版本暂不支持；请保留原导出文件。');
  const png=bytes(s.png,'原图'),jpeg=bytes(e.jpeg,'JPEG');
  if(!Number.isInteger(s.width)||!Number.isInteger(s.height)||(s.width as number)<1||(s.height as number)<1||(s.width as number)*(s.height as number)>1024*1024)throw new Error('档案图像尺寸不正确。');
  const signature=[137,80,78,71,13,10,26,10];
  if(png.length<24||signature.some((n,i)=>png[i]!==n))throw new Error('档案原图不是有效 PNG。');
  const header=new DataView(png.buffer,png.byteOffset,png.byteLength);
  if(header.getUint32(16)!==s.width||header.getUint32(20)!==s.height)throw new Error('原图尺寸与记录不一致。');
  if(!Array.isArray(r.regions))throw new Error('档案区域缺失。');
  validateRegions(r.regions as Region[]);
  if(r.priority!==null&&(typeof r.priority!=='string'||!(r.regions as Region[]).some(region=>region.id===r.priority)))throw new Error('档案保护区域不存在。');
  if(!Number.isInteger(r.budget)||(r.budget as number)<jpeg.length||(r.budget as number)>4*1024*1024)throw new Error('档案 JPEG 超出记录的预算。');
  if(await sha256(png)!==s.hash||await sha256(jpeg)!==e.jpegHash)throw new Error('档案文件校验失败，内容可能损坏；原数据未修改。');
  const frame=readJpeg(jpeg);
  if(frame.width!==s.width||frame.height!==s.height)throw new Error('JPEG 与原图尺寸不一致。');
  const createdAt=text(e.createdAt,'归档时间',40);if(!Number.isFinite(Date.parse(createdAt)))throw new Error('归档时间不正确。');
  if(typeof s.aiGenerated!=='boolean'||typeof e.trashed!=='boolean')throw new Error('来源或档案状态缺失。');
  return {formatVersion:1,id:text(e.id,'档案编号',80),createdAt,title:text(e.title,'档案标题',80),question:text(e.question,'情境问题',240),reason:text(e.reason,'保留理由',240),
    source:{id:text(s.id,'图像编号',100),name:text(s.name,'图像名称',100),width:s.width as number,height:s.height as number,png:png.slice(),hash:s.hash as string,aiGenerated:s.aiGenerated,attribution:text(s.attribution,'来源',400)},
    recipe:{codec:CODEC_ID,budget:r.budget as number,priority:r.priority as string|null,regions:structuredClone(r.regions as Region[])},jpeg:jpeg.slice(),jpegHash:e.jpegHash as string,trashed:e.trashed};
}
export async function createEntry(input:EntryInput):Promise<ArchiveEntry>{
  return validateEntry({...input,formatVersion:1,id:crypto.randomUUID(),createdAt:new Date().toISOString(),trashed:false,
    source:{...input.source,hash:await sha256(input.source.png)},jpegHash:await sha256(input.jpeg)});
}
// Called after validation: hashes represent the exact PNG and JPEG payloads.
// File equality alone must not discard a changed title, recipe, source or intent.
export function sameArchiveContent(a:ArchiveEntry,b:ArchiveEntry):boolean{
  const content=(e:ArchiveEntry)=>[e.formatVersion,e.id,e.createdAt,e.title,e.question,e.reason,e.trashed,e.jpegHash,
    [e.source.id,e.source.name,e.source.width,e.source.height,e.source.hash,e.source.aiGenerated,e.source.attribution],
    [e.recipe.codec,e.recipe.budget,e.recipe.priority,e.recipe.regions.map(r=>[r.id,r.name,r.description,r.bounds.x,r.bounds.y,r.bounds.width,r.bounds.height])]];
  return JSON.stringify(content(a))===JSON.stringify(content(b));
}
function toBase64(data:Uint8Array):string{let result='';for(let i=0;i<data.length;i+=16384)result+=String.fromCharCode(...data.subarray(i,i+16384));return btoa(result);}
function fromBase64(data:unknown):Uint8Array{
  if(typeof data!=='string'||data.length>6*1024*1024||data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw new Error('档案图像编码损坏或过大。');
  const decoded=atob(data);return Uint8Array.from(decoded,c=>c.charCodeAt(0));
}
export async function serializeBook(entries:readonly ArchiveEntry[]):Promise<string>{
  if(entries.length>MAX_BOOK_ENTRIES)throw new Error(`一次最多导出 ${MAX_BOOK_ENTRIES} 份档案。`);
  const tooLarge='整册超过 64 MiB，请用每张卡的“导出”逐份留存；已有档案未修改。';
  const payloadBytes=entries.reduce((sum,e)=>sum+Math.ceil(e.jpeg.length/3)*4+Math.ceil(e.source.png.length/3)*4,0);
  if(payloadBytes>MAX_BOOK_BYTES)throw new Error(tooLarge);
  const result=JSON.stringify({kind:'distortion-archive',formatVersion:1,entries:entries.map(e=>({...e,jpeg:toBase64(e.jpeg),source:{...e.source,png:toBase64(e.source.png)}}))});
  if(new TextEncoder().encode(result).byteLength>MAX_BOOK_BYTES)throw new Error(tooLarge);
  return result;
}
export async function parseBook(value:string):Promise<ArchiveEntry[]>{
  if(new TextEncoder().encode(value).byteLength>MAX_BOOK_BYTES)throw new Error('档案册超过 64 MiB，请分册导入。');
  let root:Record<string,unknown>;
  try{root=object(JSON.parse(value));}catch{throw new Error('这不是可识别的档案册 JSON 文件。');}
  if(root.work==='失真档案')throw new Error('这是旧版参数记录，缺少原图和 JPEG，无法恢复为档案。请保留旧记录并另行导入原图。');
  if(root.kind!=='distortion-archive'||root.formatVersion!==1)throw new Error('档案册版本暂不支持；已有档案不受影响。');
  if(!Array.isArray(root.entries)||root.entries.length>MAX_BOOK_ENTRIES)throw new Error('档案册条目数量不正确。');
  const result:ArchiveEntry[]=[];const ids=new Set<string>();
  for(const raw of root.entries){const e=object(raw),s=object(e.source);const entry=await validateEntry({...e,jpeg:fromBase64(e.jpeg),source:{...s,png:fromBase64(s.png)}});
    if(ids.has(entry.id))throw new Error('导入文件包含重复档案编号。');ids.add(entry.id);result.push(entry);}
  return result;
}

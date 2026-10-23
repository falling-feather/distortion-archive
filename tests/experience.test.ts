import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { regionFromPixels, validateRegions, tradeoff } from '../src/domain/regions.ts';
import { createEntry, serializeBook, parseBook, sameArchiveContent, MAX_BOOK_BYTES, CODEC_ID } from '../src/archive/schema.ts';
import { prepareImage, encodeAtBudget, updateRegions, restoreResult } from '../src/codec/engine.ts';

test('free rectangles work in reverse direction and stay within the actual source',()=>{
  const region=regionFromPixels({x:90,y:60},{x:-10,y:10},100,80);
  assert.deepEqual(region?.bounds,{x:0,y:.125,width:.9,height:.625});
  assert.equal(regionFromPixels({x:1,y:1},{x:3,y:4},100,80),null);
  assert.throws(()=>validateRegions([{id:'bad',name:'x',description:'',bounds:{x:.8,y:0,width:.3,height:.2}}]));
});

test('changing a free region invalidates the old priority cache without touching master data',()=>{
  const data=new Uint8ClampedArray(64*32*4);
  for(let y=0;y<32;y++)for(let x=0;x<64;x++){const q=x%4<2?20:220;data.set([q,q,q,255],(y*64+x)*4);}
  const left={id:'custom',name:'自选',description:'',bounds:{x:0,y:0,width:.5,height:1}};
  const right={...left,bounds:{x:.5,y:0,width:.5,height:1}};
  const model=prepareImage({width:64,height:32,data},[left]);
  const master=model.prepared.coefficients.slice();
  const budget=Math.floor((model.minimumBytes+model.prepared.bytes.length)/2);
  const a=encodeAtBudget(model,budget,'custom');
  updateRegions(model,[right]);const b=encodeAtBudget(model,budget,'custom');
  assert.notDeepEqual(a.bytes,b.bytes);assert.deepEqual(model.prepared.coefficients,master);
  assert.deepEqual(restoreResult(model,b.bytes,budget,'custom').bytes,b.bytes);
  assert.throws(()=>restoreResult(model,b.bytes,b.bytes.length-1,'custom'));
});

test('a region named uniform cannot collide with the unprotected cache entry',()=>{
  const data=new Uint8ClampedArray(64*32*4);
  for(let y=0;y<32;y++)for(let x=0;x<64;x++){const q=x%4<2?20:220;data.set([q,q,q,255],(y*64+x)*4);}
  const model=prepareImage({width:64,height:32,data},[{id:'uniform',name:'区域',description:'',bounds:{x:0,y:0,width:.5,height:1}}]);
  const budget=Math.floor((model.minimumBytes+model.prepared.bytes.length)/2);
  const a=encodeAtBudget(model,budget,null).bytes,b=encodeAtBudget(model,budget,'uniform').bytes;
  assert.ok(a.length!==b.length||a.some((byte,index)=>byte!==b[index]),'explicit region must have its own priority');
});

const sourcePng=new Uint8Array(readFileSync(new URL('../public/assets/archive-study.png',import.meta.url)));
const jpeg=new Uint8Array(readFileSync(new URL('./fixtures/32-letter.jpg',import.meta.url)));
async function entry(){return createEntry({
  title:'给未来的一张纸条',question:'保住字迹还是触感？',reason:'我要让后来的人读懂这句话，接受织纹变淡。',
  source:{id:'small-things',name:'小事物',width:768,height:512,png:sourcePng,aiGenerated:true,attribution:'ImageGen 虚构静物'},
  recipe:{codec:CODEC_ID,budget:32768,priority:'letter',regions:[{id:'letter',name:'字迹',description:'',bounds:{x:.13,y:.30,width:.34,height:.25}}]},jpeg,
});}

test('a book export restores the source, exact JPEG, intent and geometry together',async()=>{
  const a=await entry();const restored=await parseBook(await serializeBook([a]));
  assert.equal(restored.length,1);assert.equal(restored[0].reason,a.reason);
  assert.deepEqual(restored[0].source.png,sourcePng);assert.deepEqual(restored[0].jpeg,jpeg);
  assert.equal(restored[0].jpegHash,a.jpegHash);assert.deepEqual(restored[0].recipe,a.recipe);
});

test('import deduplication preserves different titles, recipes and source descriptions',async()=>{
  const a=await entry(),b=structuredClone(a);
  assert.equal(sameArchiveContent(a,b),true);
  assert.equal(sameArchiveContent(a,{...b,title:'另一个标题'}),false);
  assert.equal(sameArchiveContent(a,{...b,recipe:{...b.recipe,budget:40000}}),false);
  assert.equal(sameArchiveContent(a,{...b,source:{...b.source,attribution:'另一份来源说明'}}),false);
  assert.equal(sameArchiveContent(a,{...b,trashed:true}),false);
});

test('book export preflights payload size so its own output remains importable',async()=>{
  const a=await entry();
  // Oversized payloads are rejected before allocating a complete base64 JSON string.
  const payload=new Uint8Array(3*1024*1024),large={...a,source:{...a.source,png:payload},jpeg:payload};
  assert.equal(MAX_BOOK_BYTES,64*1024*1024);
  await assert.rejects(()=>serializeBook(Array.from({length:24},()=>large)),/64 MiB|逐份/);
  await assert.rejects(()=>serializeBook(Array.from({length:25},()=>a)),/24/);
});

test('corrupt content, unsupported versions and legacy parameter-only exports are explicit failures',async()=>{
  const book=JSON.parse(await serializeBook([await entry()]));
  book.entries[0].jpeg=book.entries[0].jpeg.slice(0,-4)+'AAAA';
  await assert.rejects(()=>parseBook(JSON.stringify(book)),/校验|JPEG|损坏/);
  await assert.rejects(()=>parseBook(JSON.stringify({kind:'distortion-archive',formatVersion:99,entries:[]})),/版本/);
  await assert.rejects(()=>parseBook(JSON.stringify({work:'失真档案',budgetBytes:32768,priority:'letter'})),/旧|参数|图像/);
});

test('impossible saved budgets and unknown regions are rejected before changing an existing book',async()=>{
  const book=JSON.parse(await serializeBook([await entry()]));
  book.entries[0].recipe.budget=1;await assert.rejects(()=>parseBook(JSON.stringify(book)),/预算/);
  const second=JSON.parse(await serializeBook([await entry()]));second.entries[0].recipe.priority='missing';
  await assert.rejects(()=>parseBook(JSON.stringify(second)),/区域/);
});

test('the outside consequence derives from pixel counts and does not invent a cost for full protection',()=>{
  const uniform={mse:10,regions:[{id:'x',mse:10,pixels:25}],frame:{width:10,height:10}};
  const current={mse:12,regions:[{id:'x',mse:2,pixels:25}],frame:{width:10,height:10}};
  const result=tradeoff(uniform,current,'x');
  assert.equal(result.insideChange,-80);assert.ok(result.outsideChange!>50);
  assert.equal(tradeoff({...uniform,regions:[{id:'x',mse:10,pixels:100}]},{...current,regions:[{id:'x',mse:2,pixels:100}]},'x').outsideChange,null);
});

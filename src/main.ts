import './style.css';
import { SCENE, SCENES } from './scene.ts';
import type { Scene } from './scene.ts';
import type { Comparison, JpegFrame, Region } from './codec/types.ts';
import type { WorkerResponse } from './codec/protocol.ts';
import { CodecClient } from './codec/client.ts';
import { readJpeg } from './codec/engine.ts';
import { ImageViewer, pixelCanvas } from './ui/viewer.ts';
import type { CompareMode } from './ui/viewer.ts';
import { FrequencyView } from './ui/frequency.ts';
import { ReceiverView } from './ui/receiver.ts';
import { tradeoff } from './domain/regions.ts';
import { archivedSource, builtInSource, localSource } from './domain/source.ts';
import type { WorkingSource } from './domain/source.ts';
import { ArchiveRepository } from './archive/repository.ts';
import { CODEC_ID, MAX_BOOK_BYTES, createEntry, parseBook, serializeBook } from './archive/schema.ts';
import type { ArchiveEntry } from './archive/schema.ts';

function el<T extends HTMLElement=HTMLElement>(id:string):T{const node=document.getElementById(id);if(!node)throw new Error(`页面缺少 ${id}`);return node as T;}
const number=(n:number)=>n.toLocaleString('en-US');
const repository=new ArchiveRepository();
const codec=new CodecClient(receive);
const receiver=new ReceiverView(el('receiver'),entry=>{revisit(entry).catch(fail);},()=>showTab('book'));
let working:WorkingSource|undefined;
let currentScene:Scene|undefined=SCENE;
let question=SCENE.question;
let context=SCENE.context;
let regions:Region[]=structuredClone(SCENE.regions);
let priority:string|null=regions[0].id;
let budget=SCENE.initialBudget;
let minimumBytes=0;
let baseBytes=0;
let baseFrame:JpegFrame|undefined;
let comparison:Comparison|undefined;
let viewer:ImageViewer|undefined;
let frequency:FrequencyView|undefined;
let valid=false;
let activeTab='workbench';
let loadSequence=0;
let bookEntries:ArchiveEntry[]=[];
let storageIssues:string[]=[];
let storageAvailable=true;
let showTrash=false;
let saving=false;
let bookPage=0;
let pinned:{title:string;budget:number;sourceHash:string;frame:JpegFrame}|undefined;
let toastTimer:ReturnType<typeof setTimeout>|undefined;
let thumbUrls:string[]=[];

function toast(message:string):void{if(toastTimer)clearTimeout(toastTimer);el('toast').textContent=message;el('toast').classList.add('visible');toastTimer=setTimeout(()=>el('toast').classList.remove('visible'),3500);}
function message(error:unknown):string{return error instanceof Error?error.message:'操作未完成，请重试。';}
function fail(error:unknown):void{toast(message(error));}
function setText(id:string,value:string):void{el(id).textContent=value;}
function dialog(id:string):HTMLDialogElement{return el<HTMLDialogElement>(id);}
function regionName(id:string|null):string{return regions.find(r=>r.id===id)?.name??'均匀保留';}

function showTab(tab:string):void{
  if(tab==='analysis'&&!valid){toast('先得到一份有效 JPEG，再查看这一版的频率。');return;}
  if(tab==='receiver'&&!receiver.available){toast('先封存一份图像，或从档案卡选择“接收”。');return;}
  activeTab=tab;
  // Working-image status belongs to the editing view; the receiving view labels its own sealed file.
  el('source-badge').hidden=tab==='receiver';el('header-status').hidden=tab==='receiver';
  for(const id of ['workbench','receiver','analysis','book'])el(id).hidden=id!==tab;
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button=>{const active=button.dataset.tab===(tab==='analysis'?'workbench':tab);button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  if(tab==='workbench'||tab==='analysis')el(tab==='analysis'?'analysis-image-slot':'work-image-slot').append(el('viewer-card'));
  if(tab==='book')renderBook();
  if(tab==='workbench'||tab==='analysis')requestAnimationFrame(()=>{fitStage();viewer?.draw();if(tab==='analysis')renderBlock();});
}
function fitStage():void{
  if(!working||(activeTab!=='workbench'&&activeTab!=='analysis'))return;
  const well=el('image-well'),ratio=working.metadata.width/working.metadata.height;
  const width=Math.max(1,Math.floor(Math.min(well.clientWidth-2,(well.clientHeight-2)*ratio)));
  el('image-stage').style.width=`${width}px`;el('image-stage').style.height=`${Math.floor(width/ratio)}px`;
}
new ResizeObserver(fitStage).observe(el('image-well'));
window.addEventListener('resize',()=>{fitStage();if(activeTab==='book')renderBook();});

function setBusy(busy:boolean,label='正在重新编码，画面暂为上一份有效结果…'):void{
  valid=!busy&&!!comparison;
  el('image-stage').setAttribute('aria-busy',String(busy));
  el('frequency').setAttribute('aria-busy',String(busy));
  el('processing').classList.toggle('hidden',!busy);el('processing').classList.remove('error');
  setText('processing-text',label);
  el<HTMLButtonElement>('save-entry').disabled=!valid||!storageAvailable||saving;
  el<HTMLButtonElement>('download-jpeg').disabled=!valid;
  el<HTMLButtonElement>('pin-current').disabled=!valid;
  el<HTMLButtonElement>('inspect-button').disabled=!valid;
  if(busy){setText('actual-bytes','计算中');setText('inside-change','—');setText('outside-change','—');setText('live-status',label);el('live-status').classList.remove('error');}
}
function requestEncode():void{
  if(!working)return;
  setBusy(true);renderControls();codec.encode(budget,priority,regions);
}
function receive(response:WorkerResponse):void{
  if(response.type==='ready'){
    baseFrame=response.frame;baseBytes=response.baseBytes;minimumBytes=response.minimumBytes;
    setText('floor-hint',`本图固定设置的可达下限：${(minimumBytes/1024).toFixed(2)} KiB`);
  }else if(response.type==='progress')setText('processing-text',response.label);
  else if(response.type==='result'){
    comparison=response.comparison;setBusy(false);renderComparison();
  }else{
    setBusy(true);valid=false;el('image-stage').setAttribute('aria-busy','false');el('processing').classList.add('error');
    const label=`${response.message} 当前画面不是该预算的新结果。`;
    setText('processing-text',label);setText('live-status',response.message);el('live-status').classList.add('error');
    setText('actual-bytes','预算未达成');setText('consequence-sentence','增加容量后可重新生成；不会暗中缩图或改变格式。');
    if(response.minimumBytes)minimumBytes=response.minimumBytes;
    toast(response.message);
  }
}

async function applySource(source:WorkingSource,options:{scene?:Scene;question:string;context:string;regions:Region[];priority:string|null;budget:number;entry?:ArchiveEntry}):Promise<void>{
  if(pinned?.sourceHash!==source.metadata.hash)pinned=undefined;
  working=source;currentScene=options.scene;question=options.question;context=options.context;
  regions=structuredClone(options.regions);priority=options.priority;budget=options.budget;comparison=undefined;baseFrame=undefined;minimumBytes=0;
  if(options.entry){pinned={title:options.entry.title,budget:options.entry.recipe.budget,sourceHash:options.entry.source.hash,frame:readJpeg(options.entry.jpeg)};}
  if(!viewer){
    viewer=new ImageViewer(el<HTMLCanvasElement>('image-canvas'),source.canvas,renderBlock,value=>{el<HTMLInputElement>('comparison-slider').value=String(Math.round(value*100));});
    frequency=new FrequencyView(el<HTMLCanvasElement>('frequency-canvas'),el<HTMLCanvasElement>('basis-canvas'),renderFrequencyValues);
    viewer.onRegion=selected=>{
      if(selected){regions=regions.filter(r=>r.id!=='custom').concat(selected);priority='custom';chooseRegion('custom');}
      else{renderControls();toast('未建立新区域，原来的选择仍保留；请框出至少 8×8 像素。');}
    };
  }
  viewer.original=source.canvas;viewer.canvas.width=source.metadata.width;viewer.canvas.height=source.metadata.height;
  viewer.current=undefined;viewer.uniform=undefined;viewer.archive=pinned?pixelCanvas({width:pinned.frame.width,height:pinned.frame.height,data:pinned.frame.rgba}):undefined;
  viewer.mode=options.entry?'archive':'uniform';viewer.zoom=false;viewer.difference=false;viewer.drawMode=false;viewer.split=.5;
  const region=regions.find(r=>r.id===priority);
  if(region)viewer.split=region.bounds.x+region.bounds.width/2;
  viewer.region=region;viewer.block={x:Math.floor(((region?.bounds.x??.4)+(region?.bounds.width??.2)/2)*source.metadata.width/8),y:Math.floor(((region?.bounds.y??.4)+(region?.bounds.height??.2)/2)*source.metadata.height/8)};
  setText('scene-question',question);setText('scene-theme',options.scene?`${options.scene.theme} · ${options.scene.title}`:'自己的图像 · 自己决定');
  setText('source-badge',source.metadata.aiGenerated?'AI 虚构情境 · 本机处理':'本机导入图像 · 未上传');
  setText('floor-hint','正在测量可达下限');setText('budget-spare','包含完整文件开销');el('capacity-fill').style.width='0';
  setText('inside-name',regionName(priority));setText('consequence-sentence','先看画面，再决定这个取舍是否值得。');
  setText('header-status','正在准备这张图像');setText('image-caption',`${source.metadata.width}×${source.metadata.height} · 正在生成真实 JPEG`);
  showTab('workbench');setBusy(true,'准备原图、固定量化与真实编码数据…');renderControls();viewer.draw();
  codec.initialize(source.pixels,regions);codec.encode(budget,priority,regions,options.entry?.jpeg);
}
async function openScene(scene:Scene):Promise<void>{
  const token=++loadSequence;
  try{const source=await builtInSource(scene);if(token!==loadSequence)return;await applySource(source,{scene,question:scene.question,context:scene.context,regions:scene.regions,priority:scene.regions[0].id,budget:scene.initialBudget});}
  catch(error){fail(error);}
}
function chooseRegion(id:string|null):void{
  priority=id;
  if(viewer&&working){const r=regions.find(region=>region.id===id);viewer.region=r;if(!r)viewer.zoom=false;
    if(r){viewer.block={x:Math.min(Math.ceil(working.metadata.width/8)-1,Math.floor((r.bounds.x+r.bounds.width/2)*working.metadata.width/8)),y:Math.min(Math.ceil(working.metadata.height/8)-1,Math.floor((r.bounds.y+r.bounds.height/2)*working.metadata.height/8))};viewer.split=r.bounds.x+r.bounds.width/2;}}
  requestEncode();
}
function renderControls():void{
  const choices=el('region-choices');choices.replaceChildren();
  regions.filter(r=>r.id!=='custom').forEach((region,index)=>{
    const button=document.createElement('button');button.className='region-choice';button.classList.toggle('selected',priority===region.id);button.setAttribute('aria-pressed',String(priority===region.id));button.title=region.description;
    const digit=document.createElement('span');digit.textContent=`0${index+1}`;button.append(digit,document.createTextNode(region.name));button.addEventListener('click',()=>chooseRegion(region.id));choices.append(button);
  });
  el('clear-custom').hidden=!regions.some(r=>r.id==='custom');
  el('draw-region').classList.toggle('active',!!viewer?.drawMode||priority==='custom');
  el('draw-region').setAttribute('aria-pressed',String(!!viewer?.drawMode||priority==='custom'));
  setText('draw-region',viewer?.drawMode?'拖动图像划定范围':priority==='custom'?'✓ 我的框选 · 重画':'＋ 自由框选');
  el('uniform-button').classList.toggle('active',priority===null);
  el<HTMLInputElement>('budget-number').value=String(budget/1024);
  document.querySelectorAll<HTMLButtonElement>('[data-budget]').forEach(b=>b.classList.toggle('active',Number(b.dataset.budget)===budget/1024));
  const hotspots=el('hotspots');hotspots.replaceChildren();
  regions.filter(r=>r.id!=='custom').forEach((region,index)=>{const b=document.createElement('button');b.className='hotspot';b.classList.toggle('selected',priority===region.id);b.textContent=`0${index+1}`;b.style.left=`${region.bounds.x*100}%`;b.style.top=`${region.bounds.y*100}%`;b.setAttribute('aria-label',`保护${region.name}`);b.addEventListener('click',()=>chooseRegion(region.id));hotspots.append(b);});
  if(viewer){viewer.region=regions.find(r=>r.id===priority);viewer.draw();}labels();
}
function labels():void{
  if(!viewer)return;
  const differentBudget=pinned&&pinned.budget!==budget;
  setText('reference-label',viewer.difference?'与原图的绝对差 ×4':viewer.mode==='original'?'原图':viewer.mode==='archive'?`${pinned?.title??'对照'}${differentBudget?` · ${pinned!.budget/1024} KiB`:''}`:'均匀保留');
  setText('current-label',viewer.difference?'差异灰度显示':`你的选择 · ${regionName(comparison?.current.priority??priority)}`);
  el<HTMLInputElement>('comparison-slider').disabled=viewer.difference;el<HTMLInputElement>('comparison-slider').value=String(Math.round(viewer.split*100));
  el('image-stage').classList.toggle('zoomed',viewer.zoom);el('image-stage').classList.toggle('drawing',viewer.drawMode);
  el('zoom-button').setAttribute('aria-pressed',String(viewer.zoom));setText('zoom-button',viewer.zoom?'⊖ 回到全图':'⊕ 放大保护区');
  el('difference-button').setAttribute('aria-pressed',String(viewer.difference));
  el<HTMLButtonElement>('archive-compare').disabled=!pinned;
  setText('pin-status',pinned?`${pinned.title.slice(0,14)} · ${pinned.budget/1024} KiB`:'还没有对照');
  document.querySelectorAll<HTMLButtonElement>('.reference-button').forEach(b=>{const active=!viewer!.difference&&b.dataset.mode===viewer!.mode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
}
function consequence():string{
  if(!comparison||!priority)return '均匀保留没有指定偏爱；你也可以亲手框出一处，看看取舍。';
  const result=tradeoff(comparison.uniform,comparison.current,priority);
  if(result.outsideChange===null)return '没有独立的区域之外可比较；框住整幅图不会改变相对优先级。';
  if(result.insideChange===null||Math.abs(result.insideChange)<.05)return '这次选择暂未带来明显差异。可以减少容量，或选一处更有细节的区域。';
  return `“${regionName(priority)}”的像素误差${result.insideChange<0?'降低':'增加'} ${Math.abs(result.insideChange).toFixed(1)}%；区域之外${result.outsideChange>0?'增加':'降低'} ${Math.abs(result.outsideChange).toFixed(1)}%。看看画面，再判断这份代价值不值得。`;
}
function percent(value:number|null):string{return value===null?'—':`${value>0?'+':value<0?'−':''}${Math.abs(value).toFixed(1)}%`;}
function renderComparison():void{
  if(!comparison||!viewer||!working)return;
  const {current,uniform}=comparison;
  viewer.current=pixelCanvas({width:current.frame.width,height:current.frame.height,data:current.frame.rgba});viewer.uniform=pixelCanvas({width:uniform.frame.width,height:uniform.frame.height,data:uniform.frame.rgba});viewer.draw();labels();
  setText('actual-bytes',`${number(current.bytes.length)} 字节`);el('capacity-fill').style.width=`${current.bytes.length/budget*100}%`;
  setText('budget-spare',`上限 ${number(budget)} 字节 · 余 ${number(budget-current.bytes.length)}`);
  setText('live-status',`同预算两策略相差 ${number(Math.abs(current.bytes.length-uniform.bytes.length))} 字节。`);el('live-status').classList.remove('error');
  setText('image-caption',`${working.metadata.width}×${working.metadata.height} · 拖动中线比较 · 点击选块`);
  setText('header-status',`${regionName(priority)} · ${budget/1024} KiB · JPEG 文件回读`);
  const effect=tradeoff(uniform,current,priority);setText('inside-name',priority?regionName(priority):'未设保护');
  setText('inside-change',priority?percent(effect.insideChange):'—');el('inside-change').classList.toggle('gain',effect.insideChange!==null&&effect.insideChange<0);
  setText('outside-change',percent(effect.outsideChange));el('outside-change').classList.toggle('gain',effect.outsideChange!==null&&effect.outsideChange<0);
  setText('consequence-sentence',priority?'请在图像上确认：这份代价，是否值得？':'没有指定偏爱。也可以框出一处，看看你自己的选择。');renderBlock();
}
function drawBlock(id:string,canvas:HTMLCanvasElement):void{if(!viewer)return;const target=el<HTMLCanvasElement>(id);target.width=8;target.height=8;const ctx=target.getContext('2d')!;ctx.imageSmoothingEnabled=false;ctx.drawImage(canvas,viewer.block.x*8,viewer.block.y*8,8,8,0,0,8,8);}
function renderBlock():void{
  if(!viewer||!frequency||!comparison||!baseFrame||!viewer.current||!viewer.uniform)return;
  const {x,y}=viewer.block;frequency.update(comparison.current.frame,baseFrame,x,y);drawBlock('block-original',viewer.original);drawBlock('block-uniform',viewer.uniform);drawBlock('block-current',viewer.current);
  setText('block-label',`Y 亮度块 (${x}, ${y})`);setText('coefficient-count',`${[...frequency.coefficients].filter(q=>q!==0).length} / 64 项非零`);
  setText('trace-caption',`JPEG 回读 → 量化表 → 块系数 → 重建。像素 [${x*8},${y*8}] 起，逆变换最大差 ${frequency.reconstructionError(comparison.current.frame,x,y)}/255。`);renderFrequencyValues();
}
function renderFrequencyValues():void{
  if(!frequency)return;const k=frequency.selected,q=frequency.coefficients[k],Q=frequency.table[k];
  setText('frequency-name',`频率 (${k%8},${Math.floor(k/8)})${k===0?' · DC':''}`);setText('frequency-state',q?'这个纹样被留下':'这个纹样已归零');setText('frequency-values',`q ${q} × Q ${Q} = ${q*Q}`);
  setText('basis-explanation',k===0?'DC 决定整块的平均亮度，当前始终保留。':'余弦基底 × 实际反量化贡献，再叠加为这一块亮度；高频也可能承载细字与裂纹。');
}

async function refreshBook():Promise<void>{
  try{const result=await repository.list();bookEntries=result.entries;storageIssues=result.issues;storageAvailable=true;}
  catch(error){storageAvailable=false;storageIssues=[message(error)];toast(message(error));}
  setText('book-count',String(bookEntries.filter(e=>!e.trashed).length));
  el<HTMLButtonElement>('save-entry').disabled=!valid||!storageAvailable||saving;
  if(activeTab==='book')renderBook();
}
function short(value:string,count:number):string{return value.length>count?`${value.slice(0,count)}…`:value;}
function button(label:string,action:()=>void):HTMLButtonElement{const b=document.createElement('button');b.textContent=label;b.addEventListener('click',action);return b;}
function renderBook():void{
  for(const url of thumbUrls)URL.revokeObjectURL(url);thumbUrls=[];
  const entries=bookEntries.filter(entry=>entry.trashed===showTrash),perPage=innerWidth<481||innerHeight<701?2:(innerWidth<1201?4:6),pages=Math.max(1,Math.ceil(entries.length/perPage));
  bookPage=Math.min(bookPage,pages-1);const gallery=el('book-gallery');gallery.replaceChildren();
  const columns=innerWidth<1201?2:3,rows=Math.max(1,Math.ceil(Math.min(entries.length,perPage)/columns));
  gallery.style.gridTemplateRows=innerWidth>900?`repeat(${rows},minmax(0,1fr))`:'';
  setText('book-total',`· ${entries.length} 份`);setText('storage-status',storageIssues.length?`${storageIssues.length} 份旧数据或存储问题已保留：${storageIssues[0]}`:'仅在本机保存；导出整册后可在其他本机浏览器恢复。');
  el('storage-status').classList.toggle('error',!!storageIssues.length);
  el('active-entries').classList.toggle('active',!showTrash);el('trashed-entries').classList.toggle('active',showTrash);
  if(!entries.length){const empty=document.createElement('div');empty.className='book-empty';const h=document.createElement('h2');h.textContent=showTrash?'这里暂时没有移出的档案。':'给未来留下一份有理由的图像。';const p=document.createElement('p');p.textContent='在留存桌选择一处想保住的细节，写下你愿意接受的代价。封存后，刷新页面仍能重访、对照与导出。';empty.append(h,p,button('回到留存桌',()=>showTab('workbench')));gallery.append(empty);}
  entries.slice(bookPage*perPage,(bookPage+1)*perPage).forEach(entry=>{
    const card=document.createElement('article');card.className='book-card';
    const img=document.createElement('img');const url=URL.createObjectURL(new Blob([new Uint8Array(entry.jpeg)],{type:'image/jpeg'}));thumbUrls.push(url);img.src=url;img.alt=`${entry.title} 的真实 JPEG`;
    const title=document.createElement('h3');title.textContent=short(entry.title,24);title.title=entry.title;
    const copy=document.createElement('p');copy.textContent=short(entry.reason,44);
    const meta=document.createElement('p');meta.className='card-meta';meta.textContent=`${entry.recipe.budget/1024} KiB 上限 · ${number(entry.jpeg.length)} 字节 · ${new Date(entry.createdAt).toLocaleDateString('zh-CN')}`;
    const details=document.createElement('div');details.append(title,copy,meta);
    const actions=document.createElement('div');actions.className='card-actions';
    actions.append(button('接收',()=>openReceiver(entry)),button('重访',()=>{revisit(entry).catch(fail);}),button('理由',()=>showEntry(entry)),button('导出',()=>{exportEntries([entry]).catch(fail);}),button(showTrash?'放回册中':'移入回收站',()=>{repository.put({...entry,trashed:!entry.trashed}).then(refreshBook).then(()=>toast('本机档案状态已保存，可在回收站与册中互相恢复。')).catch(fail);}));
    card.append(img,details,actions);gallery.append(card);
  });
  setText('book-page',`${bookPage+1} / ${pages}`);el<HTMLButtonElement>('book-previous').disabled=bookPage===0;el<HTMLButtonElement>('book-next').disabled=bookPage>=pages-1;
  el<HTMLButtonElement>('book-export').disabled=!bookEntries.length;
}
function showEntry(entry:ArchiveEntry):void{
  setText('entry-detail-title',entry.title);setText('entry-detail-question',entry.question);setText('entry-detail-reason',entry.reason);
  setText('entry-detail-meta',`${entry.recipe.budget/1024} KiB 上限，实际 ${number(entry.jpeg.length)} 字节。JPEG SHA-256：${entry.jpegHash}`);setText('entry-detail-source',entry.source.attribution);dialog('entry-dialog').showModal();
}
function openReceiver(entry:ArchiveEntry):void{
  receiver.open(entry);
  const tab=document.querySelector<HTMLButtonElement>('[data-tab="receiver"]');if(tab)tab.disabled=false;
  showTab('receiver');
}
async function revisit(entry:ArchiveEntry):Promise<void>{
  const token=++loadSequence;const source=await archivedSource(entry.source);if(token!==loadSequence)return;
  await applySource(source,{scene:SCENES.find(s=>s.id===entry.source.id),question:entry.question,context:`你曾写下：“${entry.reason}”\n原档已放入对照夹，继续选择即可与当时比较。`,regions:entry.recipe.regions,priority:entry.recipe.priority,budget:entry.recipe.budget,entry});
  toast('已重访真实封存文件。改变一次选择，看看它与当时有什么不同。');
}

function download(data:Uint8Array,name:string,type:string):void{const url=URL.createObjectURL(new Blob([new Uint8Array(data)],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
async function exportEntries(entries:ArchiveEntry[]):Promise<void>{download(new TextEncoder().encode(await serializeBook(entries)),'失真档案-留存档案册.json','application/json');toast(`已导出 ${entries.length} 份完整档案，含母图、JPEG 与理由。`);}

document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab!)));
document.querySelectorAll<HTMLButtonElement>('[data-go]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.go!)));
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(b=>b.addEventListener('click',()=>dialog(b.dataset.close!).close()));
document.querySelectorAll<HTMLDialogElement>('dialog').forEach(d=>d.addEventListener('click',event=>{if(event.target!==d)return;const r=d.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)d.close();}));
el('scene-open').addEventListener('click',()=>dialog('scene-dialog').showModal());
const sceneCards=el('scene-cards');SCENES.forEach(scene=>{const card=document.createElement('article');card.className='scene-card';const img=document.createElement('img');img.src=scene.image;img.alt=scene.title;const theme=document.createElement('span');theme.textContent=scene.theme;const title=document.createElement('strong');title.textContent=scene.title;const p=document.createElement('p');p.textContent=scene.question;card.append(img,theme,title,p,button(`进入${scene.title}`,()=>{dialog('scene-dialog').close();openScene(scene).catch(fail);}));sceneCards.append(card);});
el('context-open').addEventListener('click',()=>{setText('context-theme',currentScene?.theme??'自己的留存问题');setText('context-title',working?.metadata.name??'图像');setText('context-copy',context);setText('context-source',working?.metadata.attribution??'');dialog('context-dialog').showModal();});
for(const id of ['about-open','help-footer','cost-open'])el(id).addEventListener('click',()=>dialog('about-dialog').showModal());
el('image-import').addEventListener('click',()=>el<HTMLInputElement>('image-file').click());
el<HTMLInputElement>('image-file').addEventListener('change',async event=>{
  const input=event.currentTarget as HTMLInputElement,file=input.files?.[0];if(!file)return;input.value='';const token=++loadSequence;
  try{const source=await localSource(file);if(token!==loadSequence)return;await applySource(source,{question:'这一张图，你最想让什么留下？',context:'这是你自己的图像。先框出一处对你有意义的细节，再看预算如何改变其他地方。图片只在本机处理。',regions:[],priority:null,budget:32*1024});if(viewer){viewer.drawMode=true;renderControls();}toast('已在本机打开图像。拖出保护区域，原文件不会改变。');}catch(error){fail(error);}
});
el('draw-region').addEventListener('click',()=>{if(!viewer)return;viewer.drawMode=!viewer.drawMode;viewer.zoom=false;viewer.difference=false;renderControls();toast(viewer.drawMode?'在图像上拖出一个区域（至少 8×8 像素）。':'已退出框选。');});
el('clear-custom').addEventListener('click',()=>{regions=regions.filter(r=>r.id!=='custom');chooseRegion(regions[0]?.id??null);});
el('uniform-button').addEventListener('click',()=>chooseRegion(null));
el<HTMLInputElement>('budget-number').addEventListener('change',event=>{const value=Number((event.currentTarget as HTMLInputElement).value);if(!Number.isInteger(value)||value<1||value>1024){toast('容量请输入 1—1024 KiB 的整数。');renderControls();return;}budget=value*1024;requestEncode();});
document.querySelectorAll<HTMLButtonElement>('[data-budget]').forEach(b=>b.addEventListener('click',()=>{budget=Number(b.dataset.budget)*1024;requestEncode();}));
el<HTMLInputElement>('comparison-slider').addEventListener('input',event=>{if(viewer){viewer.split=Number((event.currentTarget as HTMLInputElement).value)/100;viewer.draw();}});
document.querySelectorAll<HTMLButtonElement>('.reference-button').forEach(b=>b.addEventListener('click',()=>{if(viewer){viewer.mode=b.dataset.mode as CompareMode;viewer.difference=false;viewer.draw();labels();}}));
el('zoom-button').addEventListener('click',()=>{if(!viewer)return;if(!viewer.region){toast('先选择或框出一处保护区域。');return;}viewer.zoom=!viewer.zoom;viewer.draw();labels();});
el('inspect-button').addEventListener('click',()=>showTab(activeTab==='analysis'?'workbench':'analysis'));
el('difference-button').addEventListener('click',()=>{if(viewer){viewer.difference=!viewer.difference;viewer.draw();labels();}});
el('pin-current').addEventListener('click',()=>{if(!valid||!comparison||!viewer||!working)return;pinned={title:`${regionName(priority)}的选择`,budget,sourceHash:working.metadata.hash,frame:comparison.current.frame};viewer.archive=pixelCanvas({width:pinned.frame.width,height:pinned.frame.height,data:pinned.frame.rgba});viewer.mode='archive';viewer.draw();labels();toast('已夹入本次对照。继续改变选择；对照夹不替代档案册保存。');});
el('reset-button').addEventListener('click',()=>{budget=currentScene?.initialBudget??32*1024;regions=structuredClone(currentScene?.regions??[]);if(viewer){viewer.drawMode=false;viewer.zoom=false;viewer.difference=false;viewer.mode='uniform';}chooseRegion(regions[0]?.id??null);});
el('download-jpeg').addEventListener('click',()=>{if(!valid||!comparison)return;download(comparison.current.bytes,`失真档案-${priority??'uniform'}-${budget/1024}KiB.jpg`,'image/jpeg');toast(`已导出真实 JPEG，${number(comparison.current.bytes.length)} 字节。`);});
el('save-entry').addEventListener('click',()=>{if(!valid||!working)return;el<HTMLInputElement>('entry-title').value=working.metadata.name.slice(0,60);el<HTMLTextAreaElement>('entry-reason').value='';setText('save-consequence',consequence());setText('save-error','');dialog('save-dialog').showModal();});
el<HTMLFormElement>('save-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!valid||!comparison||!working||saving)return;
  const reason=el<HTMLTextAreaElement>('entry-reason').value.trim();if(reason.length<2){setText('save-error','请至少写下两个字，告诉未来为什么保留这一处。');return;}
  saving=true;el<HTMLButtonElement>('confirm-save').disabled=true;el<HTMLButtonElement>('save-entry').disabled=true;setText('save-error','');
  const savedSourceHash=working.metadata.hash;
  try{const entry=await createEntry({title:el<HTMLInputElement>('entry-title').value.trim(),question,reason,source:working.metadata,recipe:{codec:CODEC_ID,budget,priority,regions},jpeg:comparison.current.bytes});await repository.put(entry);await refreshBook();if(working?.metadata.hash===savedSourceHash&&dialog('save-dialog').open){dialog('save-dialog').close();bookPage=0;showTrash=false;openReceiver(entry);}toast('已封存到本机档案册。把这份留存交给接收者，先听听另一双眼睛。');}
  catch(error){setText('save-error',message(error));}finally{saving=false;el<HTMLButtonElement>('confirm-save').disabled=false;el<HTMLButtonElement>('save-entry').disabled=!valid||!storageAvailable;}
});
el('book-export').addEventListener('click',()=>{exportEntries(bookEntries).catch(fail);});
el('book-import').addEventListener('click',()=>el<HTMLInputElement>('book-file').click());
el<HTMLInputElement>('book-file').addEventListener('change',async event=>{
  const input=event.currentTarget as HTMLInputElement,file=input.files?.[0];if(!file)return;input.value='';
  try{if(file.size>MAX_BOOK_BYTES)throw new Error('档案册超过 64 MiB，请分册导入。');const entries=await parseBook((await file.text()).replace(/^\uFEFF/,''));for(const entry of entries)await archivedSource(entry.source);const count=await repository.import(entries);await refreshBook();bookPage=0;showTab('book');toast(`已导入 ${count} 份档案；相同编号与内容不会重复添加。`);}
  catch(error){fail(error);setText('storage-status',message(error));el('storage-status').classList.add('error');}
});
el('active-entries').addEventListener('click',()=>{showTrash=false;bookPage=0;renderBook();});el('trashed-entries').addEventListener('click',()=>{showTrash=true;bookPage=0;renderBook();});
el('book-previous').addEventListener('click',()=>{bookPage=Math.max(0,bookPage-1);renderBook();});el('book-next').addEventListener('click',()=>{bookPage++;renderBook();});

async function boot():Promise<void>{await refreshBook();await openScene(SCENE);}
boot().catch(fail);

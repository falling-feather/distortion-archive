import type { ArchiveEntry } from '../archive/schema.ts';
import { beginReception, firstLookIssue, isReadingConfidence, READING_CONFIDENCE, revealOriginal } from '../domain/receiver.ts';
import type { ReadingConfidence, ReceptionSession } from '../domain/receiver.ts';
import { receptionQuestion } from '../scene.ts';

/** A receiving view holds a sealed entry; it never encodes or edits that entry. */
export class ReceiverView {
  private root:HTMLElement;
  private entry:ArchiveEntry|undefined;
  private session:ReceptionSession|undefined;
  private confidence:ReadingConfidence|null=null;
  private jpegUrl:string|undefined;
  private originalUrl:string|undefined;

  constructor(root:HTMLElement,onContinue:(entry:ArchiveEntry)=>void,onBook:()=>void){
    this.root=root;
    this.find<HTMLTextAreaElement>('receiver-reading').addEventListener('input',()=>this.updateDraft());
    root.querySelectorAll<HTMLButtonElement>('[data-confidence]').forEach(button=>button.addEventListener('click',()=>{
      if(!isReadingConfidence(button.dataset.confidence))throw new Error('接收者辨认选项不正确。');
      this.confidence=button.dataset.confidence;this.updateDraft();
    }));
    this.find<HTMLFormElement>('receiver-form').addEventListener('submit',event=>{
      event.preventDefault();if(!this.entry||!this.session)return;
      const draft={confidence:this.confidence,reading:this.find<HTMLTextAreaElement>('receiver-reading').value};
      const issue=firstLookIssue(draft);if(issue){this.setText('receiver-hint',issue);return;}
      const revealed=revealOriginal(this.session,draft);this.session=revealed;
      this.originalUrl=URL.createObjectURL(new Blob([new Uint8Array(this.entry.source.png)],{type:'image/png'}));
      this.find<HTMLImageElement>('receiver-original').src=this.originalUrl;
      this.find('receiver-form').hidden=true;this.find('receiver-reflection').hidden=false;this.find('receiver-image-switch').hidden=false;
      this.setText('receiver-first-confidence',READING_CONFIDENCE[revealed.observation.confidence]);
      const reading=revealed.observation.reading||'没有填写猜测，选择了无法辨认。';
      this.setText('receiver-first-reading',this.preview(reading,20));
      this.setText('receiver-reason-preview',this.preview(this.entry.reason,26));
      this.setText('receiver-detail-reading',reading);this.setText('receiver-detail-reason',this.entry.reason);
      this.setText('receiver-step','02 · 原图回来了');this.setText('receiver-note-title','第一眼与原图之间');
      this.showImage('original');
    });
    root.querySelectorAll<HTMLButtonElement>('[data-received-image]').forEach(button=>button.addEventListener('click',()=>{
      if(button.dataset.receivedImage==='jpeg'||button.dataset.receivedImage==='original')this.showImage(button.dataset.receivedImage);
    }));
    this.find('receiver-continue').addEventListener('click',()=>{if(this.entry)onContinue(this.entry);});
    this.find('receiver-book').addEventListener('click',onBook);
    this.find('receiver-details').addEventListener('click',()=>this.find<HTMLDialogElement>('receiver-detail-dialog').showModal());
  }

  get available():boolean{return !!this.entry;}

  open(entry:ArchiveEntry):void{
    if(this.jpegUrl)URL.revokeObjectURL(this.jpegUrl);
    if(this.originalUrl)URL.revokeObjectURL(this.originalUrl);
    this.originalUrl=undefined;this.entry=entry;this.session=beginReception(entry.id);this.confidence=null;
    this.jpegUrl=URL.createObjectURL(new Blob([new Uint8Array(entry.jpeg)],{type:'image/jpeg'}));
    this.find<HTMLImageElement>('receiver-jpeg').src=this.jpegUrl;
    // The original is not assigned to a DOM image until the first-look response.
    this.find<HTMLImageElement>('receiver-original').removeAttribute('src');
    this.find<HTMLTextAreaElement>('receiver-reading').value='';
    this.find('receiver-form').hidden=false;this.find('receiver-reflection').hidden=true;this.find('receiver-image-switch').hidden=true;
    this.setText('receiver-question',receptionQuestion(entry.source.id,entry.recipe.priority));
    this.setText('receiver-step','01 · 只收到这一份');this.setText('receiver-note-title','先记下你的第一眼');
    this.setText('receiver-file',`${entry.jpeg.length.toLocaleString('en-US')} 字节 · 上限 ${entry.recipe.budget/1024} KiB · 封存 JPEG`);
    this.setText('receiver-origin',entry.source.aiGenerated?'AI 虚构情境':'本机导入图像');
    for(const id of ['receiver-first-reading','receiver-reason-preview','receiver-detail-reading','receiver-detail-reason'])this.setText(id,'');
    this.showImage('jpeg');this.updateDraft();
  }

  private find<T extends HTMLElement=HTMLElement>(id:string):T{
    const element=this.root.querySelector<T>(`#${id}`);if(!element)throw new Error(`接收页缺少 ${id}`);return element;
  }
  private setText(id:string,value:string):void{this.find(id).textContent=value;}
  private preview(value:string,length:number):string{return value.length>length?`${value.slice(0,length)}…`:value;}
  private updateDraft():void{
    const issue=firstLookIssue({confidence:this.confidence,reading:this.find<HTMLTextAreaElement>('receiver-reading').value});
    this.find<HTMLButtonElement>('receiver-reveal').disabled=!!issue;
    this.setText('receiver-hint',issue??'记下第一眼后，就可以与原图核对。');
    this.root.querySelectorAll<HTMLButtonElement>('[data-confidence]').forEach(button=>{
      const selected=button.dataset.confidence===this.confidence;button.setAttribute('aria-pressed',String(selected));button.classList.toggle('selected',selected);
    });
  }
  private showImage(mode:'jpeg'|'original'):void{
    if(mode==='original'&&this.session?.phase!=='comparison')return;
    this.find('receiver-jpeg').hidden=mode!=='jpeg';this.find('receiver-original').hidden=mode!=='original';
    this.setText('receiver-image-label',mode==='jpeg'?'接收者看到的 JPEG':'原图 · 现在可以核对');
    this.root.querySelectorAll<HTMLButtonElement>('[data-received-image]').forEach(button=>{
      const selected=button.dataset.receivedImage===mode;button.setAttribute('aria-pressed',String(selected));button.classList.toggle('active',selected);
    });
  }
}

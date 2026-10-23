import type { PixelImage, Region } from './types.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

type EncodeRequest=Extract<WorkerRequest,{type:'encode'}>;
export class CodecClient{
  private worker?:Worker;
  private generation=0;
  private ready=false;
  private sequence=0;
  private latest=0;
  private active=false;
  private pending?:EncodeRequest;
  private receive:(message:WorkerResponse)=>void;
  constructor(receive:(message:WorkerResponse)=>void){this.receive=receive;}
  initialize(image:PixelImage,regions:Region[]):void{
    this.worker?.terminate();const generation=++this.generation;
    this.ready=false;this.active=false;this.pending=undefined;
    const worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});this.worker=worker;
    worker.onmessage=(event:MessageEvent<WorkerResponse>)=>{
      if(generation!==this.generation)return;
      const message=event.data;
      if(message.type==='ready'){this.ready=true;this.receive(message);this.dispatch();}
      else if(message.type==='result'||message.type==='error'){
        this.active=false;
        if(message.id===undefined||message.id===this.latest)this.receive(message);
        this.dispatch();
      }else if(message.id===this.latest)this.receive(message);
    };
    worker.onerror=event=>{if(generation===this.generation){this.active=false;this.ready=false;this.receive({type:'error',message:`编码线程失败：${event.message}。请重新打开当前情境。`});}};
    worker.postMessage({type:'init',image,regions} satisfies WorkerRequest);
  }
  encode(budget:number,priority:string|null,regions:Region[],restore?:Uint8Array):void{
    this.latest=++this.sequence;this.pending={type:'encode',id:this.latest,budget,priority,regions:structuredClone(regions),restore};this.dispatch();
  }
  private dispatch():void{
    if(!this.ready||this.active||!this.pending||!this.worker)return;
    const request=this.pending;this.pending=undefined;this.active=true;this.worker.postMessage(request);
  }
}

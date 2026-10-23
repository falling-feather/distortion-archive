import { MAX_BOOK_ENTRIES, validateEntry, sameArchiveContent } from './schema.ts';
import type { ArchiveEntry } from './schema.ts';

const DATABASE='distortion-archive';
const STORE='entries';
export class ArchiveRepository {
  private database:Promise<IDBDatabase>;
  constructor(){
    this.database=new Promise((resolve,reject)=>{
      const request=indexedDB.open(DATABASE,1);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:'id'});};
      request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
      request.onerror=()=>reject(new Error('本机档案存储无法打开，或数据版本高于当前作品。现有数据未修改。'));
      request.onblocked=()=>reject(new Error('档案存储正被另一旧页面占用，请关闭旧页面后重试。'));
    });
  }
  private async raw():Promise<unknown[]>{
    const database=await this.database;
    return new Promise((resolve,reject)=>{const request=database.transaction(STORE,'readonly').objectStore(STORE).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('读取本机档案失败。'));});
  }
  async list():Promise<{entries:ArchiveEntry[];issues:string[]}>{
    const entries:ArchiveEntry[]=[],issues:string[]=[];
    for(const raw of await this.raw()){
      try{entries.push(await validateEntry(raw));}catch(error){issues.push(error instanceof Error?error.message:'无法识别的旧档案已保留。');}
    }
    return {entries:entries.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),issues};
  }
  async put(entry:ArchiveEntry):Promise<void>{await this.write([await validateEntry(entry)],false);}
  async import(entries:ArchiveEntry[]):Promise<number>{return this.write(entries,true);}
  private async write(entries:ArchiveEntry[],deduplicate:boolean):Promise<number>{
    const database=await this.database;
    return new Promise((resolve,reject)=>{
      const transaction=database.transaction(STORE,'readwrite'),store=transaction.objectStore(STORE),request=store.getAll();let written=0;
      let failure='本机保存失败，可能没有足够空间。请导出当前结果；现有档案未被清空。';
      request.onsuccess=()=>{
        const existing=request.result as ArchiveEntry[];const additions:ArchiveEntry[]=[];
        for(const incoming of entries){
          const collision=existing.find(e=>e.id===incoming.id);
          if(deduplicate&&collision&&sameArchiveContent(collision,incoming))continue;
          additions.push(deduplicate&&collision?{...incoming,id:crypto.randomUUID()}:incoming);
        }
        const newCount=additions.filter(e=>!existing.some(old=>old.id===e.id)).length;
        if(existing.length+newCount>MAX_BOOK_ENTRIES){failure=`本机最多保存 ${MAX_BOOK_ENTRIES} 份档案（含回收站），请先导出妥善留存。`;transaction.abort();return;}
        for(const entry of additions){store.put(entry);written++;}
      };
      transaction.oncomplete=()=>resolve(written);
      transaction.onabort=()=>reject(new Error(failure));transaction.onerror=()=>reject(new Error(failure));
    });
  }
}

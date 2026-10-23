import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { SCENES } from '../src/scene.ts';
import { prepareImage, encodeAtBudget } from '../src/codec/engine.ts';
import { tradeoff } from '../src/domain/regions.ts';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'tmp/experience');
mkdirSync(out,{recursive:true});
const reports=[];
for(const scene of SCENES){
  const data=new Uint8ClampedArray(readFileSync(resolve(out,scene.id+'.rgba')));
  const model=prepareImage({width:scene.width,height:scene.height,data},scene.regions);
  const cases=[];
  for(const kib of [24,32]){
    const budget=kib*1024;
    if(budget<model.minimumBytes){cases.push({budget,unreachable:true,minimumBytes:model.minimumBytes});continue;}
    const uniform=encodeAtBudget(model,budget,null);
    writeFileSync(resolve(out,`${scene.id}-${kib}-uniform.jpg`),uniform.bytes);
    for(const region of scene.regions){
      const result=encodeAtBudget(model,budget,region.id);
      const name=`${scene.id}-${kib}-${region.id}`;
      writeFileSync(resolve(out,name+'.jpg'),result.bytes);
      if(kib===24)writeFileSync(resolve(out,name+'.decoded'),result.frame.rgba);
      cases.push({budget,priority:region.id,bytes:result.bytes.length,uniformBytes:uniform.bytes.length,tradeoff:tradeoff(uniform,result,region.id)});
    }
  }
  reports.push({scene:scene.id,width:scene.width,height:scene.height,minimumBytes:model.minimumBytes,baselineBytes:model.prepared.bytes.length,cases});
}
writeFileSync(resolve(out,'codec.json'),JSON.stringify(reports,null,2)+'\n');
console.log(JSON.stringify(reports.map(r=>({scene:r.scene,minimum:r.minimumBytes,cases:r.cases.map(c=>({budget:c.budget,...('priority'in c?{priority:c.priority,bytes:c.bytes,inside:+c.tradeoff.insideChange!.toFixed(1),outside:c.tradeoff.outsideChange===null?null:+c.tradeoff.outsideChange.toFixed(1)}:{unreachable:true})}))}))));

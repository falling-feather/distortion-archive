import type { Region } from './codec/types.ts';

export interface Scene {
  id:string;title:string;theme:string;question:string;context:string;image:string;
  width:number;height:number;initialBudget:number;regions:Region[];sourceReference:string;
  receiverQuestions:Record<string,string>;
}
export const SCENES:Scene[]=[{
  id: 'small-things',
  title: '小事物的留存',
  theme:'记忆',
  question:'把这句话留下，还是把触感带走？',
  context:'搬家前，你想给未来的自己留下一张图。纸条说“记住这些小事物”。字迹、钥匙和织纹，哪一处让它仍像你的记忆？',
  image: '/assets/archive-study.png',
  width: 768,
  height: 512,
  initialBudget: 24 * 1024,
  sourceReference:'/assets/source-info.json',
  receiverQuestions:{letter:'纸条上写了什么？先记下你实际能辨认的部分。',key:'你认得这件物品吗？哪些轮廓让你作出判断？',fabric:'你感受到怎样的材质？你是从哪些纹理判断的？'},
  regions: [
    { id: 'letter', name: '留下字迹', description: '留下那句，曾经写给自己的话。', bounds: { x: 0.13, y: 0.30, width: 0.34, height: 0.25 } },
    { id: 'key', name: '留下轮廓', description: '记住一把钥匙，和它打开过的门。', bounds: { x: 0.60, y: 0.075, width: 0.30, height: 0.39 } },
    { id: 'fabric', name: '留下触感', description: '让细密的纹路，留住一点温度。', bounds: { x: 0.64, y: 0.63, width: 0.34, height: 0.33 } },
  ] satisfies Region[],
},{
  id:'last-bus',title:'最后一班',theme:'行动',
  question:'交给下一位候车人时，什么不能丢？',
  context:'虚构雨夜里，末班车的时刻是 21:40。你可以保住能让人行动的信息，也可以留下等候的人或整场雨。不同的留存，讲述不同的现场。',
  image:'/assets/last-bus.png',width:768,height:512,initialBudget:24*1024,sourceReference:'/assets/last-bus-source.json',
  receiverQuestions:{time:'末班时刻还能读清吗？你收到的发车时间是什么？',waiting:'你能看出谁在等候、处于怎样的情境中吗？',rain:'雨夜的光和水，还留下了怎样的气氛？'},
  regions:[
    {id:'time',name:'末班时刻',description:'让下一位仍能读出 21:40。',bounds:{x:.12,y:.10,width:.10,height:.075}},
    {id:'waiting',name:'等候的人',description:'留下这个人在雨中等候的存在。',bounds:{x:.55,y:.22,width:.18,height:.52}},
    {id:'rain',name:'雨夜的光',description:'带走雨水与倒影构成的气氛。',bounds:{x:.58,y:.76,width:.38,height:.22}},
  ],
},{
  id:'mended-cup',title:'修补的痕迹',theme:'证据',
  question:'留下完整的器形，还是留下裂过的证据？',
  context:'这只虚构的旧杯子被修补过。细裂缝可能先在压缩中消失。保住平滑的整体、修补日期，还是不完美的来历，由你决定。',
  image:'/assets/mended-cup.png',width:768,height:512,initialBudget:24*1024,sourceReference:'/assets/mended-cup-source.json',
  receiverQuestions:{crack:'杯身留下了什么痕迹？这些痕迹让你怎样理解它？',date:'纸条上还读得出什么？先记下你能确认的部分。',shape:'你能辨认这件器物的形态吗？什么细节仍然明确？'},
  regions:[
    {id:'crack',name:'杯身裂痕',description:'让曾经破损过的痕迹仍然可见。',bounds:{x:.23,y:.17,width:.25,height:.48}},
    {id:'date',name:'修补日期',description:'留下纸条上的 MENDED / 04/12。',bounds:{x:.68,y:.36,width:.12,height:.10}},
    {id:'shape',name:'完整器形',description:'先保住整只杯子的形态与表面。',bounds:{x:.05,y:.11,width:.51,height:.67}},
  ],
}];
export const SCENE=SCENES[0];
export const DEFAULT_RECEPTION_QUESTION='在这张收到的图像中，你实际读到或认出了什么？';
export function receptionQuestion(sourceId:string,priority:string|null):string{
  const questions=SCENES.find(scene=>scene.id===sourceId)?.receiverQuestions;
  return questions&&priority&&Object.hasOwn(questions,priority)?questions[priority]:DEFAULT_RECEPTION_QUESTION;
}

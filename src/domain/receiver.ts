export const READING_CONFIDENCE={clear:'能辨认',uncertain:'不确定',unreadable:'无法辨认'} as const;
export type ReadingConfidence=keyof typeof READING_CONFIDENCE;
export interface FirstLookDraft {readonly confidence:ReadingConfidence|null;readonly reading:string}
export interface FirstLook {readonly confidence:ReadingConfidence;readonly reading:string}
export type ReceptionSession=
  | {readonly entryId:string;readonly phase:'first-look';readonly observation:null}
  | {readonly entryId:string;readonly phase:'comparison';readonly observation:FirstLook};

export function isReadingConfidence(value:unknown):value is ReadingConfidence{
  return typeof value==='string'&&Object.hasOwn(READING_CONFIDENCE,value);
}
export function beginReception(entryId:string):ReceptionSession{
  return {entryId,phase:'first-look',observation:null};
}
export function firstLookIssue(draft:FirstLookDraft):string|null{
  if(!isReadingConfidence(draft.confidence))return '先选一种辨认情况。';
  if(draft.reading.length>240)return '第一眼笔记最多 240 个字符。';
  if(draft.confidence!=='unreadable'&&!draft.reading.trim())return '请写下你实际读到或认出的内容，片段也可以。';
  return null;
}
export function revealOriginal(session:ReceptionSession,draft:FirstLookDraft):Extract<ReceptionSession,{phase:'comparison'}>{
  if(session.phase!=='first-look')throw new Error('这一份第一眼已经记录。重新接收会开始一次新观看。');
  const issue=firstLookIssue(draft);if(issue)throw new Error(issue);
  return {entryId:session.entryId,phase:'comparison',observation:{confidence:draft.confidence!,reading:draft.reading.trim()}};
}

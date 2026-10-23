import test from 'node:test';
import assert from 'node:assert/strict';
import { beginReception, firstLookIssue, revealOriginal, isReadingConfidence } from '../src/domain/receiver.ts';
import { receptionQuestion, DEFAULT_RECEPTION_QUESTION } from '../src/scene.ts';

test('a new receiver starts with only the sealed image and no inherited observation',()=>{
  assert.deepEqual(beginReception('a'),{entryId:'a',phase:'first-look',observation:null});
});

test('the original cannot be revealed before a deliberate first-look response',()=>{
  const session=beginReception('a');
  assert.throws(()=>revealOriginal(session,{confidence:null,reading:'21:40'}),/辨认情况/);
  assert.throws(()=>revealOriginal(session,{confidence:'clear',reading:'  '}),/写下/);
  assert.throws(()=>revealOriginal(session,{confidence:'uncertain',reading:''}),/写下/);
  assert.ok(firstLookIssue({confidence:'clear',reading:'a'.repeat(241)}));
  assert.equal(isReadingConfidence('clear'),true);
  assert.equal(isReadingConfidence('score'),false);
});

test('partial reading and uncertainty are preserved without computing recognition scores',()=>{
  const before=beginReception('a');
  const after=revealOriginal(before,{confidence:'uncertain',reading:'  4  '});
  assert.equal(after.phase,'comparison');
  assert.deepEqual(after.observation,{confidence:'uncertain',reading:'4'});
  assert.equal(before.observation,null);
  assert.deepEqual(Object.keys(after.observation).sort(),['confidence','reading']);
});

test('an unreadable response can honestly contain no guessed text',()=>{
  const after=revealOriginal(beginReception('a'),{confidence:'unreadable',reading:''});
  assert.deepEqual(after.observation,{confidence:'unreadable',reading:''});
});

test('a recorded first look is fixed until a new receiving session begins',()=>{
  const after=revealOriginal(beginReception('a'),{confidence:'clear',reading:'字迹'});
  assert.throws(()=>revealOriginal(after,{confidence:'clear',reading:'修改'}),/已经记录/);
  assert.deepEqual(beginReception('b'),{entryId:'b',phase:'first-look',observation:null});
});

test('questions guide reading without leaking the text and handle custom or older entries',()=>{
  assert.match(receptionQuestion('last-bus','time'),/时刻|时间/);
  assert.ok(!receptionQuestion('last-bus','time').includes('21:40'));
  assert.equal(receptionQuestion('local-image','custom'),DEFAULT_RECEPTION_QUESTION);
  assert.equal(receptionQuestion('small-things',null),DEFAULT_RECEPTION_QUESTION);
  assert.equal(receptionQuestion('small-things','toString'),DEFAULT_RECEPTION_QUESTION);
});

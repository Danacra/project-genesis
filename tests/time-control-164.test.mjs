import test from 'node:test';
import assert from 'node:assert/strict';
import {setClockPaused,setClockSpeed,advanceOneHour,manualAdvanceDay,clockContext} from '../module/world-clock-164.mjs';
import {INITIAL_CLOCK} from '../module/clock-rules-164.mjs';

const me={id:'GM',active:true,isGM:true,name:'Test GM'};
const settings=new Map([['worldDay',3],['worldClock',{...INITIAL_CLOCK}],
 ['dayOperation',{}],['missionOperation',{}],['logisticsJournal',{entries:[],processed:[]}]]);
const writes=[];
globalThis.game={user:me,users:[me],actors:{filter:()=>[],find:()=>null,get:()=>null},
 settings:{get:(_scope,key)=>settings.get(key),set:async(_scope,key,value)=>{
  writes.push([key,value]);settings.set(key,value);return value;}}};
globalThis.ui={notifications:{info(){},warn(){},error(){}}};
globalThis.foundry={utils:{escapeHTML:x=>String(x)}};
globalThis.ChatMessage={create:async()=>({})};

test('1.6.4 only lead active GM may change speed and pause',async()=>{
  await setClockSpeed(10); assert.equal(settings.get('worldClock').speed,10);
  await setClockPaused(true);assert.equal(clockContext().paused,true);
  assert.equal(clockContext().choices.filter(x=>x.selected)[0].value,10);
  await assert.rejects(()=>setClockSpeed(3),/Неизвестная скорость/);
  game.user={id:'OTHER',isGM:false};
  await assert.rejects(()=>setClockPaused(false),/ведущий/);
  game.user=me;
  await setClockPaused(false);
});
test('1.6.4 manual +1 hour advances clock but does not spend daily supplies early',async()=>{
  settings.set('worldClock',{...INITIAL_CLOCK,minute:300});
  writes.length=0;
  await advanceOneHour();
  assert.equal(settings.get('worldClock').minute,360);
  assert.equal(settings.get('worldDay'),3);
  assert.ok(!writes.some(([key])=>key==='dayOperation'));
});
test('1.6.4 manual midnight commits existing durable day exactly once',async()=>{
  settings.set('worldClock',{...INITIAL_CLOCK,minute:1410,paused:true});
  writes.length=0;
  await advanceOneHour();
  assert.equal(settings.get('worldDay'),4);
  assert.equal(settings.get('worldClock').minute,30);
  assert.equal(settings.get('worldClock').pending,null);
  assert.equal(writes.filter(([key,v])=>key==='dayOperation'&&v?.version===1).length,1);
});
test('1.6.4 interrupted midnight marker from already committed day is not replayed',async()=>{
  settings.set('worldClock',{...INITIAL_CLOCK,pending:{day:4,nextMinute:16,failed:false}});
  settings.set('worldDay',5);
  writes.length=0;
  await setClockPaused(true);
  assert.equal(settings.get('worldDay'),5);
  assert.equal(settings.get('worldClock').minute,16);
  assert.equal(settings.get('worldClock').pending,null);
  assert.ok(!writes.some(([key])=>key==='dayOperation'));
});

test('1.6.4 manual full-day step commits one day without changing the clock hour',async()=>{
  settings.set('worldClock',{...INITIAL_CLOCK,minute:1000});
  settings.set('worldDay',7);
  writes.length=0;
  await manualAdvanceDay();
  assert.equal(settings.get('worldDay'),8);
  assert.equal(settings.get('worldClock').minute,1000);
  assert.equal(writes.filter(([key,v])=>key==='dayOperation'&&v?.version===1).length,1);
});
test('1.6.4 manual full-day step finalizes an already committed midnight without double day',async()=>{
  settings.set('worldClock',{...INITIAL_CLOCK,pending:{day:8,nextMinute:42}});
  settings.set('worldDay',9);
  writes.length=0;
  await manualAdvanceDay();
  assert.equal(settings.get('worldDay'),9);
  assert.equal(settings.get('worldClock').minute,42);
  assert.equal(writes.filter(([key,v])=>key==='dayOperation'&&v?.version===1).length,0);
});
test('1.6.4 GM manual recovery retries a failed pending midnight only once',async()=>{
  settings.set('worldClock',{...INITIAL_CLOCK,paused:true,pending:{day:9,nextMinute:27,failed:true}});
  settings.set('worldDay',9);
  writes.length=0;
  await manualAdvanceDay();
  assert.equal(settings.get('worldDay'),10);
  assert.equal(settings.get('worldClock').minute,27);
  assert.equal(settings.get('worldClock').pending,null);
  assert.equal(settings.get('worldClock').paused,true);
  assert.equal(writes.filter(([key,v])=>key==='dayOperation'&&v?.version===1).length,1);
});

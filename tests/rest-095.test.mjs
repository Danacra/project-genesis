import test from 'node:test';import assert from 'node:assert/strict';
import {restOutcome,restContext,hasShelter,requestRest} from '../module/rest.mjs';
const survivor=(fatigue=92)=>({id:'a',name:'A',type:'survivor',system:{survival:{health:72,oxygen:100,fatigue},rest:{lastDay:0}},testUserPermission:()=>true,async update(patch){for(const [k,v]of Object.entries(patch)){if(k==='system.survival')this.system.survival=v;if(k==='system.rest.lastDay')this.system.rest.lastDay=v;}}});
test('rest recovery caps fatigue and shelter heals a little',()=>{
  assert.deepEqual(restOutcome({fatigue:10,health:99},'field',false),{fatigue:0,health:99});
  assert.deepEqual(restOutcome({fatigue:95,health:97},'shelter',true),{fatigue:55,health:100});
  assert.throws(()=>restOutcome({fatigue:60},'shelter',false),/жилой модуль/);
});
test('work assignment blocks rest and per-day limit is displayed',()=>{
  const a=survivor(),c={system:{crew:{jobs:[{actorId:'a'}]},industry:{buildings:[{id:'shelter',count:1}]}}};
  assert.equal(restContext(a,c,2).busy,true);
  assert.equal(restContext(a,c,2).shelter,true);
  a.system.rest.lastDay=2;assert.equal(restContext(a,c,2).used,true);
  assert.equal(hasShelter(null),false);
});
test('GM controlled rest records the day and rejects a duplicate',async()=>{
  const a=survivor(92),c={type:'colony',system:{industry:{buildings:[]},crew:{jobs:[]}}};
  const gm={id:'gm',active:true,isGM:true};const messages=[];
  const state={worldDay:3,dayOperation:{}};
  globalThis.game={user:gm,settings:{get:(_ns,key)=>state[key]},users:Object.assign([gm],{filter:fn=>[gm].filter(fn),get:id=>id==='gm'?gm:null}),actors:{get:id=>id==='a'?a:null,find:fn=>[c].find(fn)}};
  globalThis.ui={notifications:{info:m=>messages.push(m),error:m=>messages.push(m)}};
  await requestRest('a','field');assert.equal(a.system.survival.fatigue,70);assert.equal(a.system.rest.lastDay,3);
  await requestRest('a','field');assert.equal(a.system.survival.fatigue,70);assert.match(messages.at(-1),/уже отдыхал/);
});

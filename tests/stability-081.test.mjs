import test from 'node:test';
import assert from 'node:assert/strict';
import {crewJob,formatCargo,nearby} from '../module/crew-rules.mjs';

test('0.8.1: a crew job advances once per world day even if day rollover is retried',()=>{
  const original={id:'job1',remaining:3,startedDay:1,lastAdvancedDay:0};
  const first=crewJob(original,1);
  assert.equal(first.remaining,2);
  assert.deepEqual(crewJob(first,1),first);
  assert.equal(crewJob(first,2).remaining,1);
  assert.equal(crewJob(crewJob(first,2),2).remaining,1);
  assert.equal(crewJob(crewJob(first,2),3).remaining,0);
  assert.equal(crewJob(crewJob(first,3),4).remaining,0);
  assert.equal(original.remaining,3);
});

test('0.8.1: legacy job without a lastAdvancedDay field is supported',()=>{
  const previous={id:'legacy',remaining:2,startedDay:1};
  const advanced=crewJob(previous,3);
  assert.equal(advanced.remaining,1);
  assert.equal(advanced.lastAdvancedDay,3);
  assert.deepEqual(crewJob(advanced,3),advanced);
});

test('0.8.1: nearest of multiple linked survivor tokens is selected',()=>{
  const scene={grid:{size:100,type:1},dimensions:{sceneRect:{x:0,y:0,width:4000,height:4000}},
    tokens:[{actorId:'surv',x:2800,y:2000,width:1,height:1},{actorId:'surv',x:100,y:100,width:1,height:1}]};
  const chosen=nearby(scene,{id:'surv'},{x:150,y:150});
  assert.equal(chosen.x,100);
  assert.throws(()=>nearby(scene,{id:'other'},{x:150,y:150}),/токен/);
});

test('0.8.1: corrupt cargo dimensions cannot bypass capacity checks',()=>{
  const make=(mass,volume)=>({type:'material',name:'Руда',img:'',system:{resourceCode:'ore',quantity:3,unitMass:mass,
    unitVolume:volume,quality:0,techTier:0,description:''}});
  for(const [m,v] of [[-5,1],[1,-1],[Infinity,1],[1,Infinity],[NaN,1]])
    assert.throws(()=>formatCargo(make(m,v),1),/масса или объём|массу или объём/);
  assert.equal(formatCargo(make(2.5,1.2),1).unitMass,2.5);
});

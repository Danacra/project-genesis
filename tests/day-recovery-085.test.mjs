import test from 'node:test';
import assert from 'node:assert/strict';
import {planDayOperation} from '../module/day-operation.mjs';
import {advanceDay, withWorldLock, initializeLogistics} from '../module/logistics.mjs';

const clone = x => structuredClone(x);
function makeActor(id,type,stocks=[],jobData=null){
  const rows=stocks.map(([code,amount],i)=>({id:`${id}-${code}-${i}`,type:'material',system:{resourceCode:code,quantity:amount}}));
  const items={values:rows,get(k){return rows.find(i=>i.id===k);},[Symbol.iterator](){return rows.values()}};
  const actor={id,name:id,type,items,system:type==='survivor'?{
    survival:{health:100,hunger:0,thirst:0,fatigue:0,oxygen:100}
  }:{industry:{jobs:jobData?[{id:'factory',remaining:3}]:[],construction:[]},crew:{jobs:jobData?[{id:'carrier',remaining:3,lastAdvancedDay:0}]:[]}},
  async updateEmbeddedDocuments(_kind,changes){
    for(const change of changes){
      const item=items.get(change._id); if(!item) throw Error('missing item');
      item.system.quantity=change['system.quantity'];
    }
  },
  async update(changes){
    if(this.failOnce){this.failOnce=false;throw Error('simulated mid-day write fault');}
    for(const [key,value] of Object.entries(changes)){
      if(key==='system.survival')this.system.survival=clone(value);
      else if(key.startsWith('system.industry.'))this.system.industry[key.slice('system.industry.'.length)]=clone(value);
      else if(key.startsWith('system.crew.'))this.system.crew[key.slice('system.crew.'.length)]=clone(value);
      else throw Error('unexpected patch '+key);
    }
  }};
  return actor;
}
function scenario({survivors=2,food=1,water=3,industry=true}={}){
  const gm={id:'gm',name:'GM',isGM:true,active:true},actors=[...Array(survivors)].map((_,i)=>makeActor(`surv${i}`, 'survivor'));
  const colony=makeActor('colony','colony',[['food',food],['water',water]],industry);
  actors.push(colony);
  const ledger={worldDay:1,dayOperation:{}};const errors=[],messages=[];
  globalThis.game={user:gm,system:{version:'0.8.5'},
    users:Object.assign([gm],{filter:fn=>[gm].filter(fn),get:id=>id==='gm'?gm:null}),
    actors:{get:id=>actors.find(a=>a.id===id),find:fn=>actors.find(fn),filter:fn=>actors.filter(fn)},
    settings:{get:(_ns,k)=>ledger[k],async set(_ns,k,v){ledger[k]=clone(v);}},
    socket:{on(){}}};
  globalThis.ui={notifications:{info:m=>messages.push(m),error:m=>errors.push(m)}};
  globalThis.ChatMessage={create:async row=>messages.push(row)};
  globalThis.foundry={utils:{escapeHTML:x=>x}};
  return {actors,colony,ledger,errors,messages};
}
test('planner allocates shared colony rations only once across survivors',()=>{
  const x=scenario();
  const plan=planDayOperation(x.actors.filter(a=>a.type==='survivor'),x.colony,1);
  assert.deepEqual(plan.survival.map(r=>[r.fed,r.hydrated]),[[true,true],[false,false]]);
  assert.deepEqual(plan.items.flatMap(r=>r.updates.map(u=>u.quantity)),[0,1]);
  assert.equal(x.colony.items.get('colony-food-0').system.quantity,1,'planning must not mutate world');
  assert.equal(plan.industry.jobs[0].remaining,2);
  assert.equal(plan.crewJobs[0].remaining,2);
});
test('failed write midway leaves journal and retry applies immutable targets once',async()=>{
  const x=scenario({survivors:2,food:2,water:4});
  x.colony.failOnce=true;
  const first=await advanceDay();
  assert.equal(first.ok,false);
  assert.equal(x.ledger.worldDay,1);
  assert.equal(x.ledger.dayOperation.version,1);
  assert.equal(x.colony.items.get('colony-food-0').system.quantity,0);
  const vital=clone(x.actors[0].system.survival);
  const next=await advanceDay();
  assert.equal(next.day,2);
  assert.equal(x.ledger.worldDay,2);
  assert.deepEqual(x.ledger.dayOperation,{});
  assert.deepEqual(x.actors[0].system.survival,vital);
  assert.equal(x.colony.items.get('colony-food-0').system.quantity,0);
  assert.equal(x.colony.system.industry.jobs[0].remaining,2);
  assert.equal(x.colony.system.crew.jobs[0].remaining,2);
  assert.equal(x.errors.length,1);
});
test('committed day with failed cleanup does not advance or debit twice on retry',async()=>{
  const x=scenario({survivors:1,food:2,water:5});
  const original=x.ledger;
  const settings=globalThis.game.settings;
  const oldSet=settings.set;
  let fail=true;
  settings.set=async(ns,k,v)=>{
    if(k==='dayOperation' && v.version!==1 && fail && original.worldDay===2){fail=false;throw Error('cleanup failed');}
    return oldSet(ns,k,v);
  };
  const first=await advanceDay();
  assert.equal(first.day,2);
  assert.equal(original.dayOperation.version,1);
  const foodAfter=x.colony.items.get('colony-food-0').system.quantity;
  const second=await advanceDay();
  assert.equal(second.recovered,true);
  assert.equal(original.worldDay,2);
  assert.equal(x.colony.items.get('colony-food-0').system.quantity,foodAfter);
  assert.deepEqual(original.dayOperation,{});
});
test('other commands blocked while unfinished day operation exists',async()=>{
  const x=scenario();
  x.ledger.dayOperation=planDayOperation(x.actors.filter(a=>a.type==='survivor'),x.colony,1);
  await assert.rejects(withWorldLock(async()=>42),/Сначала повторите/);
});
test('journal persistence fault before side effects leaves inventory unchanged',async()=>{
  const x=scenario();
  const set=globalThis.game.settings.set;let once=true;
  globalThis.game.settings.set=async(ns,k,v)=>{
    if(once&&k==='dayOperation'){once=false;throw Error('cannot save operation');}
    return set(ns,k,v);
  };
  await advanceDay();
  assert.equal(x.ledger.worldDay,1);
  assert.equal(x.colony.items.get('colony-food-0').system.quantity,1);
  assert.deepEqual(x.ledger.dayOperation,{});
});
test('GM initialization automatically resumes an unfinished day operation',async()=>{
  const x=scenario({survivors:1,food:1,water:2});
  const plan=planDayOperation(x.actors.filter(a=>a.type==='survivor'),x.colony,1);
  x.ledger.dayOperation=clone(plan);
  initializeLogistics();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(x.ledger.worldDay,2);
  assert.deepEqual(x.ledger.dayOperation,{});
  assert.equal(x.colony.items.get('colony-food-0').system.quantity,0);
});

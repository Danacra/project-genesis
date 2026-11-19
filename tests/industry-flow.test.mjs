import test from 'node:test';
import assert from 'node:assert/strict';
import { requestIndustry, advanceIndustryDay, industryContext } from '../module/industry.mjs';
const clone=x=>structuredClone(x);
let seq=0;
function setup({stock=[],tech=['survey'],buildings=[],capacity={mass:2500,volume:10000},failure=null}={}){
  const gm={id:'leader',name:'Ведущий',active:true,isGM:true},messages=[];
  const states={failOnce:failure};
  const science={unlocked:[...tech],facilities:[],points:0,projects:[],dailyWork:[],discoveries:[],tier:0};
  const industry={jobs:[],construction:[],buildings:clone(buildings),history:[],processed:[]};
  const items=[];const make=(raw)=>({id:raw.id||`i${++seq}`,name:raw.name||raw.code||'Предмет',
    type:raw.type||'material',img:raw.img||'icons/svg/item-bag.svg',
    system:{quantity:raw.quantity??1,resourceCode:raw.code||raw.system?.resourceCode||'',
      unitMass:raw.unitMass??raw.system?.unitMass??1,unitVolume:raw.unitVolume??raw.system?.unitVolume??1,
      containerId:'',quality:0,techTier:0,description:'',...raw.system}});
  for(const [code,quantity] of stock)items.push(make({code,quantity}));
  Object.defineProperty(items,'get',{value:id=>items.find(x=>x.id===id)});
  let currentDay=1;
  const colony={id:'colony-1',name:'Новая Земля',type:'colony',system:{science,industry,capacity:clone(capacity)},items,
    async update(patch){
      for(const [path,value] of Object.entries(patch)){
        if(states.failOnce===path){states.failOnce=null;throw Error('Simulated interrupted save');}
        const keys=path.split('.');let parent=this;
        for(const k of keys.slice(0,-1))parent=parent[k];
        parent[keys.at(-1)]=clone(value);
      }
    },
    async updateEmbeddedDocuments(type,updates){assert.equal(type,'Item');for(const u of updates){
      const i=items.get(u._id);if(!i)throw Error('Not found');
      for(const [k,v]of Object.entries(u))if(k!=='_id')i.system[k.replace('system.','')]=v;
    }},
    async createEmbeddedDocuments(type,list){assert.equal(type,'Item');const created=list.map(i=>make({...i,system:i.system,code:i.system.resourceCode}));items.push(...created);return created;},
    async deleteEmbeddedDocuments(type,ids){assert.equal(type,'Item');for(const id of ids){const index=items.findIndex(i=>i.id===id);if(index>=0)items.splice(index,1);}}
  };
  const explorer={id:'surv',type:'survivor',name:'Экспедиция',testUserPermission:()=>true};
  const all=[explorer,colony];
  globalThis.game={user:gm,users:Object.assign([gm],{get:id=>id===gm.id?gm:null}),
    actors:{get:id=>all.find(a=>a.id===id),find:fn=>all.find(fn),filter:fn=>all.filter(fn),some:fn=>all.some(fn)},
    settings:{get(_id,key){return key==='worldDay'?currentDay:null}},socket:{emit(){}}};
  globalThis.ui={notifications:{info:m=>messages.push(['ok',m]),error:m=>messages.push(['error',m])}};
  globalThis.ChatMessage={create:async()=>{}};
  return {colony,industry,science,items,messages,setDay:n=>currentDay=n,create:make};
}
const run = async (action,details={})=>requestIndustry({colonyId:'colony-1',action,...details});
test('production: deduct, count days, collect into colony inventory',async()=>{
  const x=setup({stock:[['fiber',3]]});
  await run('start-recipe',{subject:'field-notes',amount:2});
  assert.equal(x.colony.system.industry.jobs.length,1);
  assert.equal(x.items[0].system.quantity,1);
  const id=x.colony.system.industry.jobs[0].id;
  await advanceIndustryDay(x.colony);
  assert.equal(x.colony.system.industry.jobs[0].remaining,1);
  await run('collect',{jobId:id});
  assert.equal(x.messages.at(-1)[0],'error');
  await advanceIndustryDay(x.colony);
  await run('collect',{jobId:id});
  assert.equal(x.colony.system.industry.jobs.length,0);
  assert.equal(x.items.find(i=>i.system.resourceCode==='field_notes')?.system.quantity,2);
  assert.equal(x.messages.at(-1)[0],'ok');
});
test('cancellation restores all reserved resources',async()=>{
  const x=setup({stock:[['fiber',2]]});
  await run('start-recipe',{subject:'field-notes',amount:2});
  const id=x.colony.system.industry.jobs[0].id;
  await run('cancel',{jobId:id,queue:'jobs'});
  assert.equal(x.items[0].system.quantity,2);
  assert.equal(x.colony.system.industry.jobs.length,0);
});
test('cancel restores missing original stack as new material',async()=>{
  const x=setup({stock:[['fiber',2]]});
  await run('start-recipe',{subject:'field-notes',amount:2});
  x.items.splice(0,1);
  await run('cancel',{jobId:x.colony.system.industry.jobs[0].id,queue:'jobs'});
  assert.equal(x.items.find(i=>i.system.resourceCode==='fiber')?.system.quantity,2);
});
test('failure to save job restores input stocks',async()=>{
  const x=setup({stock:[['fiber',2]],failure:'system.industry.jobs'});
  await run('start-recipe',{subject:'field-notes',amount:1});
  assert.equal(x.items[0].system.quantity,2);
  assert.equal(x.colony.system.industry.jobs.length,0);
  assert.equal(x.messages.at(-1)[0],'error');
});
test('finished product waits for more warehouse capacity',async()=>{
  const x=setup({stock:[['fiber',1]],capacity:{mass:0,volume:0}});
  await run('start-recipe',{subject:'field-notes',amount:1});
  const id=x.colony.system.industry.jobs[0].id;
  await advanceIndustryDay(x.colony);
  await run('collect',{jobId:id});
  assert.equal(x.messages.at(-1)[0],'error');
  assert.equal(x.colony.system.industry.jobs.length,1);
  x.colony.system.capacity.mass=10;x.colony.system.capacity.volume=10;
  await run('collect',{jobId:id});
  assert.equal(x.colony.system.industry.jobs.length,0);
});
test('construction: deduct resources, tick, then activate bench',async()=>{
  const x=setup({stock:[['wood',3],['stone',2]],tech:['stone-tools']});
  await run('start-building',{subject:'bench'});
  assert.equal(x.colony.system.industry.construction.length,1);
  const id=x.colony.system.industry.construction[0].id;
  await advanceIndustryDay(x.colony);
  await run('complete-building',{jobId:id});
  assert.equal(x.colony.system.industry.construction.length,0);
  assert.equal(x.colony.system.industry.buildings[0].id,'bench');
  assert.deepEqual(x.colony.system.science.facilities,['bench']);
  await run('start-building',{subject:'bench'});
  assert.equal(x.messages.at(-1)[0],'error');
});
test('constructed storehouse raises max weight but only after acceptance',async()=>{
  const x=setup({stock:[['wood',5],['stone',3],['scrap',2]],tech:['basic-workshop']});
  await run('start-building',{subject:'storehouse'});
  assert.equal(x.colony.system.capacity.mass,2500);
  await advanceIndustryDay(x.colony);await advanceIndustryDay(x.colony);
  await run('complete-building',{jobId:x.colony.system.industry.construction[0].id});
  assert.equal(x.colony.system.industry.buildings[0].count,1);
  assert.equal(x.colony.system.capacity.mass,2500);
});
test('garden daily harvest is claimable only once per day',async()=>{
  const x=setup({buildings:[{id:'garden',count:1,builtDay:1,lastClaimDay:0}]});
  await run('harvest',{subject:'garden'});
  assert.equal(x.items.find(i=>i.system.resourceCode==='food')?.system.quantity,3);
  await run('harvest',{subject:'garden'});
  assert.equal(x.messages.at(-1)[0],'error');
  x.setDay(2);
  await run('harvest',{subject:'garden'});
  assert.equal(x.items.find(i=>i.system.resourceCode==='food')?.system.quantity,6);
});
test('production context reflects unlocked items, machine, buildings and jobs',async()=>{
  const x=setup({stock:[['fiber',1]]});
  const view=industryContext(x.colony,game.user);
  assert.equal(view.available,true);assert.equal(view.craft.length,27);
  assert.equal(view.buildings.length,14);
  assert.equal(view.craft.find(r=>r.id==='field-notes').canQueue,true);
  assert.equal(view.craft.find(r=>r.id==='stone-kit').canQueue,false);
});

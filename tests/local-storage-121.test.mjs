import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILDING_BY_ID,RECIPES} from '../module/industry-data.mjs';
import {BUILDING_FOOTPRINTS} from '../module/map-rules.mjs';
import {cacheLimit,validateCache,changeStock,stockFor} from '../module/crew-rules.mjs';
import {warehouseNearStation,localStockCounts,planLocalTake,restoreLocalTake,localOutput,localWarehouseStatus} from '../module/local-storage-rules.mjs';
import {structureBlockers} from '../module/structure-rules.mjs';
import {requestIndustry,advanceIndustryDay} from '../module/industry.mjs';
const clone=structuredClone;
const w={id:'warehouse',buildingId:'local-store',status:'finished',sceneId:'surface',colonyId:'colony',tileId:'tile-warehouse',jobId:'job-wh',x:600,y:100,width:300,height:300};
const b={id:'station',buildingId:'bench',status:'finished',sceneId:'surface',colonyId:'colony',tileId:'tile-station',jobId:'job-st',x:100,y:100,width:200,height:200};
const cargo=(code,quantity,unitMass=1,unitVolume=1)=>({code,quantity,name:code,type:'material',img:'',unitMass,unitVolume,quality:0,techTier:0,description:''});
const scenes={get:id=>id==='surface'?{flags:{}}:id==='inner'?{flags:{'project-genesis':{exteriorSceneId:'surface',interiorOf:'building-room'}}}:null};
test('v1.2.1 local warehouse has independent finite capacity and own tile',()=>{
  assert.equal(BUILDING_BY_ID['local-store'].max,12);
  assert.deepEqual(BUILDING_FOOTPRINTS['local-store'],[3,3]);
  assert.deepEqual(cacheLimit(w),{mass:750,volume:1500});
  assert.deepEqual(localWarehouseStatus([cargo('wood',2,2,4)],w).load,{mass:4,volume:8});
  assert.throws(()=>validateCache([],cargo('stone',376,2,1),w),/недостаточно места/);
  assert.doesNotThrow(()=>validateCache([],cargo('stone',375,2,1),w));
});
test('v1.2.1 stocks never silently mix between local warehouses and main colony',()=>{
  const first=[cargo('wood',4),cargo('scrap',2)],second=[cargo('stone',50)];
  const result=planLocalTake(first,{wood:2,scrap:2});
  assert.deepEqual({...localStockCounts(result.stock)},{wood:2});
  assert.deepEqual({...localStockCounts(second)},{stone:50});
  assert.deepEqual({...localStockCounts(restoreLocalTake(result.stock,result.reserved,w))},{wood:4,scrap:2});
  assert.throws(()=>planLocalTake(first,{stone:1}),/недостаточно/);
});
test('v1.2.1 local output keeps item metadata and refuses overcapacity',()=>{
  const item={name:'Компонент',type:'component',img:'pic.svg',system:{resourceCode:'component_x',quantity:2,unitMass:2,unitVolume:3}};
  const stock=localOutput([],item,w);
  assert.equal(stock[0].code,'component_x');assert.equal(stock[0].quantity,2);
  assert.equal(stock[0].img,'pic.svg');
  assert.throws(()=>localOutput([cargo('rock',750)],item,w),/недостаточно места/);
});
test('v1.2.1 indoor station can use warehouse on exterior map, not another scene',()=>{
  assert.equal(warehouseNearStation(b,w,scenes),true);
  assert.equal(warehouseNearStation({...b,sceneId:'inner'},w,scenes),true);
  assert.equal(warehouseNearStation({...b,sceneId:'other'},w,scenes),false);
  assert.equal(warehouseNearStation(b,{...w,status:'construction'},scenes),false);
  assert.equal(warehouseNearStation(b,{...w,buildingId:'storehouse'},scenes),false);
});
test('v1.2.1 warehouse with stock or outstanding production cannot be dismantled',()=>{
  assert.equal(structureBlockers(w,{caches:[{placementId:w.id,stock:[cargo('wood',1)]}]}).length,1);
  assert.equal(structureBlockers(w,{productionJobs:[{sourcePlacementId:w.id}]}).length,1);
  assert.equal(structureBlockers(w,{productionJobs:[{outputPlacementId:w.id}]}).length,1);
});
let idx=0;
function setup({failCommit=false,initialStock=[cargo('wood',3),cargo('scrap',2)]}={}){
  const gm={id:'gm',name:'GM',isGM:true,active:true};const messages=[];
  const placements=[clone(w),clone(b)];
  const tiles=placements.map(p=>({id:p.tileId,x:p.x,y:p.y,width:p.width,height:p.height,rotation:0,
    flags:{'project-genesis':{colonyId:'colony',jobId:p.jobId,placementId:p.id,buildingId:p.buildingId,status:'finished'}}}));
  tiles.get=id=>tiles.find(t=>t.id===id);
  const scene={id:'surface',flags:{},tiles,grid:{size:100,type:1},dimensions:{sceneRect:{x:0,y:0,width:2000,height:2000}}};
  let day=1,fail=failCommit;
  const industry={jobs:[],construction:[],placements,buildings:[{id:'bench',count:1},{id:'local-store',count:1}],processed:[],history:[]};
  const crew={caches:[{placementId:w.id,stock:clone(initialStock)}],jobs:[],nodes:[],history:[],processed:[]};
  const colony={id:'colony',type:'colony',name:'База',items:[],system:{industry,crew,
    capacity:{mass:2500,volume:10000},infrastructure:{links:[],priorities:[]},science:{unlocked:['basic-workshop'],facilities:['bench']}},
    async update(patch){if(fail){fail=false;throw Error('Interrupted Actor.update');}
      for(const [key,value] of Object.entries(patch)){const keys=key.split('.');let node=this;
        for(const name of keys.slice(0,-1))node=node[name];node[keys.at(-1)]=clone(value);}},
    async updateEmbeddedDocuments(){throw Error('Should not modify central inventory');},
    async createEmbeddedDocuments(){throw Error('Should not create central item');}};
  const human={id:'human',type:'survivor',testUserPermission:()=>true};
  const users=[gm];const actors=[colony,human];
  globalThis.game={user:gm,users:{filter:fn=>users.filter(fn),get:id=>users.find(u=>u.id===id)},
    actors:{get:id=>actors.find(a=>a.id===id),find:fn=>actors.find(fn),filter:fn=>actors.filter(fn),some:fn=>actors.some(fn)},
    scenes:{get:id=>id==='surface'?scene:null},settings:{get:()=>day},socket:{emit(){}}};
  globalThis.ui={notifications:{info:m=>messages.push({ok:true,message:m}),error:m=>messages.push({ok:false,message:m})}};
  const run=(action,fields={})=>requestIndustry({action,colonyId:colony.id,...fields});
  return {colony,run,messages,setDay:x=>{day=x;},scene};
}
test('v1.2.1 local craft reserves only local stock, cancellation restores it',async()=>{
  const t=setup();
  await t.run('start-recipe',{subject:'workshop-tools',amount:1,stationPlacementId:b.id,sourcePlacementId:w.id});
  assert.equal(t.messages.at(-1).ok,true,t.messages.at(-1).message);
  assert.equal(stockFor(t.colony.system.crew,w.id).find(x=>x.code==='wood')?.quantity,1);
  assert.equal(t.colony.items.length,0);
  assert.equal(t.colony.system.industry.jobs[0].sourcePlacementId,w.id);
  const id=t.colony.system.industry.jobs[0].id;
  await t.run('cancel',{jobId:id,queue:'jobs'});
  assert.equal(t.messages.at(-1).ok,true,t.messages.at(-1).message);
  assert.deepEqual({...localStockCounts(stockFor(t.colony.system.crew,w.id))},{wood:3,scrap:2});
  assert.equal(t.colony.system.industry.jobs.length,0);
});
test('v1.2.1 local craft collects output into same local warehouse without moving colony items',async()=>{
  const t=setup();
  await t.run('start-recipe',{subject:'workshop-tools',amount:1,stationPlacementId:b.id,sourcePlacementId:w.id});
  const job=t.colony.system.industry.jobs[0];
  await advanceIndustryDay(t.colony);
  await t.run('collect',{jobId:job.id});
  assert.equal(t.messages.at(-1).ok,true,t.messages.at(-1).message);
  assert.equal(stockFor(t.colony.system.crew,w.id).find(x=>x.code==='workshop_tools')?.quantity,1);
  assert.equal(t.colony.items.length,0);
  assert.equal(t.colony.system.industry.jobs.length,0);
  await t.run('collect',{jobId:job.id});assert.equal(t.messages.at(-1).ok,false);
});
test('v1.2.1 local craft rejects remote warehouse and does not reserve supplies',async()=>{
  const t=setup();
  t.colony.system.industry.placements[0].sceneId='remote';
  await t.run('start-recipe',{subject:'workshop-tools',amount:1,stationPlacementId:b.id,sourcePlacementId:w.id});
  assert.equal(t.messages.at(-1).ok,false);
  assert.deepEqual({...localStockCounts(stockFor(t.colony.system.crew,w.id))},{wood:3,scrap:2});
});
test('v1.2.1 failed local start does not debit stock or enqueue production',async()=>{
  const t=setup({failCommit:true});
  await t.run('start-recipe',{subject:'workshop-tools',amount:1,stationPlacementId:b.id,sourcePlacementId:w.id});
  assert.equal(t.messages.at(-1).ok,false);
  assert.deepEqual({...localStockCounts(stockFor(t.colony.system.crew,w.id))},{wood:3,scrap:2});
  assert.equal(t.colony.system.industry.jobs.length,0);
});
test('v1.2.1 local output capacity error keeps ready job and does not mint items',async()=>{
  const t=setup();
  await t.run('start-recipe',{subject:'workshop-tools',amount:1,stationPlacementId:b.id,sourcePlacementId:w.id});
  const id=t.colony.system.industry.jobs[0].id;
  await advanceIndustryDay(t.colony);
  t.colony.system.crew.caches=[{placementId:w.id,stock:[cargo('stone',750)]}];
  await t.run('collect',{jobId:id});
  assert.equal(t.messages.at(-1).ok,false);
  assert.equal(t.colony.system.industry.jobs.length,1);
  assert.equal(t.colony.items.length,0);
});
test('v1.2.1 failed local collection keeps unclaimed order and unchanged warehouse',async()=>{
  const t=setup();
  await t.run('start-recipe',{subject:'workshop-tools',amount:1,stationPlacementId:b.id,sourcePlacementId:w.id});
  await advanceIndustryDay(t.colony);
  const id=t.colony.system.industry.jobs[0].id;
  const original=t.colony.update;
  let fail=true;
  t.colony.update=async function(patch){if(fail){fail=false;throw Error('Simulated server refusal');}return original.call(this,patch);};
  const before=clone(stockFor(t.colony.system.crew,w.id));
  await t.run('collect',{jobId:id});
  assert.equal(t.messages.at(-1).ok,false);
  assert.deepEqual(stockFor(t.colony.system.crew,w.id),before);
  assert.equal(t.colony.system.industry.jobs.length,1);
  await t.run('collect',{jobId:id});
  assert.equal(t.messages.at(-1).ok,true);
  assert.equal(t.colony.system.industry.jobs.length,0);
});

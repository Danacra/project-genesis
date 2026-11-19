import test from 'node:test';
import assert from 'node:assert/strict';
import {refundPlan} from '../module/industry-rules.mjs';
import {networkContext} from '../module/networks.mjs';
import {industryContext} from '../module/industry.mjs';
import {initializeCrew} from '../module/crew.mjs';
import {initializeLogistics} from '../module/logistics.mjs';

const material=(id,n=0,containerId='')=>({id,name:'Древесина',type:'material',img:'icons/svg/item-bag.svg',
  system:{resourceCode:'wood',quantity:n,unitMass:1,unitVolume:1,containerId,quality:0,techTier:0,description:''}});
const refund=(itemId,n)=>({itemId,count:n,code:'wood',name:'Древесина',type:'material',img:'icons/svg/item-bag.svg',
  unitMass:1,unitVolume:1,quality:0,techTier:0,description:''});

test('v1.2.2 refund planner does bounded inventory scans even with many stacks',()=>{
  const data=Array.from({length:150},(_,i)=>material('m'+i,0));
  let passes=0;
  const items={[Symbol.iterator](){passes++;return data[Symbol.iterator]();}};
  const colony={type:'colony',items,system:{capacity:{mass:1000,volume:1000},industry:{buildings:[]}}};
  const rows=data.map(x=>refund(x.id,1));
  const plan=refundPlan(colony,rows);
  assert.equal(plan.changes.length,150);
  assert.ok(passes<=5,`Expected indexed scans, observed ${passes} whole inventory passes`);
});

test('v1.2.2 repeated refunds to one container use cumulative capacity',()=>{
  const box={id:'box',name:'Контейнер',type:'container',system:{containerId:'',tareMass:0,tareVolume:0,capacityMass:5,capacityVolume:5}};
  const items=[box,material('one',1,'box'),material('two',1,'box')];
  const colony={type:'colony',items,system:{capacity:{mass:100,volume:100},industry:{buildings:[]}}};
  assert.throws(()=>refundPlan(colony,[refund('one',2),refund('two',2)]),/Недостаточно места в контейнере/);
  assert.deepEqual(items.filter(x=>x.type==='material').map(x=>x.system.quantity),[1,1], 'plan cannot mutate inventory');
  const okay=refundPlan(colony,[refund('one',1),refund('two',1)]);
  assert.deepEqual(okay.changes.map(c=>c.after),[2,2]);
});

function socketWorld(){
  const gm={id:'gm',isGM:true,active:true,name:'GM'};
  const handlers=[];const outbound=[];
  globalThis.game={user:gm,system:{version:'1.2.2'},
    users:{filter:f=>[gm].filter(f),get:id=>id===gm.id?gm:null},
    actors:{get:()=>null,find:()=>null,filter:()=>[],some:()=>false},
    settings:{get:()=>({})},socket:{on:(_topic,fn)=>handlers.push(fn),emit:(_topic,payload)=>outbound.push(payload)}};
  globalThis.ui={notifications:{info:()=>{},error:()=>{}}};
  return {handlers,outbound};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('v1.2.2 GM ignores crew requests with a forged user identity',async()=>{
  const {handlers,outbound}=socketWorld();initializeCrew();
  assert.equal(handlers.length,1);
  const fake={kind:'crew-request',id:'aaaaaaaaaaaa',userId:'gm',colonyId:'fake',action:'remove-node'};
  handlers[0](fake,'another-user');await flush();
  assert.equal(outbound.length,0,'a forged sender must not reach the operation queue');
  handlers[0](fake,'gm');await flush();
  assert.equal(outbound.length,1,'a matching sender reaches the ordinary validation flow');
  assert.equal(outbound[0].ok,false);
});

test('v1.2.2 GM ignores transfer requests with a forged user identity',async()=>{
  const {handlers,outbound}=socketWorld();initializeLogistics();
  assert.equal(handlers.length,1);
  const fake={kind:'transfer-request',id:'bbbbbbbbbbbb',userId:'gm',sourceActorId:'one',targetActorId:'two',itemId:'stone',quantity:1};
  handlers[0](fake,'another-user');await flush();
  assert.equal(outbound.length,0);
  handlers[0](fake,'gm');await flush();
  assert.equal(outbound.length,1);
  assert.equal(outbound[0].ok,false);
});

function builtFixture(){
  let reads=0;
  const p={id:'bench-1',colonyId:'c',buildingId:'bench',sceneId:'surface',tileId:'tile-1',jobId:'job-1',
    x:100,y:100,width:200,height:200,status:'finished'};
  const tile={id:'tile-1',x:100,y:100,width:200,height:200,rotation:0,
    flags:{'project-genesis':{colonyId:'c',buildingId:'bench',jobId:'job-1',placementId:'bench-1',status:'finished'}}};
  const scene={id:'surface',grid:{size:100,type:1},tiles:{get:id=>id==='tile-1'?tile:null},flags:{}};
  const colony={id:'c',type:'colony',name:'Тестовая колония',items:[],system:{science:{unlocked:['stone-tools'],facilities:[],points:0},
    industry:{placements:[p],buildings:[{id:'bench',count:1}],construction:[],jobs:[],history:[],processed:[]},
    infrastructure:{links:[],priorities:[]},crew:{caches:[],jobs:[]},capacity:{mass:1000,volume:1000}}};
  const gm={id:'gm',isGM:true};
  globalThis.game={user:gm,actors:{find:f=>f(colony)?colony:null,some:()=>false},
    scenes:{get(id){reads++;return id==='surface'?scene:null;}},settings:{get:()=>1}};
  const snapshot={simulation:{byId:{'bench-1':{operational:true,manual:true}},totals:{power:{},water:{}}},statuses:{}};
  return {colony,gm,snapshot,getReads:()=>reads};
}

test('v1.2.2 network context consumes precomputed simulation without rebuilding it',()=>{
  const f=builtFixture();
  const context=networkContext(f.colony,f.gm,f.snapshot);
  assert.equal(context.buildings[0].name,'Верстак');
  assert.equal(context.simulation,f.snapshot.simulation);
  assert.equal(f.getReads(),1,'only the scene label should be accessed');
});

test('v1.2.2 industry context reuses the network snapshot and preserves catalog output',()=>{
  const f=builtFixture();
  const context=industryContext(f.colony,f.gm,f.snapshot.simulation);
  assert.equal(context.available,true);
  assert.equal(context.buildings.find(b=>b.id==='bench').built,1);
  assert.equal(context.buildings.find(b=>b.id==='bench').legacyUnmapped,0);
  assert.equal(context.craft.length,41);
  assert.ok(f.getReads()<20,'render should not repeatedly walk network geometry for identical stations');
});

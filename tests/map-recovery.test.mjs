import test from 'node:test';
import assert from 'node:assert/strict';
import {placementHealth,assertHealthyPlacement} from '../module/map-rules.mjs';
import {requestIndustry,industryContext,advanceIndustryDay} from '../module/industry.mjs';
let n=0;
const clone=structuredClone;
function setup(){
  const gm={id:'gm',name:'GM',isGM:true,active:true},player={id:'player',name:'Player',isGM:false,active:true};
  const items=[{id:'wood',name:'Древесина',img:'',type:'material',system:{resourceCode:'wood',quantity:15,unitMass:1,unitVolume:1,containerId:''}},
    {id:'stone',name:'Камень',img:'',type:'material',system:{resourceCode:'stone',quantity:10,unitMass:1,unitVolume:1,containerId:''}}];
  items.get=id=>items.find(i=>i.id===id);
  const industry={jobs:[],construction:[],buildings:[],placements:[],history:[],processed:[]};
  const colony={id:'colony',type:'colony',name:'База',items,system:{industry,capacity:{mass:2500,volume:10000},science:{unlocked:['stone-tools','basic-workshop'],facilities:[]}},
    async update(patch){for(const [key,v] of Object.entries(patch)){
      const seg=key.split('.');let o=this;for(const p of seg.slice(0,-1))o=o[p];o[seg.at(-1)]=clone(v);
    }},
    async updateEmbeddedDocuments(kind,updates){assert.equal(kind,'Item');for(const u of updates)items.get(u._id).system.quantity=u['system.quantity'];},
    async createEmbeddedDocuments(){throw Error('No items expected');}
  };
  const tiles=[];tiles.get=id=>tiles.find(t=>t.id===id);
  const scene={id:'scene1',name:'Локальная сцена',grid:{type:1,size:100},width:1400,height:1400,
    dimensions:{sceneRect:{x:0,y:0,width:1400,height:1400}},tiles,
    async createEmbeddedDocuments(kind,entries){assert.equal(kind,'Tile');const created=entries.map(e=>({...clone(e),id:`tile-${++n}`,toObject(){return {...clone(e),_id:this.id};}}));tiles.push(...created);return created;},
    async deleteEmbeddedDocuments(kind,ids){assert.equal(kind,'Tile');for(const id of ids){const i=tiles.findIndex(t=>t.id===id);if(i>=0)tiles.splice(i,1);}},
    async updateEmbeddedDocuments(kind,updates){assert.equal(kind,'Tile');for(const u of updates){const t=tiles.get(u._id);t.texture.src=u['texture.src'];t.flags['project-genesis'].status=u['flags.project-genesis.status'];}}
  };
  const users=[gm,player];users.get=id=>users.find(u=>u.id===id);
  const actors=[colony,{id:'survivor',type:'survivor',testUserPermission:()=>true}];
  let day=1;
  const notifications=[];
  globalThis.game={user:gm,users,actors:{get:id=>actors.find(a=>a.id===id),find:fn=>actors.find(fn),some:fn=>actors.some(fn),filter:fn=>actors.filter(fn)},
    scenes:{get:id=>id===scene.id?scene:null},settings:{get:(_id,k)=>k==='worldDay'?day:undefined},socket:{emit:()=>{}}};
  globalThis.ui={notifications:{info:message=>notifications.push({ok:true,message}),error:message=>notifications.push({ok:false,message})}};
  const run=(action,extra={})=>requestIndustry({colonyId:'colony',action,...extra});
  const place=()=>run('start-building',{subject:'bench',sceneId:'scene1',x:100,y:100});
  const saved=()=>colony.system.industry.placements[0];
  return {gm,player,scene,tiles,colony,items,notifications,run,place,saved,setDay:i=>day=i};
}
test('removed tile is diagnosed, GM can recover it without resource cost or duplicate building',async()=>{
  const s=setup();await s.place();const p=s.saved(),job=s.colony.system.industry.construction[0];
  assert.equal(s.items.get('wood').system.quantity,12);
  s.tiles.splice(0,1);
  const context=industryContext(s.colony,game.user);
  assert.equal(context.placements[0].mapProblem,'Тайл отсутствует');
  assert.equal(context.placements[0].canRepair,true);
  await s.run('repair-map',{placementId:p.id});
  assert.equal(s.notifications.at(-1).ok,true);
  assert.equal(s.items.get('wood').system.quantity,12);
  assert.equal(s.colony.system.industry.construction.length,1);
  assert.equal(s.tiles.length,1);
  assert.notEqual(s.saved().tileId,p.tileId);
  assert.equal(placementHealth(s.saved(),s.scene,s.tiles[0]),'ok');
  await advanceIndustryDay(s.colony);
  await s.run('complete-building',{jobId:job.id});
  assert.equal(s.notifications.at(-1).ok,true);
  assert.equal(s.tiles[0].flags['project-genesis'].status,'finished');
  assert.equal(s.colony.system.industry.buildings[0].count,1);
});
test('existing tile is not duplicated by a repair request',async()=>{
  const s=setup();await s.place();await s.run('repair-map',{placementId:s.saved().id});
  assert.equal(s.notifications.at(-1).ok,false);
  assert.equal(s.tiles.length,1);
});
test('move/resize of a tile blocks completion and cancel, preserving materials and queue',async()=>{
  const s=setup();await s.place();s.tiles[0].x+=100;
  assert.equal(placementHealth(s.saved(),s.scene,s.tiles[0]),'moved-tile');
  const ctx=industryContext(s.colony,game.user);
  assert.equal(ctx.placements[0].mapProblem,'Тайл перемещён');
  assert.equal(ctx.placements[0].canRepair,false);
  await advanceIndustryDay(s.colony);
  await s.run('complete-building',{jobId:s.saved().jobId});
  assert.equal(s.notifications.at(-1).ok,false);
  await s.run('cancel',{queue:'construction',jobId:s.saved().jobId});
  assert.equal(s.notifications.at(-1).ok,false);
  assert.equal(s.colony.system.industry.construction.length,1);
  assert.equal(s.items.get('wood').system.quantity,12);
});
test('repair refuses a position occupied since the original tile was removed',async()=>{
  const s=setup();await s.place();const p=s.saved();s.tiles.splice(0,1);
  s.tiles.push({id:'blocking',x:100,y:100,width:100,height:100,flags:{'project-genesis':{blockPlacement:true}}});
  await s.run('repair-map',{placementId:p.id});
  assert.equal(s.notifications.at(-1).ok,false);
  assert.equal(s.tiles.length,1);
  assert.equal(s.saved().tileId,p.tileId);
});
test('failed colony update rolls back replacement tile',async()=>{
  const s=setup();await s.place();const p=s.saved();s.tiles.splice(0,1);
  const orig=s.colony.update;
  s.colony.update=async()=>{throw Error('save unavailable');};
  await s.run('repair-map',{placementId:p.id});
  assert.equal(s.notifications.at(-1).ok,false);
  assert.equal(s.tiles.length,0);
  assert.equal(s.saved().tileId,p.tileId);
  s.colony.update=orig;
});
test('finished building can also be recovered; no second acceptance or construction started',async()=>{
  const s=setup();await s.place();const p=s.saved();await advanceIndustryDay(s.colony);
  await s.run('complete-building',{jobId:p.jobId});
  s.tiles.splice(0,1);
  await s.run('repair-map',{placementId:p.id});
  assert.equal(s.notifications.at(-1).ok,true);
  assert.equal(s.tiles[0].flags['project-genesis'].status,'finished');
  assert.equal(s.colony.system.industry.buildings[0].count,1);
});
test('detect corrupted flags and status mismatches rather than modifying wrong tiles',async()=>{
  const s=setup();await s.place();
  s.tiles[0].flags['project-genesis'].status='finished';
  assert.equal(placementHealth(s.saved(),s.scene,s.tiles[0]),'status-mismatch');
  assert.throws(()=>assertHealthyPlacement(s.saved(),s.scene,s.tiles[0]),/Состояние/);
  s.tiles[0].flags['project-genesis'].colonyId='other';
  assert.equal(placementHealth(s.saved(),s.scene,s.tiles[0]),'foreign-tile');
});
test('a missing scene is diagnosed and not treated as a missing tile',()=>{
  const p={id:'p',colonyId:'x',jobId:'j',buildingId:'bench',status:'construction'};
  assert.equal(placementHealth(p,null,null),'missing-scene');
});
test('partial inventory debit failure restores original amounts',async()=>{
  const s=setup();const original=s.colony.updateEmbeddedDocuments;
  let first=true;
  s.colony.updateEmbeddedDocuments=async(kind,updates)=>{
    if(first){first=false;await original(kind,updates.slice(0,1));throw Error('unexpected partial write');}
    return original(kind,updates);
  };
  await s.place();
  assert.equal(s.notifications.at(-1).ok,false);
  assert.equal(s.items.get('wood').system.quantity,15);
  assert.equal(s.items.get('stone').system.quantity,10);
  assert.equal(s.tiles.length,0);
  assert.equal(s.colony.system.industry.construction.length,0);
});

import test from 'node:test';import assert from 'node:assert/strict';
import {MISSION_COMPONENTS,missionStage,missionInventoryPlan,planMissionOperation} from '../module/mission-rules.mjs';
import {requestMission,replayMissionOperation} from '../module/mission.mjs';
const clone=x=>structuredClone(x);
function colony(){
  const list=[['hull_sections',3],['habitat_module',1],['navigation_core',1],['propulsion_assembly',1],['orbital_core',1]]
    .map(([code,amount])=>({id:code,type:'component',system:{resourceCode:code,quantity:amount}}));
  const items={get:id=>list.find(i=>i.id===id),[Symbol.iterator](){return list.values()}};
  return {id:'base',type:'colony',name:'Base',items,system:{
    environment:{zone:'temperate',seed:71},
    science:{unlocked:['return-project']},
    industry:{buildings:[{id:'assembly-dock',count:1},{id:'powerLab',count:1},{id:'flightLab',count:1}],
      placements:[{buildingId:'assembly-dock',sceneId:'world',status:'finished',x:10,y:20,width:600,height:500}]},
    mission:{stage:0,events:[],shipTileId:''}},
    async updateEmbeddedDocuments(kind,rows){
      assert.equal(kind,'Item');for(const r of rows){const i=items.get(r._id);if(!i)throw Error('missing');i.system.quantity=r['system.quantity'];}
    },
    async update(patch){
      if(this.failUpdate){this.failUpdate=false;throw Error('simulated fault');}
      for(const [path,value]of Object.entries(patch)){
        assert.ok(path.startsWith('system.mission.'));
        this.system.mission[path.slice('system.mission.'.length)]=clone(value);
      }
    }
  };
}
function scenario(){
  const c=colony(),gm={id:'gm',name:'GM',active:true,isGM:true},settings={worldDay:1,missionOperation:{},dayOperation:{}};
  const tiles=[],messages=[];
  const scene={tiles,async createEmbeddedDocuments(kind,rows){assert.equal(kind,'Tile');
    const out=rows.map((r,i)=>({...r,id:`ship${tiles.length+i}`}));tiles.push(...out);return out;}};
  globalThis.game={user:gm,system:{version:'1.0.0'},settings:{get:(_ns,k)=>settings[k],async set(_ns,k,value){settings[k]=clone(value);}},
    users:Object.assign([gm],{filter:fn=>[gm].filter(fn),get:id=>id==='gm'?gm:null}),
    actors:{get:id=>id==='base'?c:null,find:fn=>[c].find(fn),some:fn=>[c].some(fn)},
    scenes:{get:id=>id==='world'?scene:null}};
  globalThis.ui={notifications:{info:m=>messages.push(m),error:m=>messages.push(m)}};
  globalThis.ChatMessage={create:async message=>messages.push(message.content)};
  return {c,tiles,settings,messages};
}
test('milestone requirements actually depend on technology and mapped dock',()=>{
  const c=colony();assert.equal(missionStage(c,1).ready,true);
  c.system.science.unlocked=[];assert.equal(missionStage(c,1).ready,false);
  c.system.science.unlocked=['return-project'];c.system.industry.placements=[];assert.equal(missionStage(c,1).ready,false);
});
test('ship inventory plan consumes only requested amounts, not whole stacks',()=>{
  const c=colony();const a=missionInventoryPlan(c.items,MISSION_COMPONENTS[1]);
  assert.equal(a.find(x=>x.id==='hull_sections').quantity,1);
  assert.equal(a.find(x=>x.id==='habitat_module').quantity,0);
  c.items.get('hull_sections').system.quantity=1;
  assert.throws(()=>missionInventoryPlan(c.items,MISSION_COMPONENTS[1]),/Не хватает/);
});
test('GM can complete all stages, creates exactly one ship tile, then launches',async()=>{
  const s=scenario();let d=1;
  // Need benign launch weather; choosing next world day is sufficient and deterministic.
  for(let candidate=1;candidate<50;candidate++)if(missionStage(s.c,candidate).stage===0){d=candidate;break;}
  await requestMission(s.c.id);assert.equal(s.c.system.mission.stage,1);
  await requestMission(s.c.id);assert.equal(s.c.system.mission.stage,2);
  assert.equal(s.c.items.get('hull_sections').system.quantity,1);
  await requestMission(s.c.id);assert.equal(s.c.system.mission.stage,3);
  assert.equal(s.tiles.length,1);assert.equal(s.c.system.mission.shipTileId,s.tiles[0].id);
  for(let i=1;i<100&&!missionStage(s.c,s.settings.worldDay).ready;i++)s.settings.worldDay=i+1;
  assert.equal(missionStage(s.c,s.settings.worldDay).ready,true);
  await requestMission(s.c.id);assert.equal(s.c.system.mission.stage,4);
  assert.equal(s.tiles.length,1);assert.equal(s.c.system.mission.events.length,4);
  await requestMission(s.c.id);assert.equal(s.c.system.mission.stage,4);
});
test('interruption after inventory debit replays targets without a second charge',async()=>{
  const s=scenario();s.c.system.mission.stage=1;s.c.failUpdate=true;
  await requestMission(s.c.id);
  assert.equal(s.c.system.mission.stage,1);
  assert.equal(s.c.items.get('hull_sections').system.quantity,1);
  assert.equal(s.settings.missionOperation.version,1);
  await replayMissionOperation(s.settings.missionOperation);
  assert.equal(s.c.system.mission.stage,2);
  assert.equal(s.c.items.get('hull_sections').system.quantity,1);
  assert.deepEqual(s.settings.missionOperation,{});
});
test('committed stage can finish journal cleanup without paying twice',async()=>{
  const s=scenario();s.c.system.mission.stage=1;
  const original=s.settings;
  const set=globalThis.game.settings.set;let once=true;
  globalThis.game.settings.set=async(ns,k,value)=>{
    if(k==='missionOperation'&&value.version!==1&&once){once=false;throw Error('cleanup fault');}
    return set(ns,k,value);
  };
  await requestMission(s.c.id);
  assert.equal(s.c.system.mission.stage,2);
  assert.equal(original.missionOperation.version,1);
  const remain=s.c.items.get('hull_sections').system.quantity;
  await replayMissionOperation(original.missionOperation);
  assert.equal(s.c.items.get('hull_sections').system.quantity,remain);
  assert.deepEqual(original.missionOperation,{});
});
test('GM lock prevents actions while mission operation needs recovery',async()=>{
  const s=scenario();s.c.system.mission.stage=1;
  const plan=planMissionOperation(s.c,1,'GM');s.settings.missionOperation=plan;
  const {withWorldLock}=await import('../module/logistics.mjs');
  await assert.rejects(withWorldLock(()=>Promise.resolve(2)),/Сборка корабля/);
});
test('marker creation is idempotent when colony save fails after tile was placed',async()=>{
  const s=scenario();s.c.system.mission.stage=2;s.c.failUpdate=true;
  await requestMission(s.c.id);
  assert.equal(s.c.system.mission.stage,2);
  assert.equal(s.tiles.length,1);
  assert.equal(s.settings.missionOperation.version,1);
  await replayMissionOperation(s.settings.missionOperation);
  assert.equal(s.c.system.mission.stage,3);
  assert.equal(s.tiles.length,1,'failed mission continuation must reuse the tile');
});
test('mission plan cannot be created for completed or insufficiently supplied stage',()=>{
  const c=colony();c.system.mission.stage=1;
  c.items.get('habitat_module').system.quantity=0;
  assert.throws(()=>planMissionOperation(c,1,'GM'),/Требования/);
  c.system.mission.stage=4;
  assert.equal(missionStage(c,1).completed,true);
  assert.throws(()=>planMissionOperation(c,1,'GM'),/Требования/);
});

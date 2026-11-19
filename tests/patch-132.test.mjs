import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {availableEras,availableFieldPhases,obscureBlueprints} from '../module/discovery-visibility.mjs';
import {TECHNOLOGIES,FIELD_PHASES,FIELD_STUDIES} from '../module/tech-data.mjs';
import {isCanvasEventTarget} from '../module/canvas-target.mjs';
import {requestIndustry} from '../module/industry.mjs';

const root=new URL('../',import.meta.url);
test('player does not see future eras until every technology in prior era is complete',()=>{
  const tier0=TECHNOLOGIES.filter(t=>t.t===0).map(t=>t.id);
  assert.deepEqual([...availableEras(TECHNOLOGIES,[],false)],[0]);
  assert.deepEqual([...availableEras(TECHNOLOGIES,tier0.slice(0,-1),false)],[0]);
  assert.deepEqual([...availableEras(TECHNOLOGIES,tier0,false)],[0,1]);
  assert.equal(availableEras(TECHNOLOGIES,[],true).size,5);
});
test('nested field-research phases become visible only after completing prior phase',()=>{
  const first=FIELD_STUDIES.filter(t=>t.phase===FIELD_PHASES[0].id).map(t=>t.id);
  assert.equal(availableFieldPhases(FIELD_PHASES,FIELD_STUDIES,[],false).size,1);
  assert.equal(availableFieldPhases(FIELD_PHASES,FIELD_STUDIES,first,false).size,2);
  assert.equal(availableFieldPhases(FIELD_PHASES,FIELD_STUDIES,[],true).size,FIELD_PHASES.length);
});
test('locked blueprints do not leak names to player but are visible to GM',()=>{
  const originals=[{name:'Секретная панель',techName:'Неизвестная технология',unlocked:false},{name:'Открытый рецепт',techName:'Полевое исследование',unlocked:true}];
  const user=obscureBlueprints(originals,false);
  assert.equal(user[0].name,'???');assert.equal(user[0].techName,'Неизвестное открытие');
  assert.equal(user[1].name,originals[1].name);
  assert.equal(obscureBlueprints(originals,true)[0].name,'Секретная панель');
  assert.equal(originals[0].name,'Секретная панель');
});
test('nested Foundry board events are accepted, unrelated UI clicks rejected',()=>{
  const board={contains:child=>child?.withinBoard===true};
  const valid={withinBoard:true,closest:()=>board};
  const invalid={withinBoard:false,closest:()=>null};
  assert.equal(isCanvasEventTarget(valid,null,board),true);
  assert.equal(isCanvasEventTarget(board,null,board),true);
  assert.equal(isCanvasEventTarget(invalid,null,board),false);
});
test('templates hide unknown recipes and buildings and expose GM-only instant action',()=>{
  const actor=readFileSync(new URL('../templates/actor.hbs',import.meta.url),'utf8');
  assert.ok(actor.includes('{{#if hiddenForPlayer}}'));
  assert.ok(actor.includes('gm-instant-build'));
  assert.ok(actor.includes('Неизвестный рецепт'));
  const code=readFileSync(new URL('../module/industry.mjs',import.meta.url),'utf8');
  assert.ok(code.includes("if(!user.isGM)throw Error('Размещать готовые здания без ресурсов может только ведущий.')"));
});

function mockBuilding({errorOnUpdate=false}={}){
  const gm={id:'GM132',name:'GM',isGM:true,active:true},messages=[];
  let next=0;
  const tiles=[];
  tiles.get=id=>tiles.find(t=>t.id===id);
  const scene={id:'S132',name:'Тестовая поляна',grid:{type:1,size:100},width:2000,height:2000,
    dimensions:{sceneRect:{x:0,y:0,width:2000,height:2000}},tiles,
    async createEmbeddedDocuments(type,rows){assert.equal(type,'Tile');const made=rows.map(row=>({id:'tile'+(++next),...structuredClone(row)}));tiles.push(...made);return made;},
    async deleteEmbeddedDocuments(type,ids){assert.equal(type,'Tile');for(const id of ids){let i=tiles.findIndex(x=>x.id===id);if(i>=0)tiles.splice(i,1);}}
  };
  const science={unlocked:[],facilities:[],points:0,projects:[],dailyWork:[],discoveries:[]};
  const industry={jobs:[],construction:[],buildings:[],placements:[],history:[],processed:[]};
  const colony={id:'COL132',name:'Колония',type:'colony',system:{science,industry,crew:{nodes:[],jobs:[],caches:[]}},
    items:[],async update(patch){if(errorOnUpdate)throw Error('save stopped');
      for(const [key,value] of Object.entries(patch)){const parts=key.split('.');let node=this;for(const part of parts.slice(0,-1))node=node[part];node[parts.at(-1)]=structuredClone(value);}
    }};
  const survivor={id:'SUR132',type:'survivor',testUserPermission:()=>true};
  const actors=[colony,survivor];
  globalThis.game={user:gm,users:Object.assign([gm],{get:id=>id===gm.id?gm:undefined}),
    actors:{get:id=>actors.find(x=>x.id===id),find:fn=>actors.find(fn),filter:fn=>actors.filter(fn),some:fn=>actors.some(fn)},
    scenes:{get:id=>id===scene.id?scene:undefined},settings:{get:()=>1},socket:{emit(){}}};
  globalThis.ui={notifications:{info:m=>messages.push(['ok',m]),error:m=>messages.push(['error',m])}};
  return {colony,scene,tiles,messages};
}
test('GM can place finished building without research, resources or waiting days',async()=>{
  const x=mockBuilding();
  await requestIndustry({colonyId:'COL132',action:'gm-instant-build',subject:'bench',sceneId:'S132',x:100,y:100});
  assert.equal(x.messages.at(-1)[0],'ok');
  assert.equal(x.colony.system.industry.construction.length,0);
  assert.equal(x.colony.system.industry.buildings[0].count,1);
  assert.equal(x.colony.system.industry.placements[0].status,'finished');
  assert.equal(x.colony.system.science.facilities.includes('bench'),true);
  assert.equal(x.tiles.length,1);
  assert.equal(x.tiles[0].texture.src.includes('/bench.png'),true);
  await requestIndustry({colonyId:'COL132',action:'gm-instant-build',subject:'bench',sceneId:'S132',x:500,y:100});
  assert.equal(x.messages.at(-1)[0],'ok');
  assert.equal(x.tiles.length,2);
  assert.equal(x.colony.system.industry.buildings[0].count,2);
  assert.equal(x.colony.system.industry.placements[1].gmInstant,true);
  assert.equal(x.colony.system.industry.placements[0].gmInstant,true);
});
test('failed GM instant-build save removes orphaned scene tile',async()=>{
  const x=mockBuilding({errorOnUpdate:true});
  await requestIndustry({colonyId:'COL132',action:'gm-instant-build',subject:'shelter',sceneId:'S132',x:100,y:100});
  assert.equal(x.messages.at(-1)[0],'error');
  assert.equal(x.tiles.length,0);
  assert.equal(x.colony.system.industry.placements.length,0);
});

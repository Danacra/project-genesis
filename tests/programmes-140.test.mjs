import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {RESEARCH_PROGRAMS,PROGRAM_STUDIES,RESEARCH_PROGRAM_BY_ID,TECHNOLOGY_BY_ID} from '../module/tech-data.mjs';
import {effectiveUnlocked,techStatus,planInvestment,completionPatch,planMaterialUse,validateCatalog} from '../module/research-rules.mjs';
import {BUILDING_FOOTPRINTS,tileAsset} from '../module/map-rules.mjs';
import {upgradeDefaultBuildingTiles} from '../module/building-roof.mjs';

const science=(overrides={})=>({points:1500,unlocked:[],projects:[],discoveries:[],facilities:[],dailyWork:[],tier:0,...overrides});
const ids=p=>p.studies.map(s=>s.id);

test('v1.4: eight distinct research programmes have 80 unique, described substudies',()=>{
  const summary=validateCatalog();
  assert.equal(summary.programmes,8);
  assert.equal(summary.programmeResearch,80);
  assert.equal(RESEARCH_PROGRAMS.length,8);
  assert.equal(PROGRAM_STUDIES.length,80);
  assert.equal(new Set(PROGRAM_STUDIES.map(s=>s.id)).size,80);
  for(const p of RESEARCH_PROGRAMS){
    assert.equal(p.studies.length,10);
    assert.equal(p.phases.length,4);
    assert.equal(TECHNOLOGY_BY_ID[p.id].name,p.name);
    for(const s of p.studies){
      assert.equal(s.group,p.id);
      assert.ok(s.name && s.description && s.result);
      assert.ok(s.rp>=1 && s.rp<=5);
      assert.ok(p.phases.some(phase=>phase.id===s.phase));
    }
  }
});

test('v1.4: every programme can be completed sequentially with ordinary research points',()=>{
  for(const p of RESEARCH_PROGRAMS){
    const tech=TECHNOLOGY_BY_ID[p.id];
    const s=science({unlocked:tech.parents});
    const original=[...s.unlocked];
    for(let i=0;i<p.studies.length;i++){
      const step=p.studies[i];
      assert.ok(techStatus(step.id,s).prerequisitesReady,`${p.id} step ${i+1} should be available`);
      Object.assign(s,planInvestment(s,step.id,step.rp));
      Object.assign(s,completionPatch(s,step.id,'GM',i+1));
      assert.equal(s.unlocked.includes(p.id),i===9,`${p.id}: composite opened prematurely`);
    }
    assert.equal(techStatus(p.id,s).progress,10);
    assert.equal(techStatus(p.id,s).unlocked,true);
    assert.equal(s.unlocked.length,original.length+11);
    assert.equal(s.projects.length,0);
    assert.equal(s.discoveries.at(-1).techId,p.id);
    assert.equal(s.points,1500-p.studies.reduce((a,b)=>a+b.rp,0));
  }
});

test('v1.4: parent tech cannot be funded directly or opened before all children',()=>{
  for(const p of RESEARCH_PROGRAMS){
    assert.throws(()=>planInvestment(science({unlocked:TECHNOLOGY_BY_ID[p.id].parents}),p.id,1),/Составная программа/);
    const almost=science({unlocked:[...TECHNOLOGY_BY_ID[p.id].parents,...ids(p).slice(0,-1)]});
    assert.equal(techStatus(p.id,almost).progress,9);
    assert.equal(techStatus(p.id,almost).unlocked,false);
    const missing=science({unlocked:[...TECHNOLOGY_BY_ID[p.id].parents,...ids(p).slice(0,-2)]});
    assert.throws(()=>planInvestment(missing,p.studies.at(-1).id,1),/предыдущие/, 'last step requires previous discoveries');
  }
});

test('v1.4: all legacy major technologies preserve progress and unlock ten children without migration',()=>{
  const legacy=science({unlocked:RESEARCH_PROGRAMS.map(p=>p.id),projects:[{id:'mechanics',invested:4}]});
  const snapshot=structuredClone(legacy);
  const complete=effectiveUnlocked(legacy);
  for(const p of RESEARCH_PROGRAMS){
    assert.ok(p.studies.every(s=>complete.has(s.id)),`Old ${p.id} was not grandfathered`);
    assert.equal(techStatus(p.id,legacy).progress,10);
  }
  assert.deepEqual(legacy,snapshot);
});

test('v1.4: the last child retains the old parent research material requirements',()=>{
  for(const p of RESEARCH_PROGRAMS){
    const parent=TECHNOLOGY_BY_ID[p.id];
    assert.deepEqual(p.studies.at(-1).requires,parent.requires);
    assert.ok(p.studies.slice(0,-1).every(t=>Object.keys(t.requires).length===0));
  }
  const sample={id:'i',type:'material',system:{resourceCode:'fiber',quantity:4}};
  assert.throws(()=>planMaterialUse('shelter-step-10',[sample]),/Древесина/);
});

test('v1.4: partial funding of older grouped technology is refunded after completion',()=>{
  const p=RESEARCH_PROGRAM_BY_ID['stone-tools'];
  const legacy=science({points:10,unlocked:['survey',...ids(p).slice(0,-1)],projects:[{id:p.id,invested:3}]});
  const patch=completionPatch(legacy,p.studies.at(-1).id,'GM',7);
  assert.equal(patch.points,13);
  assert.equal(patch.projects.find(x=>x.id===p.id),undefined);
  assert.ok(patch.unlocked.includes(p.id));
  assert.equal(legacy.points,10);
});

test('v1.4: new art covers all 14 buildings with PNG paths and old-style construction tiles',()=>{
  assert.equal(Object.keys(BUILDING_FOOTPRINTS).length,14);
  for(const [id] of Object.entries(BUILDING_FOOTPRINTS)){
    const uri=tileAsset(id,true);
    assert.match(uri,new RegExp(`/${id}\\.png$`));
    assert.ok(existsSync(new URL(`../assets/buildings/${id}.png`,import.meta.url)),id);
    assert.match(tileAsset(id,false),/construction-site\.svg$/);
  }
  const html=readFileSync(new URL('../templates/actor.hbs',import.meta.url),'utf8');
  assert.match(html,/research\.programmes/);
  assert.match(html,/data-genesis-research-program/);
  assert.match(html,/data-genesis-subtech-detail/);
  assert.match(html,/data-genesis-open-subtree="\{\{id\}\}"/);
});

test('v1.4: GM migrates only default building tile art, custom sources remain unchanged',async()=>{
  const make=(id,src)=>({id:'tile-'+id,texture:{src},flags:{'project-genesis':{buildingId:id,colonyId:'C',placementId:id+'-P',status:'finished'}}});
  const tiles=[make('bench','systems/project-genesis/assets/buildings/bench-top.png'),make('fieldLab','systems/project-genesis/assets/buildings/fieldLab.svg'),make('powerLab','worlds/custom/energy.png')];
  const scene={id:'S',tiles:{get:tid=>tiles.find(t=>t.id===tid)},
    async updateEmbeddedDocuments(_type,rows){for(const r of rows)tiles.find(t=>t.id===r._id).texture.src=r['texture.src'];}};
  const colony={id:'C',type:'colony',system:{industry:{placements:tiles.map(t=>({buildingId:t.flags['project-genesis'].buildingId,id:t.flags['project-genesis'].placementId,sceneId:'S',tileId:t.id,status:'finished'}))}}};
  const world={user:{isGM:true},actors:{filter:f=>[colony].filter(f)},scenes:{get:id=>id==='S'?scene:null}};
  assert.equal(await upgradeDefaultBuildingTiles(world),2);
  assert.equal(tiles[0].texture.src,tileAsset('bench',true));
  assert.equal(tiles[1].texture.src,tileAsset('fieldLab',true));
  assert.equal(tiles[2].texture.src,'worlds/custom/energy.png');
  assert.equal(await upgradeDefaultBuildingTiles(world),0);
});

test('v1.4: research context exposes all eight programmes to GM and hides future epochs from players',async()=>{
  const {researchContext}=await import('../module/research.mjs');
  globalThis.game={settings:{get:()=>1},actors:{filter:()=>[]}};
  const colony={id:'C',name:'Колония',type:'colony',items:[],system:{science:science(),industry:{placements:[]}}};
  const gm=researchContext(colony,{isGM:true});
  assert.equal(gm.programmes.length,8);
  assert.equal(gm.programmes.reduce((n,p)=>n+p.details.length,0),80);
  const user=researchContext(colony,{isGM:false});
  assert.equal(user.programmes.length,5);
  assert.equal(user.programmes.some(p=>p.id==='basic-workshop'),false);
  assert.equal(user.programmes.some(p=>p.id==='survey'),true);
  // Legacy unlocked tier-0 technologies make the next tier visible automatically.
  colony.system.science.unlocked=['survey','shelter','stone-tools','water-analysis','ecosystems'];
  const advanced=researchContext(colony,{isGM:false});
  assert.ok(advanced.programmes.some(p=>p.id==='basic-workshop'));
  assert.ok(advanced.programmes.some(p=>p.id==='geology'));
  assert.ok(advanced.programmes.some(p=>p.id==='medicine'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {TECHNOLOGIES,RECIPE_LIBRARY} from '../module/tech-data.mjs';
import {RECIPES,RECIPE_BY_ID} from '../module/industry-data.mjs';
import {tierOf,tierUpgrade,stationSupportsRecipe} from '../module/building-progress.mjs';
import {validateStagedInputs,craftLoadFits} from '../module/crafting-rules.mjs';
import {capacity} from '../module/rules.mjs';
import {cacheLimit} from '../module/crew-rules.mjs';
import {simulateNetworks} from '../module/network-rules.mjs';
import {techStatus} from '../module/research-rules.mjs';
const actor=(items=[])=>({type:'survivor',system:{abilities:{strength:2}},items});
const resource=(code,quantity,mass=1,volume=1)=>({id:code,type:'material',system:{resourceCode:code,quantity,unitMass:mass,unitVolume:volume}});
test('1.5: metallurgy, textile, timber, clay and advanced recipes are researched, not free',()=>{
 for(const id of ['wood-processing','fiber-processing','ore-smelting','kiln-processing','precision-machining'])
   assert.ok(TECHNOLOGIES.some(t=>t.id===id),id);
 for(const id of ['sawn-planks','woven-cloth','metal-ingot','copper-smelt','fired-brick','cut-stone','reinforced-alloy',
    'precision-joinery','calibrated-toolkit','medical-supplies','control-terminal']){
   assert.ok(RECIPE_LIBRARY[id]);assert.ok(RECIPES.some(r=>r.id===id));
 }
 assert.deepEqual(RECIPE_BY_ID['metal-ingot'].inputs,{ore:3});
 assert.equal(RECIPE_BY_ID['metal-ingot'].output.code,'ingot');
 const locked=techStatus('ore-smelting',{unlocked:[],projects:[],facilities:[]},[]);
 assert.equal(locked.prerequisitesReady,false);
});
test('1.5: three structure levels and separate conditions per building',()=>{
 const bench={buildingId:'bench',tier:1};
 assert.equal(tierOf(bench),1);
 assert.equal(tierUpgrade(bench).techId,'basic-workshop');
 assert.equal(tierUpgrade({...bench,tier:2}).techId,'precision-machining');
 assert.throws(()=>tierUpgrade({...bench,tier:3}),/максимальный/);
 assert.equal(tierOf({buildingId:'shelter'}),1); // v1.4 save with no new field
 assert.equal(tierUpgrade({buildingId:'shelter',tier:1}).techId,'medicine');
 assert.equal(stationSupportsRecipe({buildingId:'bench',tier:1},RECIPE_BY_ID['precision-joinery']),false);
 assert.equal(stationSupportsRecipe({buildingId:'bench',tier:2},RECIPE_BY_ID['precision-joinery']),true);
 assert.equal(stationSupportsRecipe({buildingId:'bench',tier:2},RECIPE_BY_ID['calibrated-toolkit']),false);
 assert.equal(stationSupportsRecipe({buildingId:'bench',tier:3},RECIPE_BY_ID['calibrated-toolkit']),true);
});
test('1.5: warehouse upgrades expand capacity without corrupting an old warehouse',()=>{
 const p={buildingId:'local-store',tier:2,status:'finished'};
 assert.deepEqual(cacheLimit(p),{mass:1275,volume:2550});
 assert.deepEqual(cacheLimit({...p,tier:3}),{mass:1875,volume:3750});
 assert.deepEqual(cacheLimit({...p,tier:undefined}),{mass:750,volume:1500});
 const colony={type:'colony',system:{capacity:{mass:100,volume:200},industry:{
   buildings:[{id:'storehouse',count:1}],placements:[{buildingId:'storehouse',status:'finished',tier:3}]}}};
 assert.deepEqual(capacity(colony),{mass:1975,volume:3950});
});
test('1.5: power generator produces more with upgrade, no extra cables or duplicate nodes',()=>{
 const nodes=[{id:'generator',buildingId:'powerLab',sceneId:'main',status:'finished',tier:3},
   {id:'device',buildingId:'electronicsLab',sceneId:'main',status:'finished'}];
 const links=[{id:'wire',type:'power',sceneId:'main',fromId:'generator',toId:'device'}];
 const s=simulateNetworks(nodes,links);
 assert.equal(s.nodes.length,2);assert.equal(s.totals.power.supply,36);
 assert.equal(s.byId.device.powered,true);
});
test('1.5: crafting board rejects staged fake resources and tampered counts',()=>{
 const recipe=RECIPE_BY_ID['sawn-planks'];
 assert.equal(validateStagedInputs(recipe,[{code:'wood',count:2}]),true);
 assert.throws(()=>validateStagedInputs(recipe,[{code:'stone',count:2}]),/неподходящий/);
 assert.throws(()=>validateStagedInputs(recipe,[{code:'wood',count:1}]),/нужно/);
 assert.throws(()=>validateStagedInputs(recipe,[{code:'wood',count:2.5}]),/количество/);
 assert.throws(()=>validateStagedInputs(recipe,[{code:'wood',count:999999}]),/нужно/);
});
test('1.5: board output capacity checks after spending inputs and counts containers',()=>{
 const a=actor([resource('wood',5,1,1)]);
 const plan={escrow:[{count:2,unitMass:1,unitVolume:1}]};
 const product={system:{quantity:3,unitMass:.9,unitVolume:1.1}};
 assert.equal(craftLoadFits(a.items,plan,product,{mass:10,volume:10}),true);
 assert.throws(()=>craftLoadFits(a.items,plan,product,{mass:3,volume:10}),/хватит места/);
 const items=[...a.items,{id:'box',type:'container',system:{quantity:1,unitMass:9,unitVolume:9}}];
 assert.throws(()=>craftLoadFits(items,plan,product,{mass:10,volume:10}),/хватит места/);
});

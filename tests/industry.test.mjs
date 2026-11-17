import test from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES, BUILDINGS, RECIPE_BY_ID, BUILDING_BY_ID, validateIndustryCatalog } from '../module/industry-data.mjs';
import { amountsNeeded, recipeState, buildingState, planTake, depositPlan, refundPlan, tickQueue, outputItem, validateIndustryState } from '../module/industry-rules.mjs';
import { capacity } from '../module/rules.mjs';
const stockItem=(id,code,quantity,extra={})=>({id,name:extra.name||code,type:'material',img:'icons/svg/item-bag.svg',system:{resourceCode:code,quantity,unitMass:extra.unitMass??1,unitVolume:extra.unitVolume??1,containerId:extra.containerId||'',...extra}});
const inventory=(items=[])=>Object.assign([...items],{get(id){return this.find(i=>i.id===id)}});
const colony=(items=[],unlocked=['survey'],facilities=[],industry={jobs:[],construction:[],buildings:[]},cap={mass:2500,volume:10000})=>({type:'colony',system:{science:{unlocked,facilities},industry,capacity:cap},items:inventory(items)});
test('full catalog: 26 real recipes and 12 infrastructure types',()=>{
  assert.deepEqual(validateIndustryCatalog(),{recipes:26,buildings:12});
  assert.deepEqual(validateIndustryState(),{recipes:26,buildings:12});
  assert.equal(RECIPES.length,26);assert.equal(BUILDINGS.length,12);
  for(const r of RECIPES) assert.ok(r.techId&&r.output.quantity>0&&r.output.unitMass>=0);
});
test('theory and materials are distinct recipe gates',()=>{
  const a=colony([stockItem('a','fiber',1)]);
  assert.equal(recipeState('field-notes',a).canStart,true);
  assert.equal(recipeState('field-notes',a,2).canStart,false);
  assert.equal(recipeState('stone-kit',a).unlocked,false);
});
test('machine station needed after unlock',()=>{
  const a=colony([stockItem('a','scrap',2),stockItem('b','wood',2)],['basic-workshop']);
  assert.equal(recipeState('workshop-tools',a).stationReady,false);
  a.system.industry.buildings=[{id:'bench',count:1}];
  assert.equal(recipeState('workshop-tools',a).canStart,true);
});
test('legacy manually activated facilities remain usable',()=>{
  const a=colony([stockItem('a','scrap',2),stockItem('b','wood',2)],['basic-workshop'],['bench']);
  assert.equal(recipeState('workshop-tools',a).canStart,true);
});
test('invalid batches never spend stock',()=>{
  for(const n of [-1,0,1.5,11,NaN])assert.throws(()=>amountsNeeded({wood:2},n));
  assert.deepEqual(amountsNeeded({wood:2,fiber:1},3),{wood:6,fiber:3});
});
test('distributed input depletion across stacks and exact escrow',()=>{
  const a=inventory([stockItem('a','wood',2),stockItem('b','wood',3),stockItem('c','fiber',2)]);
  const plan=planTake(a,{wood:4,fiber:2});
  assert.deepEqual(plan.changes.map(x=>[x._id,x['system.quantity']]),[['a',0],['b',1],['c',0]]);
  assert.deepEqual(plan.escrow.map(x=>[x.itemId,x.count]),[['a',2],['b',2],['c',2]]);
});
test('missing materials fail before any debit plan',()=>{
  assert.throws(()=>planTake(inventory([stockItem('a','wood',1)]),{wood:2}),/Не хватает/);
});
test('production output can deposit or merge into matching stack',()=>{
  const a=colony([],{length:0});
  const product=outputItem(RECIPE_BY_ID['alloy-parts'],2);
  assert.equal(product.system.quantity,4);
  assert.equal(product.system.resourceCode,'alloy');
  assert.equal(depositPlan(a,product).targetId,'');
  a.items.push({...product,id:'old'});
  assert.equal(depositPlan(a,product).targetId,'old');
});
test('full warehouse defers product collection',()=>{
  const a=colony([stockItem('s','stone',3)],[],[],{buildings:[]},{mass:3,volume:3});
  assert.throws(()=>depositPlan(a,outputItem(RECIPE_BY_ID['stone-kit'])),/не хватает места/);
});
test('storehouse increases capacity without mutating configured base value',()=>{
  const a=colony([],[],[],{buildings:[{id:'storehouse',count:2}]},{mass:100,volume:200});
  assert.deepEqual(capacity(a),{mass:1600,volume:3200});
  assert.deepEqual(a.system.capacity,{mass:100,volume:200});
});
test('buildings require technologies, materials, and maximum not exceeded',()=>{
  const a=colony([stockItem('w','wood',3),stockItem('s','stone',2)],['stone-tools']);
  assert.equal(buildingState('bench',a).canStart,true);
  a.system.industry.construction=[{subject:'bench'}];
  assert.equal(buildingState('bench',a).canStart,false);
});
test('refund restores original stacks on cancellation',()=>{
  const a=colony([stockItem('a','stone',0)]);
  const refund=refundPlan(a,[{itemId:'a',count:3,code:'stone',unitMass:1,unitVolume:1}]);
  assert.deepEqual(refund.changes,[{id:'a',before:0,after:3}]);
  assert.equal(refund.creates.length,0);
});
test('refund creates safe replacement when zero source stack was removed',()=>{
  const a=colony([]);
  const refund=refundPlan(a,[{itemId:'deleted',count:2,code:'wood',name:'Дерево',type:'material',img:'icons/svg/item-bag.svg',unitMass:1,unitVolume:1,quality:0,techTier:0,description:'',containerId:''}]);
  assert.equal(refund.creates[0].system.quantity,2);
  assert.equal(refund.creates[0].system.resourceCode,'wood');
});
test('refund rejects exceeding global storage limit',()=>{
  const a=colony([],[],[],{buildings:[]},{mass:1,volume:1});
  assert.throws(()=>refundPlan(a,[{itemId:'missing',count:2,code:'wood',unitMass:1,unitVolume:1}]),/Недостаточно/);
});
test('queue decrements in-game days but not below zero',()=>{
  const old={jobs:[{id:'a',remaining:2},{id:'b',remaining:0}],construction:[{id:'c',remaining:1}]};
  const next=tickQueue(old);
  assert.deepEqual(next.jobs.map(j=>j.remaining),[1,0]);
  assert.deepEqual(next.construction.map(j=>j.remaining),[0]);
  assert.equal(old.jobs[0].remaining,2);
});

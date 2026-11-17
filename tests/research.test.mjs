import test from 'node:test';
import assert from 'node:assert/strict';
import { TECHNOLOGIES, TECHNOLOGY_BY_ID } from '../module/tech-data.mjs';
import { validateCatalog, techStatus, planInvestment, planMaterialUse, completionPatch, unlockedRecipes, stockByCode } from '../module/research-rules.mjs';
function state(extra={}) {return {points:50,tier:0,unlocked:[],facilities:[],projects:[],dailyWork:[],discoveries:[],...extra};}
function item(id,code,quantity,type='material') {return {id,name:code,type,system:{resourceCode:code,quantity}};}
test('technology catalog is valid and contains multiple parallel branches',()=>{
 const catalog=validateCatalog();assert.equal(catalog.technologies,25);assert.equal(catalog.recipes,26);
 assert.ok(new Set(TECHNOLOGIES.map(t=>t.branch)).size>=6);
});
test('initial technology is accessible and no cost materials',()=>{
 const t=techStatus('survey',state(),[]);
 assert.equal(t.prerequisitesReady,true);assert.equal(t.ready,true);assert.equal(t.progress,0);
});
test('prerequisite blocks downstream research',()=>{
 const t=techStatus('shelter',state(),[item('w','wood',20)]);
 assert.deepEqual(t.missingParents,['survey']);assert.equal(t.prerequisitesReady,false);
});
test('facilities block even with prerequisite unlocked',()=>{
 const t=techStatus('basic-workshop',state({unlocked:['survey','shelter','stone-tools']}),[]);
 assert.equal(t.missingFacilities[0],'bench');assert.equal(t.facilityReady,false);
});
test('resource stock sums matching stacks and excludes containers',()=>{
 const stock=stockByCode([item('a','STONE',2),item('b','stone',3),item('c','stone',12,'container')]);
 assert.equal(stock.stone,5);
});
test('funding progress cannot exceed cost and uses colony points',()=>{
 const p=planInvestment(state(), 'survey',3);
 assert.equal(p.points,47);assert.deepEqual(p.projects,[{id:'survey',invested:3}]);
 const p2=planInvestment(state({...p,unlocked:[]}), 'survey',1);
 assert.equal(p2.projects[0].invested,4);
});
test('funding forbidden on locked and completed technologies',()=>{
 assert.throws(()=>planInvestment(state(),'shelter',2),/предыдущие/);
 assert.throws(()=>planInvestment(state({unlocked:['survey']}),'survey',1),/уже изучена/);
});
test('funding rejects decimals, zero, excessive and over-budget points',()=>{
 assert.throws(()=>planInvestment(state(),'survey',1.5),/целое/);
 assert.throws(()=>planInvestment(state(),'survey',0),/целое/);
 assert.throws(()=>planInvestment(state({points:1}),'survey',2),/Недостаточно/);
 assert.throws(()=>planInvestment(state(),'survey',5),/не более/);
});
test('a fully funded project with missing materials is not completed',()=>{
 const science=state({unlocked:['survey'],projects:[{id:'shelter',invested:5}]});
 const t=techStatus('shelter',science,[item('x','wood',3)]);
 assert.equal(t.percent,100);assert.equal(t.canFinish,false);assert.equal(t.materialReady,false);
});
test('material consumption splits across stacks with exact remainders',()=>{
 const changes=planMaterialUse('shelter',[item('a','wood',1),item('b','wood',4),item('c','fiber',3)]);
 assert.deepEqual(changes,[{id:'a',before:1,after:0},{id:'b',before:4,after:3},{id:'c',before:3,after:1}]);
});
test('material usage throws before deducting if missing',()=>{
 assert.throws(()=>planMaterialUse('shelter',[item('x','wood',99)]),/Волокно/);
});
test('completing research creates discovery and removes spent project',()=>{
 const science=state({projects:[{id:'survey',invested:4}]});
 const patch=completionPatch(science,'survey','GM',12);
 assert.deepEqual(patch.unlocked,['survey']);assert.deepEqual(patch.projects,[]);
 assert.deepEqual(patch.discoveries[0],{techId:'survey',day:12,by:'GM'});
});
test('completion preserves an established higher tier and parallel projects',()=>{
 const science=state({tier:4,projects:[{id:'survey',invested:4},{id:'stone-tools',invested:3}]});
 const patch=completionPatch(science,'survey','GM',4);
 assert.equal(patch.tier,4);assert.deepEqual(patch.projects,[{id:'stone-tools',invested:3}]);
});
test('recipes switch from locked to unlocked based only on discoveries',()=>{
 const before=unlockedRecipes(state());
 assert.equal(before.filter(r=>r.unlocked).length,0);
 const after=unlockedRecipes(state({unlocked:['survey','shelter']}));
 assert.equal(after.filter(r=>r.unlocked).length,2);
 assert.equal(after.find(r=>r.id==='field-notes').unlocked,true);
});
test('technology by ID never includes bad or unknown tier IDs',()=>{
 for(const t of TECHNOLOGIES){assert.ok(t.t>=0&&t.t<=4);assert.equal(t,TECHNOLOGY_BY_ID[t.id]);}
 assert.throws(()=>techStatus('__unknown__',state()),/Неизвестная/);
});

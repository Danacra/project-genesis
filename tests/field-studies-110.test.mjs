import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FIELD_STUDIES, FIELD_PHASES, RESEARCH_BY_ID, TECHNOLOGIES} from '../module/tech-data.mjs';
import {effectiveUnlocked, techStatus, planInvestment, completionPatch, unlockedRecipes, validateCatalog} from '../module/research-rules.mjs';

const state=(extra={})=>({points:50,tier:0,unlocked:[],facilities:[],projects:[],dailyWork:[],discoveries:[],...extra});
const group=()=>techStatus('survey',state(),[]);

test('all 10 substudies are distinct and grouped into four stages',()=>{
 assert.equal(FIELD_STUDIES.length,10);
 assert.equal(FIELD_PHASES.length,4);
 assert.equal(validateCatalog().subresearch,10);
 assert.deepEqual(new Set(FIELD_STUDIES.map(t=>t.id)).size,10);
 assert.ok(FIELD_STUDIES.every(t=>t.group==='survey'&&t.t===0&&t.rp>=1&&t.rp<=4));
 assert.ok(FIELD_STUDIES.every(t=>FIELD_PHASES.some(p=>p.id===t.phase)));
 assert.equal(TECHNOLOGIES.length,30);
});
test('the composite parent is not fundable or directly completable',()=>{
 assert.equal(group().progress,0);
 assert.equal(group().required,10);
 assert.equal(group().canFinish,false);
 assert.throws(()=>planInvestment(state(),'survey',1),/10 мини/);
 assert.throws(()=>completionPatch(state(),'survey','GM',1),/мини-исследования/);
});
test('cannot buy a child research before its prerequisites',()=>{
 const s=state();
 assert.deepEqual(techStatus('survey-landmarks',s).missingParents,['survey-landing']);
 assert.throws(()=>planInvestment(s,'survey-landmarks',2),/предыдущие/);
 assert.equal(techStatus('survey-landing',s).prerequisitesReady,true);
});
test('substudies require genuine spendable research points',()=>{
 assert.throws(()=>planInvestment(state({points:0}),'survey-landing',1),/Недостаточно/);
 assert.throws(()=>planInvestment(state(),'survey-landing',3),/не более/);
 const funded=planInvestment(state(),'survey-landing',2);
 assert.equal(funded.points,48);
 assert.deepEqual(funded.projects,[{id:'survey-landing',invested:2}]);
});
test('completing each child unlocks the next and the tenth opens the composite parent',()=>{
 let s=state({points:100});
 for(let i=0;i<FIELD_STUDIES.length;i++){
   const t=FIELD_STUDIES[i];
   const before=techStatus(t.id,s);
   assert.equal(before.prerequisitesReady,true,`${t.name} should be reachable at step ${i}`);
   const invested=planInvestment(s,t.id,t.rp);
   s={...s,...invested};
   const patch=completionPatch(s,t.id,'GM',i+1);
   s={...s,...patch};
   assert.ok(s.unlocked.includes(t.id));
   assert.equal(s.unlocked.includes('survey'),i===9);
 }
 assert.equal(s.unlocked.length,11);
 assert.equal(s.discoveries.length,11);
 assert.equal(s.discoveries.at(-1).techId,'survey');
 assert.equal(techStatus('shelter',s).prerequisitesReady,true);
 assert.equal(techStatus('stone-tools',s).prerequisitesReady,true);
 assert.equal(techStatus('water-analysis',s).prerequisitesReady,true);
 assert.ok(unlockedRecipes(s).find(r=>r.id==='field-notes').unlocked);
 assert.equal(techStatus('survey',s).progress,10);
 assert.equal(s.points,100-FIELD_STUDIES.reduce((sum,t)=>sum+t.rp,0));
});
test('legacy save with completed survey keeps all child discoveries without mutation',()=>{
 const s=state({unlocked:['survey','shelter'],projects:[{id:'stone-tools',invested:3}]});
 const before=structuredClone(s);
 const actual=effectiveUnlocked(s);
 assert.ok(FIELD_STUDIES.every(t=>actual.has(t.id)));
 assert.equal(techStatus('survey',s).progress,10);
 assert.equal(techStatus('survey-landing',s).unlocked,true);
 assert.deepEqual(s,before);
});
test('legacy partial investment is refunded when composite parent closes',()=>{
 const last=FIELD_STUDIES.at(-1);
 const previous=FIELD_STUDIES.slice(0,-1).map(t=>t.id);
 const s=state({points:8,unlocked:previous,
   projects:[{id:'survey',invested:3},{id:last.id,invested:last.rp},{id:'stone-tools',invested:2}]});
 const patch=completionPatch(s,last.id,'GM',12);
 assert.equal(patch.points,11);
 assert.deepEqual(patch.projects,[{id:'stone-tools',invested:2}]);
 assert.ok(patch.unlocked.includes('survey'));
 assert.equal(s.points,8); // pure patch did not mutate input
});
test('last child cannot add the parent before every prerequisite is complete',()=>{
 const s=state({unlocked:FIELD_STUDIES.filter(t=>t.id!=='survey-water').map(t=>t.id)});
 assert.equal(techStatus('survey',s).unlocked,false);
 assert.deepEqual(techStatus('survey-risk',s).missingParents,['survey-water']);
 const patch=completionPatch(s,'survey-report','GM',3);
 assert.equal(patch.unlocked.includes('survey'),false);
});
test('research template has nested screen, ten detail templates, back control and delegated handlers',()=>{
 const html=readFileSync(new URL('../templates/actor.hbs',import.meta.url),'utf8');
 const js=readFileSync(new URL('../module/sheets.mjs',import.meta.url),'utf8');
 assert.match(html,/data-genesis-research-subtree/);
 assert.match(html,/data-genesis-research-main/);
 assert.match(html,/data-genesis-subtech-card/);
 assert.match(html,/data-genesis-subtech-detail/);
 assert.match(html,/data-genesis-back-to-tree/);
 assert.match(html,/research\.programmes/);
 assert.match(html,/data-genesis-research-program/);
 assert.match(js,/dataset\.genesisSubtechCard/);
 assert.match(js,/this\._subtreeOpen=true/);
 assert.match(js,/this\._subtreeOpen=false/);
});
test('Handlebars section markers in actor sheet remain correctly nested',()=>{
 const html=readFileSync(new URL('../templates/actor.hbs',import.meta.url),'utf8');
 const stack=[];
 const tags=[...html.matchAll(/{{\s*(#|\/|else)(if|unless|each|with)?\b[^}]*}}/g)];
 for(const tag of tags){
   const action=tag[1],name=tag[2];
   if(action==='#')stack.push(name);
   else if(action==='/')assert.equal(stack.pop(),name,`Unexpected closing ${name} near ${tag.index}`);
   else assert.ok(stack.length>0,`Unexpected else near ${tag.index}`);
 }
 assert.deepEqual(stack,[]);
});

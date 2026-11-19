import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {researchContext} from '../module/research.mjs';
const template=readFileSync(new URL('../templates/actor.hbs',import.meta.url),'utf8');
const sheet=readFileSync(new URL('../module/sheets.mjs',import.meta.url),'utf8');
test('infrastructure-dependent investment button uses server-compatible check',()=>{
  const colony={id:'c',name:'Base',type:'colony',items:[],system:{science:{unlocked:['survey','shelter','stone-tools'],points:10,facilities:[],projects:[],dailyWork:[],discoveries:[]},industry:{placements:[]}}};
  const user={isGM:true};globalThis.game={actors:{filter:()=>[]},settings:{get:()=>1}};
  let c=researchContext(colony,user);
  assert.equal(c.statusMap['basic-workshop-step-1'].canInvest,false);
  assert.match(c.statusMap['basic-workshop-step-1'].investBlockedReason,/мастерская/);
  colony.system.science.facilities.push('bench');
  c=researchContext(colony,user);
  assert.equal(c.statusMap['basic-workshop-step-1'].canInvest,true);
  assert.equal(c.statusMap['basic-workshop-step-1'].investBlockedReason,'');
  colony.system.science.points=0;
  c=researchContext(colony,user);
  assert.equal(c.statusMap['basic-workshop-step-1'].canInvest,false);
  assert.match(c.statusMap['basic-workshop-step-1'].investBlockedReason,/свободных очков/);
});
test('filter automatically selects a visible technology or empty state',()=>{
  assert.match(sheet,/if\(!visible\.includes\(this\._techSelected\)\)this\._techSelected=visible\[0\]\|\|''/);
  assert.match(sheet,/\[data-genesis-tech-empty\]/);
  assert.match(template,/data-genesis-tech-empty/);
});
test('transfer destination distinguishes colony and non-owned survivor',()=>{
  assert.match(sheet,/Общий склад колонии/);
  assert.match(sheet,/чужой персонаж \(только получение\)/);
  assert.match(sheet,/a\.type==='npc'&&game\.user\.isGM/);
});
test('footer uses real game system version rather than a literal build number',()=>{
  assert.match(sheet,/systemVersion:game\.system\.version/);
  assert.match(template,/PG \/ SYSTEM \{\{systemVersion\}\}/);
});

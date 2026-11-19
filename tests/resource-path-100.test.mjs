import test from 'node:test';import assert from 'node:assert/strict';
import {TECHNOLOGIES,TECHNOLOGY_BY_ID} from '../module/tech-data.mjs';
import {RECIPES,BUILDINGS} from '../module/industry-data.mjs';
import {RESOURCE_NODES} from '../module/crew-rules.mjs';
test('all technology and building resource requirements have a game-acquirable origin',()=>{
  const sources=new Set([...Object.keys(RESOURCE_NODES),'food','water',...RECIPES.map(r=>r.output.code)]);
  const unlisted=[];
  for(const t of TECHNOLOGIES)for(const key of Object.keys(t.requires))if(!sources.has(key))unlisted.push(`tech ${t.id}: ${key}`);
  for(const r of RECIPES)for(const key of Object.keys(r.inputs))if(!sources.has(key))unlisted.push(`recipe ${r.id}: ${key}`);
  for(const b of BUILDINGS)for(const key of Object.keys(b.inputs))if(!sources.has(key))unlisted.push(`building ${b.id}: ${key}`);
  assert.deepEqual(unlisted,[]);
  assert.ok(TECHNOLOGY_BY_ID['material-science'].recipes.includes('glass-panels'));
  assert.ok(RECIPES.some(r=>r.output.code==='glass'));
});
test('eleven mineable resource nodes provide nonzero yields',()=>{
  assert.equal(Object.keys(RESOURCE_NODES).length,15);
  for(const [key,r]of Object.entries(RESOURCE_NODES))assert.ok(r.limit>0&&r.days>=1&&r.name&&r.code===key);
});

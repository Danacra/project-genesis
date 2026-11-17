import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const template=readFileSync(new URL('../templates/actor.hbs',import.meta.url),'utf8');
const sheet=readFileSync(new URL('../module/sheets.mjs',import.meta.url),'utf8');
const styles=readFileSync(new URL('../styles/genesis.css',import.meta.url),'utf8');
const keys=['overview','inventory','containers','research','blueprints','production','construction','networks','crew','history'];
test('fallback quick navigator is always in banner',()=>{
  assert.equal((template.match(/data-genesis-quick-nav/g)||[]).length,1);
  const header=template.split('class="genesis-banner"')[1].split('</div>\n  <div class="genesis-nav')[0];
  assert.match(header,/data-genesis-quick-nav/);
});
test('every quick navigator option maps to a page',()=>{
  for(const key of keys){
    assert.equal((template.match(new RegExp('<option value="'+key+'"','g'))||[]).length,1,key);
    assert.equal((template.match(new RegExp('data-genesis-page="'+key+'"','g'))||[]).length,1,key);
  }
});
test('inventory is available for both survivor and colony',()=>{
  assert.match(template,/Личный инвентарь выжившего/);
  assert.match(template,/Общий склад колонии/);
  assert.match(template,/data-genesis-open-tab="inventory"/);
  assert.match(template,/data-genesis-action="create"/);
});
test('dropdown synchronizes selection and accepts changes',()=>{
  assert.match(sheet,/root.querySelectorAll\('\[data-genesis-quick-nav\]'\)\.forEach/);
  assert.match(sheet,/const quickNav=event.target.closest\?\.\('\[data-genesis-quick-nav\]'\)/);
  assert.match(sheet,/selectTab\(target\)/);
});
test('inventory shortcut uses same navigation logic',()=>{
  assert.match(sheet,/const shortcut=event.target.closest\?\.\('\[data-genesis-open-tab\]'\)/);
  assert.match(styles,/genesis-header-controls/);
});

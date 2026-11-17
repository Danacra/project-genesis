import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const template=readFileSync(new URL('../templates/actor.hbs',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles/genesis.css',import.meta.url),'utf8');
const sheet=readFileSync(new URL('../module/sheets.mjs',import.meta.url),'utf8');
const keys=['overview','inventory','containers','research','blueprints','production','construction','networks','crew','history'];
test('navigation is a generic tablist rather than a nav element',()=>{
  assert.match(template,/<div class="genesis-nav genesis-tabbar" role="tablist"[^>]*data-genesis-navigation>/);
  assert.doesNotMatch(template,/<nav class="genesis-nav"/);
});
test('all 10 tab buttons exist once',()=>{
  for(const key of keys)assert.equal((template.match(new RegExp('data-genesis-tab="'+key+'"','g'))||[]).length,1,key);
});
test('all pages exist once',()=>{
  for(const key of keys)assert.equal((template.match(new RegExp('data-genesis-page="'+key+'"','g'))||[]).length,1,key);
});
test('navigation is forced visible',()=>{
  assert.match(css,/\.genesis \.genesis-layout > \.genesis-tabbar[\s\S]*?display: flex !important/);
  assert.match(css,/\.genesis \.genesis-tabbar > \[data-genesis-tab\]/);
});
test('button selection updates aria state and page visibility',()=>{
  assert.match(sheet,/el\.setAttribute\('aria-selected',String\(selected\)\)/);
  assert.match(sheet,/el\.hidden=el\.dataset\.genesisPage!==name/);
});

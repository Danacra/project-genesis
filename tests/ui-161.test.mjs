import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {captureGenesisScroll,restoreGenesisScroll,trackGenesisSheet,untrackGenesisSheet,queueGenesisSheetRefresh,initializeSheetLiveUpdates} from '../module/sheet-refresh.mjs';
const template=readFileSync(new URL('../templates/actor.hbs',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles/genesis.css',import.meta.url),'utf8');
const source=readFileSync(new URL('../module/sheets.mjs',import.meta.url),'utf8');
const map=readFileSync(new URL('../module/building-interactions.mjs',import.meta.url),'utf8');

test('1.6.1: all 13 navigation tabs live in a collapsible sidebar',()=>{
  assert.match(template,/data-genesis-sidebar/);
  assert.match(template,/data-genesis-sidebar-toggle/);
  assert.match(template,/genesis-workspace-body/);
  assert.match(css,/genesis-sidebar-shell\.is-pinned/);
  for(const id of ['overview','inventory','containers','research','blueprints','production','construction','networks','planet','crew','mission','history','library'])
    assert.equal((template.match(new RegExp('data-genesis-tab="'+id+'"','g'))||[]).length,1);
});
test('1.6.1: map hotspot buttons are compact and stay below application windows',()=>{
  assert.match(map,/const obstructed=/);
  assert.match(map,/el\.setAttribute\('aria-label',el\.title\)/);
  assert.match(css,/\.genesis-building-hotspot\{z-index:20!important/);
  assert.doesNotMatch(map,/'⌂ Войти'/);
});
test('1.6.1: active tab, scroll and pin state survive live rerender',()=>{
  assert.match(source,/this\._sidebarPinned=false/);
  assert.match(source,/this\._genesisTab=name/);
  assert.match(source,/restoreGenesisScroll\(root,this\._genesisPendingScroll\)/);
});
test('1.6.1: GM can browse unresearched blueprint names without unlocking player recipes',()=>{
  assert.match(template,/ВИДНО GM · НЕ ИЗУЧЕНО/);
  assert.match(template,/Неизученные рецепты не открываются игрокам/);
  assert.match(template,/ЧЕРТЁЖ GM · НЕ ИЗУЧЕН/);
});
test('1.6.1: scroll coordinates are restored to matching elements',()=>{
  const nodes=new Map([['.genesis-workspace-body',[{scrollLeft:21,scrollTop:55}]],['.genesis-tech-viewport',[{scrollLeft:120,scrollTop:210}]]]);
  const root={querySelectorAll:s=>nodes.get(s)||[]};
  const state=captureGenesisScroll(root);
  for(const list of nodes.values())for(const node of list){node.scrollLeft=0;node.scrollTop=0;}
  restoreGenesisScroll(root,state);
  assert.deepEqual(nodes.get('.genesis-tech-viewport')[0],{scrollLeft:120,scrollTop:210});
  assert.deepEqual(nodes.get('.genesis-workspace-body')[0],{scrollLeft:21,scrollTop:55});
});
test('1.6.1: document changes coalesce into one live refresh',async()=>{
  const callbacks={};globalThis.Hooks={on:(name,fn)=>{callbacks[name]=fn;}};
  initializeSheetLiveUpdates();
  const root={isConnected:true,querySelectorAll:()=>[],contains:()=>false};
  let rendered=0;
  const sheet={element:root,render:async()=>{rendered++;}};
  trackGenesisSheet(sheet);
  callbacks.updateActor({});callbacks.updateItem({});callbacks.updateActor({});
  await new Promise(resolve=>setTimeout(resolve,150));
  untrackGenesisSheet(sheet);
  assert.equal(rendered,1);
});
test('1.6.1: editing a focused field is never interrupted by background changes',async()=>{
  let onBlur;
  const focused={matches:()=>true,addEventListener:(name,listener)=>{if(name==='blur')onBlur=listener;}};
  globalThis.document={activeElement:focused};
  const root={isConnected:true,querySelectorAll:()=>[],contains:element=>element===focused};
  let rendered=0;
  const sheet={element:root,render:async()=>{rendered++;}};
  trackGenesisSheet(sheet);
  queueGenesisSheetRefresh(sheet);
  await new Promise(resolve=>setTimeout(resolve,110));
  assert.equal(rendered,0);
  assert.equal(typeof onBlur,'function');
  globalThis.document.activeElement=null;
  onBlur();
  await new Promise(resolve=>setTimeout(resolve,110));
  untrackGenesisSheet(sheet);
  assert.equal(rendered,1);
  delete globalThis.document;
});

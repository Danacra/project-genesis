import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {PLAYER_CHAPTERS,GM_CHAPTERS,libraryContext} from '../module/library.mjs';
import {tileAsset} from '../module/map-rules.mjs';
import {upgradeDefaultWorkbenchTiles} from '../module/building-roof.mjs';
const html=readFileSync(new URL('../templates/actor.hbs',import.meta.url),'utf8');
const sheets=readFileSync(new URL('../module/sheets.mjs',import.meta.url),'utf8');
test('library is in quick-nav and normal tabbar with an actual page',()=>{
 assert.match(html,/<option value="library">Библиотека<\/option>/);
 assert.match(html,/data-genesis-tab="library"/);
 assert.match(html,/data-genesis-page="library"/);
 assert.match(html,/data-genesis-library-chapter="\{\{id\}\}"/);
 assert.match(sheets,/selectLibraryChapter/);
 assert.match(sheets,/data-genesis-help-open/);
 assert.match(sheets,/data-genesis-library-search/);
});
test('player handbook is readable, has no GM-only chapters; GM gets additional topics',()=>{
 const player=libraryContext(false),gm=libraryContext(true);
 assert.equal(player.chapterCount,PLAYER_CHAPTERS.length);
 assert.equal(gm.chapterCount,PLAYER_CHAPTERS.length+GM_CHAPTERS.length);
 assert.ok(player.chapterCount>=10);
 assert.equal(player.chapters.some(c=>c.group==='GM'),false);
 assert.ok(gm.chapters.some(c=>c.group==='GM'));
 assert.ok(player.chapters.every(c=>c.sections.length>0&&c.sections.every(s=>s.title&&(s.text||s.steps?.length))));
});
test('artwork is packaged and finished buildings have dedicated PNGs',()=>{
 assert.match(tileAsset('shelter',true),/shelter\.png$/);
 assert.match(tileAsset('bench',true),/bench\.png$/);
 assert.match(tileAsset('bench',false),/construction-site\.svg$/);
 assert.ok(existsSync(new URL('../assets/buildings/bench.png',import.meta.url)));
 assert.ok(existsSync(new URL('../assets/buildings/shelter.png',import.meta.url)));
});
function worldForBench({img='systems/project-genesis/assets/buildings/bench.svg',isGM=true,foreign=false}={}){
 const tile={id:'tile1',texture:{src:img},flags:{'project-genesis':{colonyId:foreign?'no':'col',placementId:'place1',buildingId:'bench',status:'finished'}}};
 const scene={id:'scene1',tiles:{get:id=>id==='tile1'?tile:null},updates:[],async updateEmbeddedDocuments(k,rs){assert.equal(k,'Tile');this.updates.push(...rs);for(const r of rs)tile.texture.src=r['texture.src'];}};
 const colony={id:'col',type:'colony',system:{industry:{placements:[{id:'place1',sceneId:'scene1',tileId:'tile1',buildingId:'bench',status:'finished'}]}}};
 return {scene,tile,world:{user:{isGM},actors:{filter:f=>[colony].filter(f)},scenes:{get:id=>id==='scene1'?scene:null}}};
}
test('default benches migrate only once; custom art never replaced',async()=>{
 const x=worldForBench();assert.equal(await upgradeDefaultWorkbenchTiles(x.world),1);assert.match(x.tile.texture.src,/bench\.png$/);
 assert.equal(await upgradeDefaultWorkbenchTiles(x.world),0);
 for(const opts of [{img:'worlds/example/custom.png'},{foreign:true},{isGM:false}]){
  const y=worldForBench(opts);assert.equal(await upgradeDefaultWorkbenchTiles(y.world),0);assert.equal(y.scene.updates.length,0);
 }
});

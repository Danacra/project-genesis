import test from 'node:test';
import assert from 'node:assert/strict';
import {upgradeShelterRoofTiles} from '../module/building-roof.mjs';
import {tileAsset} from '../module/map-rules.mjs';
import {existsSync,statSync} from 'node:fs';
const old='systems/project-genesis/assets/buildings/shelter.svg';
const newer=tileAsset('shelter',true);
function setup({isGM=true,src=old,sceneExists=true}={}){
  const tile={id:'tile1',texture:{src},flags:{'project-genesis':{
    buildingId:'shelter',colonyId:'col',placementId:'shelter-1',status:'finished'}}};
  const scene={id:'scene',tiles:{get:id=>id==='tile1'?tile:null},updates:[],
    async updateEmbeddedDocuments(type,rows){assert.equal(type,'Tile');this.updates.push(...rows);for(const row of rows)tile.texture.src=row['texture.src'];}};
  const colony={id:'col',type:'colony',system:{industry:{placements:[{
    id:'shelter-1',buildingId:'shelter',sceneId:'scene',tileId:'tile1',status:'finished'}]}}};
  const world={user:{isGM},actors:{filter:fn=>[colony].filter(fn)},
    scenes:{get:id=>sceneExists&&id==='scene'?scene:null}};
  return {world,scene,tile,colony};
}
test('rooftop picture is a real shipped transparent PNG without changing footprint',()=>{
  assert.ok(newer.endsWith('/shelter.png'));
  assert.ok(existsSync(new URL('../assets/buildings/shelter.png',import.meta.url)));
  assert.ok(statSync(new URL('../assets/buildings/shelter.png',import.meta.url)).size>100_000);
  assert.equal(tileAsset('shelter',false).endsWith('construction-site.svg'),true);
});
test('GM migrates old default art once and does not change it on a second run',async()=>{
  const s=setup();assert.equal(await upgradeShelterRoofTiles(s.world),1);
  assert.equal(s.tile.texture.src,newer);
  assert.equal(await upgradeShelterRoofTiles(s.world),0);
  assert.equal(s.scene.updates.length,1);
});
test('a manually customized residential roof is preserved',async()=>{
  const s=setup({src:'worlds/my-campaign/assets/custom-house.webp'});
  assert.equal(await upgradeShelterRoofTiles(s.world),0);
  assert.equal(s.scene.updates.length,0);
});
test('non-GM client and missing scene cannot change a roof',async()=>{
  for(const opts of [{isGM:false},{sceneExists:false}]){
    const s=setup(opts);assert.equal(await upgradeShelterRoofTiles(s.world),0);
    assert.equal(s.scene.updates.length,0);
  }
});
test('foreign shelter tiles cannot be overwritten',async()=>{
  const s=setup();s.tile.flags['project-genesis'].colonyId='other';
  assert.equal(await upgradeShelterRoofTiles(s.world),0);
});

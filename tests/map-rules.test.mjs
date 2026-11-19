import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILDING_FOOTPRINTS,sceneGeometry,snapToGrid,footprintRect,checkPlacement,assertPlacement,
  overlaps,asTileData,validateTileLink,tileAsset,tilesBlocking} from '../module/map-rules.mjs';
const makeScene=({width=1200,height=900,grid=100,type=1,x=0,y=0,tiles=[]}={})=>({
  id:'scene01',width,height,grid:{type,size:grid},dimensions:{sceneRect:{x,y,width,height}},tiles
});
test('each of 14 buildings has a footprint and a shipped SVG path',()=>{
  assert.equal(Object.keys(BUILDING_FOOTPRINTS).length,14);
  for(const [code,dimensions] of Object.entries(BUILDING_FOOTPRINTS)){
    assert.equal(dimensions.length,2);
    assert.ok(dimensions.every(n=>Number.isSafeInteger(n)&&n>0));
    assert.ok(tileAsset(code,true).endsWith(`${code}.svg`));
    assert.ok(tileAsset(code,false).endsWith('construction-site.svg'));
  }
});
test('snap relative to the actual padded scene rectangle',()=>{
  const scene=makeScene({x:200,y:100});const g=sceneGeometry(scene);
  assert.deepEqual(snapToGrid(333,209,g.grid,g.bounds),{x:300,y:200});
  assert.deepEqual(footprintRect('bench',{x:333,y:209},g),{x:300,y:200,width:200,height:200});
});
test('square-grid constraint rejects hex and gridless',()=>{
  assert.throws(()=>sceneGeometry(makeScene({type:0})),/квадратной сеткой/);
  assert.throws(()=>sceneGeometry(makeScene({type:2})),/квадратной сеткой/);
});
test('map bounds are strict for larger buildings',()=>{
  const scene=makeScene();
  assert.equal(checkPlacement('assembly-dock',{x:700,y:100},scene).valid,false);
  assert.equal(checkPlacement('assembly-dock',{x:600,y:400},scene).valid,true);
  assert.equal(checkPlacement('bench',{x:-1,y:100},scene).valid,false);
});
test('overlap considers only the actual rectangle intersection',()=>{
  const one={x:0,y:0,width:100,height:100};
  assert.equal(overlaps(one,{x:100,y:0,width:10,height:10}),false);
  assert.equal(overlaps(one,{x:99,y:0,width:10,height:10}),true);
});
test('blocks building tiles and explicitly blocked terrain tiles, but not map decoration',()=>{
  const scene=makeScene({tiles:[
    {id:'background',x:0,y:0,width:1200,height:900,flags:{}},
    {id:'existing',x:200,y:200,width:100,height:100,flags:{'project-genesis':{buildingId:'bench'}}},
    {id:'marsh',x:700,y:700,width:100,height:100,flags:{'project-genesis':{blockPlacement:true}}}
  ]});
  assert.equal(tilesBlocking(scene).length,2);
  assert.equal(checkPlacement('bench',{x:0,y:0},scene).valid,true);
  assert.match(checkPlacement('bench',{x:200,y:200},scene).reason,/занято/);
  assert.equal(checkPlacement('bench',{x:700,y:700},scene).valid,false);
});
test('placements still block missing scene tiles so data is not silently overwritten',()=>{
  const scene=makeScene(),placements=[{sceneId:'scene01',x:0,y:0,width:200,height:200,tileId:'old'}];
  assert.equal(checkPlacement('bench',{x:100,y:100},scene,{placements}).valid,false);
  // independent scene should not collide
  const other={...scene,id:'scene02'};
  assert.equal(checkPlacement('bench',{x:100,y:100},other,{placements}).valid,true);
});
test('server rejects forged unsnapped and fractional positions',()=>{
  const scene=makeScene();
  assert.throws(()=>assertPlacement('bench',{x:101,y:0},scene),/сетке/);
  assert.throws(()=>assertPlacement('bench',{x:100.5,y:0},scene),/целыми/);
  assert.deepEqual(assertPlacement('bench',{x:100,y:0},scene).x,100);
});
test('data for scene tile links to the colony, order and building',()=>{
  const data=asTileData('bench',{x:100,y:0,width:200,height:200},{colonyId:'colony01',jobId:'job01',placementId:'placement01'});
  assert.equal(data.locked,true);
  assert.equal(data.flags['project-genesis'].status,'construction');
  const placement={id:'placement01',jobId:'job01',colonyId:'colony01',buildingId:'bench'};
  assert.equal(validateTileLink(placement,data),true);
  assert.equal(validateTileLink({...placement,jobId:'another'},data),false);
});

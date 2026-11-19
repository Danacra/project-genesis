import test from 'node:test';
import assert from 'node:assert/strict';
import {salvageFor,assertCanPlaceInside,structureBlockers,roomPowerLoads,isInteriorBuilding,isCraftStation} from '../module/structure-rules.mjs';
import {simulateNetworks} from '../module/network-rules.mjs';
import {BUILDINGS} from '../module/industry-data.mjs';
import {BUILDING_FOOTPRINTS} from '../module/map-rules.mjs';
const placement={id:'room1',colonyId:'c',buildingId:'room',sceneId:'outdoor',status:'finished',interiorSceneId:'inner'};
test('v1.2: workshop-room is a buildable shell with a footprint, residential shelters stay enterable',()=>{
  assert.ok(BUILDINGS.some(x=>x.id==='room'&&x.max>=2));
  assert.deepEqual(BUILDING_FOOTPRINTS.room,[6,6]);
  assert.equal(isInteriorBuilding('room'),true);
  assert.equal(isInteriorBuilding('shelter'),true);
  assert.equal(isCraftStation('bench'),true);
  assert.equal(isCraftStation('electronicsLab'),true);
  assert.equal(isCraftStation('room'),false);
});
test('v1.2: salvage refund is 50% of original construction ingredients, rounded down',()=>{
  assert.deepEqual(salvageFor('bench'),{wood:1,stone:1});
  assert.deepEqual(salvageFor('room'),{wood:3,stone:2,scrap:1});
  assert.deepEqual(salvageFor('bench',0),{});
  assert.throws(()=>salvageFor('missing'),/Неизвестное/);
  assert.throws(()=>salvageFor('bench',1.2),/доля/);
});
test('v1.2: interior rules protect against recursive rooms and generator/network placements',()=>{
  const interior={flags:{'project-genesis':{interiorOf:'room1'}}};
  assert.doesNotThrow(()=>assertCanPlaceInside('bench',interior));
  assert.doesNotThrow(()=>assertCanPlaceInside('electronicsLab',interior));
  assert.throws(()=>assertCanPlaceInside('room',interior),/только/);
  assert.throws(()=>assertCanPlaceInside('powerLab',interior),/только/);
  assert.throws(()=>assertCanPlaceInside('storehouse',interior),/только/);
  assert.doesNotThrow(()=>assertCanPlaceInside('storehouse',{flags:{}}));
});
test('v1.2: safe removal refuses connected, stocked, or occupied structures',()=>{
  assert.deepEqual(structureBlockers(placement),[]);
  const problems=structureBlockers(placement,{
    links:[{fromId:'room1',toId:'generator'}],
    caches:[{placementId:'room1',stock:[{quantity:2}]}],
    jobs:[{sourceKind:'placement',sourceId:'room1'}],
    placements:[{sceneId:'inner',buildingId:'bench'}]
  });
  assert.equal(problems.length,4);
  assert.deepEqual(structureBlockers({...placement,buildingId:'bench',interiorSceneId:''},{buildingCount:1,productionJobs:[{subject:'workshop-tools'}]}).length,1);
  assert.deepEqual(structureBlockers({...placement,status:'construction'}).length,1);
  assert.deepEqual(structureBlockers({...placement,buildingId:'assembly-dock'},{missionStage:2}).length,1);
});
test('v1.2: electricity for indoor equipment is accounted for by outer room, bench stays manual',()=>{
  const placements=[{id:'power',buildingId:'powerLab',sceneId:'outdoor',status:'finished'},placement,
    {id:'electron',buildingId:'electronicsLab',sceneId:'inner',status:'finished'},
    {id:'workbench',buildingId:'bench',sceneId:'inner',status:'finished'}];
  const scenes={get:id=>id==='inner'?{flags:{'project-genesis':{interiorOf:'room1'}}}:{flags:{}}};
  const loads=roomPowerLoads(placements,scenes);
  assert.deepEqual(loads,{room1:4});
  const simulation=simulateNetworks(placements.slice(0,2),[{id:'cable',fromId:'power',toId:'room1',sceneId:'outdoor',type:'power'}],{interiorLoads:loads});
  assert.equal(simulation.byId.room1.powerNeed,5);
  assert.equal(simulation.byId.room1.powered,true);
  assert.equal(simulation.totals.power.demand,5);
  const offline=simulateNetworks(placements.slice(0,2),[],{interiorLoads:loads});
  assert.equal(offline.byId.room1.powered,false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_DARKNESS,lightSwitchOn,effectiveLight,ceilingLightData,managedCeilingLight,lightPlan,canUseRoomSwitch} from '../module/interior-light-rules.mjs';
const SYS='project-genesis';
const makeRoom=(lightsOn=true)=>({id:'inside',width:1200,height:900,grid:{size:100,type:1},
  flags:{[SYS]:{interiorOf:'room-01',colonyId:'base',exteriorSceneId:'exterior',lightsOn}},
  tokens:[],lights:[]});
test('1.3.1: light requires electricity AND a switched-on room',()=>{
  const room=makeRoom();
  assert.equal(effectiveLight(true,room),true);
  assert.equal(effectiveLight(false,room),false);
  room.flags[SYS].lightsOn=false;
  assert.equal(effectiveLight(true,room),false);
  assert.equal(lightSwitchOn(room),false);
  delete room.flags[SYS].lightsOn;
  assert.equal(lightSwitchOn(room),true);
  assert.equal(DEFAULT_DARKNESS,0.85);
});
test('1.3.1: generated ambient light is room-scoped and turns off when disconnected',()=>{
  const room=makeRoom();
  const data=ceilingLightData(room,'room-01',true);
  assert.equal(data.hidden,false);
  assert.equal(data.x,600);assert.equal(data.y,450);
  assert.equal(data.flags[SYS].placementId,'room-01');
  assert.ok(data.config.bright>0&&data.config.dim>=data.config.bright);
  assert.equal(ceilingLightData(room,'room-01',false).hidden,true);
});
test('1.3.1: create once, then only toggle hidden state',()=>{
  const room=makeRoom();
  let plan=lightPlan(room,'room-01',true);
  assert.equal(plan.action,'create');
  room.lights.push({...plan.document,id:'lamp-01'});
  assert.equal(managedCeilingLight(room,'room-01').id,'lamp-01');
  assert.equal(lightPlan(room,'room-01',true).action,'none');
  plan=lightPlan(room,'room-01',false);
  assert.equal(plan.action,'update');
  assert.deepEqual(plan.document,{_id:'lamp-01',hidden:true});
  room.lights[0].hidden=true;
  assert.equal(lightPlan(room,'room-01',false).action,'none');
  assert.equal(lightPlan(room,'room-01',true).action,'update');
});
test('1.3.1: never hijack unrelated manual light fixtures',()=>{
  const room=makeRoom();
  room.lights.push({id:'gm-lamp',flags:{custom:{type:'normal'}},hidden:false});
  assert.equal(managedCeilingLight(room,'room-01'),null);
  assert.equal(lightPlan(room,'room-01',true).action,'create');
});
test('1.3.1: only GM or player with an owned survivor inside can toggle lighting',()=>{
  const room=makeRoom(),gm={id:'gm',isGM:true},user={id:'p1',active:true,isGM:false};
  const actor={id:'actor',type:'survivor',testUserPermission:p=>p.id==='p1'};
  const actors={get:id=>id==='actor'?actor:undefined};
  assert.equal(canUseRoomSwitch(gm,room,actors),true);
  assert.equal(canUseRoomSwitch(user,room,actors),false);
  room.tokens.push({id:'t',actorId:'actor'});
  assert.equal(canUseRoomSwitch(user,room,actors),true);
  assert.equal(canUseRoomSwitch({id:'other',active:true},room,actors),false);
  room.flags[SYS].interiorOf='';
  assert.equal(canUseRoomSwitch(user,room,actors),false);
});

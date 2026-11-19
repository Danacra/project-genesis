import test from 'node:test';
import assert from 'node:assert/strict';
import {interiorLayout,interiorPlacementProblem,chooseFreeSpawn,validateTransferToken} from '../module/interior-rules.mjs';
import {checkPlacement,assertPlacement} from '../module/map-rules.mjs';
import {assertInteriorOwnership} from '../module/structure-rules.mjs';
import {moveSurvivorToken} from '../module/scene-transfer.mjs';
const SYS='project-genesis';
const makeScene=(id,{room=false}={})=>{
  const tokens=[],tiles=[];
  Object.defineProperty(tokens,'get',{value:id=>tokens.find(t=>t.id===id)});
  Object.defineProperty(tiles,'get',{value:id=>tiles.find(t=>t.id===id)});
  const s={id,name:id,width:1200,height:900,grid:{size:100,type:1},
    flags:room?{[SYS]:{interiorOf:'room',colonyId:'colony',exteriorSceneId:'outside'}}:{},tokens,tiles,
    async createEmbeddedDocuments(kind,records){assert.equal(kind,'Token');const rows=records.map((record,i)=>({...structuredClone(record),id:`created-${tokens.length+i+1}`}));tokens.push(...rows);return rows;},
    async deleteEmbeddedDocuments(kind,ids){assert.equal(kind,'Token');for(const id of ids){const i=tokens.findIndex(t=>t.id===id);if(i>=0)tokens.splice(i,1);}}};
  return s;
};
const placement={id:'room',colonyId:'colony',buildingId:'room',sceneId:'outside',interiorSceneId:'inside',
  status:'finished',x:100,y:100,width:600,height:600};
const owner={id:'player',isGM:false};
const actor={id:'hero',type:'survivor',testUserPermission:user=>user.id==='player'};
const actors={get:id=>id==='hero'?actor:id==='npc'?{id:'npc',type:'npc'}:undefined};
const makeToken=(id='hero-token')=>({id,actorId:'hero',width:1,height:1,x:200,y:200,
  toObject(){return {_id:this.id,actorId:this.actorId,width:1,height:1,name:'Тестовый выживший',actorLink:true,
    sight:{enabled:true},x:this.x,y:this.y,flags:{custom:{tag:'keep'}}};}});
test('v1.3: interior doorway and 1-cell walls remain clear for movement',()=>{
  const scene=makeScene('inside',{room:true});
  const {entry,inside}=interiorLayout(scene);
  assert.equal(inside.x,100);assert.equal(entry.x,500);assert.equal(entry.y,600);
  assert.match(interiorPlacementProblem(scene,{x:0,y:100,width:200,height:200}),/стен/);
  assert.match(interiorPlacementProblem(scene,{x:500,y:600,width:200,height:200}),/проход/);
  assert.equal(interiorPlacementProblem(scene,{x:100,y:100,width:300,height:300}),'');
  assert.equal(checkPlacement('bench',{x:500,y:600},scene).valid,false);
  assert.equal(checkPlacement('bench',{x:100,y:100},scene).valid,true);
  assert.throws(()=>assertPlacement('bench',{x:0,y:200},scene),/стен/);
  assert.doesNotThrow(()=>assertPlacement('bench',{x:100,y:100},scene));
});
test('v1.3: reject station placement in unrelated and orphaned interior scenes',()=>{
  const scene=makeScene('inside',{room:true});
  const colony={id:'colony',system:{industry:{placements:[placement]}}};
  assert.doesNotThrow(()=>assertInteriorOwnership(colony,scene));
  assert.throws(()=>assertInteriorOwnership({id:'other',system:colony.system},scene),/другой/);
  assert.throws(()=>assertInteriorOwnership({id:'colony',system:{industry:{placements:[]}}},scene),/не связана/);
  assert.doesNotThrow(()=>assertInteriorOwnership(colony,makeScene('outside')));
});
test('v1.3: spawn selection avoids furniture and occupied doorway',()=>{
  const scene=makeScene('inside',{room:true});
  scene.tokens.push({id:'already',x:500,y:600,width:1,height:1});
  scene.tiles.push({id:'bench',x:400,y:500,width:100,height:100,flags:{[SYS]:{buildingId:'bench'}}});
  const result=chooseFreeSpawn(scene,{x:500,y:600});
  assert.notDeepEqual(result,{x:500,y:600});
  assert.notDeepEqual(result,{x:400,y:500});
  assert.ok(result.x>=100&&result.y>=100);
  assert.ok(result.x<1100&&result.y<800);
  const tiny=makeScene('tiny',{room:true});tiny.width=200;tiny.height=200;
  assert.throws(()=>chooseFreeSpawn(tiny,{x:100,y:100}),/мала/);
});
test('v1.3: deny moving other players, non-survivors and nonexistent tokens',()=>{
  const scene=makeScene('outside');scene.tokens.push(makeToken());
  assert.equal(validateTransferToken(scene,'hero-token',owner,actors).id,'hero-token');
  assert.throws(()=>validateTransferToken(scene,'hero-token',{id:'stranger'},actors),/прав/);
  assert.throws(()=>validateTransferToken(scene,'missing',owner,actors),/отсутствует/);
  scene.tokens.push({...makeToken('npc-token'),actorId:'npc'});
  assert.throws(()=>validateTransferToken(scene,'npc-token',owner,actors),/выживших/);
});
test('v1.3: linked survivor enters and exits, preserving actor data but not old token id',async()=>{
  const outside=makeScene('outside'),inside=makeScene('inside',{room:true});outside.tokens.push(makeToken());
  const entered=await moveSurvivorToken({source:outside,target:inside,tokenId:'hero-token',user:owner,actors,
    placement,action:'enter',transferId:'1111111111111111'});
  assert.equal(outside.tokens.length,0);assert.equal(inside.tokens.length,1);
  assert.equal(entered.sceneId,'inside');
  assert.equal(inside.tokens[0].actorLink,true);assert.equal(inside.tokens[0].sight.enabled,true);
  assert.equal(inside.tokens[0].flags.custom.tag,'keep');assert.equal(inside.tokens[0]._id,undefined);
  // A freshly created test token can be serialized as a real TokenDocument would be.
  inside.tokens[0].toObject=function(){const {id,toObject,...data}=this;return {_id:id,...structuredClone(data)};};
  const exited=await moveSurvivorToken({source:inside,target:outside,tokenId:inside.tokens[0].id,user:owner,actors,
    placement,action:'exit',transferId:'2222222222222222'});
  assert.equal(exited.sceneId,'outside');assert.equal(inside.tokens.length,0);assert.equal(outside.tokens.length,1);
  assert.equal(outside.tokens[0].actorId,'hero');
});
test('v1.3: a failed destination write leaves original token untouched',async()=>{
  const outside=makeScene('outside'),inside=makeScene('inside',{room:true});outside.tokens.push(makeToken());
  inside.createEmbeddedDocuments=async()=>{throw Error('target unavailable');};
  await assert.rejects(()=>moveSurvivorToken({source:outside,target:inside,tokenId:'hero-token',user:owner,actors,
    placement,action:'enter'}),/target unavailable/);
  assert.equal(outside.tokens.length,1);assert.equal(inside.tokens.length,0);
});
test('v1.3: deletion failure rolls back destination copy, preventing duplicate tokens',async()=>{
  const outside=makeScene('outside'),inside=makeScene('inside',{room:true});outside.tokens.push(makeToken());
  outside.deleteEmbeddedDocuments=async()=>{throw Error('source locked');};
  await assert.rejects(()=>moveSurvivorToken({source:outside,target:inside,tokenId:'hero-token',user:owner,actors,
    placement,action:'enter'}),/source locked/);
  assert.equal(outside.tokens.length,1);assert.equal(inside.tokens.length,0);
});
test('v1.3: a malicious scene linkage cannot teleport a token',async()=>{
  const outside=makeScene('outside'),inside=makeScene('inside',{room:true});outside.tokens.push(makeToken());
  await assert.rejects(()=>moveSurvivorToken({source:outside,target:inside,tokenId:'hero-token',user:owner,actors,
    placement:{...placement,interiorSceneId:'foreign'},action:'enter'}),/не соответствуют/);
  assert.equal(outside.tokens.length,1);assert.equal(inside.tokens.length,0);
});

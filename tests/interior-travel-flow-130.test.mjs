import test from 'node:test';
import assert from 'node:assert/strict';
import {enterRoom,exitRoom,initializeBuildingInteractions} from '../module/building-interactions.mjs';
const SYS='project-genesis';
const clone=structuredClone;
function setup(){
  let n=0;const notifications=[],viewed=[],emitted=[],sockets=new Map(),hooks=new Map();
  const makeToken=(id,actorId='survivor')=>({id,actorId,x:200,y:300,width:1,height:1,
    toObject(){return {_id:id,actorId,x:this.x,y:this.y,width:1,height:1,name:'Испытатель',actorLink:true,flags:{}};}});
  const scene=(id,{interior=false}={})=>{
    const tokens=[],tiles=[];tokens.get=id=>tokens.find(t=>t.id===id);tiles.get=id=>tiles.find(t=>t.id===id);
    return {id,name:id,width:1200,height:900,grid:{size:100,type:1},tokens,tiles,
      flags:interior?{[SYS]:{interiorOf:'building',colonyId:'colony',exteriorSceneId:'outside'}}:{},
      async view(){viewed.push(id);globalThis.canvas.scene=this;},
      async createEmbeddedDocuments(kind,docs){assert.equal(kind,'Token');const created=docs.map(d=>{const id=`transferred-${++n}`;
        return {...clone(d),id,toObject(){const {id,toObject,...data}=this;return {...clone(data),_id:id};}};});
        tokens.push(...created);return created;},
      async deleteEmbeddedDocuments(kind,ids){assert.equal(kind,'Token');for(const id of ids){const index=tokens.findIndex(t=>t.id===id);if(index>=0)tokens.splice(index,1);}}};
  };
  const outside=scene('outside');outside.tokens.push(makeToken('first'));
  const tile={id:'house-tile',x:100,y:100,width:300,height:200,rotation:0,
    flags:{[SYS]:{colonyId:'colony',jobId:'job',placementId:'building',buildingId:'shelter',status:'finished'}}};
  outside.tiles.push(tile);
  const scenes=new Map([['outside',outside]]);
  const building={id:'building',colonyId:'colony',jobId:'job',buildingId:'shelter',sceneId:'outside',
    tileId:'house-tile',interiorSceneId:'',status:'finished',x:100,y:100,width:300,height:200};
  const colony={id:'colony',name:'Кампус',type:'colony',system:{industry:{placements:[building]}},
    async update(update){this.system.industry.placements=clone(update['system.industry.placements']);}};
  const survivor={id:'survivor',type:'survivor',testUserPermission:user=>user.id==='player'};
  const actorList=[colony,survivor],users=[{id:'gm',isGM:true,active:true},{id:'player',isGM:false,active:true}];
  const findActor=id=>actorList.find(a=>a.id===id),findUser=id=>users.find(u=>u.id===id);
  globalThis.game={user:users[0],actors:{get:findActor,find:fn=>actorList.find(fn)},
    users:{get:findUser,filter:fn=>users.filter(fn)},scenes:{get:id=>scenes.get(id)},
    socket:{on:(key,fn)=>sockets.set(key,fn),emit:(key,msg)=>emitted.push(msg)}};
  globalThis.Hooks={on:(name,fn)=>hooks.set(name,fn),off:()=>{}};
  globalThis.ui={notifications:{info:m=>notifications.push({type:'info',message:m}),warn:m=>notifications.push({type:'warn',message:m})}};
  globalThis.canvas={ready:false,scene:outside,tokens:{controlled:[]}};
  globalThis.Scene={async create(data){const inner=scene('inside',{interior:true});inner.flags=data.flags;scenes.set(inner.id,inner);return inner;}};
  return {outside,scenes,colony,users,notifications,viewed,emitted,sockets,building};
}
test('v1.3: GM entrance moves active token, returning moves the same survivor back',async()=>{
  const world=setup();
  await enterRoom('colony','building');
  assert.deepEqual(world.viewed,['inside']);
  assert.equal(world.outside.tokens.length,0);
  const interior=world.scenes.get('inside');
  assert.equal(interior.tokens.length,1);assert.equal(interior.tokens[0].actorId,'survivor');
  assert.equal(world.colony.system.industry.placements[0].interiorSceneId,'inside');
  await exitRoom();
  assert.deepEqual(world.viewed,['inside','outside']);
  assert.equal(interior.tokens.length,0);assert.equal(world.outside.tokens.length,1);
});
test('v1.3: a player sends a GM-authorized travel request rather than editing scenes',async()=>{
  const world=setup();
  // Create the room while GM is active, then reset token on the outer map.
  await enterRoom('colony','building');
  await exitRoom();
  world.viewed.length=0;
  globalThis.game.user=world.users[1];
  globalThis.canvas.scene=world.outside;
  await enterRoom('colony','building');
  assert.equal(world.emitted.length,1);
  assert.equal(world.emitted[0].kind,'genesis-room-travel');
  assert.equal(world.emitted[0].tokenId,world.outside.tokens[0].id);
  assert.equal(world.outside.tokens.length,1); // GM has not accepted it yet
});
test('v1.3: socket handler ignores forged sender and moves the player token on legitimate request',async()=>{
  const world=setup();
  initializeBuildingInteractions();
  const callback=world.sockets.get(`system.${SYS}`);
  const request={kind:'genesis-room-travel',id:'abcdefghijklmnop',userId:'player',
    colonyId:'colony',placementId:'building',tokenId:'first',direction:'enter'};
  callback(request,'attacker');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(world.emitted.length,0);assert.equal(world.outside.tokens.length,1);
  callback(request,'player');
  // Resolve the serialized world-lock promise after its effects complete.
  for(let i=0;i<12&&world.emitted.length===0;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(world.emitted.length,1);
  assert.equal(world.emitted[0].ok,true);
  assert.equal(world.outside.tokens.length,0);
  assert.equal(world.scenes.get('inside').tokens.length,1);
});
test('v1.3: socket GM refuses transferring another player’s token',async()=>{
  const world=setup();
  initializeBuildingInteractions();
  const req={kind:'genesis-room-travel',id:'differentrequest01',userId:'gm',colonyId:'colony',
    placementId:'building',direction:'enter',tokenId:'first'};
  // GM is allowed. An unrelated online non-GM sender is not.
  world.users.push({id:'outsider',isGM:false,active:true});
  globalThis.game.user=world.users[0];
  req.userId='outsider';
  const handler=world.sockets.get(`system.${SYS}`);
  handler(req,'outsider');
  for(let i=0;i<12&&world.emitted.length===0;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(world.emitted.length,1);
  assert.equal(world.emitted[0].ok,false);
  assert.match(world.emitted[0].message,/прав/);
  assert.equal(world.outside.tokens.length,1);
});

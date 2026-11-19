import test from 'node:test';
import assert from 'node:assert/strict';
import {requestNetwork,getNetworkSimulation,stationOperational,networkContext,initializeNetworks} from '../module/networks.mjs';
import {networkCost} from '../module/network-rules.mjs';
const clone=structuredClone;
let serial=0;
function setup({copper=30,alloy=15,colonyError='',sceneError='',nonGM=false}={}){
  const gm={id:'gm',active:true,isGM:true,name:'GM'};
  const player={id:'player',active:true,isGM:false,name:'Техник'};
  const messages=[],responses=[],socketHandlers=new Map();
  const items=[['copper',copper],['alloy',alloy]].map(([code,quantity])=>({id:`item-${code}`,name:code,
    type:'material',img:'icons/svg/item-bag.svg',system:{quantity,unitMass:1,unitVolume:1,
    resourceCode:code,quality:0,techTier:0,description:'',containerId:''}}));
  items.get=id=>items.find(x=>x.id===id);
  const placements=[
    {id:'gen',colonyId:'base',buildingId:'powerLab',sceneId:'scene',tileId:'genTile',jobId:'j1',x:0,y:100,width:300,height:300,status:'finished',createdDay:1,by:'GM'},
    {id:'lab',colonyId:'base',buildingId:'electronicsLab',sceneId:'scene',tileId:'labTile',jobId:'j2',x:600,y:100,width:300,height:300,status:'finished',createdDay:1,by:'GM'},
    {id:'pump',colonyId:'base',buildingId:'water-recycler',sceneId:'scene',tileId:'pumpTile',jobId:'j3',x:600,y:500,width:300,height:300,status:'finished',createdDay:1,by:'GM'}];
  const tiles=placements.map(p=>({id:p.tileId,x:p.x,y:p.y,width:p.width,height:p.height,rotation:0,
    flags:{'project-genesis':{colonyId:'base',buildingId:p.buildingId,jobId:p.jobId,placementId:p.id,status:'finished'}},
    toObject(){return clone({x:this.x,y:this.y,width:this.width,height:this.height,flags:this.flags,texture:{src:'old'},_id:this.id});}}));
  tiles.get=id=>tiles.find(t=>t.id===id);
  const scene={id:'scene',name:'Поселение',grid:{size:100,type:1},dimensions:{sceneRect:{x:0,y:0,width:1200,height:1000}},tiles,
    async createEmbeddedDocuments(kind,rows){assert.equal(kind,'Tile');
      if(sceneError==='create'){sceneError='';throw Error('cannot create');}
      const created=rows.map(r=>({...clone(r),id:r._id||`tile${++serial}`,
        toObject(){return clone({...r,_id:this.id});}}));tiles.push(...created);return created;},
    async deleteEmbeddedDocuments(kind,ids){assert.equal(kind,'Tile');
      if(sceneError==='delete'){sceneError='';throw Error('cannot delete');}
      for(const id of ids){const n=tiles.findIndex(t=>t.id===id);if(n>=0)tiles.splice(n,1);}}
  };
  const colony={id:'base',type:'colony',name:'Base',system:{industry:{placements,buildings:[{id:'powerLab',count:1},{id:'electronicsLab',count:1},{id:'water-recycler',count:1}]},infrastructure:{links:[],processed:[]},science:{unlocked:[],facilities:[]}},items,
    async update(patch){if(colonyError){const msg=colonyError;colonyError='';throw Error(msg);}
      for(const [key,value] of Object.entries(patch)){const parts=key.split('.');let at=this;
        for(const part of parts.slice(0,-1))at=at[part];at[parts.at(-1)]=clone(value);}},
    async updateEmbeddedDocuments(kind,updates){assert.equal(kind,'Item');
      for(const row of updates){const item=items.get(row._id);assert.ok(item);item.system.quantity=row['system.quantity'];}}
  };
  const survivor={type:'survivor',testUserPermission:()=>true};
  const actors=[colony,survivor],users=[gm,player];
  globalThis.game={user:nonGM?player:gm,
    users:Object.assign(users,{get:id=>users.find(u=>u.id===id)}),
    actors:{get:id=>id===colony.id?colony:null,some:fn=>actors.some(fn),find:fn=>actors.find(fn)},
    scenes:{get:id=>id===scene.id?scene:null},
    socket:{emit:(_channel,message)=>responses.push(message),on:(channel,fn)=>socketHandlers.set(channel,fn)},settings:{get:()=>1}};
  globalThis.ui={notifications:{info:x=>messages.push({ok:true,x}),error:x=>messages.push({ok:false,x})}};
  return {colony,scene,items,tiles,messages,gm,player,responses,socketHandlers};
}
const run=(action,details={})=>requestNetwork({action,colonyId:'base',...details});
const connect=(type='power',fromId='gen',toId='lab')=>run('connect',{type,fromId,toId});
test('GM creates a power line, consumes resources and activates mapped electronics laboratory',async()=>{
  const s=setup();assert.equal(stationOperational(s.colony,'electronicsLab'),false);
  await connect();
  assert.equal(s.messages.at(-1).ok,true,s.messages.at(-1).x);
  assert.equal(s.colony.system.infrastructure.links.length,1);
  const l=s.colony.system.infrastructure.links[0];
  assert.ok(l.route.length>0);
  assert.equal(l.tileIds.length,l.route.length);
  assert.equal(s.items.get('item-copper').system.quantity,30-networkCost('power',l.route.length).copper);
  assert.equal(getNetworkSimulation(s.colony).statuses[l.id],'ok');
  assert.equal(stationOperational(s.colony,'electronicsLab'),true);
  assert.equal(networkContext(s.colony,s.gm).links.length,1);
});
test('duplicate connection refused without extra resource cost',async()=>{
  const s=setup();await connect();const copper=s.items.get('item-copper').system.quantity;
  await connect();assert.equal(s.messages.at(-1).ok,false);
  assert.equal(s.colony.system.infrastructure.links.length,1);
  assert.equal(s.items.get('item-copper').system.quantity,copper);
});
test('failed scene write does not debit anything',async()=>{
  const s=setup({sceneError:'create'});await connect();
  assert.equal(s.messages.at(-1).ok,false);
  assert.equal(s.colony.system.infrastructure.links.length,0);
  assert.equal(s.items.get('item-copper').system.quantity,30);
  assert.equal(s.tiles.length,3);
});
test('failed colony update rolls back material and deletes generated tiles',async()=>{
  const s=setup({colonyError:'cannot save colony'});await connect();
  assert.equal(s.messages.at(-1).ok,false);
  assert.equal(s.colony.system.infrastructure.links.length,0);
  assert.equal(s.items.get('item-copper').system.quantity,30);
  assert.equal(s.tiles.length,3);
});
test('missing copper rejects line with no scene changes',async()=>{
  const s=setup({copper:0});await connect();
  assert.equal(s.messages.at(-1).ok,false);
  assert.equal(s.tiles.length,3);
});
test('create a pipe, it does not power electronics laboratory',async()=>{
  const s=setup();await connect('water');
  assert.equal(s.messages.at(-1).ok,true);
  assert.equal(s.items.get('item-copper').system.quantity,30);
  assert.ok(s.items.get('item-alloy').system.quantity<15);
  assert.equal(stationOperational(s.colony,'electronicsLab'),false);
});
test('missing tile makes link invalid and GM can restore without resource cost',async()=>{
  const s=setup();await connect();const l=s.colony.system.infrastructure.links[0];
  const missing=l.tileIds[0],before=s.items.get('item-copper').system.quantity;
  await s.scene.deleteEmbeddedDocuments('Tile',[missing]);
  assert.equal(getNetworkSimulation(s.colony).statuses[l.id],'missing-tile');
  assert.equal(stationOperational(s.colony,'electronicsLab'),false);
  await run('repair',{linkId:l.id});
  assert.equal(s.messages.at(-1).ok,true,s.messages.at(-1).x);
  assert.equal(s.colony.system.infrastructure.links[0].tileIds.length,l.tileIds.length);
  assert.equal(getNetworkSimulation(s.colony).statuses[l.id],'ok');
  assert.equal(s.items.get('item-copper').system.quantity,before);
});
test('GM can demolish an intact cable but does not get a refund',async()=>{
  const s=setup();await connect();const l=s.colony.system.infrastructure.links[0];
  const remaining=s.items.get('item-copper').system.quantity;
  await run('disconnect',{linkId:l.id});
  assert.equal(s.messages.at(-1).ok,true);
  assert.equal(s.colony.system.infrastructure.links.length,0);
  assert.equal(s.tiles.length,3);
  assert.equal(s.items.get('item-copper').system.quantity,remaining);
});
test('manual moving of cable is detected and prevents demolition',async()=>{
  const s=setup();await connect();const l=s.colony.system.infrastructure.links[0];
  s.scene.tiles.get(l.tileIds[0]).y+=100;
  assert.equal(getNetworkSimulation(s.colony).statuses[l.id],'moved-tile');
  await run('disconnect',{linkId:l.id});
  assert.equal(s.messages.at(-1).ok,false);
  assert.equal(s.colony.system.infrastructure.links.length,1);
});
test('construction site cannot be connected before completing the build',async()=>{
  const s=setup();s.colony.system.industry.placements[1].status='construction';
  await connect();assert.equal(s.messages.at(-1).ok,false);
  assert.equal(s.colony.system.infrastructure.links.length,0);
});
test('nonGM without a socket does not commit locally; reserved GM actions stay GM-only',async()=>{
  const s=setup();await connect();const l=s.colony.system.infrastructure.links[0];
  game.users.get('player').isGM=false;
  // Send a non-GM request: it is handled over the socket instead of modifying the local colony.
  game.user=s.player;
  await run('disconnect',{linkId:l.id});
  assert.equal(s.colony.system.infrastructure.links.length,1);
});

test('GM commits a hand-drawn route after validating resource costs',async()=>{
  const s=setup();
  const route=[{x:300,y:100},{x:400,y:100},{x:500,y:100}];
  await run('connect',{type:'power',fromId:'gen',toId:'lab',route});
  assert.equal(s.messages.at(-1).ok,true,s.messages.at(-1).x);
  assert.deepEqual(s.colony.system.infrastructure.links[0].route,route);
  assert.equal(s.items.get('item-copper').system.quantity,30-1);
});
test('malformed manual route is rejected by the GM without changing inventory',async()=>{
  const s=setup();
  await run('connect',{type:'power',fromId:'gen',toId:'lab',route:[{x:300,y:100},{x:500,y:100}]});
  assert.equal(s.messages.at(-1).ok,false);
  assert.equal(s.colony.system.infrastructure.links.length,0);
  assert.equal(s.items.get('item-copper').system.quantity,30);
});
test('survivor can reprioritize buildings, without creating extra NPC workers',async()=>{
  const s=setup();
  await run('priority',{placementId:'lab',priority:0});
  assert.equal(s.messages.at(-1).ok,true,s.messages.at(-1).x);
  assert.deepEqual(s.colony.system.infrastructure.priorities,[{id:'lab',priority:0}]);
  const current=networkContext(s.colony,s.gm).buildings.find(b=>b.id==='lab');
  assert.equal(current.priority,0);
  assert.equal(current.priorityOptions.filter(x=>x.selected).length,1);
});
test('invalid priority cannot alter persistent data',async()=>{
  const s=setup();await run('priority',{placementId:'lab',priority:11});
  assert.equal(s.messages.at(-1).ok,false);
  assert.equal(s.colony.system.infrastructure.priorities?.length||0,0);
});
test('repair by expedition member consumes materials and restores line',async()=>{
  const s=setup();await connect();const link=s.colony.system.infrastructure.links[0];
  const before=s.items.get('item-copper').system.quantity;
  await s.scene.deleteEmbeddedDocuments('Tile',[link.tileIds[0]]);
  await run('maintain',{linkId:link.id});
  assert.equal(s.messages.at(-1).ok,true,s.messages.at(-1).x);
  assert.equal(s.items.get('item-copper').system.quantity,before-1);
  assert.equal(getNetworkSimulation(s.colony).statuses[link.id],'ok');
});
test('failed maintenance rolls back scene and materials',async()=>{
  const s=setup();await connect();const link=s.colony.system.infrastructure.links[0];
  await s.scene.deleteEmbeddedDocuments('Tile',[link.tileIds[0]]);
  const before=s.items.get('item-copper').system.quantity;
  s.colony.update=async()=>{throw Error('no save');};
  await run('maintain',{linkId:link.id});
  assert.equal(s.messages.at(-1).ok,false);
  assert.equal(s.items.get('item-copper').system.quantity,before);
  assert.equal(getNetworkSimulation(s.colony).statuses[link.id],'missing-tile');
});
test('missing replacement material prevents repair without creating extra tiles',async()=>{
  const s=setup();await connect();const link=s.colony.system.infrastructure.links[0];
  await s.scene.deleteEmbeddedDocuments('Tile',[link.tileIds[0]]);
  s.items.get('item-copper').system.quantity=0;
  const count=s.tiles.length;
  await run('maintain',{linkId:link.id});
  assert.equal(s.messages.at(-1).ok,false);
  assert.equal(s.tiles.length,count);
});

// v1.3.4 — GM-only free network construction and persisted provenance.
test('GM power cable with zero copper saves a permanent free-build marker',async()=>{
  const s=setup({copper:0,alloy:0});
  await run('gm-connect',{type:'power',fromId:'gen',toId:'lab'});
  assert.equal(s.messages.at(-1).ok,true,s.messages.at(-1).x);
  assert.equal(s.colony.system.infrastructure.links.length,1);
  const link=s.colony.system.infrastructure.links[0];
  assert.equal(link.gmFree,true);
  assert.ok(link.tileIds.every(id=>s.scene.tiles.get(id).flags['project-genesis'].gmFree===true));
  assert.equal(s.items.get('item-copper').system.quantity,0);
  assert.equal(getNetworkSimulation(s.colony).statuses[link.id],'ok');
  assert.equal(networkContext(s.colony,s.gm).links[0].gmFree,true);
});
test('GM can lay free water pipe manually with no alloys',async()=>{
  const s=setup({copper:0,alloy:0});
  const route=[{x:300,y:100},{x:400,y:100},{x:500,y:100}];
  await run('gm-connect',{type:'water',fromId:'gen',toId:'lab',route});
  assert.equal(s.messages.at(-1).ok,true,s.messages.at(-1).x);
  assert.deepEqual(s.colony.system.infrastructure.links[0].route,route);
  assert.equal(s.colony.system.infrastructure.links[0].gmFree,true);
  assert.equal(s.items.get('item-alloy').system.quantity,0);
});
test('ordinary networks stay paid and are never marked GM-built',async()=>{
  const s=setup();await connect('water');
  assert.equal(s.colony.system.infrastructure.links[0].gmFree,false);
  assert.ok(s.items.get('item-alloy').system.quantity<15);
});
test('free GM cable creation rolls back all tiles if saving colony fails',async()=>{
  const s=setup({copper:0,colonyError:'cannot save'});
  await run('gm-connect',{type:'power',fromId:'gen',toId:'lab'});
  assert.equal(s.messages.at(-1).ok,false);
  assert.equal(s.tiles.length,3);
  assert.equal(s.colony.system.infrastructure.links.length,0);
  assert.equal(s.items.get('item-copper').system.quantity,0);
});
test('manual free GM line still refuses a malformed route without modifications',async()=>{
  const s=setup({copper:0});
  await run('gm-connect',{type:'power',fromId:'gen',toId:'lab',route:[{x:300,y:100},{x:500,y:100}]});
  assert.equal(s.messages.at(-1).ok,false);
  assert.equal(s.tiles.length,3);
});
test('authenticated non-GM socket request cannot forge free engineering works',async()=>{
  const s=setup({copper:0});
  initializeNetworks();
  const request={kind:'genesis-network-request',id:'1234567890AB',userId:s.player.id,
    colonyId:'base',action:'gm-connect',type:'power',fromId:'gen',toId:'lab'};
  s.socketHandlers.get('system.project-genesis')(request,s.player.id);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(s.responses.length,1);
  assert.equal(s.responses[0].ok,false);
  assert.match(s.responses[0].message,/только ведущему/);
  assert.equal(s.colony.system.infrastructure.links.length,0);
  assert.equal(s.tiles.length,3);
});
test('socket sender spoof is dropped even if GM id appears in payload',async()=>{
  const s=setup({copper:0});
  initializeNetworks();
  s.socketHandlers.get('system.project-genesis')({kind:'genesis-network-request',
    id:'1234567890AC',userId:s.gm.id,colonyId:'base',action:'gm-connect',
    type:'power',fromId:'gen',toId:'lab'},s.player.id);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(s.responses.length,0);
  assert.equal(s.colony.system.infrastructure.links.length,0);
});

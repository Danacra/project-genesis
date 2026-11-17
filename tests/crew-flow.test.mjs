import test from 'node:test';
import assert from 'node:assert/strict';
import {requestCrew,advanceCrewDay,crewContext,__crewTest} from '../module/crew.mjs';
const clone=structuredClone;
let seq=0;
const makeItem=(info)=>({id:info.id||`item-${++seq}`,name:info.name||info.code||'Материал',
  type:info.type||'material',img:info.img||'icons/svg/item-bag.svg',system:{quantity:info.quantity??1,
    resourceCode:info.code||'',unitMass:info.unitMass??1,unitVolume:info.unitVolume??1,quality:info.quality||0,
    techTier:0,description:'',containerId:''}});
const withGet=items=>{items.get=id=>items.find(x=>x.id===id);return items;};
function setup({brokenScene=false,colonyFail=false,owned=true,capacityMass=2500,wood=0}={}){
  const gm={id:'gm',name:'Ведущий',isGM:true,active:true};
  const user={id:'survivor-user',name:'Игрок',isGM:false,active:true};
  const messages=[];
  const placements=[
    {id:'store',colonyId:'colony',buildingId:'storehouse',sceneId:'map',tileId:'tile-store',jobId:'storejob',x:500,y:100,width:300,height:300,status:'finished',createdDay:1,by:'GM'},
    {id:'bench',colonyId:'colony',buildingId:'bench',sceneId:'map',tileId:'tile-bench',jobId:'benchjob',x:900,y:100,width:200,height:200,status:'finished',createdDay:1,by:'GM'}];
  const tiles=withGet(placements.map(p=>({id:p.tileId,x:p.x,y:p.y,width:p.width,height:p.height,rotation:0,
    flags:{'project-genesis':{buildingId:p.buildingId,placementId:p.id,jobId:p.jobId,colonyId:p.colonyId,status:'finished'}},
    toObject(){return clone({...this,_id:this.id,toObject:undefined});}})));
  const tokens=[{actorId:'surv',x:100,y:100,width:1,height:1}];
  const scene={id:'map',name:'Карта колонии',grid:{size:100,type:1},dimensions:{sceneRect:{x:0,y:0,width:2000,height:1600}},tiles,tokens,
    async createEmbeddedDocuments(type,rows,options={}){assert.equal(type,'Tile');if(brokenScene)throw Error('Failed scene create');
      const added=rows.map(r=>({...clone(r),id:options.keepId&&r._id?r._id:`tile-${++seq}`,
        toObject(){return clone({...r,_id:this.id});}}));tiles.push(...added);return added;},
    async deleteEmbeddedDocuments(type,ids){assert.equal(type,'Tile');for(const id of ids){const at=tiles.findIndex(x=>x.id===id);if(at>=0)tiles.splice(at,1);}}
  };
  const crew={nodes:[],caches:[],jobs:[],history:[],processed:[]};
  const cItems=withGet([]),aItems=withGet(wood?[makeItem({code:'wood',name:'Древесина',quantity:wood,unitMass:2,unitVolume:4})]:[]);
  const persist=async(arr,type,change)=>{assert.equal(type,'Item');const made=arr.map(row=>makeItem({name:row.name,code:row.system.resourceCode,
    type:row.type,quantity:row.system.quantity,unitMass:row.system.unitMass,unitVolume:row.system.unitVolume}));change.push(...made);return made;};
  const attached=(items)=>({
    async updateEmbeddedDocuments(type,updates){assert.equal(type,'Item');for(const u of updates){const t=items.get(u._id);assert.ok(t,'missing stack');t.system.quantity=u['system.quantity'];}},
    async createEmbeddedDocuments(type,rows){return persist(rows,type,items);},
    async deleteEmbeddedDocuments(type,ids){assert.equal(type,'Item');for(const id of ids){const i=items.findIndex(t=>t.id===id);if(i>=0)items.splice(i,1);}}
  });
  const colony={id:'colony',name:'Новая Земля',type:'colony',items:cItems,
    system:{capacity:{mass:capacityMass,volume:10000},science:{unlocked:[]},industry:{placements,buildings:[{id:'storehouse',count:1}],jobs:[],construction:[]},crew},
    async update(updates){if(colonyFail){colonyFail=false;throw Error('Failed colony update');}
      for(const [path,value] of Object.entries(updates)){const keys=path.split('.');let here=this;
        for(const key of keys.slice(0,-1))here=here[key];here[keys.at(-1)]=clone(value);}}
    ,...attached(cItems)};
  const actor={id:'surv',name:'Выживший',type:'survivor',items:aItems,
    system:{abilities:{strength:3},skills:{survival:2,engineering:2},survival:{fatigue:0}},
    testUserPermission:(_user,level)=>owned&&level==='OWNER',...attached(aItems)};
  const actors=[colony,actor],users=[gm,user];
  let currentDay=1;
  globalThis.game={user:gm,users:{filter:fn=>users.filter(fn),get:id=>users.find(u=>u.id===id)},
    actors:{get:id=>actors.find(a=>a.id===id),filter:fn=>actors.filter(fn),find:fn=>actors.find(fn),some:fn=>actors.some(fn)},
    scenes:{get:id=>id===scene.id?scene:null},settings:{get:()=>currentDay},socket:{emit(){}}};
  globalThis.ui={notifications:{info:t=>messages.push({ok:true,text:t}),error:t=>messages.push({ok:false,text:t})}};
  const run=(action,details={})=>requestCrew({action,colonyId:colony.id,...details});
  return {gm,user,actor,colony,scene,placements,tiles,tokens,messages,run,
    setDay(v){currentDay=v;},failure(){colonyFail=true;},setActorAt(x,y){tokens[0].x=x;tokens[0].y=y;},
    addSurvivor(id,wood=0,name='Другой выживший'){
      const items=withGet(wood?[makeItem({code:'wood',name:'Древесина',quantity:wood,unitMass:2,unitVolume:4})]:[]);
      const other={...actor,id,name,items,...attached(items)};
      actors.push(other);tokens.push({actorId:id,x:100,y:100,width:1,height:1});return other;
    }};
}
async function seed(s,type='wood',amount=6){await s.run('create-node',{resourceCode:type,sceneId:'map',x:100,y:100,amount});
  assert.equal(s.messages.at(-1).ok,true,s.messages.at(-1).text);return s.colony.system.crew.nodes[0];}
async function harvest(s,node,amount=2){await s.run('start-harvest',{actorId:'surv',nodeId:node.id,amount});}
const job=s=>s.colony.system.crew.jobs[0];
test('GM creates a visible finite resource deposit and can diagnose it',async()=>{
  const s=setup(),n=await seed(s);
  assert.equal(s.tiles.length,3);assert.equal(n.remaining,6);
  assert.equal(s.tiles.get(n.tileId).flags['project-genesis'].resourceCode,'wood');
  assert.equal(crewContext(s.colony,s.gm).nodes[0].health,'ok');
});
test('invalid or overlapping node placement is rejected without extra tiles',async()=>{
  const s=setup();await seed(s);await s.run('create-node',{resourceCode:'ore',sceneId:'map',x:100,y:100,amount:30});
  assert.equal(s.messages.at(-1).ok,false);assert.equal(s.tiles.length,3);
});
test('failed scene creation does not write a deposit into colony',async()=>{
  const s=setup({brokenScene:true});await s.run('create-node',{resourceCode:'stone',sceneId:'map',x:100,y:100,amount:5});
  assert.equal(s.messages.at(-1).ok,false);assert.equal(s.colony.system.crew.nodes.length,0);
});
test('failed colony commit deletes a tentative deposit tile',async()=>{
  const s=setup({colonyFail:true});await s.run('create-node',{resourceCode:'wood',sceneId:'map',x:100,y:100,amount:6});
  assert.equal(s.messages.at(-1).ok,false);assert.equal(s.tiles.length,2);
});
test('harvest: reserve finite stock, wait days, claim into survivor inventory',async()=>{
  const s=setup(),n=await seed(s);
  await harvest(s,n);assert.equal(s.messages.at(-1).ok,true,s.messages.at(-1).text);
  assert.equal(s.colony.system.crew.nodes[0].remaining,4);
  await s.run('finish',{jobId:job(s).id});assert.equal(s.messages.at(-1).ok,false);
  await advanceCrewDay(s.colony);
  await s.run('finish',{jobId:job(s).id});assert.equal(s.messages.at(-1).ok,true,s.messages.at(-1).text);
  assert.equal(s.actor.items.find(i=>i.system.resourceCode==='wood').system.quantity,2);
  assert.equal(s.colony.system.crew.jobs.length,0);
});
test('cancel harvest refunds reserved deposit stock, never doubles it',async()=>{
  const s=setup(),n=await seed(s);await harvest(s,n,2);
  await s.run('cancel',{jobId:job(s).id});assert.equal(s.colony.system.crew.nodes[0].remaining,6);
  assert.equal(s.colony.system.crew.jobs.length,0);
});
test('cannot harvest without a nearby character token or beyond load limit',async()=>{
  const s=setup(),n=await seed(s,'wood',15);
  s.setActorAt(1400,900);await harvest(s,n);assert.equal(s.messages.at(-1).ok,false);
  s.setActorAt(100,100);await harvest(s,n,10);assert.equal(s.messages.at(-1).ok,false); // 40 litres > 30 litre capacity
});
test('finish claim remains pending when survivor inventory is full',async()=>{
  const s=setup(),n=await seed(s);await harvest(s,n,2);await advanceCrewDay(s.colony);
  s.actor.items.push(makeItem({code:'stone',quantity:30,unitMass:3,unitVolume:3}));
  await s.run('finish',{jobId:job(s).id});assert.equal(s.messages.at(-1).ok,false);
  assert.equal(s.colony.system.crew.jobs.length,1);
  s.actor.items.pop();await s.run('finish',{jobId:job(s).id});assert.equal(s.messages.at(-1).ok,true);
});
test('delivery transfers actor cargo to the mapped central warehouse after transport time',async()=>{
  const s=setup({wood:5});await s.run('start-delivery',{actorId:'surv',itemId:s.actor.items[0].id,placementId:'store',amount:3});
  assert.equal(s.messages.at(-1).ok,true,s.messages.at(-1).text);
  assert.equal(s.actor.items[0].system.quantity,2);
  await advanceCrewDay(s.colony);await s.run('finish',{jobId:job(s).id});
  assert.equal(s.messages.at(-1).ok,true,s.messages.at(-1).text);
  assert.equal(s.colony.items.find(i=>i.system.resourceCode==='wood').system.quantity,3);
  assert.equal(s.colony.system.crew.jobs.length,0);
});
test('warehouse capacity is checked at dispatch, before debiting a survivor',async()=>{
  const s=setup({wood:4,capacityMass:0});s.colony.system.industry.buildings=[];
  await s.run('start-delivery',{actorId:'surv',itemId:s.actor.items[0].id,placementId:'store',amount:2});
  assert.equal(s.messages.at(-1).ok,false);
  assert.equal(s.colony.system.crew.jobs.length,0);
  assert.equal(s.actor.items[0].system.quantity,4);
});
test('failed job state save rolls back debit from a character item stack',async()=>{
  const s=setup({wood:3});s.failure();await s.run('start-delivery',{actorId:'surv',itemId:s.actor.items[0].id,placementId:'store',amount:2});
  assert.equal(s.messages.at(-1).ok,false);assert.equal(s.actor.items[0].system.quantity,3);
  assert.equal(s.colony.system.crew.jobs.length,0);
});
test('cancel delivery restores original inventory without creating phantom cargo',async()=>{
  const s=setup({wood:4});await s.run('start-delivery',{actorId:'surv',itemId:s.actor.items[0].id,placementId:'store',amount:3});
  await s.run('cancel',{jobId:job(s).id});assert.equal(s.actor.items[0].system.quantity,4);
  assert.equal(s.colony.system.crew.jobs.length,0);
});
test('delivery to a non-storage building is locally cached, shipped to storage later',async()=>{
  const s=setup({wood:4});await s.run('start-delivery',{actorId:'surv',itemId:s.actor.items[0].id,placementId:'bench',amount:3});
  await advanceCrewDay(s.colony);await s.run('finish',{jobId:job(s).id});
  assert.equal(s.colony.system.crew.caches[0].stock[0].quantity,3);
  assert.equal(s.colony.items.length,0);
  s.setActorAt(900,100);
  await s.run('start-ship',{actorId:'surv',sourceId:'bench',placementId:'store',resourceCode:'wood',amount:2});
  assert.equal(s.colony.system.crew.caches[0].stock[0].quantity,1);
  await advanceCrewDay(s.colony);
  await s.run('finish',{jobId:job(s).id});
  assert.equal(s.messages.at(-1).ok,true,s.messages.at(-1).text);
  assert.equal(s.colony.items.find(i=>i.system.resourceCode==='wood').system.quantity,2);
});
test('pickup takes stock from one building and delivers it to survivor, not colony',async()=>{
  const s=setup({wood:3});await s.run('start-delivery',{actorId:'surv',itemId:s.actor.items[0].id,placementId:'bench',amount:2});
  await advanceCrewDay(s.colony);await s.run('finish',{jobId:job(s).id});
  s.setActorAt(900,100);
  await s.run('start-pickup',{actorId:'surv',sourceId:'bench',resourceCode:'wood',amount:1});
  await advanceCrewDay(s.colony);await s.run('finish',{jobId:job(s).id});
  assert.equal(s.messages.at(-1).ok,true,s.messages.at(-1).text);
  assert.equal(s.actor.items.find(i=>i.system.resourceCode==='wood').system.quantity,2);
  assert.equal(s.colony.system.crew.caches[0].stock[0].quantity,1);
});
test('GM rejects forged assignment to a survivor the requester does not own',async()=>{
  const s=setup({owned:false}),node=await seed(s);
  await assert.rejects(()=>__crewTest.perform({
    id:'TEST_UNAUTHORIZED_CREW_001',userId:s.user.id,colonyId:s.colony.id,
    action:'start-harvest',actorId:'surv',nodeId:node.id,amount:1
  }),/чужим персонажем/);
  assert.equal(s.colony.system.crew.jobs.length,0);
  assert.equal(s.colony.system.crew.nodes[0].remaining,6);
});
test('replayed operation identifier cannot credit cargo a second time',async()=>{
  const s=setup();
  const payload={id:'TEST_REPLAY_IDENTIFIER_01',userId:s.gm.id,colonyId:s.colony.id,
    action:'create-node',resourceCode:'wood',sceneId:'map',x:100,y:100,amount:9};
  await __crewTest.perform(payload);
  const before=s.tiles.length;
  await __crewTest.perform(payload);
  assert.equal(s.tiles.length,before);assert.equal(s.colony.system.crew.nodes.length,1);
});

test('colony write failure after warehouse credit rolls back newly created items',async()=>{
  const s=setup({wood:4});await s.run('start-delivery',{actorId:'surv',itemId:s.actor.items[0].id,placementId:'store',amount:3});
  await advanceCrewDay(s.colony);s.failure();await s.run('finish',{jobId:job(s).id});
  assert.equal(s.messages.at(-1).ok,false);
  assert.equal(s.colony.system.crew.jobs.length,1);
  assert.equal(s.colony.items.find(i=>i.system.resourceCode==='wood'),undefined);
  await s.run('finish',{jobId:job(s).id});
  assert.equal(s.messages.at(-1).ok,true);
  assert.equal(s.colony.items.find(i=>i.system.resourceCode==='wood')?.system.quantity,3);
});
test('cancel an in-transit cache shipment restores the exact source cache',async()=>{
  const s=setup({wood:4});await s.run('start-delivery',{actorId:'surv',itemId:s.actor.items[0].id,placementId:'bench',amount:3});
  await advanceCrewDay(s.colony);await s.run('finish',{jobId:job(s).id});
  s.setActorAt(900,100);
  await s.run('start-ship',{actorId:'surv',sourceId:'bench',placementId:'store',resourceCode:'wood',amount:2});
  assert.equal(s.colony.system.crew.caches[0].stock[0].quantity,1);
  await s.run('cancel',{jobId:job(s).id});
  assert.equal(s.messages.at(-1).ok,true);
  assert.equal(s.colony.system.crew.caches[0].stock[0].quantity,3);
  assert.equal(s.colony.system.crew.jobs.length,0);
});
test('NPC type cannot start mining even when the user owns it',async()=>{
  const s=setup(),n=await seed(s);s.actor.type='npc';
  await harvest(s,n);assert.equal(s.messages.at(-1).ok,false);
  assert.equal(s.colony.system.crew.nodes[0].remaining,6);
});

test('0.8.1: two deliveries cannot reserve more volume than a mapped workshop holds',async()=>{
  const s=setup({wood:40});
  const other=s.addSurvivor('surv2',40);
  await s.run('start-delivery',{actorId:'surv',itemId:s.actor.items[0].id,placementId:'bench',amount:40});
  assert.equal(s.messages.at(-1).ok,true,s.messages.at(-1).text);
  await s.run('start-delivery',{actorId:'surv2',itemId:other.items[0].id,placementId:'bench',amount:40});
  assert.equal(s.messages.at(-1).ok,false,s.messages.at(-1).text);
  assert.match(s.messages.at(-1).text,/недостаточно места/);
  assert.equal(other.items[0].system.quantity,40);
  assert.equal(s.colony.system.crew.jobs.length,1);
});

test('0.8.1: warehouse reservations include all in-transit shipments',async()=>{
  const s=setup({wood:3,capacityMass:10});
  s.colony.system.industry.buildings=[];
  const other=s.addSurvivor('surv2',3);
  await s.run('start-delivery',{actorId:'surv',itemId:s.actor.items[0].id,placementId:'store',amount:3});
  assert.equal(s.messages.at(-1).ok,true,s.messages.at(-1).text);
  await s.run('start-delivery',{actorId:'surv2',itemId:other.items[0].id,placementId:'store',amount:3});
  assert.equal(s.messages.at(-1).ok,false,s.messages.at(-1).text);
  assert.match(s.messages.at(-1).text,/переполнится/);
  assert.equal(other.items[0].system.quantity,3);
});

test('0.8.1: deleted empty deposit restored with original Tile ID if colony write fails',async()=>{
  const s=setup(),n=await seed(s,'wood',2);
  await harvest(s,n,2);await advanceCrewDay(s.colony);
  await s.run('finish',{jobId:job(s).id});
  assert.equal(s.colony.system.crew.nodes[0].remaining,0);
  s.failure();await s.run('remove-empty',{nodeId:n.id});
  assert.equal(s.messages.at(-1).ok,false);
  assert.ok(s.tiles.get(n.tileId),'original Tile ID should be restored');
  assert.equal(crewContext(s.colony,s.gm).nodes[0].health,'ok');
  await s.run('remove-empty',{nodeId:n.id});
  assert.equal(s.messages.at(-1).ok,true,s.messages.at(-1).text);
  assert.equal(s.colony.system.crew.nodes.length,0);
});

test('0.8.1: daily labor progress cannot be double-booked on a retried day',async()=>{
  const s=setup(),n=await seed(s,'ore',10);
  await harvest(s,n,4);const old=job(s).remaining;
  await advanceCrewDay(s.colony);const afterFirst=job(s).remaining;
  assert.equal(afterFirst,old-1);
  await advanceCrewDay(s.colony);
  assert.equal(job(s).remaining,afterFirst);
  s.setDay(2);await advanceCrewDay(s.colony);
  assert.equal(job(s).remaining,Math.max(0,afterFirst-1));
});

test('0.8.1: two survivors sharing a displayed name are tracked by actor ID',async()=>{
  const s=setup(),n=await seed(s);
  s.addSurvivor('surv2',0,s.actor.name);
  await harvest(s,n);
  const byId=new Map(crewContext(s.colony,s.gm).survivors.map(x=>[x.id,x.busy]));
  assert.equal(byId.get('surv'),true);
  assert.equal(byId.get('surv2'),false);
});

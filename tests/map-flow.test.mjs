import test from 'node:test';
import assert from 'node:assert/strict';
import {requestIndustry,advanceIndustryDay,industryContext} from '../module/industry.mjs';
const clone=structuredClone;
let counter=0;
function setup({materials=[['wood',15],['stone',10],['scrap',6]],tech=['stone-tools','basic-workshop'],
    sceneType=1,tiles=[],sceneFailure='',colonyFailure='',userIsGM=true,built=[]}={}){
  const gm={id:'gm',name:'Ведущий',isGM:true,active:true};
  const player={id:'user',name:'Игрок',isGM:false,active:true};
  const messages=[];
  const items=materials.map(([code,quantity])=>({id:`resource${++counter}`,name:code,img:'icons/svg/item-bag.svg',type:'material',
    system:{quantity,resourceCode:code,unitMass:1,unitVolume:1,quality:0,techTier:0,description:'',containerId:''}}));
  Object.defineProperty(items,'get',{value:id=>items.find(i=>i.id===id)});
  const journal={jobs:[],construction:[],buildings:clone(built),placements:[],processed:[],history:[]};
  const colony={id:'colony',name:'Base',type:'colony',
    system:{industry:journal,capacity:{mass:2500,volume:10000},science:{unlocked:tech,facilities:[],points:0}},items,
    async update(patch){
      if(colonyFailure){const msg=colonyFailure;colonyFailure='';throw new Error(msg);}
      for(const [key,value] of Object.entries(patch)){
        const path=key.split('.');let target=this;
        for(const part of path.slice(0,-1))target=target[part];
        target[path.at(-1)]=clone(value);
      }
    },
    async updateEmbeddedDocuments(kind,updates){assert.equal(kind,'Item');for(const upd of updates){
      const item=items.get(upd._id);assert.ok(item);
      for(const [key,value] of Object.entries(upd))if(key!=='_id')item.system[key.slice(7)]=value;
    }},
    async createEmbeddedDocuments(kind,entries){assert.equal(kind,'Item');
      const rows=entries.map(e=>({...clone(e),id:`new${++counter}`}));items.push(...rows);return rows;},
    async deleteEmbeddedDocuments(kind,ids){assert.equal(kind,'Item');for(const id of ids){
      const pos=items.findIndex(i=>i.id===id);if(pos>=0)items.splice(pos,1);
    }}
  };
  const sceneTiles=tiles.map(t=>clone(t));
  Object.defineProperty(sceneTiles,'get',{value:id=>sceneTiles.find(t=>t.id===id)});
  const scene={id:'scene1',name:'Поселение',grid:{size:100,type:sceneType},width:1600,height:1200,
    dimensions:{sceneRect:{x:0,y:0,width:1600,height:1200}},tiles:sceneTiles,
    async createEmbeddedDocuments(kind,entries){assert.equal(kind,'Tile');if(sceneFailure==='create'){sceneFailure='';throw Error('cannot create tile');}
      const created=entries.map(e=>({...clone(e),id:e._id||`tile${++counter}`,
        toObject(){return {...clone(e),_id:this.id};}}));sceneTiles.push(...created);return created;},
    async updateEmbeddedDocuments(kind,updates){assert.equal(kind,'Tile');if(sceneFailure==='update'){sceneFailure='';throw Error('cannot update tile');}
      for(const upd of updates){const tile=sceneTiles.get(upd._id);assert.ok(tile);
        for(const [key,value]of Object.entries(upd))if(key==='texture.src')tile.texture.src=value;
        else if(key==='flags.project-genesis.status')tile.flags['project-genesis'].status=value;
      }},
    async deleteEmbeddedDocuments(kind,ids){assert.equal(kind,'Tile');if(sceneFailure==='delete'){sceneFailure='';throw Error('cannot remove tile');}
      for(const id of ids){const index=sceneTiles.findIndex(t=>t.id===id);if(index>=0)sceneTiles.splice(index,1);}}
  };
  const explorer={id:'surv',type:'survivor',testUserPermission:()=>true};
  const actorList=[colony,explorer],users=[gm,player];
  let currentDay=1;
  globalThis.game={user:userIsGM?gm:player,users:Object.assign(users,{get:id=>users.find(u=>u.id===id)}),
    actors:{get:id=>actorList.find(a=>a.id===id),filter:fn=>actorList.filter(fn),some:fn=>actorList.some(fn),find:fn=>actorList.find(fn)},
    scenes:{get:id=>id===scene.id?scene:null},settings:{get:(id,key)=>key==='worldDay'?currentDay:0},socket:{emit:()=>{}}};
  globalThis.ui={notifications:{info:message=>messages.push({ok:true,message}),error:message=>messages.push({ok:false,message})}};
  return {colony,scene,items,messages,setDay:n=>currentDay=n,gm,player};
}
const run=async(action,options={})=>requestIndustry({action,colonyId:'colony',...options});
const place=(options={})=>run('start-building',{subject:'bench',sceneId:'scene1',x:100,y:100,...options});
test('start-building on map places a tile, debits materials and stores link',async()=>{
  const s=setup();await place();
  assert.equal(s.colony.system.industry.construction.length,1);
  assert.equal(s.colony.system.industry.placements.length,1);
  const p=s.colony.system.industry.placements[0];
  assert.equal(s.scene.tiles.get(p.tileId)?.flags['project-genesis'].jobId,p.jobId);
  assert.equal(s.scene.tiles.get(p.tileId)?.width,200);
  assert.equal(s.items.find(i=>i.system.resourceCode==='wood').system.quantity,12);
  assert.equal(s.messages.at(-1).ok,true);
});
test('same space rejected, other map coordinates accepted without losing resources',async()=>{
  const s=setup({materials:[['wood',30],['stone',30],['scrap',2]],tech:['stone-tools','basic-workshop']});
  await place();const before=s.items.find(i=>i.system.resourceCode==='wood').system.quantity;
  await run('start-building',{subject:'storehouse',sceneId:'scene1',x:200,y:200});
  assert.equal(s.messages.at(-1).ok,false);
  assert.equal(s.items.find(i=>i.system.resourceCode==='wood').system.quantity,before);
  await run('start-building',{subject:'storehouse',sceneId:'scene1',x:600,y:200});
  assert.equal(s.colony.system.industry.placements.length,2);
});
test('reject unknown scene, out of bounds, unsnapped, hex and failed tile creation',async()=>{
  for(const payload of [{sceneId:'nonsense'}, {x:1500,y:1100}, {x:110}, {sceneType:2}, {sceneFailure:'create'}]){
    const s=setup({sceneType:payload.sceneType||1,sceneFailure:payload.sceneFailure||''});
    await place(payload);assert.equal(s.messages.at(-1).ok,false,JSON.stringify(payload));
    assert.equal(s.colony.system.industry.construction.length,0);
    assert.equal(s.scene.tiles.length,0);
    assert.equal(s.items.find(i=>i.system.resourceCode==='wood').system.quantity,15);
  }
});
test('rollback tile creation and inventory on failed Colony save',async()=>{
  const s=setup({colonyFailure:'cannot save actor'});await place();
  assert.equal(s.messages.at(-1).ok,false);
  assert.equal(s.scene.tiles.length,0);assert.equal(s.colony.system.industry.construction.length,0);
  assert.equal(s.items.find(i=>i.system.resourceCode==='wood').system.quantity,15);
});
test('day advancement and completion change tile and activate technology facility',async()=>{
  const s=setup();await place();const job=s.colony.system.industry.construction[0];
  await run('complete-building',{jobId:job.id});assert.equal(s.messages.at(-1).ok,false);
  await advanceIndustryDay(s.colony);
  await run('complete-building',{jobId:job.id});
  assert.equal(s.scene.tiles.length,1);
  assert.match(s.scene.tiles[0].texture.src,/bench\.svg$/);
  assert.equal(s.scene.tiles[0].flags['project-genesis'].status,'finished');
  assert.equal(s.colony.system.industry.placements[0].status,'finished');
  assert.equal(s.colony.system.industry.buildings[0].count,1);
  assert.deepEqual(s.colony.system.science.facilities,['bench']);
});
test('completion restores tile if updating the colony fails',async()=>{
  const s=setup();await place();await advanceIndustryDay(s.colony);
  // Inject update failure only after tile changes.
  s.colony.update=async()=>{throw Error('actor unavailable');};
  await run('complete-building',{jobId:s.colony.system.industry.construction[0].id});
  assert.equal(s.messages.at(-1).ok,false);
  assert.match(s.scene.tiles[0].texture.src,/construction-site\.svg$/);
  assert.equal(s.colony.system.industry.construction.length,1);
});
test('canceling a map construction removes tile and returns stock',async()=>{
  const s=setup();await place();const job=s.colony.system.industry.construction[0];
  await run('cancel',{jobId:job.id,queue:'construction'});
  assert.equal(s.messages.at(-1).ok,true);
  assert.equal(s.scene.tiles.length,0);
  assert.equal(s.colony.system.industry.placements.length,0);
  assert.equal(s.colony.system.industry.construction.length,0);
  assert.equal(s.items.find(i=>i.system.resourceCode==='wood').system.quantity,15);
});
test('cancel refuses to refund if scene cannot remove construction tile',async()=>{
  const s=setup();await place();const job=s.colony.system.industry.construction[0];
  s.scene.deleteEmbeddedDocuments=async()=>{throw Error('tile locked by permission');};
  await run('cancel',{jobId:job.id,queue:'construction'});
  assert.equal(s.messages.at(-1).ok,false);
  assert.equal(s.items.find(i=>i.system.resourceCode==='wood').system.quantity,12);
});
test('deleting linked tile blocks completion to avoid invisible finished building',async()=>{
  const s=setup();await place();await advanceIndustryDay(s.colony);
  s.scene.tiles.splice(0,1);
  await run('complete-building',{jobId:s.colony.system.industry.construction[0].id});
  assert.equal(s.messages.at(-1).ok,false);
  assert.equal(s.colony.system.industry.construction.length,1);
});
test('GM-only legacy start of unplaced building stays compatible with 0.5 saves',async()=>{
  const s=setup();await run('start-building',{subject:'bench'});
  assert.equal(s.messages.at(-1).ok,true);
  assert.equal(s.colony.system.industry.placements.length,0);
  assert.equal(s.colony.system.industry.construction.length,1);
  await advanceIndustryDay(s.colony);
  await run('complete-building',{jobId:s.colony.system.industry.construction[0].id});
  assert.equal(s.messages.at(-1).ok,true);
});
test('construction UI context includes map location and names',async()=>{
  const s=setup();await place();
  const view=industryContext(s.colony,game.user);
  assert.equal(view.placements.length,1);
  assert.equal(view.construction[0].mapped,true);
  assert.equal(view.construction[0].sceneName,'Поселение');
});

test('existing v0.5 building can be added to map exactly once at no resource cost',async()=>{
  const s=setup({built:[{id:'bench',count:1,builtDay:1,lastClaimDay:0}],materials:[]});
  await run('place-existing',{subject:'bench',sceneId:'scene1',x:500,y:200});
  assert.equal(s.messages.at(-1).ok,true);
  assert.equal(s.colony.system.industry.buildings[0].count,1);
  assert.equal(s.colony.system.industry.placements.length,1);
  assert.match(s.scene.tiles[0].texture.src,/bench\.svg$/);
  assert.equal(s.scene.tiles[0].flags['project-genesis'].status,'finished');
  await run('place-existing',{subject:'bench',sceneId:'scene1',x:900,y:200});
  assert.equal(s.messages.at(-1).ok,false);
  assert.equal(s.scene.tiles.length,1);
});
test('GM can map each pre-0.6 built module once, without duplicating stock',async()=>{
  const s=setup({built:[{id:'storehouse',count:2,builtDay:1,lastClaimDay:0}],materials:[]});
  await run('place-existing',{subject:'storehouse',sceneId:'scene1',x:100,y:100});
  await run('place-existing',{subject:'storehouse',sceneId:'scene1',x:500,y:100});
  assert.equal(s.colony.system.industry.placements.length,2);
  assert.equal(s.scene.tiles.length,2);
  const catalog=industryContext(s.colony,game.user);
  assert.equal(catalog.buildings.find(b=>b.id==='storehouse').canPlaceLegacy,false);
});

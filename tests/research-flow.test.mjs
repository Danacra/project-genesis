import test from 'node:test';
import assert from 'node:assert/strict';
import { requestResearch } from '../module/research.mjs';
const clone=x=>structuredClone(x);
let counter=0;
function fakeGame({points=0,stock=[],failColonyUpdate=false}={}) {
 const gm={id:'testGM',name:'Ведущий',isGM:true,active:true},messages=[],chats=[];
 let count=0;
 const survivor={id:'surv',name:'Геолог',type:'survivor',system:{abilities:{intellect:3},skills:{science:2}},testUserPermission:()=>true};
 const science={points,tier:0,unlocked:[],facilities:[],projects:[],dailyWork:[],discoveries:[]};
 const items={_all:stock.map(([code,quantity])=>({id:'it'+counter++,type:'material',name:code,system:{resourceCode:code,quantity}})),
  [Symbol.iterator](){return this._all.values();},find(fn){return this._all.find(fn)},filter(fn){return this._all.filter(fn)}};
 const colony={id:'col',name:'Место крушения',type:'colony',system:{science},items,
   async update(changes){if(failColonyUpdate && Object.keys(changes).some(x=>x==='system.science.unlocked'))throw Error('data write failed');
     for(const [key,value] of Object.entries(changes)) {
       if(key.startsWith('system.science.'))science[key.slice('system.science.'.length)]=clone(value);
     }
   },
   async updateEmbeddedDocuments(_type,updates){for(const c of updates) {
     const item=items._all.find(i=>i.id===c._id);if(!item)throw Error('Item absent');item.system.quantity=c['system.quantity'];
   }}
 };
 const all=[survivor,colony];
 globalThis.game={user:gm,users:Object.assign([gm],{get(id){return id===gm.id?gm:null},filter(fn){return [gm].filter(fn)}}),
  actors:{get(id){return all.find(a=>a.id===id)},find(fn){return all.find(fn)},filter(fn){return all.filter(fn)},some(fn){return all.some(fn)}},
  settings:{get(_system,key){return key==='worldDay'?3:null}},socket:{emit(){}}};
 globalThis.ui={notifications:{info:m=>messages.push({kind:'info',m}),error:m=>messages.push({kind:'error',m})}};
 globalThis.ChatMessage={getSpeaker:()=>({}),create:async entry=>chats.push(entry)};
 globalThis.Roll=class {constructor(){this.total=18;}async evaluate(){return this;}async toMessage({flavor}){chats.push({flavor})}};
 return {science,colony,survivor,messages,chats};
}
test('GM grant, research, invest and discover via actual game request entrypoint',async()=>{
 const x=fakeGame();
 await requestResearch({action:'grant',colonyId:'col',amount:3});
 assert.equal(x.science.points,3);
 await requestResearch({action:'work',colonyId:'col',actorId:'surv',techId:'survey-landing'});
 assert.equal(x.science.points,6);assert.equal(x.science.dailyWork.length,1);
 await requestResearch({action:'invest',colonyId:'col',techId:'survey-landing',amount:2});
 assert.deepEqual(x.science.unlocked,['survey-landing']);assert.equal(x.science.points,4);
 assert.ok(x.chats.some(c=>c.content?.includes('Научное открытие')));
});
test('scientist cannot gain more RP twice in the same in-game day',async()=>{
 const x=fakeGame();
 await requestResearch({action:'work',colonyId:'col',actorId:'surv',techId:'survey-landing'});
 await requestResearch({action:'work',colonyId:'col',actorId:'surv',techId:'survey-landing'});
 assert.equal(x.science.dailyWork.length,1);
 assert.equal(x.messages.at(-1).kind,'error');
});
test('a research that needs materials waits for supply, then consumes it on completion',async()=>{
 const x=fakeGame({points:30,stock:[['wood',2]]});
 // Compatibility: a world created before v1.1 already has the legacy parent researched.
 x.science.unlocked=['survey'];
 await requestResearch({action:'invest',colonyId:'col',techId:'shelter',amount:5});
 assert.deepEqual(x.science.unlocked,['survey']);assert.equal(x.science.projects[0].invested,5);
 x.colony.items._all.push({id:'f1',type:'material',name:'Fiber',system:{resourceCode:'fiber',quantity:2}});
 await requestResearch({action:'complete',colonyId:'col',techId:'shelter'});
 assert.deepEqual(x.science.unlocked,['survey','shelter']);
 assert.equal(x.colony.items._all.find(i=>i.id==='f1').system.quantity,0);
 assert.equal(x.colony.items._all.find(i=>i.system.resourceCode==='wood').system.quantity,0);
});
test('material rollback on research save failure',async()=>{
 const x=fakeGame({points:20,stock:[['wood',2],['fiber',2]],failColonyUpdate:true});
 // prepare the science for a funded project outside update to trigger save failure at completion
 x.science.unlocked=['survey'];x.science.projects=[{id:'shelter',invested:5}];
 await requestResearch({action:'complete',colonyId:'col',techId:'shelter'});
 assert.equal(x.colony.items._all[0].system.quantity,2);
 assert.equal(x.colony.items._all[1].system.quantity,2);
 assert.deepEqual(x.science.unlocked,['survey']);
 assert.equal(x.messages.at(-1).kind,'error');
});
test('GM infrastructure toggles and blocks non-ready invest for laboratory tech',async()=>{
 const x=fakeGame({points:30});
 x.science.unlocked=['survey','shelter','stone-tools'];
 await requestResearch({action:'invest',colonyId:'col',techId:'basic-workshop',amount:2});
 assert.equal(x.science.points,30);
 await requestResearch({action:'facility',colonyId:'col',facilityId:'bench'});
 await requestResearch({action:'invest',colonyId:'col',techId:'basic-workshop',amount:2});
 assert.equal(x.science.points,28);
 assert.deepEqual(x.science.facilities,['bench']);
});

test('GM can complete all ten nested studies via actual request endpoint and auto-unlock survey',async()=>{
 const {FIELD_STUDIES}=await import('../module/tech-data.mjs');
 const x=fakeGame({points:100});
 for(const tech of FIELD_STUDIES){
   await requestResearch({action:'invest',colonyId:'col',techId:tech.id,amount:tech.rp});
   assert.equal(x.messages.at(-1).kind,'info',`Expected ${tech.id} to succeed`);
   assert.ok(x.science.unlocked.includes(tech.id));
 }
 assert.equal(x.science.unlocked.length,11);
 assert.equal(x.science.unlocked.at(-1),'survey');
 assert.equal(x.science.discoveries.at(-1).techId,'survey');
 assert.ok(x.chats.some(x=>x.content?.includes('Экспедиционный отчёт')));
});

test('GM cannot bypass nested program by funding the survey parent directly',async()=>{
 const x=fakeGame({points:100});
 for(const action of ['invest','complete','work']){
   await requestResearch({action,colonyId:'col',techId:'survey',amount:4,actorId:'surv'});
   assert.equal(x.messages.at(-1).kind,'error');
 }
 assert.equal(x.science.points,100);
 assert.equal(x.science.unlocked.length,0);
});

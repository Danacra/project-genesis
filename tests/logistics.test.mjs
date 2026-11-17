import test from 'node:test';
import assert from 'node:assert/strict';
import {requestTransfer} from '../module/logistics.mjs';
let counter=0;
const clone=x=>structuredClone(x);
function actor(id,items=[],type='survivor',failCreate=false){
  return {id,name:id,type,system:{abilities:{strength:4},capacity:{mass:1000,volume:1000}},
    items:{
      _all:items,
      get(itemId){return this._all.find(x=>x.id===itemId)},
      filter(fn){return this._all.filter(fn)},find(fn){return this._all.find(fn)},[Symbol.iterator](){return this._all.values()}
    },
    testUserPermission(){return true},
    async updateEmbeddedDocuments(_,updates){for(const change of updates){const item=this.items.get(change._id);if(!item)throw Error('missing');for(const [k,v] of Object.entries(change)){if(k.startsWith('system.'))item.system[k.slice(7)]=v;}}},
    async createEmbeddedDocuments(_,entries){if(failCreate)throw Error('destination failed');for(const source of entries){this.items._all.push({id:`new${counter++}`,...clone(source),system:{...source.system,toObject(){return {...source.system}}}})}},
    async deleteEmbeddedDocuments(_,ids){this.items._all=this.items._all.filter(i=>!ids.includes(i.id));}
  };
}
function stack(id,q,m=1,v=1,containerId='') {const system={quantity:q,unitMass:m,unitVolume:v,containerId,quality:0,resourceCode:'iron',toObject(){return {quantity:this.quantity,unitMass:this.unitMass,unitVolume:this.unitVolume,containerId:this.containerId,quality:this.quality,resourceCode:this.resourceCode}}};return {id,type:'material',name:'Iron',img:'icons/svg/item-bag.svg',system};}
function setup(source,dest) {
  const ledger={entries:[],processed:[]},msgs=[];
  const user={id:'gm',name:'GM',isGM:true,active:true};
  globalThis.game={user,users:Object.assign([user],{get:id=>id==='gm'?user:null}),
    actors:{get(id){return id===source.id?source:dest},find(fn){return [source,dest].find(fn)},filter(fn){return [source,dest].filter(fn)}},
    settings:{get(ns,key){return key==='worldDay'?1:ledger},async set(ns,key,value){Object.assign(ledger,value)}},socket:{emit(){}}};
  globalThis.ui={notifications:{info:m=>msgs.push(m),error:m=>msgs.push(m)}};
  return {ledger,msgs};
}
test('GM transfer moves stack, reduces source, records journal', async()=>{
  const a=actor('A',[stack('i',4)]),b=actor('B',[]);
  const {ledger,msgs}=setup(a,b);
  await requestTransfer({sourceActorId:'A',targetActorId:'B',itemId:'i',targetContainerId:'',quantity:2});
  assert.equal(a.items.get('i').system.quantity,2);
  assert.equal(b.items._all[0].system.quantity,2);
  assert.equal(ledger.entries.length,1);
  assert.match(msgs.at(-1),/Iron/);
});
test('GM transfer rejects overweight destination',async()=>{
  const a=actor('AA',[stack('i',1,500,1)]),b=actor('BB',[]);
  const {msgs}=setup(a,b);
  await requestTransfer({sourceActorId:'AA',targetActorId:'BB',itemId:'i',quantity:1});
  assert.equal(a.items.get('i').system.quantity,1);
  assert.equal(b.items._all.length,0);
  assert.match(msgs.at(-1),/Не хватает/);
});
test('failure to create destination rolls back source',async()=>{
  const a=actor('AAA',[stack('i',3)]),b=actor('BBB',[],'survivor',true);
  const {msgs}=setup(a,b);
  await requestTransfer({sourceActorId:'AAA',targetActorId:'BBB',itemId:'i',quantity:1});
  assert.equal(a.items.get('i').system.quantity,3);
  assert.match(msgs.at(-1),/destination failed/);
});

test('same-actor partial move into container retains total stock',async()=>{
  const a=actor('OWN',[stack('i',5),{id:'bin',type:'container',name:'Box',system:{tareMass:1,tareVolume:1,capacityMass:15,capacityVolume:15}}]);
  const {ledger}=setup(a,a);
  await requestTransfer({sourceActorId:'OWN',targetActorId:'OWN',itemId:'i',targetContainerId:'bin',quantity:2});
  assert.equal(a.items.get('i').system.quantity,3);
  assert.equal(a.items._all.find(i=>i.system?.containerId==='bin').system.quantity,2);
  assert.equal(ledger.entries.length,1);
});
test('refuses overflowing a matching stack before source debit',async()=>{
  const a=actor('OVER_A',[stack('i',2)]),b=actor('OVER_B',[stack('match',999998)],'colony');
  b.system.capacity={mass:1000001,volume:1000001};
  const {msgs}=setup(a,b);
  await requestTransfer({sourceActorId:'OVER_A',targetActorId:'OVER_B',itemId:'i',quantity:2});
  assert.equal(a.items.get('i').system.quantity,2);
  assert.equal(b.items.get('match').system.quantity,999998);
  assert.match(msgs.at(-1),/999999/);
});

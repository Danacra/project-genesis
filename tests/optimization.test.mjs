import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeInventory,measure,validateMove,stackSignature} from '../module/rules.mjs';
import {planDailyConsumption} from '../module/logistics.mjs';
const item = (id, quantity, unitMass=1, unitVolume=1, containerId='', resourceCode='') => ({
  id,name:'Resource',img:'icons/svg/item-bag.svg',type:'material',
  system:{quantity,unitMass,unitVolume,containerId,resourceCode,quality:0,techTier:0,description:''}
});
const bin = (id) => ({
  id,name:`Bin ${id}`,type:'container',system:{tareMass:1,tareVolume:2,capacityMass:100,capacityVolume:100}
});
const actor = (id,items=[],type='survivor')=>({
  id,type,system:{abilities:{strength:2},capacity:{mass:10000,volume:10000}},
  items:{_data:items,filter(fn){return this._data.filter(fn)},find(fn){return this._data.find(fn)},[Symbol.iterator](){return this._data.values()}}
});

test('many containers have correct indexed contents and totals',()=>{
  const items=[];
  for(let i=0;i<250;i++){
    items.push(bin(`bin${i}`));
    items.push(item(`i${i}`,3,0.5,1,`bin${i}`));
  }
  const data=summarizeInventory(items);
  assert.equal(data.containers.size,250);
  assert.equal(data.byContainer.size,251); // 250 inventories, and bins occupy the main bay
  assert.deepEqual(data.load,{mass:625,volume:1250});
  assert.deepEqual(data.byContainer.get('bin170'),{mass:1.5,volume:3});
  assert.equal(data.totalItems,750);
});

test('small unit weights add up without rounding away the load',()=>{
  const items=Array.from({length:100},(_,i)=>item(`i${i}`,1,0.004,0.004));
  assert.deepEqual(measure(items),{mass:0.4,volume:0.4});
  const src=actor('source',[item('carry',1,0.004,0.004)]);
  const dst=actor('target',items,'colony');
  dst.system.capacity={mass:0.4,volume:0.4};
  assert.throws(()=>validateMove({source:src,target:dst,item:src.items._data[0],quantity:1}),/Не хватает/);
});

test('container capacity uses exact total, not display-rounded total',()=>{
  const src=actor('source',[item('a',1,0.004,0.004)]);
  const targetItems=[bin('box'),item('b',1,0.004,0.004,'box')];
  targetItems[0].system.capacityMass=0.005;
  targetItems[0].system.capacityVolume=0.005;
  const dst=actor('dst',targetItems);
  assert.throws(()=>validateMove({source:src,target:dst,item:src.items._data[0],quantity:1,containerId:'box'}),/переполнен/);
});

test('stacks with different technologies, descriptions or images never merge',()=>{
  const a=item('a',2), b=item('b',5);
  assert.equal(stackSignature(a),stackSignature(b));
  b.system.techTier=3;
  assert.notEqual(stackSignature(a),stackSignature(b));
  b.system.techTier=0;b.system.description='Different grade';
  assert.notEqual(stackSignature(a),stackSignature(b));
  b.system.description='';b.img='icons/svg/stone.svg';
  assert.notEqual(stackSignature(a),stackSignature(b));
  b.img=a.img;b.system.unitMass=1.000001;
  assert.notEqual(stackSignature(a),stackSignature(b));
});

test('daily supplies: personal first, colony second, no partial water depletion',()=>{
  const survivor=actor('hero',[item('food-personal',1,1,1,'','food'),item('water-personal',1,1,1,'','water')]);
  const colony=actor('colony',[item('food-base',4,1,1,'','food')],'colony');
  const result=planDailyConsumption(survivor,colony);
  assert.equal(result.fed,true);
  assert.equal(result.hydrated,false);
  const updates=result.changes.get(survivor);
  assert.deepEqual(updates.map(x=>[x.id,x.after]),[['food-personal',0]]);
  assert.equal(result.changes.has(colony),false);
});

test('daily supplies batch both resource updates on the same actor',()=>{
  const survivor=actor('hero',[item('food-personal',3,1,1,'','food'),item('water-personal',4,1,1,'','water')]);
  const colony=actor('colony',[],'colony');
  const result=planDailyConsumption(survivor,colony);
  assert.equal(result.fed,true);
  assert.equal(result.hydrated,true);
  assert.equal(result.changes.size,1);
  assert.deepEqual(result.changes.get(survivor).map(x=>[x.id,x.before,x.after]),
    [['food-personal',3,2],['water-personal',4,2]]);
});

test('daily supplies can split a resource between personal and colony inventories',()=>{
  const survivor=actor('hero',[item('water-personal',1,1,1,'','water')]);
  const colony=actor('colony',[item('water-base',2,1,1,'','water')],'colony');
  const result=planDailyConsumption(survivor,colony);
  assert.equal(result.fed,false);
  assert.equal(result.hydrated,true);
  assert.deepEqual(result.changes.get(survivor).map(x=>x.after),[0]);
  assert.deepEqual(result.changes.get(colony).map(x=>x.after),[1]);
});

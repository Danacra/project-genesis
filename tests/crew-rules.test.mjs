import test from 'node:test';
import assert from 'node:assert/strict';
import {RESOURCE_NODES,cartBonus,carryCapacity,laborDays,journeyDays,changeStock,validateCache,
  snapNode,nodeHealth,nearby,setStock,stockFor,formatCargo} from '../module/crew-rules.mjs';
const item=(code,quantity,mass=1,volume=1,type='material')=>({name:code,type,img:'',system:{resourceCode:code,quantity,unitMass:mass,unitVolume:volume,quality:0,techTier:0,description:''}});
const survivor=(items=[])=>({id:'s',type:'survivor',system:{abilities:{strength:2},skills:{survival:2,engineering:1}},items});
const scene=()=>({id:'planet',grid:{size:100,type:1},dimensions:{sceneRect:{x:0,y:0,width:2000,height:1600}},tiles:[],tokens:[{actorId:'s',x:100,y:100,width:1,height:1}]});
test('eleven finite deposit classes with positive bounded mass and volume',()=>{
  assert.equal(Object.keys(RESOURCE_NODES).length,15);
  for(const def of Object.values(RESOURCE_NODES))assert.ok(def.limit>=1&&def.mass>0&&def.volume>0);
});
test('basic carrying obeys original capacity; cart expands it and accelerates delivery',()=>{
  const actor=survivor();assert.deepEqual(carryCapacity(actor),{mass:20,volume:25});
  actor.items.push(item('handcart',1,8,20,'tool'));
  assert.deepEqual(carryCapacity(actor),{mass:70,volume:125});
  assert.equal(cartBonus(actor).factor,2);
  const from={x:100,y:100},to={x:1800,y:700},load={unitMass:3,quantity:8};
  const withCart=journeyDays(scene(),from,to,actor,load);actor.items.length=0;
  assert.ok(journeyDays(scene(),from,to,actor,load)>withCart);
});
test('labor time respects worker skill and quantity',()=>{
  const s=survivor();assert.equal(laborDays(s,'wood',3),1);
  assert.ok(laborDays(s,'ore',8)>laborDays(s,'wood',3));
  assert.throws(()=>laborDays(s,'wood',0),/объём/);
});
test('cache aggregation and overflow prevent material duplication',()=>{
  const p={buildingId:'bench',status:'finished'},cargo={code:'stone',name:'Stone',type:'material',quantity:50,unitMass:2,unitVolume:1};
  assert.equal(validateCache([],cargo,p),true);
  const added=changeStock([],cargo,1);assert.equal(added[0].quantity,50);
  assert.throws(()=>changeStock(added,{...cargo,quantity:51},-1),/недостаточно/);
  assert.throws(()=>validateCache(added,{...cargo,quantity:100},p),/недостаточно места/);
  assert.deepEqual(changeStock(added,{...cargo,quantity:50},-1),[]);
});
test('site stock is scoped by exact building placement',()=>{
  const s={caches:[]},cargo={code:'ore',name:'Ore',type:'material',quantity:3,unitMass:2,unitVolume:1};
  const a=setStock(s,'a',changeStock([],cargo));
  assert.equal(stockFor({caches:a},'a')[0].quantity,3);
  assert.deepEqual(stockFor({caches:a},'b'),[]);
  assert.deepEqual(setStock({caches:a},'a',[]),[]);
});
test('resource nodes snap exactly and do not overlap constructions or cables',()=>{
  const s=scene();assert.deepEqual(snapNode(s,{x:105,y:112}),{x:100,y:100,width:100,height:100});
  s.tiles.push({x:100,y:100,width:100,height:100,flags:{'project-genesis':{buildingId:'bench'}}});
  assert.throws(()=>snapNode(s,{x:105,y:112}),/здание/);
  s.tiles.length=0;s.tiles.push({x:100,y:100,width:100,height:100,flags:{'project-genesis':{networkId:'n'}}});
  assert.throws(()=>snapNode(s,{x:105,y:112}),/сеть/);
  assert.throws(()=>snapNode(s,{x:2050,y:0}),/пределы/);
});
test('resource node tampering is diagnosed from scene geometry and tile flags',()=>{
  const s=scene(),n={id:'node',colonyId:'base',sceneId:'planet',tileId:'tile',x:100,y:100};
  assert.equal(nodeHealth(n,s),'missing-tile');
  const t={id:'tile',x:100,y:100,width:100,height:100,flags:{'project-genesis':{resourceNodeId:'node',colonyId:'base'}}};
  s.tiles.push(t);s.tiles.get=id=>s.tiles.find(t=>t.id===id);
  assert.equal(nodeHealth(n,s),'ok');t.x+=100;assert.equal(nodeHealth(n,s),'moved-tile');
});
test('only survivor token close to source can work at a node',()=>{
  const s=scene(),a=survivor();
  assert.ok(nearby(s,a,{x:150,y:150}));
  assert.throws(()=>nearby(s,a,{x:1800,y:1400}),/слишком далеко/);
  s.tokens.length=0;assert.throws(()=>nearby(s,a,{x:150,y:150}),/токен/);
});
test('cargo item retains quality and provenance fields',()=>{
  const input=item('ore',9,3,2);input.system.quality=4;input.system.description='снимок скважины';
  const cargo=formatCargo(input,3);assert.equal(cargo.quality,4);assert.equal(cargo.description,'снимок скважины');
  assert.throws(()=>formatCargo(input,10),/Неверный груз/);
});

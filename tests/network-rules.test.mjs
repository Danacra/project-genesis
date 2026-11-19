import test from 'node:test';
import assert from 'node:assert/strict';
import {NETWORK_TYPES,DEVICES,routeNetwork,networkCost,validateNetworkLink,asNetworkTiles,simulateNetworks,NETWORK_LIMITS,validateManualRoute,appendManualStep,snapNetworkCell} from '../module/network-rules.mjs';
const p=(id,buildingId,x,y,width,height,sceneId='s')=>({id,buildingId,colonyId:'c',sceneId,jobId:id,status:'finished',x,y,width,height});
const scene=(width=1200,height=800,tiles=[])=>({id:'s',grid:{type:1,size:100},dimensions:{sceneRect:{x:0,y:0,width,height}},tiles});
const link=(id,type,fromId,toId)=>({id,type,fromId,toId,sceneId:'s'});
test('14 building definitions have nonnegative loads and a production source for both networks',()=>{
  assert.equal(Object.keys(DEVICES).length,14);
  assert.ok(DEVICES.powerLab.powerOut>0&&DEVICES['water-recycler'].waterOut>0);
  assert.equal(Object.keys(NETWORK_TYPES).length,2);
});
test('cable and pipe unit costs scale with route length',()=>{
  assert.deepEqual(networkCost('power',1),{copper:1});
  assert.deepEqual(networkCost('power',7),{copper:3});
  assert.deepEqual(networkCost('water',6),{alloy:2});
  assert.throws(()=>networkCost('power',101));
  assert.throws(()=>networkCost('steam',2));
});
test('routing finds shortest grid path with a path around a blocking building',()=>{
  const ps=[p('gen','powerLab',0,100,200,200),p('target','electronicsLab',700,100,200,200),
    p('block','shelter',400,0,200,500)];
  const path=routeNetwork(scene(),ps,'gen','target');
  assert.ok(path.length>=8&&path.length<=NETWORK_LIMITS.maxRoute);
  assert.ok(path.every(c=>!(c.x>=400&&c.x<600&&c.y>=0&&c.y<500)));
  assert.equal(path[0].x%100,0);
  assert.ok(path.at(-1).x>=600);
});
test('routing rejects blocked ports, disconnected endpoints and impossible limits',()=>{
  const ps=[p('a','bench',0,0,200,200),p('b','powerLab',300,0,300,300)];
  assert.throws(()=>routeNetwork(scene(),ps,'a','a'),/самим собой/);
  assert.throws(()=>routeNetwork(scene(),ps,'missing','b'));
  assert.throws(()=>routeNetwork(scene(),[ps[0],{...ps[1],status:'construction'}],'a','b'));
  assert.throws(()=>routeNetwork(scene(20000,20000),ps,'a','b'),/слишком велика/);
  assert.throws(()=>routeNetwork({...scene(),grid:{size:100,type:2}},ps,'a','b'),/квадратной/);
});
test('network tiles carry stable flags and corruption is detected',()=>{
  const route=[{x:100,y:100},{x:200,y:100}];
  const raw=asNetworkTiles('power',route,{networkId:'link',colonyId:'c',grid:100});
  const ts=raw.map((row,i)=>({...row,id:`t${i}`}));
  ts.get=id=>ts.find(t=>t.id===id);
  const e={id:'link',colonyId:'c',sceneId:'s',type:'power',route,tileIds:['t0','t1']};
  assert.equal(validateNetworkLink(e,scene(1200,800,ts)),'ok');
  ts[0].x=140;assert.equal(validateNetworkLink(e,scene(1200,800,ts)),'moved-tile');
  ts[0].x=100;ts[1].flags['project-genesis'].networkId='someone-else';
  assert.equal(validateNetworkLink(e,scene(1200,800,ts)),'foreign-tile');
  ts.splice(1);assert.equal(validateNetworkLink(e,scene(1200,800,ts)),'missing-tile');
  assert.equal(validateNetworkLink(e,null),'missing-scene');
});
test('connected generator powers critical consumer and unpowered disconnected lab is offline',()=>{
  const ps=[p('gen','powerLab',0,0,300,300),p('lab','electronicsLab',400,0,300,300),
    p('far','flightLab',900,0,300,300)];
  const yes=simulateNetworks(ps,[link('l','power','gen','lab')]);
  assert.equal(yes.byId.lab.powered,true);assert.equal(yes.byId.lab.operational,true);
  assert.equal(yes.byId.far.operational,false);
  assert.equal(yes.totals.power.supply,18);
  assert.equal(yes.totals.power.served,4);
  const no=simulateNetworks(ps,[link('l','power','gen','lab')],{linkStatuses:{l:'invalid'}});
  assert.equal(no.byId.lab.operational,false);
});
test('water source needs power and water network to supply garden',()=>{
  const ps=[p('gen','powerLab',0,0,300,300),p('water','water-recycler',400,0,300,300),p('garden','garden',800,0,400,300)];
  const links=[link('wire','power','gen','water'),link('pipe','water','water','garden')];
  const on=simulateNetworks(ps,links);
  assert.equal(on.byId.water.operational,true);
  assert.equal(on.byId.garden.watered,true);
  assert.equal(on.totals.water.supply,12);
  const off=simulateNetworks(ps,links,{linkStatuses:{wire:'invalid'}});
  assert.equal(off.byId.water.operational,false);
  assert.equal(off.totals.water.supply,0);
  assert.equal(off.byId.garden.watered,false);
  assert.equal(off.byId.garden.operational,true); // Early garden can still be watered manually.
});
test('power overload prioritizes critical water pumping over industrial lab',()=>{
  const ps=[p('gen','powerLab',0,0,300,300),p('pump','water-recycler',400,0,300,300),
    p('lab','electronicsLab',800,0,300,300),p('flight','flightLab',1100,0,300,300),
    p('dock','assembly-dock',1400,0,300,300)];
  const links=[link('a','power','gen','pump'),link('b','power','pump','lab'),link('c','power','lab','flight'),link('d','power','flight','dock')];
  const s=simulateNetworks(ps,links);
  assert.equal(s.byId.pump.powered,true);
  assert.equal(s.byId.lab.powered,true);
  assert.equal(s.byId.flight.powered,true);
  assert.equal(s.byId.dock.powered,false);
  assert.equal(s.totals.power.served,16);
});

// v0.7.1 — manual routing is validated on GM side, not merely in the browser.

test('manual route is adjacent to source and target and may bend freely',()=>{
  const ps=[p('gen','powerLab',0,100,200,200),p('lab','electronicsLab',600,100,200,200)];
  const sc=scene(),route=[{x:200,y:100},{x:300,y:100},{x:400,y:100},{x:500,y:100}];
  assert.deepEqual(validateManualRoute(sc,ps,'gen','lab',route),route);
  let current=[];for(const c of route)current=appendManualStep(sc,ps,'gen',current,c);
  assert.deepEqual(current,route);
  assert.deepEqual(snapNetworkCell(sc,{x:219,y:143}),{x:200,y:100});
});
test('manual routing cannot teleport, repeat or draw outside the scene',()=>{
  const ps=[p('gen','powerLab',0,100,200,200),p('lab','electronicsLab',600,100,200,200)];
  const sc=scene(),route=[{x:200,y:100},{x:300,y:100},{x:400,y:100},{x:500,y:100}];
  assert.throws(()=>validateManualRoute(sc,ps,'gen','lab',[route[0],route[2],route[3]]),/соседних/);
  assert.throws(()=>validateManualRoute(sc,ps,'gen','lab',[route[0],route[0],...route.slice(1)]),/повторно/);
  assert.throws(()=>validateManualRoute(sc,ps,'gen','lab',[{x:700,y:100}]),/пересекает/);
  assert.throws(()=>validateManualRoute(sc,ps,'gen','lab',[{x:201,y:100}]),/сетку/);
  assert.throws(()=>validateManualRoute(sc,ps,'gen','lab',[{x:200,y:100}]),/заканчиваться/);
  assert.throws(()=>appendManualStep(sc,ps,'gen',[],{x:300,y:100}),/Первую клетку/);
  assert.throws(()=>appendManualStep(sc,ps,'gen',[route[0]],route[2]),/рядом/);
  assert.throws(()=>snapNetworkCell(sc,{x:-50,y:50}),/пределами/);
});
test('manual validation cannot cross reserved structures or existing networks',()=>{
  const ps=[p('gen','powerLab',0,100,200,200),p('lab','electronicsLab',600,100,200,200),
    p('block','shelter',400,0,100,300)];
  const sc=scene(),route=[{x:200,y:100},{x:300,y:100},{x:400,y:100},{x:500,y:100}];
  assert.throws(()=>validateManualRoute(sc,ps,'gen','lab',route),/пересекает/);
  const clean=[ps[0],ps[1]],existing=[{sceneId:'s',route:[{x:300,y:100}]}];
  assert.throws(()=>validateManualRoute(sc,clean,'gen','lab',route,{links:existing}),/уже проложенную/);
  assert.throws(()=>appendManualStep(sc,clean,'gen',[route[0]],route[1],{links:existing}),/другой сетью/);
});
test('custom priorities override default load shedding without changing consumption',()=>{
  const ps=[p('gen','powerLab',0,0,300,300),p('pump','water-recycler',400,0,300,300),
    p('flight','flightLab',800,0,300,300),p('dock','assembly-dock',1200,0,300,300)];
  const links=[link('a','power','gen','pump'),link('b','power','pump','flight'),link('c','power','flight','dock')];
  const before=simulateNetworks(ps,links);
  assert.equal(before.byId.pump.powered,true);
  assert.equal(before.byId.dock.powered,false);
  const after=simulateNetworks(ps,links,{priorities:{dock:0,pump:9,flight:8}});
  assert.equal(after.byId.dock.powered,true);
  assert.equal(after.byId.pump.powered,false);
  assert.equal(after.totals.power.demand,before.totals.power.demand);
  assert.equal(after.totals.power.served,18);
});

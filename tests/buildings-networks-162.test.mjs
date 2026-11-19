import test from 'node:test';
import assert from 'node:assert/strict';
import {tierNumber,buildingCells,utilityProfile,chainMembers,chainUpgradePlan,linkCapacity} from '../module/tier-rules-162.mjs';
import {allocateUtility} from '../module/utility-flow-162.mjs';
import {readFileSync} from 'node:fs';

test('1.6.2: footprints grow by 1 grid cell on each axis for each tier',()=>{
  assert.deepEqual(buildingCells([3,2],1),[3,2]);
  assert.deepEqual(buildingCells([3,2],2),[4,3]);
  assert.deepEqual(buildingCells([3,2],3),[5,4]);
  assert.equal(tierNumber(undefined),1);
});
test('1.6.2: electricity consumption and generator production scale with building tier',()=>{
  const devices={shelter:{power:2,water:2,optionalPower:true,optionalWater:true},powerLab:{powerOut:18}};
  assert.equal(utilityProfile('shelter',1,devices).power,2);
  assert.equal(utilityProfile('shelter',2,devices).power,4);
  assert.equal(utilityProfile('shelter',3,devices).power,6);
  assert.equal(utilityProfile('shelter',1,devices).optionalPower,true);
  assert.equal(utilityProfile('shelter',2,devices).optionalPower,false);
  assert.equal(utilityProfile('powerLab',3,devices).powerOut,36);
});
const segments=(id,from,to,tier=1,sceneId='out',type='power',cells=3)=>({id,fromId:from,toId:to,tier,sceneId,type,route:Array.from({length:cells},(_,i)=>({x:i,y:0}))});
test('1.6.2: chain upgrade includes only connected links of the same scene and type',()=>{
  const links=[segments('a','G','B'),segments('b','B','C'),segments('c','Q','R'),segments('d','B','D',1,'out','water'),segments('e','B','E',1,'other')];
  assert.deepEqual(chainMembers(links,'b').map(l=>l.id),['a','b']);
  const plan=chainUpgradePlan(links,'a');
  assert.deepEqual(plan.inputs,{wire_bundle:2,iron_ingot:2});
  assert.equal(plan.next,2);
  assert.equal(plan.segments,6);
});
test('1.6.2: mixed network tiers are never downgraded',()=>{
  const links=[segments('a','G','B',2),segments('b','B','C',1)];
  const plan=chainUpgradePlan(links,'a');
  assert.equal(plan.next,2);
  assert.deepEqual(plan.need.map(l=>l.id),['b']);
  assert.equal(plan.segments,3);
  assert.equal(chainUpgradePlan([segments('a','G','B',2)],'a').next,3);
  assert.throws(()=>chainUpgradePlan([segments('a','G','B',3)],'a'),/III/);
});
test('1.6.2: each power wire and water line has tier-specific capacity',()=>{
  assert.equal(linkCapacity('power'),24);assert.equal(linkCapacity('power',2),48);assert.equal(linkCapacity('power',3),96);
  assert.equal(linkCapacity('water'),18);assert.equal(linkCapacity('water',2),36);assert.equal(linkCapacity('water',3),72);
});
test('1.6.2: no power appears without a valid generator connection',()=>{
  const nodes=[{id:'a',priority:0,power:0,powerOut:18,water:0,waterOut:0,powered:false},
    {id:'b',priority:1,power:5,powerOut:0,water:0,waterOut:0,powered:false}];
  const noLinks=allocateUtility('power',nodes,[]);
  assert.equal(noLinks.served.has('b'),false);
  const withLinks=allocateUtility('power',nodes,[segments('x','a','b')]);
  assert.equal(withLinks.served.has('b'),true);
});
test('1.6.2: power cable bottleneck blocks 30 units but upgraded cable allows them',()=>{
  const nodes=[{id:'g',priority:0,power:0,powerOut:40},{id:'c',priority:5,power:30,powerOut:0}];
  assert.equal(allocateUtility('power',nodes,[segments('x','g','c',1)]).served.has('c'),false);
  assert.equal(allocateUtility('power',nodes,[segments('x','g','c',2)]).served.has('c'),true);
});
test('1.6.2: disconnected consumers are not silently served by another scene generator',()=>{
  const nodes=[{id:'g',priority:0,power:0,powerOut:50},{id:'a',priority:1,power:15,powerOut:0},
    {id:'lonely',priority:1,power:10,powerOut:0}];
  const alloc=allocateUtility('power',nodes,[segments('x','g','a')]);
  assert.equal(alloc.served.has('a'),true);assert.equal(alloc.served.has('lonely'),false);
});
test('1.6.2: scripted patch preserves independent state and socket handlers',()=>{
  const network=readFileSync(new URL('../module/networks.mjs',import.meta.url),'utf8');
  const industry=readFileSync(new URL('../module/industry.mjs',import.meta.url),'utf8');
  assert.match(network,/gm-upgrade-chain/);
  assert.match(network,/validateNetworkLink\(link,scene\)!=='ok'/);
  assert.match(industry,/planBuildingResize/);
  assert.match(industry,/resize-building/);
});

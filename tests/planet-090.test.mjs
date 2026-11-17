import test from 'node:test';import assert from 'node:assert/strict';
import {PLANET_ZONES,weatherForDay,weatherVitals,planetContext} from '../module/planet.mjs';
import {planDayOperation} from '../module/day-operation.mjs';
test('planetary weather deterministic across clients and resistant to unknown zones',()=>{
  for(const id of Object.keys(PLANET_ZONES)){
    for(let d=1;d<=40;d++)assert.deepEqual(weatherForDay(d,id,37),weatherForDay(d,id,37));
  }
  assert.equal(weatherForDay(2,'bogus').zone,'temperate');
  assert.throws(()=>weatherForDay(0),/день/);
});
test('shelter reduces fatigue and avoids oxygen penalties',()=>{
  const bad={fatigue:90,oxygen:-4},s={fatigue:10,oxygen:80};
  const raw=weatherVitals(s,bad,false),safe=weatherVitals(s,bad,true);
  assert.equal(raw.fatigue,100);assert.equal(raw.oxygen,76);
  assert.equal(safe.fatigue,33);assert.equal(safe.oxygen,80);
});
test('weather context uses default environment and available shelter',()=>{
  const c={system:{environment:{},industry:{buildings:[{id:'shelter',count:1}]}}};
  assert.equal(planetContext(c,3).sheltered,true);
  assert.equal(planetContext(null,3).available,false);
});
test('planner embeds deterministic weather and leaves colony unchanged',()=>{
  const a={id:'a',type:'survivor',items:[],system:{survival:{health:100,hunger:0,thirst:0,fatigue:0,oxygen:100}}};
  const c={id:'c',type:'colony',items:[],system:{environment:{zone:'desert',seed:5},industry:{jobs:[],construction:[],buildings:[]},crew:{jobs:[]}}};
  const p=planDayOperation([a],c,2);
  assert.equal(p.weather.day,3);
  assert.deepEqual(p.survival[0].values,weatherVitals({health:100,hunger:20,thirst:30,fatigue:5,oxygen:100},p.weather,false));
  assert.equal(a.system.survival.fatigue,0);
});

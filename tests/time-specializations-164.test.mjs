import test from 'node:test';
import assert from 'node:assert/strict';
import {INITIAL_CLOCK,CLOCK_SPEEDS,clockDisplay,normalizeClock,simulateClockStep,
 specializationProfile} from '../module/clock-rules-164.mjs';

const actor=(abilityKey,skillKey,ability=6,skill=4)=>({abilities:{[abilityKey]:ability},skills:{[skillKey]:skill}});

test('1.6.4 clock starts at 08:00 and supports named real-to-game minute rates',()=>{
  assert.equal(clockDisplay(INITIAL_CLOCK.minute),'08:00');
  assert.deepEqual(CLOCK_SPEEDS,[1,5,10,60]);
  assert.equal(simulateClockStep({...INITIAL_CLOCK,speed:60},1000).minute,481);
  assert.equal(simulateClockStep({...INITIAL_CLOCK,speed:5},6000).minute,480.5);
  assert.equal(clockDisplay(1439.9),'23:59');
});
test('1.6.4 paused clock never advances and malformed clock state is normalized',()=>{
  const p=simulateClockStep({...INITIAL_CLOCK,paused:true,speed:60},15000);
  assert.equal(p.minute,480);assert.equal(p.days,0);
  const s=normalizeClock({minute:Infinity,speed:100,paused:0});
  assert.equal(s.minute,480);assert.equal(s.speed,1);assert.equal(s.paused,false);
});
test('1.6.4 midnight returns one pending rollover and does not shift game settings itself',()=>{
  const s=simulateClockStep({...INITIAL_CLOCK,minute:1439.5,speed:60},1000);
  assert.equal(s.days,1);assert.equal(s.minute,0.5);
});
test('1.6.4 suspended tabs are bounded to 15 s and do not accrue offline days',()=>{
  const s=simulateClockStep({...INITIAL_CLOCK,minute:700,speed:60},86_400_000);
  assert.equal(s.days,0);assert.equal(s.minute,715);
  assert.throws(()=>simulateClockStep(INITIAL_CLOCK,-1),/интервал/);
});
test('1.6.4 medicine 6 intellect / 4 medicine unlocks Medic without changing actor data',()=>{
  const src=actor('intellect','medicine');
  const copy=structuredClone(src);
  const profile=specializationProfile(src);
  assert.equal(profile.name,'Медик');assert.equal(profile.primary.progress,100);
  assert.deepEqual(src,copy);
  assert.equal(specializationProfile(actor('intellect','medicine',6,3)).name,'Не определена');
  assert.equal(specializationProfile(actor('intellect','medicine',5,4)).name,'Не определена');
});
test('1.6.4 six independent specialization pairs are supported',()=>{
 const pairs=[['intellect','medicine','Медик'],['intellect','engineering','Инженер'],
  ['intellect','science','Учёный'],['agility','crafting','Мастер'],
  ['perception','exploration','Разведчик'],['endurance','survival','Выживальщик']];
 for(const [ability,skill,label] of pairs)assert.equal(specializationProfile(actor(ability,skill)).name,label);
});
test('1.6.4 primary profile prioritizes the strongest eligible profile deterministically',()=>{
  const profile=specializationProfile({abilities:{intellect:9},skills:{medicine:4,engineering:6,science:5}});
  assert.equal(profile.name,'Инженер');
  assert.equal(profile.all.filter(x=>x.ready).length,3);
  assert.match(profile.primary.future,/В будущем:/);
});
test('1.6.4 no mechanical bonuses are applied by specialization calculation',()=>{
  const source={abilities:{intellect:9},skills:{science:6},survival:{health:75},inventory:[]};
  const profile=specializationProfile(source);
  assert.equal(profile.name,'Учёный');
  assert.equal(source.survival.health,75);
  assert.equal(source.inventory.length,0);
});

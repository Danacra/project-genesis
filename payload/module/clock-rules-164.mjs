/** PROJECT GENESIS 1.6.4 — pure game-clock arithmetic. No Foundry dependencies. */
export const CLOCK_SPEEDS=Object.freeze([1,5,10,60]);
export const INITIAL_CLOCK=Object.freeze({minute:480,speed:1,paused:false,pending:null,pulse:0});
const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
export function normalizeClock(raw){
  const value=raw&&typeof raw==='object'?raw:{};
  const minute=finite(value.minute,INITIAL_CLOCK.minute);
  const speed=CLOCK_SPEEDS.includes(value.speed)?value.speed:INITIAL_CLOCK.speed;
  const pending=value.pending&&Number.isSafeInteger(value.pending.day)&&value.pending.day>=1&&
    Number.isFinite(value.pending.nextMinute)&&value.pending.nextMinute>=0&&value.pending.nextMinute<1440?
    {day:value.pending.day,nextMinute:value.pending.nextMinute,failed:!!value.pending.failed}:null;
  return {minute:Math.max(0,Math.min(1439.9999,minute)),speed,paused:value.paused===undefined?false:!!value.paused,
    pending,pulse:Math.max(0,finite(value.pulse,0))};
}
export function simulateClockStep(raw,elapsedMs){
  const state=normalizeClock(raw);
  if(state.paused||state.pending)return {minute:state.minute,days:0};
  if(!Number.isFinite(elapsedMs)||elapsedMs<0)throw Error('Некорректный интервал времени.');
  // Only live GM time is counted; an inactive/background tab never accumulates days.
  const elapsed=Math.min(elapsedMs,15000);
  const sum=state.minute+elapsed*state.speed/60000;
  const days=Math.floor(sum/1440);
  return {minute:Math.round((sum-days*1440)*100000)/100000,days};
}
export function clockDisplay(minute){
  const m=Math.floor(Math.max(0,Math.min(1439.9999,finite(minute,0))));
  return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
}
export function specializationProfile(system={}){
  const definitions=[
    {id:'medic',name:'Медик',ability:'intellect',abilityName:'Интеллект',skill:'medicine',skillName:'Медицина',future:'В будущем: лечение, диагностика, изготовление медикаментов и помощь экипажу.'},
    {id:'engineer',name:'Инженер',ability:'intellect',abilityName:'Интеллект',skill:'engineering',skillName:'Инженерия',future:'В будущем: ремонт зданий, наладка энергосетей и повышение надёжности механизмов.'},
    {id:'scientist',name:'Учёный',ability:'intellect',abilityName:'Интеллект',skill:'science',skillName:'Наука',future:'В будущем: ускорение исследований и дополнительные научные открытия.'},
    {id:'artisan',name:'Мастер',ability:'agility',abilityName:'Ловкость',skill:'crafting',skillName:'Ремесло',future:'В будущем: качественный крафт, ремонт инструментов и экономия материалов.'},
    {id:'scout',name:'Разведчик',ability:'perception',abilityName:'Восприятие',skill:'exploration',skillName:'Разведка',future:'В будущем: более точная разведка, поиск ресурсов и предупреждение об опасностях.'},
    {id:'survivor',name:'Выживальщик',ability:'endurance',abilityName:'Выносливость',skill:'survival',skillName:'Выживание',future:'В будущем: эффективность полевой работы, переноска снаряжения и адаптация к биомам.'}
  ];
  const all=definitions.map((entry,index)=>{
    const ability=Math.max(0,Math.min(10,finite(system.abilities?.[entry.ability],0)));
    const skill=Math.max(0,Math.min(6,finite(system.skills?.[entry.skill],0)));
    const ready=ability>=6&&skill>=4;
    const progress=Math.round(Math.min(1,ability/6,skill/4)*100);
    const rank=ready?((ability-6)+(skill-4)*1.5):0;
    return {...entry,ability,skill,ready,progress,rank,index};
  }).sort((a,b)=>Number(b.ready)-Number(a.ready)||b.rank-a.rank||b.progress-a.progress||a.index-b.index);
  const primary=all.find(p=>p.ready)||null;
  return {name:primary?.name||'Не определена',primary,all,
    best:all[0],hasSpecialization:!!primary};
}

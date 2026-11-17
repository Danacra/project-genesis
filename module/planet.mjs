/** PROJECT GENESIS 0.9: deterministic, fictional planetary environment. */
export const PLANET_ZONES=Object.freeze({
  temperate:{name:'Умеренные равнины',description:'Переменчивая погода и умеренная температура.',weights:[45,25,15,10,5]},
  desert:{name:'Каменная пустыня',description:'Сухость, пыль и дневная жара.',weights:[30,15,10,40,5]},
  tundra:{name:'Ледяное плато',description:'Холод, снег и риск бурь.',weights:[30,20,15,10,25]},
  forest:{name:'Влажные заросли',description:'Частые осадки и повышенная влажность.',weights:[25,20,45,5,5]},
  volcanic:{name:'Вулканические поля',description:'Пепел, горячий воздух и нестабильная атмосфера.',weights:[20,20,10,40,10]}
});
const CONDITIONS=Object.freeze([
  {id:'calm',name:'Спокойно',detail:'Экспедиции ничто не мешает.',fatigue:0,oxygen:0},
  {id:'wind',name:'Сильный ветер',detail:'Работа на открытой местности утомляет.',fatigue:2,oxygen:0},
  {id:'rain',name:'Осадки',detail:'Нужна защита оборудования от осадков.',fatigue:3,oxygen:0},
  {id:'storm',name:'Опасная буря',detail:'Незащищённые выжившие сильнее устают.',fatigue:12,oxygen:-4},
  {id:'extreme',name:'Экстремальная температура',detail:'Без укрытия условия тяжёлые.',fatigue:10,oxygen:0}
]);
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
export function weatherForDay(day,zone='temperate',seed=71){
  if(!Number.isSafeInteger(day)||day<1)throw Error('Некорректный день погоды.');
  const safeZone=Object.hasOwn(PLANET_ZONES,zone)?zone:'temperate';
  const weights=PLANET_ZONES[safeZone].weights;
  // Stateless forecast, stable after reload and on every client.
  let value=(Math.imul((Number(seed)||71)|0,1664525)+Math.imul(day|0,1013904223))|0;
  value^=value>>>16;value=Math.imul(value,2246822519);value^=value>>>13;
  const roll=(value>>>0)%100;
  let sum=0,index=weights.findIndex(weight=>{sum+=weight;return roll<sum;});
  if(index<0)index=0;
  return {...CONDITIONS[index],zone:safeZone,day};
}
export function weatherVitals(vitals,weather,sheltered=false){
  const protection=sheltered?0.25:1;
  return {...vitals,
    fatigue:clamp(Math.round((Number(vitals.fatigue)||0)+weather.fatigue*protection),0,100),
    oxygen:clamp((Number(vitals.oxygen)||0)+(sheltered?0:weather.oxygen),0,100)};
}
export function planetContext(colony,day){
  if(!colony)return {available:false};
  const env=colony.system.environment||{};
  const zone=Object.hasOwn(PLANET_ZONES,env.zone)?env.zone:'temperate';
  const weather=weatherForDay(day,zone,env.seed);
  const sheltered=Boolean(colony.system.industry?.buildings?.some(b=>b.id==='shelter'&&b.count>0));
  return {available:true,zone,zoneName:PLANET_ZONES[zone].name,
    description:PLANET_ZONES[zone].description,weather,day,
    sheltered,seed:env.seed||71,
    zones:Object.entries(PLANET_ZONES).map(([id,v])=>({id,name:v.name,selected:id===zone}))};
}

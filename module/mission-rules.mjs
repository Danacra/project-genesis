/** PROJECT GENESIS 1.0: purely fictional ship assembly and endgame checks. */
import {weatherForDay} from './planet.mjs';
export const MISSION_STAGES=Object.freeze([
  {title:'Подготовить сборочный док',description:'Изучите финальную технологию и разместите построенный сборочный док на карте.'},
  {title:'Собрать корпус и жилой отсек',description:'Доставьте изготовленные детали на общий склад колонии.'},
  {title:'Смонтировать системы корабля',description:'Объедините навигацию, двигатель и орбитальный модуль.'},
  {title:'Подготовить старт',description:'Проверьте инфраструктуру и выберите безопасное погодное окно.'},
  {title:'Экспедиция завершена',description:'Корабль готов. Финальный запуск проведён ведущим.'}
]);
export const MISSION_COMPONENTS=Object.freeze({
  1:Object.freeze({hull_sections:2,habitat_module:1}),
  2:Object.freeze({navigation_core:1,propulsion_assembly:1,orbital_core:1})
});
const LABELS={hull_sections:'Секции корпуса',habitat_module:'Модуль среды обитания',
  navigation_core:'Навигационный вычислитель',propulsion_assembly:'Двигательный модуль',orbital_core:'Орбитальный комплекс'};
export function missionStage(colony,day=1){
  if(!colony)return {available:false};
  const stage=Math.max(0,Math.min(4,Number(colony.system.mission?.stage||0)));
  const stock=Object.create(null);
  for(const item of colony.items||[]){
    if(item.type==='container')continue;
    const code=String(item.system?.resourceCode||'').trim().toLowerCase();
    const n=Math.max(0,Math.trunc(Number(item.system?.quantity)||0));
    if(code&&n)stock[code]=(stock[code]||0)+n;
  }
  const buildings=colony.system.industry?.buildings||[];
  const hasBuilding=id=>buildings.some(row=>row.id===id&&row.count>0);
  const placement=(colony.system.industry?.placements||[]).find(p=>p.buildingId==='assembly-dock'&&p.status==='finished');
  const req=[];
  if(stage===0){
    req.push({name:'Изучено: Проект «Возвращение»',ok:(colony.system.science?.unlocked||[]).includes('return-project')});
    req.push({name:'Построен сборочный док',ok:hasBuilding('assembly-dock')});
    req.push({name:'Док размещён на карте',ok:Boolean(placement)});
  }else if(stage===1||stage===2){
    for(const [code,count]of Object.entries(MISSION_COMPONENTS[stage])){
      req.push({name:LABELS[code],code,required:count,available:stock[code]||0,ok:(stock[code]||0)>=count});
    }
  }else if(stage===3){
    req.push({name:'Энергетическая станция',ok:hasBuilding('powerLab')});
    req.push({name:'Испытательный комплекс',ok:hasBuilding('flightLab')});
    const weather=weatherForDay(day,colony.system.environment?.zone,colony.system.environment?.seed);
    req.push({name:`Безопасная погода (${weather.name})`,ok:!['storm','extreme'].includes(weather.id)});
  }
  const ready=stage<4 && req.every(r=>r.ok);
  return {available:true,stage,completed:stage===4,finalStage:stage===3,ready,requirements:req,
    current:MISSION_STAGES[stage],nextLabel:stage===3?'Выполнить финальный запуск':'Завершить этап',
    progress:Math.round(stage/4*100),steps:MISSION_STAGES.map((s,i)=>({...s,index:i,done:i<stage,active:i===stage})),
    log:[...(colony.system.mission?.events||[])].reverse()};
}
/** Absolute inventory targets, stable when a partially completed operation is replayed. */
export function missionInventoryPlan(items,requirements){
  const needed={...requirements},updates=[];
  for(const item of items||[]){
    if(item.type==='container')continue;
    const code=String(item.system?.resourceCode||'').trim().toLowerCase();
    const n=Math.max(0,Math.trunc(Number(item.system?.quantity)||0));
    const take=Math.min(n,needed[code]||0);
    if(!take)continue;
    updates.push({id:item.id,quantity:n-take});needed[code]-=take;
  }
  for(const [code,n]of Object.entries(needed))if(n>0)throw Error(`Не хватает компонента «${LABELS[code]||code}»: ${n}.`);
  return updates;
}
export function planMissionOperation(colony,day,userName){
  const state=missionStage(colony,day);
  if(!state.ready)throw Error('Требования текущего этапа не выполнены. Проверьте список компонентов.');
  const stage=state.stage,nextStage=stage+1;
  return {version:1,colonyId:colony.id,day,stage,nextStage,
    inventory:missionInventoryPlan(colony.items,MISSION_COMPONENTS[stage]||{}),
    events:[...(colony.system.mission?.events||[]),{stage:nextStage,day,by:String(userName||'GM').slice(0,100)}].slice(-40)};
}

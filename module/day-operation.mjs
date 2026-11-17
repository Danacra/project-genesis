/** Durable, replayable world-day plan. Produces absolute target values, never relative debits. */
import {qty,dayVitals,LIMITS} from './rules.mjs';
import {tickQueue} from './industry-rules.mjs';
import {crewJob} from './crew-rules.mjs';

const copy = value => JSON.parse(JSON.stringify(value));

/** Compute once before any write. Shared colony food/water can feed only one survivor per unit. */
export function planDayOperation(survivors,colony,day){
  if(!Number.isSafeInteger(day)||day<1||day>=9999999)throw Error('Некорректный игровой день.');
  const inventory=new Map();
  for(const actor of [...survivors,...(colony?[colony]:[])]){
    if(inventory.has(actor.id))continue;
    const rows=[];
    for(const item of actor.items||[]){
      if(item.type==='container')continue;
      const code=String(item.system?.resourceCode||'').trim().toLowerCase();
      if(code==='food'||code==='water')rows.push({id:item.id,code,original:qty(item),remaining:qty(item)});
    }
    inventory.set(actor.id,rows);
  }
  const survival=[];
  for(const actor of survivors){
    const supplied={};
    for(const [code,required] of Object.entries({food:LIMITS.foodPerDay,water:LIMITS.waterPerDay})){
      const sourceIds=[actor.id,...(colony&&colony.id!==actor.id?[colony.id]:[])];
      const stacks=sourceIds.flatMap(id=>(inventory.get(id)||[]).filter(item=>item.code===code));
      const available=stacks.reduce((sum,item)=>sum+item.remaining,0);
      supplied[code]=available>=required;
      if(!supplied[code])continue; // do not partially consume unavailable rations
      let left=required;
      for(const item of stacks){
        const consumed=Math.min(left,item.remaining);
        item.remaining-=consumed;
        left-=consumed;
        if(!left)break;
      }
    }
    survival.push({actorId:actor.id,values:copy(dayVitals(actor.system.survival,supplied.food,supplied.water))});
    survival.at(-1).fed=supplied.food;
    survival.at(-1).hydrated=supplied.water;
  }
  const items=[...inventory].map(([actorId,rows])=>({actorId,
    updates:rows.filter(row=>row.remaining!==row.original).map(row=>({id:row.id,quantity:row.remaining}))
  })).filter(row=>row.updates.length);
  return {
    version:1,day,nextDay:day+1,colonyId:colony?.id||'',items,survival,
    industry:colony?copy(tickQueue(colony.system.industry)):null,
    crewJobs:colony?copy((colony.system.crew?.jobs||[]).map(row=>crewJob(row,day))):null
  };
}

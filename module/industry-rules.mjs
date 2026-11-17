/** Pure manufacturing and construction validation. No Foundry globals. */
import { RECIPES, RECIPE_BY_ID, BUILDINGS, BUILDING_BY_ID, resourceName } from './industry-data.mjs';
import { stockByCode } from './research-rules.mjs';
import { capacity, fits, summarizeInventory, stackSignature, qty } from './rules.mjs';
const MAX_STACK=999999;
const list = value => Array.isArray(value)?value:[];
const set = value=>new Set(list(value));
const round = n=>Math.round(n*1e6)/1e6;
export function amountsNeeded(inputs, batches=1){
  if(!Number.isSafeInteger(batches)||batches<1||batches>10)throw Error('Выберите от 1 до 10 партий.');
  return Object.fromEntries(Object.entries(inputs).map(([c,n])=>[c,n*batches]));
}
export function recipeState(recipeId,colony,batches=1,precomputedStock=null){
  const recipe=RECIPE_BY_ID[recipeId];if(!recipe)throw Error('Чертёж не найден.');
  const requirements=amountsNeeded(recipe.inputs,batches);
  const stock=precomputedStock||stockByCode(colony.items);
  const materials=Object.entries(requirements).map(([code,required])=>({
    code,name:resourceName(code),required,available:stock[code]||0,ok:(stock[code]||0)>=required
  }));
  const unlocked=set(colony.system?.science?.unlocked).has(recipe.techId);
  const facilities=set(colony.system?.science?.facilities);
  const stationReady=!recipe.station||facilities.has(recipe.station)||hasBuilding(colony,recipe.station);
  return {recipe,unlocked,stationReady,materials,canStart:unlocked&&stationReady&&materials.every(m=>m.ok)};
}
export function buildingCount(industry,id){return list(industry?.buildings).find(b=>b.id===id)?.count||0;}
export function hasBuilding(colony,id){return buildingCount(colony.system?.industry,id)>0;}
export function buildingState(id,colony,precomputedStock=null){
  const building=BUILDING_BY_ID[id];if(!building)throw Error('Здание не найдено.');
  const stock=precomputedStock||stockByCode(colony.items);
  const materials=Object.entries(building.inputs).map(([code,required])=>({
    code,name:resourceName(code),required,available:stock[code]||0,ok:(stock[code]||0)>=required
  }));
  const unlocked=set(colony.system?.science?.unlocked).has(building.techId);
  const built=buildingCount(colony.system?.industry,id);
  const underConstruction=list(colony.system?.industry?.construction).filter(j=>j.subject===id).length;
  const canStart=unlocked && built+underConstruction<building.max && materials.every(m=>m.ok);
  return {building,unlocked,built,underConstruction,materials,canStart};
}
export function planTake(items,inputs,batches=1){
  const needed=amountsNeeded(inputs,batches);
  const stock=stockByCode(items);
  for(const [code,amount] of Object.entries(needed)){
    if((stock[code]||0)<amount)throw Error(`Не хватает ресурса «${resourceName(code)}» (${stock[code]||0}/${amount}).`);
  }
  const changes=[], escrow=[];
  const remaining={...needed};
  for(const item of items){
    if(item.type==='container')continue;
    const code=String(item.system?.resourceCode||'').trim().toLowerCase();
    const n=Math.min(qty(item),remaining[code]||0);
    if(!n)continue;
    changes.push({_id:item.id,'system.quantity':qty(item)-n});
    escrow.push({itemId:item.id,count:n,code,name:item.name,type:item.type,
      img:String(item.img||'icons/svg/item-bag.svg'),unitMass:Number(item.system.unitMass)||0,
      unitVolume:Number(item.system.unitVolume)||0,quality:Number(item.system.quality)||0,
      techTier:Number(item.system.techTier)||0,description:String(item.system.description||''),
      containerId:String(item.system.containerId||'')});
    remaining[code]-=n;
  }
  return {changes,escrow};
}
export function outputItem(recipe,batches=1){
  const output=recipe.output||recipe;
  return {name:recipe.name||output.name||'Произведённый предмет',type:output.type||'component',img:'icons/svg/item-bag.svg',
    system:{quantity:output.quantity*batches,resourceCode:output.code,unitMass:output.unitMass,
      unitVolume:output.unitVolume,containerId:'',description:recipe.description||''}};
}
export function depositPlan(colony,incoming){
  const summary=summarizeInventory(colony.items);
  const q=qty(incoming), mass=Number(incoming.system.unitMass)*q,volume=Number(incoming.system.unitVolume)*q;
  if(!Number.isSafeInteger(q)||q<1||q>MAX_STACK)throw Error('Недопустимое количество готовой продукции.');
  if(!fits({mass:summary.exactLoad.mass+mass,volume:summary.exactLoad.volume+volume},capacity(colony)))
    throw Error('На складе не хватает места для готовой продукции. Освободите склад или постройте хранилище.');
  const signature=stackSignature(incoming,'');
  const target=colony.items.find(item=>item.type!=='container'&&stackSignature(item,item.system?.containerId||'')===signature&&qty(item)+q<=MAX_STACK);
  return {targetId:target?.id||'',before:target?qty(target):0,incoming};
}
export function refundPlan(colony,escrow){
  const changes=new Map(),creates=[];
  const pending=new Map();
  let mass=0,volume=0;
  for(const row of list(escrow)){
    const n=Number(row.count);if(!Number.isSafeInteger(n)||n<1)throw Error('Повреждённый возврат материалов.');
    mass+=n*Number(row.unitMass);volume+=n*Number(row.unitVolume);
    const current=colony.items.get?.(row.itemId)||Array.from(colony.items).find(i=>i.id===row.itemId);
    const next=current?(changes.get(current.id)?.after??qty(current))+n:0;
    if(current&&next<=MAX_STACK){
      changes.set(current.id,{id:current.id,before:qty(current),after:next});
    }else{
      const key=JSON.stringify([row.type,row.code,row.name,row.unitMass,row.unitVolume,row.quality,row.techTier,row.description,row.img]);
      const found=pending.get(key);
      if(found){found.system.quantity+=n;if(found.system.quantity>MAX_STACK)throw Error('Переполнен стек при возврате.');}
      else {
        const created={name:row.name,type:row.type,img:row.img,system:{quantity:n,resourceCode:row.code,
          unitMass:row.unitMass,unitVolume:row.unitVolume,quality:row.quality,techTier:row.techTier,
          description:row.description,containerId:''}};
        pending.set(key,created);creates.push(created);
      }
    }
  }
  const currentLoad=summarizeInventory(colony.items).exactLoad;
  if(!fits({mass:round(currentLoad.mass+mass),volume:round(currentLoad.volume+volume)},capacity(colony)))
    throw Error('Недостаточно свободного места, чтобы вернуть материалы.');
  // Refunds to original stacks remain in their containers. Validate their capacity too.
  const summary=summarizeInventory(colony.items);
  for(const row of list(escrow)){
    const current=colony.items.get?.(row.itemId)||Array.from(colony.items).find(i=>i.id===row.itemId);
    if(!current||!changes.has(current.id)||!current.system.containerId)continue;
    const container=summary.containers.get(current.system.containerId);
    if(!container)throw Error('Контейнер исходных материалов больше не существует.');
    const usage=summary.byContainer.get(current.system.containerId)||{mass:0,volume:0};
    // Cumulative refills to the same container (including items from other jobs).
    const refill=list(escrow).filter(e=>{
      const it=colony.items.get?.(e.itemId)||Array.from(colony.items).find(i=>i.id===e.itemId);
      return it?.system.containerId===current.system.containerId && changes.has(e.itemId);
    }).reduce((sum,e)=>({mass:sum.mass+e.count*e.unitMass,volume:sum.volume+e.count*e.unitVolume}),{mass:0,volume:0});
    if(!fits({mass:usage.mass+refill.mass,volume:usage.volume+refill.volume},
      {mass:container.system.capacityMass,volume:container.system.capacityVolume}))throw Error('Недостаточно места в контейнере для возврата материалов.');
  }
  return {changes:[...changes.values()],creates};
}
export function tickQueue(industry){
  const tick=jobs=>list(jobs).map(job=>({...job,remaining:Math.max(0,job.remaining-1)}));
  return {jobs:tick(industry?.jobs),construction:tick(industry?.construction)};
}
export function validateIndustryState(){
  for(const r of RECIPES)if(!r.techId)throw Error(`Отсутствует технология рецепта ${r.id}`);
  for(const b of BUILDINGS)if(b.harvest&&(!b.harvest.code||!b.harvest.quantity))throw Error(`Ошибка сбора ${b.id}`);
  return {recipes:RECIPES.length,buildings:BUILDINGS.length};
}

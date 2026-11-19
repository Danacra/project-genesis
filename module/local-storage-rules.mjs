/** Dedicated scene-linked local warehouses (v1.2.1). Pure operations, no Foundry globals. */
import {amountsNeeded} from './industry-rules.mjs';
import {changeStock,validateCache,cacheLoad,cacheLimit} from './crew-rules.mjs';
import {stockByCode} from './research-rules.mjs';
const list=v=>Array.isArray(v)?v:[];
export const LOCAL_WAREHOUSE='local-store';
export const isLocalWarehouse=p=>p?.buildingId===LOCAL_WAREHOUSE&&p?.status==='finished';
export function sourceSceneId(station,scenes){
  if(!station)return '';
  const scene=scenes?.get?.(station.sceneId);
  return scene?.flags?.['project-genesis']?.exteriorSceneId || station.sceneId;
}
export function warehouseNearStation(station,warehouse,scenes){
  return isLocalWarehouse(warehouse)&&!!station&&station.status==='finished'&&
    warehouse.sceneId===sourceSceneId(station,scenes);
}
export function localStockCounts(stock){
  return stockByCode(list(stock).map(r=>({type:r.type,system:{resourceCode:r.code,quantity:r.quantity}})));
}
function escrowFromCargo(cargo,count){
  return {itemId:'',count,code:cargo.code,name:cargo.name,type:cargo.type||'material',
    img:cargo.img||'icons/svg/item-bag.svg',unitMass:cargo.unitMass,unitVolume:cargo.unitVolume,
    quality:Number(cargo.quality)||0,techTier:Number(cargo.techTier)||0,
    description:cargo.description||'',containerId:''};
}
/** Take only from THIS warehouse; never mix quantities with other caches or colony inventory. */
export function planLocalTake(stock,inputs,batches=1){
  const needed=amountsNeeded(inputs,batches),available=localStockCounts(stock);
  for(const [code,count] of Object.entries(needed)){
    if((available[code]||0)<count)throw Error(`На локальном складе недостаточно «${code}»: ${available[code]||0}/${count}.`);
  }
  let result=list(stock).map(r=>({...r}));const reserved=[];
  for(const [code,count] of Object.entries(needed)){
    let remaining=count;
    for(const row of result){
      if(row.code!==code||!remaining)continue;
      const take=Math.min(remaining,row.quantity);
      reserved.push(escrowFromCargo(row,take));
      row.quantity-=take;remaining-=take;
    }
  }
  result=result.filter(r=>r.quantity>0);
  return {stock:result,reserved};
}
export function restoreLocalTake(stock,reserved,placement){
  let result=list(stock).map(r=>({...r}));
  for(const r of list(reserved)){
    const cargo={...r,quantity:r.count};
    validateCache(result,cargo,placement);
    result=changeStock(result,cargo,1);
  }
  return result;
}
export function localOutput(stock,item,placement){
  const cargo={code:item.system.resourceCode,name:item.name,type:item.type,img:item.img,
    quantity:item.system.quantity,unitMass:item.system.unitMass,unitVolume:item.system.unitVolume,
    quality:item.system.quality||0,techTier:item.system.techTier||0,description:item.system.description||''};
  validateCache(stock,cargo,placement);
  return changeStock(stock,cargo,1);
}
export function localWarehouseStatus(stock,placement){
  const load=cacheLoad(stock),limit=cacheLimit(placement);
  return {load,limit,free:{mass:Math.max(0,limit.mass-load.mass),volume:Math.max(0,limit.volume-load.volume)}};
}

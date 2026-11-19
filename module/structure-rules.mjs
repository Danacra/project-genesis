/** Non-destructive structure management rules (pure functions). */
import {BUILDING_BY_ID,RECIPE_BY_ID} from './industry-data.mjs';
import {DEVICES} from './network-rules.mjs';
export const INTERIOR_BUILDINGS=Object.freeze(['shelter','room']);
export const INDOOR_STATIONS=Object.freeze(['bench','fieldLab','furnace','bioLab','electronicsLab']);
const list=x=>Array.isArray(x)?x:[];
export const isInteriorBuilding=id=>INTERIOR_BUILDINGS.includes(id);
export const isCraftStation=id=>!!BUILDING_BY_ID[id]?.facility;
export function assertCanPlaceInside(buildingId,scene){
  if(!scene?.flags?.['project-genesis']?.interiorOf)return;
  if(!INDOOR_STATIONS.includes(buildingId))throw Error('Внутри помещения размещаются только верстаки и мастерские из доступного каталога.');
}
/** Prevent a crafted build request targeting a foreign/orphaned interior scene. */
export function assertInteriorOwnership(colony,scene){
  const info=scene?.flags?.['project-genesis'];
  if(!info?.interiorOf)return;
  if(info.colonyId!==colony?.id)throw Error('Помещение принадлежит другой колонии.');
  const parent=(colony.system.industry?.placements||[]).find(p=>p.id===info.interiorOf);
  if(!parent||parent.status!=='finished'||!isInteriorBuilding(parent.buildingId)||
      parent.interiorSceneId!==scene.id||parent.sceneId!==info.exteriorSceneId)
    throw Error('Внутренняя сцена не связана с действующим помещением колонии.');
}
export function salvageFor(buildingId,ratio=0.5){
  const b=BUILDING_BY_ID[buildingId];if(!b)throw Error('Неизвестное здание.');
  if(!Number.isFinite(ratio)||ratio<0||ratio>1)throw Error('Некорректная доля возврата.');
  return Object.fromEntries(Object.entries(b.inputs).map(([code,n])=>[code,Math.floor(n*ratio)]).filter(([,n])=>n>0));
}
export function structureBlockers(placement,{links=[],caches=[],jobs=[],productionJobs=[],buildingCount=1,placements=[],missionStage=0}={}){
  const reasons=[];
  if(placement.status!=='finished')reasons.push('Стройплощадку нужно отменять через очередь строительства.');
  if(list(links).some(l=>l.fromId===placement.id||l.toId===placement.id))reasons.push('Сначала демонтируйте подключённые электросети и трубы.');
  if(list(caches).some(c=>c.placementId===placement.id&&list(c.stock).some(x=>Number(x.quantity)>0)))reasons.push('Сначала вывезите материалы с локального склада.');
  if(list(jobs).some(j=>(j.sourceKind==='placement'&&j.sourceId===placement.id)||(j.targetKind==='placement'&&j.targetId===placement.id)))reasons.push('Завершите или отмените доставки, связанные с объектом.');
  if(placement.interiorSceneId&&list(placements).some(p=>p.sceneId===placement.interiorSceneId))reasons.push('Сначала разберите все станки внутри помещения.');
  if(list(productionJobs).some(j=>j.stationPlacementId===placement.id))
    reasons.push('Сначала завершите или отмените заказ, закреплённый за этим станком.');
  if(list(productionJobs).some(j=>j.sourcePlacementId===placement.id||j.outputPlacementId===placement.id))
    reasons.push('Сначала завершите или отмените производственные заказы, использующие этот локальный склад.');
  if(buildingCount<=1&&isCraftStation(placement.buildingId)&&list(productionJobs).some(j=>RECIPE_BY_ID[j.subject]?.station===placement.buildingId))
    reasons.push('Сначала завершите или отмените производственные заказы этого станка.');
  if(placement.buildingId==='assembly-dock'&&missionStage>0)reasons.push('Док нельзя разобрать во время сборки корабля.');
  return reasons;
}
export function roomPowerLoads(placements,scenes){
  const totals={};
  for(const p of list(placements)){
    const parentId=scenes?.get?.(p.sceneId)?.flags?.['project-genesis']?.interiorOf;
    if(!parentId||p.status!=='finished')continue;
    const config=DEVICES[p.buildingId];
    if(config&&!config.optionalPower)totals[parentId]=(totals[parentId]||0)+(config.power||0);
  }
  return totals;
}
export function sceneInteriorOf(scene){return scene?.flags?.['project-genesis']?.interiorOf||'';}
export function sourceForWorkstation(colony,placementId){
  const placements=list(colony?.system?.industry?.placements),p=placements.find(x=>x.id===placementId);
  if(!p||p.status!=='finished'||!isCraftStation(p.buildingId))throw Error('Не найден работающий станок.');
  return p;
}

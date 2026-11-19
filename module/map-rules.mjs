/** PROJECT GENESIS 0.6 — pure, testable placement geometry.
 * Coordinates and sizes are in Scene pixels; footprints are square grid cells.
 * This version deliberately supports square-grid scenes only.
 */
import {interiorPlacementProblem} from './interior-rules.mjs';
export const BUILDING_FOOTPRINTS = Object.freeze({
  bench:[2,2], fieldLab:[3,3], furnace:[3,3], bioLab:[3,3],
  powerLab:[3,3], electronicsLab:[3,3], flightLab:[5,4],
  storehouse:[3,3], 'local-store':[3,3], garden:[4,3], 'water-recycler':[3,3],
  shelter:[3,2], room:[6,6], 'assembly-dock':[6,5]
});
const SYSTEM='project-genesis';
export const BASE_TILE = `systems/${SYSTEM}/assets/buildings/`;
export const tileAsset=(id,finished=false)=>
  finished&&id==='shelter'?`${BASE_TILE}shelter-roof.png`:
  finished&&id==='bench'?`${BASE_TILE}bench-top.png`:
  `${BASE_TILE}${finished?id:'construction-site'}.svg`;
export const cellsFor=(id)=>BUILDING_FOOTPRINTS[id]||null;
export function sceneGeometry(scene){
  const grid=Number(scene?.grid?.size);
  const type=Number(scene?.grid?.type);
  const rect=scene?.dimensions?.sceneRect || {x:0,y:0,width:scene?.width,height:scene?.height};
  const x=Number(rect.x),y=Number(rect.y),width=Number(rect.width),height=Number(rect.height);
  if(type!==1||!Number.isFinite(grid)||grid<1)throw Error('Для строительства нужна сцена с квадратной сеткой.');
  if(![x,y,width,height].every(Number.isFinite)||width<=0||height<=0)
    throw Error('Сцена не имеет корректных размеров.');
  return {grid,bounds:{x,y,width,height}};
}
export function snapToGrid(x,y,grid,bounds){
  if(![x,y,grid,bounds.x,bounds.y].every(Number.isFinite)||grid<=0)throw Error('Неверная позиция на карте.');
  return {x:bounds.x+Math.floor((x-bounds.x)/grid)*grid,
    y:bounds.y+Math.floor((y-bounds.y)/grid)*grid};
}
export function footprintRect(buildingId,position,geometry){
  const cells=cellsFor(buildingId);
  if(!cells)throw Error('Неизвестное сооружение.');
  const {grid,bounds}=geometry;
  const snapped=snapToGrid(Number(position.x),Number(position.y),grid,bounds);
  return {...snapped,width:cells[0]*grid,height:cells[1]*grid};
}
export function overlaps(a,b){
  return a.x<b.x+b.width && a.x+a.width>b.x && a.y<b.y+b.height && a.y+a.height>b.y;
}
export function tilesBlocking(scene){
  return [...(scene?.tiles||[])].filter(t=>{
    const f=t.flags?.[SYSTEM];
    return !!(f?.buildingId||f?.blockPlacement);
  }).map(t=>({id:t.id||t._id,x:Number(t.x),y:Number(t.y),width:Number(t.width),height:Number(t.height)}));
}
export function checkPlacement(buildingId,position,scene,{placements=[],ignoreTileId=''}={}){
  const geometry=sceneGeometry(scene);
  const rect=footprintRect(buildingId,position,geometry);
  const b=geometry.bounds;
  const inside=rect.x>=b.x && rect.y>=b.y && rect.x+rect.width<=b.x+b.width && rect.y+rect.height<=b.y+b.height;
  const blocked=tilesBlocking(scene).some(t=>t.id!==ignoreTileId&&overlaps(rect,t)) ||
    placements.some(p=>p.sceneId===scene.id && p.tileId!==ignoreTileId && overlaps(rect,p));
  const interiorProblem=inside?interiorPlacementProblem(scene,rect):'';
  return {...rect,inside,blocked,valid:inside&&!blocked&&!interiorProblem,reason:!inside?'Здание выходит за пределы карты.':
    interiorProblem|| (blocked?'Это место занято другой постройкой.':'')};
}
export function assertPlacement(buildingId,position,scene,options={}){
  if(!Number.isInteger(position.x)||!Number.isInteger(position.y))throw Error('Координаты должны быть целыми пикселями.');
  const result=checkPlacement(buildingId,position,scene,options);
  if(result.x!==position.x||result.y!==position.y)throw Error('Здание необходимо разместить по сетке.');
  if(!result.valid)throw Error(result.reason);
  return result;
}
export function asTileData(buildingId,rect,{colonyId,jobId,placementId,status='construction'}={}){
  if(!colonyId||!jobId||!placementId)throw Error('Отсутствуют данные стройплощадки.');
  return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,rotation:0,alpha:1,
    hidden:false,locked:true,texture:{src:tileAsset(buildingId,status==='finished')},
    flags:{[SYSTEM]:{colonyId,jobId,placementId,buildingId,status}}};
}
export function validateTileLink(placement,tile){
  const f=tile?.flags?.[SYSTEM];
  return Boolean(tile && f && f.colonyId===placement.colonyId && f.jobId===placement.jobId &&
    f.placementId===placement.id && f.buildingId===placement.buildingId);
}
/** Diagnose broken scene links without modifying world data.
 * Protects from accidentally completing or cancelling a tile moved by an editor.
 */
export function placementHealth(placement,scene,tile){
  if(!scene)return 'missing-scene';
  if(!tile)return 'missing-tile';
  if(!validateTileLink(placement,tile))return 'foreign-tile';
  const same=(a,b)=>Number.isFinite(Number(a))&&Math.abs(Number(a)-Number(b))<0.01;
  if(!same(tile.x,placement.x)||!same(tile.y,placement.y)||
      !same(tile.width,placement.width)||!same(tile.height,placement.height)||!same(tile.rotation??0,0))return 'moved-tile';
  if(tile.flags?.[SYSTEM]?.status!==placement.status)return 'status-mismatch';
  return 'ok';
}
export function assertHealthyPlacement(placement,scene,tile){
  const health=placementHealth(placement,scene,tile);
  if(health!=='ok')throw Error({
    'missing-scene':'Сцена здания удалена. Восстановите сцену из резервной копии.',
    'missing-tile':'Тайл здания отсутствует. Ведущий может восстановить его в листе колонии.',
    'foreign-tile':'Связь с тайлом нарушена: его флаги не соответствуют колонии.',
    'moved-tile':'Тайл здания был перемещён или изменён. Верните его на прежнее место.',
    'status-mismatch':'Состояние стройплощадки не совпадает с журналом колонии.'
  }[health]||'Ошибка связи здания с картой.');
  return tile;
}

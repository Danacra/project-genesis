/** Plan a larger tier footprint without crossing buildings, any network tiles or existing link endpoints. */
import {cellsFor,checkPlacement,sceneGeometry,overlaps} from './map-rules.mjs';
import {tierNumber} from './tier-rules-162.mjs';
const SYSTEM='project-genesis';
const inside=(p,rect)=>p.x>=rect.x&&p.y>=rect.y&&p.x<rect.x+rect.width&&p.y<rect.y+rect.height;
function touches(rect,p,grid){
  if(!p)return false;
  const centerX=p.x+grid/2,centerY=p.y+grid/2;
  const left=centerX>=rect.x&&centerX<rect.x+rect.width;
  const above=centerY>=rect.y&&centerY<rect.y+rect.height;
  return (left&&(p.y+grid===rect.y||p.y===rect.y+rect.height))||
    (above&&(p.x+grid===rect.x||p.x===rect.x+rect.width));
}
export function planBuildingResize(placement,nextTier,scene,placements,links=[]){
  if(!placement||!scene)throw Error('Нет здания или сцены для расширения.');
  const tier=tierNumber(nextTier),geo=sceneGeometry(scene),[w,h]=cellsFor(placement.buildingId,tier)||[];
  if(!w||!h)throw Error('Неизвестная постройка.');
  const nextWidth=w*geo.grid,nextHeight=h*geo.grid;
  if(nextWidth===placement.width&&nextHeight===placement.height)
    return {x:placement.x,y:placement.y,width:placement.width,height:placement.height,tier};
  const dx=nextWidth-placement.width,dy=nextHeight-placement.height;
  const positions=[{x:placement.x,y:placement.y},{x:placement.x-dx,y:placement.y},
    {x:placement.x,y:placement.y-dy},{x:placement.x-dx,y:placement.y-dy}];
  const connected=(Array.isArray(links)?links:[]).filter(l=>l.sceneId===scene.id&&
    (l.fromId===placement.id||l.toId===placement.id));
  const allNetworks=[...(scene.tiles||[])].filter(t=>t.flags?.[SYSTEM]?.networkId);
  for(const pos of positions){
    if(!Number.isSafeInteger(pos.x)||!Number.isSafeInteger(pos.y))continue;
    const proposed=checkPlacement(placement.buildingId,pos,scene,{
      placements,ignoreTileId:placement.tileId,tier});
    if(!proposed.valid)continue;
    if(allNetworks.some(t=>overlaps(proposed,t)))continue;
    if(connected.some(l=>!touches(proposed,l.fromId===placement.id?l.route?.[0]:l.route?.at(-1),geo.grid)))continue;
    return {...proposed,tier};
  }
  throw Error('Для расширения нет свободной площади с сохранением кабелей и труб. Освободите клетки либо перенесите линии. Материалы не списаны.');
}

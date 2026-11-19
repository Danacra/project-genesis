/** PROJECT GENESIS v1.3 — deterministic interior geometry and safe token destinations.
 * Pure functions: the GM performs all scene/document writes separately.
 */
const SYSTEM='project-genesis';
export const INTERIOR_WIDTH=1200;
export const INTERIOR_HEIGHT=900;
const rectOverlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
const boundsFor=scene=>scene?.dimensions?.sceneRect||{x:0,y:0,width:Number(scene?.width),height:Number(scene?.height)};
export function interiorLayout(scene){
  const grid=Number(scene?.grid?.size);
  const bounds=boundsFor(scene);
  if(Number(scene?.grid?.type)!==1||!Number.isFinite(grid)||grid<=0)throw Error('Помещение требует квадратную сетку.');
  if(![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isFinite))throw Error('Некорректный размер помещения.');
  // In v1.2 rooms the art covers the full background. Respect one-cell walls,
  // and reserve a 2x2 landing by the south door; legacy scenes remain usable.
  const inside={x:bounds.x+grid,y:bounds.y+grid,width:bounds.width-2*grid,height:bounds.height-2*grid};
  if(inside.width<3*grid||inside.height<3*grid)throw Error('Внутренняя сцена слишком мала для станков.');
  const entry={x:bounds.x+Math.floor((bounds.width/grid-2)/2)*grid,
    y:bounds.y+bounds.height-3*grid,width:2*grid,height:2*grid};
  return {inside,entry,bounds,grid};
}
export function interiorPlacementProblem(scene,rect){
  if(!scene?.flags?.[SYSTEM]?.interiorOf)return '';
  const {inside,entry}=interiorLayout(scene);
  if(rect.x<inside.x||rect.y<inside.y||rect.x+rect.width>inside.x+inside.width||rect.y+rect.height>inside.y+inside.height)
    return 'Оставьте по одной клетке вдоль стен помещения.';
  if(rectOverlap(rect,entry))return 'Нельзя застраивать проход у входной двери.';
  return '';
}
export function chooseFreeSpawn(scene,preferred,{width=1,height=1,ignoreTokenId=''}={}){
  const grid=Number(scene?.grid?.size);const b=boundsFor(scene);
  if(!Number.isFinite(grid)||grid<=0)throw Error('Неверная сетка целевой сцены.');
  const w=Number(width)*grid,h=Number(height)*grid;
  if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)throw Error('Неверный размер токена.');
  const occupied=[...[...(scene?.tokens||[])].filter(t=>t.id!==ignoreTokenId).map(t=>({x:Number(t.x),y:Number(t.y),width:Number(t.width||1)*grid,height:Number(t.height||1)*grid})),
    ...[...(scene?.tiles||[])].filter(t=>t.flags?.[SYSTEM]?.buildingId||t.flags?.[SYSTEM]?.blockPlacement).map(t=>({x:Number(t.x),y:Number(t.y),width:Number(t.width),height:Number(t.height)}))];
  const insideRoom=!!scene?.flags?.[SYSTEM]?.interiorOf;
  const layout=insideRoom?interiorLayout(scene):null;
  const base={x:b.x+Math.round((preferred.x-b.x)/grid)*grid,y:b.y+Math.round((preferred.y-b.y)/grid)*grid};
  const candidate=(x,y)=>({x,y,width:w,height:h});
  const free=(r)=>r.x>=b.x&&r.y>=b.y&&r.x+w<=b.x+b.width&&r.y+h<=b.y+b.height&&
    (!layout||(r.x>=layout.inside.x&&r.y>=layout.inside.y&&r.x+w<=layout.inside.x+layout.inside.width&&r.y+h<=layout.inside.y+layout.inside.height))&&
    !occupied.some(o=>rectOverlap(r,o));
  // Nearest viable square. Search radius capped; never place the token off scene.
  for(let radius=0;radius<=15;radius++)for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
    if(Math.max(Math.abs(dx),Math.abs(dy))!==radius)continue;
    const r=candidate(base.x+dx*grid,base.y+dy*grid);
    if(free(r))return {x:r.x,y:r.y};
  }
  throw Error('Нет свободного места для токена около входа. Освободите клетки у двери.');
}
/** Resolve a particular actor-linked survivor token, never trusting browser permissions. */
export function validateTransferToken(scene,tokenId,user,actors){
  if(typeof tokenId!=='string'||!tokenId||tokenId.length>128)throw Error('Не выбран токен для перехода.');
  const token=scene?.tokens?.get?.(tokenId)||[...(scene?.tokens||[])].find(t=>t.id===tokenId);
  if(!token)throw Error('Выбранный токен отсутствует на исходной сцене.');
  const actor=actors.get?.(token.actorId);
  if(!actor||actor.type!=='survivor')throw Error('Перемещать между помещениями можно только выживших.');
  if(!user?.isGM&&!actor.testUserPermission?.(user,'OWNER'))throw Error('Нет прав на перемещение чужого персонажа.');
  return token;
}
export function destinationNearBuilding(placement,grid){
  return {x:Number(placement.x)+Math.floor((Number(placement.width)/grid-1)/2)*grid,
    y:Number(placement.y)+Number(placement.height)+grid};
}

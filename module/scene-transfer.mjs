/** PROJECT GENESIS v1.3: GM-authoritative token transit between linked scenes.
 * Destination is created first; source is removed only after a successful create.
 */
import {chooseFreeSpawn,destinationNearBuilding,interiorLayout,validateTransferToken} from './interior-rules.mjs';
const SYSTEM='project-genesis';
export async function moveSurvivorToken({source,target,tokenId,user,actors,placement,action,transferId}){
  if(!source?.id||!target?.id||source.id===target.id)throw Error('Некорректная пара сцен для перехода.');
  if(!['enter','exit'].includes(action))throw Error('Неизвестное направление перехода.');
  if(action==='enter'&&(source.id!==placement.sceneId||target.id!==placement.interiorSceneId))
    throw Error('Сцены не соответствуют входу в помещение.');
  if(action==='exit'&&(source.id!==placement.interiorSceneId||target.id!==placement.sceneId))
    throw Error('Сцены не соответствуют выходу из помещения.');
  const token=validateTransferToken(source,tokenId,user,actors);
  const grid=Number(target.grid?.size);
  const preferred=action==='enter'?(()=>{const {entry}=interiorLayout(target);return {x:entry.x,y:entry.y};})():
    destinationNearBuilding(placement,grid);
  const position=chooseFreeSpawn(target,preferred,{width:token.width||1,height:token.height||1});
  // toObject returns a copy of the TokenDocument, preserving actor linkage,
  // disposition, vision, lighting and custom flags. Never copy document _id.
  if(typeof token.toObject!=='function')throw Error('Не удалось прочитать данные токена.');
  const data=token.toObject();
  delete data._id;delete data._stats;
  data.x=position.x;data.y=position.y;
  data.flags={...(data.flags||{}),[SYSTEM]:{...(data.flags?.[SYSTEM]||{}),transitId:transferId||'',transitFrom:source.id}};
  let created=[];
  try{
    created=await target.createEmbeddedDocuments('Token',[data]);
    if(created?.length!==1||!created[0]?.id)throw Error('Не удалось создать токен на целевой сцене.');
    await source.deleteEmbeddedDocuments('Token',[token.id]);
  }catch(error){
    if(created?.length){
      try{await target.deleteEmbeddedDocuments('Token',created.map(t=>t.id));}
      catch(rollback){console.error('PROJECT GENESIS: failed to undo interrupted token transfer',error,rollback);
        throw Error('Не удалось отменить перенос токена: ведущему необходимо проверить обе сцены.');}
    }
    throw error;
  }
  return {tokenId:created[0].id,sceneId:target.id,actorId:token.actorId};
}

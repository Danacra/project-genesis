/** PROJECT GENESIS 0.7.1 — GM-authoritative scene utility networks. */
import {planTake} from './industry-rules.mjs';
import {withWorldLock} from './logistics.mjs';
import {placementHealth,sceneGeometry} from './map-rules.mjs';
import {NETWORK_TYPES,NETWORK_LIMITS,DEVICES,routeNetwork,networkCost,
  validateNetworkLink,asNetworkTiles,simulateNetworks,validateManualRoute} from './network-rules.mjs';
import {BUILDING_BY_ID} from './industry-data.mjs';
import {roomPowerLoads,sceneInteriorOf} from './structure-rules.mjs';
const SYSTEM='project-genesis',TIMEOUT=60000;
const awaiting=new Map(),seen=new Set();
const list=a=>Array.isArray(a)?a:[];
const generateId=()=>globalThis.crypto?.randomUUID?.().replaceAll('-','')??`${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
const gmLeader=()=>game.users.filter(u=>u.isGM&&u.active).sort((a,b)=>a.id.localeCompare(b.id))[0];
const message=(text,err=false)=>err?ui.notifications.error(text):ui.notifications.info(text);
const schema=colony=>colony.system.infrastructure||{links:[],priorities:[],processed:[]};
const updateInfra=(patch)=>Object.fromEntries(Object.entries(patch).map(([key,value])=>[`system.infrastructure.${key}`,value]));
function requireUser(id){const user=game.users.get(id);if(!user?.active)throw Error('Игрок отключён.');
  if(!user.isGM&&!game.actors.some(a=>a.type==='survivor'&&a.testUserPermission(user,'OWNER')))
    throw Error('Для инженерных работ нужен принадлежащий игроку персонаж.');
  return user;
}
function requireColony(id){const colony=game.actors.get(id);if(!colony||colony.type!=='colony')throw Error('Колония не найдена.');return colony;}
function newProcessed(infra,id){return [...list(infra.processed).slice(-199),id];}
function getPlacement(colony,id){const found=list(colony.system.industry?.placements).find(p=>p.id===id);
  if(!found)throw Error('Здание отсутствует в реестре колонии.');return found;}
function requirePlaced(colony,id){const p=getPlacement(colony,id);const scene=game.scenes.get(p.sceneId);
  if(p.status!=='finished'||!scene||placementHealth(p,scene,scene.tiles?.get?.(p.tileId))!=='ok')
    throw Error('Для подключения здание должно быть завершено и иметь исправный тайл на сцене.');
  return p;
}
export function getNetworkSimulation(colony){
  const infra=schema(colony),placements=list(colony.system.industry?.placements);
  const healthy=placements.filter(p=>!sceneInteriorOf(game.scenes.get(p.sceneId))&&p.status==='finished'&&
    placementHealth(p,game.scenes.get(p.sceneId),game.scenes.get(p.sceneId)?.tiles?.get?.(p.tileId))==='ok');
  const statuses=Object.fromEntries(list(infra.links).map(l=>[l.id,validateNetworkLink(l,game.scenes.get(l.sceneId))]));
  const priorities=Object.fromEntries(list(infra.priorities).map(p=>[p.id,p.priority]));
  return {simulation:simulateNetworks(healthy,infra.links,{priorities,interiorLoads:roomPowerLoads(placements,game.scenes),linkStatuses:Object.fromEntries(Object.entries(statuses).map(([k,v])=>[k,v==='ok'?'ok':'invalid']))}),statuses};
}
// Only late-stage manufacturing needs automatic power. Early science/crafting still
// runs by hand, avoiding a technology deadlock in fresh colonies.
export function placementOperational(colony,placement,precomputedSimulation=null){
  const config=DEVICES[placement?.buildingId];
  if(!config)return false;
  const parentId=sceneInteriorOf(game.scenes.get(placement.sceneId));
  if(parentId){
    const parent=(precomputedSimulation||getNetworkSimulation(colony).simulation).byId[parentId];
    return Boolean((config.optionalPower || !config.power || parent?.powered) &&
      (config.optionalWater || !config.water || parent?.watered));
  }
  return Boolean((precomputedSimulation||getNetworkSimulation(colony).simulation).byId[placement.id]?.operational);
}
export function stationOperational(colony,station,precomputedSimulation=null){
  if(!DEVICES[station]||(!DEVICES[station].power&&!DEVICES[station].water))return true;
  const placements=list(colony.system.industry?.placements).filter(p=>p.buildingId===station&&p.status==='finished');
  if(!placements.length)return true; // legacy 0.5 buildings may not yet be mapped
  const simulation=precomputedSimulation||getNetworkSimulation(colony).simulation;
  return placements.some(p=>placementOperational(colony,p,simulation));
}
function backupResources(colony,changes){return changes.map(c=>({_id:c._id,'system.quantity':Number(colony.items.get?.(c._id)?.system.quantity||0)}));}
async function restoreResources(colony,backup){if(backup.length)await colony.updateEmbeddedDocuments('Item',backup);}
async function doCommit(request){
  if(!/^[\w-]{12,80}$/.test(request.id||''))throw Error('Некорректный идентификатор операции.');
  const user=requireUser(request.userId),colony=requireColony(request.colonyId),infra=schema(colony);
  if(seen.has(request.id)||list(infra.processed).includes(request.id))return 'Операция уже выполнена.';
  const links=list(infra.links);
  let response='';
  if(request.action==='connect'||request.action==='gm-connect'){
    const gmFree=request.action==='gm-connect';
    if(gmFree&&!user.isGM)throw Error('Бесплатная прокладка инженерных сетей доступна только ведущему.');
    const type=request.type;
    if(!NETWORK_TYPES[type])throw Error('Выберите тип инженерной сети.');
    if(links.length>=NETWORK_LIMITS.maxLinks)throw Error('Достигнут лимит соединений колонии.');
    const a=requirePlaced(colony,request.fromId),b=requirePlaced(colony,request.toId);
    if(a.sceneId!==b.sceneId)throw Error('Оба здания должны находиться на одной сцене.');
    if(a.id===b.id)throw Error('Нельзя соединить здание с самим собой.');
    if(links.some(l=>l.type===type&&((l.fromId===a.id&&l.toId===b.id)||(l.fromId===b.id&&l.toId===a.id))))
      throw Error('Эти здания уже соединены сетью указанного типа.');
    if(!user.isGM && a.colonyId!==colony.id)throw Error('Участок не принадлежит колонии.');
    const scene=game.scenes.get(a.sceneId),grid=sceneGeometry(scene).grid;
    const route=Array.isArray(request.route)
      ?validateManualRoute(scene,colony.system.industry.placements,a.id,b.id,request.route,{links})
      :routeNetwork(scene,colony.system.industry.placements,a.id,b.id);
    if(links.reduce((n,l)=>n+list(l.tileIds).length,0)+route.length>NETWORK_LIMITS.maxTiles)
      throw Error('Достигнут лимит сегментов инженерных сетей.');
    const materials=networkCost(type,route.length);
    const plan=gmFree?null:planTake(colony.items,materials);
    const before=plan?backupResources(colony,plan.changes):[],networkId=generateId();
    let tileIds=[],debitAttempted=false;
    try{
      const created=await scene.createEmbeddedDocuments('Tile',asNetworkTiles(type,route,{networkId,colonyId:colony.id,grid,gmFree}));
      tileIds=created.map(t=>t.id);
      if(tileIds.length!==route.length||tileIds.some(x=>!x))throw Error('Не удалось создать все сегменты сети.');
      if(plan){debitAttempted=true;await colony.updateEmbeddedDocuments('Item',plan.changes);}
      const link={id:networkId,colonyId:colony.id,sceneId:scene.id,type,fromId:a.id,toId:b.id,
        route,tileIds,createdDay:game.settings.get(SYSTEM,'worldDay'),by:user.name,gmFree};
      await colony.update(updateInfra({links:[...links,link],processed:newProcessed(infra,request.id)}));
    }catch(error){
      let broken=false;
      if(debitAttempted){try{await restoreResources(colony,before);}catch(err){broken=true;console.error('GENESIS network resource rollback',err);}}
      if(tileIds.length){try{await scene.deleteEmbeddedDocuments('Tile',tileIds);}catch(err){broken=true;console.error('GENESIS network tile rollback',err);}}
      if(broken)throw Error('Ошибка отката инженерной сети: ведущий должен проверить сцену и склад вручную.');
      throw error;
    }
    response=`Проложено: ${NETWORK_TYPES[type].name}, ${route.length} клеток. ${gmFree?'Режим GM: материалы не списаны.':'Материалы списаны со склада.'}`;
  }else if(request.action==='disconnect'){
    const link=links.find(l=>l.id===request.linkId);
    if(!link)throw Error('Соединение уже удалено.');
    if(!user.isGM)throw Error('Демонтировать сети может только ведущий.');
    const scene=game.scenes.get(link.sceneId);
    if(!scene)throw Error('Сцена удалена; восстановите её из резервной копии.');
    if(validateNetworkLink(link,scene)!=='ok')throw Error('Сеть повреждена: сначала восстановите её или исправьте тайлы.');
    const backups=link.tileIds.map(id=>scene.tiles.get(id)?.toObject?.()).filter(Boolean);
    await scene.deleteEmbeddedDocuments('Tile',link.tileIds);
    try{await colony.update(updateInfra({links:links.filter(l=>l.id!==link.id),processed:newProcessed(infra,request.id)}));}
    catch(error){
      try{if(backups.length===link.tileIds.length)await scene.createEmbeddedDocuments('Tile',backups,{keepId:true});
        else throw Error('Недостаточно данных тайлов для отката.');}
      catch(restore){console.error('GENESIS: network remove rollback',restore);throw Error('Ошибка восстановления: GM должен проверить тайлы сети.');}
      throw error;
    }
    response=`Сеть демонтирована (${NETWORK_TYPES[link.type]?.name}). Материалы не возвращаются.`;
  }else if(request.action==='priority'){
    const value=Number(request.priority);
    if(!Number.isInteger(value)||value<0||value>9)throw Error('Приоритет должен быть целым числом от 0 до 9.');
    const building=requirePlaced(colony,request.placementId);
    const existing=list(infra.priorities).filter(p=>p.id!==building.id);
    await colony.update(updateInfra({priorities:[...existing,{id:building.id,priority:value}],processed:newProcessed(infra,request.id)}));
    response=`Приоритет «${BUILDING_BY_ID[building.buildingId]?.name||building.buildingId}» установлен: ${value}.`;
  }else if(request.action==='repair'||request.action==='maintain'){
    const isMaintenance=request.action==='maintain';
    if(!isMaintenance&&!user.isGM)throw Error('Восстанавливать тайлы бесплатно может только ведущий.');
    const link=links.find(l=>l.id===request.linkId);if(!link)throw Error('Соединение не найдено.');
    const scene=game.scenes.get(link.sceneId);if(!scene)throw Error('Исходная сцена удалена.');
    const status=validateNetworkLink(link,scene);
    if(status==='ok')throw Error('Сеть исправна и не нуждается в восстановлении.');
    if(status!=='missing-tile')throw Error('Сегмент сети изменён вручную. Сначала исправьте его положение или флаги.');
    // Only regenerate physically absent segments; never touch foreign tiles.
    if(list(link.route).length!==list(link.tileIds).length)throw Error('Нарушена структура маршрута. Восстановите данные сети из резервной копии.');
    const grid=sceneGeometry(scene).grid,missing=[];
    for(let i=0;i<link.tileIds.length;i++)if(!scene.tiles.get(link.tileIds[i]))missing.push(i);
    const fullTiles=asNetworkTiles(link.type,link.route,{networkId:link.id,colonyId:colony.id,grid,gmFree:!!link.gmFree});
    const data=missing.map(i=>fullTiles[i]);
    // A survivor fixing a broken line pays for replacement material. The GM's
    // no-cost restoration remains an administrative repair for accidental deletion.
    const plan=isMaintenance?planTake(colony.items,networkCost(link.type,missing.length)):null;
    const before=plan?backupResources(colony,plan.changes):[];
    let created=[],debitAttempted=false;
    try{
      created=await scene.createEmbeddedDocuments('Tile',data);
      if(created.length!==missing.length||created.some(t=>!t.id))throw Error('Часть сегментов не восстановлена.');
      const tileIds=[...link.tileIds];for(let i=0;i<missing.length;i++)tileIds[missing[i]]=created[i].id;
      if(plan){debitAttempted=true;await colony.updateEmbeddedDocuments('Item',plan.changes);}
      await colony.update(updateInfra({links:links.map(l=>l.id===link.id?{...l,tileIds}:l),processed:newProcessed(infra,request.id)}));
    }catch(error){
      let broken=false;
      if(debitAttempted)try{await restoreResources(colony,before);}catch(restore){broken=true;console.error('GENESIS material repair rollback failed',restore);}
      try{if(created.length)await scene.deleteEmbeddedDocuments('Tile',created.map(t=>t.id));}
      catch(restore){broken=true;console.error('GENESIS network repair rollback failed',restore);}
      if(broken)throw Error('Не удалось автоматически откатить ремонт. Ведущий должен проверить сцену и склад.');
      throw error;
    }
    response=`Восстановлено сегментов: ${created.length}. ${isMaintenance?'Ремонтные материалы израсходованы.':'Административное восстановление без списания ресурсов.'}`;
  }else throw Error('Неизвестное действие с сетью.');
  seen.add(request.id);if(seen.size>3000)seen.clear();
  return response;
}
export function networkContext(actor,user,networkSnapshot=null){
  const colony=actor?.type==='colony'?actor:game.actors.find(a=>a.type==='colony');
  if(!colony)return {available:false};
  const infra=schema(colony),placements=list(colony.system.industry?.placements),{simulation,statuses}=networkSnapshot||getNetworkSimulation(colony);
  const canConnect=user.isGM||game.actors.some(a=>a.type==='survivor'&&a.testUserPermission(user,'OWNER'));
  const buildings=placements.filter(p=>p.status==='finished').map(p=>{
    const node=simulation.byId[p.id],name=BUILDING_BY_ID[p.buildingId]?.name||p.buildingId;
    const priority=node?.priority??DEVICES[p.buildingId]?.priority??9;
    const status=node?(node.operational?(node.manual?'Ручной режим':'Работает'):
      node.powerNeed&&!node.powered?'Нет питания':'Нет водоснабжения'):'Тайл требует проверки';
    return {...p,name,sceneName:game.scenes.get(p.sceneId)?.name||'Неизвестная сцена',
      powerNeed:DEVICES[p.buildingId]?.power||0,waterNeed:DEVICES[p.buildingId]?.water||0,
      powerOut:DEVICES[p.buildingId]?.powerOut||0,waterOut:DEVICES[p.buildingId]?.waterOut||0,
      status,priority,priorityOptions:Array.from({length:10},(_,n)=>({value:n,label:`${n}${n===0?' · высший':n===9?' · низший':''}`,selected:n===priority})),
      powered:!!node?.powered,watered:!!node?.watered,working:!!node?.operational};
  });
  const buildingNames=new Map(buildings.map(b=>[b.id,b.name]));
  const links=list(infra.links).map(l=>({
    ...l,gmFree:!!l.gmFree,name:NETWORK_TYPES[l.type]?.name||l.type,sceneName:game.scenes.get(l.sceneId)?.name||'Неизвестная сцена',
    from:buildingNames.get(l.fromId)||'Удалённое здание',
    to:buildingNames.get(l.toId)||'Удалённое здание',
    length:l.route.length,health:statuses[l.id],ok:statuses[l.id]==='ok',
    canRepair:user.isGM&&statuses[l.id]==='missing-tile',
    canMaintain:statuses[l.id]==='missing-tile'&&canConnect,
    missingSegments:statuses[l.id]==='missing-tile'?list(l.tileIds).filter(id=>!game.scenes.get(l.sceneId)?.tiles?.get?.(id)).length:0,
    canRemove:user.isGM&&statuses[l.id]==='ok'}));
  return {available:true,colonyId:colony.id,canConnect,
    isGM:user.isGM,buildings,links,totals:simulation.totals,simulation,
    types:Object.entries(NETWORK_TYPES).map(([id,def])=>({id,...def}))};
}
export async function requestNetwork(details){
  const gm=gmLeader();if(!gm)return message('Для работы с сетями нужен активный ведущий.',true);
  const request={...details,kind:'genesis-network-request',id:generateId(),userId:game.user.id};
  if(gm.id===game.user.id){try{message(await withWorldLock(()=>doCommit(request)));}catch(error){message(error.message||'Ошибка сети.',true);}}
  else{
    for(const [key,time]of awaiting)if(Date.now()-time>TIMEOUT)awaiting.delete(key);
    if(awaiting.size>30)return message('Слишком много неподтверждённых запросов.',true);
    awaiting.set(request.id,Date.now());game.socket.emit(`system.${SYSTEM}`,request);message('Запрос на прокладку отправлен ведущему.');
  }
}
export function initializeNetworks(){
  game.socket.on(`system.${SYSTEM}`,(payload,senderId)=>{
    if(!payload||typeof payload!=='object')return;
    if(payload.kind==='genesis-network-result'){
      if(payload.userId!==game.user.id||!awaiting.has(payload.id))return;
      const at=awaiting.get(payload.id);awaiting.delete(payload.id);
      if(Date.now()-at<TIMEOUT)message(String(payload.message||'Готово'),!payload.ok);
      return;
    }
    if(payload.kind!=='genesis-network-request'||!game.user.isGM||gmLeader()?.id!==game.user.id)return;
    if(typeof senderId==='string'&&senderId&&senderId!==payload.userId)return;
    if(typeof payload.userId!=='string'||typeof payload.id!=='string'||typeof payload.colonyId!=='string')return;
    withWorldLock(()=>doCommit(payload)).then(msg=>game.socket.emit(`system.${SYSTEM}`,
      {kind:'genesis-network-result',id:payload.id,userId:payload.userId,ok:true,message:msg}))
    .catch(error=>game.socket.emit(`system.${SYSTEM}`,
      {kind:'genesis-network-result',id:payload.id,userId:payload.userId,ok:false,message:error.message||'Ошибка сети.'}));
  });
}
export {NETWORK_TYPES};

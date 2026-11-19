/** PROJECT GENESIS 0.8: GM-serialized player labor, map deposits and cargo. */
import {withWorldLock} from './logistics.mjs';
import {capacity,measure,fits,plus} from './rules.mjs';
import {placementHealth} from './map-rules.mjs';
import {RESOURCE_NODES,crewState,MAX_CREW_JOBS,MAX_NODES,MAX_CARGO,validActor,
  laborDays,journeyDays,validateCache,changeStock,snapNode,nodeHealth,stockFor,setStock,
  pointOf,nearby,formatCargo,packed,crewJob} from './crew-rules.mjs';
import {BUILDING_BY_ID} from './industry-data.mjs';
import {localWarehouseStatus} from './local-storage-rules.mjs';
import {iconForCode} from './icon-map.mjs';
const SYSTEM='project-genesis',TIMEOUT=60_000;
const pending=new Map(),handled=new Set();
const arr=v=>Array.isArray(v)?v:[];
const newid=()=>globalThis.crypto?.randomUUID?.().replaceAll('-','')??`${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
const gmLeader=()=>game.users.filter(u=>u.active&&u.isGM).sort((a,b)=>a.id.localeCompare(b.id))[0];
const alert=(message,error=false)=>error?ui.notifications.error(message):ui.notifications.info(message);
const day=()=>game.settings.get(SYSTEM,'worldDay');
const patch=values=>Object.fromEntries(Object.entries(values).map(([k,v])=>[`system.crew.${k}`,v]));
const mark=(s,id)=>[...arr(s.processed).slice(-249),id];
const log=(s,type,message,user)=>[{day:day(),kind:type,name:String(message).slice(0,150),by:String(user.name).slice(0,100)},...arr(s.history)].slice(0,100);
function userFor(request){const user=game.users.get(request.userId);if(!user?.active)throw Error('Игрок больше не подключён.');return user;}
function survivorFor(request,user){
  const actor=game.actors.get(request.actorId);
  if(!validActor(actor))throw Error('Нужен персонаж типа «Выживший», а не NPC.');
  if(!user.isGM&&!actor.testUserPermission(user,'OWNER'))throw Error('Нельзя управлять чужим персонажем.');
  return actor;
}
function colonyForRequest(request){const c=game.actors.get(request.colonyId);if(c?.type!=='colony')throw Error('Колония не найдена.');return c;}
function sceneFor(id){const scene=game.scenes.get(id);if(!scene)throw Error('Локальная карта не найдена.');return scene;}
function placementFor(colony,id,{finished=false}={}){
  const p=arr(colony.system.industry?.placements).find(x=>x.id===id);
  if(!p)throw Error('Сооружение не найдено на карте.');
  if(finished&&p.status!=='finished')throw Error('Это здание ещё строится.');
  const scene=sceneFor(p.sceneId);
  if(placementHealth(p,scene,scene.tiles?.get?.(p.tileId))!=='ok')throw Error('Тайл здания повреждён или перемещён.');
  return {p,scene};
}
function nodeFor(colony,id){const n=arr(crewState(colony).nodes).find(x=>x.id===id);
  if(!n)throw Error('Месторождение не найдено.');
  const scene=sceneFor(n.sceneId);
  if(nodeHealth(n,scene)!=='ok')throw Error('Месторождение на карте удалено или перемещено.');
  return {n,scene};
}
function cargoItem(c){return {name:c.name,type:c.type||'material',img:c.img||'icons/svg/stone.svg',
  system:{quantity:c.quantity,resourceCode:c.code,unitMass:c.unitMass,unitVolume:c.unitVolume,
    quality:c.quality||0,techTier:c.techTier||0,containerId:'',description:c.description||''}};}
function itemMatch(item,c){return item.type===c.type&&String(item.system.resourceCode||'')===c.code&&
  item.name===c.name&&Number(item.system.unitMass)===c.unitMass&&Number(item.system.unitVolume)===c.unitVolume&&
  Number(item.system.quality||0)===Number(c.quality||0)&&Number(item.system.techTier||0)===Number(c.techTier||0)&&
  String(item.system.description||'')===String(c.description||'')&&!(item.system.containerId||'');}
/** Credit an inventory then run a colony commit; always compensate inventory on failed state write. */
async function credit(actor,cargo,update){
  const preview=cargoItem(cargo);
  const add={mass:cargo.unitMass*cargo.quantity,volume:cargo.unitVolume*cargo.quantity};
  if(!fits(plus(measure(actor.items),add),capacity(actor)))throw Error('В инвентаре нет места для получения груза.');
  const old=actor.items.find(i=>itemMatch(i,cargo));
  const before=old?Number(old.system.quantity):0;
  if(before+cargo.quantity>999999)throw Error('Переполнен стек инвентаря.');
  let created=[],touched=false;
  try{
    if(old){await actor.updateEmbeddedDocuments('Item',[{_id:old.id,'system.quantity':before+cargo.quantity}]);touched=true;}
    else{created=await actor.createEmbeddedDocuments('Item',[preview]);touched=true;}
    await update();
  }catch(error){
    if(touched){try{if(old)await actor.updateEmbeddedDocuments('Item',[{_id:old.id,'system.quantity':before}]);
      else if(created.length)await actor.deleteEmbeddedDocuments('Item',created.map(i=>i.id));}
      catch(rollback){console.error('GENESIS crew credit rollback',rollback);throw Error('Не удалось восстановить инвентарь. Ведущий должен проверить груз вручную.');}}
    throw error;
  }
}
async function debit(actor,item,count,update){
  if(!item||!Number.isSafeInteger(count)||count<1||count>MAX_CARGO||item.type==='container'||Number(item.system.quantity)<count)
    throw Error('Недостаточно предметов для доставки.');
  const before=Number(item.system.quantity);
  try{
    await actor.updateEmbeddedDocuments('Item',[{_id:item.id,'system.quantity':before-count}]);
    await update();
  }catch(error){try{await actor.updateEmbeddedDocuments('Item',[{_id:item.id,'system.quantity':before}]);}
    catch(rollback){console.error('GENESIS crew debit rollback',rollback);throw Error('Ошибка возврата груза — проверьте инвентарь вручную.');}
    throw error;}
}
function workerReady(colony,actor){
  if(arr(crewState(colony).jobs).some(j=>j.actorId===actor.id))throw Error('У этого выжившего уже есть задание. Сначала закончите или отмените его.');
  if(Number(actor.system.survival?.fatigue||0)>=85)throw Error('Персонаж слишком устал для новой работы.');
  if(arr(crewState(colony).jobs).length>=MAX_CREW_JOBS)throw Error('Достигнут предел рабочих заданий колонии.');
}
function jobBase(actor,cargo,remaining,src,dst,user,sceneId){
  return {id:newid(),actorId:actor.id,sceneId,kind:src.kind==='node'?'harvest':dst.kind==='actor'?'pickup':'delivery',
    sourceKind:src.kind,sourceId:src.id,targetKind:dst.kind,targetId:dst.id,
    cargo,remaining,startedDay:day(),lastAdvancedDay:0,createdBy:user.name};
}
function depotAvailable(colony,placement){
  // The physical, built storehouse feeds the original centralized v0.5 factory/research stock.
  // Other building caches are isolated and must be moved to a storehouse to enter production.
  return placement.buildingId==='storehouse';
}
/** Reserve space for every incoming job, not merely the cargo already on-site.
 * This prevents multiple simultaneous deliveries from overbooking the same cache.
 * The central storehouse is backed by the shared colony Actor inventory.
 */
function checkCacheToSite(colony,to,cargo){
  const state=crewState(colony);
  const incoming=arr(state.jobs).filter(j=>j.targetKind==='placement'&&j.targetId===to.id)
    .map(j=>j.cargo);
  if(depotAvailable(colony,to)){
    let load=measure(colony.items);
    for(const item of [...incoming,cargo]){
      load=plus(load,{mass:item.unitMass*item.quantity,volume:item.unitVolume*item.quantity});
    }
    if(!fits(load,capacity(colony)))throw Error('Общий склад переполнится с учётом грузов в пути.');
  }else{
    let stock=stockFor(state,to.id);
    for(const item of incoming){
      validateCache(stock,item,to);
      stock=changeStock(stock,item,1);
    }
    validateCache(stock,cargo,to);
  }
}
function getStockCargo(state,placement,code,qty){
  if(!Number.isSafeInteger(qty)||qty<1||qty>MAX_CARGO)throw Error('Неверное количество груза.');
  const row=stockFor(state,placement.id).find(s=>s.code===code&&s.quantity>=qty);
  if(!row)throw Error('Не хватает ресурса в выбранной площадке.');
  return {...row,quantity:qty};
}
function nodeTile(kind,rect,id,colonyId){return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,rotation:0,locked:true,
  alpha:1,texture:{src:`systems/${SYSTEM}/assets/resources/${kind}.svg`},
  flags:{[SYSTEM]:{resourceNodeId:id,colonyId,resourceCode:kind,blockPlacement:true}}};}
async function perform(request){
  if(!/^[\w-]{12,80}$/.test(request.id||''))throw Error('Неверный идентификатор операции.');
  const colony=colonyForRequest(request),user=userFor(request),state=crewState(colony);
  if(handled.has(request.id)||arr(state.processed).includes(request.id))return 'Эта операция уже обработана.';
  let response='';
  if(request.action==='create-node'){
    if(!user.isGM)throw Error('Месторождения размещает только ведущий.');
    const spec=RESOURCE_NODES[request.resourceCode];if(!spec)throw Error('Неизвестный ресурс.');
    if(arr(state.nodes).length>=MAX_NODES)throw Error('Достигнут лимит месторождений на карте.');
    const amount=Number(request.amount);
    if(!Number.isSafeInteger(amount)||amount<1||amount>spec.limit)throw Error('Неверный запас месторождения.');
    const scene=sceneFor(request.sceneId),rect=snapNode(scene,{x:request.x,y:request.y});
    if(rect.x!==request.x||rect.y!==request.y)throw Error('Точку следует выбирать точно по сетке.');
    const id=newid(),data={id,colonyId:colony.id,sceneId:scene.id,tileId:'',code:spec.code,
      name:spec.name,x:rect.x,y:rect.y,remaining:amount,initial:amount};
    let tile;
    try{tile=(await scene.createEmbeddedDocuments('Tile',[nodeTile(spec.code,rect,id,colony.id)]))[0];
      if(!tile?.id)throw Error('Не удалось разместить ресурс на карте.');data.tileId=tile.id;
      await colony.update(patch({nodes:[...arr(state.nodes),data],history:log(state,'survey',`${spec.name}: ${amount}`,user),processed:mark(state,request.id)}));
    }catch(error){if(tile?.id){try{await scene.deleteEmbeddedDocuments('Tile',[tile.id]);}
      catch(e){console.error('GENESIS orphaned resource tile',e);throw Error('Сохранение прервано. Ведущему нужно проверить оставшийся тайл на карте.');}}throw error;}
    response=`На карте отмечено месторождение: ${spec.name} (${amount}).`;
  }else if(request.action==='start-harvest'){
    const actor=survivorFor(request,user);workerReady(colony,actor);
    const {n,scene}=nodeFor(colony,request.nodeId);
    const spec=RESOURCE_NODES[n.code],amount=Number(request.amount);
    if(!spec||!Number.isSafeInteger(amount)||amount<1||amount>MAX_CARGO||amount>n.remaining)throw Error('Запаса месторождения недостаточно.');
    nearby(scene,actor,{x:n.x+scene.grid.size/2,y:n.y+scene.grid.size/2});
    const cargo={code:spec.code,name:spec.name,type:'material',img:iconForCode(spec.code),
      quantity:amount,unitMass:spec.mass,unitVolume:spec.volume,quality:0,techTier:0,description:''};
    if(!packed(actor,{type:'material',system:cargo},amount))throw Error('Добыча превысит грузоподъёмность персонажа. Сначала разгрузитесь или изготовьте тележку.');
    const job=jobBase(actor,cargo,laborDays(actor,n.code,amount),{kind:'node',id:n.id},{kind:'actor',id:actor.id},user,scene.id);
    await colony.update(patch({nodes:arr(state.nodes).map(x=>x.id===n.id?{...x,remaining:x.remaining-amount}:x),
      jobs:[...arr(state.jobs),job],history:log(state,'harvest',`${actor.name}: ${spec.name} ×${amount}`,user),processed:mark(state,request.id)}));
    response=`Начата добыча: ${spec.name} ×${amount}. Рабочих суток: ${job.remaining}.`;
  }else if(request.action==='start-delivery'){
    const actor=survivorFor(request,user);workerReady(colony,actor);
    const {p,scene}=placementFor(colony,request.placementId,{finished:false});
    const token=nearby(scene,actor,pointOf(p),999999); // Must be on the target scene.
    const item=actor.items.get(request.itemId),amount=Number(request.amount),cargo=formatCargo(item,amount);
    checkCacheToSite(colony,p,cargo);
    const g=scene.grid.size,from={x:token.x+g*(token.width||1)/2,y:token.y+g*(token.height||1)/2};
    const job=jobBase(actor,cargo,journeyDays(scene,from,pointOf(p),actor,cargo),
      {kind:'actor',id:actor.id},{kind:'placement',id:p.id},user,scene.id);
    await debit(actor,item,amount,()=>colony.update(patch({jobs:[...arr(state.jobs),job],
      history:log(state,'dispatch',`${actor.name} → ${BUILDING_BY_ID[p.buildingId]?.name||p.buildingId}: ${cargo.name} ×${amount}`,user),processed:mark(state,request.id)})));
    response=`Груз отправлен: ${cargo.name} ×${amount}; доставка ${job.remaining} сут.`;
  }else if(request.action==='start-ship'||request.action==='start-pickup'){
    const actor=survivorFor(request,user);workerReady(colony,actor);
    const {p:source,scene}=placementFor(colony,request.sourceId);
    if(depotAvailable(colony,source))throw Error('Складские модули используют общий склад версии 0.5. Для их разгрузки используйте обычную передачу предметов.');
    nearby(scene,actor,pointOf(source));
    const cargo=getStockCargo(state,source,request.resourceCode,Number(request.amount));
    let target={kind:'actor',id:actor.id},duration=1;
    if(request.action==='start-ship'){
      const {p:dest,scene:destScene}=placementFor(colony,request.placementId);
      if(scene.id!==destScene.id||source.id===dest.id)throw Error('Площадки должны быть разными и находиться на одной сцене.');
      checkCacheToSite(colony,dest,cargo);
      target={kind:'placement',id:dest.id};
      duration=journeyDays(scene,pointOf(source),pointOf(dest),actor,cargo);
    }
    const before=stockFor(state,source.id),next=changeStock(before,cargo,-1);
    const job=jobBase(actor,cargo,duration,{kind:'placement',id:source.id},target,user,scene.id);
    await colony.update(patch({caches:setStock(state,source.id,next),jobs:[...arr(state.jobs),job],
      history:log(state,'ship',`${actor.name}: ${cargo.name} ×${cargo.quantity}`,user),processed:mark(state,request.id)}));
    response=`Задание принято: ${cargo.name} ×${cargo.quantity}, ${duration} сут.`;
  }else if(request.action==='finish'||request.action==='cancel'){
    const job=arr(state.jobs).find(j=>j.id===request.jobId);
    if(!job)throw Error('Задание не найдено.');
    const actor=survivorFor({actorId:job.actorId},user),cargo=job.cargo;
    if(request.action==='finish'&&job.remaining>0)throw Error(`До завершения осталось ${job.remaining} сут.`);
    const jobs=arr(state.jobs).filter(j=>j.id!==job.id);
    const tail={jobs,history:log(state,request.action,`${actor.name}: ${cargo.name} ×${cargo.quantity}`,user),processed:mark(state,request.id)};
    if(request.action==='cancel'){
      if(job.sourceKind==='node'){
        const node=arr(state.nodes).find(n=>n.id===job.sourceId);if(!node)throw Error('Исходное месторождение удалено; обратитесь к ведущему.');
        await colony.update(patch({...tail,nodes:arr(state.nodes).map(n=>n.id===node.id?{...n,remaining:n.remaining+cargo.quantity}:n)}));
      }else if(job.sourceKind==='actor'){
        await credit(actor,cargo,()=>colony.update(patch(tail)));
      }else{
        const {p:source}=placementFor(colony,job.sourceId);
        const capCheck=stockFor(state,source.id);validateCache(capCheck,cargo,source);
        const next=changeStock(capCheck,cargo,1);
        await colony.update(patch({...tail,caches:setStock(state,source.id,next)}));
      }
      response='Задание отменено, зарезервированный груз возвращён.';
    }else if(job.targetKind==='actor'){
      await credit(actor,cargo,()=>colony.update(patch(tail)));
      response=`Получено: ${cargo.name} ×${cargo.quantity} → ${actor.name}.`;
    }else{
      const {p:dest}=placementFor(colony,job.targetId);
      if(depotAvailable(colony,dest)){
        await credit(colony,cargo,()=>colony.update(patch(tail)));
        response=`На общий склад доставлено ${cargo.name} ×${cargo.quantity}.`;
      }else{
        const stock=stockFor(state,dest.id);
        validateCache(stock,cargo,dest);
        const caches=setStock(state,dest.id,changeStock(stock,cargo,1));
        await colony.update(patch({...tail,caches}));
        response=`На площадку «${BUILDING_BY_ID[dest.buildingId]?.name||dest.buildingId}» доставлено ${cargo.name} ×${cargo.quantity}.`;
      }
    }
  }else if(request.action==='remove-empty'||request.action==='remove-node'){
    if(!user.isGM)throw Error('Удалять месторождения может только ведущий.');
    const {n,scene}=nodeFor(colony,request.nodeId);
    if(request.action==='remove-empty'&&n.remaining>0)throw Error('Можно убрать только полностью истощённое месторождение.');
    if(arr(state.jobs).some(j=>j.sourceKind==='node'&&j.sourceId===n.id))throw Error('Месторождение участвует в задании.');
    const tile=scene.tiles.get(n.tileId)?.toObject();
    await scene.deleteEmbeddedDocuments('Tile',[n.tileId]);
    try{await colony.update(patch({nodes:arr(state.nodes).filter(x=>x.id!==n.id),processed:mark(state,request.id)}));}
    catch(error){try{
      // Foundry v13 supports keepId for embedded Document creation.
      // Otherwise the saved resource node would still point to a missing tile.
      const restored=await scene.createEmbeddedDocuments('Tile',[{...tile,_id:n.tileId}],{keepId:true});
      if(restored[0]?.id!==n.tileId)throw Error('Новый тайл получил другой ID.');
    }catch(restore){console.error('GENESIS restore node failure',restore);throw Error('Проверьте карту: не удалось восстановить ресурсный тайл с прежним ID.');}throw error;}
    response='Месторождение удалено с карты без изменения запасов и параметров персонажей.';
  }else throw Error('Неизвестная операция экспедиции.');
  handled.add(request.id);return response;
}
export async function requestCrew(data){
  const lead=gmLeader();if(!lead)return alert('Для заданий требуется активный ведущий (GM).',true);
  const request={...data,kind:'crew-request',id:newid(),userId:game.user.id};
  if(lead.id===game.user.id){try{alert(await withWorldLock(()=>perform(request)));}
    catch(error){alert(error.message,true);}return;}
  for(const [id,time] of pending)if(Date.now()-time>TIMEOUT)pending.delete(id);
  if(pending.size>=35)return alert('Много неподтверждённых заданий. Проверьте соединение с ведущим.',true);
  pending.set(request.id,Date.now());game.socket.emit(`system.${SYSTEM}`,request);
  alert('Задание отправлено ведущему.');
}
export function initializeCrew(){
  game.socket.on(`system.${SYSTEM}`,(r,senderId)=>{
    if(r?.kind==='crew-result'){
      if(r.userId!==game.user.id||!pending.has(r.id))return;
      const timestamp=pending.get(r.id);pending.delete(r.id);
      if(Date.now()-timestamp<=TIMEOUT)alert(r.message,!r.ok);return;
    }
    if(r?.kind!=='crew-request'||!game.user.isGM||gmLeader()?.id!==game.user.id)return;
    if(typeof senderId==='string'&&senderId&&senderId!==r.userId)return;
    if(typeof r.userId!=='string'||typeof r.id!=='string'||typeof r.colonyId!=='string')return;
    withWorldLock(()=>perform(r)).then(message=>game.socket.emit(`system.${SYSTEM}`,
      {kind:'crew-result',userId:r.userId,id:r.id,ok:true,message}))
      .catch(error=>game.socket.emit(`system.${SYSTEM}`,
        {kind:'crew-result',userId:r.userId,id:r.id,ok:false,message:error.message}));
  });
}
export async function advanceCrewDay(colony){
  const s=crewState(colony);if(!arr(s.jobs).length)return;
  const currentDay=day();
  const advanced=s.jobs.map(j=>crewJob(j,currentDay));
  if(advanced.every((j,i)=>j.lastAdvancedDay===s.jobs[i].lastAdvancedDay))return;
  await colony.update(patch({jobs:advanced}));
}
export function crewContext(actor,user){
  const colony=actor.type==='colony'?actor:game.actors.find(a=>a.type==='colony');
  if(!colony)return {available:false};
  const state=crewState(colony),placements=arr(colony.system.industry?.placements);
  const owner=a=>user?.isGM||a.testUserPermission(user,'OWNER');
  const survivors=game.actors.filter(a=>a.type==='survivor'&&owner(a));
  const sites=placements.map(p=>({id:p.id,buildingId:p.buildingId,name:BUILDING_BY_ID[p.buildingId]?.name||p.buildingId,
    sceneName:game.scenes.get(p.sceneId)?.name||'Сцена удалена',sceneId:p.sceneId,x:p.x,y:p.y,
    isStorehouse:p.buildingId==='storehouse',isLocalStore:p.buildingId==='local-store',status:p.status,
    stock:stockFor(state,p.id).map(r=>({name:r.name,code:r.code,quantity:r.quantity})),
    ...localWarehouseStatus(stockFor(state,p.id),p)}));
  const jobs=arr(state.jobs).map(j=>({id:j.id,actor:game.actors.get(j.actorId)?.name||'Неизвестный',
    name:j.cargo.name,quantity:j.cargo.quantity,remaining:j.remaining,ready:j.remaining===0,
    canAct:!!(user?.isGM||game.actors.get(j.actorId)?.testUserPermission(user,'OWNER')),
    destination:j.targetKind==='actor'?'Инвентарь':sites.find(p=>p.id===j.targetId)?.name||'Объект удалён',
    kind:({harvest:'Добыча',delivery:'Доставка',pickup:'Получение'})[j.kind]||'Перемещение'}));
  return {available:true,colonyId:colony.id,isGM:!!user?.isGM,canWork:survivors.length>0,
    resourceTypes:Object.entries(RESOURCE_NODES).map(([id,r])=>({id,name:r.name})),
    survivors:survivors.map(a=>({id:a.id,name:a.name,busy:arr(state.jobs).some(j=>j.actorId===a.id)})),
    nodes:arr(state.nodes).map(n=>({...n,sceneName:game.scenes.get(n.sceneId)?.name||'Сцена удалена',
      health:nodeHealth(n,game.scenes.get(n.sceneId)),canRemove:!!user?.isGM,canRemoveEmpty:!!user?.isGM&&n.remaining===0})),
    sites,jobs,history:arr(state.history).slice(0,30)};
}
export {RESOURCE_NODES};
// Test-only entry point; server method still validates the requester and serializes through withWorldLock.
export const __crewTest={perform};

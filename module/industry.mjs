/** PROJECT GENESIS 0.6.1 — stable scene-linked construction. */
import { RECIPES, RECIPE_BY_ID, BUILDINGS, BUILDING_BY_ID, resourceName } from './industry-data.mjs';
import { recipeState, buildingState, buildingCount, planTake, outputItem, depositPlan, refundPlan, tickQueue } from './industry-rules.mjs';
import { withWorldLock } from './logistics.mjs';
import { colonyFor } from './research.mjs';
import { stockByCode } from './research-rules.mjs';
import { assertPlacement, asTileData, tileAsset, placementHealth, assertHealthyPlacement } from './map-rules.mjs';
import { stationOperational,getNetworkSimulation } from './networks.mjs';
const SYSTEM='project-genesis', TIMEOUT=60000, MAX_JOBS=40;
const outstanding=new Map(), handled=new Set();
const array=value=>Array.isArray(value)?value:[];
const gmLeader=()=>game.users.filter(u=>u.active&&u.isGM).sort((a,b)=>a.id.localeCompare(b.id))[0]||null;
const notify=(message,error=false)=>error?ui.notifications.error(message):ui.notifications.info(message);
const day=()=>game.settings.get(SYSTEM,'worldDay');
const uid=()=>globalThis.crypto?.randomUUID?.().replaceAll('-','')??`${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
const clean=x=>String(x??'').replace(/[&<>'"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const history=(industry,kind,name,by)=>[{
  day:day(),kind,name:String(name).slice(0,120),by:String(by).slice(0,90)
},...array(industry.history)].slice(0,120);
const processed=(industry,id)=>[...array(industry.processed).slice(-199),id];
const baseIndustry=()=>({jobs:[],construction:[],buildings:[],placements:[],history:[],processed:[]});
const industryOf=colony=>colony.system.industry||baseIndustry();
function rulesNeedPower(station,colony){return !!station&&!stationOperational(colony,station);}
function getColony(id){const a=game.actors.get(id);if(!a||a.type!=='colony')throw Error('Колония не найдена.');return a;}
function getUser(userId){
  const user=game.users.get(userId);
  if(!user?.active)throw Error('Пользователь неактивен.');
  if(!user.isGM&&!game.actors.some(a=>a.type==='survivor'&&a.testUserPermission(user,'OWNER')))
    throw Error('Для работы на базе нужен принадлежащий вам персонаж.');
  return user;
}
function patchIndustry(patch){return Object.fromEntries(Object.entries(patch).map(([k,v])=>[`system.industry.${k}`,v]));}
async function rollbackDeductions(colony,plan){
  const changes=plan.changes.map(c=>({ _id:c._id,'system.quantity':
    Number(colony.items.get(c._id)?.system.quantity||0)+plan.escrow.filter(e=>e.itemId===c._id).reduce((n,e)=>n+e.count,0) }));
  await colony.updateEmbeddedDocuments('Item',changes);
}
async function debitAndCommit(colony,plan,statePatch){
  // An embedded document batch may fail after the server accepted some changes.
  // Keep the actual original quantities, never assume a complete debit occurred.
  const originals=plan.changes.map(c=>({_id:c._id,'system.quantity':Number(colony.items.get(c._id)?.system.quantity||0)}));
  try{
    await colony.updateEmbeddedDocuments('Item',plan.changes);
    await colony.update(patchIndustry(statePatch));
  }catch(error){
    try{if(originals.length)await colony.updateEmbeddedDocuments('Item',originals);}
    catch(restoreError){console.error('GENESIS: could not restore deducted resources',restoreError);
      throw Error('Ошибка отката ресурсов. GM должен проверить общий склад вручную.');}
    throw error;
  }
}
async function depositAndCommit(colony,data,update){
  const deposit=depositPlan(colony,data);
  let created=[], changed=false;
  try{
    if(deposit.targetId){
      await colony.updateEmbeddedDocuments('Item',[{_id:deposit.targetId,'system.quantity':deposit.before+data.system.quantity}]);
      changed=true;
    }else{
      created=await colony.createEmbeddedDocuments('Item',[data]);
      changed=true;
    }
    await colony.update(update);
  }catch(error){
    if(changed){
      try{
        if(deposit.targetId)await colony.updateEmbeddedDocuments('Item',[{_id:deposit.targetId,'system.quantity':deposit.before}]);
        else if(created.length)await colony.deleteEmbeddedDocuments('Item',created.map(i=>i.id));
      }catch(restoreError){console.error('GENESIS: output rollback failed',restoreError);throw Error('Не удалось отменить выдачу. GM должен проверить склад.');}
    }
    throw error;
  }
}
async function refundAndCommit(colony,reserved,statePatch){
  const refund=refundPlan(colony,reserved);
  let created=[],didUpdate=false;
  try{
    if(refund.changes.length){await colony.updateEmbeddedDocuments('Item',refund.changes.map(c=>({_id:c.id,'system.quantity':c.after})));didUpdate=true;}
    if(refund.creates.length){created=await colony.createEmbeddedDocuments('Item',refund.creates);}
    await colony.update(patchIndustry(statePatch));
  }catch(error){
    try{
      if(created.length)await colony.deleteEmbeddedDocuments('Item',created.map(i=>i.id));
      if(didUpdate)await colony.updateEmbeddedDocuments('Item',refund.changes.map(c=>({_id:c.id,'system.quantity':c.before})));
    }catch(restoreError){console.error('GENESIS: refund rollback failed',restoreError);throw Error('Ошибка при отмене: проверьте запасы вручную.');}
    throw error;
  }
}
function jobRow(name,subject,batches,days,createdBy,userId,escrow){return {
  id:uid(),subject,name,amount:batches,remaining:days,startedDay:day(),createdBy,userId,reserved:escrow
};}
async function commit(request){
  if(!/^[\w-]{12,80}$/.test(request.id||''))throw Error('Некорректный идентификатор операции.');
  const colony=getColony(request.colonyId),user=getUser(request.userId);
  const industry=industryOf(colony);
  if(handled.has(request.id)||array(industry.processed).includes(request.id))return 'Повторная операция проигнорирована.';
  const {action}=request;
  let result='';
  if(action==='start-recipe'){
    const status=recipeState(request.subject,colony,Number(request.amount));
    if(!status.unlocked)throw Error('Сначала исследуйте необходимую технологию.');
    if(!status.stationReady)throw Error('Не построена необходимая мастерская / лаборатория.');
    if(rulesNeedPower(status.recipe.station,colony))throw Error('Станция обесточена или не имеет необходимой сети. Проверьте вкладку «Энергия и сети».');
    if(!status.canStart)throw Error('На складе недостаточно материалов.');
    if(array(industry.jobs).length>=MAX_JOBS)throw Error('Очередь производства заполнена.');
    const r=status.recipe,plan=planTake(colony.items,r.inputs,Number(request.amount));
    const row=jobRow(r.name,r.id,Number(request.amount),r.days*Number(request.amount),user.name,user.id,plan.escrow);
    await debitAndCommit(colony,plan,{
      jobs:[...array(industry.jobs),row],history:history(industry,'start',`${r.name} ×${row.amount}`,user.name),processed:processed(industry,request.id)
    });
    result=`Добавлено в очередь: ${r.name} · ${row.remaining} сут.`;
  }else if(action==='start-building'){
    const status=buildingState(request.subject,colony);
    if(!status.unlocked)throw Error('Для здания не изучена технология.');
    if(!status.canStart)throw Error('Не хватает ресурсов или достигнут лимит этого здания.');
    if(array(industry.construction).length>=MAX_JOBS)throw Error('Очередь строительства заполнена.');
    const b=status.building,plan=planTake(colony.items,b.inputs);
    const row=jobRow(b.name,b.id,1,b.days,user.name,user.id,plan.escrow);
    // v0.5 accepted non-spatial orders. Preserve GM-only legacy entry points and
    // in-progress v0.5 jobs; every new player-initiated order requires a Scene.
    if(!request.sceneId){
      if(!user.isGM)throw Error('Сначала выберите место постройки на локальной карте.');
      await debitAndCommit(colony,plan,{
        construction:[...array(industry.construction),row],history:history(industry,'build',b.name,user.name),processed:processed(industry,request.id)
      });
      result=`Строительство начато без карты (режим совместимости): ${b.name}.`;
    }else{
      const scene=game.scenes.get(request.sceneId);
      if(!scene)throw Error('Сцена не найдена.');
      if(!scene.testUserPermission?.(game.user,'OWNER')&&!game.user.isGM)
        throw Error('Ведущий не может изменить эту сцену.');
      const rect=assertPlacement(b.id,{x:request.x,y:request.y},scene,{placements:array(industry.placements)});
      const placementId=uid();
      const placement={id:placementId,colonyId:colony.id,buildingId:b.id,sceneId:scene.id,
        tileId:'',jobId:row.id,x:rect.x,y:rect.y,width:rect.width,height:rect.height,
        status:'construction',createdDay:day(),by:user.name};
      let tile=null;
      try{
        const created=await scene.createEmbeddedDocuments('Tile',[asTileData(b.id,rect,{colonyId:colony.id,jobId:row.id,placementId})]);
        tile=created[0];if(!tile?.id)throw Error('Foundry не вернул ID стройплощадки.');
        placement.tileId=tile.id;
        await debitAndCommit(colony,plan,{
          construction:[...array(industry.construction),row],
          placements:[...array(industry.placements),placement],
          history:history(industry,'map-build',`${b.name} · ${scene.name}`,user.name),
          processed:processed(industry,request.id)
        });
      }catch(error){
        if(tile?.id){
          try{await scene.deleteEmbeddedDocuments('Tile',[tile.id]);}
          catch(cleanupError){console.error('GENESIS: leftover construction tile; GM cleanup required',cleanupError);
            throw Error('Не удалось удалить неподтверждённую стройплощадку. GM должен проверить карту.');}
        }
        throw error;
      }
      result=`Стройплощадка размещена на карте «${scene.name}»: ${b.name}, ${b.days} сут.`;
    }
  }else if(action==='place-existing'){
    if(!user.isGM)throw Error('Размещать здания, построенные до 0.6, может только ведущий.');
    const b=BUILDING_BY_ID[request.subject];if(!b)throw Error('Такое сооружение не существует.');
    const built=buildingCount(industry,b.id);
    const alreadyMapped=array(industry.placements).filter(p=>p.buildingId===b.id&&p.status==='finished').length;
    if(alreadyMapped>=built)throw Error('Все готовые здания этого типа уже отмечены на карте.');
    const scene=game.scenes.get(request.sceneId);if(!scene)throw Error('Сцена не найдена.');
    const rect=assertPlacement(b.id,{x:request.x,y:request.y},scene,{placements:array(industry.placements)});
    const placementId=uid(),legacyId=uid();
    const placement={id:placementId,colonyId:colony.id,buildingId:b.id,sceneId:scene.id,
      tileId:'',jobId:legacyId,x:rect.x,y:rect.y,width:rect.width,height:rect.height,
      status:'finished',createdDay:day(),by:user.name};
    let tile=null;
    try{
      tile=(await scene.createEmbeddedDocuments('Tile',[asTileData(b.id,rect,
        {colonyId:colony.id,jobId:legacyId,placementId,status:'finished'})]))[0];
      if(!tile?.id)throw Error('Foundry не вернул ID тайла.');
      placement.tileId=tile.id;
      await colony.update(patchIndustry({placements:[...array(industry.placements),placement],
        history:history(industry,'legacy-map',`${b.name} · ${scene.name}`,user.name),
        processed:processed(industry,request.id)}));
    }catch(error){
      if(tile?.id){
        try{await scene.deleteEmbeddedDocuments('Tile',[tile.id]);}
        catch(cleanup){console.error('GENESIS: legacy tile cleanup failed',cleanup);
          throw Error('Не удалось удалить неподтверждённый тайл, проверьте сцену.');}
      }
      throw error;
    }
    result=`Готовое здание отмечено на карте: ${b.name}.`;
  }else if(action==='repair-map'){
    if(!user.isGM)throw Error('Восстанавливать тайлы может только ведущий.');
    const placement=array(industry.placements).find(p=>p.id===request.placementId);
    if(!placement)throw Error('Здание не найдено в журнале колонии.');
    const scene=game.scenes.get(placement.sceneId);
    if(!scene)throw Error('Исходная сцена удалена. Сначала восстановите сцену.');
    const found=scene.tiles.get(placement.tileId);
    if(found)throw Error('Тайл существует. Восстановление разрешено только для удалённого тайла.');
    const rect=assertPlacement(placement.buildingId,{x:placement.x,y:placement.y},scene,
      {placements:array(industry.placements),ignoreTileId:placement.tileId});
    if(rect.width!==placement.width||rect.height!==placement.height)
      throw Error('Размер стройплощадки не соответствует текущему каталогу.');
    // A repaired Tile receives a new Foundry ID; the logical placement ID is preserved.
    let tile=null;
    try{
      tile=(await scene.createEmbeddedDocuments('Tile',[asTileData(placement.buildingId,rect,{
        colonyId:colony.id,jobId:placement.jobId,placementId:placement.id,status:placement.status})]))[0];
      if(!tile?.id)throw Error('Foundry не вернул ID восстановленного тайла.');
      await colony.update(patchIndustry({
        placements:array(industry.placements).map(p=>p.id===placement.id?{...p,tileId:tile.id}:p),
        history:history(industry,'repair',`${BUILDING_BY_ID[placement.buildingId]?.name||placement.buildingId} · ${scene.name}`,user.name),
        processed:processed(industry,request.id)
      }));
    }catch(error){
      if(tile?.id){
        try{await scene.deleteEmbeddedDocuments('Tile',[tile.id]);}
        catch(cleanup){console.error('GENESIS: repaired tile cleanup failed',cleanup);
          throw Error('Сохранение не удалось и созданный тайл не удалён. Проверьте карту вручную.');}
      }
      throw error;
    }
    result=`Тайл восстановлен: ${BUILDING_BY_ID[placement.buildingId]?.name||placement.buildingId}. Повторного расхода ресурсов нет.`;
  }else if(action==='collect'){
    const job=array(industry.jobs).find(x=>x.id===request.jobId);
    if(!job)throw Error('Задание уже отсутствует в очереди.');
    if(job.remaining>0)throw Error('Производство ещё не завершено.');
    const recipe=RECIPE_BY_ID[job.subject];if(!recipe)throw Error('Неизвестный рецепт в очереди.');
    const item=outputItem(recipe,job.amount);
    await depositAndCommit(colony,item,patchIndustry({
      jobs:array(industry.jobs).filter(x=>x.id!==job.id),
      history:history(industry,'collect',`${recipe.name} ×${item.system.quantity}`,user.name),
      processed:processed(industry,request.id)
    }));
    result=`Получено со станка: ${recipe.name} ×${item.system.quantity}.`;
  }else if(action==='complete-building'){
    const job=array(industry.construction).find(x=>x.id===request.jobId);
    if(!job)throw Error('Стройка уже отсутствует.');
    if(job.remaining>0)throw Error('Здание ещё строится.');
    const b=BUILDING_BY_ID[job.subject];if(!b)throw Error('Неизвестное здание в очереди.');
    const built=buildingCount(industry,b.id);
    if(built>=b.max)throw Error('Достигнут лимит зданий этого типа.');
    const buildings=array(industry.buildings).filter(x=>x.id!==b.id);
    buildings.push({id:b.id,count:built+1,builtDay:day(),lastClaimDay:array(industry.buildings).find(x=>x.id===b.id)?.lastClaimDay||0});
    const science=colony.system.science;
    const placement=array(industry.placements).find(p=>p.jobId===job.id);
    let tile=null,scene=null;
    if(placement){
      scene=game.scenes.get(placement.sceneId);
      tile=scene?.tiles.get(placement.tileId);
      assertHealthyPlacement(placement,scene,tile);
      await scene.updateEmbeddedDocuments('Tile',[{_id:tile.id,'texture.src':tileAsset(b.id,true),
        'flags.project-genesis.status':'finished'}]);
    }
    try{await colony.update({...patchIndustry({
      buildings,construction:array(industry.construction).filter(x=>x.id!==job.id),
      placements:placement?array(industry.placements).map(p=>p.id===placement.id?{...p,status:'finished'}:p):array(industry.placements),
      history:history(industry,'finished',b.name,user.name),processed:processed(industry,request.id)
    }),...(b.facility?{'system.science.facilities':[...new Set([...array(science.facilities),b.facility])]}:{})});}
    catch(error){
      if(tile&&scene){
        try{await scene.updateEmbeddedDocuments('Tile',[{_id:tile.id,'texture.src':tileAsset(b.id,false),
          'flags.project-genesis.status':'construction'}]);}
        catch(restore){console.error('GENESIS: could not restore construction tile',restore);
          throw Error('Ошибка завершения: вид стройплощадки не восстановлен. Проверьте карту вручную.');}
      }
      throw error;
    }
    result=`Построено: ${b.name}. ${b.facility?'Станок активирован.':''}`;
  }else if(action==='cancel'){
    const field=request.queue==='construction'?'construction':'jobs';
    const job=array(industry[field]).find(x=>x.id===request.jobId);
    if(!job)throw Error('Задание не найдено.');
    if(!user.isGM&&job.userId!==user.id)throw Error('Отменить чужой заказ может только GM.');
    const placement=field==='construction'?array(industry.placements).find(p=>p.jobId===job.id):null;
    const scene=placement?game.scenes.get(placement.sceneId):null;
    const tile=placement?scene?.tiles.get(placement.tileId):null;
    if(placement)assertHealthyPlacement(placement,scene,tile);
    const tileBackup=tile?.toObject?.();
    if(tile)await scene.deleteEmbeddedDocuments('Tile',[tile.id]);
    try{await refundAndCommit(colony,job.reserved,{
      [field]:array(industry[field]).filter(x=>x.id!==job.id),
      ...(placement?{placements:array(industry.placements).filter(p=>p.id!==placement.id)}:{}),
      history:history(industry,'cancel',job.name,user.name),processed:processed(industry,request.id)
    });}
    catch(error){
      if(tileBackup){
        try{await scene.createEmbeddedDocuments('Tile',[tileBackup],{keepId:true});}
        catch(restore){console.error('GENESIS: could not recreate canceled construction tile',restore);
          throw Error('Не удалось вернуть стройплощадку после ошибки отмены. Проверьте сцену и склад.');}
      }
      throw error;
    }
    result=`Отменено: ${job.name}. Материалы возвращены.`;
  }else if(action==='harvest'){
    const b=BUILDING_BY_ID[request.subject];
    const current=array(industry.buildings).find(x=>x.id===request.subject);
    if(!b?.harvest||!current?.count)throw Error('Такое хозяйство ещё не построено.');
    if(current.lastClaimDay>=day())throw Error('Продукция уже получена сегодня.');
    if(!stationOperational(colony,b.id))throw Error('Хозяйственный объект не обеспечен энергией или водой.');
    const item=outputItem({name:b.harvest.name,description:b.description,output:b.harvest},current.count);
    await depositAndCommit(colony,item,patchIndustry({
      buildings:array(industry.buildings).map(x=>x.id===b.id?{...x,lastClaimDay:day()}:x),
      history:history(industry,'harvest',`${b.harvest.name} ×${item.system.quantity}`,user.name),
      processed:processed(industry,request.id)
    }));
    result=`Получено хозяйством: ${b.harvest.name} ×${item.system.quantity}.`;
  }else throw Error('Неизвестное производственное действие.');
  handled.add(request.id);
  if(handled.size>3000)handled.clear();
  return result;
}
export function industryContext(actor,user){
  const colony=colonyFor(actor);
  if(!colony)return {available:false};
  const industry=industryOf(colony),stock=stockByCode(colony.items),
    canAct=user.isGM||game.actors.some(a=>a.type==='survivor'&&a.testUserPermission(user,'OWNER'));
  const networkSimulation=getNetworkSimulation(colony).simulation;
  const craft=RECIPES.map(r=>{
    const status=recipeState(r.id,colony,1,stock);
    const stationOnline=stationOperational(colony,r.station,networkSimulation);
    return {...r,...status,stationReady:status.stationReady&&stationOnline,stationName:r.station?BUILDING_BY_ID[r.station]?.name||r.station:'Ручная работа',
      outputName:r.name,outputQuantity:r.output.quantity,canQueue:canAct&&status.canStart&&stationOnline};
  });
  const buildings=BUILDINGS.map(b=>{
    const status=buildingState(b.id,colony,stock);
    const house=array(industry.buildings).find(x=>x.id===b.id);
    const mappedFinished=array(industry.placements).filter(p=>p.buildingId===b.id&&p.status==='finished').length;
    return {...b,...status,canQueue:canAct&&status.canStart,
      legacyUnmapped:Math.max(0,status.built-mappedFinished),
      canPlaceLegacy:user.isGM&&status.built>mappedFinished,
      techName:status.unlocked?'Изучено':'Нужна технология',
      harvested:!!b.harvest&&!!house?.count&&house.lastClaimDay>=day(),
      canHarvest:canAct&&!!b.harvest&&!!house?.count&&house.lastClaimDay<day()&&stationOperational(colony,b.id,networkSimulation)};
  });
  const jobs=array(industry.jobs).map(job=>({...job,ready:job.remaining<=0,canCancel:canAct&&(user.isGM||job.userId===user.id)}));
  const construction=array(industry.construction).map(job=>{
    const placement=array(industry.placements).find(p=>p.jobId===job.id);
    return {...job,ready:job.remaining<=0,canCancel:canAct&&(user.isGM||job.userId===user.id),
      mapped:!!placement,sceneName:placement?game.scenes.get(placement.sceneId)?.name||'Неизвестная сцена':'Без карты',
      mapSceneId:placement?.sceneId||'',mapX:placement?.x||0,mapY:placement?.y||0};
  });
  return {available:true,colonyName:colony.name,colonyId:colony.id,canAct,
    craft,buildings,jobs,construction,history:array(industry.history).slice(0,30),
    builtCount:array(industry.buildings).reduce((n,b)=>n+b.count,0),
    queueCount:jobs.length+construction.length,day:day(),
    placements:array(industry.placements).map(p=>{
      const scene=game.scenes.get(p.sceneId),tile=scene?.tiles?.get(p.tileId);
      const health=placementHealth(p,scene,tile);
      return {...p,name:BUILDING_BY_ID[p.buildingId]?.name||p.buildingId,
        sceneName:scene?.name||'Удалённая сцена',isFinished:p.status==='finished',
        mapOk:health==='ok',canRepair:user.isGM&&health==='missing-tile',
        mapProblem:({
          'missing-scene':'Сцена удалена','missing-tile':'Тайл отсутствует',
          'foreign-tile':'Неверные флаги тайла','moved-tile':'Тайл перемещён',
          'status-mismatch':'Неверный статус тайла'
        })[health]||''};
    })};
}
export async function advanceIndustryDay(colony){
  if(!colony||colony.type!=='colony')return;
  const state=tickQueue(industryOf(colony));
  if(state.jobs.length||state.construction.length)
    await colony.update(patchIndustry(state));
}
export async function requestIndustry(params){
  const gm=gmLeader();if(!gm)return notify('Нужен активный ведущий (GM) для производства.',true);
  const request={...params,kind:'genesis-industry-request',id:uid(),userId:game.user.id};
  if(gm.id===game.user.id){
    try{notify(await withWorldLock(()=>commit(request)));}catch(error){notify(error.message||'Ошибка производства.',true);}
  }else{
    for(const [id,at]of outstanding)if(Date.now()-at>TIMEOUT)outstanding.delete(id);
    if(outstanding.size>=30)return notify('Очередь неподтверждённых запросов переполнена.',true);
    outstanding.set(request.id,Date.now());game.socket.emit(`system.${SYSTEM}`,request);
    notify('Запрос отправлен ведущему.');
  }
}
export function initializeIndustry(){
  game.socket.on(`system.${SYSTEM}`,(payload,senderId)=>{
    if(!payload||typeof payload!=='object')return;
    if(payload.kind==='genesis-industry-result'){
      if(payload.userId!==game.user.id||!outstanding.has(payload.id))return;
      const at=outstanding.get(payload.id);outstanding.delete(payload.id);
      if(Date.now()-at<TIMEOUT)notify(String(payload.message||'Готово'),!payload.ok);
      return;
    }
    if(payload.kind!=='genesis-industry-request'||!game.user.isGM||gmLeader()?.id!==game.user.id)return;
    if(typeof senderId==='string'&&senderId&&senderId!==payload.userId)return;
    if(typeof payload.userId!=='string'||typeof payload.id!=='string'||typeof payload.colonyId!=='string')return;
    withWorldLock(()=>commit(payload)).then(message=>{
      game.socket.emit(`system.${SYSTEM}`,{kind:'genesis-industry-result',id:payload.id,userId:payload.userId,ok:true,message});
    }).catch(error=>{
      game.socket.emit(`system.${SYSTEM}`,{kind:'genesis-industry-result',id:payload.id,userId:payload.userId,ok:false,message:error.message||'Ошибка производства.'});
    });
  });
}
export { RECIPES, BUILDINGS };

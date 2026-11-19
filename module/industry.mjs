/** PROJECT GENESIS 0.6.1 — stable scene-linked construction. */
import { RECIPES, RECIPE_BY_ID, BUILDINGS, BUILDING_BY_ID, resourceName } from './industry-data.mjs';
import { recipeState, buildingState, buildingCount, planTake, outputItem, depositPlan, refundPlan, tickQueue } from './industry-rules.mjs';
import { withWorldLock } from './logistics.mjs';
import { colonyFor } from './research.mjs';
import { stockByCode, effectiveUnlocked } from './research-rules.mjs';
import { tierUpgrade,tierOf,stationSupportsRecipe } from './building-progress.mjs';
import { validateStagedInputs,craftLoadFits } from './crafting-rules.mjs';
import { assertPlacement, asTileData, tileAsset, placementHealth, assertHealthyPlacement, validateTileLink } from './map-rules.mjs';
import { stationOperational,placementOperational,getNetworkSimulation } from './networks.mjs';
import {isInteriorBuilding,isCraftStation,salvageFor,structureBlockers,assertCanPlaceInside,assertInteriorOwnership} from './structure-rules.mjs';
import {capacity,summarizeInventory} from './rules.mjs';
import {RESOURCE_NODES,crewState,stockFor,setStock} from './crew-rules.mjs';
import {iconForCode} from './icon-map.mjs';
import {LOCAL_WAREHOUSE,warehouseNearStation,localStockCounts,planLocalTake,restoreLocalTake,localOutput} from './local-storage-rules.mjs';
const SYSTEM='project-genesis', TIMEOUT=60000, MAX_JOBS=40;
const outstanding=new Map(), craftAwaiters=new Map(), handled=new Set();
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
async function refundAndCommit(colony,reserved,statePatch,extraUpdates={}){
  const refund=refundPlan(colony,reserved);
  let created=[],didUpdate=false;
  try{
    if(refund.changes.length){await colony.updateEmbeddedDocuments('Item',refund.changes.map(c=>({_id:c.id,'system.quantity':c.after})));didUpdate=true;}
    if(refund.creates.length){created=await colony.createEmbeddedDocuments('Item',refund.creates);}
    await colony.update({...patchIndustry(statePatch),...extraUpdates});
  }catch(error){
    try{
      if(created.length)await colony.deleteEmbeddedDocuments('Item',created.map(i=>i.id));
      if(didUpdate)await colony.updateEmbeddedDocuments('Item',refund.changes.map(c=>({_id:c.id,'system.quantity':c.before})));
    }catch(restoreError){console.error('GENESIS: refund rollback failed',restoreError);throw Error('Ошибка при отмене: проверьте запасы вручную.');}
    throw error;
  }
}
function jobRow(name,subject,batches,days,createdBy,userId,escrow,sourcePlacementId='',stationPlacementId=''){return {
  id:uid(),subject,name,amount:batches,remaining:days,startedDay:day(),createdBy,userId,reserved:escrow,
  sourcePlacementId,outputPlacementId:sourcePlacementId,stationPlacementId
};}
async function commit(request){
  if(!/^[\w-]{12,80}$/.test(request.id||''))throw Error('Некорректный идентификатор операции.');
  const colony=getColony(request.colonyId),user=getUser(request.userId);
  const industry=industryOf(colony);
  if(handled.has(request.id)||array(industry.processed).includes(request.id))return 'Повторная операция проигнорирована.';
  const {action}=request;
  let result='';
  if(action==='craft-now'){
    const placement=array(industry.placements).find(p=>p.id===request.stationPlacementId);
    const recipe=RECIPE_BY_ID[request.subject];
    if(!recipe||!recipe.station||!placement||placement.status!=='finished'||!(stationSupportsRecipe(placement,recipe)||(!recipe.station&&placement.buildingId==='bench')))
      throw Error('У станка нет этого чертежа или требуется улучшение уровня.');
    if(!effectiveUnlocked(colony.system.science).has(recipe.techId))
      throw Error('Чертёж ещё не исследован.');
    const scene=game.scenes.get(placement.sceneId);
    assertHealthyPlacement(placement,scene,scene?.tiles?.get?.(placement.tileId));
    if(!placementOperational(colony,placement))throw Error('Станок обесточен или не подключён к необходимым сетям.');
    if(array(industry.jobs).some(j=>j.stationPlacementId===placement.id&&Number(j.remaining)>0))
      throw Error('Станок сейчас занят производственным заказом.');
    if(!user.isGM){
      const grid=Number(scene.grid?.size)||100;
      const nearby=[...(scene.tokens||[])].some(token=>{
        const actor=game.actors.get(token.actorId);
        if(actor?.type!=='survivor'||!actor.testUserPermission(user,'OWNER'))return false;
        const dx=Math.max(0,placement.x-Number(token.x),Number(token.x)-(placement.x+placement.width));
        const dy=Math.max(0,placement.y-Number(token.y),Number(token.y)-(placement.y+placement.height));
        return Math.max(dx,dy)<=2*grid;
      });
      if(!nearby)throw Error('Подойдите своим токеном к станку на этой сцене.');
    }
    validateStagedInputs(recipe,request.staged);
    const product=outputItem(recipe,1);
    const sourceKind=String(request.sourceKind||'');
    const updated={history:history(industry,'craft',`${recipe.name} ×${product.system.quantity} · ${sourceKind}`,user.name),
      processed:processed(industry,request.id)};
    if(sourceKind==='local'){
      const store=array(industry.placements).find(p=>p.id===request.sourcePlacementId);
      if(!warehouseNearStation(placement,store,game.scenes))throw Error('Локальный склад не связан с этим станком.');
      const ss=game.scenes.get(store.sceneId);
      assertHealthyPlacement(store,ss,ss?.tiles?.get?.(store.tileId));
      const before=stockFor(crewState(colony),store.id);
      const taken=planLocalTake(before,recipe.inputs,1);
      const output=localOutput(taken.stock,product,store); // capacity validated before any write
      await colony.update({...patchIndustry(updated),'system.crew.caches':setStock(crewState(colony),store.id,output)});
    }else{
      const actor=sourceKind==='colony'?colony:sourceKind==='actor'?game.actors.get(request.sourceActorId):null;
      if(!actor||!['survivor','colony'].includes(actor.type))throw Error('Источник материалов не найден.');
      if(sourceKind==='actor'){
        if(!user.isGM&&!actor.testUserPermission(user,'OWNER'))throw Error('Можно крафтить только из собственного инвентаря.');
        if(!user.isGM&&![...(scene.tokens||[])].some(t=>t.actorId===actor.id))
          throw Error('Для крафта из личного инвентаря разместите токен выжившего рядом со станком.');
      }
      const plan=planTake(actor.items,recipe.inputs,1);
      craftLoadFits(actor.items,plan,product,capacity(actor));
      const originals=plan.changes.map(c=>({_id:c._id,'system.quantity':Number(actor.items.get(c._id)?.system.quantity||0)}));
      let debited=false,created=[];
      try{
        // Keep original stacks; do not delete them before the operation is committed.
        debited=true;
        await actor.updateEmbeddedDocuments('Item',plan.changes);
        created=await actor.createEmbeddedDocuments('Item',[product]);
        await colony.update(patchIndustry(updated));
      }catch(error){
        try{
          if(created.length)await actor.deleteEmbeddedDocuments('Item',created.map(item=>item.id));
          if(debited)await actor.updateEmbeddedDocuments('Item',originals);
        }catch(restore){console.error('GENESIS: crafting rollback failed',restore);
          throw Error('Не удалось откатить крафт: GM должен сверить инвентарь вручную.');}
        throw error;
      }
    }
    result=`Изготовлено: ${recipe.name} ×${product.system.quantity}.`;
  }else if(action==='start-recipe'){
    const localId=String(request.sourcePlacementId||'');
    let warehouse=null,localStock=[];
    if(localId){
      const station=array(industry.placements).find(p=>p.id===request.stationPlacementId);
      warehouse=array(industry.placements).find(p=>p.id===localId);
      if(!warehouseNearStation(station,warehouse,game.scenes))
        throw Error('Локальный склад должен быть готов и находиться на наружной карте этого станка.');
      const wscene=game.scenes.get(warehouse.sceneId);
      assertHealthyPlacement(warehouse,wscene,wscene?.tiles?.get?.(warehouse.tileId));
      localStock=stockFor(crewState(colony),localId);
    }
    const status=recipeState(request.subject,colony,Number(request.amount),localId?localStockCounts(localStock):null);
    if(!status.unlocked)throw Error('Сначала исследуйте необходимую технологию.');
    if(!status.stationReady)throw Error('Не построена необходимая мастерская / лаборатория.');
    if(request.stationPlacementId){
      const placement=array(industry.placements).find(p=>p.id===request.stationPlacementId);
      if(!placement||placement.status!=='finished'||!stationSupportsRecipe(placement,status.recipe))
        throw Error('Этот станок не производит рецепт или требует повышения уровня.');
      const scene=game.scenes.get(placement.sceneId);
      assertHealthyPlacement(placement,scene,scene?.tiles?.get?.(placement.tileId));
      if(!placementOperational(colony,placement))throw Error('Станок не работает: проверьте внешнее питание помещения и подключение инженерных сетей.');
    }else if(rulesNeedPower(status.recipe.station,colony))throw Error('Станция обесточена или не имеет необходимой сети. Проверьте вкладку «Энергия и сети».');
    if(!status.canStart)throw Error('На складе недостаточно материалов.');
    if(array(industry.jobs).length>=MAX_JOBS)throw Error('Очередь производства заполнена.');
    const r=status.recipe;
    const workingStation=array(industry.placements).find(p=>p.id===request.stationPlacementId);
    const speed=[0,1,.8,.65][tierOf(workingStation)];
    const queueDays=Math.max(1,Math.ceil(r.days*Number(request.amount)*speed));
    if(localId){
      // Single Actor update writes both source cache and the production order.
      // If it rejects, neither part is committed; retry cannot debit twice.
      const plan=planLocalTake(localStock,r.inputs,Number(request.amount));
      const row=jobRow(r.name,r.id,Number(request.amount),queueDays,user.name,user.id,plan.reserved,localId,String(request.stationPlacementId||''));
      await colony.update({...patchIndustry({
        jobs:[...array(industry.jobs),row],history:history(industry,'start',`${r.name} ×${row.amount} · локальный склад`,user.name),processed:processed(industry,request.id)
      }),'system.crew.caches':setStock(crewState(colony),localId,plan.stock)});
    }else{
      const plan=planTake(colony.items,r.inputs,Number(request.amount));
      const row=jobRow(r.name,r.id,Number(request.amount),queueDays,user.name,user.id,plan.escrow,'',String(request.stationPlacementId||''));
      await debitAndCommit(colony,plan,{
        jobs:[...array(industry.jobs),row],history:history(industry,'start',`${r.name} ×${row.amount}`,user.name),processed:processed(industry,request.id)
      });
    }
    result=`Добавлено в очередь: ${r.name} · ${queueDays} сут.`;
  }else if(action==='upgrade-building'){
    const placement=array(industry.placements).find(p=>p.id===request.placementId);
    if(!placement||placement.status!=='finished')throw Error('Сначала постройте здание.');
    const scene=game.scenes.get(placement.sceneId),tile=scene?.tiles?.get?.(placement.tileId);
    assertHealthyPlacement(placement,scene,tile);
    const plan=tierUpgrade(placement);
    const free=!!request.gmFree;
    if(free&&!user.isGM)throw Error('Бесплатно улучшать здания может только GM.');
    if(!free&&!effectiveUnlocked(colony.system.science).has(plan.techId))
      throw Error('Требуется изучение: '+plan.techId+'.');
    const newPlacements=array(industry.placements).map(p=>p.id===placement.id?{...p,tier:plan.next}:p);
    const update={placements:newPlacements,history:history(industry,'upgrade',`${plan.building.name} · уровень ${plan.next}`,user.name),
      processed:processed(industry,request.id)};
    const previousTexture=tile.texture?.src||'';
    // Do not replace user-authored art. Only swap standard package sprites.
    const standard=`systems/${SYSTEM}/assets/buildings/${plan.building.id}`;
    const replaceArt=previousTexture.startsWith(standard)&&previousTexture.endsWith('.png');
    if(replaceArt)await tile.update({'texture.src':tileAsset(plan.building.id,true,plan.next),
      [`flags.${SYSTEM}.tier`]:plan.next});
    try{
      if(free)await colony.update(patchIndustry(update));
      else await debitAndCommit(colony,planTake(colony.items,plan.inputs),update);
    }catch(error){
      if(replaceArt){try{await tile.update({'texture.src':previousTexture,[`flags.${SYSTEM}.tier`]:plan.current});}
        catch(e){console.error('GENESIS: upgrade art rollback failed',e);}}
      throw error;
    }
    result=`Улучшено: ${plan.building.name} · уровень ${plan.next}${free?' (GM бесплатно)':''}.`;
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
      assertCanPlaceInside(b.id,scene);
      assertInteriorOwnership(colony,scene);
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
  }else if(action==='gm-instant-build'){
    if(!user.isGM)throw Error('Размещать готовые здания без ресурсов может только ведущий.');
    const b=BUILDING_BY_ID[request.subject];
    if(!b)throw Error('Неизвестное сооружение.');
    // GM creative placement is deliberately outside the normal construction cap.
    // The cap remains enforced for resource-funded player construction.
    const built=buildingCount(industry,b.id);
    const scene=game.scenes.get(request.sceneId);
    if(!scene)throw Error('Откройте сцену, на которой хотите разместить здание.');
    assertCanPlaceInside(b.id,scene);
    assertInteriorOwnership(colony,scene);
    const rect=assertPlacement(b.id,{x:request.x,y:request.y},scene,{placements:array(industry.placements)});
    const placementId=uid(),jobId=uid();
    const placement={id:placementId,colonyId:colony.id,buildingId:b.id,sceneId:scene.id,
      tileId:'',jobId,x:rect.x,y:rect.y,width:rect.width,height:rect.height,
      status:'finished',gmInstant:true,createdDay:day(),by:user.name};
    const previous=array(industry.buildings).find(x=>x.id===b.id);
    const buildings=[...array(industry.buildings).filter(x=>x.id!==b.id),
      {id:b.id,count:built+1,builtDay:day(),lastClaimDay:previous?.lastClaimDay||0}];
    const science=colony.system.science;
    let tile;
    try{
      tile=(await scene.createEmbeddedDocuments('Tile',[asTileData(b.id,rect,
        {colonyId:colony.id,jobId,placementId,status:'finished'})]))[0];
      if(!tile?.id)throw Error('Foundry не создал тайл здания.');
      placement.tileId=tile.id;
      await colony.update({...patchIndustry({buildings,placements:[...array(industry.placements),placement],
        history:history(industry,'gm-instant',`${b.name} · ${scene.name}`,user.name),
        processed:processed(industry,request.id)}),
        ...(b.facility?{'system.science.facilities':[...new Set([...array(science.facilities),b.facility])]}:{})});
    }catch(error){
      if(tile?.id){try{await scene.deleteEmbeddedDocuments('Tile',[tile.id]);}
        catch(cleanup){console.error('GENESIS: failed to rollback instant building tile',cleanup);
          throw Error('Здание не сохранено, проверьте оставшийся тайл на карте вручную.');}}
      throw error;
    }
    result=`Ведущий разместил готовое здание без затрат: ${b.name}.`;
  }else if(action==='place-existing'){
    if(!user.isGM)throw Error('Размещать здания, построенные до 0.6, может только ведущий.');
    const b=BUILDING_BY_ID[request.subject];if(!b)throw Error('Такое сооружение не существует.');
    const built=buildingCount(industry,b.id);
    const alreadyMapped=array(industry.placements).filter(p=>p.buildingId===b.id&&p.status==='finished').length;
    if(alreadyMapped>=built)throw Error('Все готовые здания этого типа уже отмечены на карте.');
    const scene=game.scenes.get(request.sceneId);if(!scene)throw Error('Сцена не найдена.');
    assertCanPlaceInside(b.id,scene);
    assertInteriorOwnership(colony,scene);
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
  }else if(action==='dismantle'){
    if(!user.isGM)throw Error('Разбирать готовые здания может только ведущий.');
    if(!['salvage','erase'].includes(request.mode))throw Error('Выберите обычную разборку или административное удаление.');
    const p=array(industry.placements).find(x=>x.id===request.placementId);
    if(!p)throw Error('Постройка не найдена.');
    const b=BUILDING_BY_ID[p.buildingId];if(!b)throw Error('Неизвестный тип постройки.');
    const reasons=structureBlockers(p,{links:colony.system.infrastructure?.links,
      caches:colony.system.crew?.caches,jobs:colony.system.crew?.jobs,
      placements:industry.placements,productionJobs:industry.jobs,buildingCount:buildingCount(industry,p.buildingId),
      missionStage:colony.system.mission?.stage});
    if(reasons.length)throw Error(reasons.join(' '));
    const scene=game.scenes.get(p.sceneId),tile=scene?.tiles?.get?.(p.tileId);
    // Administrative removal must work even after a GM manually removed the Tile
    // or the Scene. Never delete a foreign Tile from an unrelated placement.
    const health=placementHealth(p,scene,tile);
    const ownedTile=!!(scene&&tile&&health!=='foreign-tile'&&validateTileLink(p,tile));
    if(request.mode==='salvage'&&health!=='ok')
      throw Error('Для возврата материалов сначала восстановите корректную связь с тайлом. Административное удаление (GM) доступно без тайла.');
    const built=buildingCount(industry,b.id);
    if(built<1)throw Error('Счётчик построек повреждён. Нужна проверка ведущего.');
    const interior=p.interiorSceneId?game.scenes.get(p.interiorSceneId):null;
    if(interior){
      const used=['tiles','tokens','walls','drawings','sounds','notes','templates','regions'].some(k=>[...(interior[k]||[])].length>0) ||
        [...(interior.lights||[])].some(light=>
          !(light.flags?.[SYSTEM]?.managedInteriorLight && light.flags?.[SYSTEM]?.placementId===p.id));
      if(used)throw Error('Внутренняя сцена содержит токены или созданные вручную объекты. Переместите персонажей наружу и уберите свои объекты, затем повторите удаление.');
    }
    if(request.mode==='salvage'&&p.gmInstant)
      throw Error('Это здание создано ведущим бесплатно. Возврат стройматериалов недоступен; используйте «Удалить (GM)».');
    const materials=request.mode==='salvage'?salvageFor(b.id):{};
    const reserve=Object.entries(materials).map(([code,count])=>{
      const spec=RESOURCE_NODES[code]||RECIPES.find(r=>r.output.code===code)?.output||{};
      return {itemId:'',count,code,name:resourceName(code),type:'material',
        img:iconForCode(code),
        unitMass:Number(spec.mass??spec.unitMass??1),unitVolume:Number(spec.volume??spec.unitVolume??1),
        quality:0,techTier:0,description:'Возврат при разборке',containerId:''};
    });
    const newBuildings=array(industry.buildings).filter(x=>x.id!==b.id);
    if(built>1)newBuildings.push({...array(industry.buildings).find(x=>x.id===b.id),count:built-1});
    if(b.id==='storehouse'){
      const cap=capacity(colony),load=summarizeInventory(colony.items).exactLoad;
      const refundMass=reserve.reduce((n,r)=>n+r.count*r.unitMass,0);
      const refundVolume=reserve.reduce((n,r)=>n+r.count*r.unitVolume,0);
      if(load.mass+refundMass>cap.mass-750||load.volume+refundVolume>cap.volume-1500)
        throw Error('После удаления склада ресурсов станет больше допустимой вместимости. Сначала разгрузите склад.');
    }
    const facilities=b.facility&&built===1?
      array(colony.system.science?.facilities).filter(id=>id!==b.facility):array(colony.system.science?.facilities);
    const tileBackup=ownedTile?tile.toObject():null;
    if(ownedTile)await scene.deleteEmbeddedDocuments('Tile',[tile.id]);
    try{
      await refundAndCommit(colony,reserve,{
        buildings:newBuildings,placements:array(industry.placements).filter(x=>x.id!==p.id),
        history:history(industry,'dismantle',`${b.name} · ${request.mode==='salvage'?'разборка':'удаление GM'}`,user.name),
        processed:processed(industry,request.id)
      },{
        ...(b.facility&&built===1?{'system.science.facilities':facilities}:{}),
        'system.crew.caches':array(colony.system.crew?.caches).filter(x=>x.placementId!==p.id),
        'system.infrastructure.priorities':array(colony.system.infrastructure?.priorities).filter(x=>x.id!==p.id)
      });
    }catch(error){
      if(ownedTile){
        try{
          const restored=await scene.createEmbeddedDocuments('Tile',[tileBackup],{keepId:true});
          if(restored[0]?.id!==tile.id)throw Error('ID тайла изменился.');
        }catch(recovery){console.error('GENESIS: dismantling rollback failed',recovery);
          throw Error('Сохранение разборки прервано; не удалось восстановить тайл. Проверьте карту и склад вручную.');}
      }
      throw error;
    }
    if(interior){try{await interior.delete();}catch(error){
      console.warn('GENESIS: empty interior scene could not be deleted',error);
      ui.notifications.warn('Здание разобрано, но пустую внутреннюю сцену пришлось оставить. Удалите её вручную после проверки.');}}
    result=`${b.name}: ${request.mode==='salvage'?'разобрано, пригодные материалы возвращены на общий склад':'удалено без возврата ресурсов'}.${!ownedTile&&tile?' Тайл с чужими флагами не тронут.':!ownedTile?' Отсутствующий тайл не помешал удалению.':''}`;
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
    const update=patchIndustry({
      jobs:array(industry.jobs).filter(x=>x.id!==job.id),
      history:history(industry,'collect',`${recipe.name} ×${item.system.quantity}`,user.name),
      processed:processed(industry,request.id)
    });
    if(job.outputPlacementId){
      const w=array(industry.placements).find(p=>p.id===job.outputPlacementId);
      if(!w||w.buildingId!==LOCAL_WAREHOUSE||w.status!=='finished')
        throw Error('Локальный склад производства больше недоступен.');
      const scene=game.scenes.get(w.sceneId);
      assertHealthyPlacement(w,scene,scene?.tiles?.get?.(w.tileId));
      const s=crewState(colony),stock=localOutput(stockFor(s,w.id),item,w);
      await colony.update({...update,'system.crew.caches':setStock(s,w.id,stock)});
      result=`Получено: ${recipe.name} ×${item.system.quantity} → локальный склад.`;
    }else{
      await depositAndCommit(colony,item,update);
      result=`Получено со станка: ${recipe.name} ×${item.system.quantity}.`;
    }
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
    const tile=placement?scene?.tiles?.get?.(placement.tileId):null;
    if(placement&&!user.isGM)assertHealthyPlacement(placement,scene,tile);
    // GM may recover a construction order even if the Scene/Tile was manually removed.
    // Never delete a foreign Tile just because a damaged record points to its ID.
    const trustedTile=!!(placement&&scene&&tile&&validateTileLink(placement,tile));
    const tileBackup=trustedTile?tile.toObject():null;
    if(trustedTile)await scene.deleteEmbeddedDocuments('Tile',[tile.id]);
    try{
      const updated={
        [field]:array(industry[field]).filter(x=>x.id!==job.id),
        ...(placement?{placements:array(industry.placements).filter(p=>p.id!==placement.id)}:{}),
        history:history(industry,'cancel',job.name,user.name),processed:processed(industry,request.id)
      };
      if(job.sourcePlacementId){
        const w=array(industry.placements).find(p=>p.id===job.sourcePlacementId);
        if(!w||w.buildingId!==LOCAL_WAREHOUSE||w.status!=='finished')throw Error('Локальный склад для возврата недоступен.');
        const wscene=game.scenes.get(w.sceneId);
        assertHealthyPlacement(w,wscene,wscene?.tiles?.get?.(w.tileId));
        const stock=restoreLocalTake(stockFor(crewState(colony),w.id),job.reserved,w);
        await colony.update({...patchIndustry(updated),'system.crew.caches':setStock(crewState(colony),w.id,stock)});
      }else await refundAndCommit(colony,job.reserved,updated);
    }
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
    const mappedFarms=array(industry.placements).filter(p=>p.buildingId===b.id&&p.status==='finished');
    const levelCount=mappedFarms.reduce((sum,p)=>sum+tierOf(p),0)+Math.max(0,current.count-mappedFarms.length);
    const item=outputItem({name:b.harvest.name,description:b.description,output:b.harvest},levelCount);
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
export function industryContext(actor,user,precomputedSimulation=null){
  const colony=colonyFor(actor);
  if(!colony)return {available:false};
  const industry=industryOf(colony),stock=stockByCode(colony.items),
    canAct=user.isGM||game.actors.some(a=>a.type==='survivor'&&a.testUserPermission(user,'OWNER'));
  const networkSimulation=precomputedSimulation||getNetworkSimulation(colony).simulation;
  const stationOnlineCache=new Map();
  const isStationOnline=station=>{
    if(!stationOnlineCache.has(station))stationOnlineCache.set(station,stationOperational(colony,station,networkSimulation));
    return stationOnlineCache.get(station);
  };
  const craft=RECIPES.map(r=>{
    const status=recipeState(r.id,colony,1,stock);
    const stationOnline=isStationOnline(r.station);
    return {...r,...status,hiddenForPlayer:!user.isGM&&!status.unlocked,
      stationReady:status.stationReady&&stationOnline,stationName:r.station?BUILDING_BY_ID[r.station]?.name||r.station:'Ручная работа',
      outputName:r.name,outputQuantity:r.output.quantity,tierRequired:r.minTier||1,canQueue:canAct&&status.canStart&&stationOnline};
  });
  const indoor=Boolean(globalThis.canvas?.scene?.flags?.[SYSTEM]?.interiorOf);
  const builtById=new Map(array(industry.buildings).map(b=>[b.id,b]));
  const mappedById=new Map();
  const constructionByJob=new Map();
  for(const p of array(industry.placements)){
    if(p.status==='finished')mappedById.set(p.buildingId,(mappedById.get(p.buildingId)||0)+1);
    if(p.jobId)constructionByJob.set(p.jobId,p);
  }
  const buildings=BUILDINGS.map(b=>{
    const status=buildingState(b.id,colony,stock);
    const house=builtById.get(b.id);
    const mappedFinished=mappedById.get(b.id)||0;
    const allowedHere=!indoor||['bench','fieldLab','furnace','bioLab','electronicsLab'].includes(b.id);
    return {...b,...status,canQueue:allowedHere&&canAct&&status.canStart,
      indoorRestricted:!allowedHere,hiddenForPlayer:!user.isGM&&!status.unlocked,
      canGMInstant:user.isGM&&allowedHere,
      legacyUnmapped:Math.max(0,status.built-mappedFinished),
      canPlaceLegacy:user.isGM&&status.built>mappedFinished,
      techName:status.unlocked?'Изучено':'Нужна технология',
      harvested:!!b.harvest&&!!house?.count&&house.lastClaimDay>=day(),
      canHarvest:canAct&&!!b.harvest&&!!house?.count&&house.lastClaimDay<day()&&isStationOnline(b.id)};
  });
  const jobs=array(industry.jobs).map(job=>({...job,ready:job.remaining<=0,canCancel:canAct&&(user.isGM||job.userId===user.id),
    storageName:job.sourcePlacementId?'Локальный склад':'Общий склад'}));
  const construction=array(industry.construction).map(job=>{
    const placement=constructionByJob.get(job.id);
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
      const tier=tierOf(p);
      const next=tier<3?tierUpgrade(p):null;
      const canUpgrade=!!next&&effectiveUnlocked(colony.system.science).has(next.techId);
      return {...p,tier,tierMark:['','◆','◆◆','◆◆◆'][tier],
        upgradeCost:next?Object.entries(next.inputs).map(([code,count])=>`${resourceName(code)} ×${count}`).join(' · '):'',
        upgradeTech:next?.techId||'',nextTier:next?.next||0,
        canUpgrade:canAct&&canUpgrade&&p.status==='finished'&&health==='ok'&&!p.gmInstant,
        canGMUpgrade:user.isGM&&!!next&&p.status==='finished'&&health==='ok',
        name:BUILDING_BY_ID[p.buildingId]?.name||p.buildingId,
        sceneName:scene?.name||'Удалённая сцена',isFinished:p.status==='finished',
        canDismantle:user.isGM&&p.status==='finished'&&health==='ok'&&!p.gmInstant,
        canErase:user.isGM&&p.status==='finished',
        gmInstant:!!p.gmInstant,
        canCancelSite:user.isGM&&p.status==='construction'&&constructionByJob.has(p.jobId),
        isRoom:isInteriorBuilding(p.buildingId),isStation:isCraftStation(p.buildingId),
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
/** Returns only after the GM commits the item exchange. Required by the craft animation. */
export async function requestCraftNow(params){
  const gm=gmLeader();if(!gm)throw Error('Для изготовления нужен активный GM.');
  const request={...params,kind:'genesis-industry-request',action:'craft-now',id:uid(),userId:game.user.id};
  if(gm.id===game.user.id)return await withWorldLock(()=>commit(request));
  return await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{craftAwaiters.delete(request.id);reject(Error('Сервер не подтвердил изготовление за 60 секунд. Проверьте инвентарь.'));},60000);
    craftAwaiters.set(request.id,{resolve,reject,timeout,userId:game.user.id});
    try{game.socket.emit(`system.${SYSTEM}`,request);}catch(error){clearTimeout(timeout);craftAwaiters.delete(request.id);reject(error);}
  });
}
export function initializeIndustry(){
  game.socket.on(`system.${SYSTEM}`,(payload,senderId)=>{
    if(!payload||typeof payload!=='object')return;
    if(payload.kind==='genesis-industry-result'){
      const waiter=craftAwaiters.get(payload.id);
      if(waiter){
        if(waiter.userId!==payload.userId)return;
        clearTimeout(waiter.timeout);craftAwaiters.delete(payload.id);
        if(payload.ok)waiter.resolve(String(payload.message||'Изготовлено.'));
        else waiter.reject(Error(String(payload.message||'Ошибка крафта.')));
        return;
      }
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

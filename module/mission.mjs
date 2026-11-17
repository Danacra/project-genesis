/** PROJECT GENESIS 1.0: durable, GM-coordinated finale. */
import {withWorldLock} from './logistics.mjs';
import {missionStage,planMissionOperation} from './mission-rules.mjs';
const SYSTEM='project-genesis',TIMEOUT=60_000;
const pending=new Map();
const gmLeader=()=>game.users.filter(u=>u.active&&u.isGM).sort((a,b)=>a.id.localeCompare(b.id))[0]||null;
const notify=(s,err=false)=>err?ui.notifications.error(s):ui.notifications.info(s);
const uid=()=>globalThis.crypto?.randomUUID?.().replaceAll('-','')??`${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
const day=()=>game.settings.get(SYSTEM,'worldDay');
/** Reuses the same ship marker after a failed operation; never creates duplicate tiles. */
async function ensureShipMarker(colony){
  const placement=(colony.system.industry?.placements||[]).find(p=>p.buildingId==='assembly-dock'&&p.status==='finished');
  if(!placement)throw Error('Для сборки корабля разместите готовый сборочный док на карте.');
  const scene=game.scenes.get(placement.sceneId);
  if(!scene)throw Error('Сцена сборочного дока не найдена.');
  const existing=[...(scene.tiles||[])].find(t=>t.flags?.[SYSTEM]?.missionColonyId===colony.id);
  if(existing)return existing.id;
  const [created]=await scene.createEmbeddedDocuments('Tile',[{
    x:Math.round(placement.x+placement.width*.12),y:Math.round(placement.y+placement.height*.08),
    width:Math.round(placement.width*.76),height:Math.round(placement.height*.84),
    rotation:0,alpha:1,hidden:false,locked:true,
    texture:{src:`systems/${SYSTEM}/assets/mission/ship.svg`},
    flags:{[SYSTEM]:{missionColonyId:colony.id}}
  }]);
  return created.id;
}
export async function replayMissionOperation(plan){
  if(plan?.version!==1)throw Error('Некорректный сохранённый этап строительства корабля.');
  const colony=game.actors.get(plan.colonyId);
  if(!colony||colony.type!=='colony')throw Error('Колония финальной экспедиции не найдена.');
  const current=Number(colony.system.mission?.stage||0);
  if(current<plan.stage)throw Error('Этап колонии не совпадает с сохранённой операцией.');
  if(current<plan.nextStage){
    // Absolute quantities protect inventory from re-debiting after a crash or retry.
    if(plan.inventory.length){
      for(const row of plan.inventory)if(!colony.items.get(row.id))throw Error('Компонент сохранённой сборки удалён — требуется вмешательство GM.');
      await colony.updateEmbeddedDocuments('Item',plan.inventory.map(r=>({_id:r.id,'system.quantity':r.quantity})));
    }
    const shipTileId=plan.nextStage===3?await ensureShipMarker(colony):colony.system.mission?.shipTileId||'';
    await colony.update({'system.mission.stage':plan.nextStage,
      'system.mission.events':plan.events,'system.mission.shipTileId':shipTileId});
  }
  // Stage value is the commit marker; cleanup failure cannot double-charge items.
  try{await game.settings.set(SYSTEM,'missionOperation',{});}
  catch(e){console.warn('PROJECT GENESIS: mission journal cleanup postponed',e);}
  if(current<plan.nextStage){
    try{await ChatMessage.create({content:plan.nextStage===4?
      '<div class="genesis-chat"><h2>PROJECT GENESIS · ВОЗВРАЩЕНИЕ</h2><p>Корабль экспедиции подготовлен и запущен. Поздравляем с завершением кампании!</p></div>':
      `<div class="genesis-chat"><strong>PROJECT GENESIS · Строительство корабля</strong><p>Завершён этап ${plan.nextStage}/4.</p></div>`});}
    catch(e){console.warn('PROJECT GENESIS: mission message failed',e);}
  }
  return {stage:plan.nextStage,completed:plan.nextStage===4};
}
async function commit(request){
  if(typeof request.id!=='string'||!/^[A-Za-z0-9_-]{12,80}$/.test(request.id))throw Error('Недопустимый идентификатор операции.');
  const u=game.users.get(request.userId),colony=game.actors.get(request.colonyId);
  if(!u?.active||!colony||colony.type!=='colony')throw Error('Нет доступа к колонии или игрок отключён.');
  if(!u.isGM&&!game.actors.some(a=>a.type==='survivor'&&a.testUserPermission(u,'OWNER')))
    throw Error('Для подготовки корабля требуется собственный выживший.');
  if(!Number.isInteger(request.expectedStage)||request.expectedStage!==Number(colony.system.mission?.stage||0))
    throw Error('Состояние сборки изменилось. Обновите лист перед повторным действием.');
  if(Number(colony.system.mission?.stage||0)===3&&!u.isGM)throw Error('Финальный запуск выполняет только ведущий.');
  const plan=planMissionOperation(colony,day(),u.name);
  await game.settings.set(SYSTEM,'missionOperation',plan); // durable write before any side effect
  await replayMissionOperation(plan);
  return plan.nextStage===4?'Экспедиция завершена!':'Этап сборки завершён.';
}
export async function requestMission(colonyId){
  const gm=gmLeader();if(!gm)return notify('Для финальной экспедиции нужен ведущий.',true);
  const expectedStage=Number(game.actors.get(colonyId)?.system.mission?.stage||0);
  const request={kind:'genesis-mission-request',id:uid(),userId:game.user.id,colonyId,expectedStage};
  if(gm.id===game.user.id){
    try{notify(await withWorldLock(()=>commit(request)));}catch(e){notify(e.message,true);}
  }else{
    for(const [id,at]of pending)if(Date.now()-at>TIMEOUT)pending.delete(id);
    if(pending.size>=25)return notify('Слишком много запросов сборки.',true);
    pending.set(request.id,Date.now());game.socket.emit(`system.${SYSTEM}`,request);
    notify('Заявка на этап сборки отправлена ведущему.');
  }
}
export function initializeMission(){
  // An interruption is retried with absolute targets at the first GM startup.
  if(game.user?.isGM && gmLeader()?.id===game.user.id){
    const pendingOp=game.settings?.get?.(SYSTEM,'missionOperation');
    if(pendingOp?.version===1){
      void withWorldLock(()=>replayMissionOperation(pendingOp),{allowMissionRecovery:true})
        .catch(e=>{console.error('PROJECT GENESIS: mission recovery failed',e);
          notify('Финальная сборка требует восстановления. Проверьте консоль и повторите вход ведущего.',true);});
    }
  }
  game.socket.on(`system.${SYSTEM}`,(payload,senderId)=>{
    if(!payload||typeof payload!=='object')return;
    if(payload.kind==='genesis-mission-result'){
      if(payload.userId!==game.user.id||!pending.has(payload.id))return;
      const at=pending.get(payload.id);pending.delete(payload.id);
      if(Date.now()-at<TIMEOUT)notify(String(payload.message||''),!payload.ok);
      return;
    }
    if(payload.kind!=='genesis-mission-request'||!game.user.isGM||gmLeader()?.id!==game.user.id)return;
    if(typeof senderId==='string'&&senderId&&senderId!==payload.userId)return;
    if(typeof payload.userId!=='string'||typeof payload.colonyId!=='string'||!Number.isInteger(payload.expectedStage))return;
    withWorldLock(()=>commit(payload)).then(message=>game.socket.emit(`system.${SYSTEM}`,
      {kind:'genesis-mission-result',id:payload.id,userId:payload.userId,ok:true,message}))
      .catch(e=>game.socket.emit(`system.${SYSTEM}`,
        {kind:'genesis-mission-result',id:payload.id,userId:payload.userId,ok:false,message:e.message}));
  });
}
export {missionStage};

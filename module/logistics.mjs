/** Serialized, GM-coordinated logistics for cooperative tables. */
import { validateMove, qty, stackSignature, dayVitals, LIMITS } from './rules.mjs';
import { planDayOperation } from './day-operation.mjs';
const SYSTEM = 'project-genesis';
let sequence = Promise.resolve();
const seenThisSession = new Set();
const awaiting = new Map();
const AWAIT_TIMEOUT_MS = 60_000;
const MAX_STACK = 999_999;
export function withWorldLock(fn,{allowDayRecovery=false,allowMissionRecovery=false}={}) {
  const guarded=()=>{
    const pending=game.settings?.get?.(SYSTEM,'dayOperation');
    if(!allowDayRecovery && pending?.version===1 &&
        game.settings.get(SYSTEM,'worldDay')===pending.day)
      throw new Error('Переход суток прерван. Сначала повторите «+1 сутки» для безопасного завершения.');
    const missionPending=game.settings?.get?.(SYSTEM,'missionOperation');
    if(!allowMissionRecovery && missionPending?.version===1)
      throw new Error('Сборка корабля не завершена. Перезапустите Foundry для восстановления операции.');
    return fn();
  };
  const next = sequence.then(guarded, guarded);
  sequence = next.catch(() => undefined);
  return next;
}
const notification = (message, error = false) => error ? ui.notifications.error(message) : ui.notifications.info(message);
function gmLeader() {return game.users.filter(u => u.active && u.isGM).sort((a,b)=>a.id.localeCompare(b.id))[0] || null;}
function journal() {return game.settings.get(SYSTEM,'logisticsJournal') || {entries:[],processed:[]};}
function actorAllowed(actor, user, asSource = false) {
  if (user?.isGM) return true;
  if (actor.type === 'colony') return true;
  if (asSource) return actor.testUserPermission(user, 'OWNER');
  return actor.type === 'survivor';
}
function authorized(request, source, target) {
  const user = game.users.get(request.userId);
  if (!user || !user.active) throw new Error('Пользователь не найден или отключён.');
  if (!actorAllowed(source,user,true) || !actorAllowed(target,user,false)) throw new Error('Нет разрешения для этого перемещения.');
}
async function writeEntry(entry, id) {
  const old = journal();
  await game.settings.set(SYSTEM, 'logisticsJournal', {
    entries: [entry, ...(old.entries || [])].slice(0,80),
    processed: [...(old.processed || []).slice(-249),id]
  });
}
function itemCore(item, amount, containerId) {
  const {quantity, ...extra} = item.system.toObject ? item.system.toObject() : item.system;
  return {
    name:item.name, type:item.type, img:item.img,
    system:{...extra,quantity:amount,containerId}
  };
}
async function commitTransfer(request) {
  const {id,sourceActorId,targetActorId,itemId,targetContainerId='',quantity} = request;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{12,80}$/.test(id)) throw new Error('Некорректный идентификатор операции.');
  if (seenThisSession.has(id) || journal().processed?.includes(id)) return {ok:true, duplicate:true};
  const source = game.actors.get(sourceActorId), target = game.actors.get(targetActorId);
  if (!source || !target) throw new Error('Персонаж или склад не найден.');
  authorized(request,source,target);
  const item = source.items.get(itemId);
  const count = Number(quantity);
  const plan = validateMove({source,target,item,quantity:count,containerId:targetContainerId});
  const before = qty(item);
  // Resolve and validate stacking before debiting the source.
  const signature = stackSignature(item,targetContainerId);
  const matching = plan.sameActor && before === count ? null :
    target.items.find(other => other.type !== 'container' && other.id !== item.id &&
      stackSignature(other,other.system.containerId) === signature);
  if (matching && qty(matching) + count > MAX_STACK) {
    throw new Error('Итоговый стек превысит допустимое количество (999999).');
  }
  if (plan.sameActor && before === count) {
    await source.updateEmbeddedDocuments('Item',[{_id:item.id,'system.containerId':targetContainerId}]);
  } else {
    // Subtract first, then credit receiver. The original stack remains for safe rollback.
    await source.updateEmbeddedDocuments('Item',[{_id:item.id,'system.quantity':before-count}]);
    try {
      if (matching) {
        await target.updateEmbeddedDocuments('Item',[{_id:matching.id,'system.quantity':qty(matching)+count}]);
      } else {
        await target.createEmbeddedDocuments('Item',[itemCore(item,count,targetContainerId)]);
      }
    } catch(error) {
      try {await source.updateEmbeddedDocuments('Item',[{_id:item.id,'system.quantity':before}]);}
      catch(rollbackError) {
        console.error('PROJECT GENESIS: manual recovery needed', {error, rollbackError, request});
        throw new Error('Не удалось восстановить остаток отправителя. Проверьте оба инвентаря вручную.');
      }
      throw error;
    }
    // Best-effort cleanup only; a zero stack is invisible in the UI.
    if (before === count) {
      try { await source.deleteEmbeddedDocuments('Item',[item.id]); }
      catch(error) {console.warn('PROJECT GENESIS: zero stack cleanup failed',error);}
    }
  }
  seenThisSession.add(id);
  const entry = {
    id, day:game.settings.get(SYSTEM,'worldDay'),
    at:new Date().toISOString(), from:source.name, to:target.name,
    item:item.name, quantity:count,
    location: targetContainerId ? target.items.get(targetContainerId)?.name || 'Контейнер' : 'Основной отсек',
    user:game.users.get(request.userId)?.name || 'GM'
  };
  try {await writeEntry(entry,id);}
  catch(error) {console.error('PROJECT GENESIS: journal persistence failed',error);}
  return {ok:true, message:`${count} × ${item.name}: ${source.name} → ${target.name}`};
}
function makeId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replaceAll('-','');
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}
export async function requestTransfer(details) {
  const leader = gmLeader();
  if (!leader) return notification('Для перемещения предметов требуется активный ведущий (GM).',true);
  const request = {kind:'transfer-request',id:makeId(),userId:game.user.id,...details};
  if (leader.id === game.user.id) {
    try {const result = await withWorldLock(()=>commitTransfer(request)); notification(result.message || 'Операция уже выполнена.');}
    catch(error) {notification(error.message,true);}
  } else {
    const now=Date.now();
    for (const [pendingId,since] of awaiting) {
      if (now-since>AWAIT_TIMEOUT_MS) awaiting.delete(pendingId);
    }
    if (awaiting.size>=50) return notification('Слишком много неподтверждённых запросов. Проверьте соединение с GM.',true);
    awaiting.set(request.id,now);
    game.socket.emit(`system.${SYSTEM}`,request);
    notification('Запрос отправлен ведущему.');
  }
}
/** Plan one day using one inventory scan per actor rather than two scans per resource. */
export function planDailyConsumption(survivor, colony) {
  const sources=[survivor,...(colony && colony.id!==survivor.id?[colony]:[])];
  const stocks={food:[],water:[]};
  for (const actor of sources) {
    for (const item of actor.items) {
      if (item.type==='container' || qty(item)===0) continue;
      const code=String(item.system.resourceCode||'').trim().toLowerCase();
      if (Object.hasOwn(stocks,code)) stocks[code].push({actor,item});
    }
  }
  const changes=new Map();
  const results={};
  for (const [code,amount] of Object.entries({food:LIMITS.foodPerDay,water:LIMITS.waterPerDay})) {
    const available=stocks[code].reduce((total,{item})=>total+qty(item),0);
    results[code]=available>=amount;
    if (!results[code]) continue; // No partial consumption of unavailable resources.
    let remaining=amount;
    for (const {actor,item} of stocks[code]) {
      const subtract=Math.min(remaining,qty(item));
      if (!subtract) continue;
      if (!changes.has(actor)) changes.set(actor,[]);
      changes.get(actor).push({id:item.id,before:qty(item),after:qty(item)-subtract});
      remaining-=subtract;
      if (!remaining) break;
    }
  }
  return {fed:results.food, hydrated:results.water, changes};
}
/** Apply a persisted immutable plan. Every write sets an absolute value, so replay is safe. */
async function replayDayOperation(plan){
  const current=game.settings.get(SYSTEM,'worldDay');
  if(current===plan.nextDay){
    // The day was committed, but the cleanup may have failed or the GM restarted.
    await game.settings.set(SYSTEM,'dayOperation',{});
    return {day:plan.nextDay,recovered:true};
  }
  if(current!==plan.day)throw Error('Номер суток не соответствует незавершённой операции. Обратитесь к ведущему.');
  for(const {actorId,updates} of plan.items){
    const actor=game.actors.get(actorId);
    if(!actor)throw Error(`Отсутствует владелец суточных ресурсов (${actorId}).`);
    for(const row of updates)if(!actor.items.get(row.id))
      throw Error(`Предмет ${row.id} удалён во время незавершённого перехода суток.`);
    await actor.updateEmbeddedDocuments('Item',updates.map(row=>({_id:row.id,'system.quantity':row.quantity})));
  }
  for(const row of plan.survival){
    const actor=game.actors.get(row.actorId);
    if(!actor)throw Error(`Не найден выживший ${row.actorId} в сохранённой операции суток.`);
    await actor.update({'system.survival':row.values});
  }
  if(plan.colonyId){
    const colony=game.actors.get(plan.colonyId);
    if(!colony)throw Error('Колония из сохранённой операции суток не найдена.');
    if(plan.industry?.jobs?.length || plan.industry?.construction?.length)
      await colony.update({'system.industry.jobs':plan.industry.jobs,
        'system.industry.construction':plan.industry.construction});
    if(plan.crewJobs?.length)await colony.update({'system.crew.jobs':plan.crewJobs});
  }
  // The world day acts as the final commit marker. Everything above is replayable.
  await game.settings.set(SYSTEM,'worldDay',plan.nextDay);
  try{await game.settings.set(SYSTEM,'dayOperation',{});}
  catch(error){console.warn('PROJECT GENESIS: committed day journal cleanup will be retried',error);}
  const messages=plan.survival.map(row=>{
    const name=game.actors.get(row.actorId)?.name||row.actorId;
    return `${name}: ${row.fed?'еда ✓':'нет еды'}; ${row.hydrated?'вода ✓':'нет воды'}`;
  });
  const weatherNote=plan.weather?`Погода: ${plan.weather.name}.`:' ';
  try{await ChatMessage.create({content:`<div class="genesis-chat"><strong>PROJECT GENESIS · День ${plan.nextDay}</strong><p>${foundry.utils.escapeHTML(weatherNote)}</p><pre>${foundry.utils.escapeHTML(messages.join('\n'))}</pre></div>`});}
  catch(error){console.warn('PROJECT GENESIS: day notification failed',error);}
  notification(`Наступил день ${plan.nextDay}.`);
  return {day:plan.nextDay,recovered:false};
}
export async function advanceDay() {
  if(!game.user.isGM)return notification('Только ведущий может перевести сутки.',true);
  if(gmLeader()?.id!==game.user.id)return notification('Сутки может переводить только ведущий, управляющий логистикой.',true);
  try{
    return await withWorldLock(async()=>{
      let plan=game.settings.get(SYSTEM,'dayOperation');
      if(plan?.version!==1){
        const current=game.settings.get(SYSTEM,'worldDay');
        plan=planDayOperation(game.actors.filter(a=>a.type==='survivor'),
          game.actors.find(a=>a.type==='colony'),current);
        // Persist the full plan before the first side effect.
        await game.settings.set(SYSTEM,'dayOperation',plan);
      }
      return replayDayOperation(plan);
    },{allowDayRecovery:true});
  }catch(error){
    console.error('PROJECT GENESIS: incomplete day operation retained for retry',error);
    notification(`Не удалось завершить сутки: ${error.message}. Повторите действие после устранения ошибки.`,true);
    return {ok:false,error:error.message};
  }
}
export function initializeLogistics() {
  // Reconnect recovery must enter the same serialized lock before gameplay requests.
  if(game.user?.isGM && gmLeader()?.id===game.user.id){
    const pending=game.settings?.get?.(SYSTEM,'dayOperation');
    if(pending?.version===1){
      void withWorldLock(()=>replayDayOperation(pending),{allowDayRecovery:true})
        .catch(error=>{console.error('PROJECT GENESIS: day recovery failed',error);
          notification('Переход суток требует восстановления. Нажмите «+1 сутки» после исправления ошибки.',true);});
    }
  }
  game.socket.on(`system.${SYSTEM}`,(request)=>{
    if (!request || typeof request !== 'object') return;
    if (request.kind==='transfer-result') {
      if (request.userId !== game.user.id || !awaiting.has(request.id)) return;
      const since=awaiting.get(request.id);
      awaiting.delete(request.id);
      if (Date.now()-since>AWAIT_TIMEOUT_MS) return;
      notification(request.message, !request.ok);
      return;
    }
    if (request.kind!=='transfer-request') return;
    if (!game.user.isGM || gmLeader()?.id!==game.user.id) return;
    if (typeof request.userId !== 'string' || typeof request.id !== 'string' ||
        typeof request.sourceActorId !== 'string' || typeof request.targetActorId !== 'string' ||
        typeof request.itemId !== 'string' || (request.targetContainerId != null && typeof request.targetContainerId !== 'string')) return;
    withWorldLock(()=>commitTransfer(request)).then(result=>{
      game.socket.emit(`system.${SYSTEM}`,{kind:'transfer-result',userId:request.userId,id:request.id,
        ok:true,message:result.message||'Операция уже выполнена.'});
    }).catch(error=>{
      game.socket.emit(`system.${SYSTEM}`,{kind:'transfer-result',userId:request.userId,id:request.id,
        ok:false,message:error.message || 'Ошибка перемещения.'});
    });
  });
}
export function recentOperations() {return journal().entries || [];}

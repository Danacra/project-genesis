/** GM-coordinated shared colony research, Foundry v13. */
import { TECHNOLOGIES, TECHNOLOGY_BY_ID, BRANCHES, FACILITIES, RECIPE_LIBRARY } from './tech-data.mjs';
import { techStatus, planInvestment, planMaterialUse, completionPatch, unlockedRecipes } from './research-rules.mjs';
import { withWorldLock } from './logistics.mjs';
import { stationOperational } from './networks.mjs';
const SYSTEM='project-genesis';
const pending=new Map();
const handled=new Set();
const TIMEOUT=60000;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const notify=(s,err=false)=>err?ui.notifications.error(s):ui.notifications.info(s);
const leader=()=>game.users.filter(u=>u.active&&u.isGM).sort((a,b)=>a.id.localeCompare(b.id))[0]||null;
const day=()=>game.settings.get(SYSTEM,'worldDay');
const uid=()=>globalThis.crypto?.randomUUID?.().replaceAll('-','') ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
export function colonyFor(actor) {
  if(actor.type==='colony')return actor;
  return game.actors.find(a=>a.type==='colony')||null;
}
export function researchContext(colony, user) {
  if(!colony)return {available:false};
  const science=colony.system.science;
  const statusMap=Object.fromEntries(TECHNOLOGIES.map(t=>{
    const status=techStatus(t.id,science,colony.items);
    const powerReady=t.facilities.every(id=>stationOperational(colony,id));
    const remaining=Math.max(0,t.rp-status.progress);
    const investBlockedReason=status.unlocked?'Технология уже изучена.':
      !status.prerequisitesReady?'Сначала изучите предыдущие технологии.':
      !status.facilityReady?'Необходимая лаборатория или мастерская отсутствует.':
      !powerReady?'Требуемая инфраструктура обесточена.':
      !remaining?'Исследование уже полностью профинансировано.':
      !science.points?'Нет свободных очков исследований.':'';
    return [t.id,{...status,powerReady,canInvest:!investBlockedReason,
      canWork:!status.unlocked&&status.prerequisitesReady&&status.facilityReady&&powerReady&&remaining>0,
      canFinish:status.canFinish&&powerReady,investBlockedReason}];
  }));
  const eras=[0,1,2,3,4].map(t=>({tier:t,label:['01 · ПОЛЕВОЙ ЭТАП','02 · РЕМЕСЛО','03 · НАУЧНАЯ БАЗА','04 · ПРОМЫШЛЕННОСТЬ','05 · КОСМОС'][t],nodes:TECHNOLOGIES.filter(x=>x.t===t).map(x=>({
    ...x,...statusMap[x.id],branchLabel:BRANCHES[x.branch],shortParent:x.parents.length,
    statusLabel:statusMap[x.id].unlocked?'Изучено':statusMap[x.id].canFinish?'Готово к открытию':statusMap[x.id].missingParents.length?'Заблокировано':`${statusMap[x.id].progress}/${x.rp} ОИ`
  }))}));
  const availablePeople=game.actors.filter(a=>a.type==='survivor' && (user.isGM||a.testUserPermission(user,'OWNER')))
    .map(a=>({id:a.id,name:a.name,used:(science.dailyWork||[]).some(w=>w.actorId===a.id&&w.day===day())}));
  const branches=Object.entries(BRANCHES).map(([id,label])=>({id,label}));
  const details=TECHNOLOGIES.map(tech=>({
    ...tech,...statusMap[tech.id],branchLabel:BRANCHES[tech.branch],epochDisplay:tech.t+1,
    missingParentNames:statusMap[tech.id].missingParents.map(id=>TECHNOLOGY_BY_ID[id].name),
    missingFacilityNames:statusMap[tech.id].missingFacilities.map(id=>FACILITIES[id]),
    requiredFacilityNames:tech.facilities.map(id=>FACILITIES[id]),
    parentsNames:tech.parents.map(id=>TECHNOLOGY_BY_ID[id].name),
    recipesNames:tech.recipes.map(id=>RECIPE_LIBRARY[id]||id),
    remaining:Math.max(0,tech.rp-statusMap[tech.id].progress)
  }));
  return {available:true,colonyId:colony.id,colonyName:colony.name,science,eras,details,
    statusMap,branches,facilities:Object.entries(FACILITIES).map(([id,name])=>({id,name,active:(science.facilities||[]).includes(id)})),
    recipes:unlockedRecipes(science),canResearch:user.isGM||availablePeople.length>0,
    people:availablePeople,history:[...(science.discoveries||[])].reverse().map(d=>({...d,techName:TECHNOLOGY_BY_ID[d.techId]?.name||d.techId})),day:day(),isGM:user.isGM,
    progressCount:TECHNOLOGIES.filter(t=>statusMap[t.id].unlocked).length,techCount:TECHNOLOGIES.length};
}
function authorize(request) {
  const u=game.users.get(request.userId);
  if(!u?.active)throw new Error('Пользователь отключён.');
  const colony=game.actors.get(request.colonyId);
  if(!colony||colony.type!=='colony')throw new Error('Колония не найдена.');
  if (!u.isGM && !game.actors.some(a=>a.type==='survivor'&&a.testUserPermission(u,'OWNER'))) {
    throw new Error('Для исследования нужен собственный персонаж-выживший.');
  }
  return {u,colony};
}
function assertProjectReady(colony,techId) {
  const status=techStatus(techId,colony.system.science,colony.items);
  if(status.unlocked)throw new Error('Открытие уже исследовано.');
  if(!status.prerequisitesReady)throw new Error('Не исследованы предшествующие технологии.');
  if(!status.facilityReady)throw new Error('Для работы необходимы лаборатория или мастерская.');
  if(TECHNOLOGY_BY_ID[techId]?.facilities.some(id=>!stationOperational(colony,id)))
    throw new Error('Для исследования необходима работающая инфраструктура: проверьте электроснабжение.');
  return status;
}
async function finish(colony,techId,user) {
  const status=assertProjectReady(colony,techId);
  if(status.progress<status.required)throw new Error('Сначала завершите финансирование исследования.');
  if(!status.materialReady)throw new Error('Недостаточно материалов на общем складе.');
  const changes=planMaterialUse(techId,colony.items);
  if(changes.length)await colony.updateEmbeddedDocuments('Item',changes.map(c=>({_id:c.id,'system.quantity':c.after})));
  try {
    const patch=completionPatch(colony.system.science,techId,user.name,day());
    await colony.update(Object.fromEntries(Object.entries(patch).map(([key,value])=>[`system.science.${key}`,value])));
  } catch(error) {
    if(changes.length) {
      try {await colony.updateEmbeddedDocuments('Item',changes.map(c=>({_id:c.id,'system.quantity':c.before})));}
      catch(restoreError) {
        console.error('PROJECT GENESIS: failed to restore research materials',restoreError);
        throw new Error('Ошибка восстановления материалов! GM должен проверить запасы и журнал вручную.');
      }
    }
    throw error;
  }
  try {
    await ChatMessage.create({content:`<div class="genesis-chat"><strong>PROJECT GENESIS · Научное открытие</strong><p>Колония ${escape(colony.name)} исследовала «${escape(TECHNOLOGY_BY_ID[techId].name)}» (день ${day()}).</p></div>`});
  }catch(error){console.warn('PROJECT GENESIS: science notification failed',error);}
  return `Открыта технология: ${TECHNOLOGY_BY_ID[techId].name}.`;
}
async function commit(request) {
  if(!/^[\w-]{12,80}$/.test(request.id||''))throw new Error('Некорректный идентификатор действия.');
  if(handled.has(request.id))return 'Повторная операция проигнорирована.';
  const {u,colony}=authorize(request);
  const tech=TECHNOLOGY_BY_ID[request.techId];
  if(!tech && request.action!=='facility' && request.action!=='grant')throw new Error('Неизвестное исследование.');
  let result;
  if(request.action==='work') {
    const status=assertProjectReady(colony,request.techId);
    if(status.progress>=status.required)throw new Error('Проект уже профинансирован.');
    const survivor=game.actors.get(request.actorId);
    if(!survivor||survivor.type!=='survivor'||(!u.isGM&&!survivor.testUserPermission(u,'OWNER')))
      throw new Error('Недоступный персонаж для исследования.');
    const today=day(),existing=colony.system.science.dailyWork||[];
    if(existing.some(w=>w.day===today && w.actorId===survivor.id))throw new Error('Этот персонаж уже работал над исследованием сегодня.');
    const a=Number(survivor.system.abilities.intellect),s=Number(survivor.system.skills.science);
    const check=await new Roll('2d10 + @intellect + @science',{intellect:a,science:s}).evaluate();
    const difficulty=11+2*tech.t;
    const earned=check.total>=difficulty?Math.min(6,2+Math.floor((check.total-difficulty)/4)):0;
    await colony.update({'system.science.points':Math.min(9999999,colony.system.science.points+earned),
      'system.science.dailyWork':[...existing.filter(w=>w.day>=today-6),{day:today,actorId:survivor.id,techId:tech.id}].slice(-200)});
    await check.toMessage({speaker:ChatMessage.getSpeaker({actor:survivor}),flavor:
      `Исследование «${escape(tech.name)}». Сложность ${difficulty}. Получено ОИ: ${earned}.`});
    result=`${survivor.name}: ${check.total} против ${difficulty}; получено ${earned} ОИ.`;
  } else if(request.action==='invest') {
    assertProjectReady(colony,request.techId);
    const patch=planInvestment(colony.system.science,tech.id,Number(request.amount));
    await colony.update({'system.science.points':patch.points,'system.science.projects':patch.projects});
    result=`${Number(request.amount)} ОИ вложено в «${tech.name}».`;
    if(techStatus(tech.id,colony.system.science,colony.items).canFinish) {
      result+=` ${await finish(colony,tech.id,u)}`;
    }
  } else if(request.action==='complete') {
    result=await finish(colony,request.techId,u);
  } else if(request.action==='facility') {
    if(!u.isGM)throw new Error('Только GM управляет инфраструктурой.');
    if(!Object.hasOwn(FACILITIES,request.facilityId))throw new Error('Неизвестная инфраструктура.');
    const old=new Set(colony.system.science.facilities||[]);
    const constructed=(colony.system.industry?.buildings||[]).some(b=>b.id===request.facilityId&&b.count>0);
    if(old.has(request.facilityId)){
      if(constructed) throw new Error('Нельзя выключить построенный объект вручную.');
      old.delete(request.facilityId);
    }else old.add(request.facilityId);
    await colony.update({'system.science.facilities':[...old]});
    result='Список инфраструктуры обновлён.';
  } else if(request.action==='grant') {
    if(!u.isGM)throw new Error('Только GM начисляет очки исследований.');
    const amount=Number(request.amount);
    if(!Number.isSafeInteger(amount)||amount<1||amount>1000)throw new Error('Допустимо от 1 до 1000 ОИ.');
    if(colony.system.science.points+amount>9999999)throw new Error('Достигнут предел очков.');
    await colony.update({'system.science.points':colony.system.science.points+amount});
    result=`Колонии начислено ${amount} ОИ.`;
  } else throw new Error('Неизвестное действие исследования.');
  handled.add(request.id);
  if(handled.size>5000)handled.clear();
  return result;
}
export async function requestResearch(params) {
  const gm=leader();
  if(!gm)return notify('Для исследований нужен активный GM.',true);
  const request={...params,kind:'genesis-research-request',id:uid(),userId:game.user.id};
  if(gm.id===game.user.id){
    try {notify(await withWorldLock(()=>commit(request)));}catch(error){notify(error.message||'Ошибка исследования.',true);}
    return;
  }
  for(const [id,at] of pending)if(Date.now()-at>TIMEOUT)pending.delete(id);
  if(pending.size>=25)return notify('Слишком много незавершённых запросов.',true);
  pending.set(request.id,Date.now());
  game.socket.emit(`system.${SYSTEM}`,request);
  notify('Запрос исследования отправлен ведущему.');
}
export function initializeResearch() {
  game.socket.on(`system.${SYSTEM}`,(payload,senderId)=>{
    if(!payload||typeof payload!=='object')return;
    if(payload.kind==='genesis-research-result') {
      if(payload.userId!==game.user.id||!pending.has(payload.id))return;
      const at=pending.get(payload.id);pending.delete(payload.id);
      if(Date.now()-at<TIMEOUT)notify(String(payload.message||'Операция завершена.'),!payload.ok);
      return;
    }
    if(payload.kind!=='genesis-research-request'||!game.user.isGM||leader()?.id!==game.user.id)return;
    // Reject mismatched server-provided sender identity when provided by the runtime.
    if(typeof senderId==='string'&&senderId&&senderId!==payload.userId)return;
    if(typeof payload.userId!=='string'||typeof payload.id!=='string'||typeof payload.colonyId!=='string')return;
    withWorldLock(()=>commit(payload)).then(message=>{
      game.socket.emit(`system.${SYSTEM}`,{kind:'genesis-research-result',id:payload.id,userId:payload.userId,ok:true,message});
    }).catch(error=>{
      game.socket.emit(`system.${SYSTEM}`,{kind:'genesis-research-result',id:payload.id,userId:payload.userId,ok:false,message:error.message||'Ошибка исследования.'});
    });
  });
}
export { TECHNOLOGIES, BRANCHES, FACILITIES };

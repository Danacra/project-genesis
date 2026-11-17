/** PROJECT GENESIS 0.9.5: one managed rest per day for an actual player survivor. */
import {withWorldLock} from './logistics.mjs';
const SYSTEM='project-genesis',TIMEOUT=60_000;
const pending=new Map();
const notify=(message,err=false)=>err?ui.notifications.error(message):ui.notifications.info(message);
const gmLeader=()=>game.users.filter(u=>u.active&&u.isGM).sort((a,b)=>a.id.localeCompare(b.id))[0]||null;
const day=()=>game.settings.get(SYSTEM,'worldDay');
const uid=()=>globalThis.crypto?.randomUUID?.().replaceAll('-','')??`${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
const clamp=(n)=>Math.max(0,Math.min(100,Math.round(n)));
export function hasShelter(colony){return Boolean(colony?.system.industry?.buildings?.some(b=>b.id==='shelter'&&b.count>0));}
export function restOutcome(vitals,kind,shelter){
  if(!['field','shelter'].includes(kind))throw Error('Неизвестный вид отдыха.');
  if(kind==='shelter'&&!shelter)throw Error('Сначала постройте жилой модуль.');
  const effect=kind==='shelter'?40:22;
  return {...vitals,fatigue:clamp(Number(vitals.fatigue||0)-effect),
    health:clamp(Number(vitals.health||0)+(kind==='shelter'?5:0))};
}
export function restContext(actor,colony,worldDay){
  if(actor.type!=='survivor')return {available:false};
  const last=Number(actor.system.rest?.lastDay||0);
  const busy=Boolean(colony?.system.crew?.jobs?.some(j=>j.actorId===actor.id));
  return {available:true,day:worldDay,used:last===worldDay,busy,shelter:hasShelter(colony),
    fatigue:Number(actor.system.survival.fatigue)||0};
}
async function commit(request){
  if(typeof request.id!=='string'||!/^[A-Za-z0-9_-]{12,80}$/.test(request.id))throw Error('Некорректная операция отдыха.');
  const user=game.users.get(request.userId),actor=game.actors.get(request.actorId);
  if(!user?.active||!actor||actor.type!=='survivor')throw Error('Выживший не найден или игрок отключён.');
  if(!user.isGM&&!actor.testUserPermission(user,'OWNER'))throw Error('Нельзя управлять отдыхом чужого персонажа.');
  const colony=game.actors.find(a=>a.type==='colony');
  if(colony?.system.crew?.jobs?.some(j=>j.actorId===actor.id))throw Error('Персонаж сейчас выполняет задание. Сначала завершите его.');
  const today=day();
  if(Number(actor.system.rest?.lastDay||0)===today)throw Error('Этот выживший уже отдыхал сегодня.');
  const next=restOutcome(actor.system.survival,request.restKind,hasShelter(colony));
  await actor.update({'system.survival':next,'system.rest.lastDay':today});
  return `${actor.name} восстановил силы (${request.restKind==='shelter'?'жилой модуль':'полевой лагерь'}).`;
}
export async function requestRest(actorId,restKind){
  if(!['field','shelter'].includes(restKind))return notify('Недопустимый вид отдыха.',true);
  const gm=gmLeader();if(!gm)return notify('Для отдыха требуется активный ведущий.',true);
  const request={kind:'genesis-rest-request',userId:game.user.id,id:uid(),actorId,restKind};
  if(gm.id===game.user.id){
    try{notify(await withWorldLock(()=>commit(request)));}catch(e){notify(e.message,true);}
  }else{
    for(const [id,at]of pending)if(Date.now()-at>TIMEOUT)pending.delete(id);
    if(pending.size>=25)return notify('Слишком много запросов отдыха.',true);
    pending.set(request.id,Date.now());game.socket.emit(`system.${SYSTEM}`,request);
    notify('Запрос на отдых отправлен ведущему.');
  }
}
export function initializeRest(){
  game.socket.on(`system.${SYSTEM}`,(request,senderId)=>{
    if(!request||typeof request!=='object')return;
    if(request.kind==='genesis-rest-result'){
      if(request.userId!==game.user.id||!pending.has(request.id))return;
      const at=pending.get(request.id);pending.delete(request.id);
      if(Date.now()-at<TIMEOUT)notify(String(request.message||''),!request.ok);
      return;
    }
    if(request.kind!=='genesis-rest-request'||!game.user.isGM||gmLeader()?.id!==game.user.id)return;
    if(senderId&&typeof senderId==='string'&&senderId!==request.userId)return;
    if(typeof request.userId!=='string'||typeof request.actorId!=='string')return;
    withWorldLock(()=>commit(request)).then(message=>game.socket.emit(`system.${SYSTEM}`,
      {kind:'genesis-rest-result',id:request.id,userId:request.userId,ok:true,message}))
      .catch(error=>game.socket.emit(`system.${SYSTEM}`,
        {kind:'genesis-rest-result',id:request.id,userId:request.userId,ok:false,message:error.message}));
  });
}

/** PROJECT GENESIS v1.3.1 — authoritative, power-aware interior AmbientLights.
 * The configured room's built-in power load includes ceiling lighting.
 * All light writes happen on the active lead GM; user switches are verified by GM.
 */
import {getNetworkSimulation} from './networks.mjs';
import {withWorldLock} from './logistics.mjs';
import {isInteriorBuilding} from './structure-rules.mjs';
import {DEFAULT_DARKNESS,lightPlan,lightSwitchOn,canUseRoomSwitch} from './interior-light-rules.mjs';
const SYS='project-genesis';
const pending=new Map(),handled=new Set();
let queued=false,lightWrites=Promise.resolve();
const leader=()=>game.users.filter(u=>u.active&&u.isGM).sort((a,b)=>a.id.localeCompare(b.id))[0]||null;
const uid=()=>globalThis.crypto?.randomUUID?.().replaceAll('-','')??`${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
const info=scene=>scene?.flags?.[SYS];
function roomOwner(scene){
  const flags=info(scene),colony=game.actors.get(flags?.colonyId);
  const p=colony?.system?.industry?.placements?.find(p=>p.id===flags?.interiorOf);
  if(!colony||colony.type!=='colony'||!p||p.status!=='finished'||
     !isInteriorBuilding(p.buildingId)||p.interiorSceneId!==scene.id||
     p.sceneId!==flags.exteriorSceneId)return null;
  return {colony,placement:p};
}
function hasAuthority(){return game.user?.isGM && leader()?.id===game.user?.id;}
export function roomLightingInfo(scene){
  const owner=roomOwner(scene);
  if(!owner)return null;
  const powered=Boolean(getNetworkSimulation(owner.colony).simulation.byId[owner.placement.id]?.powered);
  return {powered,switchOn:lightSwitchOn(scene),enabled:powered&&lightSwitchOn(scene),owner};
}
/** Write only the GENESIS-managed AmbientLight, leaving manually placed lights alone. */
async function writeInteriorLighting(scene){
  if(!hasAuthority()||!scene?.id)return false;
  const current=roomLightingInfo(scene);
  if(!current)return false;
  // Legacy GENESIS interiors get the same nighttime lighting behaviour. Never
  // overwrite a GM-customized darkness value or non-GENESIS light sources.
  if(!info(scene)?.lightingSetup && Number(scene.environment?.darknessLevel||0)===0 &&
     ![...(scene.lights||[])].some(l=>!l.flags?.[SYS]?.managedInteriorLight)){
    await scene.update({'environment.darknessLevel':DEFAULT_DARKNESS});
  }
  const plan=lightPlan(scene,current.owner.placement.id,current.powered);
  if(plan.action==='create')await scene.createEmbeddedDocuments('AmbientLight',[plan.document]);
  if(plan.action==='update')await scene.updateEmbeddedDocuments('AmbientLight',[plan.document]);
  if(!info(scene)?.lightingSetup)await scene.setFlag(SYS,'lightingSetup',true);
  return plan.action!=='none';
}
/** Serialize concurrent room entry and power-reconciliation updates to avoid duplicate lamps. */
export function syncInteriorLighting(scene){
  const work=lightWrites.then(()=>writeInteriorLighting(scene));
  lightWrites=work.catch(()=>undefined);
  return work;
}
export async function syncAllInteriorLights(){
  if(!hasAuthority())return;
  for(const scene of game.scenes||[]){
    if(!info(scene)?.interiorOf)continue;
    try{await syncInteriorLighting(scene);}catch(error){
      console.error('PROJECT GENESIS: interior light synchronization failed',scene.id,error);
    }
  }
}
function queueSync(){
  if(!hasAuthority()||queued)return;
  queued=true;
  Promise.resolve().then(()=>{
    queued=false;
    void syncAllInteriorLights().catch(error=>
      console.error('PROJECT GENESIS: power-light sync failed',error));
  });
}
async function switchRoom({sceneId,userId,id}){
  if(typeof sceneId!=='string'||typeof userId!=='string'||typeof id!=='string'||
     !/^[A-Za-z0-9_-]{12,80}$/.test(id))throw Error('Неверный запрос освещения.');
  if(handled.has(id))return;
  const scene=game.scenes.get(sceneId),owner=roomOwner(scene),user=game.users.get(userId);
  if(!owner||!user?.active||!canUseRoomSwitch(user,scene,game.actors))
    throw Error('Нет доступа к выключателю этого помещения.');
  const next=!lightSwitchOn(scene);
  await scene.setFlag(SYS,'lightsOn',next);
  // Failure to create/update a light will be repaired by a later sync. Do not
  // reverse the already-persisted switch when Foundry reports a light error.
  try{await syncInteriorLighting(scene);}catch(e){console.error('GENESIS room switch light update',e);}
  handled.add(id);if(handled.size>3000)handled.clear();
  return next;
}
export async function toggleRoomLighting(){
  const scene=globalThis.canvas?.scene,owner=roomOwner(scene);
  if(!owner)return ui.notifications.warn('Выключатель доступен только внутри помещения.');
  const gm=leader();if(!gm)return ui.notifications.warn('Нужен ведущий онлайн для управления освещением.');
  const id=uid(),req={sceneId:scene.id,userId:game.user.id,id};
  if(gm.id===game.user.id){
    try{
      const next=await withWorldLock(()=>switchRoom(req));
      ui.notifications.info(next?'Свет включён (если есть питание).':'Свет выключен.');
    }catch(e){ui.notifications.warn(e.message);}
  }else{
    pending.set(id,Date.now());game.socket.emit(`system.${SYS}`,{kind:'genesis-room-light',...req});
    ui.notifications.info('Команда выключателя отправлена ведущему.');
  }
}
export function initializeInteriorLighting(){
  for(const hook of ['createTile','updateTile','deleteTile'])Hooks.on?.(hook,doc=>{
    if(doc?.flags?.[SYS]?.networkId||doc?.flags?.[SYS]?.buildingId)queueSync();
  });
  Hooks.on?.('updateActor',(actor,changes)=>{
    if(actor?.type==='colony'&&Object.keys(changes||{}).some(k=>
      k==='system'||k.startsWith('system.industry')||k.startsWith('system.infrastructure')))queueSync();
  });
  Hooks.on?.('canvasReady',queueSync);
  Hooks.on?.('createScene',queueSync);
  game.socket.on(`system.${SYS}`,(payload,senderId)=>{
    if(!payload||typeof payload!=='object')return;
    if(payload.kind==='genesis-room-light-result'){
      if(payload.userId!==game.user.id||!pending.has(payload.id))return;
      const at=pending.get(payload.id);pending.delete(payload.id);
      if(Date.now()-at<60000){
        (payload.ok?ui.notifications.info:ui.notifications.warn)(String(payload.message||'Готово.'));
      }
      return;
    }
    if(payload.kind!=='genesis-room-light'||!hasAuthority())return;
    if(typeof senderId==='string'&&senderId&&senderId!==payload.userId)return;
    withWorldLock(()=>switchRoom(payload)).then(on=>game.socket.emit(`system.${SYS}`,
      {kind:'genesis-room-light-result',id:payload.id,userId:payload.userId,ok:true,
       message:on?'Свет включён (если есть питание).':'Свет выключен.'}))
    .catch(e=>game.socket.emit(`system.${SYS}`,
      {kind:'genesis-room-light-result',id:payload.id,userId:payload.userId,ok:false,message:e.message}));
  });
  queueSync();
}

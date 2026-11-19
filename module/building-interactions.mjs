/** PROJECT GENESIS v1.3: rooms, scene transitions and clickable crafting.
 * Scene/token changes are GM-authoritative. Viewing a room never activates it for all users.
 */
import {BUILDING_BY_ID,RECIPES} from './industry-data.mjs';
import {isInteriorBuilding,isCraftStation,sourceForWorkstation,sceneInteriorOf} from './structure-rules.mjs';
import {placementHealth} from './map-rules.mjs';
import {placementOperational,getNetworkSimulation} from './networks.mjs';
import {requestIndustry} from './industry.mjs';
import {crewState,stockFor} from './crew-rules.mjs';
import {localWarehouseStatus,warehouseNearStation,isLocalWarehouse} from './local-storage-rules.mjs';
import {withWorldLock} from './logistics.mjs';
import {moveSurvivorToken} from './scene-transfer.mjs';
import {interiorLayout} from './interior-rules.mjs';
import {DEVICES} from './network-rules.mjs';
import {roomLightingInfo,toggleRoomLighting,syncInteriorLighting} from './interior-lighting.mjs';
const SYSTEM='project-genesis';
const pending=new Map();
let detach=()=>{};
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const leader=()=>game.users.filter(u=>u.active&&u.isGM).sort((a,b)=>a.id.localeCompare(b.id))[0]||null;
const newId=()=>globalThis.crypto?.randomUUID?.().replaceAll('-','')??`${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
const colonyForScene=scene=>game.actors.find(a=>a.type==='colony'&&a.system.industry?.placements?.some(p=>p.sceneId===scene.id||p.interiorSceneId===scene.id));
function locatePlacement(colonyId,placementId){
  const colony=game.actors.get(colonyId);
  if(!colony||colony.type!=='colony')throw Error('Колония не найдена.');
  const placement=(colony.system.industry?.placements||[]).find(p=>p.id===placementId);
  if(!placement||placement.status!=='finished')throw Error('Войти можно только в построенное и завершённое помещение.');
  const exterior=game.scenes.get(placement.sceneId);
  if(placementHealth(placement,exterior,exterior?.tiles?.get?.(placement.tileId))!=='ok')
    throw Error('Связь здания с картой нарушена. Проверьте его тайл на сцене.');
  return {colony,placement,exterior};
}
async function openScene(sceneId){
  const scene=game.scenes.get(sceneId);
  if(!scene)throw Error('Внутренняя сцена не найдена. Обратитесь к ведущему.');
  await scene.view();
}
/** GM only; callers must be inside withWorldLock to prevent duplicated rooms. */
async function ensureRoom(colonyId,placementId){
  if(!game.user.isGM)throw Error('Создать внутреннюю сцену может только ведущий.');
  const {colony,placement,exterior}=locatePlacement(colonyId,placementId);
  if(!isInteriorBuilding(placement.buildingId))throw Error('Это сооружение не имеет внутреннего помещения.');
  if(placement.interiorSceneId){
    if(!game.scenes.get(placement.interiorSceneId))throw Error('Связанная внутренняя сцена была удалена. Восстановите её из резервной копии.');
    try{await syncInteriorLighting(game.scenes.get(placement.interiorSceneId));}catch(e){console.warn("PROJECT GENESIS: room light setup pending",e);}
    return placement.interiorSceneId;
  }
  const name=`${BUILDING_BY_ID[placement.buildingId].name} · ${exterior.name}`;
  const created=await Scene.create({name,width:1200,height:900,canvas:true,navigation:true,
    grid:{type:1,size:100,distance:1,units:'m'},padding:0,
    background:{src:`systems/${SYSTEM}/assets/interiors/${placement.buildingId}.svg`,color:'#13202b'},
    environment:{darknessLevel:0.85},
    ownership:{default:2},flags:{[SYSTEM]:{interiorOf:placement.id,colonyId:colony.id,exteriorSceneId:exterior.id}}});
  if(!created?.id)throw Error('Не удалось создать внутреннюю сцену.');
  try{
    await colony.update({'system.industry.placements':colony.system.industry.placements.map(p=>
      p.id===placement.id?{...p,interiorSceneId:created.id}:p)});
  }catch(error){
    try{await created.delete();}catch(cleanup){console.error('GENESIS: orphan interior scene',cleanup);}
    throw error;
  }
  try{await syncInteriorLighting(created);}catch(e){console.warn("PROJECT GENESIS: room light setup pending",e);}
  return created.id;
}
/** Pick a controlled survivor, or the single actor owned by this user on the map.
 * When no token exists, the scene can still be viewed without moving anybody.
 */
async function selectedTraveler(scene){
  if(globalThis.canvas?.scene?.id!==scene?.id)return '';
  const eligible=[...(scene.tokens||[])].filter(t=>{
    const actor=game.actors.get(t.actorId);
    return actor?.type==='survivor'&&(game.user.isGM||actor.testUserPermission(game.user,'OWNER'));
  });
  const controlled=canvas.tokens?.controlled?.map(t=>t.document?.id).filter(Boolean)||[];
  const selected=eligible.filter(t=>controlled.includes(t.id));
  if(selected.length===1)return selected[0].id;
  if(selected.length>1)ui.notifications.warn('Выберите только один токен выжившего для перехода.');
  if(selected.length>1)return null;
  if(eligible.length===1)return eligible[0].id;
  if(!eligible.length){ui.notifications.info('Вход без токена: на сцене нет доступного выжившего.');return '';}
  const html=eligible.map(t=>`<option value="${escape(t.id)}">${escape(game.actors.get(t.actorId)?.name||t.name||t.id)}</option>`).join('');
  const answer=await foundry.applications.api.DialogV2.prompt({window:{title:'Выберите персонажа'},
    content:`<div class="genesis-dialog"><p>Кого переместить через дверь?</p><select name="tokenId">${html}</select></div>`,
    ok:{label:'Перейти',callback:(_event,button)=>String(button.form.elements.namedItem('tokenId')?.value||'')}});
  return answer||null;
}
/** The GM validates room linkage and token ownership, even for a malicious socket request. */
async function travel({direction,colonyId,placementId,tokenId='',userId,requestId=''}){
  const user=game.users.get?.(userId)||(game.user?.id===userId?game.user:null);
  if(!user?.active)throw Error('Пользователь неактивен.');
  const {placement,exterior}=locatePlacement(colonyId,placementId);
  if(!isInteriorBuilding(placement.buildingId))throw Error('Это сооружение не имеет внутренней сцены.');
  if(direction==='enter'){
    const interiorId=placement.interiorSceneId||await ensureRoom(colonyId,placementId);
    const updated=locatePlacement(colonyId,placementId).placement;
    const interior=game.scenes.get(interiorId);
    if(!interior||interior.flags?.[SYSTEM]?.interiorOf!==placementId||
      interior.flags?.[SYSTEM]?.colonyId!==colonyId||interior.flags?.[SYSTEM]?.exteriorSceneId!==exterior.id)
      throw Error('Внутренняя сцена не принадлежит этому зданию.');
    if(tokenId)await moveSurvivorToken({source:exterior,target:interior,tokenId,user,
      actors:game.actors,placement:updated,action:'enter',transferId:requestId});
    return interiorId;
  }
  if(direction==='exit'){
    const interior=game.scenes.get(placement.interiorSceneId);
    if(!interior||interior.flags?.[SYSTEM]?.interiorOf!==placementId||
      interior.flags?.[SYSTEM]?.colonyId!==colonyId||interior.flags?.[SYSTEM]?.exteriorSceneId!==exterior.id)
      throw Error('Связь помещения с наружной картой нарушена.');
    if(tokenId)await moveSurvivorToken({source:interior,target:exterior,tokenId,user,
      actors:game.actors,placement,action:'exit',transferId:requestId});
    return exterior.id;
  }
  throw Error('Некорректное направление перехода.');
}
async function requestTravel(direction,colonyId,placementId,source){
  const tokenId=await selectedTraveler(source);
  if(tokenId===null)return;
  const gm=leader();if(!gm)throw Error('Для перехода с переносом персонажа нужен ведущий онлайн.');
  const id=newId();
  const params={direction,colonyId,placementId,tokenId,userId:game.user.id,requestId:id};
  if(gm.id===game.user.id){
    await openScene(await withWorldLock(()=>travel(params)));
  }else{
    for(const [key,stamp]of pending)if(Date.now()-stamp>60000)pending.delete(key);
    if(pending.size>=25)throw Error('Слишком много ожидающих переходов.');
    pending.set(id,Date.now());
    game.socket.emit(`system.${SYSTEM}`,{kind:'genesis-room-travel',id,...params});
    ui.notifications.info('Переход отправлен ведущему.');
  }
}
export async function enterRoom(colonyId,placementId){
  try{
    const {placement,exterior}=locatePlacement(colonyId,placementId);
    if(!isInteriorBuilding(placement.buildingId))throw Error('У этого здания нет внутренней сцены.');
    await requestTravel('enter',colonyId,placementId,exterior);
  }catch(error){ui.notifications.warn(error.message||'Не удалось войти в здание.');}
}
export async function exitRoom(){
  try{
    const scene=globalThis.canvas?.scene,info=scene?.flags?.[SYSTEM];
    if(!info?.interiorOf||!info?.colonyId)throw Error('Вы находитесь не внутри помещения.');
    await requestTravel('exit',info.colonyId,info.interiorOf,scene);
  }catch(error){ui.notifications.warn(error.message||'Не удалось выйти из помещения.');}
}
/** A station offers only its own recipes, not the whole unfiltered production catalog. */
export async function openStationCraft(colonyId,placementId){
  try{
    const colony=game.actors.get(colonyId);
    const p=sourceForWorkstation(colony,placementId);
    const scene=game.scenes.get(p.sceneId);
    if(placementHealth(p,scene,scene?.tiles?.get?.(p.tileId))!=='ok')throw Error('Тайл станка повреждён.');
    const recipes=RECIPES.filter(r=>r.station===p.buildingId);
    if(!recipes.length)return ui.notifications.info('У этого станка пока нет рецептов.');
    const enabled=new Set(colony.system.science.unlocked||[]);
    const options=recipes.map(r=>`<option value="${escape(r.id)}" ${enabled.has(r.techId)?'':'disabled'}>${escape(r.name)}${enabled.has(r.techId)?'':' · требуется исследование'}</option>`).join('');
    const online=placementOperational(colony,p);
    const warehouses=(colony.system.industry?.placements||[]).filter(w=>warehouseNearStation(p,w,game.scenes));
    const storageOptions=`<option value="">Общий склад колонии</option>`+warehouses.map(w=>
      `<option value="${escape(w.id)}">Локальный склад · ${escape(game.scenes.get(w.sceneId)?.name||'Сцена')} (${escape(w.id.slice(0,8))})</option>`).join('');
    const data=await foundry.applications.api.DialogV2.prompt({
      window:{title:`Крафт · ${BUILDING_BY_ID[p.buildingId]?.name||p.buildingId}`},
      content:`<div class="genesis-dialog"><p>${online?'Станок доступен для производства.':'⚠ Станок обесточен или не получает нужные коммуникации. Требуется подключение наружного помещения к электросети.'}</p>
      <label>Рецепт<select name="recipe">${options}</select></label>
      <label>Количество партий<input type="number" name="amount" value="1" min="1" max="10" step="1" required></label>
      <label>Источник ресурсов<select name="sourcePlacementId">${storageOptions}</select></label>
      <p>Если выбран локальный склад, готовый предмет также отправится в него. Продукция выдаётся после завершения очереди.</p></div>`,
      ok:{label:'Создать заказ',callback:(_event,button)=>({
        recipe:String(button.form.elements.namedItem('recipe')?.value||''),
        amount:Number(button.form.elements.namedItem('amount')?.value),
        sourcePlacementId:String(button.form.elements.namedItem('sourcePlacementId')?.value||'')})}
    });
    if(!data)return;
    if(!online)throw Error('Станок не работает: проверьте инженерные сети и электроснабжение помещения.');
    if(!recipes.some(r=>r.id===data.recipe&&enabled.has(r.techId)))throw Error('Этот рецепт пока недоступен.');
    await requestIndustry({action:'start-recipe',colonyId,subject:data.recipe,amount:data.amount,
      stationPlacementId:placementId,sourcePlacementId:data.sourcePlacementId});
  }catch(error){ui.notifications.warn(error.message||'Не удалось открыть крафт.');}
}
/** Inspect one physical warehouse by clicking its tile on the Scene. */
export async function openLocalWarehouse(colonyId,placementId){
  try{
    const colony=game.actors.get(colonyId);
    const p=colony?.system.industry?.placements?.find(x=>x.id===placementId);
    if(!isLocalWarehouse(p))throw Error('Этот локальный склад не готов.');
    const scene=game.scenes.get(p.sceneId);
    if(placementHealth(p,scene,scene?.tiles?.get?.(p.tileId))!=='ok')throw Error('Складской тайл повреждён.');
    const stock=stockFor(crewState(colony),p.id),s=localWarehouseStatus(stock,p);
    const rows=stock.length?stock.map(r=>`<li>${escape(r.name)} ×${Number(r.quantity)} · ${escape(r.code)}</li>`).join(''):'<li>Пока пусто</li>';
    await foundry.applications.api.DialogV2.prompt({window:{title:'Локальный склад'},
      content:`<div class="genesis-dialog"><strong>${escape(BUILDING_BY_ID[p.buildingId]?.name||p.buildingId)}</strong><p>Масса ${s.load.mass} / ${s.limit.mass} кг · объём ${s.load.volume} / ${s.limit.volume} л.</p><ul>${rows}</ul><p>Для доставки и вывоза воспользуйтесь разделом «Экипаж и логистика». Для крафта выберите этот склад в окне станка.</p></div>`,
      ok:{label:'Открыть логистику',callback:()=>true}});
    const sheet=colony.sheet;sheet._genesisTab='crew';sheet.render(true);
  }catch(error){ui.notifications.warn(error.message||'Не удалось открыть склад.');}
}
function isInteractive(p){return p.status==='finished'&&(isInteriorBuilding(p.buildingId)||isCraftStation(p.buildingId)||isLocalWarehouse(p));}
function buildCanvasInteractions(){
  detach();
  const scene=canvas?.scene;
  if(!canvas?.ready||!scene)return;
  const controller=new AbortController();
  const off=[],buttons=[],repositioners=[];
  const input={signal:controller.signal};
  const interiorId=sceneInteriorOf(scene);
  if(interiorId){
    const exit=document.createElement('button');exit.type='button';exit.className='genesis-scene-exit';
    exit.textContent='← Выйти из помещения';
    exit.addEventListener('click',()=>void exitRoom(),input);document.body.append(exit);buttons.push(exit);
    const parent=game.actors.get(scene.flags[SYSTEM].colonyId)?.system.industry?.placements?.find(p=>p.id===interiorId);
    const owner=game.actors.get(scene.flags[SYSTEM].colonyId);
    const info=document.createElement('div');info.className='genesis-room-info';
    const powerNode=parent&&owner?getNetworkSimulation(owner).simulation.byId[parent.id]:null;
    const power=!!powerNode?.powered;
    const lightStatus=roomLightingInfo(scene);
    info.textContent=parent?`Внутри: ${BUILDING_BY_ID[parent.buildingId]?.name||parent.buildingId} · ${power?'⚡ есть питание':'⚡ нет питания'} · свет ${lightStatus?.enabled?'включён':lightStatus?.switchOn?'нет питания':'выключен'} · нагрузка ${powerNode?.powerNeed||0} ед.`:'Помещение';
    document.body.append(info);buttons.push(info);
    // In-world exit portal: a clickable door anchored to the scene's landing area.
    try{
      const {entry}=interiorLayout(scene);
      const portal=document.createElement('button');portal.type='button';portal.className='genesis-interior-door';
      portal.title='Перейти через дверь на наружную сцену';portal.textContent='🚪 ВЫХОД';
      portal.addEventListener('click',()=>void exitRoom(),input);
      document.body.append(portal);buttons.push(portal);
      repositioners.push(()=>{
        const at=canvas.clientCoordinatesFromCanvas({x:entry.x+entry.width/2,y:entry.y+entry.height/2});
        portal.style.left=`${at.x}px`;portal.style.top=`${at.y}px`;
        portal.hidden=at.x<0||at.y<0||at.x>window.innerWidth||at.y>window.innerHeight;
      });
      repositioners.at(-1)();
    }catch(error){console.warn('PROJECT GENESIS: room door preview unavailable',error);}
    if(owner){
      const lightButton=document.createElement('button');lightButton.type='button';lightButton.className='genesis-room-light-switch';
      lightButton.textContent=lightStatus?.switchOn?'☀ Выключить свет':'☾ Включить свет';
      lightButton.title='Потолочная лампа работает только при наличии электричества';
      lightButton.addEventListener('click',()=>void toggleRoomLighting(),input);
      document.body.append(lightButton);buttons.push(lightButton);
      const build=document.createElement('button');build.type='button';build.className='genesis-scene-build';
      build.textContent='+ Разместить станок';
      build.addEventListener('click',()=>{const sheet=owner.sheet;sheet._genesisTab='construction';sheet.render(true);},input);
      document.body.append(build);buttons.push(build);
    }
  }
  const colony=colonyForScene(scene);
  if(colony){
    const powerSnapshot=getNetworkSimulation(colony).simulation;
    for(const placement of colony.system.industry?.placements||[]){
      if(placement.sceneId!==scene.id||!isInteractive(placement))continue;
      const action=()=>isInteriorBuilding(placement.buildingId)?enterRoom(colony.id,placement.id):
        isLocalWarehouse(placement)?openLocalWarehouse(colony.id,placement.id):openStationCraft(colony.id,placement.id);
      const el=document.createElement('button');el.className='genesis-building-hotspot';el.type='button';
      const config=DEVICES[placement.buildingId];
      const requiresPower=isCraftStation(placement.buildingId)&&config?.power&&!config?.optionalPower;
      const offline=requiresPower&&!placementOperational(colony,placement,powerSnapshot);
      el.textContent=isInteriorBuilding(placement.buildingId)?'⌂ Войти':isLocalWarehouse(placement)?'▣ Склад':
        offline?'⚡ Нет питания':'⚒ Крафт';
      el.title=(BUILDING_BY_ID[placement.buildingId]?.name||placement.buildingId)+
        (offline?' — не подключено электроснабжение':'');
      el.addEventListener('click',event=>{event.stopPropagation();void action();},input);
      document.body.append(el);buttons.push(el);
      const tile=canvas.tiles?.placeables?.find(t=>t.document?.id===placement.tileId);
      const target=tile?.mesh;
      if(target?.on){
        const original=target.eventMode;
        target.eventMode='static';
        const listener=event=>{event?.stopPropagation?.();void action();};
        target.on('pointertap',listener);
        off.push(()=>{try{target.off('pointertap',listener);target.eventMode=original;}catch{}});
      }
      const reposition=()=>{
        try{
          const at=canvas.clientCoordinatesFromCanvas({x:placement.x+placement.width/2,y:placement.y+12});
          el.style.left=`${at.x}px`;el.style.top=`${at.y}px`;
          el.hidden=at.x<0||at.y<0||at.x>window.innerWidth||at.y>window.innerHeight;
        }catch{el.hidden=true;}
      };
      reposition();repositioners.push(reposition);
    }
  }
  // One Hook per Scene regardless of building count. Coalesce rapid camera pans
  // to one layout update per animation frame, and always clean up on teardown.
  if(repositioners.length){
    let scheduled=0;
    const repositionAll=()=>{scheduled=0;for(const update of repositioners)update();};
    const schedule=()=>{
      if(scheduled)return;
      if(typeof globalThis.requestAnimationFrame==='function'){
        scheduled=globalThis.requestAnimationFrame(repositionAll);
      }else repositionAll();
    };
    Hooks.on('canvasPan',schedule);
    off.push(()=>{Hooks.off('canvasPan',schedule);
      if(scheduled&&typeof globalThis.cancelAnimationFrame==='function')globalThis.cancelAnimationFrame(scheduled);});
  }
  detach=()=>{controller.abort();for(const undo of off)try{undo?.();}catch{};for(const el of buttons)el.remove();detach=()=>{};};
}
export function initializeBuildingInteractions(){
  Hooks.on?.('canvasReady',buildCanvasInteractions);
  Hooks.on?.('canvasTearDown',()=>detach());
  let refreshQueued=false;
  const scheduleRefresh=()=>{
    if(refreshQueued||!globalThis.canvas?.ready)return;
    refreshQueued=true;
    Promise.resolve().then(()=>{refreshQueued=false;if(globalThis.canvas?.ready)buildCanvasInteractions();});
  };
  for(const name of ['createTile','updateTile','deleteTile'])Hooks.on?.(name,doc=>{
    if(doc?.flags?.[SYSTEM]?.buildingId)scheduleRefresh();
  });
  Hooks.on?.('updateScene',(doc,changes)=>{
    if(doc?.id===globalThis.canvas?.scene?.id&&doc?.flags?.[SYSTEM]?.interiorOf)
      scheduleRefresh();
  });
  Hooks.on?.('updateActor',(actor,changes)=>{
    if(actor?.type==='colony'&&Object.keys(changes||{}).some(key=>
      key==='system'||key.startsWith('system.industry')||key.startsWith('system.infrastructure')))scheduleRefresh();
  });
  if(globalThis.canvas?.ready)buildCanvasInteractions();
  game.socket.on(`system.${SYSTEM}`,(payload,senderId)=>{
    if(!payload||typeof payload!=='object')return;
    if(payload.kind==='genesis-room-result'){
      if(payload.userId!==game.user.id||!pending.has(payload.id))return;
      const since=pending.get(payload.id);pending.delete(payload.id);
      if(Date.now()-since>60000)return;
      if(payload.ok){
        if(game.scenes.get(payload.sceneId))void openScene(payload.sceneId).catch(e=>ui.notifications.warn(e.message));
        else {
          // Socket response can overtake Foundry's Scene collection sync on the player client.
          let arrived=false;
          const handler=scene=>{
            if(arrived||scene.id!==payload.sceneId)return;
            arrived=true;Hooks.off('createScene',handler);
            void openScene(scene.id).catch(e=>ui.notifications.warn(e.message));
          };
          Hooks.on('createScene',handler);
          setTimeout(()=>{
            Hooks.off('createScene',handler);
            if(arrived)return;
            arrived=true;
            if(game.scenes.get(payload.sceneId))void openScene(payload.sceneId).catch(e=>ui.notifications.warn(e.message));
            else ui.notifications.warn('Помещение создано, но сцена ещё не синхронизирована. Откройте вход повторно.');
          },3500);
        }
      }else ui.notifications.warn(String(payload.message||'Не удалось открыть помещение.'));
      return;
    }
    if(payload.kind!=='genesis-room-travel'||!game.user.isGM||leader()?.id!==game.user.id)return;
    if(typeof senderId==='string'&&senderId&&senderId!==payload.userId)return;
    if(typeof payload.userId!=='string'||typeof payload.id!=='string'||
       !/^[A-Za-z0-9_-]{12,80}$/.test(payload.id)||
       typeof payload.colonyId!=='string'||typeof payload.placementId!=='string'||
       !['enter','exit'].includes(payload.direction)||typeof payload.tokenId!=='string')return;
    const user=game.users.get(payload.userId);
    if(!user?.active)return;
    withWorldLock(()=>travel({direction:payload.direction,colonyId:payload.colonyId,
      placementId:payload.placementId,tokenId:payload.tokenId,userId:payload.userId,requestId:payload.id})).then(sceneId=>{
      game.socket.emit(`system.${SYSTEM}`,{kind:'genesis-room-result',id:payload.id,userId:payload.userId,ok:true,sceneId});
    }).catch(error=>{
      game.socket.emit(`system.${SYSTEM}`,{kind:'genesis-room-result',id:payload.id,userId:payload.userId,ok:false,message:error.message});
    });
  });
}

/** PROJECT GENESIS 0.6.1 — temporary canvas placement preview.
 * No client writes to Scene or Colony; GM validates and commits requests.
 */
import { BUILDING_FOOTPRINTS,checkPlacement,sceneGeometry } from './map-rules.mjs';
import { requestIndustry } from './industry.mjs';
let active=null;
const notify=message=>ui.notifications.warn(message);
const isCanvasTarget=target=>target===canvas?.app?.canvas||target===canvas?.app?.view||target?.id==='board';
function clientPoint(event){return canvas.canvasCoordinatesFromClient({x:event.clientX,y:event.clientY});}
export function cancelPlacement(){active?.cancel();active=null;}
export function startPlacement({colonyId,buildingId,buildingName,existing=false}){
  cancelPlacement();
  const scene=canvas?.scene;
  if(!canvas?.ready||!scene)return notify('Откройте локальную карту колонии перед размещением.');
  if(!BUILDING_FOOTPRINTS[buildingId])return notify('Неизвестное здание.');
  try{sceneGeometry(scene);}catch(error){return notify(error.message);}
  let stopped=false,last=null,lastCursor=null,submitting=false;
  const overlay=document.createElement('div');
  overlay.className='genesis-map-ghost';overlay.style.display='none';
  overlay.innerHTML='<span></span>';
  document.body.append(overlay);
  const banner=document.createElement('div');banner.className='genesis-placement-banner';
  const label=document.createElement('strong');label.textContent=`${existing?'Разместить готовое':'Новая стройка'}: ${buildingName}`;
  const guide=document.createElement('span');guide.textContent='ЛКМ — выбрать место · Esc / ПКМ — отмена';
  const close=document.createElement('button');close.type='button';close.textContent='Отмена';
  banner.append(label,guide,close);document.body.append(banner);
  const cancel=()=>{
    if(stopped)return;
    stopped=true;controller.abort();overlay.remove();banner.remove();
    Hooks.off('canvasTearDown',onCanvasClose);
    Hooks.off('canvasPan',onCanvasPan);
    if(active?.cancel===cancel)active=null;
  };
  const controller=new AbortController(),options={signal:controller.signal,capture:true};
  const onCanvasClose=()=>cancel();Hooks.on('canvasTearDown',onCanvasClose);
  close.addEventListener('click',cancel,{signal:controller.signal});
  const paint=(cursor)=>{
    if(stopped||submitting||!cursor)return;
    try{
      if(canvas.scene?.id!==scene.id){cancel();return;}
      const p=canvas.canvasCoordinatesFromClient(cursor),placement=checkPlacement(buildingId,p,scene);
      last=placement;
      // Keep the preview aligned even while panning or zooming without moving the mouse.
      const topLeft=canvas.clientCoordinatesFromCanvas({x:placement.x,y:placement.y});
      const bottomRight=canvas.clientCoordinatesFromCanvas({x:placement.x+placement.width,y:placement.y+placement.height});
      overlay.style.display='flex';overlay.style.left=`${topLeft.x}px`;overlay.style.top=`${topLeft.y}px`;
      overlay.style.width=`${Math.max(1,bottomRight.x-topLeft.x)}px`;
      overlay.style.height=`${Math.max(1,bottomRight.y-topLeft.y)}px`;
      overlay.classList.toggle('is-valid',placement.valid);overlay.classList.toggle('is-invalid',!placement.valid);
      overlay.firstElementChild.textContent=placement.valid?buildingName:placement.reason;
    }catch(error){console.warn('GENESIS: placement preview',error);cancel();}
  };
  const move=event=>{
    if(stopped||submitting)return;
    if(!isCanvasTarget(event.target)){
      lastCursor=null;overlay.style.display='none';return;
    }
    lastCursor={x:event.clientX,y:event.clientY};
    paint(lastCursor);
  };
  const onCanvasPan=()=>paint(lastCursor);
  Hooks.on('canvasPan',onCanvasPan);
  document.addEventListener('pointermove',move,options);
  window.addEventListener('resize',()=>paint(lastCursor),{signal:controller.signal});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();cancel();}},options);
  document.addEventListener('contextmenu',event=>{if(isCanvasTarget(event.target)){event.preventDefault();event.stopPropagation();cancel();}},options);
  document.addEventListener('pointerdown',async event=>{
    if(stopped||submitting||event.button!==0||!isCanvasTarget(event.target))return;
    // Recheck at click position; do not trust the last mouse movement.
    const p=clientPoint(event),position=checkPlacement(buildingId,p,scene);
    event.preventDefault();event.stopImmediatePropagation();
    if(!position.valid)return notify(position.reason);
    submitting=true;
    let accepted=false;
    try{
      accepted=await foundry.applications.api.DialogV2.confirm({window:{title:'Подтвердить строительную площадку'},
        content:existing?'<p>Отметить ранее построенное здание на этой сцене? Материалы повторно не списываются.</p>':'<p>Начать строительство на выбранной сцене? Материалы будут списаны со склада колонии.</p>',
        yes:{label:existing?'Разместить готовое':'Начать строительство'},no:{label:'Выбрать другое место'}});
    }catch{accepted=false;}
    if(stopped)return;
    if(accepted){cancel();await requestIndustry({action:existing?'place-existing':'start-building',colonyId,subject:buildingId,
      sceneId:scene.id,x:position.x,y:position.y});}
    else submitting=false;
  },options);
  active={cancel};
  ui.notifications.info('Переместите курсор на карту и выберите место постройки.');
}
export function showPlacementOnScene({sceneId,x,y}){
  const scene=game.scenes.get(sceneId);
  if(!scene)return notify('Сцена с постройкой больше не существует.');
  (async()=>{
    try{
      if(canvas.scene?.id!==sceneId)await scene.view();
      if(canvas.scene?.id===sceneId)await canvas.animatePan({x,y,duration:300});
    }catch(error){notify(error.message||'Не удалось открыть карту.');}
  })();
}

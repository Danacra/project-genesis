/** PROJECT GENESIS v0.7.1 — client-only grid route editor.
 * Server-side validation lives in network-rules.mjs and networks.mjs.
 * No client-side writes to Foundry documents.
 */
import {appendManualStep,snapNetworkCell,validateManualRoute,NETWORK_LIMITS} from './network-rules.mjs';
import {sceneGeometry} from './map-rules.mjs';
import {requestNetwork} from './networks.mjs';
import {cancelPlacement} from './map-placement.mjs';
let active=null;
const isCanvasTarget=t=>t===canvas?.app?.canvas||t===canvas?.app?.view||t?.id==='board';
export function cancelNetworkDrawing(){active?.cancel();active=null;}
/** Starts after the user chooses two buildings and a utility type. */
export function startNetworkDrawing({colonyId,type,fromId,toId,gmFree=false}){
  cancelNetworkDrawing();cancelPlacement();
  const colony=game.actors.get(colonyId),placements=colony?.system?.industry?.placements||[];
  const a=placements.find(p=>p.id===fromId),b=placements.find(p=>p.id===toId);
  const scene=canvas?.scene;
  if(!canvas?.ready||!scene||!a||!b||a.sceneId!==scene.id||b.sceneId!==scene.id)
    return ui.notifications.warn('Откройте локальную сцену, на которой расположены оба здания.');
  try{sceneGeometry(scene);}catch(error){return ui.notifications.warn(error.message);}
  const controller=new AbortController(),options={signal:controller.signal,capture:true};
  const layer=document.createElement('div');layer.className='genesis-network-ghost';document.body.append(layer);
  const banner=document.createElement('div');banner.className='genesis-placement-banner genesis-network-banner';
  const title=document.createElement('strong');title.textContent=`${gmFree?'GM · бесплатная ':''}Ручная сеть: ${type==='power'?'кабель':'водопровод'}`;
  const hint=document.createElement('span');hint.textContent='ЛКМ — соседняя клетка · Backspace — назад · Enter — завершить · Esc — отмена';
  const count=document.createElement('span');count.className='genesis-network-counter';
  const done=document.createElement('button');done.type='button';done.textContent='Завершить';done.disabled=true;
  const back=document.createElement('button');back.type='button';back.textContent='↶';
  const close=document.createElement('button');close.type='button';close.textContent='Отмена';
  banner.append(title,hint,count,back,done,close);document.body.append(banner);
  const links=colony?.system?.infrastructure?.links||[];
  let route=[],hover=null,stopped=false,submitting=false;
  const cancel=()=>{if(stopped)return;stopped=true;controller.abort();layer.remove();banner.remove();
    Hooks.off('canvasTearDown',onTeardown);Hooks.off('canvasPan',onPan);
    if(active?.cancel===cancel)active=null;};
  const validFinish=()=>{try{validateManualRoute(scene,placements,fromId,toId,route,{links});return true;}catch{return false;}};
  const marker=(point,state)=>{
    const g=scene.grid.size;
    const start=canvas.clientCoordinatesFromCanvas(point),end=canvas.clientCoordinatesFromCanvas({x:point.x+g,y:point.y+g});
    const cell=document.createElement('div');cell.className=`genesis-network-cell ${state}`;
    cell.style.left=`${start.x}px`;cell.style.top=`${start.y}px`;
    cell.style.width=`${Math.max(1,end.x-start.x)}px`;cell.style.height=`${Math.max(1,end.y-start.y)}px`;
    layer.append(cell);
  };
  const render=()=>{
    if(stopped)return;
    layer.replaceChildren();
    for(const point of route)marker(point,'is-drawn');
    if(hover){let good=true;
      try{appendManualStep(scene,placements,fromId,route,hover,{links});}catch{good=false;}
      if(!route.some(p=>p.x===hover.x&&p.y===hover.y))marker(hover,good?'is-valid':'is-invalid');
    }
    const ready=validFinish();done.disabled=!ready||submitting;
    back.disabled=!route.length||submitting;
    count.textContent=`${route.length}/${NETWORK_LIMITS.maxRoute} клеток${ready?' · можно завершить':''}`;
  };
  const onTeardown=()=>cancel(),onPan=()=>render();
  Hooks.on('canvasTearDown',onTeardown);Hooks.on('canvasPan',onPan);
  const redrawAt=event=>{
    if(stopped||submitting)return;
    if(!isCanvasTarget(event.target)){hover=null;render();return;}
    try{hover=snapNetworkCell(scene,canvas.canvasCoordinatesFromClient({x:event.clientX,y:event.clientY}));}
    catch{hover=null;}
    render();
  };
  const accept=async()=>{
    if(stopped||submitting||!validFinish())return;
    submitting=true;render();
    let approved=false;
    try{approved=await foundry.applications.api.DialogV2.confirm({window:{title:'Подтвердить ручной маршрут'},
      content:gmFree?`<p>GM: проложить ${route.length} сегментов БЕЗ затрат материалов? Правила маршрута сохраняются.</p>`:
        `<p>Проложить инженерную сеть длиной ${route.length} клеток? Стоимость будет рассчитана ведущим, а ресурсы списаны со склада колонии.</p>`,
      yes:{label:'Проложить'},no:{label:'Продолжить редактирование'}});}catch{approved=false;}
    if(stopped)return;
    if(approved){const submitted=route.map(c=>({...c}));cancel();await requestNetwork({action:gmFree?'gm-connect':'connect',colonyId,type,fromId,toId,route:submitted});}
    else{submitting=false;render();}
  };
  const undo=()=>{if(submitting)return;route.pop();render();};
  close.addEventListener('click',cancel,{signal:controller.signal});
  back.addEventListener('click',undo,{signal:controller.signal});
  done.addEventListener('click',()=>void accept(),{signal:controller.signal});
  document.addEventListener('pointermove',redrawAt,options);
  window.addEventListener('resize',render,{signal:controller.signal});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();cancel();}
    else if(event.key==='Backspace'&&!(event.target instanceof HTMLInputElement)){event.preventDefault();undo();}
    else if(event.key==='Enter'){event.preventDefault();void accept();}
  },options);
  document.addEventListener('contextmenu',event=>{if(isCanvasTarget(event.target)){event.preventDefault();event.stopPropagation();cancel();}},options);
  document.addEventListener('pointerdown',event=>{
    if(stopped||submitting||event.button!==0||!isCanvasTarget(event.target))return;
    event.preventDefault();event.stopImmediatePropagation();
    try{
      const cell=snapNetworkCell(scene,canvas.canvasCoordinatesFromClient({x:event.clientX,y:event.clientY}));
      route=appendManualStep(scene,placements,fromId,route,cell,{links});hover=null;render();
    }catch(error){ui.notifications.warn(error.message);}
  },options);
  active={cancel};render();
  ui.notifications.info('Выбирайте соседние клетки от здания А к зданию Б.');
}

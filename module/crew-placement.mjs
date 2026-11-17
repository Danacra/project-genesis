/** GM scene editor for finite resource deposits. */
import {snapNode,RESOURCE_NODES} from './crew-rules.mjs';
import {requestCrew} from './crew.mjs';
let active=null;
const onCanvas=e=>e.target===canvas?.app?.canvas||e.target===canvas?.app?.view||e.target?.id==='board';
export function stopResourcePlacement(){active?.();active=null;}
export function startResourcePlacement({colonyId,resourceCode,amount}){
  stopResourcePlacement();
  if(!game.user.isGM)return ui.notifications.warn('Месторождения размещает ведущий.');
  const scene=canvas?.scene,resource=RESOURCE_NODES[resourceCode];
  if(!canvas?.ready||!scene||!resource)return ui.notifications.warn('Откройте локальную сцену с квадратной сеткой.');
  let stopped=false,busy=false,cursor=null;
  const ghost=document.createElement('div');ghost.className='genesis-map-ghost genesis-resource-ghost';ghost.style.display='none';
  const bar=document.createElement('div');bar.className='genesis-placement-banner';
  const label=document.createElement('strong');label.textContent=`Месторождение: ${resource.name} · ${amount} ед.`;
  const guide=document.createElement('span');guide.textContent='ЛКМ — разместить ресурс · ПКМ / Esc — отмена';
  const cancelButton=document.createElement('button');cancelButton.type='button';cancelButton.textContent='Отмена';
  bar.append(label,guide,cancelButton);document.body.append(ghost,bar);
  const controller=new AbortController(),option={signal:controller.signal,capture:true};
  const clear=()=>{if(stopped)return;stopped=true;controller.abort();ghost.remove();bar.remove();
    Hooks.off('canvasPan',pan);Hooks.off('canvasTearDown',clear);if(active===clear)active=null;};
  const paint=()=>{
    if(stopped||busy||!cursor)return;
    if(canvas.scene?.id!==scene.id){clear();return;}
    try{const p=canvas.canvasCoordinatesFromClient(cursor),rect=snapNode(scene,p);
      const tl=canvas.clientCoordinatesFromCanvas({x:rect.x,y:rect.y});
      const br=canvas.clientCoordinatesFromCanvas({x:rect.x+rect.width,y:rect.y+rect.height});
      ghost.style.display='flex';ghost.style.left=`${tl.x}px`;ghost.style.top=`${tl.y}px`;
      ghost.style.width=`${Math.max(1,br.x-tl.x)}px`;ghost.style.height=`${Math.max(1,br.y-tl.y)}px`;
      ghost.classList.add('is-valid');ghost.classList.remove('is-invalid');
      ghost.textContent=resource.name;
    }catch(error){ghost.style.display='none';}
  };
  const pan=()=>paint();Hooks.on('canvasPan',pan);Hooks.on('canvasTearDown',clear);
  cancelButton.addEventListener('click',clear,{signal:controller.signal});
  window.addEventListener('resize',pan,{signal:controller.signal});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();clear();}},option);
  document.addEventListener('contextmenu',e=>{if(onCanvas(e)){e.preventDefault();e.stopPropagation();clear();}},option);
  document.addEventListener('pointermove',e=>{if(!onCanvas(e)){cursor=null;ghost.style.display='none';return;}
    cursor={x:e.clientX,y:e.clientY};paint();},option);
  document.addEventListener('pointerdown',async e=>{
    if(stopped||busy||e.button!==0||!onCanvas(e))return;
    e.preventDefault();e.stopImmediatePropagation();
    try{const p=canvas.canvasCoordinatesFromClient({x:e.clientX,y:e.clientY}),rect=snapNode(scene,p);
      busy=true;const yes=await foundry.applications.api.DialogV2.confirm({window:{title:'Создать месторождение'},
        content:`<p>Поместить ${resource.name} (${amount} единиц) на выбранной клетке?</p>`,
        yes:{label:'Разместить'},no:{label:'Выбрать другую клетку'}});
      if(stopped)return;
      if(yes){clear();await requestCrew({action:'create-node',colonyId,resourceCode,amount,
        sceneId:scene.id,x:rect.x,y:rect.y});}
      else {busy=false;paint();}
    }catch(error){busy=false;ui.notifications.warn(error.message);}
  },option);
  active=clear;
  ui.notifications.info(`Выберите место для ресурса «${resource.name}» на карте.`);
}

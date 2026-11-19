/** PROJECT GENESIS 1.5 — immersive virtual worktable, no resources debit in the browser.
 * Players select a researched drawing, then stage resource codes from ONE storage
 * source on a worktable. The authoritative GM validates every operation again.
 */
import {RECIPES,resourceName,BUILDING_BY_ID} from './industry-data.mjs';
import {effectiveUnlocked} from './research-rules.mjs';
import {tierOf,stationSupportsRecipe} from './building-progress.mjs';
import {crewState,stockFor} from './crew-rules.mjs';
import {warehouseNearStation} from './local-storage-rules.mjs';
import {requestCraftNow} from './industry.mjs';
const SYSTEM='project-genesis';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function grouped(rows,embedded=false){
  const out=new Map();
  for(const row of rows||[]){
    if(embedded&&row.type==='container')continue;
    const code=String(embedded?row.system?.resourceCode:row.code||'').trim();
    const count=Number(embedded?row.system?.quantity:row.quantity);
    if(!code||!Number.isSafeInteger(count)||count<1)continue;
    out.set(code,(out.get(code)||0)+count);
  }
  return out;
}
function candidates(colony,placement){
  const sources=[{id:'colony',name:'Общий склад колонии',kind:'colony',get:()=>grouped(colony.items,true)}];
  for(const actor of game.actors.filter(a=>a.type==='survivor'&&
    (game.user.isGM||a.testUserPermission(game.user,'OWNER')))){
    sources.push({id:`actor:${actor.id}`,name:`Личный инвентарь: ${actor.name}`,kind:'actor',actorId:actor.id,
      get:()=>grouped(actor.items,true)});
  }
  for(const warehouse of (colony.system.industry?.placements||[]).filter(w=>warehouseNearStation(placement,w,game.scenes))){
    sources.push({id:`local:${warehouse.id}`,name:`Локальный склад · ${game.scenes.get(warehouse.sceneId)?.name||'Сцена'} (${warehouse.id.slice(0,6)})`,
      kind:'local',placementId:warehouse.id,get:()=>grouped(stockFor(crewState(colony),warehouse.id))});
  }
  return sources;
}
let currentWindow=null;
/** Open board from a real Scene workstation or the colony placement table. */
export function showCraftBoard(colony,placement){
  if(currentWindow?.isConnected)currentWindow.remove();
  const unlocked=effectiveUnlocked(colony.system.science);
  const recipes=RECIPES.filter(r=>(stationSupportsRecipe(placement,r)||(!r.station&&placement.buildingId==='bench'))&&unlocked.has(r.techId));
  const sources=candidates(colony,placement);
  let recipe=recipes[0]||null,source=sources[0],staged=new Map(),busy=false;
  const modal=document.createElement('div');modal.className='genesis-craft-backdrop';currentWindow=modal;
  modal.innerHTML=`<section class="genesis-craft-modal" role="dialog" aria-modal="true" aria-label="Рабочий стол">
    <header class="genesis-craft-header"><div><small>PROJECT GENESIS · СТАНОК УРОВНЯ ${tierOf(placement)}</small>
      <h2>${escape(BUILDING_BY_ID[placement.buildingId]?.name||'Производство')} — рабочий стол</h2></div>
      <button type="button" data-close aria-label="Закрыть">✕</button></header>
    <div class="genesis-craft-columns"><aside class="genesis-craft-shelf">
      <strong>1. Выберите источник материалов</strong><select data-source></select>
      <p class="genesis-craft-note">Перетащите материал на стол или нажмите «+». Для удобства «Все» добавляет необходимое количество. Смена источника очищает стол; материалы пока не расходуются.</p>
      <div data-materials class="genesis-craft-materials"></div>
    </aside><main>
      <label>2. Изученный чертёж <select data-recipe style="width:100%;margin:8px 0 12px"></select></label>
      <div class="genesis-craft-worktop" data-worktop tabindex="0">
        <strong>3. РАБОЧАЯ ПОВЕРХНОСТЬ</strong>
        <p class="genesis-craft-note">Перенесите сюда ингредиенты из списка слева.</p>
        <div class="genesis-craft-slots" data-slots></div></div>
      <p data-status class="genesis-craft-note" role="status"></p>
    </main></div>
    <footer class="genesis-craft-footer"><button type="button" data-reset>Очистить стол</button>
      <span data-output class="genesis-craft-note"></span>
      <button type="button" class="genesis-craft-make" data-make disabled>Скрафтить</button>
    </footer></section>`;
  const qs=s=>modal.querySelector(s),sourceSelect=qs('[data-source]'),recipeSelect=qs('[data-recipe]');
  sourceSelect.innerHTML=sources.map(s=>`<option value="${escape(s.id)}">${escape(s.name)}</option>`).join('');
  recipeSelect.innerHTML=recipes.length?recipes.map(r=>`<option value="${escape(r.id)}">${escape(r.name)} · ур. ${r.minTier||1}</option>`).join(''):'<option value="">Нет изученных чертежей для этого станка</option>';
  function redraw(){
    const stock=source.get();
    qs('[data-materials]').innerHTML=[...stock].map(([code,count])=>`<div class="genesis-craft-material" draggable="true" tabindex="0" data-material="${escape(code)}">
      <span>${escape(resourceName(code))}</span><small>×${count}</small>
      <button type="button" data-add="${escape(code)}" title="Положить одну единицу">+</button>
      <button type="button" data-fill="${escape(code)}" title="Положить оставшееся нужное количество">Все</button></div>`).join('') || '<p class="genesis-craft-note">Здесь пока нет ресурсов.</p>';
    qs('[data-slots]').innerHTML=recipe?Object.entries(recipe.inputs).map(([code,required])=>{
      const placed=staged.get(code)||0,full=placed===required;
      return `<div class="genesis-craft-slot ${full?'complete':''}"><span>${escape(resourceName(code))}</span>
        <strong>${placed} / ${required}</strong><button type="button" data-remove="${escape(code)}" ${busy||!placed?'disabled':''}>Убрать 1</button></div>`;
    }).join(''):'<p>Изучите чертёж, чтобы узнать состав изделия.</p>';
    qs('[data-output]').textContent=recipe?`Результат: ${recipe.name} ×${recipe.output.quantity}`:'';
    qs('[data-make]').disabled=busy||!recipe||!Object.entries(recipe.inputs).every(([code,count])=>(staged.get(code)||0)===count);
    sourceSelect.disabled=busy;recipeSelect.disabled=busy;qs('[data-reset]').disabled=busy;
  }
  const say=message=>{qs('[data-status]').textContent=message;};
  function add(code,all=false){
    if(busy||!recipe||!Object.hasOwn(recipe.inputs,code)){say('Этот материал не нужен для выбранного чертежа.');return;}
    const have=source.get().get(code)||0,needed=recipe.inputs[code],put=staged.get(code)||0;
    const n=Math.min(needed-put,have-put,all?999999:1);
    if(n<1){say('Больше этого материала на стол добавить нельзя.');return;}
    staged.set(code,put+n);say('Ингредиент добавлен на стол. Реальные запасы не изменились.');redraw();
  }
  sourceSelect.addEventListener('change',()=>{source=sources.find(s=>s.id===sourceSelect.value)||sources[0];staged=new Map();say('Источник изменён, стол очищен.');redraw();});
  recipeSelect.addEventListener('change',()=>{recipe=recipes.find(r=>r.id===recipeSelect.value)||null;staged=new Map();say('Чертёж выбран.');redraw();});
  modal.addEventListener('click',async event=>{
    if(event.target===modal||event.target.closest('[data-close]')){if(!busy)modal.remove();return;}
    const addButton=event.target.closest('[data-add]');if(addButton){add(addButton.dataset.add);return;}
    const fillButton=event.target.closest('[data-fill]');if(fillButton){add(fillButton.dataset.fill,true);return;}
    const remove=event.target.closest('[data-remove]');if(remove&&!busy){const code=remove.dataset.remove;staged.set(code,Math.max(0,(staged.get(code)||0)-1));redraw();return;}
    if(event.target.closest('[data-reset]')&&!busy){staged=new Map();redraw();return;}
    if(!event.target.closest('[data-make]')||busy||!recipe)return;
    if(!Object.entries(recipe.inputs).every(([code,count])=>(staged.get(code)||0)===count))return;
    busy=true;redraw();const tabletop=qs('[data-worktop]');
    tabletop.classList.add('is-crafting');say('GM проверяет ресурсы и выполняет изготовление…');
    try{
      const result=await requestCraftNow({colonyId:colony.id,stationPlacementId:placement.id,subject:recipe.id,
        sourceKind:source.kind,sourceActorId:source.actorId||'',sourcePlacementId:source.placementId||'',
        staged:[...staged].map(([code,count])=>({code,count}))});
      tabletop.classList.remove('is-crafting');tabletop.classList.add('is-finished');
      say('✓ '+result);staged=new Map();
      setTimeout(()=>{if(modal.isConnected){tabletop.classList.remove('is-finished');busy=false;redraw();}},900);
    }catch(error){tabletop.classList.remove('is-crafting');busy=false;say('Ошибка: '+(error.message||error));redraw();}
  });
  modal.addEventListener('dragstart',event=>{
    const item=event.target.closest?.('[data-material]');if(!item||busy)return;
    event.dataTransfer?.setData('text/plain',item.dataset.material);
  });
  const worktop=qs('[data-worktop]');
  worktop.addEventListener('dragover',event=>{event.preventDefault();worktop.classList.add('is-over');});
  worktop.addEventListener('dragleave',()=>worktop.classList.remove('is-over'));
  worktop.addEventListener('drop',event=>{event.preventDefault();worktop.classList.remove('is-over');add(event.dataTransfer?.getData('text/plain')||'');});
  modal.addEventListener('keydown',event=>{if(event.key==='Escape'&&!busy)modal.remove();});
  document.body.append(modal);
  redraw();
  if(!recipes.length)say('Пока нет изученных рецептов для этого уровня станка. Откройте чертежи в дереве технологий.');
  return modal;
}

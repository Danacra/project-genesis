import { ABILITIES, SKILLS, ITEM_TYPES, measure, capacity, containerCapacity, itemLoad,
  perQuantity, plus, fits, round, qty, checkResult, summarizeInventory } from './rules.mjs';
import { requestTransfer, recentOperations, advanceDay } from './logistics.mjs';
import { researchContext, colonyFor, requestResearch, TECHNOLOGIES, FIELD_STUDIES } from './research.mjs';
import {planetContext,PLANET_ZONES} from './planet.mjs';
import {restContext,requestRest} from './rest.mjs';
import {missionStage,requestMission} from './mission.mjs';
import { industryContext, requestIndustry } from './industry.mjs';
import { startPlacement, showPlacementOnScene } from './map-placement.mjs';
import { networkContext, requestNetwork, getNetworkSimulation } from './networks.mjs';
import {startNetworkDrawing} from './network-drawing.mjs';
import {crewContext,requestCrew,RESOURCE_NODES} from './crew.mjs';
import {startResourcePlacement} from './crew-placement.mjs';
import {enterRoom,openStationCraft} from './building-interactions.mjs';
import {salvageFor} from './structure-rules.mjs';
import {BUILDING_BY_ID,resourceName} from './industry-data.mjs';
const {HandlebarsApplicationMixin} = foundry.applications.api;
const {ActorSheetV2,ItemSheetV2} = foundry.applications.sheets;
const Dialog = foundry.applications.api.DialogV2;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const opt = (value,label) => `<option value="${esc(value)}">${esc(label)}</option>`;
const formNum = (form,name) => Number(form.elements.namedItem(name)?.value);
const formText = (form,name) => String(form.elements.namedItem(name)?.value ?? '').trim();
function listContexts(actor, inventory) {
  return actor.items.filter(i=>i.type!=='container' && qty(i)>0).map(i=>{
    const load=itemLoad(i);
    const c=inventory.containers.get(i.system.containerId);
    return {id:i.id,name:i.name,img:i.img,kind:ITEM_TYPES[i.type]||i.type,
      quantity:qty(i),mass:load.mass,volume:load.volume,
      unitMass:round(i.system.unitMass),unitVolume:round(i.system.unitVolume),
      resourceCode:i.system.resourceCode||'',location:c?.name||'Основной отсек'};
  });
}
function containerContexts(actor, inventory){
  return actor.items.filter(i=>i.type==='container').map(i=>{
    const used=inventory.byContainer.get(i.id)||{mass:0,volume:0};
    return {id:i.id,name:i.name,...containerCapacity(i),
      used:{mass:round(used.mass),volume:round(used.volume)}};
  });
}
async function askTransfer(actor,item){
  const options=[];
  for(const a of game.actors.filter(a=>a.type==='colony'||a.type==='survivor'||(a.type==='npc'&&game.user.isGM))){
    const kind=a.type==='colony'?'Общий склад колонии':a.type==='npc'?'NPC (GM)':'Выживший';
    const access=game.user.isGM||a.type==='colony'||a.testUserPermission(game.user,'OWNER');
    const label=access?'':' · чужой персонаж (только получение)';
    options.push(opt(`${a.id}|`,`${kind}: ${a.name} — основной отсек${label}`));
    for(const c of a.items.filter(i=>i.type==='container')){
      options.push(opt(`${a.id}|${c.id}`,`${kind}: ${a.name} — ${c.name}${label}`));
    }
  }
  if(!options.length){ui.notifications.warn('Нет доступных получателей.');return;}
  let selection;
  try{
    selection=await Dialog.prompt({
      window:{title:`Передача: ${item.name}`},
      content:`<div class="genesis-dialog"><p>Доступно: <strong>${qty(item)}</strong> шт.</p>
        <label>Куда переместить<select name="destination">${options.join('')}</select></label>
        <label>Количество<input type="number" name="quantity" min="1" max="${qty(item)}" value="1" step="1" required></label></div>`,
      ok:{label:'Переместить',callback:(_event,button)=>({destination:formText(button.form,'destination'),quantity:formNum(button.form,'quantity')})}
    });
  }catch{return;}
  if(!selection)return;
  const [targetActorId,targetContainerId='']=selection.destination.split('|');
  await requestTransfer({sourceActorId:actor.id,targetActorId,targetContainerId,itemId:item.id,quantity:selection.quantity});
}
async function askNewItem(actor,isContainer=false){
  const types=Object.entries(ITEM_TYPES).filter(([id])=>id!=='container');
  let data;
  try{
    data=await Dialog.prompt({window:{title:isContainer?'Новый контейнер':'Новый предмет'},
      content:isContainer?`<div class="genesis-dialog">
        <label>Название<input name="name" value="Контейнер" required maxlength="80"></label>
        <label>Лимит массы, кг<input name="capacityMass" type="number" value="30" min="0" step="0.01"></label>
        <label>Лимит объёма, л<input name="capacityVolume" type="number" value="50" min="0" step="0.01"></label>
        <label>Собственная масса, кг<input name="tareMass" type="number" value="2" min="0" step="0.01"></label>
        <label>Собственный объём, л<input name="tareVolume" type="number" value="5" min="0" step="0.01"></label></div>`:
        `<div class="genesis-dialog"><label>Название<input name="name" value="Новый материал" maxlength="80" required></label>
         <label>Тип<select name="type">${types.map(([id,name])=>opt(id,name)).join('')}</select></label>
         <label>Количество<input type="number" name="quantity" value="1" min="1" max="999999" step="1" required></label>
         <label>Масса 1 шт., кг<input type="number" name="unitMass" value="1" min="0" step="0.01" required></label>
         <label>Объём 1 шт., л<input type="number" name="unitVolume" value="1" min="0" step="0.01" required></label>
         <label>Код ресурса (food / water / другое)<input name="resourceCode" maxlength="50"></label></div>`,
      ok:{label:'Создать',callback:(_ev,button)=>{
        const f=button.form;return isContainer?{
          name:formText(f,'name'),type:'container',system:{
            capacityMass:formNum(f,'capacityMass'),capacityVolume:formNum(f,'capacityVolume'),
            tareMass:formNum(f,'tareMass'),tareVolume:formNum(f,'tareVolume')}
        }:{name:formText(f,'name'),type:formText(f,'type'),system:{
          quantity:formNum(f,'quantity'),unitMass:formNum(f,'unitMass'),
          unitVolume:formNum(f,'unitVolume'),resourceCode:formText(f,'resourceCode')}
        };
      }}
    });
  }catch{return;}
  if(!data)return;
  try{
    if(!data.name) throw new Error('Укажите название.');
    const values=Object.values(data.system).filter(x=>typeof x==='number');
    if(values.some(x=>!Number.isFinite(x)||x<0)) throw new Error('Недопустимое число.');
    if(!isContainer && (!ITEM_TYPES[data.type]|| !Number.isSafeInteger(data.system.quantity) || data.system.quantity<1)) throw new Error('Неверные параметры предмета.');
    const added=isContainer?{mass:data.system.tareMass,volume:data.system.tareVolume}:perQuantity({system:data.system},data.system.quantity);
    if(!fits(plus(measure(actor.items),added),capacity(actor)))throw new Error('Новый предмет не помещается в инвентарь.');
    await actor.createEmbeddedDocuments('Item',[data]);
  }catch(error){ui.notifications.error(error.message);}
}
async function rollCheck(actor,ability){
  let input;
  try{
    input=await Dialog.prompt({window:{title:`Проверка — ${ABILITIES[ability]}`},
      content:`<div class="genesis-dialog"><label>Навык<select name="skill">${opt('','Без навыка')}${Object.entries(SKILLS).map(([k,v])=>opt(k,v)).join('')}</select></label>
        <label>Сложность<select name="difficulty">${opt('10','Простая · 10')}${opt('13','Обычная · 13')}${opt('16','Трудная · 16')}${opt('20','Очень трудная · 20')}</select></label></div>`,
      ok:{label:'Бросить 2d10',callback:(_e,b)=>({skill:formText(b.form,'skill'),difficulty:formNum(b.form,'difficulty')})}
    });
  }catch{return;}
  if(!input)return;
  const a=Number(actor.system.abilities[ability]);
  const s=Number(input.skill?actor.system.skills[input.skill]:0);
  const roll=await new Roll('2d10 + @ability + @skill',{ability:a,skill:s}).evaluate();
  const result=checkResult(roll.dice[0]?.results?.[0]?.result ?? 0,roll.dice[0]?.results?.[1]?.result ?? 0,a,s,input.difficulty);
  const name=esc(actor.name),label=esc(ABILITIES[ability]),skillName=input.skill?` + ${esc(SKILLS[input.skill])}`:'';
  await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:`${name}: ${label}${skillName}. Сложность ${input.difficulty} — <strong>${result.success?'успех':'неудача'}</strong>.`});
}
async function askResearch(sheet,action,techId='',facilityId='') {
  const actor=sheet.document;
  const colony=colonyFor(actor);
  if(!colony) {ui.notifications.warn('Сначала создайте актора типа «Колония».');return;}
  let details={colonyId:colony.id,techId,facilityId,action};
  if(action==='work') {
    const people=game.actors.filter(a=>a.type==='survivor' &&
      (game.user.isGM || a.testUserPermission(game.user,'OWNER')));
    if(!people.length){ui.notifications.warn('Нет доступного исследователя.');return;}
    const candidates=people.filter(a=>!(colony.system.science.dailyWork||[]).some(w=>w.actorId===a.id&&w.day===game.settings.get('project-genesis','worldDay')));
    if(!candidates.length){ui.notifications.warn('Все доступные персонажи уже исследовали сегодня.');return;}
    let selection;
    try {selection=await Dialog.prompt({window:{title:'Исследовательская экспедиция'},
      content:`<div class="genesis-dialog"><p>Один бросок Интеллект + Наука на персонажа в сутки.</p>
        <label>Исследователь<select name="actorId">${candidates.map(a=>opt(a.id,a.name)).join('')}</select></label></div>`,
      ok:{label:'Исследовать',callback:(_e,b)=>formText(b.form,'actorId')}});
    }catch{return;}
    if(!selection)return;
    details.actorId=selection;
  }
  if(action==='invest'||action==='grant') {
    const max=action==='grant'?1000:Math.min(Number(colony.system.science.points),
      ([...TECHNOLOGIES,...FIELD_STUDIES].find(t=>t.id===techId)?.rp || 0)-((colony.system.science.projects||[]).find(p=>p.id===techId)?.invested || 0));
    if(action==='invest' && max<1){ui.notifications.warn('Недостаточно свободных очков или проект уже профинансирован.');return;}
    let amount;
    try{amount=await Dialog.prompt({window:{title:action==='grant'?'Начислить очки (GM)':'Вложить очки в проект'},
      content:`<div class="genesis-dialog"><label>Очки исследований (1–${max})<input type="number" name="amount" value="${Math.min(max,5)}" min="1" max="${max}" step="1" required></label></div>`,
      ok:{label:'Подтвердить',callback:(_e,b)=>formNum(b.form,'amount')}});
    }catch{return;}
    if(amount===null||amount===undefined)return;
    details.amount=amount;
  }
  await requestResearch(details);
}
async function askNetwork(sheet,el){
  const colony=colonyFor(sheet.document);
  if(!colony)return ui.notifications.warn('Создайте колонию для управления инженерными сетями.');
  const action=el.dataset.networkAction;
  if(['connect','draw','gm-connect','gm-draw'].includes(action)){
    const gmFree=action==='gm-connect'||action==='gm-draw';
    if(gmFree&&!game.user.isGM)return ui.notifications.warn('Бесплатные инженерные работы доступны только GM.');
    const context=networkContext(colony,game.user);
    if(context.buildings.length<2)return ui.notifications.warn('Для сети нужны два готовых здания на карте.');
    const entries=context.buildings.filter(b=>b.working||b.status==='Нет питания'||b.status==='Нет водоснабжения'||b.status==='Ручной режим');
    const choices=entries.map(b=>opt(b.id,`${b.name} · ${b.sceneName} (${b.x}, ${b.y})`)).join('');
    const endChoices=[...entries.slice(1),entries[0]].map(b=>opt(b.id,`${b.name} · ${b.sceneName} (${b.x}, ${b.y})`)).join('');
    if(entries.length<2)return ui.notifications.warn('На карте недостаточно исправных готовых зданий.');
    const types=context.types.map(t=>opt(t.id,t.name)).join('');
    let chosen;
    try{chosen=await Dialog.prompt({window:{title:gmFree?'Прокладка инженерной сети (GM, бесплатно)':'Прокладка инженерной сети'},
      content:`<div class="genesis-dialog"><p>${gmFree?'GM: кабели и трубы бесплатно, без исследований и списания материалов.':'Система сама найдёт маршрут по клеткам вокруг построек. Кабель использует медь, водопровод — сплав. Точная стоимость будет вычислена перед списанием на сервере ведущего.'}</p>
        <label>Тип коммуникации<select name="type">${types}</select></label>
        <label>Здание A<select name="fromId">${choices}</select></label>
        <label>Здание B<select name="toId">${endChoices}</select></label>
        <small>Оба здания должны находиться на одной локальной сцене.</small></div>`,
      ok:{label:'Проложить',callback:(_e,button)=>({type:formText(button.form,'type'),
        fromId:formText(button.form,'fromId'),toId:formText(button.form,'toId')})}});}
    catch{return;}
    if(chosen){if(action==='draw'||action==='gm-draw')startNetworkDrawing({...chosen,colonyId:colony.id,gmFree});
      else await requestNetwork({...chosen,colonyId:colony.id,action:gmFree?'gm-connect':'connect'});}
    return;
  }
  const linkId=el.dataset.linkId;
  if(action==='priority'){
    await requestNetwork({action,colonyId:colony.id,placementId:el.dataset.placementId,priority:Number(el.dataset.priority)});
    return;
  }
  if(action==='disconnect'){
    let accepted=false;
    try{accepted=await Dialog.confirm({window:{title:'Демонтаж сети'},
      content:'<p>Выбранные кабели или трубы будут удалены с карты. Затраченные материалы не возвращаются.</p>',
      yes:{label:'Демонтировать'},no:{label:'Отмена'}});}catch{return;}
    if(!accepted)return;
  }
  await requestNetwork({action,colonyId:colony.id,linkId});
}
async function askIndustry(sheet,el){
  const colony=colonyFor(sheet.document);
  if(!colony){ui.notifications.warn('Сначала создайте актора «Колония».');return;}
  const action=el.dataset.industryAction;
  const details={colonyId:colony.id,action,subject:el.dataset.subject||'',
    jobId:el.dataset.jobId||'',queue:el.dataset.queue||''};
  if(action==='start-recipe'){
    let count;
    try{
      count=await Dialog.prompt({window:{title:'Производственный заказ'},
        content:`<div class="genesis-dialog"><p>Материалы будут списаны со склада при постановке в очередь.</p>
          <label>Количество партий (1–10)<input name="amount" type="number" min="1" max="10" step="1" value="1" required></label></div>`,
        ok:{label:'Начать производство',callback:(_e,b)=>formNum(b.form,'amount')}});
    }catch{return;}
    if(count==null)return;
    details.amount=count;
  }
  if(action==='dismantle'){
    if(!game.user.isGM)return ui.notifications.warn('Удалять готовые здания может только ведущий.');
    const placement=(colony.system.industry?.placements||[]).find(p=>p.id===el.dataset.placementId);
    if(!placement)return ui.notifications.warn('Постройка не найдена.');
    const mode=el.dataset.dismantleMode==='erase'?'erase':'salvage';
    const materials=salvageFor(placement.buildingId);
    const preview=Object.entries(materials).map(([code,count])=>`${esc(resourceName(code))} ×${count}`).join(', ')||'Нет пригодных материалов';
    let confirmed=false;
    try{confirmed=await Dialog.confirm({window:{title:mode==='erase'?'Удалить без возврата?':'Разобрать постройку?'},
      content:mode==='erase'?`<p>Административно удалить «${esc(BUILDING_BY_ID[placement.buildingId]?.name||placement.buildingId)}» без возврата ресурсов?</p>`:
        `<p>Разобрать «${esc(BUILDING_BY_ID[placement.buildingId]?.name||placement.buildingId)}»?</p><p>На склад вернётся примерно 50% стройматериалов (округление вниз): ${preview}.</p>`,
      yes:{label:mode==='erase'?'Удалить навсегда':'Разобрать и вернуть материалы'},no:{label:'Отмена'}});
    }catch{return;}
    if(!confirmed)return;
    return await requestIndustry({action:'dismantle',colonyId:colony.id,placementId:placement.id,mode});
  }
  if(action==='cancel'){
    let confirmed;
    try{confirmed=await Dialog.confirm({window:{title:'Отменить заказ?'},
      content:'<p>Материалы вернутся в исходное хранилище: общий или выбранный локальный склад (при наличии места).</p>',
      yes:{label:'Отменить и вернуть материалы'},no:{label:'Оставить заказ'}});
    }catch{return;}
    if(!confirmed)return;
  }
  await requestIndustry(details);
}
async function askCrew(sheet,el){
  const colony=colonyFor(sheet.document);
  if(!colony)return ui.notifications.warn('Для экспедиции сначала создайте колонию.');
  const action=el.dataset.crewAction;
  if(action==='finish'||action==='cancel'||action==='remove-empty'||action==='remove-node'){
    if(action==='remove-node'){
      let confirmed=false;
      try{confirmed=await Dialog.confirm({window:{title:'Удалить месторождение?'},
        content:'<p>Ведущий удалит точку ресурса с карты независимо от оставшегося запаса. Материалы не возвращаются и персонажи не изменяются. Точки с незавершённой добычей удалять нельзя.</p>',
        yes:{label:'Удалить без последствий'},no:{label:'Отмена'}});}catch{return;}
      if(!confirmed)return;
    }
    if(action==='cancel'){
      const confirmed=await Dialog.confirm({window:{title:'Отменить работу?'},
        content:'Зарезервированные материалы вернутся туда, откуда были взяты.',
        yes:{label:'Отменить задание'},no:{label:'Оставить'}});
      if(!confirmed)return;
    }
    return requestCrew({action,colonyId:colony.id,jobId:el.dataset.jobId,nodeId:el.dataset.nodeId});
  }
  if(action==='create-node'){
    if(!game.user.isGM)return;
    const type=el.dataset.resourceCode,resource=RESOURCE_NODES[type];
    if(!resource)return;
    let amount;
    try{amount=await Dialog.prompt({window:{title:`Разместить: ${resource.name}`},
      content:`<div class="genesis-dialog"><p>Ведущий задаёт доступный запас месторождения. Он не восстанавливается автоматически.</p>
        <label>Запас (1–${resource.limit})<input name="amount" type="number" min="1" max="${resource.limit}" value="${Math.min(resource.limit,60)}" step="1" required></label></div>`,
      ok:{label:'Выбрать место на карте',callback:(_e,b)=>formNum(b.form,'amount')}});}catch{return;}
    if(!Number.isSafeInteger(amount)||amount<1||amount>resource.limit)return ui.notifications.error('Недопустимое количество.');
    startResourcePlacement({colonyId:colony.id,resourceCode:type,amount});return;
  }
  const workers=game.actors.filter(a=>a.type==='survivor' && (game.user.isGM||a.testUserPermission(game.user,'OWNER')));
  if(!workers.length)return ui.notifications.warn('Нет доступных персонажей-выживших.');
  const active=new Set(colony.system.crew?.jobs?.map(j=>j.actorId)||[]);
  const available=workers.filter(a=>!active.has(a.id));
  if(!available.length)return ui.notifications.warn('Все ваши персонажи уже заняты.');
  const workerOptions=available.map(a=>opt(a.id,a.name)).join('');
  const placements=(colony.system.industry?.placements||[]).filter(p=>p.status==='finished'||p.status==='construction');
  const placeOptions=placements.map(p=>opt(p.id,`${game.projectGenesis?.buildings?.find(b=>b.id===p.buildingId)?.name||p.buildingId} · ${game.scenes.get(p.sceneId)?.name||'Нет карты'}`)).join('');
  const stocks=(colony.system.crew?.caches||[]).flatMap(c=>c.stock.map(r=>({placementId:c.placementId,...r})))
    .filter(c=>placements.some(p=>p.id===c.placementId&&p.buildingId!=='storehouse'));
  const stockOptions=stocks.map(c=>opt(`${c.placementId}|${c.code}`,`${c.name} ×${c.quantity} · ${placements.find(p=>p.id===c.placementId)?.buildingId||''}`)).join('');
  const pack=workers.flatMap(a=>a.items.filter(i=>i.type!=='container'&&i.system.quantity>0&&i.system.resourceCode)
    .map(i=>({actor:a,item:i}))).filter(x=>available.some(a=>a.id===x.actor.id));
  const packOptions=pack.map(({actor,item})=>opt(`${actor.id}|${item.id}`,`${actor.name} — ${item.name} ×${item.system.quantity}`)).join('');
  let fields='';
  if(action==='start-harvest'){
    const node=(colony.system.crew?.nodes||[]).find(n=>n.id===el.dataset.nodeId);
    if(!node||node.remaining<1)return ui.notifications.warn('Месторождение истощено.');
    fields=`<p>Месторождение: <strong>${esc(node.name)}</strong>, запас: ${node.remaining} ед. Персонаж должен быть рядом на карте.</p>
      <label>Выживший<select name="actorId">${workerOptions}</select></label>
      <label>Количество<input type="number" name="amount" min="1" max="${Math.min(120,node.remaining)}" value="1" required></label>`;
  }else if(action==='start-delivery'){
    if(!pack.length||!placements.length)return ui.notifications.warn('Нужны груз у выжившего и здание на карте.');
    fields=`<p>Груз забирается из инвентаря персонажа. Перевозка займёт игровые сутки.</p>
      <label>Отправитель / груз<select name="cargoChoice">${packOptions}</select></label>
      <label>Пункт доставки<select name="placementId">${placeOptions}</select></label>
      <label>Количество<input name="amount" type="number" min="1" max="120" value="1" required></label>`;
  }else if(action==='start-ship'||action==='start-pickup'){
    if(!stocks.length)return ui.notifications.warn('На локальных площадках нет грузов.');
    fields=`<p>${action==='start-ship'?'Доставка материалов между зданиями.':'Получение запасов с площадки в личный инвентарь.'} Выживший должен быть возле источника.</p>
      <label>Выживший<select name="actorId">${workerOptions}</select></label>
      <label>Груз и источник<select name="cargoChoice">${stockOptions}</select></label>
      ${action==='start-ship'?`<label>Пункт назначения<select name="placementId">${placeOptions}</select></label>`:''}
      <label>Количество<input name="amount" type="number" min="1" max="120" value="1" required></label>`;
  }else return;
  let form;
  try{form=await Dialog.prompt({window:{title:({
    'start-harvest':'Добыча ресурса','start-delivery':'Доставка из инвентаря',
    'start-ship':'Перевозка между объектами','start-pickup':'Забрать с площадки'})[action]},
    content:`<div class="genesis-dialog">${fields}</div>`,
    ok:{label:'Создать рабочее задание',callback:(_e,b)=>({actorId:formText(b.form,'actorId'),
      cargoChoice:formText(b.form,'cargoChoice'),placementId:formText(b.form,'placementId'),amount:formNum(b.form,'amount')})}});
  }catch{return;}
  if(!form)return;
  const data={action,colonyId:colony.id,amount:form.amount};
  if(action==='start-harvest')Object.assign(data,{actorId:form.actorId,nodeId:el.dataset.nodeId});
  if(action==='start-delivery'){
    const [actorId,itemId]=form.cargoChoice.split('|');Object.assign(data,{actorId,itemId,placementId:form.placementId});
  }
  if(action==='start-ship'||action==='start-pickup'){
    const [sourceId,resourceCode]=form.cargoChoice.split('|');Object.assign(data,{actorId:form.actorId,sourceId,resourceCode,placementId:form.placementId});
  }
  await requestCrew(data);
}
function drawTechnologyLinks(root) {
  const board=root.querySelector('[data-genesis-tech-board]');
  const svg=board?.querySelector('[data-genesis-tech-links]');
  if(!board || !svg)return;
  const ratio=board.offsetWidth?board.getBoundingClientRect().width / board.offsetWidth:1;
  const bbox=board.getBoundingClientRect();
  const width=board.scrollWidth,height=board.scrollHeight;
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
  svg.setAttribute('width',width);svg.setAttribute('height',height);
  svg.replaceChildren();
  const visible=new Map([...board.querySelectorAll('[data-genesis-tech-card]')].filter(n=>!n.hidden)
    .map(n=>[n.dataset.genesisTechCard,n]));
  const ns='http://www.w3.org/2000/svg';
  for(const tech of TECHNOLOGIES) {
    const to=visible.get(tech.id);
    if(!to)continue;
    const t=to.getBoundingClientRect();
    for(const parentId of tech.parents) {
      const from=visible.get(parentId);
      if(!from)continue;
      const f=from.getBoundingClientRect();
      const x1=(f.right-bbox.left)/ratio,y1=(f.top+f.height/2-bbox.top)/ratio;
      const x2=(t.left-bbox.left)/ratio,y2=(t.top+t.height/2-bbox.top)/ratio;
      const bend=Math.max(25,(x2-x1)*0.45);
      const path=document.createElementNS(ns,'path');
      path.setAttribute('d',`M ${x1} ${y1} C ${x1+bend} ${y1}, ${x2-bend} ${y2}, ${x2} ${y2}`);
      if(to.classList.contains('is-unlocked'))path.classList.add('is-unlocked');
      svg.append(path);
    }
  }
}
function fieldValue(actor,path){return foundry.utils.getProperty(actor.system,path);}
async function updateNamedField(document,el,allowed){
  const field=el.dataset.genesisField;
  if(!allowed.some(s=>field===s || field.startsWith(s+'.')))return;
  const numeric=el.type==='number';
  const value=numeric?Number(el.value):String(el.value);
  if(numeric&&!Number.isFinite(value)){ui.notifications.error('Нужно ввести число.');return;}
  try {await document.update({[`system.${field}`]:value});}
  catch(error){ui.notifications.error(error.message);}
}
export class GenesisActorSheet extends HandlebarsApplicationMixin(ActorSheetV2){
  static DEFAULT_OPTIONS={classes:['genesis','actor-sheet'],tag:'form',position:{width:840,height:740},
    window:{resizable:true,title:'PROJECT GENESIS'},
    form:{submitOnChange:false,closeOnSubmit:false},
    actions:{editImage:this.editImage}};
  static PARTS={body:{template:'systems/project-genesis/templates/actor.hbs'}};
  constructor(options={}){super(options);this._genesisTab='overview';this._techFilter='all';this._techQuery='';this._techSelected='survey';this._techZoom=1;this._subtreeOpen=false;this._subtechSelected='survey-landing';}
  async _prepareContext(options){
    const ctx=await super._prepareContext(options),actor=this.document;
    const cap=capacity(actor),inventory=summarizeInventory(actor.items),load=inventory.load;
    const isColony=actor.type==='colony',isSurvivor=actor.type==='survivor';
    const colony=colonyFor(actor),worldDay=game.settings.get('project-genesis','worldDay');
    // A network snapshot is expensive: compute it once, share it across all sheet sections.
    const networkSnapshot=colony?getNetworkSimulation(colony):null;
    return {...ctx,actor,isColony,isSurvivor,editable:actor.isOwner,isGM:game.user.isGM,
      abilities:Object.entries(ABILITIES).map(([key,label])=>({key,label,value:fieldValue(actor,`abilities.${key}`)})),
      skills:Object.entries(SKILLS).map(([key,label])=>({key,label,value:fieldValue(actor,`skills.${key}`)})),
      vitals:!isColony?Object.entries(actor.system.survival).map(([key,value])=>({key,value,label:({health:'Здоровье',hunger:'Голод',thirst:'Жажда',fatigue:'Усталость',oxygen:'Кислород'})[key]})):[],
      items:listContexts(actor,inventory),containers:containerContexts(actor,inventory),load,cap,
      totalItems:inventory.totalItems,
      worldDay,
      journal:recentOperations().slice(0,25),
      colony,
      tab:this._genesisTab,systemVersion:game.system.version,
      planet:planetContext(colony,worldDay),
      rest:{...restContext(actor,colony,worldDay),canAct:actor.isOwner},
      mission:{...missionStage(colony,worldDay),
        canAct:game.user.isGM || (game.actors.some(a=>a.type==='survivor'&&a.testUserPermission(game.user,'OWNER')))},
      research:researchContext(colony,game.user,networkSnapshot?.simulation),
      industry:industryContext(actor,game.user,networkSnapshot?.simulation),
      networks:networkContext(actor,game.user,networkSnapshot),
      crew:crewContext(actor,game.user)
    };
  }
  _onRender(context,options){
    super._onRender(context,options);
    const root=this.element;
    this._genesisEvents?.abort();
    this._genesisEvents=new AbortController();
    const eventOptions={signal:this._genesisEvents.signal};
    const selectTab=(name)=>{
      this._genesisTab=name;
      root.querySelectorAll('[data-genesis-page]').forEach(el=>{el.hidden=el.dataset.genesisPage!==name;});
      root.querySelectorAll('[data-genesis-tab]').forEach(el=>{
        const selected=el.dataset.genesisTab===name;
        el.classList.toggle('active',selected);
        el.setAttribute('aria-selected',String(selected));
      });
      root.querySelectorAll('[data-genesis-quick-nav]').forEach(el=>{el.value=name;});
    };
    selectTab(this._genesisTab);
    const board=root.querySelector('[data-genesis-tech-board]');
    const applyView=()=>{
      if(!board)return;
      const main=root.querySelector('[data-genesis-research-main]');
      const subtree=root.querySelector('[data-genesis-research-subtree]');
      if(main)main.hidden=this._subtreeOpen;
      if(subtree)subtree.hidden=!this._subtreeOpen;
      root.querySelectorAll('[data-genesis-subtech-card]').forEach(c=>{
        c.classList.toggle('is-selected',c.dataset.genesisSubtechCard===this._subtechSelected);
        c.setAttribute('aria-pressed',String(c.dataset.genesisSubtechCard===this._subtechSelected));
      });
      root.querySelectorAll('[data-genesis-subtech-detail]').forEach(d=>{d.hidden=d.dataset.genesisSubtechDetail!==this._subtechSelected;});
      board.style.zoom=String(this._techZoom);
      const query=this._techQuery.trim().toLocaleLowerCase();
      const visible=[];
      for(const card of board.querySelectorAll('[data-genesis-tech-card]')){
        const branchMatch=this._techFilter==='all'||card.dataset.genesisTechBranch===this._techFilter;
        const textMatch=!query||card.textContent.toLocaleLowerCase().includes(query);
        card.hidden=!(branchMatch&&textMatch);
        if(!card.hidden)visible.push(card.dataset.genesisTechCard);
      }
      if(!visible.includes(this._techSelected))this._techSelected=visible[0]||'';
      root.querySelector('[data-genesis-tech-empty]')?.toggleAttribute('hidden',visible.length>0);
      root.querySelectorAll('[data-genesis-tech-filter]').forEach(b=>b.classList.toggle('active',b.dataset.genesisTechFilter===this._techFilter));
      root.querySelectorAll('[data-genesis-tech-detail]').forEach(d=>{d.hidden=d.dataset.genesisTechDetail!==this._techSelected;});
      root.querySelectorAll('[data-genesis-tech-card]').forEach(c=>c.classList.toggle('is-selected',c.dataset.genesisTechCard===this._techSelected));
      root.querySelectorAll('[data-genesis-zoom-level]').forEach(e=>e.textContent=`${Math.round(this._techZoom*100)}%`);
      if(!this._subtreeOpen)drawTechnologyLinks(root);
    };
    this._techResizeObserver?.disconnect();
    this._techResizeObserver=null;
    if(board&&typeof ResizeObserver!=='undefined'){
      this._techResizeObserver=new ResizeObserver(()=>drawTechnologyLinks(root));
      this._techResizeObserver.observe(board);
    }
    applyView();
    if(root.querySelector('[data-genesis-tech-search]')) root.querySelector('[data-genesis-tech-search]').value=this._techQuery;
    root.querySelector('[data-genesis-tech-search]')?.addEventListener('input',event=>{
      this._techQuery=event.target.value;applyView();
    },eventOptions);
    // One delegated handler per event type instead of O(number of items) listeners.
    root.addEventListener('change',event=>{
      const quickNav=event.target.closest?.('[data-genesis-quick-nav]');
      if(quickNav){
        const target=quickNav.value;
        if(root.querySelector(`[data-genesis-page="${target}"]`)){
          selectTab(target);
          if(target==='research')applyView();
        }
        return;
      }
      const environmentSelect=event.target.closest?.('[data-planet-zone]');
      if(environmentSelect){
        const colony=colonyFor(this.document);
        if(game.user.isGM&&colony&&Object.hasOwn(PLANET_ZONES,environmentSelect.value)){
          void withWorldLock(()=>colony.update({'system.environment.zone':environmentSelect.value})).catch(error=>ui.notifications.error(error.message));
        }
        return;
      }
      const prioritySelect=event.target.closest?.('[data-network-priority]');
      if(prioritySelect){
        void requestNetwork({action:'priority',colonyId:prioritySelect.dataset.colonyId,
          placementId:prioritySelect.dataset.placementId,priority:Number(prioritySelect.value)});
        return;
      }
      const el=event.target.closest?.('[data-genesis-field]');
      if (!el || !this.document.isOwner) return;
      void updateNamedField(this.document,el,
        ['abilities','skills','survival','biography','specialization','notes','capacity','biome','name']);
    },eventOptions);
    root.addEventListener('click',async event=>{
      const shortcut=event.target.closest?.('[data-genesis-open-tab]');
      if(shortcut){
        const target=shortcut.dataset.genesisOpenTab;
        if(root.querySelector(`[data-genesis-page="${target}"]`)) selectTab(target);
        return;
      }
      const tab=event.target.closest?.('[data-genesis-tab]');
      if (tab) {selectTab(tab.dataset.genesisTab);if(tab.dataset.genesisTab==='research')applyView();return;}
      const techCard=event.target.closest?.('[data-genesis-tech-card]');
      if(techCard){
        this._techSelected=techCard.dataset.genesisTechCard;
        if(this._techSelected==='survey')this._subtreeOpen=true;
        applyView();return;
      }
      if(event.target.closest?.('[data-genesis-open-subtree]')){
        this._techSelected='survey';this._subtreeOpen=true;applyView();return;
      }
      if(event.target.closest?.('[data-genesis-back-to-tree]')){
        this._subtreeOpen=false;applyView();return;
      }
      const subCard=event.target.closest?.('[data-genesis-subtech-card]');
      if(subCard){this._subtechSelected=subCard.dataset.genesisSubtechCard;applyView();return;}
      const filter=event.target.closest?.('[data-genesis-tech-filter]');
      if(filter){this._techFilter=filter.dataset.genesisTechFilter;applyView();return;}
      const el=event.target.closest?.('[data-genesis-action]');
      if (!el) return;
      if(el.disabled)return;
      const action=el.dataset.genesisAction,item=this.document.items.get(el.dataset.itemId);
      // Avoid duplicate commands from repeated clicks before an async dialog completes.
      el.disabled=true;
      try {
        if(action==='transfer'&&item&&this.document.isOwner)await askTransfer(this.document,item);
        else if(action==='open-item'&&item)item.sheet.render(true);
        else if(action==='create'&&this.document.isOwner)await askNewItem(this.document);
        else if(action==='container'&&this.document.isOwner)await askNewItem(this.document,true);
        else if(action==='roll'&&this.document.isOwner)await rollCheck(this.document,el.dataset.ability);
        else if(action==='day'&&game.user.isGM)await advanceDay();
        else if(action==='rest'&&this.document.type==='survivor')await requestRest(this.document.id,el.dataset.restKind);
        else if(action==='mission'){const colony=colonyFor(this.document);if(colony)await requestMission(colony.id);}
        else if(['work','invest','complete','facility','grant'].includes(action))await askResearch(this,action,el.dataset.techId,el.dataset.facilityId);
        else if(action==='industry'&&['start-building','place-existing','gm-instant-build'].includes(el.dataset.industryAction)){
          const colony=colonyFor(this.document);
          const building=el.dataset.subject;
          const definition=game.projectGenesis?.buildings?.find(b=>b.id===building);
          if(colony&&definition)startPlacement({colonyId:colony.id,buildingId:building,buildingName:definition.name,
            existing:el.dataset.industryAction==='place-existing',
            instant:el.dataset.industryAction==='gm-instant-build'});
        }
        else if(action==='enter-room'){
          const colony=colonyFor(this.document);
          if(colony)await enterRoom(colony.id,el.dataset.placementId);
        }
        else if(action==='station-craft'){
          const colony=colonyFor(this.document);
          if(colony)await openStationCraft(colony.id,el.dataset.placementId);
        }
        else if(action==='repair-map'&&game.user.isGM){
          const colony=colonyFor(this.document);
          if(colony)await requestIndustry({action:'repair-map',colonyId:colony.id,placementId:el.dataset.placementId});
        }
        else if(action==='industry')await askIndustry(this,el);
        else if(action==='network')await askNetwork(this,el);
        else if(action==='crew')await askCrew(this,el);
        else if(action==='map-location')showPlacementOnScene({sceneId:el.dataset.sceneId,
          x:Number(el.dataset.x),y:Number(el.dataset.y)});
        else if(action==='zoom-in'){this._techZoom=Math.min(1.5,Math.round((this._techZoom+0.1)*10)/10);applyView();}
        else if(action==='zoom-out'){this._techZoom=Math.max(0.7,Math.round((this._techZoom-0.1)*10)/10);applyView();}
        else if(action==='zoom-reset'){this._techZoom=1;applyView();}
      } finally {el.disabled=false;}
    },eventOptions);
  }
  async _onClose(options){this._genesisEvents?.abort();this._techResizeObserver?.disconnect();await super._onClose(options);}
}
export class GenesisItemSheet extends HandlebarsApplicationMixin(ItemSheetV2){
  static DEFAULT_OPTIONS={classes:['genesis','item-sheet'],tag:'form',position:{width:500,height:570},
    window:{resizable:true},form:{submitOnChange:false,closeOnSubmit:false},actions:{editImage:this.editImage}};
  static PARTS={body:{template:'systems/project-genesis/templates/item.hbs'}};
  async _prepareContext(options){const context=await super._prepareContext(options);
    return {...context,item:this.document,isContainer:this.document.type==='container',editable:this.document.isOwner,
      typeLabel:ITEM_TYPES[this.document.type]||this.document.type};}
  _onRender(context,options){
    super._onRender(context,options);
    this._genesisEvents?.abort();
    this._genesisEvents=new AbortController();
    this.element.addEventListener('change',event=>{
      const el=event.target.closest?.('[data-genesis-field]');
      if(!el || !this.document.isOwner)return;
      void updateNamedField(this.document,el,['quantity','unitMass','unitVolume','resourceCode','quality','description','techTier',
        'capacityMass','capacityVolume','tareMass','tareVolume']);
    },{signal:this._genesisEvents.signal});
  }
}

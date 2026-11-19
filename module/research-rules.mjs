/** Pure research rules. All requirements are fictional resource codes. */
import { TECHNOLOGIES, TECHNOLOGY_BY_ID, RESEARCH_BY_ID, FIELD_STUDIES, FIELD_STUDY_BY_ID, FIELD_PHASES, RECIPE_LIBRARY, RESOURCE_LABELS, FACILITIES } from './tech-data.mjs';
const owned = arr => Array.isArray(arr) ? arr : [];
export function stockByCode(items) {
  const counts = Object.create(null);
  for (const item of items || []) {
    if (item.type === 'container') continue;
    const code = String(item.system?.resourceCode ?? '').trim().toLowerCase();
    const count = Math.max(0, Math.trunc(Number(item.system?.quantity)||0));
    if (code && count) counts[code] = (counts[code] || 0) + count;
  }
  return counts;
}
export function effectiveUnlocked(science={}) {
  const unlocked=new Set(owned(science.unlocked));
  // Previous worlds that already researched the original four-point "survey"
  // remain playable; their substudies appear completed without paid rework.
  if(unlocked.has('survey')) for(const study of FIELD_STUDIES)unlocked.add(study.id);
  if(FIELD_STUDIES.every(study=>unlocked.has(study.id)))unlocked.add('survey');
  return unlocked;
}
export function techStatus(techId, science = {}, items = []) {
  const tech = RESEARCH_BY_ID[techId];
  if (!tech) throw new Error('Неизвестная технология.');
  const unlocked = effectiveUnlocked(science);
  if(techId==='survey') {
    const completed=FIELD_STUDIES.filter(study=>unlocked.has(study.id)).length;
    return {tech,unlocked:unlocked.has('survey'),progress:completed,required:FIELD_STUDIES.length,
      percent:completed*100/FIELD_STUDIES.length,missingParents:[],missingFacilities:[],materials:[],
      missingStudies:FIELD_STUDIES.filter(study=>!unlocked.has(study.id)).map(t=>t.id),
      prerequisitesReady:completed===FIELD_STUDIES.length,facilityReady:true,materialReady:true,
      ready:completed===FIELD_STUDIES.length,canFinish:false,isGroup:true};
  }
  const facilities = new Set(owned(science.facilities));
  const progress = owned(science.projects).find(p=>p.id===techId)?.invested || 0;
  const stock = stockByCode(items);
  const missingParents = tech.parents.filter(id => !unlocked.has(id));
  const missingFacilities = tech.facilities.filter(id => !facilities.has(id));
  const materials = Object.entries(tech.requires).map(([code,amount])=>({
    code, name: RESOURCE_LABELS[code] || code, required:amount, available: stock[code] || 0,
    ok:(stock[code] || 0) >= amount
  }));
  const ready = missingParents.length === 0 && missingFacilities.length === 0 && materials.every(m=>m.ok);
  const completed=unlocked.has(techId);
  return {
    tech, unlocked:completed, progress:completed?tech.rp:Math.min(tech.rp, Math.max(0, Math.trunc(progress))),
    required: tech.rp, percent:completed?100:Math.min(100, Math.round(100 * Math.max(0,progress) / tech.rp)),
    missingParents, missingFacilities, materials, prerequisitesReady:missingParents.length===0,
    facilityReady:missingFacilities.length===0, materialReady:materials.every(m=>m.ok),
    ready, canFinish:!completed && ready && progress >= tech.rp,
    isGroup:false
  };
}
export function planInvestment(science, techId, amount) {
  if(techId==='survey')throw new Error('Полевые наблюдения завершаются после изучения всех 10 мини-исследований.');
  const status=techStatus(techId,science);
  if (status.unlocked) throw new Error('Эта технология уже изучена.');
  if (!status.prerequisitesReady) throw new Error('Сначала изучите предыдущие технологии.');
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('Укажите целое положительное количество очков.');
  const available = Math.trunc(Number(science.points) || 0);
  if (amount > available) throw new Error('Недостаточно свободных очков исследований.');
  const remaining=status.required-status.progress;
  if (remaining <= 0) throw new Error('Проект уже полностью профинансирован. Выполните его требования.');
  if (amount > remaining) throw new Error(`Для проекта осталось вложить не более ${remaining} ОИ.`);
  const projects=owned(science.projects).filter(p=>p.id!==techId);
  projects.push({id:techId,invested:status.progress+amount});
  return {points:available-amount,projects};
}
export function planMaterialUse(techId, items) {
  const tech=RESEARCH_BY_ID[techId];
  if (!tech || techId==='survey') throw new Error('Неизвестное исследование или составная программа.');
  const stock=stockByCode(items);
  for (const [code,amount] of Object.entries(tech.requires)) {
    if ((stock[code] || 0) < amount) throw new Error(`Недостаточно ресурсов: ${RESOURCE_LABELS[code] || code}.`);
  }
  const remaining={...tech.requires};
  const changes=[];
  for (const item of items) {
    if (item.type==='container')continue;
    const code=String(item.system?.resourceCode||'').trim().toLowerCase();
    const need=remaining[code] || 0;
    if (!need)continue;
    const before=Math.max(0,Math.trunc(Number(item.system?.quantity)||0));
    const used=Math.min(before,need);
    if (!used)continue;
    changes.push({id:item.id,before,after:before-used});
    remaining[code]-=used;
  }
  return changes;
}
export function completionPatch(science, techId, userName, day) {
  const tech=RESEARCH_BY_ID[techId], projects=owned(science.projects);
  if (!tech || techId==='survey') throw new Error('Составную программу завершают её мини-исследования.');
  const wasUnlocked=effectiveUnlocked(science);
  const nextUnlocked=[...new Set([...owned(science.unlocked),techId])];
  const finishedGroup=!!tech.group && !owned(science.unlocked).includes('survey') &&
    FIELD_STUDIES.every(t=>nextUnlocked.includes(t.id));
  if(finishedGroup)nextUnlocked.push('survey');
  const nextProjects=projects.filter(p=>p.id!==techId && !(finishedGroup && p.id==='survey'));
  const discoveries=[...owned(science.discoveries),{techId,day,by:String(userName).slice(0,100)}];
  if(finishedGroup)discoveries.push({techId:'survey',day,by:String(userName).slice(0,100)});
  const patch={unlocked:nextUnlocked,projects:nextProjects,
    tier:Math.max(Number(science.tier)||0,tech.t),discoveries:discoveries.slice(-250)};
  if(finishedGroup) {
    // The old four-point project may have been partly funded prior to migration.
    // Return that amount instead of silently discarding player progress.
    const oldFunding=projects.find(p=>p.id==='survey')?.invested || 0;
    if(oldFunding)patch.points=Math.min(9999999,Number(science.points||0)+Math.min(4,Math.max(0,oldFunding)));
  }
  return patch;
}
export function unlockedRecipes(science) {
  const unlocked=effectiveUnlocked(science);
  return TECHNOLOGIES.flatMap(tech=>tech.recipes.map(id=>({
    id,name:RECIPE_LIBRARY[id],techId:tech.id,techName:tech.name,unlocked:unlocked.has(tech.id)
  })));
}
export function validateCatalog() {
  const ids = new Set(), observed=new Set();
  for (const tech of TECHNOLOGIES) {
    if (ids.has(tech.id)) throw new Error(`Duplicate technology: ${tech.id}`);
    ids.add(tech.id);
    if (!(tech.rp>0) || !Number.isInteger(tech.rp)) throw new Error(`Invalid RP: ${tech.id}`);
    for (const parent of tech.parents) if (!observed.has(parent)) throw new Error(`Cycle or invalid tech order: ${tech.id} -> ${parent}`);
    for (const f of tech.facilities) if (!(f in FACILITIES)) throw new Error(`Unknown facility: ${f}`);
    for (const id of tech.recipes) if (!(id in RECIPE_LIBRARY)) throw new Error(`Unknown recipe: ${id}`);
    observed.add(tech.id);
  }
  const subtree=new Set();
  const phases=new Set(FIELD_PHASES.map(p=>p.id));
  for(const tech of FIELD_STUDIES){
    if(ids.has(tech.id)||subtree.has(tech.id))throw Error(`Duplicate child research: ${tech.id}`);
    if(!phases.has(tech.phase)||tech.group!=='survey'||!Number.isInteger(tech.rp)||tech.rp<1)throw Error(`Invalid field study: ${tech.id}`);
    for(const parent of tech.parents)if(!subtree.has(parent))throw Error(`Invalid field study dependency: ${tech.id} -> ${parent}`);
    subtree.add(tech.id);
  }
  if(subtree.size!==10)throw Error('Field research must contain exactly ten studies.');
  return {technologies:ids.size,subresearch:subtree.size,recipes:Object.keys(RECIPE_LIBRARY).length};
}

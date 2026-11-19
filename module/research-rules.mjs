/** Pure research rules. All requirements are fictional resource codes. */
import { TECHNOLOGIES, TECHNOLOGY_BY_ID, RESEARCH_BY_ID, FIELD_STUDIES, FIELD_STUDY_BY_ID, FIELD_PHASES, RESEARCH_PROGRAMS, PROGRAM_STUDIES, RESEARCH_PROGRAM_BY_ID, RECIPE_LIBRARY, RESOURCE_LABELS, FACILITIES } from './tech-data.mjs';
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
  // A previously opened composite technology stays complete after updating.
  // Child completion never mutates historic saves until the next legitimate action.
  for(const programme of RESEARCH_PROGRAMS) {
    if(unlocked.has(programme.id))for(const study of programme.studies)unlocked.add(study.id);
    if(programme.studies.every(study=>unlocked.has(study.id)))unlocked.add(programme.id);
  }
  return unlocked;
}

export function techStatus(techId, science = {}, items = [], cached = null) {
  const tech = RESEARCH_BY_ID[techId];
  if (!tech) throw new Error('Неизвестная технология.');
  const unlocked = cached?.unlocked ?? effectiveUnlocked(science);
  const programme=RESEARCH_PROGRAM_BY_ID[techId];
  if(programme) {
    const completed=programme.studies.filter(study=>unlocked.has(study.id)).length;
    const missingParents=tech.parents.filter(id=>!unlocked.has(id));
    const stock=cached?.stock ?? stockByCode(items);
    const materials=Object.entries(tech.requires).map(([code,amount])=>({
      code,name:RESOURCE_LABELS[code]||code,required:amount,available:stock[code]||0,
      ok:(stock[code]||0)>=amount
    }));
    const availableFacilities=cached?.facilities ?? new Set(owned(science.facilities));
    const missingFacilities=tech.facilities.filter(id=>!availableFacilities.has(id));
    return {tech,unlocked:unlocked.has(techId),progress:completed,required:programme.studies.length,
      percent:Math.round(completed*100/programme.studies.length),missingParents,missingFacilities,materials,
      missingStudies:programme.studies.filter(study=>!unlocked.has(study.id)).map(t=>t.id),
      prerequisitesReady:missingParents.length===0,facilityReady:missingFacilities.length===0,
      materialReady:materials.every(m=>m.ok),ready:completed===programme.studies.length,
      canFinish:false,isGroup:true};
  }
  const facilities = cached?.facilities ?? new Set(owned(science.facilities));
  const progress = owned(science.projects).find(p=>p.id===techId)?.invested || 0;
  const stock = cached?.stock ?? stockByCode(items);
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
  if(RESEARCH_PROGRAM_BY_ID[techId])throw new Error('Составная программа завершается после изучения всех 10 мини-исследований.');
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
  if (!tech) throw new Error('Неизвестное исследование.');
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
  if (!tech || RESEARCH_PROGRAM_BY_ID[techId]) throw new Error('Составную программу завершают её мини-исследования.');
  const nextUnlocked=[...new Set([...owned(science.unlocked),techId])];
  const group=tech.group?RESEARCH_PROGRAM_BY_ID[tech.group]:null;
  const finishedGroup=group && !owned(science.unlocked).includes(group.id) &&
    group.studies.every(t=>nextUnlocked.includes(t.id));
  if(finishedGroup)nextUnlocked.push(group.id);
  const nextProjects=projects.filter(p=>p.id!==techId && !(finishedGroup && p.id===group.id));
  const discoveries=[...owned(science.discoveries),{techId,day,by:String(userName).slice(0,100)}];
  if(finishedGroup)discoveries.push({techId:group.id,day,by:String(userName).slice(0,100)});
  const patch={unlocked:nextUnlocked,projects:nextProjects,
    tier:Math.max(Number(science.tier)||0,tech.t),discoveries:discoveries.slice(-250)};
  if(finishedGroup) {
    // Refund abandoned funding for the pre-upgrade one-step research.
    const oldFunding=projects.find(p=>p.id===group.id)?.invested||0;
    if(oldFunding)patch.points=Math.min(9999999,Number(science.points||0)+Math.min(
      RESEARCH_BY_ID[group.id].rp,Math.max(0,oldFunding)));
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
  const registered=new Set();
  for(const programme of RESEARCH_PROGRAMS) {
    if(!ids.has(programme.id)||programme.studies.length!==10||programme.phases.length!==4)
      throw Error(`Invalid nested research programme: ${programme.id}`);
    const observedIds=new Set();
    const phaseIds=new Set(programme.phases.map(p=>p.id));
    for(const study of programme.studies) {
      if(registered.has(study.id)||ids.has(study.id)||study.group!==programme.id||!phaseIds.has(study.phase))
        throw Error(`Invalid nested study: ${study.id}`);
      if(!Number.isInteger(study.rp)||study.rp<1||study.rp>5)throw Error(`Invalid study cost: ${study.id}`);
      for(const parent of study.parents)if(!observedIds.has(parent)&&!ids.has(parent))
        throw Error(`Invalid prerequisite: ${study.id} -> ${parent}`);
      for(const station of study.facilities)if(!(station in FACILITIES))throw Error(`Unknown station: ${station}`);
      observedIds.add(study.id);registered.add(study.id);
    }
  }
  if(registered.size!==80)throw Error('Initial programmes must contain eighty studies.');
  return {technologies:ids.size,subresearch:subtree.size,programmeResearch:registered.size,
    programmes:RESEARCH_PROGRAMS.length,recipes:Object.keys(RECIPE_LIBRARY).length};
}

/** Pure research rules. All requirements are fictional resource codes. */
import { TECHNOLOGIES, TECHNOLOGY_BY_ID, RECIPE_LIBRARY, RESOURCE_LABELS, FACILITIES } from './tech-data.mjs';
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
export function techStatus(techId, science = {}, items = []) {
  const tech = TECHNOLOGY_BY_ID[techId];
  if (!tech) throw new Error('Неизвестная технология.');
  const unlocked = new Set(owned(science.unlocked));
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
  return {
    tech, unlocked:unlocked.has(techId), progress:Math.min(tech.rp, Math.max(0, Math.trunc(progress))),
    required: tech.rp, percent: Math.min(100, Math.round(100 * Math.max(0,progress) / tech.rp)),
    missingParents, missingFacilities, materials, prerequisitesReady:missingParents.length===0,
    facilityReady:missingFacilities.length===0, materialReady:materials.every(m=>m.ok),
    ready, canFinish:!unlocked.has(techId) && ready && progress >= tech.rp
  };
}
export function planInvestment(science, techId, amount) {
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
  const tech=TECHNOLOGY_BY_ID[techId];
  if (!tech) throw new Error('Неизвестная технология.');
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
  const tech=TECHNOLOGY_BY_ID[techId], projects=owned(science.projects);
  if (!tech) throw new Error('Неизвестная технология.');
  const nextUnlocked=[...new Set([...owned(science.unlocked),techId])];
  return {
    unlocked:nextUnlocked,
    projects:projects.filter(p=>p.id!==techId),
    tier:Math.max(Number(science.tier)||0,tech.t),
    discoveries:[...owned(science.discoveries),{techId,day,by:String(userName).slice(0,100)}].slice(-250)
  };
}
export function unlockedRecipes(science) {
  const unlocked=new Set(owned(science.unlocked));
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
  return {technologies:ids.size,recipes:Object.keys(RECIPE_LIBRARY).length};
}

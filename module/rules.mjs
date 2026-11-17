/** PROJECT GENESIS — pure calculations. No Foundry globals: safe to unit-test. */
export const ABILITIES = Object.freeze({
  strength: 'Сила', agility: 'Ловкость', endurance: 'Выносливость',
  intellect: 'Интеллект', perception: 'Восприятие', will: 'Воля'
});
export const SKILLS = Object.freeze({
  survival: 'Выживание', science: 'Наука', engineering: 'Инженерия',
  crafting: 'Ремесло', medicine: 'Медицина', exploration: 'Разведка'
});
export const ITEM_TYPES = Object.freeze({
  material: 'Материал', gear: 'Снаряжение', tool: 'Инструмент',
  component: 'Компонент', consumable: 'Расходник', container: 'Контейнер'
});
export const LIMITS = Object.freeze({foodPerDay: 1, waterPerDay: 2});
export const round = (n, digits = 2) => Number(Number(n).toFixed(digits));
export const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
export const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
export const qty = (item) => Math.max(0, Math.trunc(n(item.system?.quantity)));
export const isContainer = (item) => item.type === 'container';
export const unitMass = (item) => Math.max(0, n(item.system?.unitMass ?? item.system?.tareMass));
export const unitVolume = (item) => Math.max(0, n(item.system?.unitVolume ?? item.system?.tareVolume));
export function itemLoad(item) {
  const amount = isContainer(item) ? 1 : qty(item);
  return { mass: round(amount * unitMass(item)), volume: round(amount * unitVolume(item)) };
}
/**
 * Build an inventory index in one pass. This is shared by sheet rendering and
 * transfer validation, avoiding one full item scan per container.
 * Use unrounded sums internally; rounding every stack can hide small masses.
 */
export function summarizeInventory(items) {
  let mass = 0, volume = 0, totalItems = 0;
  const byContainer = new Map();
  const containers = new Map();
  for (const item of items) {
    if (isContainer(item)) {
      containers.set(item.id, item);
    } else {
      totalItems += qty(item);
    }
    const amount = isContainer(item) ? 1 : qty(item);
    const itemMass = amount * unitMass(item);
    const itemVolume = amount * unitVolume(item);
    mass += itemMass;
    volume += itemVolume;
    const id = item.system?.containerId || '';
    const used = byContainer.get(id) || {mass:0, volume:0};
    used.mass += itemMass;
    used.volume += itemVolume;
    byContainer.set(id, used);
  }
  return {load:{mass:round(mass), volume:round(volume)},
    exactLoad:{mass,volume}, byContainer, containers, totalItems};
}
export function measure(items, containerId = null) {
  const summary = summarizeInventory(items);
  const used = containerId === null ? summary.exactLoad :
    (summary.byContainer.get(containerId) || {mass:0, volume:0});
  return {mass:round(used.mass),volume:round(used.volume)};
}
export function capacity(actor) {
  if (actor.type === 'colony') {
    const stores=(actor.system?.industry?.buildings||[]).filter(b=>b.id==='storehouse')
      .reduce((sum,b)=>sum+Math.max(0,Math.trunc(n(b.count))),0);
    return {mass:Math.max(0,n(actor.system?.capacity?.mass))+stores*750,
      volume:Math.max(0,n(actor.system?.capacity?.volume))+stores*1500};
  }
  const strength = clamp(Math.trunc(n(actor.system?.abilities?.strength ?? 2)), 1, 10);
  const cart=[...(actor.items||[])].some(i=>i.type==='tool'&&i.system?.resourceCode==='handcart'&&Number(i.system?.quantity)>0);
  return { mass: 12 + 4 * strength + (cart?50:0), volume: 15 + 5 * strength + (cart?100:0) };
}
export function containerCapacity(item) {
  return { mass: Math.max(0, n(item.system?.capacityMass)), volume: Math.max(0, n(item.system?.capacityVolume)) };
}
export function fits(load, limit) {
  return load.mass <= limit.mass + 1e-8 && load.volume <= limit.volume + 1e-8;
}
export function plus(a, b) { return {mass: a.mass + b.mass, volume: a.volume + b.volume}; }
export function minus(a, b) { return {mass: round(a.mass - b.mass), volume: round(a.volume - b.volume)}; }
export function perQuantity(item, quantity) {
  return {mass: unitMass(item) * quantity, volume: unitVolume(item) * quantity};
}
export function stackSignature(item, containerId = '') {
  return JSON.stringify([
    item.type, String(item.name).trim().toLocaleLowerCase(),
    String(item.system?.resourceCode ?? '').trim().toLocaleLowerCase(),
    unitMass(item), unitVolume(item),
    Math.trunc(n(item.system?.quality)), Math.trunc(n(item.system?.techTier)),
    String(item.system?.description ?? ''), String(item.img ?? ''), containerId
  ]);
}
export function validateMove({ source, target, item, quantity, containerId = '' }) {
  if (!source || !target || !item) throw new Error('Не найдены источник, получатель или предмет.');
  if (item.type === 'container') throw new Error('Перемещение контейнеров с содержимым появится в следующих версиях.');
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('Количество должно быть целым положительным числом.');
  if (qty(item) < quantity) throw new Error('Недостаточно предметов у отправителя.');
  // Container existence is checked using the index below.
  const sameActor = source.id === target.id;
  const oldContainer = item.system?.containerId || '';
  if (sameActor && oldContainer === containerId) throw new Error('Предмет уже находится в этом месте.');
  const requested = perQuantity(item, quantity);
  const summary = summarizeInventory(target.items);
  if (containerId && !summary.containers.has(containerId)) {
    throw new Error('Выбранный контейнер не найден у получателя.');
  }
  if (!sameActor) {
    const after = plus(summary.exactLoad, requested);
    if (!fits(after, capacity(target))) throw new Error('Не хватает места или допустимой массы у получателя.');
  }
  if (containerId) {
    const container = summary.containers.get(containerId);
    const used = summary.byContainer.get(containerId) || {mass:0, volume:0};
    if (!fits(plus(used, requested), containerCapacity(container))) {
      throw new Error(`Контейнер «${container.name}» переполнен.`);
    }
  }
  return {sameActor, oldContainer, requested};
}
export function checkResult(die1, die2, ability, skill, difficulty) {
  const total = die1 + die2 + n(ability) + n(skill);
  return {total, success: total >= difficulty, margin: total - difficulty};
}
export function dayVitals(vitals, hasFood, hasWater) {
  return {
    hunger: clamp(n(vitals.hunger) + (hasFood ? -10 : 20), 0, 100),
    thirst: clamp(n(vitals.thirst) + (hasWater ? -15 : 30), 0, 100),
    fatigue: clamp(n(vitals.fatigue) + 5, 0, 100),
    health: clamp(n(vitals.health), 0, 100),
    oxygen: clamp(n(vitals.oxygen), 0, 100)
  };
}

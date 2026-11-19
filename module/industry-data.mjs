/** PROJECT GENESIS 0.5 — gameplay abstractions, not real industrial instructions. */
import { RECIPE_LIBRARY, TECHNOLOGY_BY_ID, FACILITIES, RESOURCE_LABELS } from './tech-data.mjs';
const recipe = (id, inputs, output, station=null, days=1, description='') => Object.freeze({
  id, name:RECIPE_LIBRARY[id], techId:Object.values(TECHNOLOGY_BY_ID).find(t=>t.recipes.includes(id))?.id,
  inputs, output:{code:id.replaceAll('-','_'),type:'component',unitMass:1,unitVolume:1,quantity:1,...output},
  station, days, description
});
export const RECIPES = Object.freeze([
  recipe('field-notes',{fiber:1},{type:'gear',unitMass:.1,unitVolume:.2},null,1,'Архив экспедиционных наблюдений.'),
  recipe('shelter-kit',{wood:3,fiber:2},{type:'gear',unitMass:5,unitVolume:10},null,1,'Сборный походный комплект.'),
  recipe('stone-kit',{stone:3,fiber:1},{type:'tool',unitMass:2,unitVolume:3},null,1,'Инструменты начального этапа.'),
  recipe('water-tester',{stone:1,fiber:1,sample:1},{type:'tool',unitMass:.6,unitVolume:1},null,1,'Абстрактный набор для исследования биома.'),
  recipe('field-collection',{wood:1,fiber:2},{type:'tool',unitMass:1,unitVolume:2},null,1,'Принадлежности для полевых наблюдений.'),
  recipe('workshop-tools',{wood:2,scrap:2},{type:'tool',unitMass:3,unitVolume:4},'bench',1,'Базовый инструментальный комплект.'),
  recipe('growth-module',{wood:2,fiber:2,organic:2},{unitMass:7,unitVolume:12},'fieldLab',2,'Экспериментальный аграрный модуль.'),
  recipe('geology-kit',{stone:2,scrap:1},{type:'tool',unitMass:2,unitVolume:3},'bench',1,'Набор для классификации пород.'),
  recipe('med-module',{fiber:3,organic:2},{type:'gear',unitMass:2,unitVolume:3},'fieldLab',2,'Обобщённый комплект полевой медицины.'),
  recipe('mechanism',{scrap:3},{unitMass:3,unitVolume:4},'bench',1,'Механический узел для последующей сборки.'),
  recipe('handcart',{wood:3,scrap:2},{code:'handcart',type:'tool',unitMass:8,unitVolume:20},'bench',2,'Увеличивает предел переносимого груза и ускоряет наземные доставки.'),
  recipe('alloy-parts',{ore:4,scrap:1},{code:'alloy',type:'material',quantity:2,unitMass:2,unitVolume:1},'furnace',2,'Игра использует условные материалы без технологий реальной плавки.'),
  recipe('glass-panels',{clay:3,stone:2},{code:'glass',type:'material',quantity:2,unitMass:1,unitVolume:.8},'furnace',2,'Игровая абстракция производства стеклокерамики.'),
  recipe('lab-instrument',{glass:2,alloy:1},{type:'tool',unitMass:2,unitVolume:2},'bioLab',2),
  recipe('basic-generator',{copper:3,alloy:2},{unitMass:10,unitVolume:12},'powerLab',3),
  recipe('optical-device',{glass:2,crystal:1},{type:'tool',unitMass:1,unitVolume:2},'fieldLab',2),
  recipe('flow-controller',{alloy:2,glass:1},{unitMass:4,unitVolume:5},'bench',2),
  recipe('precision-parts',{alloy:3,glass:1},{unitMass:2,unitVolume:2},'furnace',3),
  recipe('power-unit',{copper:2,crystal:1,alloy:1},{unitMass:6,unitVolume:7},'powerLab',3),
  recipe('control-board',{silicon:2,copper:2},{code:'circuit',quantity:2,unitMass:.5,unitVolume:.5},'electronicsLab',3),
  recipe('telemetry-panel',{circuit:2,glass:1},{unitMass:3,unitVolume:4},'electronicsLab',3),
  recipe('habitat-module',{alloy:3,glass:2,organic:2},{unitMass:15,unitVolume:24},'bioLab',4),
  recipe('hull-sections',{alloy:5,silicon:2},{quantity:2,unitMass:20,unitVolume:28},'furnace',4),
  recipe('navigation-core',{circuit:3,crystal:1},{unitMass:4,unitVolume:5},'electronicsLab',4),
  recipe('propulsion-assembly',{alloy:5,circuit:3,crystal:1},{unitMass:18,unitVolume:24},'flightLab',5,'Абстрактный сюжетный компонент, без реальных схем двигателя.'),
  recipe('orbital-core',{circuit:4,alloy:3,glass:2},{unitMass:14,unitVolume:18},'flightLab',5),
  recipe('return-blueprint',{fiber:2,circuit:2},{type:'gear',unitMass:1,unitVolume:2},'flightLab',2,'Техническая документация экспедиции без реальных инструкций.')
]);
export const RECIPE_BY_ID = Object.freeze(Object.fromEntries(RECIPES.map(x=>[x.id,x])));
const build = (id,name,techId,inputs,days=2,facility=null,options={}) => Object.freeze({
  id,name,techId,inputs,days,facility,max:1,capacityMass:0,capacityVolume:0,harvest:null,description:'',...options
});
export const BUILDINGS = Object.freeze([
  build('bench','Верстак','stone-tools',{wood:3,stone:2},1,'bench',{description:'Простой рабочий пост для базовых рецептов.'}),
  build('fieldLab','Полевая лаборатория','water-analysis',{wood:2,scrap:1,sample:2},2,'fieldLab'),
  build('furnace','Промышленная мастерская','geology',{stone:5,clay:3,scrap:2},3,'furnace'),
  build('bioLab','Биолаборатория','medicine',{glass:2,scrap:3,organic:2},3,'bioLab'),
  build('powerLab','Энергетическая станция','mechanics',{copper:3,scrap:3},3,'powerLab'),
  build('electronicsLab','Лаборатория электроники','optics',{silicon:2,copper:2,glass:2},4,'electronicsLab'),
  build('flightLab','Испытательный комплекс','industrial-fabrication',{alloy:5,glass:3,circuit:2},5,'flightLab'),
  build('local-store','Локальный склад','basic-workshop',{wood:4,stone:3,scrap:2},2,null,{max:12,capacityMass:750,capacityVolume:1500,description:'Отдельное хранилище на карте. Не объединяется с общим складом; станки на этой карте могут использовать его запасы.'}),
  build('storehouse','Складской модуль','basic-workshop',{wood:5,stone:3,scrap:2},2,null,{max:8,capacityMass:750,capacityVolume:1500,description:'Каждый модуль увеличивает общую вместимость колонии.'}),
  build('garden','Тепличный модуль','agriculture',{wood:3,organic:3,fiber:3},3,null,{harvest:{code:'food',name:'Пищевой паёк',type:'consumable',quantity:3,unitMass:.4,unitVolume:.5},description:'Даёт 3 абстрактных пищевых пайка раз в игровые сутки.'}),
  build('water-recycler','Станция воды','fluid-systems',{alloy:2,glass:2,scrap:2},3,null,{harvest:{code:'water',name:'Запас воды',type:'consumable',quantity:5,unitMass:.5,unitVolume:.5},description:'Даёт 5 игровых единиц воды раз в сутки.'}),
  build('shelter','Жилой модуль','shelter',{wood:4,fiber:4,stone:2},2,null,{description:'Отмечает развитие жилой инфраструктуры.'}),
  build('room','Помещение-мастерская','basic-workshop',{wood:6,stone:5,scrap:3},3,null,{max:8,description:'Отдельная внутренняя сцена с возможностью разместить станки и подключить наружное электропитание.'}),
  build('assembly-dock','Сборочный док','orbital-systems',{hull_sections:2,precision_parts:2,alloy:4},6,null,{description:'Основа четырёхэтапной программы сборки корабля экспедиции.'})
]);
export const BUILDING_BY_ID=Object.freeze(Object.fromEntries(BUILDINGS.map(x=>[x.id,x])));
export function resourceName(code){return RESOURCE_LABELS[code] || RECIPES.find(r=>r.output.code===code)?.name || code;}
export function validateIndustryCatalog(){
  const ids=new Set();
  for(const r of RECIPES){
    if(ids.has(r.id)||!r.name||!TECHNOLOGY_BY_ID[r.techId])throw Error(`Неправильный рецепт ${r.id}`);
    if(r.station&&!FACILITIES[r.station])throw Error(`Неизвестный станок ${r.station}`);
    if(!Number.isSafeInteger(r.days)||r.days<1||r.days>30)throw Error(`Неверное время ${r.id}`);
    if(!Object.values(r.inputs).every(n=>Number.isSafeInteger(n)&&n>0))throw Error(`Неверные ресурсы ${r.id}`);
    ids.add(r.id);
  }
  for(const b of BUILDINGS){
    if(ids.has(b.id)&&!FACILITIES[b.id])throw Error(`Повторяющийся код ${b.id}`);
    if(!TECHNOLOGY_BY_ID[b.techId]||!Number.isSafeInteger(b.max)||b.max<1)throw Error(`Неизвестное здание ${b.id}`);
    if(!Object.values(b.inputs).every(n=>Number.isSafeInteger(n)&&n>0))throw Error(`Неверные стройматериалы ${b.id}`);
  }
  return {recipes:RECIPES.length,buildings:BUILDINGS.length};
}

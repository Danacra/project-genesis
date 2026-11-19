/** PROJECT GENESIS 0.5 — gameplay abstractions, not real industrial instructions. */
import { RECIPE_LIBRARY, TECHNOLOGY_BY_ID, FACILITIES, RESOURCE_LABELS } from './tech-data.mjs';
const recipe = (id, inputs, output, station=null, days=1, description='',minTier=1) => Object.freeze({
  id, name:RECIPE_LIBRARY[id], techId:Object.values(TECHNOLOGY_BY_ID).find(t=>t.recipes.includes(id))?.id,
  inputs, output:{code:id.replaceAll('-','_'),type:'component',unitMass:1,unitVolume:1,quantity:1,...output},
  station, days, description,minTier
});
export const RECIPES = Object.freeze([
  recipe('field-notes',{fiber:1},{type:'gear',unitMass:.1,unitVolume:.2},null,1,'Архив экспедиционных наблюдений.'),
  recipe('shelter-kit',{wood:3,fiber:2},{type:'gear',unitMass:5,unitVolume:10},null,1,'Сборный походный комплект.'),
  recipe('stone-kit',{stone:3,fiber:1},{type:'tool',unitMass:2,unitVolume:3},null,1,'Инструменты начального этапа.'),
  recipe('water-tester',{stone:1,fiber:1,sample:1},{type:'tool',unitMass:.6,unitVolume:1},null,1,'Абстрактный набор для исследования биома.'),
  recipe('field-collection',{wood:1,fiber:2},{type:'tool',unitMass:1,unitVolume:2},null,1,'Принадлежности для полевых наблюдений.'),
  recipe('sawn-planks',{wood:2},{code:'plank',type:'material',quantity:3,unitMass:.9,unitVolume:1.1},'bench',1,'Игровое изготовление досок из древесины.'),
  recipe('cut-stone',{stone:2},{code:'cut_stone',type:'material',quantity:2,unitMass:1.6,unitVolume:1.1},'bench',1,'Отбор и обработка камня.'),
  recipe('woven-cloth',{fiber:3},{code:'cloth',type:'material',quantity:2,unitMass:.3,unitVolume:.6},'bench',1,'Ткань из растительных волокон.'),
  recipe('fired-brick',{clay:3},{code:'brick',type:'material',quantity:3,unitMass:1.2,unitVolume:.7},'furnace',1,'Обжиг условной глиняной массы.'),
  recipe('metal-ingot',{ore:3},{code:'ingot',type:'material',quantity:2,unitMass:1.8,unitVolume:.7},'furnace',2,'Переплавка рудного сырья в игровые слитки.'),
  recipe('copper-smelt',{copper:2},{code:'copper_ingot',type:'material',quantity:2,unitMass:1.4,unitVolume:.65},'furnace',2,'Переработка медной руды.'),
  recipe('iron-smelt',{iron_ore:3},{code:'iron_ingot',type:'material',quantity:2,unitMass:1.8,unitVolume:.7},'furnace',2,'Переплавка железной руды в базовые слитки.'),
  recipe('tin-smelt',{tin_ore:2},{code:'tin_ingot',type:'material',quantity:2,unitMass:1.2,unitVolume:.6},'furnace',2,'Переработка оловянной руды.'),
  recipe('aluminum-smelt',{aluminum_ore:3},{code:'aluminum_ingot',type:'material',quantity:2,unitMass:1.1,unitVolume:.8},'furnace',2,'Переработка алюминиевой руды в лёгкий металл.'),
  recipe('titanium-smelt',{titanium_ore:3},{code:'titanium_ingot',type:'material',quantity:1,unitMass:1.7,unitVolume:.6},'furnace',3,'Трудоёмкая выплавка титанового слитка.'),
  recipe('bronze-alloy',{copper_ingot:2,tin_ingot:1},{code:'bronze_ingot',type:'material',quantity:2,unitMass:1.6,unitVolume:.7},'furnace',2,'Базовый сплав для усиленных компонентов.',2),
  recipe('steel-alloy',{iron_ingot:2,ingot:1},{code:'steel_ingot',type:'material',quantity:2,unitMass:2.1,unitVolume:.8},'furnace',3,'Прочный сплав для тяжёлых деталей.',2),
  recipe('reinforced-alloy',{ingot:3,copper_ingot:1},{code:'reinforced_ingot',type:'material',quantity:2,unitMass:2.4,unitVolume:1},'furnace',3,'Улучшенный материал для поздней базы.',2),
  recipe('precision-joinery',{plank:2,cloth:1},{code:'joinery_kit',type:'component',quantity:1,unitMass:1.2,unitVolume:1.4},'bench',1,'Сборочные соединения для последующего улучшения мастерской.',2),
  recipe('calibrated-toolkit',{ingot:2,joinery_kit:1},{code:'calibrated_toolkit',type:'tool',quantity:1,unitMass:1.6,unitVolume:2},'bench',1,'Инструмент повышенного уровня для сложных заготовок.',3),
  recipe('survey-instrument',{glass:1,plank:2},{code:'survey_instrument',type:'tool',quantity:1,unitMass:1,unitVolume:1.5},'fieldLab',2,'Уточнённые полевые измерения.',2),
  recipe('medical-supplies',{cloth:2,organic:2},{code:'med_supplies',type:'consumable',quantity:2,unitMass:.3,unitVolume:.4},'bioLab',2,'Лабораторные медицинские материалы.',2),
  recipe('copper-wire',{copper_ingot:1},{code:'wire_bundle',type:'component',quantity:2,unitMass:.3,unitVolume:.3},'bench',1,'Подготовка базовой проводки для электрических систем.',2),
  recipe('voltage-module',{copper_ingot:2,circuit:1},{code:'voltage_module',type:'component',quantity:1,unitMass:2,unitVolume:1.5},'powerLab',2,'Регулятор распределения энергии.',2),
  recipe('control-terminal',{circuit:2,reinforced_ingot:1},{code:'control_terminal',type:'component',quantity:1,unitMass:2.3,unitVolume:1.8},'electronicsLab',3,'Модуль высокоуровневого управления.',2),
  recipe('flight-calibrator',{alloy:2,crystal:1},{code:'flight_calibrator',type:'component',quantity:1,unitMass:3,unitVolume:3},'flightLab',3,'Испытательное оборудование поздней экспедиции.',2),
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
  recipe('iron-fittings',{iron_ingot:2,plank:1},{code:'iron_fittings',type:'component',quantity:2,unitMass:1.1,unitVolume:.6},'bench',2,'Крепёж и усилители для зданий и станков.',3),
  recipe('steel-plate',{steel_ingot:2},{code:'steel_plate',type:'material',quantity:2,unitMass:1.9,unitVolume:.8},'furnace',2,'Стальные пластины для промышленной сборки.',3),
  recipe('titanium-frame',{titanium_ingot:1,steel_plate:1},{code:'titanium_frame',type:'component',quantity:1,unitMass:1.4,unitVolume:1.1},'flightLab',3,'Лёгкая и прочная силовая рама.',3),
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
  build('fieldLab','Полевая лаборатория','water-analysis',{wood:2,scrap:1,sample:2},2,'fieldLab',{description:'Полевые исследования и изготовление научных комплектов; ручной режим возможен без питания.'}),
  build('furnace','Плавильная мастерская','geology',{stone:5,clay:3,scrap:2},3,'furnace',{description:'Выплавляет игровые металлические слитки из руды, обжигает кирпич, выпускает сплавы, стеклокерамику и детали по изученным рецептам.'}),
  build('bioLab','Биолаборатория','medicine',{glass:2,scrap:3,organic:2},3,'bioLab',{description:'Лаборатория биологических исследований и специальных материалов, поддерживает соответствующий крафт.'}),
  build('powerLab','Энергетическая станция','mechanics',{copper:3,scrap:3},3,'powerLab',{description:'Источник 18 условных единиц мощности для электросети базы; подключение выполняется кабелями.'}),
  build('electronicsLab','Лаборатория электроники','optics',{silicon:2,copper:2,glass:2},4,'electronicsLab',{description:'Создаёт электронные компоненты, панели управления и навигационные детали. Требует электричества.'}),
  build('flightLab','Испытательный комплекс','industrial-fabrication',{alloy:5,glass:3,circuit:2},5,'flightLab',{description:'Станция космических технологий и позднего производства. Требует электропитания и инженерных сетей.'}),
  build('local-store','Локальный склад','basic-workshop',{wood:4,stone:3,scrap:2},2,null,{max:12,capacityMass:750,capacityVolume:1500,description:'Отдельное хранилище на карте. Не объединяется с общим складом; станки на этой карте могут использовать его запасы.'}),
  build('storehouse','Складской модуль','basic-workshop',{wood:5,stone:3,scrap:2},2,null,{max:8,capacityMass:750,capacityVolume:1500,description:'Каждый модуль увеличивает общую вместимость колонии.'}),
  build('garden','Тепличный модуль','agriculture',{wood:3,organic:3,fiber:3},3,null,{harvest:{code:'food',name:'Пищевой паёк',type:'consumable',quantity:3,unitMass:.4,unitVolume:.5},description:'Даёт 3 абстрактных пищевых пайка раз в игровые сутки.'}),
  build('water-recycler','Станция воды','fluid-systems',{alloy:2,glass:2,scrap:2},3,null,{harvest:{code:'water',name:'Запас воды',type:'consumable',quantity:5,unitMass:.5,unitVolume:.5},description:'Даёт 5 игровых единиц воды раз в сутки.'}),
  build('shelter','Жилой модуль','shelter',{wood:4,fiber:4,stone:2},2,null,{description:'Жилое помещение с внутренней сценой; ускоряет восстановление усталости и поддерживает штатное освещение при питании.'}),
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

/** v0.4 fixed, fictional research catalog. Costs are gameplay abstractions, not real fabrication guidance. */
export const BRANCHES = Object.freeze({
  survival:'Выживание', materials:'Материаловедение', bio:'Биология',
  energy:'Энергетика', computing:'Вычисления', space:'Космонавтика'
});
export const FACILITIES = Object.freeze({
  bench:'Верстак', fieldLab:'Полевая лаборатория', furnace:'Промышленная мастерская',
  bioLab:'Биолаборатория', powerLab:'Энергетическая станция',
  electronicsLab:'Лаборатория электроники', flightLab:'Испытательный комплекс'
});
export const RESOURCE_LABELS = Object.freeze({
  wood:'Древесина', stone:'Камень', fiber:'Волокно', sample:'Образцы',
  scrap:'Металлолом', ore:'Руда', clay:'Глина', organic:'Биомасса',
  copper:'Медь', alloy:'Сплавы', glass:'Стекло', silicon:'Кремний',
  circuit:'Электронные компоненты', crystal:'Кристаллы'
});
// t=technological era 0-4; rp=research points; requires=materials consumed on discovery.
const make = (id,name,branch,t,rp,parents=[],facilities=[],requires={},description='',recipes=[]) =>
  ({id,name,branch,t,rp,parents,facilities,requires,description,recipes});
export const TECHNOLOGIES = Object.freeze([
  make('survey','Полевые наблюдения','survival',0,4,[],[],{},'Картографирование местности и запись наблюдений.',['field-notes']),
  make('shelter','Укрытия и лагерь','survival',0,5,['survey'],[],{wood:2,fiber:2},'Базовая организация безопасного лагеря.',['shelter-kit']),
  make('stone-tools','Каменные инструменты','materials',0,5,['survey'],[],{stone:3},'Обработка найденных природных материалов.',['stone-kit']),
  make('water-analysis','Анализ воды','bio',0,6,['survey'],[],{sample:2},'Сравнение образцов и учёт рисков биома.',['water-tester']),
  make('ecosystems','Местные экосистемы','bio',0,7,['water-analysis'],[],{organic:2,sample:1},'Экспедиционные записи о живых системах.',['field-collection']),
  make('basic-workshop','Мастерская','materials',1,8,['stone-tools','shelter'],['bench'],{wood:2,scrap:2},'Точность и повторяемость простых операций.',['workshop-tools']),
  make('agriculture','Экспериментальная агрономия','bio',1,10,['ecosystems','shelter'],['fieldLab'],{organic:3},'Устойчивые замкнутые циклы продовольствия.',['growth-module']),
  make('geology','Разведка полезных пород','materials',1,8,['stone-tools'],[],{ore:3,sample:2},'Классификация пород и оценка месторождений.',['geology-kit']),
  make('medicine','Полевое здравоохранение','bio',1,9,['water-analysis','shelter'],['fieldLab'],{fiber:2,organic:1},'Учёт состояния экспедиции и биологической среды.',['med-module']),
  make('mechanics','Механические передачи','energy',1,9,['basic-workshop'],['bench'],{scrap:3},'Моделирование движения и полезной работы.',['mechanism','handcart']),
  make('material-science','Исследование сплавов','materials',2,12,['geology','basic-workshop'],['furnace'],{ore:4,scrap:2},'Сравнение свойств промышленных материалов.',['alloy-parts']),
  make('laboratories','Лабораторные стандарты','bio',2,12,['medicine','agriculture'],['bioLab'],{glass:2,alloy:1},'Контроль воспроизводимости исследований.',['lab-instrument']),
  make('electromagnetism','Основы электричества','energy',2,13,['mechanics','material-science'],['powerLab'],{copper:3,alloy:2},'Теория и моделирование электросистем.',['basic-generator']),
  make('optics','Оптика и измерения','computing',2,11,['basic-workshop','water-analysis'],['fieldLab'],{glass:3,crystal:1},'Повышение точности наблюдений и измерений.',['optical-device']),
  make('fluid-systems','Гидро- и пневмосистемы','energy',2,12,['mechanics','water-analysis'],['bench'],{alloy:2,glass:1},'Управление потоками в закрытых системах.',['flow-controller']),
  make('industrial-fabrication','Точное производство','materials',3,17,['material-science','optics'],['furnace'],{alloy:4,glass:2},'Калиброванное изготовление сложных деталей.',['precision-parts']),
  make('power-storage','Накопление энергии','energy',3,17,['electromagnetism'],['powerLab'],{copper:3,crystal:2},'Системный подход к хранению энергии.',['power-unit']),
  make('automation','Логика управления','computing',3,18,['optics','electromagnetism'],['electronicsLab'],{silicon:3,copper:2},'Контроль процессов и моделирование автоматики.',['control-board']),
  make('telemetry','Связь и телеметрия','computing',3,16,['automation'],['electronicsLab'],{circuit:2,glass:2},'Передача данных и проверка датчиков.',['telemetry-panel']),
  make('habitat','Замкнутое жизнеобеспечение','bio',3,19,['laboratories','fluid-systems','power-storage'],['bioLab'],{alloy:3,organic:3,glass:2},'Проектирование автономной среды обитания.',['habitat-module']),
  make('advanced-materials','Высокоточные композиты','materials',4,24,['industrial-fabrication','laboratories'],['furnace'],{alloy:5,silicon:3},'Расчёт устойчивости конструкции будущего аппарата.',['hull-sections']),
  make('navigation','Навигационные вычисления','computing',4,23,['telemetry','optics'],['electronicsLab'],{circuit:4,crystal:2},'Математические модели ориентации и маршрутов.',['navigation-core']),
  make('propulsion','Теория космической тяги','space',4,28,['advanced-materials','power-storage','fluid-systems'],['flightLab'],{alloy:6,circuit:3},'Сюжетное проектирование двигателя без технических инструкций.',['propulsion-assembly']),
  make('orbital-systems','Орбитальные системы','space',4,28,['navigation','habitat','propulsion'],['flightLab'],{circuit:5,alloy:5,glass:3},'Сводная архитектура будущего корабля.',['orbital-core']),
  make('return-project','Проект «Возвращение»','space',4,35,['orbital-systems','advanced-materials'],['flightLab'],{alloy:8,circuit:6,crystal:4},'Финальная научная программа. Сборка корабля остаётся будущей механикой.',['return-blueprint'])
]);
export const TECHNOLOGY_BY_ID = Object.freeze(Object.fromEntries(TECHNOLOGIES.map(t=>[t.id,t])));
export const RECIPE_LIBRARY = Object.freeze({
  'field-notes':'Полевой архив', 'shelter-kit':'Модуль укрытия', 'stone-kit':'Набор ручных инструментов',
  'water-tester':'Комплект анализа воды', 'field-collection':'Сборник образцов',
  'workshop-tools':'Оборудование мастерской', 'growth-module':'Исследовательская грядка',
  'geology-kit':'Геологический комплект', 'med-module':'Медицинский модуль',
  'mechanism':'Механический узел', 'handcart':'Ручная грузовая тележка', 'alloy-parts':'Комплект деталей из сплавов',
  'lab-instrument':'Лабораторный прибор', 'basic-generator':'Энергетическая установка',
  'optical-device':'Оптический измеритель', 'flow-controller':'Регулятор потока',
  'precision-parts':'Прецизионные детали', 'power-unit':'Накопитель энергии',
  'control-board':'Контроллер процессов', 'telemetry-panel':'Панель телеметрии',
  'habitat-module':'Модуль среды обитания', 'hull-sections':'Секции корпуса',
  'navigation-core':'Навигационный вычислитель', 'propulsion-assembly':'Двигательный модуль',
  'orbital-core':'Орбитальный комплекс', 'return-blueprint':'Проект космического корабля'
});

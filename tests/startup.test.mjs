import test from 'node:test';
import assert from 'node:assert/strict';
const hooks={};
class Field {constructor(options,metadata){this.options=options;this.metadata=metadata;}}
class TypeDataModel {}
class BaseSheet {static editImage() {}}
globalThis.foundry={data:{fields:{NumberField:Field,StringField:Field,SchemaField:Field,ArrayField:Field}},
  abstract:{TypeDataModel},
  applications:{api:{HandlebarsApplicationMixin:Base=>Base,DialogV2:class {}},
    sheets:{ActorSheetV2:BaseSheet,ItemSheetV2:BaseSheet},
    apps:{DocumentSheetConfig:{registerSheet(_kind,_id,_sheet){}}}}};
globalThis.Actor=class {};
globalThis.Item=class {};
globalThis.Hooks={once(event,callback){hooks[event]=callback;}};
globalThis.CONFIG={Actor:{dataModels:{}},Item:{dataModels:{}}};
const registered=[];
const listeners=[];
globalThis.game={settings:{register(id,key){registered.push([id,key])}},
  socket:{on(channel,callback){listeners.push(channel)}},
  users:[],projectGenesis:null};
await import('../genesis.mjs');
test('system registers all type models and the existing game settings',()=>{
  hooks.init();
  assert.deepEqual(Object.keys(CONFIG.Actor.dataModels),['survivor','npc','colony']);
  assert.deepEqual(Object.keys(CONFIG.Item.dataModels),['material','gear','tool','component','consumable','container']);
  assert.deepEqual(registered,[['project-genesis','worldDay'],['project-genesis','logisticsJournal'],['project-genesis','dayOperation']]);
});
test('colony includes research fields but retains legacy science points/tier',()=>{
  const schema=CONFIG.Actor.dataModels.colony.defineSchema();
  const science=schema.science.options;
  assert.ok(science.points && science.tier && science.unlocked && science.projects && science.dailyWork && science.discoveries);
  assert.ok(schema.industry.options.jobs && schema.industry.options.construction && schema.industry.options.buildings);
  assert.ok(schema.infrastructure.options.links && schema.infrastructure.options.processed);
  assert.ok(schema.crew.options.nodes && schema.crew.options.caches && schema.crew.options.jobs);
});
test('ready registers five world socket handlers and exposes crew api',()=>{
  hooks.ready();
  assert.equal(listeners.length,5);
  assert.equal(game.projectGenesis.recipes.length,26);
  assert.equal(typeof game.projectGenesis.requestCrew,'function');
  assert.equal(game.projectGenesis.buildings.length,12);
  assert.equal(typeof game.projectGenesis.requestIndustry,'function');
  assert.equal(game.projectGenesis.technologies.length,25);
  assert.equal(typeof game.projectGenesis.requestResearch,'function');
  assert.equal(typeof game.projectGenesis.advanceDay,'function');
  assert.equal(typeof game.projectGenesis.requestNetwork,'function');
});

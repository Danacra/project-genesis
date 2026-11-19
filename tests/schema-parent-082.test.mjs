import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal Foundry v13 DataField parent-ownership reproduction.
// The system's schema must not assign a DataField instance to two parents.
class DataField {
  constructor(options = {}) {
    this.options = options;
    this.parent = null;
  }
}
class NumberField extends DataField {}
class BooleanField extends DataField {}
class StringField extends DataField {}
class SchemaField extends DataField {
  constructor(fields, options = {}) {
    super(options);
    this.fields = fields;
  }
}
class ArrayField extends DataField {
  constructor(element, options = {}) {
    super(options);
    this.element = element;
  }
}
class TypeDataModel {}
globalThis.foundry = {
  data: {fields: {NumberField, StringField, SchemaField, ArrayField, BooleanField}},
  abstract: {TypeDataModel}
};
const models = await import('../module/models.mjs');
function walk(field, parent, path, seen) {
  assert.ok(field instanceof DataField, `Expected DataField at ${path}`);
  assert.equal(seen.has(field), false, `Field reused at ${path} (also at ${seen.get(field)})`);
  seen.set(field, path);
  assert.equal(field.parent, null, `Already assigned a parent: ${path}`);
  field.parent = parent;
  if (field instanceof SchemaField) {
    for (const [key, child] of Object.entries(field.fields)) walk(child, field, `${path}.${key}`, seen);
  }
  if (field instanceof ArrayField) walk(field.element, field, `${path}[]`, seen);
}

test('0.8.2: each DataField has exactly one parent in every registered Actor/Item model', () => {
  const names = ['SurvivorData','NPCData','ColonyData','MaterialData','GearData',
    'ToolData','ComponentData','ConsumableData','ContainerData'];
  for (const name of names) {
    const fields = models[name].defineSchema();
    const seen = new Map();
    const root = new SchemaField(fields);
    walk(root, null, name, seen);
    assert.ok(seen.size > 3, `${name} schema must not be empty`);
  }
});

test('0.8.2: industry jobs and construction use independent nested reservations', () => {
  const fields = models.ColonyData.defineSchema();
  const industry = fields.industry.fields;
  const manufacture = industry.jobs.element;
  const construction = industry.construction.element;
  assert.notStrictEqual(manufacture, construction);
  assert.notStrictEqual(manufacture.fields.reserved, construction.fields.reserved);
  assert.notStrictEqual(manufacture.fields.reserved.element, construction.fields.reserved.element);
});

test('0.8.2: repeated schema construction creates independent DataField trees', () => {
  const first = models.ColonyData.defineSchema().industry.fields.jobs.element;
  const second = models.ColonyData.defineSchema().industry.fields.jobs.element;
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.fields.reserved.element, second.fields.reserved.element);
});

test('1.3.3: GM instant building origin persists in Colony schema and count supports repeated construction', () => {
  const schema=models.ColonyData.defineSchema().industry.fields;
  assert.equal(schema.placements.element.fields.gmInstant instanceof BooleanField,true);
  assert.ok(schema.buildings.element.fields.count.options.max>=1000);
});

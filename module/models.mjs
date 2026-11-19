const { NumberField, StringField, SchemaField, ArrayField } = foundry.data.fields;
const int = (value, min=0, max=100) => new NumberField({ required: true, nullable: false, integer: true, min, max, initial: value });
const dec = (value, min=0) => new NumberField({ required: true, nullable: false, min, initial: value });
const text = (value='') => new StringField({required: true, nullable: false, initial: value, blank: true});
const {TypeDataModel} = foundry.abstract;
function livingSchema() {
  return {
    abilities: new SchemaField({strength:int(2,1,10),agility:int(2,1,10),endurance:int(2,1,10),intellect:int(2,1,10),perception:int(2,1,10),will:int(2,1,10)}),
    skills: new SchemaField({survival:int(0,0,6),science:int(0,0,6),engineering:int(0,0,6),crafting:int(0,0,6),medicine:int(0,0,6),exploration:int(0,0,6)}),
    survival: new SchemaField({health:int(100),hunger:int(0),thirst:int(0),fatigue:int(0),oxygen:int(100)}),
    rest:new SchemaField({lastDay:int(0,0,9999999)}),
    biography: text(''), specialization: text(''), notes: text('')
  };
}
export class SurvivorData extends TypeDataModel { static defineSchema() {return livingSchema();} }
export class NPCData extends TypeDataModel { static defineSchema() {return livingSchema();} }
const makeReservation = () => new SchemaField({
  itemId:text(''),count:int(1,1,999999),code:text(''),name:text(''),type:text('material'),img:text(''),
  unitMass:dec(0),unitVolume:dec(0),quality:int(0,0,10),techTier:int(0,0,10),
  description:text(''),containerId:text('')
});
const makeIndustryJob = () => new SchemaField({
  id:text(''),subject:text(''),name:text(''),amount:int(1,1,10),remaining:int(0,0,1000),
  startedDay:int(0,0,9999999),createdBy:text(''),userId:text(''),
  sourcePlacementId:text(''),outputPlacementId:text(''),stationPlacementId:text(''),reserved:new ArrayField(makeReservation(),{initial:()=>[]})
});
export class ColonyData extends TypeDataModel {
  static defineSchema(){return {
    capacity: new SchemaField({mass:dec(2500),volume:dec(10000)}),
    science: new SchemaField({
      points:int(0,0,9999999),tier:int(0,0,10),
      unlocked:new ArrayField(text(''),{initial:()=>[]}),
      facilities:new ArrayField(text(''),{initial:()=>[]}),
      projects:new ArrayField(new SchemaField({id:text(''),invested:int(0,0,9999999)}),{initial:()=>[]}),
      dailyWork:new ArrayField(new SchemaField({day:int(0,0,9999999),actorId:text(''),techId:text('')}),{initial:()=>[]}),
      discoveries:new ArrayField(new SchemaField({techId:text(''),day:int(0,0,9999999),by:text('')}),{initial:()=>[]})
    }),
    industry:new SchemaField({
      jobs:new ArrayField(makeIndustryJob(),{initial:()=>[]}),
      construction:new ArrayField(makeIndustryJob(),{initial:()=>[]}),
      buildings:new ArrayField(new SchemaField({id:text(''),count:int(1,0,100),builtDay:int(0,0,9999999),lastClaimDay:int(0,0,9999999)}),{initial:()=>[]}),
      // 0.6 scene links, additive schema for existing 0.5 colonies.
      placements:new ArrayField(new SchemaField({
        id:text(''),colonyId:text(''),buildingId:text(''),sceneId:text(''),tileId:text(''),jobId:text(''),interiorSceneId:text(''),
        x:int(0,0,10000000),y:int(0,0,10000000),width:int(1,1,10000000),height:int(1,1,10000000),
        status:text('construction'),createdDay:int(0,0,9999999),by:text('')
      }),{initial:()=>[]}),
      history:new ArrayField(new SchemaField({day:int(0,0,9999999),kind:text(''),name:text(''),by:text('')}),{initial:()=>[]}),
      processed:new ArrayField(text(''),{initial:()=>[]})
    }),
    // 0.7 additive infrastructure graph. Existing 0.6.1 colonies get empty defaults.
    infrastructure:new SchemaField({
      links:new ArrayField(new SchemaField({
        id:text(''),colonyId:text(''),sceneId:text(''),type:text('power'),
        fromId:text(''),toId:text(''),createdDay:int(0,0,9999999),by:text(''),
        route:new ArrayField(new SchemaField({x:int(0,0,10000000),y:int(0,0,10000000)}),{initial:()=>[]}),
        tileIds:new ArrayField(text(''),{initial:()=>[]})
      }),{initial:()=>[]}),
      priorities:new ArrayField(new SchemaField({id:text(''),priority:int(9,0,9)}),{initial:()=>[]}),
      processed:new ArrayField(text(''),{initial:()=>[]})
    }),
    // 0.8 additive: physical resources, survivor labor and cached supplies on the map.
    crew:new SchemaField({
      nodes:new ArrayField(new SchemaField({
        id:text(''),colonyId:text(''),sceneId:text(''),tileId:text(''),code:text(''),name:text(''),
        x:int(0,0,10000000),y:int(0,0,10000000),remaining:int(0,0,999999),initial:int(0,0,999999)
      }),{initial:()=>[]}),
      caches:new ArrayField(new SchemaField({
        placementId:text(''),stock:new ArrayField(new SchemaField({
          code:text(''),name:text(''),type:text('material'),img:text(''),
          quantity:int(1,1,999999),unitMass:dec(0),unitVolume:dec(0),
          quality:int(0,0,10),techTier:int(0,0,10),description:text('')
        }),{initial:()=>[]})
      }),{initial:()=>[]}),
      jobs:new ArrayField(new SchemaField({
        id:text(''),actorId:text(''),sceneId:text(''),kind:text(''),
        sourceKind:text(''),sourceId:text(''),targetKind:text(''),targetId:text(''),
        cargo:new SchemaField({code:text(''),name:text(''),type:text('material'),img:text(''),
          quantity:int(1,1,999999),unitMass:dec(0),unitVolume:dec(0),
          quality:int(0,0,10),techTier:int(0,0,10),description:text('')}),
        remaining:int(0,0,999999),startedDay:int(0,0,9999999),
        lastAdvancedDay:int(0,0,9999999),createdBy:text('')
      }),{initial:()=>[]}),
      history:new ArrayField(new SchemaField({day:int(0,0,9999999),kind:text(''),name:text(''),by:text('')}),{initial:()=>[]}),
      processed:new ArrayField(text(''),{initial:()=>[]})
    }),
    environment:new SchemaField({zone:text('temperate'),seed:int(71,1,9999999)}),
    mission:new SchemaField({stage:int(0,0,4),shipTileId:text(''),events:new ArrayField(new SchemaField({stage:int(0,0,4),day:int(0,0,9999999),by:text('')}),{initial:()=>[]})}),
    notes:text(''), biome:text('Неизвестный'), name:text('База')
  };}
}
class PhysicalData extends TypeDataModel {
  static defineSchema() {return {
    quantity:int(1,0,999999), unitMass:dec(1), unitVolume:dec(1),
    containerId:text(''), resourceCode:text(''), quality:int(0,0,10),
    description:text(''), techTier:int(0,0,10)
  };}
}
export class MaterialData extends PhysicalData {}
export class GearData extends PhysicalData {}
export class ToolData extends PhysicalData {}
export class ComponentData extends PhysicalData {}
export class ConsumableData extends PhysicalData {}
export class ContainerData extends TypeDataModel {
  static defineSchema() {return {
    capacityMass: dec(30), capacityVolume: dec(50),
    tareMass:dec(2), tareVolume:dec(5), description:text('')
  };}
}

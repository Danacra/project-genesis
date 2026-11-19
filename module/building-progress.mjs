/** Building tiers, game-level rules; no game globals or Foundry dependence. */
import {BUILDING_BY_ID} from './industry-data.mjs';
export const MAX_BUILDING_TIER=3;
const second={bench:'basic-workshop',shelter:'medicine','local-store':'basic-workshop',storehouse:'basic-workshop',
  furnace:'ore-smelting',fieldLab:'laboratories',bioLab:'laboratories',powerLab:'electromagnetism',
  electronicsLab:'automation',flightLab:'advanced-materials',garden:'agriculture','water-recycler':'fluid-systems',
  room:'basic-workshop','assembly-dock':'advanced-materials'};
const third={bench:'precision-machining',shelter:'habitat','local-store':'industrial-fabrication',storehouse:'industrial-fabrication',
  furnace:'material-science',fieldLab:'optics',bioLab:'habitat',powerLab:'power-storage',
  electronicsLab:'telemetry',flightLab:'orbital-systems',garden:'habitat','water-recycler':'habitat',
  room:'industrial-fabrication','assembly-dock':'return-project'};
export function tierOf(placement){return Math.min(3,Math.max(1,Math.trunc(Number(placement?.tier)||1)));}
export function tierSymbol(tier){return ['','◆','◆◆','◆◆◆'][tierOf({tier})];}
export function tierUpgrade(placement){
 const b=BUILDING_BY_ID[placement?.buildingId];
 if(!b)throw Error('Неизвестное сооружение.');
 const current=tierOf(placement);
 if(current===3)throw Error('Это максимальный уровень постройки.');
 const next=current+1;
 const techId=(next===2?second:third)[b.id]||'industrial-fabrication';
 const costs2={bench:{plank:3,stone:2,cloth:1},shelter:{plank:4,cloth:3,brick:2},
   'local-store':{plank:4,brick:2},storehouse:{plank:4,brick:3},furnace:{brick:4,ingot:2},
   powerLab:{ingot:3,copper_ingot:2}};
 const costs3={bench:{plank:6,ingot:4,joinery_kit:1},shelter:{plank:6,cloth:6,reinforced_ingot:2},
   'local-store':{plank:6,ingot:3,brick:3},storehouse:{plank:7,ingot:4,brick:3},
   furnace:{brick:7,ingot:5,reinforced_ingot:2},powerLab:{ingot:5,copper_ingot:4,reinforced_ingot:2}};
 const inputs=next===2?(costs2[b.id]||{plank:3,ingot:2,cloth:1}):
   (costs3[b.id]||{plank:4,ingot:4,brick:3,reinforced_ingot:1});
 return {current,next,techId,inputs,building:b};
}
export function stationSupportsRecipe(placement,recipe){return !!placement&&!!recipe&&
  placement.buildingId===recipe.station&&tierOf(placement)>=Number(recipe.minTier||1);}
export function capacityFactor(tier){return [0,1,1.7,2.5][tierOf({tier})];}

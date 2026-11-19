/** v1.3.4: migrate ONLY untouched default exterior residential tiles.
 * Never change a user's custom tile art, an unrelated scene tile, or a missing scene.
 * Called by the GM after the world becomes ready; safe to call repeatedly.
 */
import {tileAsset} from './map-rules.mjs';
const SYSTEM='project-genesis';
const LEGACY=`systems/${SYSTEM}/assets/buildings/shelter.svg`;
export async function upgradeShelterRoofTiles(world=game){
  if(!world?.user?.isGM)return 0;
  let updated=0;
  const updates=new Map();
  for(const colony of world.actors?.filter?.(a=>a.type==='colony')||[]){
    for(const p of colony.system?.industry?.placements||[]){
      if(p.buildingId!=='shelter'||p.status!=='finished'||!p.tileId)continue;
      const scene=world.scenes?.get?.(p.sceneId),tile=scene?.tiles?.get?.(p.tileId);
      const flags=tile?.flags?.[SYSTEM];
      if(!tile||tile.texture?.src!==LEGACY||flags?.buildingId!=='shelter'||
          flags.colonyId!==colony.id||flags.placementId!==p.id||flags.status!=='finished')continue;
      if(!updates.has(scene))updates.set(scene,[]);
      updates.get(scene).push({_id:tile.id,'texture.src':tileAsset('shelter',true)});
    }
  }
  for(const [scene,rows] of updates){
    try {await scene.updateEmbeddedDocuments('Tile',rows);updated+=rows.length;}
    catch(error){console.error('PROJECT GENESIS: не удалось обновить крыши жилого модуля',scene.id,error);}
  }
  return updated;
}

/** v1.3.5: upgrade untouched original workbench art, preserving custom tiles. */
export async function upgradeDefaultWorkbenchTiles(world=game){
  if(!world?.user?.isGM)return 0;
  const legacy=`systems/${SYSTEM}/assets/buildings/bench.svg`;
  const next=tileAsset('bench',true);
  const grouped=new Map();
  for(const colony of world.actors?.filter?.(a=>a.type==='colony')||[]){
    for(const p of colony.system?.industry?.placements||[]){
      if(p.buildingId!=='bench'||p.status!=='finished'||!p.tileId)continue;
      const scene=world.scenes?.get?.(p.sceneId),tile=scene?.tiles?.get?.(p.tileId);
      const flags=tile?.flags?.[SYSTEM];
      if(!scene||!tile||tile.texture?.src!==legacy||flags?.buildingId!=='bench'||
         flags.colonyId!==colony.id||flags.placementId!==p.id||flags.status!=='finished')continue;
      if(!grouped.has(scene))grouped.set(scene,[]);
      grouped.get(scene).push({_id:tile.id,'texture.src':next});
    }
  }
  let updated=0;
  for(const [scene,rows] of grouped){
    try{await scene.updateEmbeddedDocuments('Tile',rows);updated+=rows.length;}
    catch(error){console.error('PROJECT GENESIS: не удалось обновить тайлы верстаков',scene.id,error);}
  }
  return updated;
}

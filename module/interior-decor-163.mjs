/** PROJECT GENESIS 1.6.3: idempotent, GM-owned interior appearance and furnishing.
 * Nothing touches an unrelated Scene, user-authored art, or manually modified furniture.
 * Furnishing tiles are deliberately decorative: they are not blocking workstations / tokens.
 */
const SYS = 'project-genesis';
const ROOT = `systems/${SYS}/assets/`;
const types = new Set(['shelter', 'room']);
const level = v => Math.max(1, Math.min(3, Math.trunc(Number(v) || 1)));
const list = a => Array.isArray(a) ? a : [...(a || [])];
const same = (a,b) => Math.abs(Number(a)-Number(b)) < 0.01;

/** All geometry uses scene pixels. Values scale to rooms with a different grid size. */
const layouts = Object.freeze({
 shelter: {
  1: [{id:'sleep',piece:'bed',x:2,y:2,w:2,h:2},{id:'desk',piece:'table',x:7,y:2,w:2,h:2},
      {id:'storage',piece:'storage',x:9,y:4,w:1.3,h:1.3},{id:'heat',piece:'utility',x:5,y:1.5,w:1.5,h:1.4}],
  2: [{id:'sleep',piece:'bed',x:2,y:2,w:2.2,h:2.1},{id:'desk',piece:'table',x:7,y:2,w:2.2,h:2},
      {id:'storage',piece:'storage',x:9,y:4,w:1.5,h:1.4},{id:'heat',piece:'utility',x:5,y:1.5,w:1.6,h:1.6}],
  3: [{id:'sleep',piece:'bed',x:2,y:2,w:2.1,h:2},{id:'desk',piece:'table',x:7,y:2,w:2.2,h:2},
      {id:'storage',piece:'storage',x:9,y:4,w:1.5,h:1.4},{id:'heat',piece:'utility',x:5,y:1.5,w:1.6,h:1.6}]
 },
 room: {
  1: [{id:'sleep',piece:'table',x:2,y:2,w:2,h:2},{id:'desk',piece:'storage',x:8,y:2,w:1.6,h:1.5},
      {id:'storage',piece:'storage',x:9,y:4,w:1.3,h:1.3},{id:'heat',piece:'utility',x:5,y:1.5,w:1.5,h:1.4}],
  2: [{id:'sleep',piece:'table',x:2,y:2,w:2,h:2},{id:'desk',piece:'storage',x:8,y:2,w:1.6,h:1.5},
      {id:'storage',piece:'storage',x:9,y:4,w:1.3,h:1.3},{id:'heat',piece:'utility',x:5,y:1.5,w:1.5,h:1.4}],
  3: [{id:'sleep',piece:'table',x:2,y:2,w:2,h:2},{id:'desk',piece:'storage',x:8,y:2,w:1.6,h:1.5},
      {id:'storage',piece:'storage',x:9,y:4,w:1.3,h:1.3},{id:'heat',piece:'utility',x:5,y:1.5,w:1.5,h:1.4}]
 }
});

export function interiorBackground(buildingId, tier=1){
 if(!types.has(buildingId))throw Error('Неверный тип внутреннего помещения.');
 return `${ROOT}interiors/${buildingId}-t${level(tier)}.svg`;
}
export function furniturePlan(kind,tier=1,scene={}){
 if(!types.has(kind))throw Error('Для этого сооружения нет набора мебели.');
 const g=Number(scene?.grid?.size)||100;
 const bounds=scene?.dimensions?.sceneRect||{x:0,y:0};
 return layouts[kind][level(tier)].map(entry=>({id:entry.id,x:Number(bounds.x||0)+entry.x*g,
   y:Number(bounds.y||0)+entry.y*g,width:Math.round(entry.w*g),height:Math.round(entry.h*g),
   texture:{src:`${ROOT}interior-decor/${entry.piece}-t${level(tier)}.svg`}}));
}
export function isDefaultInteriorArt(src,kind){
 return src === `${ROOT}interiors/${kind}.svg` ||
  [1,2,3].some(t=>src === interiorBackground(kind,t));
}
export function untouchedFurniture(tile,oldPlan){
 const original=oldPlan?.find(p=>p.id===tile?.flags?.[SYS]?.decorId);
 return !!original && same(original.x,tile.x) && same(original.y,tile.y) &&
   same(original.width,tile.width) && same(original.height,tile.height) &&
   original.texture.src===tile.texture?.src;
}
function overlap(a,b){return a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;}
function decorTile(p,colonyId,placementId,tier){
 return {x:p.x,y:p.y,width:p.width,height:p.height,rotation:0,alpha:1,
   hidden:false,locked:false,overhead:false,texture:{src:p.texture.src},
   flags:{[SYS]:{interiorDecor:true,decorId:p.id,decorPlacementId:placementId,
     decorColonyId:colonyId,decorTier:level(tier)}}};
}
/** Only an active lead GM can perform Scene writes. Safe to call repeatedly. */
const syncPromises=new Map();
export async function syncInteriorAppearance(scene,placement,world=globalThis.game){
 if(!scene?.id)return false;
 if(syncPromises.has(scene.id))return syncPromises.get(scene.id);
 const job=performInteriorSync(scene,placement,world);
 syncPromises.set(scene.id,job);
 try{return await job;}finally{syncPromises.delete(scene.id);}
}
async function performInteriorSync(scene,placement,world){
 if(!world?.user?.isGM||!scene||!placement||!types.has(placement.buildingId))return false;
 const leader=world.users?.filter?.(u=>u.active&&u.isGM)?.sort?.((a,b)=>a.id.localeCompare(b.id))?.[0];
 if(leader && leader.id!==world.user.id)return false;
 const f=scene.flags?.[SYS];
 if(f?.interiorOf!==placement.id||f?.colonyId!==placement.colonyId||
    scene.id!==placement.interiorSceneId)return false;
 const kind=placement.buildingId,tier=level(placement.tier);
 const current=Number(f.decorTier)||0;
 if(current===tier&&Number(f.decorRevision)===1)return false;
 const src=scene.background?.src||'';
 // Never decorate a bespoke scene background automatically.
 if(!isDefaultInteriorArt(src,kind))return false;
 const plans=furniturePlan(kind,tier,scene),previous=current?furniturePlan(kind,current,scene):[];
 const found=list(scene.tiles).filter(t=>t.flags?.[SYS]?.interiorDecor&&t.flags?.[SYS]?.decorPlacementId===placement.id);
 const updates=[],creates=[];
 for(const plan of plans){
   const old=found.find(t=>t.flags[SYS].decorId===plan.id);
   if(old){
     if(!untouchedFurniture(old,previous))continue; // user repositioned/retextured: preserve it
     if(previous.length)updates.push({_id:old.id,x:plan.x,y:plan.y,width:plan.width,height:plan.height,
       'texture.src':plan.texture.src,[`flags.${SYS}.decorTier`]:tier});
     continue;
   }
   // Existing handmade furniture / workstations have priority over automatic decor.
   const blocking=list(scene.tiles).filter(t=>!found.includes(t) && !t.flags?.[SYS]?.interiorDecor);
   if(blocking.some(tile=>overlap(plan,tile)))continue;
   creates.push(decorTile(plan,f.colonyId,placement.id,tier));
 }
 // Update before adding, then commit flags only after successful writes.
 if(updates.length)await scene.updateEmbeddedDocuments('Tile',updates);
 if(creates.length){
   const created=await scene.createEmbeddedDocuments('Tile',creates);
   if(created.length!==creates.length)throw Error('Часть мебели не размещена — повторите синхронизацию.');
 }
 if(src!==interiorBackground(kind,tier))await scene.update({'background.src':interiorBackground(kind,tier)});
 await scene.setFlag(SYS,'decorTier',tier);
 await scene.setFlag(SYS,'decorRevision',1);
 return true;
}

/** Update interiors after tier upgrades, without polling or extra socket messages. */
export function initializeInteriorAppearance(world=globalThis.game,hooks=globalThis.Hooks){
 if(!world?.user?.isGM||!hooks?.on)return;
 const running=new Set();
 hooks.on('updateActor',(actor,changes)=>{
   if(actor?.type!=='colony'||!Object.keys(changes||{}).some(k=>k==='system'||k.startsWith('system.industry')))return;
   for(const p of actor.system.industry?.placements||[]){
     if(!p.interiorSceneId||p.status!=='finished'||running.has(p.interiorSceneId))continue;
     const scene=world.scenes.get(p.interiorSceneId);
     if(!scene||scene.flags?.[SYS]?.decorTier===level(p.tier)&&scene.flags?.[SYS]?.decorRevision===1)continue;
     running.add(p.interiorSceneId);
     Promise.resolve().then(()=>syncInteriorAppearance(scene,p,world))
       .catch(e=>console.warn('PROJECT GENESIS: оформление помещения',e))
       .finally(()=>running.delete(p.interiorSceneId));
   }
 });
}

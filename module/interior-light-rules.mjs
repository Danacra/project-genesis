/** PROJECT GENESIS v1.3.1 — pure interior lighting rules for Foundry v13. */
const SYS='project-genesis';
export const DEFAULT_DARKNESS=0.85;
export function lightSwitchOn(scene){
  return scene?.flags?.[SYS]?.lightsOn !== false;
}
export function effectiveLight(powered,scene){
  return Boolean(powered && lightSwitchOn(scene));
}
export function ceilingLightData(scene,placementId,powered){
  const width=Number(scene?.width||scene?.dimensions?.sceneRect?.width||1200);
  const height=Number(scene?.height||scene?.dimensions?.sceneRect?.height||900);
  const bounds=scene?.dimensions?.sceneRect;
  const x=Number(bounds?.x||0)+width/2;
  const y=Number(bounds?.y||0)+height/2;
  return {
    x,y,hidden:!effectiveLight(powered,scene),walls:true,vision:false,
    config:{bright:6,dim:12,color:'#cceeff',alpha:0.35,luminosity:0.5,
      animation:{type:'none',speed:1,intensity:0}},
    flags:{[SYS]:{managedInteriorLight:true,placementId}}
  };
}
export function managedCeilingLight(scene,placementId){
  return [...(scene?.lights||[])].find(l=>l.flags?.[SYS]?.managedInteriorLight===true&&
    l.flags?.[SYS]?.placementId===placementId)||null;
}
export function lightPlan(scene,placementId,powered){
  const existing=managedCeilingLight(scene,placementId);
  const target=ceilingLightData(scene,placementId,powered);
  if(!existing)return {action:'create',document:target};
  if(Boolean(existing.hidden)===target.hidden)return {action:'none'};
  return {action:'update',document:{_id:existing.id,hidden:target.hidden}};
}
export function canUseRoomSwitch(user,scene,actors){
  if(user?.isGM)return true;
  if(!user?.active||!scene?.flags?.[SYS]?.interiorOf)return false;
  return [...(scene.tokens||[])].some(t=>{
    const a=actors?.get?.(t.actorId);
    return a?.type==='survivor' && a.testUserPermission?.(user,'OWNER');
  });
}

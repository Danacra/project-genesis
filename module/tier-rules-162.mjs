/** PROJECT GENESIS 1.6.2 — dependency-free building and utility tier mechanics. */
export const MAX_TIER=3;
export const CABLE_CAPACITY=Object.freeze({
  power:Object.freeze([0,24,48,96]),
  water:Object.freeze([0,18,36,72])
});
export function tierNumber(raw){
  const n=Number(raw);
  return Number.isFinite(n)?Math.max(1,Math.min(3,Math.trunc(n))):1;
}
export function buildingCells(base,tier=1){
  if(!Array.isArray(base)||base.length!==2)return null;
  const extra=tierNumber(tier)-1;
  return Object.freeze([base[0]+extra,base[1]+extra]);
}
export function effectiveDemand(base,tier=1){
  const value=Math.max(0,Number(base)||0);
  return Math.ceil(value*[0,1,1.7,2.6][tierNumber(tier)]);
}
export function effectiveProduction(base,tier=1){
  return (Number(base)||0)*(1+0.5*(tierNumber(tier)-1));
}
export function linkCapacity(type,tier=1){
  if(!CABLE_CAPACITY[type])throw Error('Неизвестная инженерная сеть.');
  return CABLE_CAPACITY[type][tierNumber(tier)];
}
export function utilityProfile(buildingId,tier,devices,interiorLoad=0){
  const spec=devices?.[buildingId]||{};
  return {
    power:effectiveDemand(spec.power,tier)+Math.max(0,Number(interiorLoad)||0),
    water:effectiveDemand(spec.water,tier),
    powerOut:effectiveProduction(spec.powerOut,tier),
    waterOut:effectiveProduction(spec.waterOut,tier),
    optionalPower:!!spec.optionalPower && !(buildingId==='shelter' && tierNumber(tier)>1),
    optionalWater:!!spec.optionalWater,
    priority:spec.priority??9
  };
}
/** All links of the same utility on the same scene connected by shared building endpoints. */
export function chainMembers(links,linkId){
  const all=Array.isArray(links)?links:[];
  const root=all.find(l=>l.id===linkId);
  if(!root)throw Error('Участок сети не найден.');
  const matching=all.filter(l=>l.type===root.type&&l.sceneId===root.sceneId);
  const touched=new Set([root.fromId,root.toId]);
  const members=new Set([root.id]);
  let changed=true;
  while(changed){
    changed=false;
    for(const l of matching){
      if(members.has(l.id))continue;
      if(touched.has(l.fromId)||touched.has(l.toId)){
        members.add(l.id);touched.add(l.fromId);touched.add(l.toId);changed=true;
      }
    }
  }
  return matching.filter(l=>members.has(l.id));
}
export function chainUpgradePlan(links,linkId){
  const members=chainMembers(links,linkId);
  const current=Math.min(...members.map(l=>tierNumber(l.tier)));
  if(current>=MAX_TIER)throw Error('Все соединения выбранной цепи уже III уровня.');
  const next=current+1;
  const need=members.filter(l=>tierNumber(l.tier)<next);
  const segments=need.reduce((n,l)=>n+(Array.isArray(l.route)?l.route.length:0),0);
  if(segments<1)throw Error('В цепи нет сегментов для улучшения.');
  const power=members[0].type==='power';
  const inputs=power?(next===2?{wire_bundle:Math.ceil(segments/3),iron_ingot:Math.ceil(segments/4)}:
    {wire_bundle:Math.ceil(segments/2),steel_plate:Math.ceil(segments/3)}):
    (next===2?{iron_ingot:Math.ceil(segments/3),brick:Math.ceil(segments/4)}:
    {steel_plate:Math.ceil(segments/3),aluminum_ingot:Math.ceil(segments/4)});
  const techId=power?(next===2?'electromagnetism':'power-storage'):
    (next===2?'fluid-systems':'industrial-fabrication');
  return {members,current,next,need,segments,inputs,techId,type:members[0].type};
}

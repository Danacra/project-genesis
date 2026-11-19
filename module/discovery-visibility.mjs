/** Visibility is presentation-only; research rules remain authoritative server-side. */
export function availableEras(technologies, unlocked, isGM=false) {
  const completed=new Set(unlocked||[]);
  const tiers=[...new Set(technologies.map(t=>t.t))].sort((a,b)=>a-b);
  const allowed=new Set();
  for (let i=0;i<tiers.length;i++) {
    const tier=tiers[i];
    if(isGM || i===0 || technologies.filter(t=>t.t===tiers[i-1]).every(t=>completed.has(t.id))) allowed.add(tier);
    else break;
  }
  return allowed;
}
export function availableFieldPhases(phases, studies, unlocked, isGM=false) {
  const completed=new Set(unlocked||[]), allowed=new Set();
  for(let i=0;i<phases.length;i++) {
    const phase=phases[i];
    if(isGM || i===0 || studies.filter(s=>s.phase===phases[i-1].id).every(s=>completed.has(s.id))) allowed.add(phase.id);
    else break;
  }
  return allowed;
}
export function obscureBlueprints(recipes, isGM) {
  return recipes.map(r=>r.unlocked||isGM?r:{...r,name:'???',techName:'Неизвестное открытие'});
}

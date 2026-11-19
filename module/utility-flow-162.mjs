/** Prioritized, all-or-nothing utility allocation with capacities on individual network links. */
import {linkCapacity} from './tier-rules-162.mjs';
const EPS=1e-8;
/**
 * nodes must expose id, priority, and {power,water,powerOut,waterOut}.
 * Returns who is served, total produced and total demand; only valid same-scene links are provided.
 */
export function allocateUtility(type,nodes,links){
  const byId=new Map(nodes.map(n=>[n.id,n]));
  const graph=new Map(nodes.map(n=>[n.id,[]]));
  const flows=new Map();
  const supplies=new Map();
  for(const n of nodes){
    const production=type==='power'?n.powerOut:(n.powered?n.waterOut:0);
    supplies.set(n.id,production);
  }
  for(const l of links){
    if(!byId.has(l.fromId)||!byId.has(l.toId))continue;
    const e={id:l.id,from:l.fromId,to:l.toId,limit:linkCapacity(type,l.tier)};
    graph.get(l.fromId).push(e);graph.get(l.toId).push(e);flows.set(l.id,0);
  }
  const demandKey=type==='power'?'power':'water';
  const served=new Set();
  const consumers=nodes.filter(n=>n[demandKey]>0).sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
  const routeToSource=target=>{
    const queue=[target],seen=new Set([target]),parents=new Map();
    for(let q=0;q<queue.length;q++){
      const current=queue[q];
      if((supplies.get(current)||0)>EPS){
        const route=[];let id=current;
        while(id!==target){const row=parents.get(id);route.push(row);id=row.fromNode;}
        return {source:current,route};
      }
      for(const edge of graph.get(current)||[]){
        const other=edge.from===current?edge.to:edge.from;
        // Requested energy would flow from 'other' toward 'current'.
        const direction=edge.from===other?1:-1;
        const available=edge.limit-direction*(flows.get(edge.id)||0);
        if(available<EPS||seen.has(other))continue;
        seen.add(other);parents.set(other,{edge,sign:direction,fromNode:current});queue.push(other);
      }
    }
    return null;
  };
  let delivered=0;
  for(const n of consumers){
    const beforeFlows=new Map(flows),beforeSupplies=new Map(supplies);
    let required=n[demandKey];
    while(required>EPS){
      const candidate=routeToSource(n.id);
      if(!candidate)break;
      let amount=Math.min(required,supplies.get(candidate.source));
      for(const {edge,sign} of candidate.route)
        amount=Math.min(amount,edge.limit-sign*(flows.get(edge.id)||0));
      if(amount<EPS)break;
      supplies.set(candidate.source,supplies.get(candidate.source)-amount);
      for(const {edge,sign} of candidate.route)
        flows.set(edge.id,(flows.get(edge.id)||0)+sign*amount);
      required-=amount;
    }
    if(required<=EPS){served.add(n.id);delivered+=n[demandKey];}
    else{flows.clear();for(const [k,v]of beforeFlows)flows.set(k,v);
      supplies.clear();for(const [k,v]of beforeSupplies)supplies.set(k,v);}
  }
  return {served,delivered,produced:nodes.reduce((s,n)=>s+(type==='power'?n.powerOut:(n.powered?n.waterOut:0)),0),
    demand:nodes.reduce((s,n)=>s+n[demandKey],0),flows};
}

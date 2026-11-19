/** PROJECT GENESIS 0.7.1 — pure grid routing and abstract colony utility simulation.
 * Units are game abstractions, not real engineering measurements.
 */
import {sceneGeometry, overlaps} from './map-rules.mjs';
import {tierNumber,utilityProfile} from './tier-rules-162.mjs';
import {allocateUtility} from './utility-flow-162.mjs';
export const NETWORK_TYPES=Object.freeze({power:{name:'Электрокабель',material:'copper',per:3,icon:'⚡'},water:{name:'Водопровод',material:'alloy',per:3,icon:'◉'}});
export const NETWORK_LIMITS=Object.freeze({maxLinks:60,maxRoute:100,maxTiles:1200,maxSceneCells:30000});
export const DEVICES=Object.freeze({
  bench:{power:1,optionalPower:true,priority:8},
  fieldLab:{power:2,optionalPower:true,priority:5},
  furnace:{power:5,optionalPower:true,priority:8},
  bioLab:{power:3,water:1,optionalPower:true,optionalWater:true,priority:5},
  powerLab:{powerOut:18,priority:0},
  electronicsLab:{power:4,priority:3},
  flightLab:{power:8,water:3,priority:4},
  storehouse:{priority:9}, 'local-store':{priority:9},
  garden:{power:1,water:3,optionalPower:true,optionalWater:true,priority:6},
  'water-recycler':{power:4,waterOut:12,priority:1},
  shelter:{power:2,water:2,optionalPower:true,optionalWater:true,priority:2},
  room:{power:1,priority:4},
  'assembly-dock':{power:10,water:4,priority:5}
});
const key=(x,y)=>`${x}:${y}`;
const list=v=>Array.isArray(v)?v:[];
const inRect=(cell,r)=>cell.x>=r.x&&cell.y>=r.y&&cell.x<r.x+r.width&&cell.y<r.y+r.height;
export function cellsInBounds(scene){
  const geom=sceneGeometry(scene),{bounds,grid}=geom;
  const cols=Math.floor(bounds.width/grid),rows=Math.floor(bounds.height/grid);
  if(cols<1||rows<1||cols*rows>NETWORK_LIMITS.maxSceneCells)
    throw Error('Карта слишком велика для автоматической прокладки: используйте меньшую локальную сцену.');
  return {...geom,cols,rows};
}
function cellIndex(pixel,zero,grid){return Math.round((pixel-zero)/grid);}
function cellsOfRect(p,g){
  const x=cellIndex(Number(p.x),g.bounds.x,g.grid),y=cellIndex(Number(p.y),g.bounds.y,g.grid);
  const w=Number(p.width)/g.grid,h=Number(p.height)/g.grid;
  if(!Number.isInteger(x)||!Number.isInteger(y)||!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1)
    throw Error('Здание не совпадает с квадратной сеткой сцены.');
  return {x,y,width:w,height:h};
}
function edgeCells(r){
  const result=[];
  for(let x=r.x;x<r.x+r.width;x++){result.push({x,y:r.y-1},{x,y:r.y+r.height});}
  for(let y=r.y;y<r.y+r.height;y++){result.push({x:r.x-1,y},{x:r.x+r.width,y});}
  return result;
}
function mapBlockers(scene,placements,g){
  const used=new Set();
  const all=[...list(placements).filter(p=>p.sceneId===scene.id),
    ...[...(scene?.tiles||[])].filter(t=>t.flags?.['project-genesis']?.buildingId||t.flags?.['project-genesis']?.blockPlacement)];
  for(const item of all){
    const r=cellsOfRect(item,g);
    for(let x=r.x;x<r.x+r.width;x++)for(let y=r.y;y<r.y+r.height;y++){
      if(x>=0&&y>=0&&x<g.cols&&y<g.rows)used.add(key(x,y));
    }
  }
  return used;
}
function validateEndpoint(placement,scene){
  if(!placement||placement.sceneId!==scene.id||placement.status!=='finished')
    throw Error('Для соединения нужны два готовых здания на одной сцене.');
}

/** Validate user-drawn grid route on the active scene. Nothing from the browser
 * preview is trusted: the GM invokes this again before any inventory is debited.
 */
export function validateManualRoute(scene,placements,fromId,toId,route,{links=[]}={}){
  if(fromId===toId)throw Error('Нельзя подключить здание к самому себе.');
  const from=list(placements).find(p=>p.id===fromId),to=list(placements).find(p=>p.id===toId);
  validateEndpoint(from,scene);validateEndpoint(to,scene);
  const g=cellsInBounds(scene),a=cellsOfRect(from,g),b=cellsOfRect(to,g);
  if(!Array.isArray(route)||!route.length||route.length>NETWORK_LIMITS.maxRoute)
    throw Error('Недопустимая длина ручного маршрута.');
  const blocked=mapBlockers(scene,placements,g);
  const existing=new Set(list(links).filter(l=>l.sceneId===scene.id).flatMap(l=>list(l.route).map(c=>key(c.x,c.y))));
  const neighbors=(r,c)=>edgeCells(r).some(p=>p.x===c.x&&p.y===c.y);
  const seen=new Set();let previous=null;
  for(const cell of route){
    if(!Number.isSafeInteger(cell?.x)||!Number.isSafeInteger(cell?.y))throw Error('Маршрут должен идти по целым координатам.');
    const dx=(cell.x-g.bounds.x)/g.grid,dy=(cell.y-g.bounds.y)/g.grid;
    if(!Number.isInteger(dx)||!Number.isInteger(dy)||dx<0||dy<0||dx>=g.cols||dy>=g.rows)
      throw Error('Маршрут выходит за сетку карты.');
    const ck=key(dx,dy);
    if(blocked.has(ck))throw Error('Маршрут пересекает здание или препятствие.');
    if(existing.has(key(cell.x,cell.y)))throw Error('Маршрут пересекает уже проложенную сеть.');
    if(seen.has(ck))throw Error('Маршрут повторно посещает одну клетку.');
    if(previous&&Math.abs(cell.x-previous.x)+Math.abs(cell.y-previous.y)!==g.grid)
      throw Error('Маршрут должен состоять из соседних клеток без диагоналей.');
    previous=cell;seen.add(ck);
  }
  const first={x:(route[0].x-g.bounds.x)/g.grid,y:(route[0].y-g.bounds.y)/g.grid};
  const last={x:(route.at(-1).x-g.bounds.x)/g.grid,y:(route.at(-1).y-g.bounds.y)/g.grid};
  if(!neighbors(a,first)||!neighbors(b,last))throw Error('Маршрут должен начинаться у здания А и заканчиваться у здания Б.');
  return route.map(cell=>({x:cell.x,y:cell.y}));
}
/** Validate one manual click independently of browser drawing. */
export function appendManualStep(scene,placements,fromId,route,cell,{links=[]}={}){
  const g=cellsInBounds(scene),from=list(placements).find(p=>p.id===fromId);
  validateEndpoint(from,scene);
  if(!Array.isArray(route)||route.length>=NETWORK_LIMITS.maxRoute)throw Error('Превышена длина инженерной сети.');
  if(!Number.isSafeInteger(cell?.x)||!Number.isSafeInteger(cell?.y))throw Error('Неверная клетка.');
  const cx=(cell.x-g.bounds.x)/g.grid,cy=(cell.y-g.bounds.y)/g.grid;
  if(!Number.isInteger(cx)||!Number.isInteger(cy)||cx<0||cy<0||cx>=g.cols||cy>=g.rows)
    throw Error('Клетка за пределами карты.');
  if(mapBlockers(scene,placements,g).has(key(cx,cy)))throw Error('Клетка занята зданием.');
  if(list(links).some(l=>l.sceneId===scene.id&&list(l.route).some(p=>p.x===cell.x&&p.y===cell.y)))
    throw Error('Клетка занята другой сетью.');
  if(route.some(p=>p.x===cell.x&&p.y===cell.y))throw Error('Клетка уже входит в маршрут.');
  if(!route.length){if(!edgeCells(cellsOfRect(from,g)).some(c=>c.x===cx&&c.y===cy))
      throw Error('Первую клетку выберите рядом с начальным зданием.');}
  else if(Math.abs(route.at(-1).x-cell.x)+Math.abs(route.at(-1).y-cell.y)!==g.grid)
    throw Error('Следующую клетку выберите рядом с предыдущей.');
  return [...route,{x:cell.x,y:cell.y}];
}
/** Geometry helper for the scene click-to-draw editor. */
export function snapNetworkCell(scene,point){
  const g=cellsInBounds(scene),x=Math.floor((point.x-g.bounds.x)/g.grid),y=Math.floor((point.y-g.bounds.y)/g.grid);
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=g.cols||y>=g.rows)throw Error('Курсор за пределами карты.');
  return {x:g.bounds.x+x*g.grid,y:g.bounds.y+y*g.grid};
}

export function routeNetwork(scene,placements,fromId,toId){
  if(fromId===toId)throw Error('Нельзя соединить здание с самим собой.');
  const from=list(placements).find(p=>p.id===fromId),to=list(placements).find(p=>p.id===toId);
  validateEndpoint(from,scene);validateEndpoint(to,scene);
  const g=cellsInBounds(scene),blocked=mapBlockers(scene,placements,g),a=cellsOfRect(from,g),b=cellsOfRect(to,g);
  if(overlaps(a,b))throw Error('Здания накладываются друг на друга.');
  const inside=c=>c.x>=0&&c.y>=0&&c.x<g.cols&&c.y<g.rows&&!blocked.has(key(c.x,c.y));
  const starts=edgeCells(a).filter(inside),ends=new Set(edgeCells(b).filter(inside).map(c=>key(c.x,c.y)));
  if(!starts.length||!ends.size)throw Error('Нет свободных клеток для подключения к зданию.');
  const queue=[],visited=new Map();
  for(const c of starts){const k=key(c.x,c.y);if(!visited.has(k)){visited.set(k,null);queue.push(c);}}
  const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
  let finish=null;
  for(let index=0;index<queue.length;index++){
    const c=queue[index],k=key(c.x,c.y);
    if(ends.has(k)){finish=k;break;}
    for(const [dx,dy]of dirs){const n={x:c.x+dx,y:c.y+dy},nk=key(n.x,n.y);
      if(!visited.has(nk)&&inside(n)){visited.set(nk,k);queue.push(n);}
    }
  }
  if(!finish)throw Error('Между зданиями нет свободного маршрута для сети.');
  const route=[];
  for(let k=finish;k!==null;k=visited.get(k)){
    const [x,y]=k.split(':').map(Number);
    route.push({x:g.bounds.x+x*g.grid,y:g.bounds.y+y*g.grid});
    if(route.length>NETWORK_LIMITS.maxRoute)throw Error(`Маршрут слишком длинный (максимум ${NETWORK_LIMITS.maxRoute} клеток).`);
  }
  return route.reverse();
}
export function networkCost(type,length){
  const spec=NETWORK_TYPES[type];
  if(!spec||!Number.isSafeInteger(length)||length<1||length>NETWORK_LIMITS.maxRoute)throw Error('Неверный тип или длина коммуникации.');
  return {[spec.material]:Math.ceil(length/spec.per)};
}
export function validateNetworkLink(link,scene){
  if(!scene)return 'missing-scene';
  if(link.sceneId!==scene.id)return 'wrong-scene';
  if(!NETWORK_TYPES[link.type])return 'invalid-type';
  if(!list(link.route).length||link.route.length!==list(link.tileIds).length)return 'missing-tile';
  let g;try{g=cellsInBounds(scene);}catch{return 'bad-scene';}
  const tiles=scene.tiles,expectedTiles=asNetworkTiles(link.type,link.route,{networkId:link.id,colonyId:link.colonyId,grid:g.grid,gmFree:!!link.gmFree,tier:tierNumber(link.tier)});
  for(let i=0;i<link.tileIds.length;i++){
    const tile=tiles?.get?.(link.tileIds[i])||[...(tiles||[])].find(t=>t.id===link.tileIds[i]);
    if(!tile)return 'missing-tile';
    const flag=tile.flags?.['project-genesis'];
    if(flag?.networkId!==link.id||flag?.colonyId!==link.colonyId||flag?.networkType!==link.type||
       !!flag?.gmFree!==!!link.gmFree||tierNumber(flag?.tier)!==tierNumber(link.tier))return 'foreign-tile';
    const expected=expectedTiles[i];
    if(Math.abs(Number(tile.rotation??0)-expected.rotation)>0.01||
       tile.texture?.src!==expected.texture.src||
       Math.abs(Number(tile.x)-link.route[i].x)>0.01||Math.abs(Number(tile.y)-link.route[i].y)>0.01||
       Math.abs(Number(tile.width)-g.grid)>0.01||Math.abs(Number(tile.height)-g.grid)>0.01)return 'moved-tile';
  }
  return 'ok';
}
/** Tile images are rotated to follow cable/pipe path direction; corners are
 * drawn with a separate elbow texture, and single-cell routes get a junction.
 */
export function asNetworkTiles(type,route,{networkId,colonyId,grid,gmFree=false,tier=1}){
  if(!NETWORK_TYPES[type])throw Error('Неизвестный тип сети.');
  const direction=(a,b)=>({x:Math.sign(b.x-a.x),y:Math.sign(b.y-a.y)});
  const makeTile=(cell,index)=>{
    const before=route[index-1],after=route[index+1];
    const dirs=[];
    if(before)dirs.push(direction(cell,before));
    if(after)dirs.push(direction(cell,after));
    const corner=dirs.length===2&&dirs[0].x!==dirs[1].x&&dirs[0].y!==dirs[1].y;
    const part=route.length===1?'junction':corner?'corner':'straight';
    let rotation=0;
    if(corner){
      const up=dirs.some(d=>d.y===-1),right=dirs.some(d=>d.x===1),down=dirs.some(d=>d.y===1),left=dirs.some(d=>d.x===-1);
      rotation=up&&right?0:right&&down?90:down&&left?180:left&&up?270:0;
    }else if(dirs[0]?.x)rotation=90;
    return {x:cell.x,y:cell.y,width:grid,height:grid,rotation,alpha:0.92,hidden:false,locked:true,
      texture:{src:`systems/project-genesis/assets/networks/${type}-${part}${tierNumber(tier)>1?'-t'+tierNumber(tier):''}.svg`},
       flags:{'project-genesis':{networkId,colonyId,networkType:type,index,gmFree:!!gmFree,tier:tierNumber(tier)}}};
  };
  return route.map(makeTile);
}
/** Per-segment capacity; supply is distributed in consumer priority order.
 * Unconnected or under-capacity buildings cannot borrow energy from other graphs. */
export function simulateNetworks(placements,links,{linkStatuses={},priorities={},interiorLoads={}}={}){
  const active=list(placements).filter(p=>p.status==='finished'&&DEVICES[p.buildingId]);
  const nodes=new Map(active.map(p=>{
    const tier=tierNumber(p.tier),profile=utilityProfile(p.buildingId,tier,DEVICES,interiorLoads[p.id]||0);
    return [p.id,{id:p.id,buildingId:p.buildingId,sceneId:p.sceneId,tier,
      powered:false,watered:false,power:profile.power,water:profile.water,
      powerNeed:profile.power,waterNeed:profile.water,powerOut:profile.powerOut,waterOut:profile.waterOut,
      optionalPower:profile.optionalPower,optionalWater:profile.optionalWater,
      operational:false,manual:false,
      priority:Number.isInteger(priorities[p.id])?priorities[p.id]:profile.priority}];
  }));
  const valid=list(links).filter(l=>NETWORK_TYPES[l.type]&&nodes.has(l.fromId)&&nodes.has(l.toId)&&
    nodes.get(l.fromId).sceneId===nodes.get(l.toId).sceneId&&nodes.get(l.fromId).sceneId===l.sceneId&&linkStatuses[l.id]!=='invalid');
  const byType={power:valid.filter(l=>l.type==='power'),water:valid.filter(l=>l.type==='water')};
  const totals={power:{supply:0,demand:0,served:0,networks:0},water:{supply:0,demand:0,served:0,networks:0}};
  for(const type of ['power','water']){
    const allocated=allocateUtility(type,[...nodes.values()],byType[type]);
    for(const node of nodes.values()){
      const ok=(type==='power'?node.power:node.water)===0||allocated.served.has(node.id);
      if(type==='power')node.powered=ok;else node.watered=ok;
    }
    totals[type].supply=allocated.produced;
    totals[type].demand=allocated.demand;
    totals[type].served=allocated.delivered;
    // Count independently wired groups for the existing network summary.
    const graph=new Map([...nodes.keys()].map(id=>[id,new Set()]));
    for(const l of byType[type]){graph.get(l.fromId).add(l.toId);graph.get(l.toId).add(l.fromId);}
    const visited=new Set();let groups=0;
    for(const [id,neighbors] of graph){
      if(!neighbors.size||visited.has(id))continue;
      groups++;const stack=[id];visited.add(id);
      while(stack.length){for(const other of graph.get(stack.pop()))if(!visited.has(other)){
        visited.add(other);stack.push(other);
      }}
    }
    totals[type].networks=groups;
  }
  for(const n of nodes.values()){
    n.operational=Boolean((n.powered||n.optionalPower)&&(n.watered||n.optionalWater));
    n.manual=!!(n.operational&&(!n.powered||!n.watered));
  }
  return {nodes:[...nodes.values()],byId:Object.fromEntries(nodes),totals,validLinks:valid.length};
}
export function networkOperational(placement,simulation){return simulation.byId[placement.id]?.operational??false;}

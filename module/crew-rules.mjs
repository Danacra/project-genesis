/** PROJECT GENESIS 0.8: deterministic, Foundry-independent logistics rules. */
import {fits,capacity,measure,perQuantity,plus} from './rules.mjs';
import {sceneGeometry,snapToGrid,overlaps} from './map-rules.mjs';
export const RESOURCE_NODES=Object.freeze({
  wood:{name:'Древесина',code:'wood',mass:2,volume:4,limit:500,days:1,skill:'survival'},
  stone:{name:'Камень',code:'stone',mass:2,volume:1.5,limit:500,days:1,skill:'survival'},
  fiber:{name:'Растительное волокно',code:'fiber',mass:.3,volume:1,limit:500,days:1,skill:'survival'},
  ore:{name:'Рудная порода',code:'ore',mass:3,volume:2,limit:350,days:2,skill:'engineering'},
  clay:{name:'Глина',code:'clay',mass:1.5,volume:1.3,limit:350,days:1,skill:'survival'},
  scrap:{name:'Обломки корабля',code:'scrap',mass:2,volume:2,limit:250,days:2,skill:'engineering'},
  sample:{name:'Исследовательские образцы',code:'sample',mass:.25,volume:.4,limit:220,days:1,skill:'exploration'},
  organic:{name:'Биологические образцы',code:'organic',mass:.5,volume:1,limit:320,days:1,skill:'survival'},
  copper:{name:'Медная руда',code:'copper',mass:2,volume:1.5,limit:220,days:2,skill:'engineering'},
  silicon:{name:'Кремнистая порода',code:'silicon',mass:1.5,volume:1,limit:160,days:2,skill:'engineering'},
  crystal:{name:'Необычные кристаллы',code:'crystal',mass:.8,volume:.8,limit:140,days:3,skill:'exploration'}
});
const list=x=>Array.isArray(x)?x:[];
export const MAX_CREW_JOBS=50,MAX_NODES=160,MAX_CACHES=160,MAX_CARGO=120;
export const maxInt=(n,upper)=>Number.isSafeInteger(n)&&n>=1&&n<=upper;
export const round=n=>Math.round(n*1e6)/1e6;
export function crewState(colony){return colony.system?.crew||{nodes:[],caches:[],jobs:[],history:[],processed:[]};}
export function validActor(actor){return !!actor&&actor.type==='survivor';}
export function cartBonus(actor){
  const usable=[...(actor?.items||[])].some(i=>i.type==='tool'&&i.system?.resourceCode==='handcart'&&i.system?.quantity>0);
  return usable?{factor:2}: {factor:1};
}
export function carryCapacity(actor){return capacity(actor);}
export function packed(actor,item,count){return fits(plus(measure(actor.items),perQuantity(item,count)),carryCapacity(actor));}
export function laborDays(actor,nodeType,qty){
  const def=RESOURCE_NODES[nodeType];if(!def||!maxInt(qty,MAX_CARGO))throw Error('Некорректный объём добычи.');
  const skill=Math.max(0,Number(actor?.system?.skills?.[def.skill])||0);
  const effort=Math.max(1,Math.ceil(qty/(2+skill)));
  return Math.max(1,effort+def.days-1);
}
export function journeyDays(scene,from,to,actor,cargo){
  if(!scene||![from?.x,from?.y,to?.x,to?.y].every(Number.isFinite))throw Error('Неизвестный путь доставки.');
  const grid=sceneGeometry(scene).grid;
  const blocks=(Math.abs(from.x-to.x)+Math.abs(from.y-to.y))/grid;
  const cargoMass=(Number(cargo.unitMass)||0)*Number(cargo.quantity||0);
  if(!Number.isFinite(blocks)||blocks>2000||cargoMass<0)throw Error('Некорректный маршрут.');
  const cart=cartBonus(actor).factor;
  return Math.max(1,Math.ceil(blocks/(18*cart))+Math.floor(cargoMass/(35*cart)));
}
export function cacheLimit(placement){
  return (placement.buildingId==='storehouse'||placement.buildingId==='local-store')?{mass:750,volume:1500}:
    placement.status==='construction'?{mass:220,volume:330}:{mass:200,volume:300};
}
export function cacheLoad(stock){return list(stock).reduce((a,r)=>({mass:round(a.mass+r.quantity*r.unitMass),
  volume:round(a.volume+r.quantity*r.unitVolume)}),{mass:0,volume:0});}
export function validateCache(stock,cargo,placement){
  if(!maxInt(cargo?.quantity,999999)||!Number.isFinite(cargo.unitMass)||!Number.isFinite(cargo.unitVolume)||
      cargo.unitMass<0||cargo.unitVolume<0)throw Error('Неверные параметры груза.');
  const load=cacheLoad(stock);
  if(!fits(plus(load,{mass:round(cargo.unitMass*cargo.quantity),volume:round(cargo.unitVolume*cargo.quantity)}),cacheLimit(placement)))
    throw Error('На площадке недостаточно места для груза.');
  return true;
}
export function changeStock(stock,cargo,direction=1){
  const rows=list(stock).map(r=>({...r}));
  if(!maxInt(cargo?.quantity,999999)||![1,-1].includes(direction))throw Error('Неверное количество материалов.');
  const found=rows.find(r=>r.code===cargo.code&&r.name===cargo.name&&r.type===cargo.type&&
    r.unitMass===cargo.unitMass&&r.unitVolume===cargo.unitVolume&&
    Number(r.quality||0)===Number(cargo.quality||0)&&Number(r.techTier||0)===Number(cargo.techTier||0)&&
    String(r.description||'')===String(cargo.description||''));
  if(direction===-1&&(!found||found.quantity<cargo.quantity))throw Error('В хранилище недостаточно материалов.');
  if(found){found.quantity+=direction*cargo.quantity;if(found.quantity>999999)throw Error('Превышен размер партии.');}
  else if(direction===1)rows.push({...cargo});
  return rows.filter(r=>r.quantity>0);
}
export function snapNode(scene,point){
  const g=sceneGeometry(scene),p=snapToGrid(point.x,point.y,g.grid,g.bounds);
  const r={...p,width:g.grid,height:g.grid},b=g.bounds;
  if(r.x<b.x||r.y<b.y||r.x+r.width>b.x+b.width||r.y+r.height>b.y+b.height)
    throw Error('Месторождение выходит за пределы карты.');
  for(const tile of scene.tiles||[]){
    if(overlaps(r,tile)&&tile.flags?.['project-genesis']?.buildingId)throw Error('Здесь уже находится здание.');
    if(overlaps(r,tile)&&tile.flags?.['project-genesis']?.resourceNodeId)throw Error('На этой клетке уже есть месторождение.');
    if(overlaps(r,tile)&&tile.flags?.['project-genesis']?.networkId)throw Error('Клетка занята инженерной сетью.');
  }
  return r;
}
export function nodeHealth(node,scene){
  if(!scene)return 'missing-scene';
  const tile=scene.tiles?.get?.(node.tileId)||[...(scene.tiles||[])].find(t=>t.id===node.tileId);
  if(!tile)return 'missing-tile';
  if(tile.flags?.['project-genesis']?.resourceNodeId!==node.id||tile.flags?.['project-genesis']?.colonyId!==node.colonyId)return 'foreign-tile';
  const g=sceneGeometry(scene).grid;
  if(Math.abs(tile.x-node.x)>.01||Math.abs(tile.y-node.y)>.01||Math.abs(tile.width-g)>.01||Math.abs(tile.height-g)>.01)return 'moved-tile';
  return 'ok';
}
export function stockFor(state,placementId){return list(state.caches).find(c=>c.placementId===placementId)?.stock||[];}
export function setStock(state,placementId,stock){
  const rows=list(state.caches).filter(c=>c.placementId!==placementId);
  if(stock.length)rows.push({placementId,stock});
  if(rows.length>MAX_CACHES)throw Error('Слишком много складских площадок.');
  return rows;
}
export function pointOf(rect){return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};}
export function nearby(scene,actor,point,max=2){
  const tokens=[...(scene.tokens||[])].filter(t=>t.actorId===actor.id);
  if(!tokens.length)throw Error('Разместите токен персонажа на этой сцене.');
  const g=sceneGeometry(scene).grid;
  const distance=t=>Math.max(0,Math.abs((t.x+(t.width||1)*g/2)-point.x)/g-.5,
    Math.abs((t.y+(t.height||1)*g/2)-point.y)/g-.5);
  // An actor can have multiple linked tokens on the same Scene. Return the
  // nearest eligible one, not an unrelated first token from the collection.
  const closest=tokens.map(t=>({token:t,distance:distance(t)}))
    .sort((a,b)=>a.distance-b.distance)[0];
  if(closest.distance>max)throw Error('Персонаж находится слишком далеко от точки работ.');
  return closest.token;
}
export function formatCargo(item,amount){
  if(!maxInt(amount,MAX_CARGO)||!item||item.type==='container'||amount>Number(item.system.quantity))throw Error('Неверный груз или количество.');
  const code=String(item.system.resourceCode||'').trim().toLowerCase();if(!code)throw Error('Предмету необходим код ресурса.');
  const mass=Number(item.system.unitMass),volume=Number(item.system.unitVolume);
  if(!Number.isFinite(mass)||mass<0||!Number.isFinite(volume)||volume<0)
    throw Error('У груза повреждены масса или объём. Исправьте предмет перед отправкой.');
  return {code,name:String(item.name),type:item.type,img:String(item.img||''),quantity:amount,
    unitMass:mass,unitVolume:volume,
    quality:Number(item.system.quality)||0,techTier:Number(item.system.techTier)||0,description:String(item.system.description||'')};
}
/** One decrement per world-day, including after a failed day rollover/retry. */
export function crewJob(row,worldDay){
  const current=Number(worldDay);
  if(!Number.isSafeInteger(current)||current<1)throw Error('Некорректные игровые сутки.');
  if(Number(row.lastAdvancedDay||0)>=current)return {...row};
  return {...row,remaining:Math.max(0,row.remaining-1),lastAdvancedDay:current};
}

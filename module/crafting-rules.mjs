/** Crafting board constraints. The server revalidates the displayed ingredients. */
export function validateStagedInputs(recipe,staged){
  if(!recipe||!Array.isArray(staged)||staged.length>32)throw Error('Некорректный стол изготовления.');
  const expected=recipe.inputs||{},actual=Object.create(null);
  for(const row of staged){
    if(typeof row?.code!=='string'||!Object.hasOwn(expected,row.code)||
      !Number.isSafeInteger(row.count)||row.count<1||row.count>999999)
      throw Error('На столе есть неподходящий материал или неверное количество.');
    actual[row.code]=(actual[row.code]||0)+row.count;
  }
  for(const [code,count] of Object.entries(expected))if(actual[code]!==count)
    throw Error(`Для крафта нужно ${code} ×${count}; на столе ${actual[code]||0}.`);
  return true;
}
export function craftLoadFits(source,plan,product,limit){
  const total=[...source].reduce((o,item)=>{
    const n=item.type==='container'?1:Number(item.system?.quantity||0),
      mass=Number(item.system?.unitMass??item.system?.tareMass??0),volume=Number(item.system?.unitVolume??item.system?.tareVolume??0);
    o.mass+=n*mass;o.volume+=n*volume;return o;
  },{mass:0,volume:0});
  for(const entry of plan.escrow){total.mass-=entry.count*entry.unitMass;total.volume-=entry.count*entry.unitVolume;}
  const n=Number(product.system.quantity);
  total.mass+=n*Number(product.system.unitMass);total.volume+=n*Number(product.system.unitVolume);
  if(!Number.isFinite(total.mass)||!Number.isFinite(total.volume)||total.mass>limit.mass+1e-6||total.volume>limit.volume+1e-6)
    throw Error('После изготовления в инвентаре не хватит места для результата.');
  return true;
}

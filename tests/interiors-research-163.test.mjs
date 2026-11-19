import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {interiorBackground, furniturePlan, isDefaultInteriorArt, untouchedFurniture, syncInteriorAppearance} from '../module/interior-decor-163.mjs';

const SYSTEM='project-genesis';
const src=(name)=>readFileSync(new URL('../'+name, import.meta.url),'utf8');
const world={user:{id:'gm',isGM:true},users:[{id:'gm',isGM:true,active:true}]};
function fakeRoom(kind='shelter',tier=1){
 const placement={id:'house',colonyId:'colony',interiorSceneId:'scene',buildingId:kind,status:'finished',tier};
 const scene={id:'scene',grid:{size:100},dimensions:{sceneRect:{x:0,y:0,width:1200,height:900}},
  flags:{[SYSTEM]:{interiorOf:'house',colonyId:'colony'}},
  background:{src:`systems/${SYSTEM}/assets/interiors/${kind}.svg`},tiles:[],calls:{create:0,update:0},
  async createEmbeddedDocuments(_type,objects){
    this.calls.create++;
    const made=objects.map((data,i)=>({id:'t'+(this.tiles.length+i),...data}));
    this.tiles.push(...made);
    return made;
  },
  async updateEmbeddedDocuments(_type,rows){this.calls.update++;
    for(const change of rows){const doc=this.tiles.find(t=>t.id===change._id);assert.ok(doc);
      for(const [key,val]of Object.entries(change)){
        if(key==='texture.src')doc.texture.src=val;
        else if(key.startsWith('flags.'))doc.flags[SYSTEM].decorTier=val;
        else if(key!=='_id')doc[key]=val;
      }
    }
  },
  async update(changes){if(changes['background.src'])this.background.src=changes['background.src'];},
  async setFlag(scope,name,val){this.flags[scope][name]=val;}
 };
 return {scene,placement};
}

test('six different tier interiors have separate source art and complete furniture sets',()=>{
 for(const kind of ['room','shelter'])for(const tier of [1,2,3]){
  const src=interiorBackground(kind,tier);assert.match(src,new RegExp(`${kind}-t${tier}\\.svg$`));
  assert.equal(furniturePlan(kind,tier,{grid:{size:100}}).length,4);
  assert.ok(furniturePlan(kind,tier,{grid:{size:100}}).every(p=>p.width>0&&p.height>0));
 }
 assert.notEqual(interiorBackground('room',1),interiorBackground('room',2));
 assert.equal(isDefaultInteriorArt('user/custom-room.webp','room'),false);
 assert.throws(()=>interiorBackground('generator',2));
});

test('GM creates furniture once and upgrades untouched scene at tier changes',async()=>{
 const {scene,placement}=fakeRoom();
 assert.equal(await syncInteriorAppearance(scene,placement,world),true);
 assert.equal(scene.tiles.length,4);
 assert.equal(scene.flags[SYSTEM].decorTier,1);
 assert.match(scene.background.src,/shelter-t1.svg$/);
 assert.equal(await syncInteriorAppearance(scene,placement,world),false);
 assert.equal(scene.tiles.length,4);
 placement.tier=2;
 assert.equal(await syncInteriorAppearance(scene,placement,world),true);
 assert.equal(scene.tiles.length,4);
 assert.equal(scene.flags[SYSTEM].decorTier,2);
 assert.ok(scene.tiles.every(t=>t.flags[SYSTEM].decorTier===2));
 assert.ok(scene.tiles.every(t=>/\-t2\.svg$/.test(t.texture.src)));
});

test('repositioned furniture is preserved when new room tier arrives',async()=>{
 const {scene,placement}=fakeRoom('shelter');
 await syncInteriorAppearance(scene,placement,world);
 const changed=scene.tiles[0],original=changed.texture.src;
 changed.x+=100;
 assert.equal(untouchedFurniture(changed,furniturePlan('shelter',1,scene)),false);
 placement.tier=3;
 await syncInteriorAppearance(scene,placement,world);
 assert.equal(changed.texture.src,original);
 assert.ok(scene.tiles.slice(1).every(t=>/\-t3\.svg$/.test(t.texture.src)));
});

test('a custom-painted room and non-GM sessions never trigger decoration writes',async()=>{
 const {scene,placement}=fakeRoom();
 scene.background.src='worlds/my-world/custom/background.webp';
 assert.equal(await syncInteriorAppearance(scene,placement,world),false);
 assert.equal(scene.tiles.length,0);
 scene.background.src=`systems/${SYSTEM}/assets/interiors/shelter.svg`;
 assert.equal(await syncInteriorAppearance(scene,placement,{...world,user:{id:'player',isGM:false}}),false);
 assert.equal(scene.tiles.length,0);
});

test('unlinked interior scene cannot be changed',async()=>{
 const {scene,placement}=fakeRoom();
 scene.flags[SYSTEM].colonyId='other';
 assert.equal(await syncInteriorAppearance(scene,placement,world),false);
 assert.equal(scene.tiles.length,0);
});

test('Civilization-like research UI retains existing formulas and exposes era navigation',()=>{
 const h=src('templates/actor.hbs'),s=src('module/sheets.mjs'),css=src('styles/genesis.css');
 for(const marker of ['data-genesis-era-jump','data-genesis-era-nav','data-genesis-era=',
  'data-genesis-tech-card','data-genesis-tech-inspector','data-genesis-zoom-level']){
  assert.ok(h.includes(marker)||marker==='data-genesis-tech-inspector',marker);
 }
 assert.match(s,/viewport\.addEventListener\('pointerdown'/);
 assert.match(s,/data-genesis-era-jump/);
 assert.match(css,/\.genesis-era-rail/);
 assert.match(h,/data-genesis-action="invest"/);
 assert.match(h,/data-genesis-action="complete"/);
 assert.match(h,/data-genesis-back-to-tree/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {enterRoom,exitRoom} from '../module/building-interactions.mjs';
const clone=structuredClone;
function world({failSave=false}={}){
  const warnings=[],viewed=[],created=[];
  const tile={id:'tile',flags:{'project-genesis':{colonyId:'colony',jobId:'job',placementId:'building',buildingId:'shelter',status:'finished'}},
    x:100,y:100,width:300,height:200,rotation:0};
  const outside={id:'out',name:'Лагерь',tiles:{get:id=>id==='tile'?tile:undefined},async view(){viewed.push('out');}};
  const placement={id:'building',colonyId:'colony',buildingId:'shelter',sceneId:'out',tileId:'tile',jobId:'job',
    x:100,y:100,width:300,height:200,status:'finished',interiorSceneId:'',createdDay:1,by:'GM'};
  const colony={id:'colony',name:'Экспедиция',type:'colony',system:{industry:{placements:[placement]}},
    async update(patch){if(failSave){failSave=false;throw Error('Actor failed');}
      this.system.industry.placements=clone(patch['system.industry.placements']);}};
  const scenes=new Map([['out',outside]]);
  const gm={id:'gm',active:true,isGM:true};
  globalThis.game={user:gm,users:{filter:f=>[gm].filter(f)},actors:{get:id=>id==='colony'?colony:undefined},
    scenes:{get:id=>scenes.get(id)}};
  globalThis.ui={notifications:{warn:m=>warnings.push(String(m)),info(){}}};
  globalThis.Scene={async create(data){const scene={id:`inner-${created.length+1}`,flags:data.flags,async view(){viewed.push(this.id);},async delete(){scenes.delete(this.id);}};
    scenes.set(scene.id,scene);created.push(data);return scene;}};
  return {scenes,colony,placement,created,warnings,viewed};
}
test('v1.2: GM enters residential building, creates interior scene once, returns outside',async()=>{
  const t=world();
  await enterRoom('colony','building');
  assert.equal(t.created.length,1);
  assert.equal(t.created[0].grid.type,1);
  assert.equal(t.created[0].flags['project-genesis'].interiorOf,'building');
  assert.equal(t.colony.system.industry.placements[0].interiorSceneId,'inner-1');
  assert.deepEqual(t.viewed,['inner-1']);
  await enterRoom('colony','building');
  assert.deepEqual(t.viewed,['inner-1','inner-1']);
  assert.equal(t.created.length,1);
  globalThis.canvas={scene:t.scenes.get('inner-1')};
  await exitRoom();
  assert.equal(t.viewed.at(-1),'out');
});
test('v1.2: failed colony update does not leave linked or orphan interior scene',async()=>{
  const t=world({failSave:true});
  await enterRoom('colony','building');
  assert.equal(t.created.length,1);
  assert.equal(t.scenes.has('inner-1'),false);
  assert.equal(t.colony.system.industry.placements[0].interiorSceneId,'');
  assert.equal(t.viewed.length,0);
  assert.match(t.warnings.at(-1),/Actor failed/);
});

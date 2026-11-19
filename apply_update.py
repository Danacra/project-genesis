#!/usr/bin/env python3
"""PROJECT GENESIS 1.6.3 -> 1.6.4 offline, version-guarded installer.

Changes ONLY files in systems/project-genesis. Never opens or writes world data.
The previous files are backed up before replacing any source file.
"""
from __future__ import annotations
import argparse
from datetime import datetime
import json
from pathlib import Path
import sys
import zipfile

HERE=Path(__file__).resolve().parent
START='1.6.3'
END='1.6.4'

def one(text:str,old:str,new:str,where:str)->str:
    matches=text.count(old)
    if matches!=1:raise ValueError(f'{where}: ожидается одно вхождение, найдено {matches}. Система не изменена.')
    return text.replace(old,new,1)

def patch_genesis(s:str)->str:
    s=one(s,"import {upgradeDefaultBuildingTiles} from './module/building-roof.mjs';",
      "import {upgradeDefaultBuildingTiles} from './module/building-roof.mjs';\nimport {initializeWorldClock} from './module/world-clock-164.mjs';",'Clock boot import')
    s=one(s,"  game.settings.register(ID,'worldDay',{name:'День экспедиции',scope:'world',config:false,type:Number,default:1});",
      "  game.settings.register(ID,'worldDay',{name:'День экспедиции',scope:'world',config:false,type:Number,default:1});\n  game.settings.register(ID,'worldClock',{name:'Время экспедиции',scope:'world',config:false,type:Object,default:{minute:480,speed:1,paused:false,pending:null,pulse:0}});",'Clock settings registration')
    s=one(s,'  initializeInteriorAppearance();', '  initializeInteriorAppearance();\n  initializeWorldClock();','Clock start')
    return s

def patch_logistics(s:str)->str:
    # The clock may start while initializeLogistics is replaying a pending day.
    # The guard MUST execute inside the existing global world lock.
    s=one(s,'export async function advanceDay() {',
          'export async function advanceDay(expectedDay=null) {','Expected-day transition argument')
    s=one(s,"    return await withWorldLock(async()=>{\n      let plan=game.settings.get(SYSTEM,'dayOperation');",
      "    return await withWorldLock(async()=>{\n      if(expectedDay!==null){\n        const actual=game.settings.get(SYSTEM,'worldDay');\n        if(actual===expectedDay+1)return {day:actual,alreadyAdvanced:true};\n        if(actual!==expectedDay)throw Error('Игровые сутки изменились во время перехода.');\n      }\n      let plan=game.settings.get(SYSTEM,'dayOperation');",
      'Expected-day check under world lock')
    return s

def patch_sheets(s:str)->str:
    s=one(s,"import {libraryContext} from './library.mjs';",
      "import {libraryContext} from './library.mjs';\nimport {clockContext,setClockPaused,setClockSpeed,advanceOneHour,manualAdvanceDay,renderClockWidgets} from './world-clock-164.mjs';\nimport {specializationProfile} from './clock-rules-164.mjs';",'Sheet clock/specializations import')
    s=one(s,'return {...ctx,actor,isColony,isSurvivor,editable:actor.isOwner,isGM:game.user.isGM,',
      'return {...ctx,actor,isColony,isSurvivor,editable:actor.isOwner,isGM:game.user.isGM,\n      clock:clockContext(),specialization:specializationProfile(actor.system),', 'Sheet computed context')
    s=one(s,"      const quickNav=event.target.closest?.('[data-genesis-quick-nav]');",
      """      const clockSpeed=event.target.closest?.('[data-genesis-clock-speed]');
      if(clockSpeed){
        if(!game.user.isGM)return;
        void setClockSpeed(Number(clockSpeed.value)).then(renderClockWidgets)
          .catch(error=>ui.notifications.error(error.message));
        return;
      }
      const quickNav=event.target.closest?.('[data-genesis-quick-nav]');""",'Clock speed change')
    # 1.6.1 adds pinned-sidebar handling at the front of the delegated click handler.
    s=one(s,"      const toggle=event.target.closest?.('[data-genesis-sidebar-toggle]');",
      """      const clockToggle=event.target.closest?.('[data-genesis-clock-toggle]');
      if(clockToggle&&game.user.isGM){
        await setClockPaused(!clockContext().paused).then(renderClockWidgets)
          .catch(error=>ui.notifications.error(error.message));
        return;
      }
      const clockHour=event.target.closest?.('[data-genesis-clock-hour]');
      if(clockHour&&game.user.isGM){
        await advanceOneHour().then(renderClockWidgets)
          .catch(error=>ui.notifications.error(error.message));
        return;
      }
      const toggle=event.target.closest?.('[data-genesis-sidebar-toggle]');""",'Clock buttons')
    s=one(s,"else if(action==='day'&&game.user.isGM)await advanceDay();",
      "else if(action==='day'&&game.user.isGM)await manualAdvanceDay().catch(error=>ui.notifications.error(error.message));",
      'Serialize manual day with automatic midnight')
    return s

def patch_template(s:str)->str:
    s=one(s,'Карточка выжившего · {{actor.system.specialization}}',
      'Карточка выжившего · {{specialization.name}}', 'Auto specialization header')
    old='<div class="genesis-day"><span>ДЕНЬ</span><strong>{{worldDay}}</strong>{{#if isGM}}<button type="button" data-genesis-action="day" title="Потратить запасы и перейти к следующим суткам">+1 сутки</button>{{/if}}</div>'
    new='''<div class="genesis-day genesis-clock-panel" data-genesis-clock>
      <span class="genesis-clock-caption">ДЕНЬ <b data-genesis-clock-day>{{worldDay}}</b></span>
      <strong data-genesis-clock-time>{{clock.time}}</strong>
      <small data-genesis-clock-state>{{#if clock.paused}}Пауза{{else}}Ход времени · ×{{clock.speed}}{{/if}}</small>
      {{#if clock.canControl}}<div class="genesis-clock-controls" aria-label="Управление игровыми часами">
        <button type="button" data-genesis-clock-toggle aria-pressed="{{#unless clock.paused}}true{{else}}false{{/unless}}">{{#if clock.paused}}▶ Пуск{{else}}❚❚ Пауза{{/if}}</button>
        <label>Скорость<select data-genesis-clock-speed aria-label="Скорость игровых часов">{{#each clock.choices}}<option value="{{value}}" {{#if selected}}selected{{/if}}>{{name}}</option>{{/each}}</select></label>
        <button type="button" data-genesis-clock-hour title="Перейти на один игровой час вперёд">+1 ч</button>
        <button type="button" data-genesis-action="day" title="Ручной переход суток и списание запасов">+1 день</button>
      </div>{{/if}}
    </div>'''
    s=one(s,old,new,'Clock display and GM controls')
    s=one(s,'{{#if isSurvivor}}<div class="genesis-panel"><h2>Отдых и восстановление</h2>',
      '''{{#if isSurvivor}}<div class="genesis-panel genesis-specialization-panel">
        <h2>Специализация персонажа</h2>
        <div class="genesis-specialization-status"><span>{{#if specialization.hasSpecialization}}ТЕКУЩАЯ СПЕЦИАЛИЗАЦИЯ{{else}}СПЕЦИАЛИЗАЦИЯ ЕЩЁ НЕ ПОЛУЧЕНА{{/if}}</span><strong>{{specialization.name}}</strong></div>
        <p class="genesis-muted">Определяется автоматически: основная характеристика не ниже 6, профильный навык не ниже 4. Пока специализации только информационные — бонусы появятся в будущих обновлениях.</p>
        <div class="genesis-specialization-grid">{{#each specialization.all}}
          <article class="genesis-specialization-item {{#if ready}}is-ready{{/if}}">
            <div><strong>{{name}}{{#if ready}} · ✓{{/if}}</strong><small>{{abilityName}} {{ability}}/6 · {{skillName}} {{skill}}/4</small></div>
            <progress max="100" value="{{progress}}" aria-label="Прогресс специализации {{name}}"></progress>
            <p>{{future}}</p>
          </article>{{/each}}</div>
      </div>
      <div class="genesis-panel"><h2>Отдых и восстановление</h2>''','Specialization overview')
    s=one(s,
      '<div class="genesis-panel"><h2>Профиль</h2><div class="genesis-form-grid"><label>Специализация<input data-genesis-field="specialization" value="{{actor.system.specialization}}" {{#unless editable}}disabled{{/unless}}></label></div>',
      '<div class="genesis-panel"><h2>Профиль</h2><div class="genesis-profile-specialization"><span>Автоматическая специализация</span><strong>{{specialization.name}}</strong><small>Повышайте характеристики и навыки, чтобы открыть профиль. Записанное ранее значение сохраняется в данных персонажа.</small></div>',
      'Replace old manually edited specialization field')
    return s

CSS=r'''
/* PROJECT GENESIS 1.6.4: world clock and specialization preview. */
.genesis .genesis-clock-panel{min-width:150px;max-width:270px;align-self:stretch;
 display:flex;flex-direction:column;gap:5px;justify-content:center;padding:3px 0 3px 14px;
 border-left:1px solid #405663;white-space:normal;text-align:center;flex:0 1 220px;}
.genesis .genesis-clock-caption{font-size:10px;letter-spacing:.12em;color:#a8bcc8;}
.genesis .genesis-clock-caption b{font-weight:800;color:#d9a66f;}
.genesis .genesis-clock-panel strong[data-genesis-clock-time]{font-family:ui-monospace,Consolas,monospace;
 font-size:27px;color:#48c8b6!important;font-weight:800;letter-spacing:.02em;font-variant-numeric:tabular-nums;}
.genesis .genesis-clock-panel [data-genesis-clock-state]{font-size:10px;color:#b0c6ce;}
.genesis .genesis-clock-controls{display:grid;grid-template-columns:auto minmax(74px,1fr) auto;
 align-items:end;gap:5px;margin-top:6px;}
.genesis .genesis-clock-controls button{min-width:0;font-size:11px!important;padding:5px 7px!important;
 white-space:nowrap;min-height:27px;}
.genesis .genesis-clock-controls [data-genesis-action="day"]{grid-column:1/-1;}
.genesis .genesis-clock-controls label{margin:0;text-align:left;font-size:9px;min-width:0;}
.genesis .genesis-clock-controls select{width:100%;padding:2px 5px!important;min-height:27px!important;
 font-size:11px;}
.genesis .genesis-specialization-panel{border-color:#35656c;}
.genesis .genesis-specialization-status{display:flex;align-items:center;flex-wrap:wrap;gap:9px;
 border-bottom:1px solid #3a5460;padding:0 0 12px;margin-bottom:12px;}
.genesis .genesis-specialization-status span{font-size:10px;letter-spacing:.09em;color:#aac1c8;}
.genesis .genesis-specialization-status strong{font-size:18px;color:#53d0ba;}
.genesis .genesis-specialization-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;}
.genesis .genesis-specialization-item{padding:12px;border:1px solid #354d5c;border-radius:8px;
 background:#172733;display:grid;gap:7px;min-width:0;}
.genesis .genesis-specialization-item.is-ready{border-color:#348d7e;background:linear-gradient(130deg,#1b3b40,#1d2c37);}
.genesis .genesis-specialization-item strong{color:#e5f2f2;font-size:13px;}
.genesis .genesis-specialization-item small{display:block;margin-top:5px;font-size:11px;color:#a8c0c9;}
.genesis .genesis-specialization-item p{font-size:11px;line-height:1.48;color:#a2b7c2;margin:0;}
.genesis .genesis-specialization-item progress{width:100%;height:7px;accent-color:#4fc4ae;}
.genesis .genesis-profile-specialization{display:grid;gap:5px;margin:0 0 15px;
 border-left:3px solid #4fc4ae;background:#162b35;border-radius:5px;padding:9px 12px;}
.genesis .genesis-profile-specialization span{font-size:11px;color:#a8bdc7;}
.genesis .genesis-profile-specialization strong{font-size:16px;color:#4fc4ae;}
.genesis .genesis-profile-specialization small{font-size:11px;color:#a3bbc6;}
@media(max-width:940px){.genesis .genesis-clock-panel{max-width:200px;flex-basis:180px;}
 .genesis .genesis-clock-panel strong[data-genesis-clock-time]{font-size:22px;}}
@media(max-width:700px){.genesis .genesis-specialization-grid{grid-template-columns:minmax(0,1fr);}
 .genesis .genesis-clock-panel{max-width:none;flex:1 1 100%;border-left:0;border-top:1px solid #3b5864;
 padding-top:10px;}
 .genesis .genesis-clock-controls{grid-template-columns:auto minmax(76px,1fr) auto;}}
@media(prefers-reduced-motion:reduce){.genesis .genesis-specialization-item{transition:none!important;}}
'''

CHANGELOG='''## v1.6.4 — World Clock & Character Specializations (2026-11-19)

- Внутриигровые часы (начало 08:00), пауза/пуск, скорости x1/x5/x10/x60 в игровых минутах на реальную минуту. Только активный ведущий-лидер управляет ходом времени; при закрытом мире время не догоняется.
- Кнопка «+1 час» и прежний ручной «+1 день» остаются доступными ведущему. Часы синхронизируются через настройку мира и обновляют открытые листы без полного рендера.
- При наступлении полуночи используется существующая защищённая операция перехода суток: еда, вода, производство, задания и погода применяются как раньше. Незавершённый переход сохраняется в `worldClock.pending`, предотвращая повторную обработку после сбоя.
- Шесть автоматически вычисляемых специализаций: Медик, Инженер, Учёный, Мастер, Разведчик, Выживальщик. Порог — характеристика 6 и профильный навык 4. Указаны будущие функции, но механических бонусов пока нет.
- Старое поле `system.specialization` остаётся в сохранениях, без принудительной миграции. Персонажи, предметы, расположение зданий и исследованные технологии не изменяются установщиком.
- Внутриигровые часы отображаются по минутам. Старые очереди остаются суточными, но переход суток происходит автоматически по игровым часам; почасовой баланс работ требует отдельной переработки.
- Требуется ручное тестирование в Foundry v13; релиз пока распространяется локальным патчем.

'''

def patch_changelog(s):
    if s.startswith('## v1.6.4'):raise ValueError('История версии 1.6.4 уже присутствует.')
    return CHANGELOG+s

def patch_startup_test(s):
    old="assert.deepEqual(registered,[['project-genesis','worldDay'],['project-genesis','logisticsJournal'],['project-genesis','dayOperation'],['project-genesis','missionOperation']]);"
    new="assert.deepEqual(registered,[['project-genesis','worldDay'],['project-genesis','worldClock'],['project-genesis','logisticsJournal'],['project-genesis','dayOperation'],['project-genesis','missionOperation']]);"
    return one(s,old,new,'Update existing startup test')

def changes_for(root:Path)->dict[Path,bytes]:
    manifest=root/'system.json'
    if not manifest.is_file():raise ValueError('Выберите папку systems/project-genesis с system.json.')
    obj=json.loads(manifest.read_text(encoding='utf-8'))
    if obj.get('id')!='project-genesis':raise ValueError('Это не папка игровой системы PROJECT GENESIS.')
    if obj.get('version')!=START:raise ValueError(f'Нужна версия {START}; обнаружена {obj.get("version")}. Файлы не изменены.')
    transforms={'genesis.mjs':patch_genesis,'module/logistics.mjs':patch_logistics,'module/sheets.mjs':patch_sheets,
      'templates/actor.hbs':patch_template,'CHANGELOG.md':patch_changelog,
      'tests/startup.test.mjs':patch_startup_test}
    changes={}
    for name,transform in transforms.items():
        path=root/name
        if not path.is_file():raise ValueError(f'Не найден обязательный файл: {name}. Ничего не изменено.')
        changes[path]=transform(path.read_text(encoding='utf-8')).encode('utf-8')
    style=root/'styles/genesis.css'
    if not style.is_file():raise ValueError('Не найден файл styles/genesis.css.')
    css=style.read_text(encoding='utf-8')
    if 'PROJECT GENESIS 1.6.4: world clock' in css:raise ValueError('Стили 1.6.4 уже установлены.')
    changes[style]=(css+'\n'+CSS).encode('utf-8')
    obj['version']=END
    # Previous local versions deliberately do not claim to be a published GitHub Release.
    obj.pop('download',None)
    obj.pop('manifest',None)
    changes[manifest]=(json.dumps(obj,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
    for path in sorted((HERE/'payload').rglob('*')):
        if not path.is_file():continue
        dest=root/path.relative_to(HERE/'payload')
        if dest.exists() and dest not in changes:
            raise ValueError(f'Нельзя перезаписать существующий пользовательский файл: {dest.relative_to(root)}')
        changes[dest]=path.read_bytes()
    changes[root/'TESTING_1.6.4_RU.md']=(HERE/'TESTING_1.6.4_RU.md').read_bytes()
    return changes

def main()->int:
    parser=argparse.ArgumentParser(description='PROJECT GENESIS 1.6.3 -> 1.6.4')
    parser.add_argument('system_dir',nargs='?',help='Папка FoundryVTT/Data/systems/project-genesis')
    parser.add_argument('--check',action='store_true',help='Только проверить совместимость; файлы не менять')
    args=parser.parse_args()
    raw=args.system_dir or input('Путь к Data/systems/project-genesis: ').strip().strip('"')
    root=Path(raw).expanduser().resolve()
    if not root.is_dir():raise ValueError(f'Папка не найдена: {root}')
    changes=changes_for(root) # ALL checks before creating a backup or any writes.
    if args.check:
        print(f'Проверено {len(changes)} файлов, установка возможна. Ничего не изменено.')
        return 0
    stamp=datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    backup=root.parent/f'project-genesis-backup-before-164-{stamp}.zip'
    with zipfile.ZipFile(backup,'w',zipfile.ZIP_DEFLATED) as archive:
        for path in changes:
            if path.exists():archive.write(path,path.relative_to(root).as_posix())
    completed=[]
    try:
        for path,data in changes.items():
            path.parent.mkdir(parents=True,exist_ok=True)
            temporary=path.with_name(path.name+'.164.tmp')
            temporary.write_bytes(data)
            temporary.replace(path)
            completed.append(path)
    except Exception:
        with zipfile.ZipFile(backup,'r') as archive:
            saved=set(archive.namelist())
            for dest in reversed(completed):
                relative=dest.relative_to(root).as_posix()
                if relative in saved:dest.write_bytes(archive.read(relative))
                else:dest.unlink(missing_ok=True)
        raise
    print(f'PROJECT GENESIS 1.6.4 установлен. Резервная копия: {backup}')
    print('Перезапустите Foundry и проведите TESTING_1.6.4_RU.md. Миры установщиком не изменялись.')
    return 0

if __name__=='__main__':
    try:sys.exit(main())
    except (ValueError,OSError,UnicodeError) as err:
        print('ОШИБКА:',err,file=sys.stderr)
        sys.exit(1)

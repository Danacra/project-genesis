/** PROJECT GENESIS 1.6.4 — single-GM-authoritative running world clock.
 * Game settings, unlike wall timestamps, do not accumulate time while the world is closed.
 * Daily consumption, queues and weather STILL use the existing durable advanceDay operation.
 */
import {advanceDay} from './logistics.mjs';
import {CLOCK_SPEEDS,INITIAL_CLOCK,normalizeClock,simulateClockStep,clockDisplay} from './clock-rules-164.mjs';
const SYSTEM='project-genesis';
let clockQueue=Promise.resolve();
let clockTimer=null,viewTimer=null,lastTick=0,initialized=false,stepping=false;
const leader=()=>game.users?.filter?.(u=>u.active&&u.isGM)?.sort?.((a,b)=>a.id.localeCompare(b.id))?.[0]||null;
const canDrive=()=>Boolean(game.user?.isGM&&leader()?.id===game.user.id);
const read=()=>normalizeClock(game.settings.get(SYSTEM,'worldClock'));
const enqueue=fn=>{const step=clockQueue.then(fn,fn);clockQueue=step.catch(()=>{});return step;};
function notifyError(error){
  console.error('PROJECT GENESIS clock:',error);
  ui.notifications?.warn?.('Игровые часы: '+(error?.message||'ошибка синхронизации'));
}
/** A pending midnight marker is written BEFORE the day transition. On reconnect,
 * a committed worldDay will never be processed a second time. */
async function settleMidnight(state){
  const pending=state.pending;
  if(!pending)return state;
  const day=Number(game.settings.get(SYSTEM,'worldDay'));
  if(day===pending.day){
    if(pending.failed)return state; // GM must repair/resume the failed day operation.
    const result=await advanceDay(pending.day); // Expected-day guard prevents duplicate journal recovery.
    if(result?.ok===false){
      const failed={...state,paused:true,pending:{...pending,failed:true},pulse:Date.now()};
      await game.settings.set(SYSTEM,'worldClock',failed);
      return failed;
    }
  }else if(day!==pending.day+1){
    throw Error('Номер суток изменился неожиданно. Приостановите время и проверьте журнал.');
  }
  if(Number(game.settings.get(SYSTEM,'worldDay'))!==pending.day+1)
    throw Error('Переход игровых суток не подтверждён.');
  const final={...state,minute:pending.nextMinute,pending:null,pulse:Date.now()};
  await game.settings.set(SYSTEM,'worldClock',final);
  return final;
}
async function tick(){
  const now=Date.now();
  if(!lastTick){lastTick=now;return;}
  const elapsed=Math.max(0,Math.min(now-lastTick,15000));lastTick=now;
  if(!canDrive()||stepping)return;
  stepping=true;
  try{await enqueue(async()=>{
    let state=read();
    if(state.pending){await settleMidnight(state);return;}
    if(state.paused)return;
    const next=simulateClockStep(state,elapsed);
    if(!next.days){
      await game.settings.set(SYSTEM,'worldClock',{...state,minute:next.minute,pulse:Date.now()});
      return;
    }
    if(next.days!==1)throw Error('Слишком большой шаг часов.');
    const day=Number(game.settings.get(SYSTEM,'worldDay'));
    const prepared={...state,pulse:Date.now(),pending:{day,nextMinute:next.minute,failed:false}};
    await game.settings.set(SYSTEM,'worldClock',prepared);
    await settleMidnight(prepared);
  }).catch(notifyError);}finally{stepping=false;}
}
export async function setClockPaused(paused){
  if(!canDrive())throw Error('Управлять временем может только ведущий, управляющий миром.');
  return enqueue(async()=>{
    const state=read();
    if(state.pending){
      if(state.pending.failed)throw Error('Сначала завершите переход суток кнопкой «+1 сутки».');
      await settleMidnight(state);
    }
    const fresh=read();
    await game.settings.set(SYSTEM,'worldClock',{...fresh,paused:!!paused,pulse:Date.now()});
    lastTick=Date.now();
  });
}
export async function setClockSpeed(speed){
  if(!canDrive())throw Error('Менять скорость времени может только ведущий.');
  if(!CLOCK_SPEEDS.includes(Number(speed)))throw Error('Неизвестная скорость времени.');
  return enqueue(async()=>{
    const state=read();
    await game.settings.set(SYSTEM,'worldClock',{...state,speed:Number(speed),pulse:Date.now()});
    lastTick=Date.now();
  });
}
/** Manual full-day step shares the same operation queue with automatic midnight. */
export async function manualAdvanceDay(){
  if(!canDrive())throw Error('Переводить сутки может только ведущий-лидер.');
  return enqueue(async()=>{
    const state=read();
    if(state.pending){
      const resumed=state.pending.failed?{...state,pending:{...state.pending,failed:false}}:state;
      if(state.pending.failed)await game.settings.set(SYSTEM,'worldClock',resumed);
      return settleMidnight(resumed);
    }
    const result=await advanceDay();
    if(result?.ok===false)throw Error(result.error||'Ошибка перехода суток.');
    lastTick=Date.now();
    return result;
  });
}
export async function advanceOneHour(){
  if(!canDrive())throw Error('Перемещать часы может только ведущий.');
  return enqueue(async()=>{
    const state=read();
    if(state.pending)throw Error('Сначала завершите переход суток.');
    const minute=state.minute+60;
    if(minute<1440){await game.settings.set(SYSTEM,'worldClock',{...state,minute,pulse:Date.now()});return;}
    const day=Number(game.settings.get(SYSTEM,'worldDay'));
    const prepared={...state,pending:{day,nextMinute:minute-1440,failed:false},pulse:Date.now()};
    await game.settings.set(SYSTEM,'worldClock',prepared);
    await settleMidnight(prepared);
  });
}
export function clockContext(){
  const state=read();
  return {time:clockDisplay(state.minute),speed:state.speed,paused:state.paused,
    running:!state.paused&&!!leader(),pending:!!state.pending,canControl:canDrive(),
    choices:CLOCK_SPEEDS.map(speed=>({value:speed,name:`×${speed}`,selected:speed===state.speed}))};
}
/** Update visible sheets without rerendering the sheet or losing input focus. */
export function renderClockWidgets(){
  if(!globalThis.document?.querySelectorAll)return;
  const state=read();
  const live=!!leader()&&!state.paused&&!state.pending;
  const elapsed=live?Math.max(0,Math.min(Date.now()-state.pulse,11000)):0;
  // Display-only interpolation is capped and never commits gameplay effects.
  const projected=state.minute+elapsed*state.speed/60000;
  const label=clockDisplay(Math.min(1439.9999,projected));
  const day=Number(game.settings.get(SYSTEM,'worldDay'));
  for(const root of document.querySelectorAll('[data-genesis-clock]')){
    const time=root.querySelector('[data-genesis-clock-time]');if(time&&time.textContent!==label)time.textContent=label;
    const dayLabel=root.querySelector('[data-genesis-clock-day]');if(dayLabel)dayLabel.textContent=String(day);
    const status=root.querySelector('[data-genesis-clock-state]');
    if(status)status.textContent=state.pending?'Переход суток':live?`Ход времени · ×${state.speed}`:state.paused?'Пауза':'Нет активного мастера';
    const toggle=root.querySelector('[data-genesis-clock-toggle]');
    if(toggle){toggle.textContent=state.paused?'▶ Пуск':'❚❚ Пауза';toggle.setAttribute('aria-pressed',String(!state.paused));}
    const select=root.querySelector('[data-genesis-clock-speed]');
    if(select&&select!==document.activeElement&&String(select.value)!==String(state.speed))select.value=String(state.speed);
  }
}
export function initializeWorldClock(){
  if(initialized||!globalThis.document?.querySelectorAll||!game.settings?.get||!game.settings?.set)return;
  initialized=true;lastTick=Date.now();
  clockTimer=setInterval(()=>void tick(),10000);
  viewTimer=setInterval(renderClockWidgets,1000);
  // Only the active lead GM can recover a pending midnight, never regular players.
  if(canDrive()&&read().pending)void enqueue(()=>settleMidnight(read())).catch(notifyError);
  renderClockWidgets();
}
export {CLOCK_SPEEDS,INITIAL_CLOCK};

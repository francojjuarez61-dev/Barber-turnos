/* Turnos Barbería (PWA) - JS puro */

const STORAGE_KEY = 'barber_turnos_v1';

const SERVICES = {
  corte: {
    label: 'Corte',
    type: 'fg',
    minutes: (speed) => ({ rapido: 20, normal: 30, lento: 40 }[speed] ?? 30),
  },
  corte_barba: {
    label: 'Corte + Barba',
    type: 'fg',
    // En el brief: 45–47 normal. Ajustado a 46.
    minutes: (speed) => ({ rapido: 40, normal: 46, lento: 55 }[speed] ?? 46),
  },
  corte_sellado: {
    label: 'Corte + Sellado',
    type: 'fg',
    minutes: (speed) => ({ rapido: 55, normal: 60, lento: 70 }[speed] ?? 60),
  },
  color: {
    label: 'Color',
    type: 'bg',
    minutes: () => 170,
  },
  permanente: {
    label: 'Permanente',
    type: 'bg',
    minutes: () => 160,
  },
};

const SHIFT_RULES = {
  morning: { start: { h: 9, m: 30 }, end: { h: 13, m: 0 }, label: 'Mañana 09:30–13:00' },
  afternoon: { start: { h: 17, m: 30 }, end: { h: 22, m: 0 }, label: 'Tarde 17:30–22:00' },
};

const WARNING_MINUTES = 5; // amarillo si termina en <= +5 min

const $ = (id) => document.getElementById(id);

const els = {
  app: $('app'),
  shiftInfo: $('shiftInfo'),
  statusLine: $('statusLine'),
  nowTime: $('nowTime'),
  projEnd: $('projEnd'),
  shiftEnd: $('shiftEnd'),
  chipColor: $('chipColor'),
  finishBtn: $('finishBtn'),
  addClientBtn: $('addClientBtn'),
  resetBtn: $('resetBtn'),
  activeCard: $('activeCard'),
  queueList: $('queueList'),
  queueSub: $('queueSub'),
  bgList: $('bgList'),
  fab: $('fab'),
  overlay: $('radialOverlay'),
  close: $('radialClose'),
  toast: $('toast'),
};

let state = loadState();

// UI state for radial
let radialMode = 'start'; // 'start' | 'queue'
let selectedSpeed = 'normal';

function defaultState(){
  return {
    active: null, // { id, serviceKey, speed, plannedMinutes, startedAt, kind:'fg' }
    queue: [],   // array of items { id, serviceKey, speed, plannedMinutes, addedAt }
    bg: [],      // array of bg tasks { id, serviceKey, plannedMinutes, startedAt }
    lastUpdatedAt: Date.now(),
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
  }catch{
    return defaultState();
  }
}

function saveState(){
  state.lastUpdatedAt = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uuid(){
  return Math.random().toString(16).slice(2) + '-' + Date.now().toString(16);
}

function pad(n){ return String(n).padStart(2,'0'); }

function toHM(ts){
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function minutes(ms){ return Math.round(ms/60000); }

function dayKey(d=new Date()){
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function atToday(h,m){
  const d = new Date();
  d.setHours(h,m,0,0);
  return d.getTime();
}

function getCurrentShift(now=Date.now()){
  const mStart = atToday(SHIFT_RULES.morning.start.h, SHIFT_RULES.morning.start.m);
  const mEnd = atToday(SHIFT_RULES.morning.end.h, SHIFT_RULES.morning.end.m);
  const aStart = atToday(SHIFT_RULES.afternoon.start.h, SHIFT_RULES.afternoon.start.m);
  const aEnd = atToday(SHIFT_RULES.afternoon.end.h, SHIFT_RULES.afternoon.end.m);

  if(now >= mStart && now < mEnd) return { key:'morning', ...SHIFT_RULES.morning, startTs:mStart, endTs:mEnd };
  if(now >= aStart && now < aEnd) return { key:'afternoon', ...SHIFT_RULES.afternoon, startTs:aStart, endTs:aEnd };

  // fuera de turno: elegimos el próximo turno (para planificar)
  if(now < mStart) return { key:'morning', ...SHIFT_RULES.morning, startTs:mStart, endTs:mEnd, upcoming:true };
  if(now >= mEnd && now < aStart) return { key:'afternoon', ...SHIFT_RULES.afternoon, startTs:aStart, endTs:aEnd, upcoming:true };

  // después de 22:00: próximo turno mañana (día siguiente)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate()+1);
  tomorrow.setHours(SHIFT_RULES.morning.start.h, SHIFT_RULES.morning.start.m, 0, 0);
  const tStart = tomorrow.getTime();
  const tEnd = tStart + ( (SHIFT_RULES.morning.end.h*60+SHIFT_RULES.morning.end.m) - (SHIFT_RULES.morning.start.h*60+SHIFT_RULES.morning.start.m) )*60000;
  return { key:'morning', ...SHIFT_RULES.morning, startTs:tStart, endTs:tEnd, upcoming:true, label:'Mañana (próximo día) 09:30–13:00' };
}

function plannedMinutes(serviceKey, speed){
  const svc = SERVICES[serviceKey];
  if(!svc) return 0;
  return svc.minutes(speed);
}

function getNowBase(shift){
  // Si estamos fuera del turno, planificamos desde el inicio del próximo turno.
  const now = Date.now();
  return shift.upcoming ? shift.startTs : now;
}

function computeProjection(){
  const shift = getCurrentShift();
  const base = getNowBase(shift);

  // Foreground timeline
  let seqEnd = base;

  if(state.active && state.active.kind === 'fg'){
    // si ya empezó, la proyección se basa en "ahora"; no intentamos descontar elapsed para no ser "generosos".
    // PERO cuando finaliza, se recalcula por el real.
    seqEnd = base + (state.active.plannedMinutes * 60000);
  }

  for(const item of state.queue){
    seqEnd += item.plannedMinutes * 60000;
  }

  // Background latest end
  let bgEnd = base;
  for(const b of state.bg){
    const bStarted = b.startedAt ?? base;
    const bPlannedEnd = bStarted + b.plannedMinutes*60000;
    if(bPlannedEnd > bgEnd) bgEnd = bPlannedEnd;
  }

  const projectedEnd = Math.max(seqEnd, bgEnd);

  // status color
  const diffMin = minutes(projectedEnd - shift.endTs);
  let level = 'green';
  if(projectedEnd <= shift.endTs) level = 'green';
  else if(diffMin <= WARNING_MINUTES) level = 'yellow';
  else level = 'red';

  return { shift, base, projectedEnd, level, diffMin };
}

function render(){
  const now = Date.now();
  const proj = computeProjection();

  els.shiftInfo.textContent = proj.shift.label + (proj.shift.upcoming ? ' (fuera de turno)' : '');
  els.nowTime.textContent = toHM(now);
  els.projEnd.textContent = toHM(proj.projectedEnd);
  els.shiftEnd.textContent = toHM(proj.shift.endTs);

  // Status line
  if(proj.level === 'green'){
    els.statusLine.textContent = 'Todo entra dentro del horario.';
    els.chipColor.textContent = '🟢 Normal';
  }else if(proj.level === 'yellow'){
    els.statusLine.textContent = `Al límite: te pasás por ~${proj.diffMin} min.`;
    els.chipColor.textContent = '🟡 Advertencia';
  }else{
    els.statusLine.textContent = `Crítico: te pasás por ~${proj.diffMin} min.`;
    els.chipColor.textContent = '🔴 Crítico';
  }

  // Background state class with smooth transitions
  els.app.classList.remove('state-green','state-yellow','state-red');
  els.app.classList.add(`state-${proj.level}`);

  // Active card
  renderActive(now);
  renderQueue(now);
  renderBg(now);

  els.finishBtn.disabled = !state.active;
}

function renderActive(now){
  const a = state.active;
  if(!a){
    els.activeCard.classList.add('empty');
    els.activeCard.innerHTML = `<div class="muted">Sin servicio en curso.</div>`;
    return;
  }

  els.activeCard.classList.remove('empty');

  const svc = SERVICES[a.serviceKey];
  const started = toHM(a.startedAt);
  const plannedEnd = toHM(a.startedAt + a.plannedMinutes*60000);

  const kindTag = a.kind === 'bg' ? 'Paralelo' : 'En curso';
  const speedTag = a.kind === 'bg' ? '—' : (a.speed === 'rapido' ? 'Rápido' : a.speed === 'lento' ? 'Lento' : 'Normal');

  els.activeCard.innerHTML = `
    <div class="row">
      <div>
        <div class="main">${svc?.label ?? 'Servicio'}</div>
        <div class="sub">Inicio ${started} · Proyección ${plannedEnd} · ${a.plannedMinutes} min</div>
      </div>
      <div class="meta">
        <span class="tag">${kindTag}</span>
        <span class="tag">${speedTag}</span>
      </div>
    </div>
  `;
}

function renderQueue(now){
  els.queueList.innerHTML = '';
  els.queueSub.textContent = `${state.queue.length} en espera`;

  if(state.queue.length === 0){
    els.queueList.innerHTML = `<div class="item"><div class="muted">No hay nadie en espera.</div></div>`;
    return;
  }

  // Para ETA: calculamos secuencial desde base (ahora o inicio del turno)
  const proj = computeProjection();
  let cursor = proj.base;
  if(state.active && state.active.kind === 'fg'){
    cursor = proj.base + state.active.plannedMinutes*60000;
  }

  state.queue.forEach((q, idx) => {
    const svc = SERVICES[q.serviceKey];
    const etaStart = cursor;
    const etaEnd = cursor + q.plannedMinutes*60000;
    cursor = etaEnd;

    const speedLabel = q.speed === 'rapido' ? 'Rápido' : q.speed === 'lento' ? 'Lento' : 'Normal';

    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div class="row">
        <div>
          <div class="main">${idx+1}. ${svc?.label ?? 'Servicio'}</div>
          <div class="sub">${speedLabel} · ${q.plannedMinutes} min · ETA ${toHM(etaEnd)}</div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="smallBtn" data-act="up" data-id="${q.id}" title="Subir">↑</button>
          <button class="smallBtn" data-act="down" data-id="${q.id}" title="Bajar">↓</button>
          <button class="smallBtn" data-act="del" data-id="${q.id}" title="Quitar">✕</button>
        </div>
      </div>
      <div class="meta">
        <span class="tag">Inicio est. ${toHM(etaStart)}</span>
        <span class="tag">Fin est. ${toHM(etaEnd)}</span>
      </div>
    `;

    els.queueList.appendChild(el);
  });
}

function renderBg(now){
  els.bgList.innerHTML = '';
  if(state.bg.length === 0){
    els.bgList.innerHTML = `<div class="item"><div class="muted">Sin paralelos activos.</div></div>`;
    return;
  }

  for(const b of state.bg){
    const svc = SERVICES[b.serviceKey];
    const end = b.startedAt + b.plannedMinutes*60000;
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div class="row">
        <div>
          <div class="main">${svc?.label ?? 'Paralelo'}</div>
          <div class="sub">Inicio ${toHM(b.startedAt)} · Proyección ${toHM(end)} · ${b.plannedMinutes} min</div>
        </div>
        <button class="smallBtn" data-act="finishBg" data-id="${b.id}">Finalizar</button>
      </div>
      <div class="meta">
        <span class="tag">Paralelo</span>
      </div>
    `;
    els.bgList.appendChild(el);
  }
}

function toast(msg){
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { els.toast.hidden = true; }, 1600);
}

function openRadial(mode){
  radialMode = mode;
  els.overlay.hidden = false;
  requestAnimationFrame(() => {
    els.overlay.querySelector('.radialWrap')?.focus?.();
  });
}

function closeRadial(){
  els.overlay.hidden = true;
}

function setSpeed(speed){
  selectedSpeed = speed;
  document.querySelectorAll('.speed').forEach(b => b.classList.toggle('selected', b.dataset.speed === speed));
}

function startForeground(serviceKey, speed){
  const mins = plannedMinutes(serviceKey, speed);
  state.active = {
    id: uuid(),
    serviceKey,
    speed,
    plannedMinutes: mins,
    startedAt: Date.now(),
    kind: 'fg',
  };
  saveState();
  toast(`Iniciado: ${SERVICES[serviceKey].label}`);
}

function enqueue(serviceKey, speed){
  const mins = plannedMinutes(serviceKey, speed);
  state.queue.push({
    id: uuid(),
    serviceKey,
    speed,
    plannedMinutes: mins,
    addedAt: Date.now(),
  });
  saveState();
  toast('Agregado a espera');
}

function startBackground(serviceKey){
  const mins = plannedMinutes(serviceKey, 'normal');
  state.bg.push({
    id: uuid(),
    serviceKey,
    plannedMinutes: mins,
    startedAt: Date.now(),
  });
  saveState();
  toast(`Paralelo iniciado: ${SERVICES[serviceKey].label}`);
}

function finishActive(){
  if(!state.active) return;

  const finished = state.active;
  state.active = null;

  // IMPORTANTE: no auto-inicia el siguiente.
  saveState();
  toast('Finalizado');

  // Si el usuario terminó y quiere, puede iniciar el próximo manualmente.
}

function finishBg(id){
  const idx = state.bg.findIndex(x => x.id === id);
  if(idx === -1) return;
  state.bg.splice(idx,1);
  saveState();
  toast('Paralelo finalizado');
}

function resetAll(){
  state = defaultState();
  saveState();
  toast('Reiniciado');
}

function handlePetal(serviceKey){
  const svc = SERVICES[serviceKey];
  if(!svc) return;

  if(svc.type === 'bg'){
    // Color / Permanente: corren en paralelo y arrancan al tocarlos.
    startBackground(serviceKey);
    closeRadial();
    return;
  }

  // Foreground: depende del modo
  if(radialMode === 'queue'){
    enqueue(serviceKey, selectedSpeed);
    closeRadial();
    return;
  }

  // radialMode === 'start'
  if(!state.active){
    startForeground(serviceKey, selectedSpeed);
    closeRadial();
    return;
  }

  // Si ya hay uno activo, por defecto lo mandamos a espera (evita fricción)
  enqueue(serviceKey, selectedSpeed);
  closeRadial();
}

function bindEvents(){
  // PWA SW
  if('serviceWorker' in navigator){
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(()=>{});
    });
  }

  els.fab.addEventListener('click', () => openRadial('start'));
  els.addClientBtn.addEventListener('click', () => openRadial('queue'));
  els.close.addEventListener('click', closeRadial);
  els.overlay.querySelector('.overlayBg').addEventListener('click', closeRadial);

  document.querySelectorAll('.speed').forEach(btn => {
    btn.addEventListener('click', () => setSpeed(btn.dataset.speed));
  });

  document.querySelectorAll('.petal').forEach(btn => {
    btn.addEventListener('click', () => handlePetal(btn.dataset.service));
  });

  els.finishBtn.addEventListener('click', finishActive);
  els.resetBtn.addEventListener('click', () => {
    if(confirm('¿Reiniciar todo (activo, espera y paralelos)?')) resetAll();
  });

  // Queue list actions (delegation)
  els.queueList.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if(!b) return;
    const act = b.dataset.act;
    const id = b.dataset.id;
    const idx = state.queue.findIndex(x => x.id === id);
    if(idx === -1) return;

    if(act === 'del'){
      state.queue.splice(idx,1);
      saveState();
      render();
      return;
    }
    if(act === 'up' && idx > 0){
      const tmp = state.queue[idx-1];
      state.queue[idx-1] = state.queue[idx];
      state.queue[idx] = tmp;
      saveState();
      render();
      return;
    }
    if(act === 'down' && idx < state.queue.length-1){
      const tmp = state.queue[idx+1];
      state.queue[idx+1] = state.queue[idx];
      state.queue[idx] = tmp;
      saveState();
      render();
      return;
    }
  });

  // BG list actions
  els.bgList.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if(!b) return;
    if(b.dataset.act === 'finishBg'){
      finishBg(b.dataset.id);
      render();
    }
  });

  // Escape closes overlay
  window.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && !els.overlay.hidden) closeRadial();
  });
}

function tick(){
  render();
  setTimeout(tick, 1000);
}

bindEvents();
render();
tick();

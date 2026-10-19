/*
 * 가족 레이스: 게임 진행. 대기실 → 카운트다운 → 레이스 → 결과.
 * 서버(/ws/race)가 방을 맡고, 각 폰은 자기 차를 직접 움직여 위치를 보냅니다. 방장 폰은 컴퓨터 차도 움직입니다.
 * 서버에 연결할 수 없으면(로그인 안 됨 등) 컴퓨터 차와 혼자 연습하는 모드로 돌아갑니다.
 */
import * as THREE from './vendor/three.min.js';
import { CARS, LAPS, MAX_RACERS, TRACKS, buildTrack, carById, gridSlot, trackById } from './tracks.js';
import { FIXED_DT, TUNE, botInput, newCar, separate, stepCar } from './physics.js';
import { createGarage, createWorld, makeCar, makeNameTag } from './scene.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const rand = (a, b) => a + Math.random() * (b - a);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function fmt(ms) {
  if (ms == null) return '--:--.--';
  const t = Math.max(0, ms) / 1000;
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`;
}
const durLabel = (sec) => (sec < 120 ? '1분 30초' : sec < 200 ? '2분 30초' : '4분');

// ---- Renderer -------------------------------------------------------------------------------

const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// Quality steps: 2 = sharp + shadows, 1 = softer pixels + shadows, 0 = softer pixels, no shadows.
// Starts high and steps down by itself if the phone can't keep up; remembered for next time.
let quality = Number(localStorage.getItem('race.quality') ?? 2);
const PIXEL_RATIO = [1.1, 1.25, 1.75];
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_RATIO[quality]));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const camera = new THREE.PerspectiveCamera(70, 1, 0.3, 4000);
const garage = createGarage();
const garageCam = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  $('rotate').hidden = !R || R.spectate || w > h;
}
window.addEventListener('resize', resize);

// ---- State ----------------------------------------------------------------------------------

const S = {
  me: null,
  online: false,
  offline: false,
  room: null,
  records: {},
  carId: CARS.some((c) => c.id === localStorage.getItem('race.car')) ? localStorage.getItem('race.car') : null,
};
let R = null; // the race on screen
let results = null;

// ---- Sound ----------------------------------------------------------------------------------

const audio = { ctx: null, master: null, engine: null, engineGain: null, muted: localStorage.getItem('race.mute') === '1' };
function initAudio() {
  if (audio.ctx) {
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audio.ctx = new AC();
  audio.master = audio.ctx.createGain();
  audio.master.gain.value = audio.muted ? 0 : 0.8;
  audio.master.connect(audio.ctx.destination);
  const osc = audio.ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 60;
  const filter = audio.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 500;
  audio.engineGain = audio.ctx.createGain();
  audio.engineGain.gain.value = 0;
  osc.connect(filter).connect(audio.engineGain).connect(audio.master);
  osc.start();
  audio.engine = osc;
}
function beep(freq, dur = 0.15, type = 'square', vol = 0.12, slide = 0) {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  const o = audio.ctx.createOscillator();
  const g = audio.ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(audio.master);
  o.start(t);
  o.stop(t + dur + 0.02);
}
const sounds = {
  item: () => [660, 880, 1100].forEach((f, k) => setTimeout(() => beep(f, 0.08, 'triangle', 0.1), k * 60)),
  boost: () => beep(200, 0.5, 'sawtooth', 0.12, 4),
  bump: () => beep(90, 0.18, 'square', 0.15, 0.5),
  turbo: () => beep(400, 0.25, 'triangle', 0.1, 2.5),
  count: () => beep(440, 0.25, 'square', 0.1),
  go: () => beep(880, 0.5, 'square', 0.12),
  finish: () => [523, 659, 784, 1047].forEach((f, k) => setTimeout(() => beep(f, 0.2, 'triangle', 0.12), k * 120)),
};
function setMuted(m) {
  audio.muted = m;
  localStorage.setItem('race.mute', m ? '1' : '0');
  if (audio.master) audio.master.gain.value = m ? 0 : 0.8;
  $('mute').textContent = m ? '🔇' : '🔊';
}
$('mute').addEventListener('click', () => {
  initAudio();
  setMuted(!audio.muted);
});
setMuted(audio.muted);
document.addEventListener('pointerdown', initAudio, { once: false, passive: true });

// ---- Network --------------------------------------------------------------------------------

let ws = null;
let clockOffset = 0;
let bestRtt = Infinity;
let opened = false;
let failures = 0;
let pingTimer = null;
const serverNow = () => Date.now() + clockOffset;

function setConn(text) {
  $('conn').textContent = text;
}

function connect() {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/race`;
  try {
    ws = new WebSocket(url);
  } catch {
    goOffline();
    return;
  }
  ws.onopen = () => {
    opened = true;
    failures = 0;
    S.online = true;
    setConn('');
    if (S.carId) send({ t: 'car', car: S.carId });
    startPings();
    loadRecords();
  };
  ws.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    handle(m);
  };
  ws.onclose = (e) => {
    S.online = false;
    ws = null;
    clearInterval(pingTimer);
    if (e.code === 4000) {
      setConn('다른 화면에서 게임을 열었어요');
      return;
    }
    failures++;
    // Never got in (not logged in, or no server): practice alone.
    if (!opened && failures >= 2) {
      goOffline();
      return;
    }
    setConn('다시 연결 중…');
    if (R && !R.spectate) toast('연결이 끊겼어요. 다시 연결하는 중…');
    setTimeout(connect, Math.min(8000, 800 * failures));
  };
}

function send(m) {
  if (S.offline) {
    local.recv(m);
    return;
  }
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
}

function startPings() {
  let count = 0;
  bestRtt = Infinity;
  const ping = () => send({ t: 'ping', c: Date.now() });
  ping();
  clearInterval(pingTimer);
  pingTimer = setInterval(() => {
    count++;
    ping();
    if (count === 6) {
      clearInterval(pingTimer);
      pingTimer = setInterval(ping, 15000);
    }
  }, 1200);
}

async function loadRecords() {
  try {
    const res = await fetch('/api/race/records', { credentials: 'same-origin', cache: 'no-store' });
    if (res.ok) {
      S.records = (await res.json()).tracks ?? {};
      renderLobby();
    }
  } catch {}
}

function handle(m) {
  switch (m.t) {
    case 'welcome':
      S.me = m.you;
      clockOffset = m.now - Date.now();
      break;
    case 'pong': {
      const rtt = Date.now() - m.c;
      if (rtt <= bestRtt + 30) {
        bestRtt = Math.min(bestRtt, rtt);
        clockOffset = m.s - (m.c + rtt / 2);
      }
      break;
    }
    case 'room':
      S.room = m;
      if (!S.carId) {
        const mine = m.players.find((p) => p.id === S.me);
        if (mine) S.carId = mine.car;
      }
      renderLobby();
      break;
    case 'notice':
      $('lobbyNote').textContent = m.text;
      break;
    case 'start':
      beginRace(m, false);
      break;
    case 'watch':
      if (!R) beginRace(m, true);
      break;
    case 'st':
      if (R) onStates(m);
      break;
    case 'fin':
      if (R) onFinish(m);
      break;
    case 'end':
      if (R) R.endAt = m.endAt;
      break;
    case 'gone':
      if (R) removeRacer(m.id);
      break;
    case 'results':
      S.records = m.records ?? S.records;
      showResults(m);
      break;
    default:
  }
}

// ---- Practice alone (no server) ---------------------------------------------------------------

const BOT_NAMES = ['토끼봇', '거북봇', '여우봇', '곰돌봇', '펭귄봇', '고양봇', '판다봇'];
let local = null;

function createLocalRoom(name) {
  const st = { track: TRACKS[0].id, bots: 3, race: null, timer: null };
  const me = { id: 'me', name, car: S.carId ?? CARS[0].id, ready: false };
  const room = () => ({ t: 'room', phase: st.race ? 'race' : 'lobby', hostId: 'me', track: st.track, bots: st.bots, players: [{ ...me }], race: null });
  function end() {
    clearInterval(st.timer);
    const race = st.race;
    st.race = null;
    const done = race.racers.filter((r) => r.finished).sort((a, b) => a.time - b.time);
    const rest = race.racers.filter((r) => !r.finished).sort((a, b) => (b.prog ?? -1e9) - (a.prog ?? -1e9));
    const list = [...done, ...rest].map((r, i) => ({ id: r.id, name: r.name, car: r.car, bot: r.bot, rank: i + 1, time: r.time ?? null }));
    handle({ t: 'results', track: race.track, list, newBest: [], records: S.records });
    handle(room());
  }
  return {
    init() {
      handle({ t: 'welcome', you: 'me', now: Date.now() });
      handle(room());
    },
    recv(m) {
      switch (m.t) {
        case 'car':
          me.car = m.car;
          return handle(room());
        case 'settings':
          if (trackById(m.track)) st.track = m.track;
          if (Number.isInteger(m.bots)) st.bots = clamp(m.bots, 0, MAX_RACERS - 1);
          return handle(room());
        case 'start': {
          const free = CARS.filter((c) => c.id !== me.car);
          const racers = [
            { id: 'me', name: me.name, car: me.car, bot: false },
            ...Array.from({ length: st.bots }, (_, k) => ({ id: `b${k}`, name: BOT_NAMES[k], car: free[k % free.length].id, bot: true })),
          ];
          const order = racers.map((_, k) => k).sort(() => Math.random() - 0.5);
          order.forEach((k, slot) => (racers[k].slot = slot));
          const startAt = Date.now() + 4000;
          const def = trackById(st.track);
          st.race = { track: st.track, racers, order: [], startAt, endAt: null, hardEnd: startAt + def.targetSec * 3000 };
          handle({ t: 'start', track: st.track, laps: LAPS, startAt, botHost: 'me', racers: racers.map((r) => ({ ...r })) });
          st.timer = setInterval(() => {
            const race = st.race;
            const t = Date.now();
            const meR = race.racers[0];
            if (meR.finished && !race.allHome) {
              race.allHome = true;
              race.endAt = Math.min(race.endAt ?? Infinity, t + 4000);
              handle({ t: 'end', endAt: race.endAt });
            }
            if ((race.endAt && t >= race.endAt) || t >= race.hardEnd) end();
          }, 200);
          return;
        }
        case 'st':
          if (!st.race) return;
          st.race.racers[0].prog = m.s?.[5];
          for (const r of st.race.racers) if (r.bot && m.b?.[r.id]) r.prog = m.b[r.id][5];
          return;
        case 'leave':
          if (st.race) {
            clearInterval(st.timer);
            st.race = null;
            handle(room());
          }
          return;
        case 'fin': {
          const race = st.race;
          if (!race) return;
          const r = race.racers.find((x) => x.id === (m.id || 'me'));
          if (!r || r.finished) return;
          r.finished = true;
          r.time = m.time;
          race.order.push(r.id);
          if (!race.endAt && !r.bot) race.endAt = Date.now() + 30000;
          return handle({ t: 'fin', id: r.id, name: r.name, time: m.time, rank: race.order.length, endAt: race.endAt });
        }
        default:
      }
    },
  };
}

async function goOffline() {
  if (S.offline) return;
  S.offline = true;
  setConn('혼자 연습 모드 (서버 연결 안 됨)');
  let name = '나';
  try {
    const me = await window.FamilyGames?.me?.();
    if (me?.displayName) name = me.displayName;
  } catch {}
  local = createLocalRoom(name);
  local.init();
}

// ---- Lobby ----------------------------------------------------------------------------------

const STAT_RANGE = { speed: [30, 34.5], accel: [11, 16], turn: [1.8, 2.4] };
function statBar(label, key, v) {
  const [lo, hi] = STAT_RANGE[key];
  const p = clamp((v - lo) / (hi - lo), 0.08, 1) * 100;
  return `<span>${label}</span><div class="bar"><i style="width:${p}%"></i></div>`;
}

function myCar() {
  return carById(S.carId ?? CARS[0].id);
}

function renderLobby() {
  const room = S.room;
  const car = myCar();
  $('carName').innerHTML = `<span class="dot" style="background:${car.color}"></span> ${esc(car.name)}`;
  $('carStats').innerHTML = statBar('속도', 'speed', car.stats.speed) + statBar('가속', 'accel', car.stats.accel) + statBar('핸들', 'turn', car.stats.turn);
  garage.show(car);
  if (!room) return;
  const host = room.hostId === S.me;
  const players = room.players;
  $('players').innerHTML = players
    .map((p) => {
      const c = carById(p.car);
      const isHost = p.id === room.hostId;
      const state = isHost ? '👑 방장' : p.ready ? '✅ 준비' : '⏳';
      return `<li class="${p.ready || isHost ? 'ready' : ''}"><span class="dot" style="background:${c.color}"></span>${esc(p.name)}${p.id === S.me ? ' (나)' : ''} · ${state}</li>`;
    })
    .join('');

  const groups = [90, 150, 240];
  let html = '';
  for (const sec of groups) {
    html += `<div class="group">⏱ ${durLabel(sec)}</div>`;
    for (const t of TRACKS.filter((x) => x.targetSec === sec)) {
      const best = (S.records[t.id] ?? [])[0];
      const bestText = best ? `🏆 ${esc(best.name)}<br>${fmt(best.best)}` : '기록 없음';
      html += `<button class="track ${room.track === t.id ? 'on' : ''}" data-track="${t.id}"><span class="em">${t.emoji}</span>
        <span><span class="nm">${esc(t.name)}</span><span class="sub">${esc(t.desc)}</span></span><span class="best">${bestText}</span></button>`;
    }
  }
  const tracksEl = $('tracks');
  const scroll = tracksEl.scrollTop;
  tracksEl.innerHTML = html;
  tracksEl.scrollTop = scroll;
  tracksEl.classList.toggle('locked', !host);

  const maxBots = Math.max(0, MAX_RACERS - players.length);
  $('bots').textContent = Math.min(room.bots, maxBots);
  $('botsMinus').disabled = $('botsPlus').disabled = !host;
  $('botsMinus').style.opacity = $('botsPlus').style.opacity = host ? 1 : 0.4;

  const go = $('go');
  const me = players.find((p) => p.id === S.me);
  const others = players.filter((p) => p.id !== room.hostId);
  const racing = room.phase !== 'lobby';
  go.classList.remove('ready');
  if (racing) {
    go.disabled = true;
    go.textContent = '레이스 진행 중…';
  } else if (host) {
    const waiting = others.filter((p) => !p.ready).length;
    go.disabled = waiting > 0;
    go.textContent = waiting > 0 ? `${waiting}명이 준비하면 출발할 수 있어요` : '🏁 출발!';
  } else {
    go.disabled = false;
    go.textContent = me?.ready ? '준비 취소' : '준비 완료!';
    if (me?.ready) go.classList.add('ready');
  }
  const hostName = players.find((p) => p.id === room.hostId)?.name ?? '';
  $('lobbyNote').textContent = racing
    ? '지금 레이스 중이에요. 끝나면 같이 달려요!'
    : host
      ? players.length > 1
        ? '트랙을 고르고 모두 준비하면 출발해요.'
        : '가족이 들어오면 같이 달릴 수 있어요. 혼자도 출발할 수 있어요.'
      : `${hostName}님이 트랙을 고르고 출발해요.`;
}

$('tracks').addEventListener('click', (e) => {
  const b = e.target.closest('[data-track]');
  if (!b || !S.room || S.room.hostId !== S.me) return;
  send({ t: 'settings', track: b.dataset.track });
});
function changeBots(d) {
  if (!S.room || S.room.hostId !== S.me) return;
  const max = MAX_RACERS - S.room.players.length;
  send({ t: 'settings', bots: clamp(Math.min(S.room.bots, max) + d, 0, max) });
}
$('botsMinus').addEventListener('click', () => changeBots(-1));
$('botsPlus').addEventListener('click', () => changeBots(1));
function changeCar(d) {
  const i = CARS.findIndex((c) => c.id === myCar().id);
  S.carId = CARS[(i + d + CARS.length) % CARS.length].id;
  localStorage.setItem('race.car', S.carId);
  send({ t: 'car', car: S.carId });
  renderLobby();
}
$('prevCar').addEventListener('click', () => changeCar(-1));
$('nextCar').addEventListener('click', () => changeCar(1));
$('go').addEventListener('click', () => {
  initAudio();
  const room = S.room;
  if (!room) return;
  if (room.hostId === S.me) send({ t: 'start' });
  else send({ t: 'ready', ready: !room.players.find((p) => p.id === S.me)?.ready });
});

// ---- Controls -------------------------------------------------------------------------------

const keys = new Set();
const touchKeys = new Set();
const mouseKeys = new Set();
const pressed = (k) => keys.has(k) || touchKeys.has(k) || mouseKeys.has(k);
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowDown: 'brake', KeyS: 'brake',
  ShiftLeft: 'drift', ShiftRight: 'drift', Space: 'drift', KeyX: 'item', ControlLeft: 'item', KeyE: 'item', ArrowUp: 'item',
};
window.addEventListener('keydown', (e) => {
  const k = KEYMAP[e.code];
  if (!k || !R) return;
  e.preventDefault();
  keys.add(k);
});
window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) keys.delete(k);
});
window.addEventListener('blur', () => {
  keys.clear();
  touchKeys.clear();
  mouseKeys.clear();
});

const controls = $('controls');
function readTouches(e) {
  e.preventDefault();
  touchKeys.clear();
  for (const t of e.touches) {
    const el = document.elementFromPoint(t.clientX, t.clientY)?.closest('[data-k]');
    if (el) touchKeys.add(el.dataset.k);
  }
  showPressed();
}
for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) controls.addEventListener(type, readTouches, { passive: false });
controls.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse') return;
  const el = e.target.closest('[data-k]');
  if (el) mouseKeys.add(el.dataset.k);
  showPressed();
});
window.addEventListener('pointerup', (e) => {
  if (e.pointerType !== 'mouse') return;
  mouseKeys.clear();
  showPressed();
});
function showPressed() {
  for (const b of controls.querySelectorAll('[data-k]')) b.classList.toggle('on', pressed(b.dataset.k));
}

let steerValue = 0;
let itemWasDown = false;
function playerInput(dt) {
  const want = (pressed('right') ? 1 : 0) - (pressed('left') ? 1 : 0);
  // Ease the steering in a little so tapping the buttons isn't twitchy.
  const rate = want === 0 ? 10 : 7;
  steerValue += clamp(want - steerValue, -rate * dt, rate * dt);
  const itemDown = pressed('item');
  const useItem = itemDown && !itemWasDown;
  itemWasDown = itemDown;
  return { steer: steerValue, throttle: 1, brake: pressed('brake'), drift: pressed('drift'), useItem };
}

// ---- Race -----------------------------------------------------------------------------------

function toast(text, ms = 2500) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), ms);
}
function big(text, small = false) {
  const el = $('big');
  el.textContent = text;
  el.classList.toggle('small', small);
}

function beginRace(m, spectate) {
  endRace();
  $('results').hidden = true;
  results = null;
  const def = trackById(m.track);
  const track = buildTrack(def);
  const world = createWorld(track);
  const botHost = !spectate && m.botHost === S.me;
  R = {
    def,
    track,
    world,
    laps: m.laps ?? LAPS,
    startAt: m.startAt,
    spectate,
    racers: new Map(),
    mine: null,
    acc: 0,
    sendAcc: 0,
    t: 0,
    endAt: null,
    lastCount: null,
    order: [],
    finishedShown: false,
  };
  for (const info of m.racers) {
    const carDef = carById(info.car);
    const mesh = makeCar(carDef);
    mesh.rotation.order = 'YXZ';
    world.scene.add(mesh);
    const slot = gridSlot(track, info.slot ?? 0);
    const local = !spectate && (info.id === S.me || (info.bot && botHost));
    const r = {
      id: info.id,
      name: info.name,
      bot: info.bot,
      carDef,
      mesh,
      local,
      finished: false,
      rank: null,
      time: null,
      snaps: [],
      view: { x: slot.x, y: slot.y, z: slot.z, yaw: slot.yaw, fwd: 0, prog: slot.i * track.spacing - track.length, flags: 0, steer: 0, pitch: 0 },
    };
    if (local) {
      r.car = newCar(track, slot, carDef.stats);
      if (info.bot) r.ai = { skill: rand(0.9, 0.985), lane: rand(-0.6, 0.6), t: rand(0, 50) };
    }
    if (info.id !== S.me) {
      r.tag = makeNameTag(info.name, carDef.color);
      world.scene.add(r.tag);
    }
    if (info.id === S.me && !spectate) R.mine = r;
    R.racers.set(r.id, r);
  }
  world.setShadows(quality >= 1);
  setupMinimap();
  $('lobby').hidden = true;
  $('hud').hidden = false;
  $('controls').hidden = spectate;
  $('watch').hidden = !spectate;
  big('');
  steerValue = 0;
  resize();
  placeCamera(true);
}

function endRace() {
  if (!R) return;
  disposeScene(R.world.scene);
  R = null;
  $('hud').hidden = true;
  $('controls').hidden = true;
  $('rotate').hidden = true;
  if (audio.engineGain) audio.engineGain.gain.value = 0;
}

function disposeScene(scene) {
  scene.traverse((o) => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) m.dispose();
  });
}

function removeRacer(id) {
  const r = R.racers.get(id);
  if (!r || r.local) return;
  R.world.scene.remove(r.mesh);
  if (r.tag) R.world.scene.remove(r.tag);
  R.racers.delete(id);
}

function onStates(m) {
  for (const [id, s] of Object.entries(m.p)) {
    const r = R.racers.get(id);
    if (!r || r.local) continue;
    r.snaps.push({ t: m.now, s });
    if (r.snaps.length > 12) r.snaps.shift();
  }
}

function onFinish(m) {
  const r = R.racers.get(m.id);
  if (r) {
    r.finished = true;
    r.rank = m.rank;
    r.time = m.time;
  }
  if (m.endAt) R.endAt = m.endAt;
  if (m.id !== S.me) toast(`🏁 ${m.name} ${m.rank}등 완주! ${fmt(m.time)}`);
}

const INTERP_DELAY = 130;
function interpolate(r, now) {
  const snaps = r.snaps;
  if (!snaps.length) return;
  const at = now - INTERP_DELAY;
  let a = snaps[0];
  let b = null;
  for (let k = snaps.length - 1; k >= 0; k--) {
    if (snaps[k].t <= at) {
      a = snaps[k];
      b = snaps[k + 1] ?? null;
      break;
    }
  }
  const v = r.view;
  const set = (s) => {
    [v.x, v.y, v.z, v.yaw, v.fwd, v.prog, v.flags, v.steer, v.pitch] = s;
  };
  if (b) {
    const f = clamp((at - a.t) / (b.t - a.t || 1), 0, 1);
    const sa = a.s;
    const sb = b.s;
    v.x = sa[0] + (sb[0] - sa[0]) * f;
    v.y = sa[1] + (sb[1] - sa[1]) * f;
    v.z = sa[2] + (sb[2] - sa[2]) * f;
    v.yaw = sa[3] + wrapAngle(sb[3] - sa[3]) * f;
    v.fwd = sa[4] + (sb[4] - sa[4]) * f;
    v.prog = sa[5] + (sb[5] - sa[5]) * f;
    v.flags = sb[6];
    v.steer = sb[7];
    v.pitch = sa[8] + (sb[8] - sa[8]) * f;
  } else {
    // Nothing newer yet: carry on in the same direction for a moment.
    set(a.s);
    const ahead = clamp((at - a.t) / 1000, 0, 0.25);
    v.x += Math.sin(v.yaw) * v.fwd * ahead;
    v.z += Math.cos(v.yaw) * v.fwd * ahead;
  }
}

function useItem(car) {
  if (car.items <= 0) return false;
  car.items--;
  car.boost = Math.max(car.boost, TUNE.itemBoost);
  return true;
}

function stepLocal(dt, running, raceMs) {
  const { track } = R;
  const locals = [...R.racers.values()].filter((r) => r.local);
  for (const r of locals) {
    const car = r.car;
    let input;
    if (!running) input = { steer: 0, throttle: 0, brake: false, drift: false, useItem: false };
    else if (r === R.mine && !r.finished) input = playerInput(dt);
    else {
      // computer cars, and my own car on autopilot after the finish
      r.ai ??= { skill: 0.9, lane: 0, t: 0 };
      r.ai.t += dt;
      input = botInput(car, track, r.ai);
    }
    if (input.useItem && useItem(car) && r === R.mine) sounds.boost();
    const events = stepCar(car, input, track, dt);
    if (r === R.mine) {
      if (events.includes('bump')) sounds.bump();
      if (events.includes('miniturbo')) sounds.turbo();
    }
    // Item boxes
    for (const it of R.world.items) {
      if (R.t < it.hiddenUntil) continue;
      if (Math.abs(car.x - it.x) < 2.2 && Math.abs(car.z - it.z) < 2.2 && Math.abs(car.y + 1.4 - it.y) < 3) {
        it.hiddenUntil = R.t + 2.5;
        if (car.items < TUNE.maxItems) {
          car.items++;
          if (r === R.mine) sounds.item();
        }
      }
    }
    // Boost pads
    for (const pad of track.pads) {
      const di = Math.abs(car.idx - pad.i);
      if (Math.min(di, track.N - di) <= 2 && Math.abs(car.lat - pad.lat) < 2.6) {
        if (car.boost < 0.3 && r === R.mine) sounds.boost();
        car.boost = Math.max(car.boost, TUNE.padBoost);
      }
    }
    // Finish
    if (running && !r.finished && car.prog >= R.laps * track.length) {
      r.finished = true;
      r.time = raceMs;
      send({ t: 'fin', id: r.bot ? r.id : undefined, time: raceMs });
      if (r === R.mine) {
        sounds.finish();
        $('controls').hidden = true;
      }
    }
  }
  // Bumping into each other
  for (let a = 0; a < locals.length; a++) {
    for (let b = a + 1; b < locals.length; b++) separate(locals[a].car, locals[b].car, false);
  }
  if (R.mine) {
    for (const r of R.racers.values()) if (!r.local) separate(R.mine.car, r.view, true);
  }
}

function stateOf(car, finished) {
  const flags = (car.boost > 0 ? 1 : 0) | (car.drift ? 2 : 0) | (car.drift > 0 ? 4 : 0) | (car.driftCharge > 0.7 ? 8 : 0) | (car.driftCharge > 1.6 ? 32 : 0) | (finished ? 16 : 0);
  const r2 = (v) => Math.round(v * 100) / 100;
  return [r2(car.x), r2(car.y), r2(car.z), r2(car.yaw), r2(car.fwd), r2(car.prog), flags, r2(car.steer), r2(car.pitch)];
}

function standings() {
  const list = [...R.racers.values()].map((r) => ({ r, prog: r.local ? r.car.prog : r.view.prog }));
  list.sort((a, b) => {
    if (a.r.finished && b.r.finished) return (a.r.rank ?? 99) - (b.r.rank ?? 99) || (a.r.time ?? 0) - (b.r.time ?? 0);
    if (a.r.finished !== b.r.finished) return a.r.finished ? -1 : 1;
    return b.prog - a.prog;
  });
  return list.map((x) => x.r);
}

const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
function placeCamera(snap, dt = 0) {
  const target = R.mine ?? standings()[0];
  if (!target) return;
  const v = target.local ? target.car : target.view;
  const fx = Math.sin(v.yaw);
  const fz = Math.cos(v.yaw);
  const boost = target.local ? target.car.boost > 0 : target.view.flags & 1;
  const back = boost ? 8.6 : 7.4;
  const want = new THREE.Vector3(v.x - fx * back, v.y + 3.3, v.z - fz * back);
  const look = new THREE.Vector3(v.x + fx * 5, v.y + 1.2, v.z + fz * 5);
  if (snap) {
    camPos.copy(want);
    camLook.copy(look);
  } else {
    const k = 1 - Math.exp(-dt * 7);
    camPos.lerp(want, k);
    camLook.lerp(look, 1 - Math.exp(-dt * 12));
  }
  // Keep the camera above the road it's behind
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  const speed = Math.abs(v.fwd ?? 0);
  const fov = 68 + clamp(speed / 35, 0, 1.3) * 10 + (boost ? 6 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4 || 1);
    camera.updateProjectionMatrix();
  }
}

function updateRace(dt) {
  const now = serverNow();
  const raceMs = now - R.startAt;
  const running = raceMs >= 0;
  R.t += dt;

  // Countdown
  if (!running) {
    const n = Math.ceil(-raceMs / 1000);
    if (n !== R.lastCount && n <= 3) {
      R.lastCount = n;
      big(String(n));
      sounds.count();
    } else if (n > 3) big('준비!', true);
  } else if (R.lastCount !== 0) {
    R.lastCount = 0;
    big('출발!');
    sounds.go();
    setTimeout(() => R && R.lastCount === 0 && !R.mine?.finished && big(''), 900);
  }

  // Physics
  R.acc += dt;
  let steps = 0;
  while (R.acc >= FIXED_DT && steps < 6) {
    stepLocal(FIXED_DT, running, raceMs);
    R.acc -= FIXED_DT;
    steps++;
  }
  if (steps === 6) R.acc = 0;

  // Others
  for (const r of R.racers.values()) if (!r.local) interpolate(r, now);

  // Send my car (and the computer cars if I drive them) ~15 times a second
  R.sendAcc += dt;
  if (R.sendAcc >= 0.066 && !R.spectate) {
    R.sendAcc = 0;
    const msg = { t: 'st' };
    if (R.mine) msg.s = stateOf(R.mine.car, R.mine.finished);
    const bots = [...R.racers.values()].filter((r) => r.local && r.bot);
    if (bots.length) msg.b = Object.fromEntries(bots.map((r) => [r.id, stateOf(r.car, r.finished)]));
    send(msg);
  }

  // Meshes
  for (const r of R.racers.values()) {
    const v = r.local ? r.car : r.view;
    const flags = r.local ? stateOf(r.car, r.finished)[6] : v.flags;
    r.mesh.position.set(v.x, v.y, v.z);
    r.mesh.rotation.set(v.pitch ?? 0, v.yaw, 0);
    r.mesh.userData.animate(dt, {
      steer: v.steer ?? 0,
      speed: v.fwd ?? 0,
      boost: Boolean(flags & 1),
      drift: flags & 2 ? (flags & 4 ? 1 : -1) : 0,
      charge: flags & 32 ? 2 : flags & 8 ? 1 : 0,
      t: R.t,
    });
    if (r.tag) r.tag.position.set(v.x, v.y + 3.1, v.z);
  }

  placeCamera(false, dt);
  R.world.scene.userData.cameraPos = camera.position;
  R.world.follow(camLook.x, camLook.y, camLook.z);
  watchSpeed(dt);
  R.world.update(dt, R.t);
  updateHud(now, raceMs);
}

// Frame-rate watch during a race: two slow seconds in a row → one quality step down.
const perf = { time: 0, frames: 0, slow: 0 };
function watchSpeed(dt) {
  perf.time += dt;
  perf.frames++;
  if (perf.time < 2) return;
  const fps = perf.frames / perf.time;
  perf.time = 0;
  perf.frames = 0;
  perf.slow = fps < 38 ? perf.slow + 1 : 0;
  if (perf.slow >= 2 && quality > 0) {
    perf.slow = 0;
    setQuality(quality - 1);
  }
}
function setQuality(q) {
  quality = q;
  localStorage.setItem('race.quality', String(q));
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_RATIO[q]));
  resize();
  R?.world.setShadows(q >= 1);
}

function updateHud(now, raceMs) {
  const list = standings();
  const focus = R.mine ?? list[0];
  const pos = list.indexOf(focus) + 1;
  $('rank').innerHTML = `${focus?.finished && focus.rank ? focus.rank : pos}<small>/${list.length}</small>`;
  const car = R.mine?.car;
  const prog = car ? car.prog : focus?.view.prog ?? 0;
  const lap = clamp(Math.floor(prog / R.track.length) + 1, 1, R.laps);
  $('lap').textContent = `LAP ${lap}/${R.laps}`;
  if (car && lap !== R.shownLap) {
    if (R.shownLap && lap === R.laps) {
      big('마지막 바퀴!', true);
      sounds.turbo();
      setTimeout(() => R && !R.mine?.finished && big(''), 1500);
    }
    R.shownLap = lap;
  }
  const time = R.mine?.finished ? R.mine.time : Math.max(0, raceMs);
  $('clock').textContent = fmt(time);
  const speed = Math.abs(car ? car.fwd : focus?.view.fwd ?? 0);
  $('speed').innerHTML = `${Math.round(speed * 3.6 * 1.25)}<small> km/h</small>`;
  $('boostFx').classList.toggle('on', Boolean(car && car.boost > 0));

  if (car) {
    $('itemCount').hidden = car.items === 0;
    $('itemCount').textContent = car.items;
    controls.querySelector('.item').classList.toggle('empty', car.items === 0);
  }

  if (R.mine?.finished) {
    if (!R.finishedShown) {
      R.finishedShown = true;
      big(`🏁 완주! ${R.mine.rank ?? pos}등`, true);
    } else if (R.mine.rank) big(`🏁 완주! ${R.mine.rank}등 · ${fmt(R.mine.time)}`, true);
  } else if (raceMs > 1000 && car) {
    if (car.wrongWay > 1.2) big('↩ 반대 방향이에요!', true);
    else if (R.endAt && now < R.endAt) big(`⏳ ${Math.ceil((R.endAt - now) / 1000)}초 남았어요`, true);
    else if ($('big').textContent.startsWith('↩') || $('big').textContent.startsWith('⏳')) big('');
  }
  drawMinimap(list);
}

// ---- Minimap --------------------------------------------------------------------------------

const mm = { ctx: null, path: null, scale: 1, ox: 0, oz: 0, size: 120 };
function setupMinimap() {
  const c = $('minimap');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = mm.size * dpr;
  c.height = mm.size * dpr;
  mm.ctx = c.getContext('2d');
  mm.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const { bounds, px, pz, N } = R.track;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxZ - bounds.minZ;
  mm.scale = (mm.size - 20) / Math.max(w, h);
  mm.ox = mm.size / 2 - ((bounds.minX + bounds.maxX) / 2) * mm.scale;
  mm.oz = mm.size / 2 - ((bounds.minZ + bounds.maxZ) / 2) * mm.scale;
  mm.path = new Path2D();
  for (let i = 0; i <= N; i += 2) {
    const k = i % N;
    // Mirror x so the map matches the view from above with "right" on the right.
    const x = mm.size - (px[k] * mm.scale + mm.ox);
    const y = mm.size - (pz[k] * mm.scale + mm.oz);
    if (i === 0) mm.path.moveTo(x, y);
    else mm.path.lineTo(x, y);
  }
  mm.path.closePath();
}
function drawMinimap(list) {
  const ctx = mm.ctx;
  if (!ctx) return;
  ctx.clearRect(0, 0, mm.size, mm.size);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,.35)';
  ctx.lineWidth = 7;
  ctx.stroke(mm.path);
  ctx.strokeStyle = 'rgba(255,255,255,.9)';
  ctx.lineWidth = 2;
  ctx.stroke(mm.path);
  for (const r of [...list].reverse()) {
    const v = r.local ? r.car : r.view;
    const x = mm.size - (v.x * mm.scale + mm.ox);
    const y = mm.size - (v.z * mm.scale + mm.oz);
    const meDot = r === R.mine;
    ctx.beginPath();
    ctx.arc(x, y, meDot ? 5.5 : 4, 0, Math.PI * 2);
    ctx.fillStyle = r.carDef.color;
    ctx.fill();
    ctx.lineWidth = meDot ? 2.5 : 1.2;
    ctx.strokeStyle = meDot ? '#fff' : 'rgba(0,0,0,.6)';
    ctx.stroke();
  }
}

// ---- Results --------------------------------------------------------------------------------

function showResults(m) {
  results = m;
  const def = trackById(m.track);
  $('resultTitle').textContent = `🏁 ${def ? `${def.emoji} ${def.name}` : '결과'}`;
  const best = (m.records?.[m.track] ?? [])[0];
  $('resultSub').textContent = best ? `가족 최고 기록: ${best.name} ${fmt(best.best)}` : '';
  $('newBest').hidden = !(m.newBest ?? []).includes(S.me);
  const medals = ['🥇', '🥈', '🥉'];
  $('resultList').innerHTML = m.list
    .map((r) => {
      const c = carById(r.car);
      return `<li class="${r.id === S.me ? 'me' : ''}"><span class="rk">${medals[r.rank - 1] ?? r.rank}</span>
        <span class="nm"><span class="dot" style="background:${c.color}"></span> ${esc(r.name)}${r.bot ? ' 🤖' : ''}</span>
        <span class="tm">${r.time != null ? fmt(r.time) : '완주 못 함'}</span></li>`;
    })
    .join('');
  $('results').hidden = false;
  $('controls').hidden = true;
  big('');
}
$('back').addEventListener('click', () => {
  $('results').hidden = true;
  results = null;
  endRace();
  $('lobby').hidden = false;
  renderLobby();
});
// The Android app's WebView can't show confirm(), so leaving a race takes a second tap.
let quitArmed = 0;
$('quit').addEventListener('click', () => {
  if (!R) return;
  if (!R.spectate && !R.mine?.finished && Date.now() - quitArmed > 2500) {
    quitArmed = Date.now();
    toast('한 번 더 누르면 레이스에서 나가요');
    return;
  }
  if (!R.spectate) send({ t: 'leave' });
  endRace();
  $('results').hidden = true;
  $('lobby').hidden = false;
  renderLobby();
});

// ---- Loop -----------------------------------------------------------------------------------

let last = performance.now();
let garageT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (R) {
    updateRace(dt);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    renderer.render(R.world.scene, camera);
    if (audio.engineGain) {
      const car = R.mine?.car;
      const speed = car ? Math.abs(car.fwd) : 0;
      audio.engine.frequency.value = 45 + speed * 4.5 + (car?.boost > 0 ? 40 : 0);
      audio.engineGain.gain.value = car && !R.mine.finished ? 0.035 + speed * 0.0012 : 0;
    }
    return;
  }
  // Lobby: the chosen car turning in the preview box
  garageT += dt;
  garage.update(dt, garageT);
  renderer.setScissorTest(false);
  renderer.setClearColor('#12162a');
  renderer.clear();
  const box = $('preview').getBoundingClientRect();
  if (box.width > 10 && box.height > 10 && !$('lobby').hidden) {
    const y = window.innerHeight - box.bottom;
    renderer.setViewport(box.left, y, box.width, box.height);
    renderer.setScissor(box.left, y, box.width, box.height);
    renderer.setScissorTest(true);
    garageCam.aspect = box.width / box.height;
    garageCam.position.set(0, 2.6, 7.8);
    garageCam.lookAt(0, 0.7, 0);
    garageCam.updateProjectionMatrix();
    renderer.render(garage.scene, garageCam);
  }
}

resize();
renderLobby();
connect();
requestAnimationFrame(frame);

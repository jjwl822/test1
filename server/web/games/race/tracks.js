/*
 * 가족 레이스: 트랙과 자동차 데이터. 브라우저(게임)와 서버(race.js) 둘 다 이 파일을 읽습니다.
 * 트랙 크기(scale)는 scripts/race-calibrate.mjs 로 컴퓨터 차를 달려 보며 목표 시간에 맞춘 값입니다.
 * 트랙 모양(pts)을 고치면 그 스크립트를 다시 돌려 scale 을 맞춰 주세요.
 */

export const LAPS = 3;
export const SPACING = 2; // meters between track samples
export const HALF_WIDTH = 8; // road half width
export const CURB = 1.2;
export const WALL = HALF_WIDTH + CURB + 3; // distance from the center line to the barrier

// stats: speed = top speed (m/s), accel = m/s² from a standstill, turn = rad/s at full lock
export const CARS = [
  { id: 'thunder', name: '번개 레드', type: 'speedy', color: '#e53935', accent: '#ffffff', stats: { speed: 32.5, accel: 13, turn: 2.0 } },
  { id: 'buggy', name: '파랑 버기', type: 'buggy', color: '#1e88e5', accent: '#ffd54f', stats: { speed: 31, accel: 15, turn: 2.2 } },
  { id: 'formula', name: '은빛 포뮬러', type: 'formula', color: '#b0bec5', accent: '#263238', stats: { speed: 33.5, accel: 12, turn: 1.9 } },
  { id: 'bubble', name: '핑크 버블', type: 'bubble', color: '#f06292', accent: '#ffffff', stats: { speed: 30.5, accel: 15.5, turn: 2.35 } },
  { id: 'jeep', name: '초록 지프', type: 'jeep', color: '#43a047', accent: '#33691e', stats: { speed: 31.5, accel: 14, turn: 2.1 } },
  { id: 'taxi', name: '노랑 택시', type: 'taxi', color: '#fdd835', accent: '#212121', stats: { speed: 32, accel: 13.5, turn: 2.05 } },
  { id: 'rocket', name: '보라 로켓', type: 'rocket', color: '#8e24aa', accent: '#ff9800', stats: { speed: 34, accel: 11.5, turn: 1.85 } },
  { id: 'monster', name: '몬스터 트럭', type: 'monster', color: '#fb8c00', accent: '#3e2723', stats: { speed: 31, accel: 14.5, turn: 2.15 } },
];
export const carById = (id) => CARS.find((c) => c.id === id) ?? CARS[0];

/*
 * pts: control points [x, z, y(height, meters)] of a closed loop, before scaling. Only x/z are scaled.
 * items: where the rows of item boxes are (fraction of a lap). pads: boost pads [fraction, side -1..1].
 */
export const TRACKS = [
  {
    id: 't1', name: '초록 공원', emoji: '🌳', theme: 'park', targetSec: 90, scale: 1.041,
    desc: '처음 타기 좋은 넓고 쉬운 서킷',
    pts: [[-100, -50], [0, -65], [100, -50], [125, 0], [100, 50], [55, 62], [22, 38], [-22, 38], [-55, 62], [-100, 50], [-125, 0]],
    items: [0.22, 0.52, 0.8], pads: [[0.12, 0], [0.62, 0.4]],
  },
  {
    id: 't2', name: '햇살 해변', emoji: '🏖️', theme: 'beach', targetSec: 90, scale: 0.889,
    desc: '야자수 사이로 구불구불 달려요',
    pts: [[-140, 0], [-100, -50], [-40, -60], [0, -30], [40, -60], [100, -50], [140, 0], [100, 50], [40, 40], [0, 70], [-40, 40], [-100, 50]],
    items: [0.2, 0.5, 0.78], pads: [[0.36, 0], [0.86, -0.4]],
  },
  {
    id: 't3', name: '사탕 마을', emoji: '🍭', theme: 'candy', targetSec: 90, scale: 0.942,
    desc: '하트 모양 달콤한 트랙',
    pts: [[0, -30], [50, -80], [110, -60], [125, 0], [80, 60], [0, 95], [-80, 60], [-125, 0], [-110, -60], [-50, -80]],
    items: [0.18, 0.48, 0.75], pads: [[0.3, 0], [0.82, 0]],
  },
  {
    id: 't4', name: '사막 협곡', emoji: '🏜️', theme: 'desert', targetSec: 150, scale: 0.892,
    desc: '선인장 사이 급커브와 언덕',
    pts: [[-150, -60], [-50, -80], [50, -60], [150, -80], [185, -20], [120, 10], [60, 0], [30, 45], [80, 85, 4], [150, 95, 6], [125, 145, 8], [0, 135, 5],
      [-80, 145, 2], [-160, 100], [-130, 40], [-185, 0]],
    items: [0.15, 0.4, 0.62, 0.85], pads: [[0.08, 0], [0.5, 0.4], [0.72, -0.4]],
  },
  {
    id: 't5', name: '눈꽃 산길', emoji: '❄️', theme: 'snow', targetSec: 150, scale: 0.894,
    desc: '높은 산을 오르내리는 눈길',
    pts: [[-120, -80], [0, -100, 2], [120, -80, 5], [165, -20, 9], [100, 22, 12], [20, 0, 14], [-45, 30, 14], [20, 72, 12], [120, 72, 9], [165, 120, 6],
      [60, 162, 4], [-60, 152, 2], [-140, 112], [-172, 30], [-160, -40]],
    items: [0.15, 0.38, 0.6, 0.84], pads: [[0.05, 0], [0.47, 0], [0.7, 0.4]],
  },
  {
    id: 't6', name: '반짝 밤도시', emoji: '🌃', theme: 'city', targetSec: 150, scale: 0.917,
    desc: '불빛 가득한 빌딩 사이 직각 코너',
    pts: [[-150, -100], [0, -100], [150, -100], [150, -30], [60, -30], [60, 40], [150, 40], [150, 110], [0, 110], [-60, 110], [-60, 30], [-150, 30]],
    items: [0.14, 0.4, 0.62, 0.86], pads: [[0.06, 0], [0.3, 0], [0.75, 0]],
  },
  {
    id: 't7', name: '단풍 숲길', emoji: '🍂', theme: 'autumn', targetSec: 150, scale: 0.952,
    desc: '알록달록 단풍나무 숲을 달려요',
    pts: [[-160, 0], [-120, -70], [-40, -90], [20, -50], [80, -100], [160, -70], [182, 10], [120, 60], [160, 120], [80, 162], [0, 120], [-60, 162],
      [-140, 120], [-110, 60]],
    items: [0.12, 0.36, 0.6, 0.83], pads: [[0.25, 0], [0.5, -0.4], [0.93, 0]],
  },
  {
    id: 't8', name: '불꽃 화산섬', emoji: '🌋', theme: 'volcano', targetSec: 150, scale: 1.248,
    desc: '연기 나는 화산을 한 바퀴',
    pts: [[-140, 0], [-100, -100, 3], [0, -145, 6], [100, -100, 8], [145, 0, 10], [85, 45, 8], [100, 100, 5], [0, 150, 3], [-60, 92, 2], [-120, 110, 1]],
    items: [0.14, 0.38, 0.62, 0.85], pads: [[0.06, 0], [0.5, 0], [0.74, 0.4]],
  },
  {
    id: 't9', name: '무지개 왕국', emoji: '🏰', theme: 'kingdom', targetSec: 240, scale: 1.534,
    desc: '성을 지나 다리 위아래로 8자 모양',
    pts: [[-60, 45, 10], [0, 0, 11], [60, -45, 10], [140, -90, 6], [230, -60, 2], [262, 20], [200, 92], [120, 92], [60, 45], [0, 0], [-60, -45],
      [-140, -90], [-230, -60, 2], [-262, 20, 5], [-200, 92, 8], [-120, 92, 10]],
    items: [0.1, 0.28, 0.46, 0.64, 0.82], pads: [[0.04, 0], [0.36, 0], [0.55, 0.4], [0.9, -0.4]],
  },
  {
    id: 't10', name: '우주 레인보우', emoji: '🌌', theme: 'space', targetSec: 240, scale: 1.447,
    desc: '별 사이를 달리는 무지개 길',
    pts: [[-200, 0], [-150, -120, 10], [0, -160, 20], [150, -120, 15], [220, -20, 8], [140, 40, 4], [200, 120, 10], [100, 180, 18], [-20, 120, 12],
      [-100, 180, 6], [-220, 130, 2]],
    items: [0.1, 0.28, 0.46, 0.64, 0.82], pads: [[0.05, 0], [0.22, 0.4], [0.54, -0.4], [0.74, 0], [0.92, 0]],
  },
];
export const trackById = (id) => TRACKS.find((t) => t.id === id);

// Centripetal Catmull-Rom between p1 and p2 (points are [x, y, z]).
function crPoint(p0, p1, p2, p3, u) {
  const knot = (p, q) => Math.max(1e-4, Math.sqrt(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])));
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const lerp = (a, b, ta, tb) => a.map((v, k) => ((tb - t) / (tb - ta)) * v + ((t - ta) / (tb - ta)) * b[k]);
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/**
 * Turns a track definition into evenly spaced samples along the center line.
 * Arrays are indexed by sample; n is the unit vector to the driver's right.
 */
export function buildTrack(def, scale = def.scale) {
  const pts = def.pts.map(([x, z, y = 0]) => [x * scale, y, z * scale]);
  const count = pts.length;
  const dense = [];
  const STEPS = 120;
  for (let i = 0; i < count; i++) {
    const p0 = pts[(i - 1 + count) % count];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % count];
    const p3 = pts[(i + 2) % count];
    for (let s = 0; s < STEPS; s++) dense.push(crPoint(p0, p1, p2, p3, s / STEPS));
  }
  dense.push(dense[0]);
  // Even out the line first, then round off corners tighter than MIN_RADIUS (a road 16m wide folds
  // over itself on the inside of a hairpin), then sample it again evenly.
  const even = resample(dense, SPACING);
  smoothCorners(even);
  return finish(def, even);
}

const MIN_RADIUS = 20;

/** Closed polyline → points every `step` meters (x/z distance). The result isn't closed (last != first). */
function resample(line, step) {
  const pts = line[line.length - 1] === line[0] ? line : [...line, line[0]];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[2] - a[2]));
  }
  const length = cum[cum.length - 1];
  const N = Math.round(length / step);
  const spacing = length / N;
  const out = [];
  let j = 0;
  for (let k = 0; k < N; k++) {
    const s = k * spacing;
    while (cum[j + 1] < s) j++;
    const f = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    const a = pts[j];
    const b = pts[j + 1];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
  }
  return out;
}

/** Radius of the circle through the points w samples before and after i (x/z). */
function radiusAt(pts, i, w) {
  const n = pts.length;
  const a = pts[(i - w + n) % n];
  const b = pts[i];
  const c = pts[(i + w) % n];
  const ab = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const bc = Math.hypot(c[0] - b[0], c[2] - b[2]);
  const ca = Math.hypot(a[0] - c[0], a[2] - c[2]);
  const cross = Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]));
  return cross < 1e-9 ? Infinity : (ab * bc * ca) / (2 * cross);
}

function smoothCorners(pts) {
  const n = pts.length;
  for (let round = 0; round < 600; round++) {
    const mark = new Uint8Array(n);
    let any = false;
    for (let i = 0; i < n; i++) {
      if (radiusAt(pts, i, 4) >= MIN_RADIUS) continue;
      any = true;
      for (let k = -12; k <= 12; k++) mark[(i + k + n) % n] = 1;
    }
    if (!any) break;
    // Relax the points around each tight spot (x/z only; heights keep their own smooth curve).
    const copy = pts.map((p) => p.slice());
    for (let i = 0; i < n; i++) {
      if (!mark[i]) continue;
      const a = copy[(i - 1 + n) % n];
      const c = copy[(i + 1) % n];
      pts[i][0] = copy[i][0] * 0.5 + (a[0] + c[0]) * 0.25;
      pts[i][2] = copy[i][2] * 0.5 + (a[2] + c[2]) * 0.25;
    }
  }
}

function finish(def, line) {
  const even = resample(line, SPACING);
  const N = even.length;
  let length = 0;
  for (let k = 0; k < N; k++) {
    const a = even[k];
    const b = even[(k + 1) % N];
    length += Math.hypot(b[0] - a[0], b[2] - a[2]);
  }
  const spacing = length / N;
  const px = new Float32Array(N);
  const py = new Float32Array(N);
  const pz = new Float32Array(N);
  for (let k = 0; k < N; k++) [px[k], py[k], pz[k]] = even[k];
  const tx = new Float32Array(N);
  const tz = new Float32Array(N);
  const nx = new Float32Array(N);
  const nz = new Float32Array(N);
  const heading = new Float32Array(N);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let k = 0; k < N; k++) {
    const a = (k - 1 + N) % N;
    const b = (k + 1) % N;
    let dx = px[b] - px[a];
    let dz = pz[b] - pz[a];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    tx[k] = dx;
    tz[k] = dz;
    nx[k] = -dz;
    nz[k] = dx;
    heading[k] = Math.atan2(dx, dz);
    minX = Math.min(minX, px[k]);
    maxX = Math.max(maxX, px[k]);
    minZ = Math.min(minZ, pz[k]);
    maxZ = Math.max(maxZ, pz[k]);
  }
  const at = (fraction) => Math.round(fraction * N) % N;
  return {
    def,
    N,
    spacing,
    length,
    px, py, pz, tx, tz, nx, nz, heading,
    hw: HALF_WIDTH,
    wall: WALL,
    bounds: { minX, maxX, minZ, maxZ },
    items: (def.items ?? []).map((f) => at(f)),
    pads: (def.pads ?? []).map(([f, side]) => ({ i: at(f), lat: side * (HALF_WIDTH - 3) })),
  };
}

/** Starting position for grid slot k (two columns behind the start line). */
export function gridSlot(track, k) {
  const back = 8 + Math.floor(k / 2) * 8;
  const lat = (k % 2 ? 1 : -1) * 3.6;
  const i = (track.N - Math.round(back / track.spacing)) % track.N;
  return {
    i,
    x: track.px[i] + track.nx[i] * lat,
    z: track.pz[i] + track.nz[i] * lat,
    y: track.py[i],
    yaw: track.heading[i],
  };
}

export const MAX_RACERS = 8;

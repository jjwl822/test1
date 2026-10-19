/*
 * 가족 레이스: 3D 모습 (트랙·풍경·자동차). 움직임은 physics.js, 게임 진행은 game.js 에 있습니다.
 */
import * as THREE from './vendor/three.min.js';
import { CURB } from './tracks.js';

// ---- Themes ---------------------------------------------------------------------------------

export const THEMES = {
  park: { sky: ['#4fa8ff', '#d6efff'], ground: '#5cb85c', ground2: '#4ea64e', shoulder: '#d9c58f', road: '#5b6068', wall: ['#ffffff', '#1e88e5'],
    mountain: '#6da86d', fog: [180, 900], scenery: [['tree', 260], ['bush', 120], ['flower', 160]] },
  beach: { sky: ['#2f9cff', '#e6f7ff'], ground: '#f3d9a0', ground2: '#ead09a', shoulder: '#f7e3b5', road: '#60656d', wall: ['#ffffff', '#00acc1'],
    mountain: '#c9ab72', fog: [200, 1000], sea: '#1e9be0', island: 90, scenery: [['palm', 200], ['rock', 60], ['umbrella', 40]] },
  candy: { sky: ['#ff8ccc', '#ffe9f6'], ground: '#ffc6e5', ground2: '#ffb8dd', shoulder: '#fff0f8', road: '#8a5a44', wall: ['#ffffff', '#ff4fa3'],
    mountain: '#ffd6ef', fog: [180, 900], scenery: [['lollipop', 160], ['gumdrop', 200], ['cupcake', 50]] },
  desert: { sky: ['#f0974a', '#ffe4bd'], ground: '#e4bb78', ground2: '#d9ae6a', shoulder: '#ecc98d', road: '#76695c', wall: ['#ffffff', '#ff7043'],
    mountain: '#c46f42', mesa: true, fog: [200, 1000], scenery: [['cactus', 180], ['rock', 120], ['skull', 10]] },
  snow: { sky: ['#8fbde6', '#f0f7ff'], ground: '#f4f8fc', ground2: '#e6eef6', shoulder: '#ffffff', road: '#69727d', wall: ['#ffffff', '#1e88e5'],
    mountain: '#ffffff', fog: [150, 800], snowfall: true, scenery: [['pine', 320], ['snowman', 14], ['rock', 40]] },
  city: { sky: ['#070b26', '#2a2f63'], ground: '#2b2f3a', ground2: '#262a33', shoulder: '#3a3f4b', road: '#383b44', wall: ['#ffeb3b', '#212121'],
    mountain: '#151933', fog: [160, 800], night: true, lamps: true, scenery: [['building', 200], ['tower', 30]] },
  autumn: { sky: ['#78b4e6', '#fde6cc'], ground: '#a4813f', ground2: '#94733a', shoulder: '#c99a4d', road: '#5f6268', wall: ['#ffffff', '#f4511e'],
    mountain: '#b06a2c', fog: [170, 900], scenery: [['autumnTree', 300], ['pumpkin', 30], ['bush', 60]] },
  volcano: { sky: ['#2b1414', '#ff8a50'], ground: '#3e3030', ground2: '#352828', shoulder: '#4e3b36', road: '#4a4a4f', wall: ['#ffab00', '#222222'],
    mountain: '#2a1d1d', fog: [150, 800], sea: '#ff5a1f', seaGlow: true, island: 80, volcano: true, scenery: [['rock', 200], ['deadTree', 80], ['crystal', 40]] },
  kingdom: { sky: ['#5dbdff', '#e2f6ff'], ground: '#76c766', ground2: '#69b85a', shoulder: '#e3d29c', road: '#6b6f78', wall: ['#ffffff', '#7e57c2'],
    mountain: '#7fb07a', fog: [220, 1100], castle: true, scenery: [['tree', 240], ['flag', 40], ['flower', 140], ['pine', 80]] },
  space: { sky: ['#03000c', '#1d0f45'], space: true, road: '#ffffff', wall: ['#00e5ff', '#ff4081'], fog: null, scenery: [] },
};

// ---- Textures -------------------------------------------------------------------------------

function canvasTexture(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function noise(ctx, w, h, count, alpha, light = true) {
  for (let i = 0; i < count; i++) {
    const v = Math.random();
    ctx.fillStyle = light ? `rgba(255,255,255,${alpha * v})` : `rgba(0,0,0,${alpha * v})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

function roadTexture(color) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, 2500, 0.12);
    noise(ctx, w, h, 2500, 0.15, false);
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(w * 0.035, 0, w * 0.025, h);
    ctx.fillRect(w * 0.94, 0, w * 0.025, h);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillRect(w * 0.49, 0, w * 0.02, h * 0.5);
  });
}

function rainbowTexture() {
  return canvasTexture(256, 64, (ctx, w, h) => {
    const colors = ['#ff1744', '#ff9100', '#ffea00', '#00e676', '#00b0ff', '#651fff', '#d500f9'];
    const sw = w / colors.length;
    colors.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(i * sw, 0, sw + 1, h);
    });
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.fillRect(0, 0, w, 6);
  });
}

function stripeTexture(a, b, n = 2) {
  return canvasTexture(16, 64, (ctx, w, h) => {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 ? b : a;
      ctx.fillRect(0, (i * h) / n, w, h / n);
    }
  });
}

/** Barrier panels: long blocks of two colors with a dark rail along the top. */
function wallTexture(a, b) {
  return canvasTexture(32, 64, (ctx, w, h) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, w, h / 2);
    ctx.fillStyle = b;
    ctx.fillRect(0, h / 2, w, h / 2);
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.fillRect(0, 0, w, 2);
    ctx.fillRect(0, h / 2, w, 2);
    ctx.fillStyle = '#2b2b33';
    ctx.fillRect(w * 0.8, 0, w * 0.2, h);
  });
}

function groundTexture(a, b) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = b;
      ctx.globalAlpha = 0.25 + Math.random() * 0.35;
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, 6 + Math.random() * 22, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    noise(ctx, w, h, 3000, 0.08);
    noise(ctx, w, h, 3000, 0.08, false);
  });
}

function checkerTexture(cols = 8, rows = 2) {
  return canvasTexture(256, 64, (ctx, w, h) => {
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
        ctx.fillRect((x * w) / cols, (y * h) / rows, w / cols + 1, h / rows + 1);
      }
    }
  }, false);
}

function itemTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#ff5ec4');
    g.addColorStop(0.5, '#ffd740');
    g.addColorStop(1, '#40c4ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 92px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', w / 2, h / 2 + 6);
  }, false);
}

function padTexture() {
  return canvasTexture(64, 128, (ctx, w, h) => {
    ctx.fillStyle = '#ff6d00';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffea00';
    for (let k = 0; k < 2; k++) {
      const y = k * 64 + 8;
      ctx.beginPath();
      ctx.moveTo(4, y + 40);
      ctx.lineTo(w / 2, y + 8);
      ctx.lineTo(w - 4, y + 40);
      ctx.lineTo(w - 4, y + 56);
      ctx.lineTo(w / 2, y + 24);
      ctx.lineTo(4, y + 56);
      ctx.fill();
    }
  });
}

function windowTexture() {
  return canvasTexture(64, 128, (ctx, w, h) => {
    ctx.fillStyle = '#1a1d2b';
    ctx.fillRect(0, 0, w, h);
    for (let y = 4; y < h; y += 10) {
      for (let x = 4; x < w; x += 12) {
        const on = Math.random() < 0.55;
        ctx.fillStyle = on ? ['#ffe082', '#fff3c4', '#80deea', '#ffcc80'][Math.floor(Math.random() * 4)] : '#2c3044';
        ctx.fillRect(x, y, 7, 6);
      }
    }
  });
}

function blobTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, false);
}

function glowTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, false);
}

let shared = null;
function sharedTextures() {
  shared ??= { blob: blobTexture(), glow: glowTexture(), item: itemTexture(), checker: checkerTexture() };
  return shared;
}

// ---- Geometry helpers ------------------------------------------------------------------------

/** A strip along the track. edge(i, side) gives [x, y, z] for sample i on side 0/1. */
function strip(track, edgeA, edgeB, vScale) {
  const { N } = track;
  const pos = new Float32Array((N + 1) * 2 * 3);
  const uv = new Float32Array((N + 1) * 2 * 2);
  for (let k = 0; k <= N; k++) {
    const i = k % N;
    const a = edgeA(i);
    const b = edgeB(i);
    pos.set(a, k * 6);
    pos.set(b, k * 6 + 3);
    const v = (k * track.spacing) / vScale;
    uv.set([0, v, 1, v], k * 4);
  }
  // Face upward whichever side edgeA is on: check which way the first quad's normal points.
  const p = (n) => new THREE.Vector3(pos[n * 3], pos[n * 3 + 1], pos[n * 3 + 2]);
  const up = p(1).sub(p(0)).cross(p(2).sub(p(0))).y >= 0;
  const index = [];
  for (let k = 0; k < N; k++) {
    const a = k * 2;
    if (up) index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    else index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const sidePoint = (track, i, off, y) => [track.px[i] + track.nx[i] * off, y, track.pz[i] + track.nz[i] * off];

/** Spatial hash of track samples for "is this spot near the road?" checks. */
function sampleGrid(track, cell = 20) {
  const map = new Map();
  for (let i = 0; i < track.N; i++) {
    const key = `${Math.floor(track.px[i] / cell)},${Math.floor(track.pz[i] / cell)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(i);
  }
  return {
    /** nearest sample within r, or -1 */
    near(x, z, r, filter) {
      const cx = Math.floor(x / cell);
      const cz = Math.floor(z / cell);
      const span = Math.ceil(r / cell);
      let best = -1;
      let bestD = r * r;
      for (let a = -span; a <= span; a++) {
        for (let b = -span; b <= span; b++) {
          for (const i of map.get(`${cx + a},${cz + b}`) ?? []) {
            if (filter && !filter(i)) continue;
            const d = (track.px[i] - x) ** 2 + (track.pz[i] - z) ** 2;
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
      }
      return best;
    },
  };
}

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---- Scenery pieces: each is a list of parts sharing one transform per instance ----------------

const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, ...extra });

function geo(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = null) {
  g.rotateX(rx);
  g.rotateY(ry);
  g.rotateZ(rz);
  if (s) g.scale(...s);
  g.translate(x, y, z);
  return g;
}

/** [{ geometry, material, colors? }] and the footprint radius */
function sceneryParts(kind) {
  switch (kind) {
    case 'tree':
      return { r: 4, parts: [
        { g: geo(new THREE.CylinderGeometry(0.35, 0.5, 3, 6), 0, 1.5), m: lam('#7b5233') },
        { g: geo(new THREE.IcosahedronGeometry(2.6, 0), 0, 4.6), m: lam('#ffffff'), colors: ['#3f9b3f', '#58b14a', '#2f8a3a', '#6cbf4f'] },
      ] };
    case 'autumnTree':
      return { r: 4, parts: [
        { g: geo(new THREE.CylinderGeometry(0.35, 0.5, 3, 6), 0, 1.5), m: lam('#6d4428') },
        { g: geo(new THREE.IcosahedronGeometry(2.7, 0), 0, 4.7), m: lam('#ffffff'), colors: ['#e65100', '#f9a825', '#c62828', '#ef6c00', '#ffb300'] },
      ] };
    case 'pine':
      return { r: 3.5, parts: [
        { g: geo(new THREE.CylinderGeometry(0.3, 0.4, 2, 6), 0, 1), m: lam('#6b4a2f') },
        { g: geo(new THREE.ConeGeometry(2.6, 4.5, 7), 0, 3.6), m: lam('#2e6b3a') },
        { g: geo(new THREE.ConeGeometry(1.9, 3.4, 7), 0, 6.0), m: lam('#ffffff'), colors: ['#ffffff', '#e8f5e9', '#3a7d46'] },
      ] };
    case 'bush':
      return { r: 2, parts: [{ g: geo(new THREE.IcosahedronGeometry(1.4, 0), 0, 0.9, 0, 0, 0, 0, [1.3, 0.8, 1.1]), m: lam('#ffffff'), colors: ['#4caf50', '#689f38', '#7cb342'] }] };
    case 'flower':
      return { r: 1, parts: [
        { g: geo(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 4), 0, 0.4), m: lam('#33691e') },
        { g: geo(new THREE.IcosahedronGeometry(0.35, 0), 0, 0.9), m: lam('#ffffff'), colors: ['#ff4081', '#ffeb3b', '#ffffff', '#e040fb', '#ff7043'] },
      ] };
    case 'palm':
      return { r: 3.5, parts: [
        { g: geo(new THREE.CylinderGeometry(0.25, 0.45, 7, 6), 0.8, 3.5, 0, 0, 0, -0.18), m: lam('#a1774a') },
        { g: geo(new THREE.ConeGeometry(3.4, 1.4, 6), 1.5, 7.2, 0), m: lam('#ffffff'), colors: ['#2e9d48', '#43a047', '#5cb85c'] },
      ] };
    case 'umbrella':
      return { r: 2, parts: [
        { g: geo(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 4), 0, 1.3), m: lam('#eeeeee') },
        { g: geo(new THREE.ConeGeometry(1.6, 0.7, 8), 0, 2.7), m: lam('#ffffff'), colors: ['#ff5252', '#ffeb3b', '#40c4ff', '#ffffff'] },
      ] };
    case 'rock':
      return { r: 2.5, parts: [{ g: geo(new THREE.DodecahedronGeometry(1.6, 0), 0, 0.8, 0, 0, 0, 0, [1.2, 0.8, 1]), m: lam('#ffffff'), colors: ['#8d8d8d', '#a1887f', '#757575'] }] };
    case 'lollipop':
      return { r: 2, parts: [
        { g: geo(new THREE.CylinderGeometry(0.12, 0.12, 4, 5), 0, 2), m: lam('#ffffff') },
        { g: geo(new THREE.CylinderGeometry(1.5, 1.5, 0.4, 14), 0, 4.8, 0, Math.PI / 2), m: lam('#ffffff'), colors: ['#ff4081', '#7c4dff', '#00e5ff', '#ffea00', '#69f0ae'] },
      ] };
    case 'gumdrop':
      return { r: 2, parts: [{ g: geo(new THREE.SphereGeometry(1.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)), m: lam('#ffffff'), colors: ['#ff5252', '#ffd740', '#69f0ae', '#40c4ff', '#e040fb'] }] };
    case 'cupcake':
      return { r: 3, parts: [
        { g: geo(new THREE.CylinderGeometry(2, 1.5, 2, 10), 0, 1), m: lam('#ffffff'), colors: ['#ffab91', '#ce93d8', '#90caf9'] },
        { g: geo(new THREE.SphereGeometry(2.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 2), m: lam('#fff3f8') },
        { g: geo(new THREE.SphereGeometry(0.45, 8, 6), 0, 4.3), m: lam('#e53935') },
      ] };
    case 'cactus':
      return { r: 2, parts: [
        { g: geo(new THREE.CylinderGeometry(0.5, 0.55, 5, 7), 0, 2.5), m: lam('#4f8f3a') },
        { g: geo(new THREE.CylinderGeometry(0.32, 0.32, 1.8, 6), 1.0, 2.8, 0, 0, 0, Math.PI / 2.4), m: lam('#4f8f3a') },
        { g: geo(new THREE.CylinderGeometry(0.3, 0.3, 1.6, 6), -0.9, 3.4, 0, 0, 0, -Math.PI / 2.6), m: lam('#5b9c43') },
      ] };
    case 'skull':
      return { r: 2, parts: [{ g: geo(new THREE.SphereGeometry(0.9, 8, 6), 0, 0.6), m: lam('#f5f0e1') }] };
    case 'snowman':
      return { r: 2, parts: [
        { g: geo(new THREE.SphereGeometry(1.2, 10, 8), 0, 1.1), m: lam('#ffffff') },
        { g: geo(new THREE.SphereGeometry(0.8, 10, 8), 0, 2.7), m: lam('#ffffff') },
        { g: geo(new THREE.ConeGeometry(0.15, 0.7, 6), 0, 2.8, 0.85, Math.PI / 2), m: lam('#ff7043') },
        { g: geo(new THREE.CylinderGeometry(0.55, 0.55, 0.7, 10), 0, 3.6), m: lam('#212121') },
      ] };
    case 'building':
      return { r: 9, building: true, parts: [] };
    case 'tower':
      return { r: 8, building: true, tall: true, parts: [] };
    case 'pumpkin':
      return { r: 1.5, parts: [
        { g: geo(new THREE.SphereGeometry(0.9, 10, 8), 0, 0.7, 0, 0, 0, 0, [1.2, 0.85, 1.2]), m: lam('#ef6c00') },
        { g: geo(new THREE.CylinderGeometry(0.1, 0.12, 0.4, 5), 0, 1.5), m: lam('#4e342e') },
      ] };
    case 'deadTree':
      return { r: 2, parts: [
        { g: geo(new THREE.CylinderGeometry(0.2, 0.4, 5, 5), 0, 2.5), m: lam('#2b211d') },
        { g: geo(new THREE.CylinderGeometry(0.1, 0.18, 2.2, 4), 0.8, 3.8, 0, 0, 0, -0.8), m: lam('#2b211d') },
      ] };
    case 'crystal':
      return { r: 2, parts: [{ g: geo(new THREE.OctahedronGeometry(1.2, 0), 0, 1.4, 0, 0, 0, 0, [0.7, 1.6, 0.7]), m: basic('#ffffff'), colors: ['#ff6e40', '#ffab40', '#ff3d00'] }] };
    case 'flag':
      return { r: 1.5, parts: [
        { g: geo(new THREE.CylinderGeometry(0.08, 0.08, 6, 4), 0, 3), m: lam('#eeeeee') },
        { g: geo(new THREE.PlaneGeometry(1.8, 1.1), 0.9, 5.3, 0), m: lam('#ffffff', { side: THREE.DoubleSide }), colors: ['#e53935', '#1e88e5', '#fdd835', '#8e24aa'] },
      ] };
    default:
      return { r: 2, parts: [] };
  }
}

// ---- World ----------------------------------------------------------------------------------

/**
 * Builds everything for a race on `track` into a new THREE.Scene.
 * Returns { scene, items, update(dt, t), hideItem(row, k) }.
 */
export function createWorld(track) {
  const theme = THEMES[track.def.theme] ?? THEMES.park;
  const scene = new THREE.Scene();
  const tex = sharedTextures();
  const { bounds } = track;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const radius = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2;
  const grid = sampleGrid(track);
  const animated = [];

  // Sky dome with a vertical gradient
  {
    const g = new THREE.SphereGeometry(1800, 24, 16);
    const top = new THREE.Color(theme.sky[0]);
    const bottom = new THREE.Color(theme.sky[1]);
    const colors = [];
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = Math.max(0, Math.min(1, p.getY(i) / 900 + 0.15));
      const c = bottom.clone().lerp(top, Math.pow(t, 0.7));
      colors.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.position.set(cx, 0, cz);
    sky.renderOrder = -1;
    scene.add(sky);
    animated.push(() => sky.position.copy(scene.userData.cameraPos ?? sky.position));
  }
  if (theme.fog) scene.fog = new THREE.Fog(theme.sky[1], theme.fog[0], theme.fog[1]);

  // Light
  if (theme.night) {
    scene.add(new THREE.HemisphereLight('#8090ff', '#202030', 0.9));
    const sun = new THREE.DirectionalLight('#c8d0ff', 0.6);
    sun.position.set(-1, 2, 1);
    scene.add(sun);
  } else if (theme.space) {
    scene.add(new THREE.HemisphereLight('#c0b0ff', '#301050', 1.1));
    const sun = new THREE.DirectionalLight('#ffffff', 0.9);
    sun.position.set(1, 2, -1);
    scene.add(sun);
  } else {
    scene.add(new THREE.HemisphereLight('#ffffff', theme.ground, 1.25));
    const sun = new THREE.DirectionalLight('#fff4e0', 1.5);
    sun.position.set(0.6, 1, 0.35);
    scene.add(sun);
  }

  // Ground (an island in the sea for beach / volcano)
  if (!theme.space) {
    const size = radius * 2 + 700;
    const groundTex = groundTexture(theme.ground, theme.ground2);
    groundTex.repeat.set(size / 40, size / 40);
    let groundGeo;
    if (theme.sea) {
      groundGeo = new THREE.CircleGeometry(radius + theme.island + 30, 48);
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), theme.seaGlow ? basic(theme.sea) : lam(theme.sea));
      sea.rotation.x = -Math.PI / 2;
      sea.position.set(cx, -0.6, cz);
      scene.add(sea);
      if (!theme.seaGlow) {
        const foam = new THREE.Mesh(new THREE.RingGeometry(radius + theme.island + 26, radius + theme.island + 36, 48), basic('#ffffff', { transparent: true, opacity: 0.6 }));
        foam.rotation.x = -Math.PI / 2;
        foam.position.set(cx, -0.45, cz);
        scene.add(foam);
      }
    } else {
      groundGeo = new THREE.PlaneGeometry(size, size);
    }
    const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ map: groundTex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, 0, cz);
    if (theme.sea) groundTex.repeat.set((radius * 2 + 300) / 40, (radius * 2 + 300) / 40);
    scene.add(ground);
  }

  // Mountains / mesas on the horizon
  if (theme.mountain && !theme.sea) {
    const mat = lam(theme.mountain);
    const count = 28;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + rand(-0.08, 0.08);
      const d = radius + rand(330, 480);
      const h = rand(70, 170);
      const m = theme.mesa
        ? new THREE.Mesh(new THREE.CylinderGeometry(rand(40, 70), rand(70, 100), h * 0.6, 7), mat)
        : new THREE.Mesh(new THREE.ConeGeometry(rand(80, 130), h, 6), mat);
      m.position.set(cx + Math.cos(a) * d, (theme.mesa ? h * 0.3 : h / 2) - 2, cz + Math.sin(a) * d);
      m.rotation.y = rand(0, Math.PI);
      scene.add(m);
      if (theme.mountain === '#ffffff' || theme.snowfall) continue;
      if (!theme.mesa && !theme.night && h > 120) {
        const cap = new THREE.Mesh(new THREE.ConeGeometry(m.geometry.parameters.radius * 0.32, h * 0.32, 6), lam('#ffffff'));
        cap.position.copy(m.position).add(new THREE.Vector3(0, h * 0.34, 0));
        cap.rotation.y = m.rotation.y;
        scene.add(cap);
      }
    }
  }

  // Which parts of the road pass over another part (bridges): no embankment there, pillars instead.
  const bridge = new Uint8Array(track.N);
  for (let i = 0; i < track.N; i++) {
    const y = track.py[i];
    if (y < 3) continue;
    const j = grid.near(track.px[i], track.pz[i], track.wall * 2 + y * 2.2 + 6, (j) => track.py[j] < y - 4);
    if (j >= 0) bridge[i] = 1;
  }
  // widen the bridge marks a little so slopes don't cut into the road below
  const wide = bridge.slice();
  for (let i = 0; i < track.N; i++) if (bridge[i]) for (let k = -10; k <= 10; k++) wide[(i + k + track.N) % track.N] = 1;

  // Road
  const hw = track.hw;
  const w = track.wall;
  // Cars stop when their center reaches w; the barrier is drawn where the side of the car touches it.
  const wr = w + 1.1;
  const lift = (i) => track.py[i] + 0.04;
  if (theme.space) {
    const rb = rainbowTexture();
    const road = new THREE.Mesh(
      strip(track, (i) => sidePoint(track, i, -wr, lift(i)), (i) => sidePoint(track, i, wr, lift(i)), 40),
      new THREE.MeshBasicMaterial({ map: rb, side: THREE.DoubleSide }),
    );
    rb.repeat.set(1, 1);
    scene.add(road);
    animated.push((dt, t) => (rb.offset.y = -t * 0.15));
  } else {
    const roadTex = roadTexture(theme.road);
    scene.add(new THREE.Mesh(
      strip(track, (i) => sidePoint(track, i, -hw, lift(i)), (i) => sidePoint(track, i, hw, lift(i)), 16),
      new THREE.MeshLambertMaterial({ map: roadTex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    ));
    const curbTex = stripeTexture('#ffffff', theme.night ? '#ffeb3b' : '#e53935');
    const curbMat = new THREE.MeshLambertMaterial({ map: curbTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (const s of [-1, 1]) {
      scene.add(new THREE.Mesh(strip(track, (i) => sidePoint(track, i, s * hw, lift(i) + 0.02), (i) => sidePoint(track, i, s * (hw + CURB), lift(i) + 0.02), 4), curbMat));
      const shoulderMat = new THREE.MeshLambertMaterial({ color: theme.shoulder, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      scene.add(new THREE.Mesh(strip(track, (i) => sidePoint(track, i, s * (hw + CURB), lift(i) - 0.01), (i) => sidePoint(track, i, s * wr, lift(i) - 0.01), 8), shoulderMat));
    }
  }

  // Barriers
  {
    const wallTex = wallTexture(theme.wall[0], theme.wall[1]);
    const mat = theme.space
      ? new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
      : new THREE.MeshLambertMaterial({ map: wallTex, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const off = s * wr;
      scene.add(new THREE.Mesh(strip(track, (i) => sidePoint(track, i, off, track.py[i]), (i) => sidePoint(track, i, off, track.py[i] + (theme.space ? 0.6 : 1.4)), 7), mat));
    }
  }

  // Embankments under raised road, pillars under bridges, a thin edge everywhere
  if (!theme.space) {
    const bankMat = new THREE.MeshLambertMaterial({ color: theme.ground2, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      scene.add(new THREE.Mesh(strip(track,
        (i) => sidePoint(track, i, s * wr, track.py[i]),
        (i) => (wide[i] || track.py[i] < 0.3 ? sidePoint(track, i, s * wr, Math.max(0, track.py[i] - 1.2)) : sidePoint(track, i, s * (wr + track.py[i] * 2.2), -0.05)),
        8), bankMat));
    }
  } else {
    const under = new THREE.MeshBasicMaterial({ color: '#2a1060', side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
    for (const s of [-1, 1]) {
      scene.add(new THREE.Mesh(strip(track, (i) => sidePoint(track, i, s * wr, track.py[i]), (i) => sidePoint(track, i, s * wr, track.py[i] - 1.5), 8), under));
    }
  }
  {
    const pillarMat = theme.space ? basic('#7c4dff') : lam('#b0a99f');
    const spots = [];
    for (let i = 0; i < track.N; i += 7) {
      if (!(wide[i] || theme.space) || track.py[i] < 2) continue;
      // not on top of the road underneath
      if (grid.near(track.px[i], track.pz[i], w + 3, (j) => track.py[j] < track.py[i] - 4) >= 0) continue;
      spots.push(i);
    }
    if (spots.length && !theme.space) {
      const g = new THREE.BoxGeometry(2.2, 1, 2.2);
      const inst = new THREE.InstancedMesh(g, pillarMat, spots.length);
      const m = new THREE.Matrix4();
      spots.forEach((i, k) => {
        const h = track.py[i];
        m.compose(new THREE.Vector3(track.px[i], h / 2, track.pz[i]), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
        inst.setMatrixAt(k, m);
      });
      scene.add(inst);
    }
  }

  // Start / finish line and gantry
  {
    const i0 = 0;
    // Lying flat, the plane's width (x) runs across the road once the group faces along the track.
    const line = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 2.4), new THREE.MeshLambertMaterial({ map: tex.checker, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    line.rotation.x = -Math.PI / 2;
    const lineGroup = new THREE.Group();
    lineGroup.add(line);
    lineGroup.position.set(track.px[i0], track.py[i0] + 0.08, track.pz[i0]);
    lineGroup.rotation.y = track.heading[i0];
    scene.add(lineGroup);

    const gantry = new THREE.Group();
    const postMat = lam('#eeeeee');
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 0.8), postMat);
      post.position.set(s * (wr + 0.6), 4, 0);
      gantry.add(post);
    }
    const bannerTex = canvasTexture(512, 64, (ctx, cw, ch) => {
      ctx.fillStyle = '#d81b60';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 40px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🏁 가족 레이스 🏁', cw / 2, ch / 2 + 2);
    }, false);
    const banner = new THREE.Mesh(new THREE.BoxGeometry((wr + 1) * 2, 1.8, 0.6), [postMat, postMat, postMat, postMat, new THREE.MeshBasicMaterial({ map: bannerTex }), new THREE.MeshBasicMaterial({ map: bannerTex })]);
    banner.position.set(0, 8, 0);
    gantry.add(banner);
    gantry.position.set(track.px[i0], track.py[i0], track.pz[i0]);
    gantry.rotation.y = track.heading[i0];
    scene.add(gantry);
  }

  // Boost pads
  {
    const pt = padTexture();
    pt.repeat.set(1, 2);
    const mat = new THREE.MeshBasicMaterial({ map: pt, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (const pad of track.pads) {
      const i = pad.i;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 8), mat);
      m.rotation.x = -Math.PI / 2;
      const g = new THREE.Group();
      g.add(m);
      g.position.set(track.px[i] + track.nx[i] * pad.lat, track.py[i] + 0.09, track.pz[i] + track.nz[i] * pad.lat);
      g.rotation.y = track.heading[i];
      scene.add(g);
    }
    animated.push((dt, t) => (pt.offset.y = -t * 1.5));
  }

  // Item boxes: rows across the road
  const items = [];
  {
    const g = new THREE.BoxGeometry(1.7, 1.7, 1.7);
    const mat = new THREE.MeshLambertMaterial({ map: tex.item, transparent: true, opacity: 0.88, emissive: '#444444' });
    track.items.forEach((i, row) => {
      for (let k = 0; k < 4; k++) {
        const lat = (-1.5 + k) * (hw / 2.2);
        const m = new THREE.Mesh(g, mat);
        const x = track.px[i] + track.nx[i] * lat;
        const z = track.pz[i] + track.nz[i] * lat;
        const y = track.py[i] + 1.4;
        m.position.set(x, y, z);
        m.rotation.set(0.6, k, 0.3);
        scene.add(m);
        items.push({ row, k, x, y, z, mesh: m, hiddenUntil: 0 });
      }
    });
    animated.push((dt, t) => {
      for (const it of items) {
        it.mesh.rotation.y += dt * 1.6;
        it.mesh.position.y = it.y + Math.sin(t * 2.5 + it.k) * 0.25;
        const show = t >= it.hiddenUntil;
        const target = show ? 1 : 0;
        const s = it.mesh.scale.x + (target - it.mesh.scale.x) * Math.min(1, dt * 8);
        it.mesh.scale.setScalar(Math.max(0.001, s));
        it.mesh.visible = s > 0.02;
      }
    });
  }

  // Landmark: the spot inside the track bounds farthest from the road
  const landmark = (() => {
    let best = null;
    let bestD = 0;
    for (let x = bounds.minX; x <= bounds.maxX; x += 8) {
      for (let z = bounds.minZ; z <= bounds.maxZ; z += 8) {
        let d = Infinity;
        for (let i = 0; i < track.N; i += 3) d = Math.min(d, Math.hypot(track.px[i] - x, track.pz[i] - z));
        if (d > bestD) {
          bestD = d;
          best = { x, z, r: d };
        }
      }
    }
    return best;
  })();
  const blocked = []; // circles scenery must avoid: { x, z, r }
  if (theme.volcano && landmark) {
    const r = Math.min(landmark.r - w - 6, 70);
    const h = r * 0.9;
    // A cut-off cone with a lava disc in the crater.
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.15, r, h * 0.86, 12, 1, true), lam('#3a2a26'));
    cone.position.set(landmark.x, (h * 0.86) / 2, landmark.z);
    scene.add(cone);
    const lava = new THREE.Mesh(new THREE.CircleGeometry(r * 0.16, 12), basic('#ff6d00'));
    lava.rotation.x = -Math.PI / 2;
    lava.position.set(landmark.x, h * 0.86, landmark.z);
    scene.add(lava);
    const smokeMat = new THREE.SpriteMaterial({ map: tex.glow, color: '#776a66', transparent: true, opacity: 0.5, depthWrite: false });
    const puffs = [];
    for (let k = 0; k < 8; k++) {
      const s = new THREE.Sprite(smokeMat);
      s.userData.phase = k / 8;
      scene.add(s);
      puffs.push(s);
    }
    animated.push((dt, t) => {
      for (const s of puffs) {
        const p = (t * 0.08 + s.userData.phase) % 1;
        s.position.set(landmark.x + Math.sin(p * 5 + s.userData.phase * 9) * 6, h * 0.86 + p * 60, landmark.z + p * 15);
        s.scale.setScalar(10 + p * 40);
        s.material.opacity = 0.5;
      }
    });
    blocked.push({ x: landmark.x, z: landmark.z, r: r + 4 });
  }
  if (theme.castle && landmark) {
    const castle = new THREE.Group();
    const stone = lam('#e0dcd2');
    const roof = lam('#7e57c2');
    const s = Math.min(1.6, (landmark.r - w - 8) / 22);
    const keep = new THREE.Mesh(new THREE.BoxGeometry(18, 14, 18), stone);
    keep.position.y = 7;
    castle.add(keep);
    const big = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 24, 10), stone);
    big.position.y = 12;
    castle.add(big);
    const bigRoof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 9, 10), roof);
    bigRoof.position.y = 28.5;
    castle.add(bigRoof);
    for (const [x, z] of [[-10, -10], [10, -10], [-10, 10], [10, 10]]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 18, 10), stone);
      t.position.set(x, 9, z);
      castle.add(t);
      const r = new THREE.Mesh(new THREE.ConeGeometry(3.4, 6, 10), roof);
      r.position.set(x, 21, z);
      castle.add(r);
    }
    const gate = new THREE.Mesh(new THREE.BoxGeometry(5, 7, 1), lam('#5d4037'));
    gate.position.set(0, 3.5, 9.1);
    castle.add(gate);
    castle.scale.setScalar(s);
    castle.position.set(landmark.x, 0, landmark.z);
    scene.add(castle);
    blocked.push({ x: landmark.x, z: landmark.z, r: 18 * s + 4 });
  }

  // Scenery
  const spread = radius + 160;
  for (const [kind, count] of theme.scenery) {
    const def = sceneryParts(kind);
    const spots = [];
    let tries = 0;
    while (spots.length < count && tries < count * 25) {
      tries++;
      const x = cx + rand(-spread, spread);
      const z = cz + rand(-spread, spread);
      if (theme.sea && Math.hypot(x - cx, z - cz) > radius + theme.island) continue;
      const clear = track.wall + 4.5 + def.r;
      if (grid.near(x, z, clear) >= 0) continue;
      if (blocked.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + def.r)) continue;
      // keep most things fairly close to the road, where they're seen
      if (grid.near(x, z, clear + (def.building ? 70 : 110)) < 0 && Math.random() < 0.75) continue;
      spots.push({ x, z, s: rand(0.75, 1.35), ry: rand(0, Math.PI * 2) });
      if (def.building) blocked.push({ x, z, r: def.r });
    }
    if (!spots.length) continue;
    if (def.building) {
      addBuildings(scene, spots, def.tall);
      continue;
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    for (const part of def.parts) {
      const inst = new THREE.InstancedMesh(part.g, part.m, spots.length);
      spots.forEach((p, k) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.ry);
        m.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
        inst.setMatrixAt(k, m);
        if (part.colors) inst.setColorAt(k, color.set(pick(part.colors)));
      });
      scene.add(inst);
    }
  }

  // Street lamps for the city
  if (theme.lamps) {
    const spots = [];
    for (let i = 0; i < track.N; i += Math.round(36 / track.spacing)) {
      for (const s of [-1, 1]) spots.push(sidePoint(track, i, s * (wr + 1.3), track.py[i]).concat([track.heading[i] + (s > 0 ? Math.PI : 0)]));
    }
    const pole = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(0.12, 0.15, 7, 5), 0, 3.5), lam('#555b66'), spots.length);
    const head = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(0.6, 0.3, 1.8), 0, 7, 0.7), basic('#fff59d'), spots.length);
    const glowMat = new THREE.SpriteMaterial({ map: tex.glow, color: '#ffe082', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    spots.forEach(([x, y, z, h], k) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h + Math.PI / 2);
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
      pole.setMatrixAt(k, m);
      head.setMatrixAt(k, m);
      if (k % 2 === 0) {
        const g = new THREE.Sprite(glowMat);
        g.position.set(x, y + 6.8, z);
        g.scale.setScalar(5);
        scene.add(g);
      }
    });
    scene.add(pole, head);
  }

  // Space: stars and planets
  if (theme.space) {
    const n = 2500;
    const pos = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(rand(700, 1500));
      pos.set([v.x + cx, v.y * 0.8, v.z + cz], k * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, fog: false })));
    const planets = [['#ff7043', 120, 300, -200, 500], ['#4fc3f7', 70, -500, 120, -300], ['#ce93d8', 50, 200, 260, -600], ['#fff176', 35, -300, -150, 450]];
    for (const [c, r, x, y, z] of planets) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.25 }));
      p.position.set(cx + x, y, cz + z);
      scene.add(p);
      if (r > 60) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(r * 1.4, r * 2, 48), basic('#ffe0b2', { side: THREE.DoubleSide, transparent: true, opacity: 0.6 }));
        ring.position.copy(p.position);
        ring.rotation.set(1.2, 0.3, 0);
        scene.add(ring);
      }
    }
  }

  // Snowfall around the camera
  if (theme.snowfall) {
    const n = 900;
    const pos = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) pos.set([rand(-60, 60), rand(0, 40), rand(-60, 60)], k * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const snow = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 0.25, transparent: true, opacity: 0.9 }));
    scene.add(snow);
    animated.push((dt) => {
      const c = scene.userData.cameraPos;
      if (!c) return;
      const a = g.attributes.position;
      for (let k = 0; k < n; k++) {
        let y = a.getY(k) - dt * 4;
        if (y < -2) y += 42;
        a.setY(k, y);
      }
      a.needsUpdate = true;
      snow.position.set(c.x, c.y - 10, c.z);
    });
  }

  return {
    scene,
    theme,
    items,
    update(dt, t) {
      for (const f of animated) f(dt, t);
    },
  };
}

/** Joins non-indexed copies of geometries (position, normal, uv) into one. */
function mergeGeometries(list) {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const size = parts[0].attributes[name].itemSize;
    const total = parts.reduce((n, g) => n + g.attributes[name].count, 0);
    const arr = new Float32Array(total * size);
    let at = 0;
    for (const g of parts) {
      arr.set(g.attributes[name].array, at);
      at += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

function addBuildings(scene, spots, tall) {
  const wt = windowTexture();
  const colors = ['#3d4466', '#4a3d66', '#2f4a5c', '#55476b'];
  const walls = colors.map(() => []);
  const roofs = [];
  const tips = [];
  const m = new THREE.Matrix4();
  for (const p of spots) {
    const wdt = rand(10, 16);
    const dep = rand(10, 16);
    const h = tall ? rand(60, 110) : rand(16, 48);
    m.makeRotationY(p.ry).setPosition(p.x, h / 2, p.z);
    // Sides get windows repeated by size; the roof is a separate dark slab.
    const sides = new THREE.BoxGeometry(wdt, h, dep);
    const uv = sides.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.round(wdt / 6), uv.getY(i) * Math.round(h / 10));
    walls[Math.floor(Math.random() * colors.length)].push(sides.applyMatrix4(m));
    roofs.push(new THREE.BoxGeometry(wdt + 0.4, 0.6, dep + 0.4).applyMatrix4(new THREE.Matrix4().makeRotationY(p.ry).setPosition(p.x, h + 0.3, p.z)));
    if (tall) tips.push(new THREE.CylinderGeometry(0.2, 0.2, 10, 4).translate(p.x, h + 5, p.z));
  }
  walls.forEach((list, k) => {
    if (!list.length) return;
    const mat = new THREE.MeshLambertMaterial({ color: colors[k], emissiveMap: wt, emissive: '#ffffff', emissiveIntensity: 0.9, map: wt });
    scene.add(new THREE.Mesh(mergeGeometries(list), mat));
  });
  scene.add(new THREE.Mesh(mergeGeometries(roofs), lam('#1b1e2b')));
  if (tips.length) scene.add(new THREE.Mesh(mergeGeometries(tips), basic('#ff1744')));
}

// ---- Cars -----------------------------------------------------------------------------------

function phong(color, extra = {}) {
  return new THREE.MeshPhongMaterial({ color, shininess: 60, flatShading: false, ...extra });
}

/** A kart for a CARS entry, facing +z, wheels on y = 0. */
export function makeCar(def) {
  const car = new THREE.Group();
  const body = new THREE.Group(); // tilts for steering / bumps
  car.add(body);
  const paint = phong(def.color);
  const accent = phong(def.accent);
  const dark = phong('#222428', { shininess: 20 });
  const chrome = phong('#cfd8dc', { shininess: 120 });
  const add = (g, m, x, y, z, parent = body) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const box = (w, h, d, m, x, y, z) => add(new THREE.BoxGeometry(w, h, d), m, x, y, z);

  let wheelR = 0.42;
  let wheelW = 0.36;
  let track = 0.95;
  let base = 1.05;
  let driverY = 0.95;
  let driverZ = -0.25;
  let flameZ = -1.75;
  let flameY = 0.5;

  switch (def.type) {
    case 'speedy':
      box(1.6, 0.42, 2.9, paint, 0, 0.5, 0);
      box(1.2, 0.3, 0.9, paint, 0, 0.42, 1.65).rotation.x = 0.18;
      box(1.9, 0.26, 1.0, accent, 0, 0.42, -0.4);
      box(0.12, 0.6, 0.12, dark, -0.5, 0.95, -1.35);
      box(0.12, 0.6, 0.12, dark, 0.5, 0.95, -1.35);
      box(1.8, 0.1, 0.5, paint, 0, 1.25, -1.4);
      break;
    case 'buggy': {
      wheelR = 0.55;
      wheelW = 0.42;
      track = 1.05;
      box(1.4, 0.2, 2.6, paint, 0, 0.55, 0);
      box(1.0, 0.45, 0.8, dark, 0, 0.8, -1.0);
      const bar = (x1, y1, z1, x2, y2, z2) => {
        const a = new THREE.Vector3(x1, y1, z1);
        const b = new THREE.Vector3(x2, y2, z2);
        const len = a.distanceTo(b);
        const m = add(new THREE.CylinderGeometry(0.06, 0.06, len, 6), accent, 0, 0, 0);
        m.position.copy(a).add(b).multiplyScalar(0.5);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      };
      bar(-0.6, 0.6, 0.6, -0.5, 1.75, 0.0);
      bar(0.6, 0.6, 0.6, 0.5, 1.75, 0.0);
      bar(-0.6, 0.6, -0.8, -0.5, 1.75, -0.4);
      bar(0.6, 0.6, -0.8, 0.5, 1.75, -0.4);
      bar(-0.5, 1.75, 0.0, 0.5, 1.75, 0.0);
      bar(-0.5, 1.75, -0.4, 0.5, 1.75, -0.4);
      bar(-0.5, 1.75, 0, -0.5, 1.75, -0.4);
      bar(0.5, 1.75, 0, 0.5, 1.75, -0.4);
      box(1.2, 0.15, 0.7, paint, 0, 0.75, 1.15);
      driverY = 1.05;
      break;
    }
    case 'formula':
      wheelW = 0.45;
      track = 1.0;
      base = 1.25;
      box(0.8, 0.4, 3.0, paint, 0, 0.5, -0.1);
      add(new THREE.ConeGeometry(0.32, 1.3, 8), paint, 0, 0.45, 1.95).rotation.x = Math.PI / 2;
      box(2.1, 0.07, 0.45, accent, 0, 0.25, 2.3);
      box(0.06, 0.7, 0.06, dark, 0, 0.95, -1.5);
      box(1.9, 0.08, 0.5, accent, 0, 1.3, -1.55);
      box(0.06, 0.4, 0.5, accent, -0.95, 1.15, -1.55);
      box(0.06, 0.4, 0.5, accent, 0.95, 1.15, -1.55);
      box(0.5, 0.35, 1.2, paint, -0.55, 0.45, -0.2);
      box(0.5, 0.35, 1.2, paint, 0.55, 0.45, -0.2);
      driverY = 0.85;
      flameZ = -1.9;
      break;
    case 'bubble': {
      wheelR = 0.36;
      track = 0.85;
      base = 0.95;
      const shell = add(new THREE.SphereGeometry(1, 20, 14), paint, 0, 0.75, 0);
      shell.scale.set(0.95, 0.55, 1.45);
      add(new THREE.SphereGeometry(0.22, 10, 8), accent, -0.45, 0.95, 1.2);
      add(new THREE.SphereGeometry(0.22, 10, 8), accent, 0.45, 0.95, 1.2);
      add(new THREE.TorusGeometry(0.35, 0.08, 6, 14), accent, 0, 1.05, -1.25);
      driverY = 1.15;
      driverZ = -0.1;
      break;
    }
    case 'jeep':
      wheelR = 0.5;
      track = 1.0;
      box(1.8, 0.7, 3.0, paint, 0, 0.85, 0);
      box(1.7, 0.18, 1.1, accent, 0, 1.25, 0.9);
      box(1.7, 0.08, 0.08, dark, 0, 1.9, -0.2);
      box(0.08, 0.7, 0.08, dark, -0.82, 1.55, -0.2);
      box(0.08, 0.7, 0.08, dark, 0.82, 1.55, -0.2);
      add(new THREE.TorusGeometry(0.35, 0.15, 6, 14), dark, 0, 1.0, -1.6);
      box(1.6, 0.25, 0.1, chrome, 0, 0.75, 1.52);
      driverY = 1.3;
      flameY = 0.6;
      break;
    case 'taxi':
      box(1.8, 0.6, 3.1, paint, 0, 0.75, 0);
      box(1.6, 0.55, 1.5, paint, 0, 1.3, -0.3);
      box(1.62, 0.35, 1.3, phong('#90caf9', { transparent: true, opacity: 0.7 }), 0, 1.33, -0.3);
      box(0.7, 0.3, 0.35, accent, 0, 1.75, -0.3);
      box(1.82, 0.12, 3.12, accent, 0, 0.62, 0);
      driverY = 1.55;
      driverZ = 0.15;
      break;
    case 'rocket': {
      const tube = add(new THREE.CylinderGeometry(0.6, 0.7, 2.8, 14), paint, 0, 0.75, -0.2);
      tube.rotation.x = Math.PI / 2;
      add(new THREE.ConeGeometry(0.6, 1.2, 14), accent, 0, 0.75, 1.8).rotation.x = Math.PI / 2;
      for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
        const fin = box(0.08, 0.9, 0.8, accent, Math.sin(a) * 0.7, 0.75 + Math.cos(a) * 0.7, -1.3);
        fin.rotation.z = -a;
      }
      flameZ = -1.85;
      flameY = 0.75;
      driverY = 1.25;
      break;
    }
    case 'monster':
      wheelR = 0.78;
      wheelW = 0.55;
      track = 1.15;
      base = 1.15;
      box(1.7, 0.7, 2.7, paint, 0, 1.55, 0);
      box(1.5, 0.6, 1.2, accent, 0, 2.1, -0.4);
      box(1.2, 0.2, 2.0, dark, 0, 1.05, 0);
      driverY = 2.35;
      driverZ = 0.4;
      flameY = 1.3;
      break;
    default:
      box(1.6, 0.5, 2.8, paint, 0, 0.5, 0);
  }

  // Driver
  const skin = phong('#ffcc9e');
  add(new THREE.BoxGeometry(0.6, 0.55, 0.45), accent, 0, driverY, driverZ);
  add(new THREE.SphereGeometry(0.3, 12, 10), skin, 0, driverY + 0.55, driverZ);
  const helmet = add(new THREE.SphereGeometry(0.34, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), paint, 0, driverY + 0.58, driverZ);
  helmet.scale.set(1, 1, 1.05);
  add(new THREE.BoxGeometry(0.42, 0.12, 0.08), dark, 0, driverY + 0.6, driverZ + 0.28);

  // Wheels (front ones turn)
  const wheels = [];
  const fronts = [];
  const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, wheelW, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(wheelR * 0.45, wheelR * 0.45, wheelW + 0.02, 8);
  hubGeo.rotateZ(Math.PI / 2);
  for (const [x, z, front] of [[-track, base, true], [track, base, true], [-track, -base, false], [track, -base, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, wheelR, z);
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(wheelGeo, dark));
    spin.add(new THREE.Mesh(hubGeo, chrome));
    pivot.add(spin);
    car.add(pivot);
    wheels.push(spin);
    if (front) fronts.push(pivot);
  }

  // Exhaust flame (shown while boosting)
  const flameMat = new THREE.MeshBasicMaterial({ color: '#ffab40', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.4, 10), flameMat);
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(0, flameY, flameZ - 0.6);
  flame.visible = false;
  body.add(flame);
  const flameCore = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.9, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }));
  flameCore.rotation.x = -Math.PI / 2;
  flameCore.position.set(0, flameY, flameZ - 0.4);
  flameCore.visible = false;
  body.add(flameCore);

  // Drift sparks at the back wheels
  const tex = sharedTextures();
  const sparkMat = new THREE.SpriteMaterial({ map: tex.glow, color: '#40c4ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const sparks = [-track, track].map((x) => {
    const s = new THREE.Sprite(sparkMat);
    s.position.set(x, 0.2, -base - 0.3);
    s.visible = false;
    car.add(s);
    return s;
  });

  // Shadow blob
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3, 4), new THREE.MeshBasicMaterial({ map: tex.blob, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.06;
  car.add(shadow);

  let roll = 0;
  car.userData = {
    /** steer -1..1, speed m/s, boost bool, drift -1/0/1, charge 0.. */
    animate(dt, { steer = 0, speed = 0, boost = false, drift = 0, charge = 0, t = 0 }) {
      for (const w of wheels) w.rotation.x += (speed / wheelR) * dt;
      for (const f of fronts) f.rotation.y = -steer * 0.45;
      roll += (steer * Math.min(1, speed / 25) * 0.07 + drift * 0.06 - roll) * Math.min(1, dt * 8);
      body.rotation.z = roll;
      body.rotation.y = drift * 0.25;
      body.position.y = Math.sin(t * 30) * 0.015 * Math.min(1, speed / 10);
      flame.visible = flameCore.visible = boost;
      if (boost) {
        const f = 0.8 + Math.random() * 0.5;
        flame.scale.set(1, f, 1);
        flame.position.z = flameZ - 0.6 * f;
      }
      const sparkOn = drift !== 0 && charge > 0.7;
      for (const s of sparks) {
        s.visible = sparkOn;
        if (sparkOn) s.scale.setScalar(0.6 + Math.random() * 0.6);
      }
      sparkMat.color.set(charge > 1.6 ? '#ff9100' : '#40c4ff');
    },
  };
  return car;
}

/** Floating name over a car. */
export function makeNameTag(text, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 34px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  const w = Math.min(248, ctx.measureText(text).width + 32);
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  const x = (256 - w) / 2;
  ctx.beginPath();
  ctx.roundRect(x, 8, w, 48, 24);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(x + 14, 26, 12, 12);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128 + 8, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(4, 1, 1);
  s.renderOrder = 10;
  return s;
}

/** Turntable scene for choosing a car in the lobby. */
export function createGarage() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1b2035');
  scene.add(new THREE.HemisphereLight('#ffffff', '#445', 1.3));
  const key = new THREE.DirectionalLight('#ffffff', 1.6);
  key.position.set(3, 5, 4);
  scene.add(key);
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.25, 40), lam('#2d3554'));
  floor.position.y = -0.13;
  scene.add(floor);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.05, 6, 60), basic('#7c8cff'));
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);
  let current = null;
  let id = null;
  return {
    scene,
    show(def) {
      if (id === def.id) return;
      if (current) scene.remove(current);
      current = makeCar(def);
      id = def.id;
      scene.add(current);
    },
    update(dt, t) {
      if (!current) return;
      current.rotation.y += dt * 0.6;
      current.userData.animate(dt, { speed: 0, t });
    },
  };
}

/*
 * 가족 레이스: 3D 모습 (트랙·풍경·자동차). 움직임은 physics.js, 게임 진행은 game.js 에 있습니다.
 * 그림체: 부드러운 단계 명암(툰 셰이딩) + 외곽선 + 실시간 그림자, 바람에 흔들리는 풀과 나무.
 */
import * as THREE from './vendor/three.min.js';
import { CURB } from './tracks.js';

// ---- Themes ---------------------------------------------------------------------------------
// sky: [top, middle, horizon]. objects: [kind, count] decorations placed around the track.

export const THEMES = {
  park: { sky: ['#3f8fe0', '#8ec8f5', '#e4f3fd'], ground: '#86c95e', ground2: '#74b952', shoulder: '#e6d39c', road: '#8a8784', wall: ['#fffaf0', '#4f86e8'],
    mountain: '#79a98b', fog: [220, 1000], grass: ['#3f8f3a', '#b4e27a'], clouds: true, birds: true,
    scenery: [['tree', 170], ['pine', 50], ['bush', 110], ['flower', 220], ['rock', 40]],
    objects: [['windmill', 3], ['balloon', 4], ['pond', 2]] },
  beach: { sky: ['#2b8fe6', '#86cdf7', '#eaf8ff'], ground: '#f2dca6', ground2: '#ead09a', shoulder: '#fbeac0', road: '#8d8a86', wall: ['#ffffff', '#1fb6c9'],
    mountain: '#c9ab72', fog: [240, 1100], sea: '#3cb7e8', island: 90, grass: ['#8fae4a', '#d8e58a'], grassCount: 900, clouds: true, birds: true,
    scenery: [['palm', 170], ['rock', 50], ['umbrella', 36], ['bush', 50]],
    objects: [['lighthouse', 1], ['sailboat', 7], ['hut', 4]] },
  candy: { sky: ['#ff8fd0', '#ffc4e6', '#fff1f8'], ground: '#ffd0e8', ground2: '#ffc0df', shoulder: '#fff6fb', road: '#9a6a54', wall: ['#ffffff', '#ff5aa8'],
    mountain: '#ffd9ef', fog: [200, 1000], clouds: true, cloudColor: '#ffe6f4', sparkles: true,
    scenery: [['lollipop', 150], ['gumdrop', 200], ['cupcake', 50]],
    objects: [['donut', 6], ['cane', 9], ['icecream', 6], ['balloon', 3]] },
  desert: { sky: ['#e98b45', '#f6bd7d', '#ffe9c8'], ground: '#ebc386', ground2: '#ddb377', shoulder: '#f2d39b', road: '#867868', wall: ['#ffffff', '#ff7b4f'],
    mountain: '#c97b4e', mesa: true, fog: [220, 1100], grass: ['#a08a4a', '#d9c27a'], grassCount: 500, clouds: true, birds: true,
    scenery: [['cactus', 170], ['rock', 120], ['bush', 40]],
    objects: [['pyramid', 3], ['arch', 3], ['oasis', 2], ['balloon', 2]] },
  snow: { sky: ['#7fb2e2', '#b9d8f3', '#f2f8ff'], ground: '#f6f9fc', ground2: '#e3ecf5', shoulder: '#ffffff', road: '#7b838d', wall: ['#ffffff', '#2f8de4'],
    mountain: '#eef4fb', fog: [170, 850], snowfall: true, clouds: true,
    scenery: [['snowPine', 230], ['snowman', 14], ['rock', 40]],
    objects: [['igloo', 4], ['cabin', 4], ['lake', 2], ['iceSpike', 10]] },
  city: { sky: ['#050a24', '#1b2154', '#3a3f7c'], ground: '#2f3340', ground2: '#2a2e39', shoulder: '#424857', road: '#43464f', wall: ['#ffe14d', '#26262e'],
    mountain: '#1a1e3c', fog: [180, 850], night: true, lamps: true, moon: true,
    scenery: [['building', 200], ['tower', 30]],
    objects: [['ferris', 1], ['billboard', 8]] },
  autumn: { sky: ['#5f9ede', '#a9cdec', '#fde6cc'], ground: '#b7934c', ground2: '#a88444', shoulder: '#d9ad62', road: '#6f7177', wall: ['#ffffff', '#f2652e'],
    mountain: '#b77a43', fog: [200, 950], grass: ['#8f7a32', '#e0c062'], clouds: true, birds: true, leaves: true,
    scenery: [['autumnTree', 200], ['pumpkin', 30], ['bush', 50]],
    objects: [['cottage', 6], ['haystack', 10], ['windmill', 1], ['balloon', 2]] },
  volcano: { sky: ['#2a1412', '#7a2f22', '#ff9a5c'], ground: '#463634', ground2: '#3c2e2c', shoulder: '#5a4540', road: '#56555a', wall: ['#ffb300', '#2a2a2a'],
    mountain: '#2d1f1f', fog: [160, 820], sea: '#ff6a2a', seaGlow: true, island: 80, volcano: true, embers: true,
    scenery: [['rock', 180], ['deadTree', 80], ['crystal', 50]],
    objects: [['spike', 12]] },
  kingdom: { sky: ['#3d92e8', '#8bcaf5', '#e6f6ff'], ground: '#80ca6a', ground2: '#72bc5d', shoulder: '#e8d7a2', road: '#7d8088', wall: ['#ffffff', '#8a63d2'],
    mountain: '#86b483', fog: [240, 1200], castle: true, grass: ['#3f8f3a', '#b4e27a'], clouds: true, birds: true,
    scenery: [['tree', 170], ['flag', 40], ['flower', 180], ['pine', 70]],
    objects: [['windmill', 3], ['cottage', 6], ['balloon', 5], ['island', 4], ['rainbow', 1]] },
  space: { sky: ['#02000a', '#120a33', '#2a1460'], space: true, road: '#ffffff', wall: ['#00e5ff', '#ff4081'], fog: null, shooting: true,
    scenery: [], objects: [['ufo', 2], ['satellite', 3], ['nebula', 7]] },
};

const OUTLINE = '#2a2433';
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---- Materials ------------------------------------------------------------------------------

// Wind for grass and leaves: one shared clock uniform.
const wind = { value: 0 };

let gradient = null;
/** Three soft light bands (shadow / mid / lit) with smooth edges between them. */
function gradientMap() {
  if (gradient) return gradient;
  const n = 256;
  const data = new Uint8Array(n);
  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const v = 0.58 + 0.22 * smooth(0.28, 0.36, x) + 0.2 * smooth(0.62, 0.7, x);
    data[i] = Math.round(v * 255);
  }
  gradient = new THREE.DataTexture(data, n, 1, THREE.RedFormat);
  gradient.magFilter = gradient.minFilter = THREE.LinearFilter;
  gradient.needsUpdate = true;
  return gradient;
}

function swayCode(amount, base) {
  if (!amount) return '';
  return `
    #ifdef USE_INSTANCING
      vec3 swayAt = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
    #else
      vec3 swayAt = vec3(0.0);
    #endif
    float swayH = max(0.0, position.y - ${base.toFixed(2)}) * ${amount.toFixed(3)};
    transformed.x += sin(uWind * 1.7 + swayAt.x * 0.15 + swayAt.z * 0.11) * swayH;
    transformed.z += cos(uWind * 1.3 + swayAt.x * 0.09 - swayAt.z * 0.13) * swayH * 0.7;
  `;
}

/** Adds wind sway and/or an outline push to a material's vertex shader. */
function patch(mat, { sway = 0, swayBase = 0, outline = 0 } = {}) {
  if (!sway && !outline) return mat;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = wind;
    sh.vertexShader = `uniform float uWind;\n${outline ? 'attribute vec3 outlineNormal;\n' : ''}${sh.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n${swayCode(sway, swayBase)}${outline ? `transformed += outlineNormal * ${outline.toFixed(3)};` : ''}`,
    );
  };
  mat.customProgramCacheKey = () => `p${sway}|${swayBase}|${outline}`;
  return mat;
}

/** Cel-shaded material. */
function toon(color, { sway = 0, swayBase = 0, ...extra } = {}) {
  return patch(new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...extra }), { sway, swayBase });
}
const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, ...extra });

const outlineMats = new Map();
function outlineMat(thickness, sway = 0, swayBase = 0) {
  const key = `${thickness}|${sway}|${swayBase}`;
  if (!outlineMats.has(key)) {
    outlineMats.set(key, patch(new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide }), { outline: thickness, sway, swayBase }));
  }
  return outlineMats.get(key);
}

/** Normals averaged over vertices in the same place, so pushed-out outlines don't split at hard edges. */
function withOutlineNormals(g) {
  if (g.attributes.outlineNormal) return g;
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const sums = new Map();
  const key = (i) => `${Math.round(pos.getX(i) * 500)},${Math.round(pos.getY(i) * 500)},${Math.round(pos.getZ(i) * 500)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    const s = sums.get(k) ?? [0, 0, 0];
    s[0] += nor.getX(i);
    s[1] += nor.getY(i);
    s[2] += nor.getZ(i);
    sums.set(k, s);
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const s = sums.get(key(i));
    const len = Math.hypot(s[0], s[1], s[2]) || 1;
    out.set([s[0] / len, s[1] / len, s[2] / len], i * 3);
  }
  g.setAttribute('outlineNormal', new THREE.BufferAttribute(out, 3));
  return g;
}

/** Gives every mesh under `root` an outline and shadow casting. */
function outlineAll(root, thickness = 0.06, { cast = true } = {}) {
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh && !o.userData.noOutline && o.material?.isMeshToonMaterial) meshes.push(o);
  });
  for (const m of meshes) {
    m.castShadow = cast;
    m.receiveShadow = true;
    const o = new THREE.Mesh(withOutlineNormals(m.geometry), outlineMat(thickness));
    o.userData.noOutline = true;
    o.raycast = () => {};
    m.add(o);
  }
  return root;
}

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

function speckle(ctx, w, h, count, color, size = 2) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) ctx.fillRect(Math.random() * w, Math.random() * h, size, size);
}

function roadTexture(color) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 700, 'rgba(255,255,255,.08)', 2);
    speckle(ctx, w, h, 700, 'rgba(0,0,0,.07)', 2);
    ctx.fillStyle = '#fbf6ea';
    ctx.fillRect(w * 0.035, 0, w * 0.025, h);
    ctx.fillRect(w * 0.94, 0, w * 0.025, h);
    ctx.fillStyle = 'rgba(255,250,235,.9)';
    ctx.fillRect(w * 0.49, 0, w * 0.02, h * 0.5);
  });
}

function rainbowTexture() {
  return canvasTexture(256, 64, (ctx, w, h) => {
    const colors = ['#ff4f7b', '#ffa04d', '#ffe14d', '#4fe08a', '#4fc3ff', '#7d5cff', '#e15cff'];
    const sw = w / colors.length;
    colors.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(i * sw, 0, sw + 1, h);
    });
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.fillRect(0, 0, w, 5);
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
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.fillRect(0, 0, w, 2);
    ctx.fillRect(0, h / 2, w, 2);
    ctx.fillStyle = '#3a3542';
    ctx.fillRect(w * 0.8, 0, w * 0.2, h);
  });
}

/** Soft painted ground: big blurry patches of two shades. */
function groundTexture(a, b) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, w, h);
    ctx.filter = 'blur(10px)';
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = b;
      ctx.globalAlpha = 0.35 + Math.random() * 0.4;
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 14 + Math.random() * 34;
      // draw wrapped copies so the texture tiles without seams
      for (const dx of [-w, 0, w]) {
        for (const dy of [-h, 0, h]) {
          ctx.beginPath();
          ctx.ellipse(x + dx, y + dy, r, r * 0.7, Math.random() * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    speckle(ctx, w, h, 400, 'rgba(255,255,255,.07)', 2);
  });
}

function waterTexture(color) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let i = 0; i < 28; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const l = 10 + Math.random() * 22;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + l / 2, y - 4, x + l, y);
      ctx.stroke();
    }
  });
}

function checkerTexture(cols = 8, rows = 2) {
  return canvasTexture(256, 64, (ctx, w, h) => {
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        ctx.fillStyle = (x + y) % 2 ? '#222' : '#fff';
        ctx.fillRect((x * w) / cols, (y * h) / rows, w / cols + 1, h / rows + 1);
      }
    }
  }, false);
}

function itemTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#ff7ccf');
    g.addColorStop(0.5, '#ffe066');
    g.addColorStop(1, '#5cd0ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,.95)';
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
    ctx.fillStyle = '#ff7a1a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff04d';
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
        ctx.fillStyle = on ? pick(['#ffe082', '#fff3c4', '#80deea', '#ffcc80']) : '#2c3044';
        ctx.fillRect(x, y, 7, 6);
      }
    }
  });
}

function radialTexture(stops) {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
    for (const [at, c] of stops) g.addColorStop(at, c);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, false);
}

function leafTexture() {
  return canvasTexture(32, 32, (ctx) => {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(16, 16, 13, 7, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }, false);
}

function labelTexture(text, bg, fg = '#fff', w = 256, h = 96) {
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = fg;
    ctx.font = `bold ${Math.round(h * 0.42)}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 3);
  }, false);
}

let shared = null;
function sharedTextures() {
  shared ??= {
    blob: radialTexture([[0, 'rgba(0,0,0,.4)'], [1, 'rgba(0,0,0,0)']]),
    glow: radialTexture([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.6)'], [1, 'rgba(255,255,255,0)']]),
    item: itemTexture(),
    checker: checkerTexture(),
    leaf: leafTexture(),
  };
  return shared;
}

// ---- Geometry helpers ------------------------------------------------------------------------

/** A strip along the track. edgeA/edgeB(i) give [x, y, z] for sample i. Faces upward. */
function strip(track, edgeA, edgeB, vScale) {
  const { N } = track;
  const pos = new Float32Array((N + 1) * 2 * 3);
  const uv = new Float32Array((N + 1) * 2 * 2);
  for (let k = 0; k <= N; k++) {
    const i = k % N;
    pos.set(edgeA(i), k * 6);
    pos.set(edgeB(i), k * 6 + 3);
    const v = (k * track.spacing) / vScale;
    uv.set([0, v, 1, v], k * 4);
  }
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

function geo(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = null) {
  g.rotateX(rx);
  g.rotateY(ry);
  g.rotateZ(rz);
  if (s) g.scale(...s);
  g.translate(x, y, z);
  return g;
}

/** Joins geometries (position, normal, uv) into one non-indexed geometry. */
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

/** A puffy round canopy: a few overlapping smooth balls. */
function puff(r, y, n = 3, squash = 0.85) {
  const balls = [geo(new THREE.IcosahedronGeometry(r, 1), 0, y, 0, 0, 0, 0, [1, squash, 1])];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + 0.4;
    balls.push(geo(new THREE.IcosahedronGeometry(r * 0.7, 1), Math.cos(a) * r * 0.62, y - r * 0.18 + (k % 2) * r * 0.25, Math.sin(a) * r * 0.62, 0, 0, 0, [1, squash, 1]));
  }
  return mergeGeometries(balls);
}

// ---- Scenery pieces: parts sharing one transform per instance ----------------------------------

/** { r: footprint radius, parts: [{ g, m, colors?, sway?, outline? }] } */
function sceneryParts(kind) {
  const leaves = (colors, sway = 0.03, base = 2.5) => ({ m: toon('#ffffff', { sway, swayBase: base }), colors, sway, swayBase: base });
  switch (kind) {
    case 'tree':
      return { r: 4, parts: [
        { g: geo(new THREE.CylinderGeometry(0.32, 0.5, 3.2, 8), 0, 1.6), m: toon('#8a5a36') },
        { g: puff(2.4, 4.8), ...leaves(['#4ea84a', '#62b856', '#3f9a45', '#77c45c']) },
      ] };
    case 'autumnTree':
      return { r: 4, parts: [
        { g: geo(new THREE.CylinderGeometry(0.32, 0.5, 3.2, 8), 0, 1.6), m: toon('#73492c') },
        { g: puff(2.5, 4.9), ...leaves(['#f07a2a', '#f6b73c', '#d9473a', '#f39a2e', '#ffcf4a']) },
      ] };
    case 'pine':
      return { r: 3.5, parts: [
        { g: geo(new THREE.CylinderGeometry(0.28, 0.4, 2, 8), 0, 1), m: toon('#6e4a30') },
        { g: mergeGeometries([geo(new THREE.ConeGeometry(2.5, 3.6, 10), 0, 3.0), geo(new THREE.ConeGeometry(1.9, 3.0, 10), 0, 4.8), geo(new THREE.ConeGeometry(1.2, 2.4, 10), 0, 6.4)]),
          ...leaves(['#2f7d4a', '#3a8c52', '#286e42'], 0.015, 2) },
      ] };
    case 'snowPine':
      return { r: 3.5, parts: [
        { g: geo(new THREE.CylinderGeometry(0.28, 0.4, 2, 8), 0, 1), m: toon('#6e4a30') },
        { g: mergeGeometries([geo(new THREE.ConeGeometry(2.5, 3.6, 10), 0, 3.0), geo(new THREE.ConeGeometry(1.9, 3.0, 10), 0, 4.8)]), m: toon('#2f6f4c') },
        { g: mergeGeometries([geo(new THREE.ConeGeometry(1.95, 1.4, 10), 0, 4.2), geo(new THREE.ConeGeometry(1.3, 2.2, 10), 0, 6.3)]), m: toon('#ffffff') },
      ] };
    case 'bush':
      return { r: 2, parts: [{ g: puff(1.1, 0.8, 3, 0.75), ...leaves(['#56a84a', '#6fb84f', '#82c35a'], 0.04, 0.3) }] };
    case 'flower':
      return { r: 1, outline: false, parts: [
        { g: geo(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 4), 0, 0.4), m: toon('#3f7d2a', { sway: 0.12 }), sway: 0.12 },
        { g: geo(new THREE.IcosahedronGeometry(0.3, 0), 0, 0.85), ...leaves(['#ff6fa0', '#ffe14d', '#ffffff', '#c77dff', '#ff8a5c'], 0.12, 0) },
      ] };
    case 'palm':
      return { r: 3.5, parts: [
        { g: geo(new THREE.CylinderGeometry(0.22, 0.42, 7, 8), 0.8, 3.5, 0, 0, 0, -0.18), m: toon('#b3875a') },
        { g: mergeGeometries([0, 1, 2, 3, 4, 5].map((k) => geo(new THREE.ConeGeometry(0.6, 3.6, 4), 1.5 + Math.cos(k) * 1.4, 7.0, Math.sin(k) * 1.4, Math.PI / 2 - 0.5, -k, 0, [1, 1, 0.25]))),
          ...leaves(['#3aa65a', '#4cb85c', '#66c45c'], 0.025, 6) },
      ] };
    case 'umbrella':
      return { r: 2, parts: [
        { g: geo(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), 0, 1.3), m: toon('#f2f2f2') },
        { g: geo(new THREE.ConeGeometry(1.6, 0.7, 12), 0, 2.7), m: toon('#ffffff'), colors: ['#ff6b6b', '#ffe14d', '#4fc3ff', '#ffffff'] },
      ] };
    case 'rock':
      return { r: 2.5, parts: [{ g: geo(new THREE.DodecahedronGeometry(1.6, 1), 0, 0.7, 0, 0, 0, 0, [1.2, 0.75, 1]), m: toon('#ffffff'), colors: ['#a7a39b', '#b8ab9a', '#928d86'] }] };
    case 'lollipop':
      return { r: 2, parts: [
        { g: geo(new THREE.CylinderGeometry(0.12, 0.12, 4, 6), 0, 2), m: toon('#ffffff') },
        { g: geo(new THREE.CylinderGeometry(1.5, 1.5, 0.4, 24), 0, 4.8, 0, Math.PI / 2), m: toon('#ffffff'), colors: ['#ff5c9a', '#8f6bff', '#36d9f0', '#ffe14d', '#6cf0a6'] },
      ] };
    case 'gumdrop':
      return { r: 2, parts: [{ g: geo(new THREE.SphereGeometry(1.3, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)), m: toon('#ffffff'), colors: ['#ff6b6b', '#ffd84d', '#6cf0a6', '#4fc3ff', '#e46bff'] }] };
    case 'cupcake':
      return { r: 3, parts: [
        { g: geo(new THREE.CylinderGeometry(2, 1.5, 2, 16), 0, 1), m: toon('#ffffff'), colors: ['#ffb39a', '#d6a1e3', '#9fcff5'] },
        { g: geo(new THREE.SphereGeometry(2.2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0, 2), m: toon('#fff6fa') },
        { g: geo(new THREE.SphereGeometry(0.45, 12, 8), 0, 4.3), m: toon('#e8423f') },
      ] };
    case 'cactus':
      return { r: 2, parts: [{ g: mergeGeometries([
        geo(new THREE.CapsuleGeometry(0.55, 4, 2, 8), 0, 2.6),
        geo(new THREE.CapsuleGeometry(0.33, 1.2, 2, 6), 1.0, 3.0, 0, 0, 0, 0),
        geo(new THREE.CapsuleGeometry(0.3, 1.0, 2, 6), -0.95, 3.5, 0, 0, 0, 0),
        geo(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 8), 0.6, 2.3, 0, 0, 0, Math.PI / 2),
        geo(new THREE.CylinderGeometry(0.28, 0.28, 0.8, 8), -0.55, 2.9, 0, 0, 0, Math.PI / 2),
      ]), m: toon('#5a9e44') }] };
    case 'snowman':
      return { r: 2, parts: [
        { g: mergeGeometries([geo(new THREE.SphereGeometry(1.2, 16, 12), 0, 1.1), geo(new THREE.SphereGeometry(0.8, 16, 12), 0, 2.7)]), m: toon('#ffffff') },
        { g: geo(new THREE.ConeGeometry(0.15, 0.7, 8), 0, 2.8, 0.85, Math.PI / 2), m: toon('#ff7a3d') },
        { g: geo(new THREE.CylinderGeometry(0.55, 0.55, 0.7, 14), 0, 3.6), m: toon('#2b2b33') },
      ] };
    case 'building':
      return { r: 9, building: true, parts: [] };
    case 'tower':
      return { r: 8, building: true, tall: true, parts: [] };
    case 'pumpkin':
      return { r: 1.5, parts: [
        { g: geo(new THREE.SphereGeometry(0.9, 16, 12), 0, 0.7, 0, 0, 0, 0, [1.2, 0.85, 1.2]), m: toon('#f07a1a') },
        { g: geo(new THREE.CylinderGeometry(0.1, 0.12, 0.4, 6), 0, 1.5), m: toon('#5a3a26') },
      ] };
    case 'deadTree':
      return { r: 2, parts: [{ g: mergeGeometries([
        geo(new THREE.CylinderGeometry(0.2, 0.42, 5, 7), 0, 2.5),
        geo(new THREE.CylinderGeometry(0.1, 0.18, 2.2, 6), 0.8, 3.8, 0, 0, 0, -0.8),
        geo(new THREE.CylinderGeometry(0.08, 0.14, 1.6, 6), -0.6, 4.2, 0, 0, 0, 0.7),
      ]), m: toon('#2e2420') }] };
    case 'crystal':
      return { r: 2, glow: true, parts: [{ g: geo(new THREE.OctahedronGeometry(1.2, 0), 0, 1.4, 0, 0, 0, 0, [0.7, 1.6, 0.7]), m: basic('#ffffff'), colors: ['#ff7a45', '#ffb347', '#ff4a1f'] }] };
    case 'flag':
      return { r: 1.5, parts: [
        { g: geo(new THREE.CylinderGeometry(0.08, 0.08, 6, 6), 0, 3), m: toon('#f2f2f2') },
        { g: geo(new THREE.PlaneGeometry(1.8, 1.1, 6, 1), 0.9, 5.3, 0), ...leaves(['#e8423f', '#3d7ee6', '#ffd23d', '#9b4fd6'], 0.25, 4.8), side: true },
      ] };
    default:
      return { r: 2, parts: [] };
  }
}

// ---- Decorations ------------------------------------------------------------------------------

const placed = (mesh, x, y, z) => (mesh.position.set(x, y, z), mesh);

function windmill(animated) {
  const g = new THREE.Group();
  g.add(placed(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.4, 12, 14), toon('#f6efe1')), 0, 6, 0));
  g.add(placed(new THREE.Mesh(new THREE.ConeGeometry(3, 3.6, 14), toon('#c9563c')), 0, 13.8, 0));
  g.add(placed(new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 0.3), toon('#7a5233')), 0, 1.2, 3.2));
  const hub = new THREE.Group();
  hub.position.set(0, 11.5, 2.6);
  for (let k = 0; k < 4; k++) {
    const blade = new THREE.Group();
    blade.rotation.z = (k * Math.PI) / 2;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 7, 0.25), toon('#7a5233'));
    arm.position.y = 3.5;
    const sail = new THREE.Mesh(new THREE.BoxGeometry(1.8, 5.4, 0.12), toon('#fffaf0'));
    sail.position.set(0.95, 4, 0);
    blade.add(arm, sail);
    hub.add(blade);
  }
  hub.add(new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 10), toon('#7a5233')));
  g.add(hub);
  const speed = rand(0.6, 1.1);
  animated.push((dt) => (hub.rotation.z -= dt * speed));
  return { obj: g, r: 6 };
}

function balloon(animated, colors = ['#ff6b6b', '#ffd84d', '#4fc3ff', '#9b6bff', '#6cf0a6', '#ff9ad5']) {
  const g = new THREE.Group();
  const a = pick(colors);
  const b = pick(colors.filter((c) => c !== a));
  const env = new THREE.Mesh(new THREE.SphereGeometry(5, 20, 16), toon(a));
  env.scale.set(1, 1.15, 1);
  env.position.y = 12;
  const band = new THREE.Mesh(new THREE.SphereGeometry(5.04, 20, 4, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.16), toon(b));
  band.scale.set(1, 1.15, 1);
  band.position.y = 12;
  const basket = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.9, 1.3, 10), toon('#a4743f'));
  basket.position.y = 4.5;
  g.add(env, band, basket);
  for (const [x, z] of [[0.8, 0.8], [-0.8, 0.8], [0.8, -0.8], [-0.8, -0.8]]) {
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.4, 4), toon('#5a4030'));
    rope.position.set(x * 1.2, 6.6, z * 1.2);
    g.add(rope);
  }
  const base = rand(35, 80);
  const phase = rand(0, 6);
  g.userData.float = true;
  animated.push((dt, t) => {
    g.position.y = base + Math.sin(t * 0.4 + phase) * 3;
    g.rotation.y += dt * 0.05;
  });
  return { obj: g, r: 0, sky: true };
}

function pond(animated) {
  const g = new THREE.Group();
  const r = rand(9, 14);
  const tex = waterTexture('#4fb6e6');
  tex.repeat.set(r / 10, r / 10);
  const water = new THREE.Mesh(new THREE.CircleGeometry(r, 32), toon('#ffffff', { map: tex }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.08;
  water.userData.noOutline = true;
  water.receiveShadow = true;
  const rim = new THREE.Mesh(new THREE.RingGeometry(r, r + 1.4, 32), toon('#cdbb8c'));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.06;
  rim.userData.noOutline = true;
  g.add(water, rim);
  for (let k = 0; k < 5; k++) {
    const pad = new THREE.Mesh(new THREE.CircleGeometry(rand(0.6, 1.1), 10, 0.3, Math.PI * 1.8), toon('#5fb34a'));
    pad.rotation.x = -Math.PI / 2;
    const a = rand(0, 6.3);
    const d = rand(0, r * 0.7);
    pad.position.set(Math.cos(a) * d, 0.12, Math.sin(a) * d);
    pad.userData.noOutline = true;
    g.add(pad);
  }
  animated.push((dt, t) => (tex.offset.set(t * 0.01, t * 0.02)));
  return { obj: g, r: r + 2 };
}

function lighthouse(animated) {
  const g = new THREE.Group();
  const tex = stripeTexture('#ffffff', '#e8423f', 6);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2, 3.2, 20, 18), toon('#ffffff', { map: tex }));
  tower.position.y = 10;
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.6, 18), toon('#3a3542'));
  deck.position.y = 20.3;
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 2.4, 14), basic('#fff6b0'));
  lamp.position.y = 21.8;
  lamp.userData.noOutline = true;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.4, 14), toon('#e8423f'));
  roof.position.y = 24.2;
  g.add(tower, deck, lamp, roof);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(4, 40, 16, 1, true), basic('#fff6b0', { transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  beam.rotation.z = Math.PI / 2;
  beam.position.set(20, 0, 0);
  beam.userData.noOutline = true;
  const spin = new THREE.Group();
  spin.position.y = 21.8;
  spin.add(beam);
  g.add(spin);
  animated.push((dt) => (spin.rotation.y += dt * 0.8));
  return { obj: g, r: 5 };
}

function sailboat(animated) {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 0.9, 1.4, 12, 1, false, 0, Math.PI), toon(pick(['#ffffff', '#e8423f', '#3d7ee6', '#ffd23d'])));
  hull.rotation.set(0, 0, Math.PI / 2);
  hull.scale.set(1, 3, 1);
  hull.position.y = 0.6;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 8, 6), toon('#7a5233'));
  mast.position.y = 4.5;
  const sailGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, 8, 0), new THREE.Vector3(0, 1.2, -3.6)]);
  sailGeo.computeVertexNormals();
  const sail = new THREE.Mesh(sailGeo, toon('#fffaf0', { side: THREE.DoubleSide }));
  sail.position.z = -0.2;
  sail.userData.noOutline = true;
  g.add(hull, mast, sail);
  const phase = rand(0, 6);
  animated.push((dt, t) => {
    g.position.y = -0.5 + Math.sin(t * 1.2 + phase) * 0.25;
    g.rotation.z = Math.sin(t * 0.9 + phase) * 0.06;
  });
  return { obj: g, r: 0, sea: true };
}

function hut() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(5, 3.5, 5), toon(pick(['#ffe9b8', '#d9f2ff', '#ffd6e6'])));
  base.position.y = 2.6;
  for (const [x, z] of [[2, 2], [-2, 2], [2, -2], [-2, -2]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.2, 6), toon('#a4743f'));
    leg.position.set(x, 0.6, z);
    g.add(leg);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 3, 4), toon('#d9a35a'));
  roof.position.y = 5.8;
  roof.rotation.y = Math.PI / 4;
  g.add(base, roof);
  return { obj: g, r: 4.5 };
}

function donut() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4, 2, 16, 32), toon('#e3a55e'));
  // icing: a slightly fatter ring squashed onto the front face
  const icing = new THREE.Mesh(new THREE.TorusGeometry(4, 2.05, 16, 32), toon(pick(['#ff8fc7', '#8a5233', '#fff6fa', '#a58bff'])));
  icing.scale.set(1, 1, 0.55);
  icing.position.z = 0.75;
  g.add(ring, icing);
  const sprinkles = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.1, 0.4, 2, 4), toon('#ffffff'), 40);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  for (let k = 0; k < 40; k++) {
    const a = rand(0.1, Math.PI - 0.1);
    const b = rand(-1, 1);
    const p = new THREE.Vector3(Math.cos(a) * (4 + b * 1.4), Math.sin(a) * (4 + b * 1.4), 1.6 + rand(-0.2, 0.3));
    m.compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 3), rand(0, 3), rand(0, 3))), new THREE.Vector3(1, 1, 1));
    sprinkles.setMatrixAt(k, m);
    sprinkles.setColorAt(k, c.set(pick(['#ff4f7b', '#ffe14d', '#4fc3ff', '#6cf0a6', '#ffffff'])));
  }
  sprinkles.userData.noOutline = true;
  g.add(sprinkles);
  g.position.y = 6;
  const holder = new THREE.Group();
  holder.add(g);
  holder.rotation.y = rand(0, Math.PI);
  return { obj: holder, r: 7 };
}

function candyCane() {
  const tex = canvasTexture(64, 64, (ctx, w, h) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e8423f';
    for (let k = -2; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(k * 22, 0);
      ctx.lineTo(k * 22 + 11, 0);
      ctx.lineTo(k * 22 + 11 + 32, h);
      ctx.lineTo(k * 22 + 32, h);
      ctx.fill();
    }
  });
  tex.repeat.set(2, 6);
  const mat = toon('#ffffff', { map: tex });
  const g = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 12, 16), mat);
  stick.position.y = 6;
  const hook = new THREE.Mesh(new THREE.TorusGeometry(2, 0.7, 12, 24, Math.PI), mat);
  hook.position.set(2, 12, 0);
  g.add(stick, hook);
  g.rotation.y = rand(0, Math.PI * 2);
  return { obj: g, r: 3 };
}

function iceCream() {
  const g = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 7, 16), toon('#e3a55e'));
  cone.rotation.x = Math.PI;
  cone.position.y = 3.5;
  g.add(cone);
  const flavors = ['#ffd1e8', '#a3e7c7', '#fff4c2', '#8a5233', '#c9b6ff'];
  for (let k = 0; k < 3; k++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(2.4 - k * 0.3, 18, 14), toon(pick(flavors)));
    s.position.y = 7.8 + k * 3.2;
    g.add(s);
  }
  const cherry = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 10), toon('#e8423f'));
  cherry.position.y = 16;
  g.add(cherry);
  return { obj: g, r: 3 };
}

function pyramid() {
  const g = new THREE.Group();
  const s = rand(1, 1.6);
  const p = new THREE.Mesh(new THREE.ConeGeometry(22 * s, 26 * s, 4), toon('#e7c27e'));
  p.position.y = 13 * s;
  p.rotation.y = Math.PI / 4;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(3 * s, 3.5 * s, 4), toon('#ffe14d'));
  cap.position.y = 24.3 * s;
  cap.rotation.y = Math.PI / 4;
  g.add(p, cap);
  return { obj: g, r: 22 * s, far: true };
}

function rockArch() {
  const g = new THREE.Group();
  const arch = new THREE.Mesh(new THREE.TorusGeometry(9, 2.6, 10, 24, Math.PI), toon('#d48a5a'));
  arch.scale.set(1, 1.3, 1);
  g.add(arch);
  g.rotation.y = rand(0, Math.PI);
  return { obj: g, r: 12 };
}

function oasis(animated) {
  const p = pond(animated);
  for (let k = 0; k < 4; k++) {
    const def = sceneryParts('palm');
    const a = (k / 4) * Math.PI * 2 + rand(-0.3, 0.3);
    for (const part of def.parts) {
      const m = new THREE.Mesh(part.g, part.colors ? toon(pick(part.colors), { sway: part.sway, swayBase: part.swayBase }) : part.m);
      m.position.set(Math.cos(a) * (p.r + 1), 0, Math.sin(a) * (p.r + 1));
      m.rotation.y = rand(0, 6);
      p.obj.add(m);
    }
  }
  return { obj: p.obj, r: p.r + 5 };
}

function igloo() {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon('#f2f8ff'));
  const door = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 2.4, 14, 1, false, 0, Math.PI), toon('#e6f0fa'));
  door.rotation.set(Math.PI / 2, 0, 0);
  door.position.set(0, 0, 4);
  g.add(dome, door);
  g.rotation.y = rand(0, 6);
  return { obj: g, r: 5 };
}

function cabin(animated, tex) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(7, 4.5, 6), toon('#9a6a44'));
  body.position.y = 2.25;
  const roofGeo = new THREE.CylinderGeometry(0.01, 5, 3.2, 4, 1);
  roofGeo.rotateY(Math.PI / 4);
  roofGeo.scale(1.15, 1, 0.95);
  const roof = new THREE.Mesh(roofGeo, toon('#ffffff'));
  roof.position.y = 6.1;
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.4, 0.9), toon('#8d8d8d'));
  chimney.position.set(2, 7, 1);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.2), basic('#ffd77a'));
  win.position.set(1.5, 2.6, 3.01);
  win.userData.noOutline = true;
  g.add(body, roof, chimney, win);
  const puffs = [];
  const mat = new THREE.SpriteMaterial({ map: tex.glow, color: '#e6e6ee', transparent: true, opacity: 0.6, depthWrite: false });
  for (let k = 0; k < 5; k++) {
    const s = new THREE.Sprite(mat);
    s.userData.phase = k / 5;
    g.add(s);
    puffs.push(s);
  }
  animated.push((dt, t) => {
    for (const s of puffs) {
      const p = (t * 0.15 + s.userData.phase) % 1;
      s.position.set(2 + p * 2, 8.5 + p * 8, 1);
      s.scale.setScalar(1.5 + p * 4);
    }
  });
  g.rotation.y = rand(0, 6);
  return { obj: g, r: 6 };
}

function lake(animated) {
  const g = new THREE.Group();
  const r = rand(14, 22);
  const ice = new THREE.Mesh(new THREE.CircleGeometry(r, 32), toon('#bfe6f7'));
  ice.rotation.x = -Math.PI / 2;
  ice.position.y = 0.06;
  ice.scale.set(1, 0.7, 1);
  ice.userData.noOutline = true;
  ice.receiveShadow = true;
  g.add(ice);
  for (let k = 0; k < 6; k++) {
    const crack = new THREE.Mesh(new THREE.PlaneGeometry(rand(3, 7), 0.15), basic('#ffffff'));
    crack.rotation.set(-Math.PI / 2, 0, rand(0, 3));
    crack.position.set(rand(-r / 2, r / 2), 0.09, rand(-r / 3, r / 3));
    crack.userData.noOutline = true;
    g.add(crack);
  }
  return { obj: g, r };
}

function iceSpike() {
  const g = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const h = rand(3, 7);
    const s = new THREE.Mesh(new THREE.ConeGeometry(rand(0.6, 1.2), h, 6), toon('#9fdcf5', { transparent: true, opacity: 0.9 }));
    s.position.set(rand(-1, 1), h / 2, rand(-1, 1));
    s.rotation.set(rand(-0.2, 0.2), 0, rand(-0.2, 0.2));
    g.add(s);
  }
  return { obj: g, r: 2.5 };
}

function ferrisWheel(animated) {
  const g = new THREE.Group();
  const R = 18;
  const wheel = new THREE.Group();
  wheel.position.y = R + 4;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.4, 8, 48), basic('#ff5ac8'));
  const rim2 = rim.clone();
  rim2.position.z = 2;
  wheel.add(rim, rim2);
  const cars = [];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.25, R, 0.25), basic('#7fe3ff'));
    spoke.position.set((Math.cos(a) * R) / 2, (Math.sin(a) * R) / 2, 1);
    spoke.rotation.z = a - Math.PI / 2;
    wheel.add(spoke);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), toon(pick(['#ffe14d', '#4fc3ff', '#ff6b6b', '#6cf0a6']), { emissive: '#333333' }));
    cab.userData.a = a;
    wheel.add(cab);
    cars.push(cab);
  }
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, R + 6, 0.8), toon('#cfd6e6'));
    leg.position.set(s * 6, (R + 4) / 2, -0.8);
    leg.rotation.z = s * 0.3;
    g.add(leg);
  }
  g.add(wheel);
  animated.push((dt) => {
    wheel.rotation.z += dt * 0.12;
    // cabins hang level while the wheel turns
    for (const c of cars) {
      c.position.set(Math.cos(c.userData.a) * R, Math.sin(c.userData.a) * R - 1.5, 1);
      c.rotation.z = -wheel.rotation.z;
    }
  });
  g.rotation.y = rand(0, 6);
  return { obj: g, r: 12, far: true };
}

function billboard() {
  const g = new THREE.Group();
  const words = [['FAMILY', '#ff3fa4'], ['RACE!', '#2bd4ff'], ['♥ 가족 ♥', '#ffcf3f'], ['GO! GO!', '#7dff7a'], ['🏁 레이스', '#b06bff']];
  const [text, color] = pick(words);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 0.6), [basic('#222'), basic('#222'), basic('#222'), basic('#222'), basic('#ffffff', { map: labelTexture(text, '#14142a', color) }), basic('#ffffff', { map: labelTexture(text, '#14142a', color) })]);
  sign.position.y = 12;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 10, 8), toon('#606878'));
  pole.position.y = 5;
  g.add(sign, pole);
  return { obj: g, r: 7, facesTrack: true };
}

function cottage() {
  const g = new THREE.Group();
  const wall = pick(['#fff3d6', '#ffe6cc', '#f2f2f2', '#ffeedd']);
  const body = new THREE.Mesh(new THREE.BoxGeometry(7, 4.5, 6), toon(wall));
  body.position.y = 2.25;
  const roofGeo = new THREE.CylinderGeometry(3.8, 3.8, 7.8, 3, 1);
  roofGeo.rotateZ(Math.PI / 2);
  const roof = new THREE.Mesh(roofGeo, toon(pick(['#d9573f', '#5b7fd6', '#7a5aa8', '#3f9a6a'])));
  roof.position.y = 5.9;
  roof.scale.set(1, 0.75, 1);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 0.2), toon('#7a5233'));
  door.position.set(0, 1.2, 3.05);
  const win = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 0.2), toon('#8fd3ff'));
  win.position.set(2.2, 2.7, 3.05);
  const win2 = win.clone();
  win2.position.x = -2.2;
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.2, 0.9), toon('#a5604a'));
  chimney.position.set(-2, 7.2, -1);
  g.add(body, roof, door, win, win2, chimney);
  return { obj: g, r: 6, facesTrack: true };
}

function haystack() {
  const g = new THREE.Group();
  const h = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.4, 16), toon('#e8c45a'));
  h.rotation.z = Math.PI / 2;
  h.position.y = 1.6;
  g.add(h);
  g.rotation.y = rand(0, 6);
  return { obj: g, r: 2.5 };
}

function obsidianSpike() {
  const g = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const hgt = rand(4, 10);
    const s = new THREE.Mesh(new THREE.ConeGeometry(rand(0.8, 1.6), hgt, 5), toon('#2b2333'));
    s.position.set(rand(-1.5, 1.5), hgt / 2, rand(-1.5, 1.5));
    s.rotation.set(rand(-0.25, 0.25), rand(0, 3), rand(-0.25, 0.25));
    g.add(s);
  }
  const glow = new THREE.Mesh(new THREE.CircleGeometry(2.6, 16), basic('#ff6a2a'));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.05;
  glow.userData.noOutline = true;
  g.add(glow);
  return { obj: g, r: 3 };
}

function floatingIsland(animated, tex) {
  const g = new THREE.Group();
  const r = rand(8, 13);
  const rock = new THREE.Mesh(new THREE.ConeGeometry(r, r * 1.5, 9), toon('#a58866'));
  rock.rotation.x = Math.PI;
  rock.position.y = -r * 0.75;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.98, 1.2, 18), toon('#7cc66b'));
  g.add(rock, top);
  for (let k = 0; k < 3; k++) {
    const tree = new THREE.Mesh(puff(1.6, 3.2), toon(pick(['#4ea84a', '#62b856'])));
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6), toon('#8a5a36'));
    const a = rand(0, 6.3);
    const d = rand(0, r * 0.6);
    trunk.position.set(Math.cos(a) * d, 1.6, Math.sin(a) * d);
    tree.position.set(Math.cos(a) * d, 0.6, Math.sin(a) * d);
    g.add(trunk, tree);
  }
  // waterfall
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 30), basic('#cdeeff', { transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
  fall.position.set(r * 0.92, -15, 0);
  fall.rotation.y = Math.PI / 2;
  fall.userData.noOutline = true;
  const mist = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false }));
  mist.position.set(r * 0.92, -30, 0);
  mist.scale.setScalar(10);
  g.add(fall, mist);
  const base = rand(45, 75);
  const phase = rand(0, 6);
  animated.push((dt, t) => {
    g.position.y = base + Math.sin(t * 0.3 + phase) * 1.5;
  });
  g.rotation.y = rand(0, 6);
  return { obj: g, r: 0, sky: true };
}

function rainbowArc() {
  const g = new THREE.Group();
  const colors = ['#ff6b6b', '#ffa04d', '#ffe14d', '#6cf0a6', '#4fc3ff', '#9b6bff'];
  colors.forEach((c, k) => {
    const band = new THREE.Mesh(new THREE.TorusGeometry(90 - k * 3, 1.5, 6, 64, Math.PI), basic(c, { transparent: true, opacity: 0.55, depthWrite: false }));
    band.userData.noOutline = true;
    g.add(band);
  });
  return { obj: g, r: 0, far: true, horizon: true };
}

function ufo(animated) {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 10), toon('#cfd8e6'));
  disc.scale.set(1, 0.28, 1);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.6, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon('#8ff0ff', { transparent: true, opacity: 0.85 }));
  dome.position.y = 1;
  g.add(disc, dome);
  const lights = [];
  for (let k = 0; k < 8; k++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), basic('#ffe14d'));
    const a = (k / 8) * Math.PI * 2;
    l.position.set(Math.cos(a) * 5.2, -0.3, Math.sin(a) * 5.2);
    l.userData.noOutline = true;
    g.add(l);
    lights.push(l);
  }
  const base = rand(25, 50);
  const phase = rand(0, 6);
  animated.push((dt, t) => {
    g.position.y = base + Math.sin(t * 0.8 + phase) * 2;
    g.rotation.y += dt * 0.6;
    lights.forEach((l, k) => l.material.color.set((Math.floor(t * 4) + k) % 2 ? '#ffe14d' : '#ff4fd8'));
  });
  return { obj: g, r: 0, sky: true };
}

function satellite(animated) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 3.2), toon('#e8e8f0'));
  const panelMat = toon('#3d5ad6');
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(7, 0.15, 2.6), panelMat);
    p.position.x = s * 5;
    g.add(p);
  }
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.5), toon('#ffffff', { side: THREE.DoubleSide }));
  dish.position.z = 2.2;
  dish.rotation.x = Math.PI / 2;
  g.add(body, dish);
  const base = rand(30, 70);
  animated.push((dt, t) => {
    g.rotation.y += dt * 0.2;
    g.rotation.x += dt * 0.1;
    g.position.y = base;
  });
  return { obj: g, r: 0, sky: true };
}

function nebula(tex) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: pick(['#ff4fd8', '#6b5cff', '#36d9f0', '#ff8a5c']), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  s.scale.setScalar(rand(250, 450));
  return { obj: s, r: 0, horizon: true };
}

// ---- World ----------------------------------------------------------------------------------

/**
 * Builds everything for a race on `track` into a new THREE.Scene.
 * Returns { scene, items, update(dt, t), follow(x, y, z) }.
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
  const horizon = new THREE.Color(theme.sky[2]);

  // Sky dome: three-color vertical gradient
  {
    const g = new THREE.SphereGeometry(1800, 32, 20);
    const [top, mid, low] = theme.sky.map((c) => new THREE.Color(c));
    const colors = [];
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = Math.max(0, Math.min(1, p.getY(i) / 1100 + 0.08));
      const c = t < 0.35 ? low.clone().lerp(mid, t / 0.35) : mid.clone().lerp(top, Math.pow((t - 0.35) / 0.65, 0.8));
      colors.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -2;
    scene.add(sky);
    animated.push(() => scene.userData.cameraPos && sky.position.copy(scene.userData.cameraPos));
    // Sun (or moon) glow
    if (!theme.space) {
      const sunDir = new THREE.Vector3(0.6, theme.night ? 0.45 : 0.32, 0.35).normalize();
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: theme.night ? '#dfe6ff' : '#fff6d8', transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
      glow.scale.setScalar(theme.night ? 180 : 520);
      const disc = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture([[0, '#ffffff'], [0.45, '#ffffff'], [0.5, 'rgba(255,255,255,0)'], [1, 'rgba(255,255,255,0)']]), color: theme.night ? '#f4f2e6' : '#fffbe8', fog: false, depthWrite: false }));
      disc.scale.setScalar(theme.night ? 70 : 90);
      sky.add(glow, disc);
      glow.position.copy(sunDir).multiplyScalar(1500);
      disc.position.copy(sunDir).multiplyScalar(1490);
      glow.renderOrder = disc.renderOrder = -1;
    }
  }
  if (theme.fog) scene.fog = new THREE.Fog(theme.sky[2], theme.fog[0], theme.fog[1]);

  // Light: soft sky fill + a sun that casts shadows around the camera's car
  const sun = new THREE.DirectionalLight(theme.night ? '#b8c4ff' : theme.space ? '#ffffff' : '#fff1d6', theme.night ? 1.0 : 2.2);
  if (theme.night) scene.add(new THREE.HemisphereLight('#7f8cff', '#262836', 1.4));
  else if (theme.space) scene.add(new THREE.HemisphereLight('#c8b8ff', '#40206a', 1.6));
  else scene.add(new THREE.HemisphereLight(theme.sky[1], theme.ground, 1.5));
  const sunOffset = new THREE.Vector3(60, 110, 40);
  sun.position.copy(sunOffset);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 320 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.5;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  // Ground (an island in the sea for beach / volcano)
  if (!theme.space) {
    const size = radius * 2 + 900;
    const groundTex = groundTexture(theme.ground, theme.ground2);
    let groundGeo;
    if (theme.sea) {
      const r = radius + theme.island + 30;
      groundGeo = new THREE.CircleGeometry(r, 64);
      groundTex.repeat.set((r * 2) / 60, (r * 2) / 60);
      const seaTex = theme.seaGlow ? null : waterTexture(theme.sea);
      if (seaTex) seaTex.repeat.set(120, 120);
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), theme.seaGlow ? basic(theme.sea) : toon('#ffffff', { map: seaTex }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.set(cx, -0.6, cz);
      sea.receiveShadow = true;
      scene.add(sea);
      if (seaTex) animated.push((dt, t) => seaTex.offset.set(t * 0.004, t * 0.008));
      const foam = new THREE.Mesh(new THREE.RingGeometry(r - 4, r + 6, 64), basic(theme.seaGlow ? '#ffd54a' : '#ffffff', { transparent: true, opacity: 0.7 }));
      foam.rotation.x = -Math.PI / 2;
      foam.position.set(cx, -0.45, cz);
      scene.add(foam);
      animated.push((dt, t) => foam.scale.setScalar(1 + Math.sin(t * 0.8) * 0.006));
      // beach sand rim around the island
      const sand = new THREE.Mesh(new THREE.RingGeometry(r - 14, r + 0.5, 64), toon(theme.seaGlow ? '#2e2424' : '#f6e3b4'));
      sand.rotation.x = -Math.PI / 2;
      sand.position.set(cx, 0.02, cz);
      sand.receiveShadow = true;
      scene.add(sand);
    } else {
      groundGeo = new THREE.PlaneGeometry(size, size);
      groundTex.repeat.set(size / 60, size / 60);
    }
    const ground = new THREE.Mesh(groundGeo, toon('#ffffff', { map: groundTex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, 0, cz);
    ground.receiveShadow = true;
    scene.add(ground);
  }

  // Mountains on the horizon, hazy with distance
  if (theme.mountain && !theme.sea) {
    const count = 30;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + rand(-0.08, 0.08);
      const d = radius + rand(360, 560);
      const h = rand(80, 200);
      const haze = (d - radius - 360) / 200;
      const color = new THREE.Color(theme.mountain).lerp(horizon, 0.25 + haze * 0.25);
      const mat = toon(color);
      const m = theme.mesa
        ? new THREE.Mesh(new THREE.CylinderGeometry(rand(40, 70), rand(70, 100), h * 0.55, 10), mat)
        : new THREE.Mesh(new THREE.ConeGeometry(rand(90, 150), h, 12), mat);
      m.position.set(cx + Math.cos(a) * d, (theme.mesa ? h * 0.27 : h / 2) - 2, cz + Math.sin(a) * d);
      m.rotation.y = rand(0, Math.PI);
      scene.add(m);
      if (!theme.mesa && !theme.night && !theme.snowfall && h > 130) {
        const r0 = m.geometry.parameters.radius;
        const cap = new THREE.Mesh(new THREE.ConeGeometry(r0 * 0.3, h * 0.3, 12), toon(new THREE.Color('#ffffff').lerp(horizon, 0.2)));
        cap.position.copy(m.position).add(new THREE.Vector3(0, h * 0.351, 0));
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
  const wide = bridge.slice();
  for (let i = 0; i < track.N; i++) if (bridge[i]) for (let k = -10; k <= 10; k++) wide[(i + k + track.N) % track.N] = 1;

  // Road
  const hw = track.hw;
  const w = track.wall;
  // Cars stop when their center reaches w; the barrier is drawn where the side of the car touches it.
  const wr = w + 1.1;
  const lift = (i) => track.py[i] + 0.04;
  const receive = (m) => ((m.receiveShadow = true), m);
  if (theme.space) {
    const rb = rainbowTexture();
    scene.add(receive(new THREE.Mesh(
      strip(track, (i) => sidePoint(track, i, -wr, lift(i)), (i) => sidePoint(track, i, wr, lift(i)), 40),
      new THREE.MeshBasicMaterial({ map: rb, side: THREE.DoubleSide }),
    )));
    animated.push((dt, t) => (rb.offset.y = -t * 0.15));
  } else {
    const roadTex = roadTexture(theme.road);
    const offset = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
    scene.add(receive(new THREE.Mesh(
      strip(track, (i) => sidePoint(track, i, -hw, lift(i)), (i) => sidePoint(track, i, hw, lift(i)), 16),
      toon('#ffffff', { map: roadTex, side: THREE.DoubleSide, ...offset }),
    )));
    const curbMat = toon('#ffffff', { map: stripeTexture('#fffaf0', theme.night ? '#ffd23d' : '#e8503f'), ...offset });
    const shoulderMat = toon(theme.shoulder, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    for (const s of [-1, 1]) {
      scene.add(receive(new THREE.Mesh(strip(track, (i) => sidePoint(track, i, s * hw, lift(i) + 0.02), (i) => sidePoint(track, i, s * (hw + CURB), lift(i) + 0.02), 4), curbMat)));
      scene.add(receive(new THREE.Mesh(strip(track, (i) => sidePoint(track, i, s * (hw + CURB), lift(i) - 0.01), (i) => sidePoint(track, i, s * wr, lift(i) - 0.01), 8), shoulderMat)));
    }
  }

  // Barriers
  {
    const wallTex = wallTexture(theme.wall[0], theme.wall[1]);
    const mat = theme.space
      ? new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
      : toon('#ffffff', { map: wallTex, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const wallMesh = new THREE.Mesh(strip(track, (i) => sidePoint(track, i, s * wr, track.py[i]), (i) => sidePoint(track, i, s * wr, track.py[i] + (theme.space ? 0.6 : 1.4)), 7), mat);
      wallMesh.castShadow = !theme.space;
      scene.add(receive(wallMesh));
    }
  }

  // Embankments under raised road, pillars under bridges
  if (!theme.space) {
    const bankMat = toon(theme.ground2, { side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      scene.add(receive(new THREE.Mesh(strip(track,
        (i) => sidePoint(track, i, s * wr, track.py[i]),
        (i) => (wide[i] || track.py[i] < 0.3 ? sidePoint(track, i, s * wr, Math.max(0, track.py[i] - 1.2)) : sidePoint(track, i, s * (wr + track.py[i] * 2.2), -0.05)),
        8), bankMat)));
    }
    const spots = [];
    for (let i = 0; i < track.N; i += 7) {
      if (!wide[i] || track.py[i] < 2) continue;
      if (grid.near(track.px[i], track.pz[i], w + 3, (j) => track.py[j] < track.py[i] - 4) >= 0) continue;
      spots.push(i);
    }
    if (spots.length) {
      const inst = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.2, 1.4, 1, 12).translate(0, 0.5, 0), toon('#d8d0c2'), spots.length);
      const m = new THREE.Matrix4();
      spots.forEach((i, k) => {
        m.compose(new THREE.Vector3(track.px[i], 0, track.pz[i]), new THREE.Quaternion(), new THREE.Vector3(1, track.py[i], 1));
        inst.setMatrixAt(k, m);
      });
      inst.castShadow = true;
      scene.add(inst);
    }
  } else {
    const under = new THREE.MeshBasicMaterial({ color: '#2a1060', side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
    for (const s of [-1, 1]) {
      scene.add(new THREE.Mesh(strip(track, (i) => sidePoint(track, i, s * wr, track.py[i]), (i) => sidePoint(track, i, s * wr, track.py[i] - 1.5), 8), under));
    }
  }

  // Start / finish line and gantry
  {
    const i0 = 0;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 2.4), toon('#ffffff', { map: tex.checker, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    line.rotation.x = -Math.PI / 2;
    line.receiveShadow = true;
    const lineGroup = new THREE.Group();
    lineGroup.add(line);
    lineGroup.position.set(track.px[i0], track.py[i0] + 0.08, track.pz[i0]);
    lineGroup.rotation.y = track.heading[i0];
    scene.add(lineGroup);

    const gantry = new THREE.Group();
    const postMat = toon('#f4f0ea');
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 8, 12), postMat);
      post.position.set(s * (wr + 0.6), 4, 0);
      gantry.add(post);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.8, 14, 10), toon('#ffd23d'));
      ball.position.set(s * (wr + 0.6), 9.6, 0);
      gantry.add(ball);
    }
    const bannerTex = canvasTexture(512, 64, (ctx, cw, ch) => {
      ctx.fillStyle = '#e8508f';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 40px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🏁 가족 레이스 🏁', cw / 2, ch / 2 + 2);
    }, false);
    const bannerMat = basic('#ffffff', { map: bannerTex });
    const banner = new THREE.Mesh(new THREE.BoxGeometry((wr + 1) * 2, 1.8, 0.6), [postMat, postMat, postMat, postMat, bannerMat, bannerMat]);
    banner.position.set(0, 8, 0);
    gantry.add(banner);
    gantry.position.set(track.px[i0], track.py[i0], track.pz[i0]);
    gantry.rotation.y = track.heading[i0];
    outlineAll(gantry, 0.07);
    scene.add(gantry);
  }

  // Boost pads
  {
    const pt = padTexture();
    pt.repeat.set(1, 2);
    const mat = basic('#ffffff', { map: pt, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
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
    const mat = new THREE.MeshLambertMaterial({ map: tex.item, transparent: true, opacity: 0.9, emissive: '#555555' });
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
        const target = t >= it.hiddenUntil ? 1 : 0;
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
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.15, r, h * 0.86, 20, 1, true), toon('#4a3430'));
    cone.position.set(landmark.x, (h * 0.86) / 2, landmark.z);
    scene.add(outlineAll(cone, 0.3));
    const lava = new THREE.Mesh(new THREE.CircleGeometry(r * 0.16, 20), basic('#ff7a1a'));
    lava.rotation.x = -Math.PI / 2;
    lava.position.set(landmark.x, h * 0.86, landmark.z);
    scene.add(lava);
    const smokeMat = new THREE.SpriteMaterial({ map: tex.glow, color: '#8a7c78', transparent: true, opacity: 0.5, depthWrite: false });
    const puffs = [];
    for (let k = 0; k < 10; k++) {
      const s = new THREE.Sprite(smokeMat);
      s.userData.phase = k / 10;
      scene.add(s);
      puffs.push(s);
    }
    animated.push((dt, t) => {
      for (const s of puffs) {
        const p = (t * 0.08 + s.userData.phase) % 1;
        s.position.set(landmark.x + Math.sin(p * 5 + s.userData.phase * 9) * 6, h * 0.86 + p * 70, landmark.z + p * 18);
        s.scale.setScalar(12 + p * 45);
      }
    });
    blocked.push({ x: landmark.x, z: landmark.z, r: r + 4 });
  }
  if (theme.castle && landmark) {
    const castle = new THREE.Group();
    const stone = toon('#f0ebe0');
    const roof = toon('#8a63d2');
    const s = Math.min(1.7, (landmark.r - w - 8) / 22);
    const keep = new THREE.Mesh(new THREE.BoxGeometry(18, 14, 18), stone);
    keep.position.y = 7;
    castle.add(keep);
    const big = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 26, 18), stone);
    big.position.y = 13;
    castle.add(big);
    const bigRoof = new THREE.Mesh(new THREE.ConeGeometry(5.4, 10, 18), roof);
    bigRoof.position.y = 31;
    castle.add(bigRoof);
    for (const [x, z] of [[-10, -10], [10, -10], [-10, 10], [10, 10]]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 18, 16), stone);
      t.position.set(x, 9, z);
      castle.add(t);
      const r = new THREE.Mesh(new THREE.ConeGeometry(3.4, 6.5, 16), roof);
      r.position.set(x, 21.2, z);
      castle.add(r);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.2, 4, 1), toon('#ffd23d', { side: THREE.DoubleSide, sway: 0.3, swayBase: -0.6 }));
      flag.position.set(x + 1, 25.5, z);
      flag.userData.noOutline = true;
      castle.add(flag);
    }
    // battlements along the top of the keep
    for (let k = -4; k <= 4; k += 2) {
      for (const [x, z] of [[k * 2, 9], [k * 2, -9], [9, k * 2], [-9, k * 2]]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), stone);
        b.position.set(x, 14.7, z);
        castle.add(b);
      }
    }
    const gate = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 1, 16, 1, false, 0, Math.PI), toon('#6d4a33'));
    gate.rotation.set(Math.PI / 2, 0, 0);
    gate.position.set(0, 0, 9.1);
    castle.add(gate);
    castle.scale.setScalar(s);
    castle.position.set(landmark.x, 0, landmark.z);
    scene.add(outlineAll(castle, 0.12));
    blocked.push({ x: landmark.x, z: landmark.z, r: 18 * s + 4 });
  }

  const spread = radius + 160;
  /** A free spot near the road (between `clear` and `within` meters from it). */
  function findSpot(r, clear, within) {
    for (let tries = 0; tries < 200; tries++) {
      const x = cx + rand(-spread, spread);
      const z = cz + rand(-spread, spread);
      if (theme.sea && Math.hypot(x - cx, z - cz) > radius + theme.island - r) continue;
      if (grid.near(x, z, clear + r) >= 0) continue;
      if (within && grid.near(x, z, within) < 0) continue;
      if (blocked.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + r)) continue;
      return { x, z };
    }
    return null;
  }
  const faceTrack = (obj, x, z) => {
    const i = grid.near(x, z, 400);
    if (i >= 0) obj.rotation.y = Math.atan2(track.px[i] - x, track.pz[i] - z);
  };

  // Decorations
  const builders = {
    windmill, balloon, pond, lighthouse, sailboat, hut, donut, cane: candyCane, icecream: iceCream, pyramid, arch: rockArch, oasis,
    igloo, cabin: (a) => cabin(a, tex), lake, iceSpike, ferris: ferrisWheel, billboard, cottage, haystack, spike: obsidianSpike,
    island: (a) => floatingIsland(a, tex), rainbow: rainbowArc, ufo, satellite, nebula: () => nebula(tex),
  };
  for (const [kind, count] of theme.objects ?? []) {
    for (let n = 0; n < count; n++) {
      const made = builders[kind]?.(animated, ...(kind === 'balloon' && track.def.theme === 'candy' ? [['#ff9ad5', '#ffe6f4', '#c9b6ff']] : []));
      if (!made) continue;
      const { obj } = made;
      if (made.sky) {
        // floating things: anywhere around, kept above the track
        const a = rand(0, Math.PI * 2);
        const d = rand(radius * 0.3, radius + 120);
        obj.position.x = cx + Math.cos(a) * d;
        obj.position.z = cz + Math.sin(a) * d;
      } else if (made.sea) {
        const a = rand(0, Math.PI * 2);
        const d = radius + theme.island + rand(60, 260);
        obj.position.set(cx + Math.cos(a) * d, 0, cz + Math.sin(a) * d);
        obj.rotation.y = rand(0, 6);
      } else if (made.horizon) {
        const a = rand(0, Math.PI * 2);
        const d = theme.space ? rand(700, 1100) : radius + 300;
        obj.position.set(cx + Math.cos(a) * d, theme.space ? rand(-100, 300) : 0, cz + Math.sin(a) * d);
        if (!theme.space) obj.lookAt(cx, 0, cz);
      } else {
        const spot = findSpot(made.r, track.wall + 6, made.far ? 160 : 70);
        if (!spot) continue;
        obj.position.set(spot.x, 0, spot.z);
        blocked.push({ x: spot.x, z: spot.z, r: made.r });
        if (made.facesTrack) faceTrack(obj, spot.x, spot.z);
      }
      if (!(obj instanceof THREE.Sprite)) outlineAll(obj, made.far ? 0.2 : 0.09);
      scene.add(obj);
    }
  }

  // Scenery (instanced)
  for (const [kind, count] of theme.scenery) {
    const def = sceneryParts(kind);
    const spots = [];
    let tries = 0;
    while (spots.length < count && tries < count * 25) {
      tries++;
      const x = cx + rand(-spread, spread);
      const z = cz + rand(-spread, spread);
      if (theme.sea && Math.hypot(x - cx, z - cz) > radius + theme.island - 4) continue;
      const clear = track.wall + 4.5 + def.r;
      if (grid.near(x, z, clear) >= 0) continue;
      if (blocked.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + def.r)) continue;
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
      if (part.side) part.m.side = THREE.DoubleSide;
      const inst = new THREE.InstancedMesh(part.g, part.m, spots.length);
      spots.forEach((p, k) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.ry);
        m.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
        inst.setMatrixAt(k, m);
        if (part.colors) inst.setColorAt(k, color.set(pick(part.colors)));
      });
      inst.castShadow = !def.glow;
      inst.receiveShadow = true;
      scene.add(inst);
      if (def.outline !== false && !def.glow && !part.side) {
        const o = new THREE.InstancedMesh(withOutlineNormals(part.g), outlineMat(0.07, part.sway ?? 0, part.swayBase ?? 0), spots.length);
        o.instanceMatrix = inst.instanceMatrix;
        scene.add(o);
      }
    }
  }

  // Grass tufts swaying beside the road
  if (theme.grass) {
    const blades = [];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI;
      const b = new THREE.BufferGeometry();
      const x = Math.cos(a) * 0.22;
      const z = Math.sin(a) * 0.22;
      b.setAttribute('position', new THREE.Float32BufferAttribute([-x * 1.6, 0, -z * 1.6, x * 1.6, 0, z * 1.6, 0, 0.55, 0], 3));
      b.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      b.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
      blades.push(b.translate(rand(-0.25, 0.25), 0, rand(-0.25, 0.25)));
    }
    const tuft = mergeGeometries(blades);
    const [dark, light] = theme.grass.map((c) => new THREE.Color(c));
    const colors = [];
    const p = tuft.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const c = dark.clone().lerp(light, p.getY(i) / 0.55);
      colors.push(c.r, c.g, c.b);
    }
    tuft.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const count = theme.grassCount ?? 3200;
    const inst = new THREE.InstancedMesh(tuft, toon('#ffffff', { vertexColors: true, side: THREE.DoubleSide, sway: 0.35, swayBase: 0 }), count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let n = 0;
    for (let tries = 0; tries < count * 6 && n < count; tries++) {
      const i = Math.floor(Math.random() * track.N);
      const side = Math.random() < 0.5 ? -1 : 1;
      const off = side * (wr + 2.5 + Math.pow(Math.random(), 1.6) * 45);
      const x = track.px[i] + track.nx[i] * off + rand(-2, 2);
      const z = track.pz[i] + track.nz[i] * off + rand(-2, 2);
      if (track.py[i] > 0.5 && Math.abs(off) < wr + track.py[i] * 2.4) continue; // not on the embankment slope
      if (grid.near(x, z, wr + 0.5) >= 0) continue;
      if (theme.sea && Math.hypot(x - cx, z - cz) > radius + theme.island - 14) continue;
      const s = rand(0.6, 1.1);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(0, 6.3));
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * rand(0.8, 1.3), s));
      inst.setMatrixAt(n++, m);
    }
    inst.count = n;
    inst.receiveShadow = true;
    scene.add(inst);
  }

  // Clouds: puffy groups slowly drifting round the sky
  if (theme.clouds) {
    const puffGeo = new THREE.IcosahedronGeometry(1, 1);
    const groups = 22;
    const per = 7;
    const inst = new THREE.InstancedMesh(puffGeo, toon(theme.cloudColor ?? '#ffffff', { emissive: '#3a3a44', fog: false }), groups * per);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let n = 0;
    for (let g = 0; g < groups; g++) {
      const a = rand(0, Math.PI * 2);
      const d = rand(radius * 0.4, radius + 650);
      const y = rand(110, 230);
      const size = rand(10, 22);
      for (let k = 0; k < per; k++) {
        const s = size * rand(0.55, 1);
        const p = new THREE.Vector3(cx + Math.cos(a) * d + (k - per / 2) * size * 0.8 + rand(-4, 4), y + rand(-2, 5) + (k % 3 === 1 ? size * 0.3 : 0), cz + Math.sin(a) * d + rand(-size, size) * 0.6);
        m.compose(p, q, new THREE.Vector3(s, s * 0.62, s * 0.8));
        inst.setMatrixAt(n++, m);
      }
    }
    const holder = new THREE.Group();
    holder.position.set(cx, 0, cz);
    inst.position.set(-cx, 0, -cz);
    holder.add(inst);
    scene.add(holder);
    animated.push((dt) => (holder.rotation.y += dt * 0.004));
  }

  // Birds circling
  if (theme.birds) {
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.3, -1.3, 0.3, -0.2, 0, 0, -0.3, 0, 0, 0.3, 0, 0, -0.3, 1.3, 0.3, -0.2], 3));
    wing.computeVertexNormals();
    const count = 18;
    const inst = new THREE.InstancedMesh(wing, basic('#3a3440', { side: THREE.DoubleSide }), count);
    const flock = Array.from({ length: count }, (_, k) => ({
      center: new THREE.Vector3(cx + rand(-radius, radius) * 0.6, rand(40, 75), cz + rand(-radius, radius) * 0.6),
      r: rand(30, 80), speed: rand(0.15, 0.3) * (k % 2 ? 1 : -1), phase: rand(0, 6.3), flap: rand(6, 9),
    }));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    animated.push((dt, t) => {
      flock.forEach((b, k) => {
        const a = t * b.speed + b.phase;
        const p = new THREE.Vector3(b.center.x + Math.cos(a) * b.r, b.center.y + Math.sin(t * 0.5 + b.phase) * 3, b.center.z + Math.sin(a) * b.r);
        e.set(0, -a + (b.speed > 0 ? Math.PI : 0), 0);
        q.setFromEuler(e);
        const f = 0.4 + Math.abs(Math.sin(t * b.flap + b.phase)) * 1.2;
        m.compose(p, q, new THREE.Vector3(1.4, f * 1.4, 1.4));
        inst.setMatrixAt(k, m);
      });
      inst.instanceMatrix.needsUpdate = true;
    });
    inst.frustumCulled = false;
    scene.add(inst);
  }

  // Street lamps for the city
  if (theme.lamps) {
    const spots = [];
    for (let i = 0; i < track.N; i += Math.round(36 / track.spacing)) {
      for (const s of [-1, 1]) spots.push(sidePoint(track, i, s * (wr + 1.3), track.py[i]).concat([track.heading[i] + (s > 0 ? Math.PI : 0)]));
    }
    const pole = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(0.12, 0.15, 7, 8), 0, 3.5), toon('#5d6472'), spots.length);
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
    pole.castShadow = true;
    scene.add(pole, head);
  }

  // Particles around the camera: snow, falling leaves, rising embers, candy sparkles
  const particleKinds = [];
  if (theme.snowfall) particleKinds.push({ n: 900, color: '#ffffff', size: 0.35, map: tex.glow, fall: 4, drift: 1 });
  if (theme.leaves) particleKinds.push({ n: 220, color: '#f39a2e', size: 0.7, map: tex.leaf, fall: 2.2, drift: 2.5 });
  if (theme.embers) particleKinds.push({ n: 400, color: '#ffb347', size: 0.5, map: tex.glow, fall: -3, drift: 1, additive: true });
  if (theme.sparkles) particleKinds.push({ n: 260, color: '#ffffff', size: 0.6, map: tex.glow, fall: 0.5, drift: 0.5, additive: true, twinkle: true });
  for (const kind of particleKinds) {
    const pos = new Float32Array(kind.n * 3);
    for (let k = 0; k < kind.n; k++) pos.set([rand(-60, 60), rand(0, 40), rand(-60, 60)], k * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: kind.color, size: kind.size, map: kind.map, transparent: true, depthWrite: false, opacity: 0.95,
      blending: kind.additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    animated.push((dt, t) => {
      const c = scene.userData.cameraPos;
      if (!c) return;
      const a = g.attributes.position;
      for (let k = 0; k < kind.n; k++) {
        let y = a.getY(k) - dt * kind.fall;
        if (y < -2) y += 42;
        if (y > 40) y -= 42;
        a.setY(k, y);
        a.setX(k, a.getX(k) + Math.sin(t * 0.7 + k) * dt * kind.drift);
      }
      a.needsUpdate = true;
      pts.position.set(c.x, c.y - 10, c.z);
      if (kind.twinkle) mat.opacity = 0.6 + Math.sin(t * 5) * 0.3;
    });
  }

  // Space: stars, planets, asteroids, shooting stars
  if (theme.space) {
    const n = 3000;
    const pos = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(rand(800, 1500));
      pos.set([v.x + cx, v.y * 0.8, v.z + cz], k * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, fog: false })));
    const planets = [['#ff8a5c', 120, 300, -200, 500], ['#5cd0ff', 70, -500, 120, -300], ['#d6a1ff', 50, 200, 260, -600], ['#ffe066', 35, -300, -150, 450]];
    for (const [c, r, x, y, z] of planets) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), toon(c, { emissive: c, emissiveIntensity: 0.15 }));
      p.position.set(cx + x, y, cz + z);
      scene.add(p);
      if (r > 60) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(r * 1.4, r * 2, 64), basic('#ffe0b2', { side: THREE.DoubleSide, transparent: true, opacity: 0.6 }));
        ring.position.copy(p.position);
        ring.rotation.set(1.2, 0.3, 0);
        scene.add(ring);
      }
    }
    // asteroid belt around the track
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 1), toon('#9a8f9e'), 160);
    const m = new THREE.Matrix4();
    for (let k = 0; k < 160; k++) {
      const a = rand(0, 6.3);
      const d = radius + rand(80, 220);
      const s = rand(2, 9);
      m.compose(new THREE.Vector3(Math.cos(a) * d, rand(-40, 60), Math.sin(a) * d), new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 3), rand(0, 3), 0)), new THREE.Vector3(s, s * rand(0.6, 1), s));
      rocks.setMatrixAt(k, m);
    }
    const belt = new THREE.Group();
    belt.position.set(cx, 0, cz);
    belt.add(rocks);
    scene.add(belt);
    animated.push((dt) => (belt.rotation.y += dt * 0.01));
    // shooting stars
    const streak = new THREE.Mesh(new THREE.PlaneGeometry(60, 0.8), basic('#ffffff', { transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    scene.add(streak);
    let next = 2;
    let life = 0;
    const dir = new THREE.Vector3();
    animated.push((dt, t) => {
      if (t > next && life <= 0) {
        life = 1;
        next = t + rand(2, 5);
        const a = rand(0, 6.3);
        streak.position.set(cx + Math.cos(a) * 700, rand(150, 350), cz + Math.sin(a) * 700);
        dir.set(rand(-1, 1), -0.3, rand(-1, 1)).normalize();
        streak.lookAt(streak.position.clone().add(new THREE.Vector3(-dir.z, 0, dir.x)));
      }
      if (life > 0) {
        life -= dt;
        streak.position.addScaledVector(dir, dt * 400);
        streak.material.opacity = Math.max(0, life);
      }
    });
  }

  return {
    scene,
    theme,
    items,
    update(dt, t) {
      wind.value = t;
      for (const f of animated) f(dt, t);
    },
    /** Keeps the shadow-casting sun centered on what the camera follows. */
    follow(x, y, z) {
      sun.target.position.set(x, y, z);
      sun.position.set(x + sunOffset.x, y + sunOffset.y, z + sunOffset.z);
    },
    setShadows(on) {
      sun.castShadow = on;
    },
  };
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
    const mesh = new THREE.Mesh(mergeGeometries(list), mat);
    mesh.castShadow = true;
    scene.add(mesh);
  });
  scene.add(new THREE.Mesh(mergeGeometries(roofs), toon('#1b1e2b')));
  if (tips.length) scene.add(new THREE.Mesh(mergeGeometries(tips), basic('#ff1744')));
}

// ---- Cars -----------------------------------------------------------------------------------

/** A kart for a CARS entry, facing +z, wheels on y = 0. */
export function makeCar(def) {
  const car = new THREE.Group();
  const body = new THREE.Group(); // tilts for steering / bumps
  car.add(body);
  const paint = toon(def.color);
  const accent = toon(def.accent);
  const dark = toon('#34343c');
  const chrome = toon('#dfe6ea');
  const add = (g, m, x, y, z, parent = body) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const box = (w, h, d, m, x, y, z) => add(new THREE.BoxGeometry(w, h, d, 1, 1, 1), m, x, y, z);

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
      add(new THREE.CapsuleGeometry(0.42, 2.2, 6, 14), paint, 0, 0.55, 0).rotation.x = Math.PI / 2;
      box(1.7, 0.36, 2.4, paint, 0, 0.45, -0.1);
      box(1.2, 0.26, 0.9, paint, 0, 0.42, 1.55).rotation.x = 0.18;
      box(1.95, 0.24, 1.0, accent, 0, 0.42, -0.4);
      box(0.12, 0.6, 0.12, dark, -0.5, 0.95, -1.35);
      box(0.12, 0.6, 0.12, dark, 0.5, 0.95, -1.35);
      box(1.9, 0.1, 0.55, paint, 0, 1.25, -1.4);
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
        const m = add(new THREE.CylinderGeometry(0.07, 0.07, a.distanceTo(b), 8), accent, 0, 0, 0);
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
      add(new THREE.CapsuleGeometry(0.4, 2.4, 6, 14), paint, 0, 0.5, -0.1).rotation.x = Math.PI / 2;
      add(new THREE.ConeGeometry(0.34, 1.3, 14), paint, 0, 0.45, 1.95).rotation.x = Math.PI / 2;
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
      const shell = add(new THREE.SphereGeometry(1, 28, 20), paint, 0, 0.75, 0);
      shell.scale.set(0.95, 0.55, 1.45);
      add(new THREE.SphereGeometry(0.22, 14, 10), accent, -0.45, 0.95, 1.2);
      add(new THREE.SphereGeometry(0.22, 14, 10), accent, 0.45, 0.95, 1.2);
      add(new THREE.TorusGeometry(0.35, 0.08, 8, 18), accent, 0, 1.05, -1.25);
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
      add(new THREE.TorusGeometry(0.35, 0.15, 8, 18), dark, 0, 1.0, -1.6);
      box(1.6, 0.25, 0.1, chrome, 0, 0.75, 1.52);
      add(new THREE.SphereGeometry(0.16, 10, 8), toon('#fff7c2'), -0.6, 1.0, 1.52);
      add(new THREE.SphereGeometry(0.16, 10, 8), toon('#fff7c2'), 0.6, 1.0, 1.52);
      driverY = 1.3;
      flameY = 0.6;
      break;
    case 'taxi':
      box(1.8, 0.6, 3.1, paint, 0, 0.75, 0);
      box(1.6, 0.55, 1.5, paint, 0, 1.3, -0.3);
      box(1.62, 0.35, 1.3, toon('#a7d8ff', { transparent: true, opacity: 0.75 }), 0, 1.33, -0.3);
      box(0.7, 0.3, 0.35, accent, 0, 1.75, -0.3);
      box(1.82, 0.12, 3.12, accent, 0, 0.62, 0);
      driverY = 1.55;
      driverZ = 0.15;
      break;
    case 'rocket': {
      const tube = add(new THREE.CapsuleGeometry(0.62, 2.2, 8, 18), paint, 0, 0.75, -0.2);
      tube.rotation.x = Math.PI / 2;
      add(new THREE.ConeGeometry(0.6, 1.2, 18), accent, 0, 0.75, 1.8).rotation.x = Math.PI / 2;
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

  // Driver: round head, helmet, big friendly eyes
  const skin = toon('#ffd2ac');
  add(new THREE.CapsuleGeometry(0.28, 0.25, 4, 10), accent, 0, driverY + 0.05, driverZ);
  add(new THREE.SphereGeometry(0.32, 18, 14), skin, 0, driverY + 0.58, driverZ);
  const helmet = add(new THREE.SphereGeometry(0.36, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), paint, 0, driverY + 0.62, driverZ);
  helmet.scale.set(1, 1, 1.05);
  const eyeMat = toon('#2a2433');
  add(new THREE.SphereGeometry(0.05, 8, 6), eyeMat, -0.11, driverY + 0.6, driverZ + 0.3).userData.noOutline = true;
  add(new THREE.SphereGeometry(0.05, 8, 6), eyeMat, 0.11, driverY + 0.6, driverZ + 0.3).userData.noOutline = true;
  const goggles = add(new THREE.TorusGeometry(0.12, 0.03, 6, 12), dark, -0.12, driverY + 0.78, driverZ + 0.27);
  goggles.userData.noOutline = true;
  add(new THREE.TorusGeometry(0.12, 0.03, 6, 12), dark, 0.12, driverY + 0.78, driverZ + 0.27).userData.noOutline = true;

  // Wheels (front ones turn)
  const wheels = [];
  const fronts = [];
  const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, wheelW, 20);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(wheelR * 0.45, wheelR * 0.45, wheelW + 0.02, 12);
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
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.4, 12), flameMat);
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(0, flameY, flameZ - 0.6);
  flame.visible = false;
  body.add(flame);
  const flameCore = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.9, 10), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }));
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

  outlineAll(car, 0.035);

  // Soft contact shadow under the kart (the sun shadow does the rest)
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.6), new THREE.MeshBasicMaterial({ map: tex.blob, transparent: true, depthWrite: false }));
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

/**
 * Floating badge over a car: the family member's profile photo in a ring of their car color, with
 * their name underneath. Computer cars get a robot face. Until the photo loads, the first letter.
 */
export function makeNameTag(text, color, { avatar = null, bot = false } = {}) {
  const W = 256;
  const H = 300;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const font = '-apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  const cx = W / 2;
  const cy = 104;
  const R = 92;

  function draw(img) {
    ctx.clearRect(0, 0, W, H);
    // soft drop shadow, colored ring, white inner ring
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath();
    ctx.arc(cx, cy + 6, R + 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx, cy, R + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R - 4, 0, Math.PI * 2);
    ctx.clip();
    if (img) {
      // cover-fit the photo into the circle
      const k = Math.max((2 * R) / img.width, (2 * R) / img.height);
      const w = img.width * k;
      const h = img.height * k;
      ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    } else {
      ctx.fillStyle = bot ? '#dfe6f2' : color;
      ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      ctx.fillStyle = bot ? '#3a3542' : '#fff';
      ctx.font = `bold ${bot ? 110 : 96}px ${font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(bot ? '🤖' : [...text][0] ?? '?', cx, cy + 6);
    }
    ctx.restore();
    // name pill
    ctx.font = `bold 34px ${font}`;
    const tw = Math.min(W - 8, ctx.measureText(text).width + 32);
    ctx.fillStyle = 'rgba(30,24,40,.72)';
    ctx.beginPath();
    ctx.roundRect((W - tw) / 2, 222, tw, 52, 26);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, 249);
    tex.needsUpdate = true;
  }
  draw(null);
  if (avatar) {
    const img = new Image();
    img.onload = () => draw(img);
    img.src = avatar;
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(3, (3 * H) / W, 1);
  s.center.set(0.5, 0);
  s.renderOrder = 10;
  return s;
}

/** Turntable scene for choosing a car in the lobby: a little grassy island under a soft sky. */
export function createGarage() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#9fd3f5');
  scene.add(new THREE.HemisphereLight('#cfe9ff', '#7cc35a', 1.6));
  const key = new THREE.DirectionalLight('#fff1d6', 2.2);
  key.position.set(4, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 20 });
  key.shadow.normalBias = 0.05;
  scene.add(key);
  const island = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.0, 0.8, 40), toon('#86c95e'));
  island.position.y = -0.4;
  island.receiveShadow = true;
  scene.add(outlineAll(island, 0.05, { cast: false }));
  const dirt = new THREE.Mesh(new THREE.ConeGeometry(3.0, 2.4, 40), toon('#a7825a'));
  dirt.rotation.x = Math.PI;
  dirt.position.y = -2;
  scene.add(dirt);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.3;
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), toon(pick(['#ff6fa0', '#ffe14d', '#ffffff', '#c77dff'])));
    f.position.set(Math.cos(a) * 3.1, 0.12, Math.sin(a) * 3.1);
    scene.add(f);
  }
  const cloudMat = toon('#ffffff', { emissive: '#3a3a44' });
  for (const [x, y, z, s] of [[-6, 3.5, -8, 1.4], [6, 4.5, -10, 1.8], [0, 6, -14, 2]]) {
    for (let k = 0; k < 4; k++) {
      const p = new THREE.Mesh(new THREE.IcosahedronGeometry(s * rand(0.6, 1), 2), cloudMat);
      p.position.set(x + (k - 1.5) * s * 0.9, y + (k % 2) * s * 0.3, z);
      p.scale.y = 0.65;
      scene.add(p);
    }
  }
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
      wind.value = t;
      if (!current) return;
      current.rotation.y += dt * 0.6;
      current.userData.animate(dt, { speed: 0, t });
    },
  };
}

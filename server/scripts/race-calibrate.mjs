// 가족 레이스 트랙 점검·크기 보정.
//   node scripts/race-calibrate.mjs          점검만 (현재 scale로 컴퓨터 차 주행 시간)
//   node scripts/race-calibrate.mjs --fit    목표 시간에 맞는 scale 계산
// 트랙이 서로 너무 가깝거나(벽이 겹침) 커브가 너무 급하면 경고합니다.
import { CARS, LAPS, TRACKS, WALL, buildTrack, gridSlot } from '../web/games/race/tracks.js';
import { FIXED_DT, botInput, newCar, stepCar } from '../web/games/race/physics.js';

const avg = (k) => CARS.reduce((s, c) => s + c.stats[k], 0) / CARS.length;
const STATS = { speed: avg('speed'), accel: avg('accel'), turn: avg('turn') };
// Family players won't drive a perfect line; the computer at skill 0.94 is about an average lap.
const SKILL = 0.94;

function geometry(track) {
  const { N, px, pz, py, spacing, heading } = track;
  let minGap = Infinity;
  let gapAt = null;
  const skip = Math.round(70 / spacing);
  for (let i = 0; i < N; i += 2) {
    for (let j = i + skip; j < N - (skip - i > 0 ? skip - i : 0); j += 2) {
      if (Math.abs(py[i] - py[j]) > 7) continue; // bridge over the other road
      const d = Math.hypot(px[i] - px[j], pz[i] - pz[j]);
      if (d < minGap) {
        minGap = d;
        gapAt = [i, j];
      }
    }
  }
  let minRadius = Infinity;
  let maxSlope = 0;
  for (let i = 0; i < N; i++) {
    const a = heading[i];
    const b = heading[(i + 3) % N];
    const dh = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
    minRadius = Math.min(minRadius, (3 * spacing) / Math.max(dh, 1e-6));
    maxSlope = Math.max(maxSlope, Math.abs(py[(i + 1) % N] - py[i]) / spacing);
  }
  return { minGap, gapAt, minRadius, maxSlope };
}

function drive(track) {
  const car = newCar(track, gridSlot(track, 0), STATS);
  const ai = { skill: SKILL, lane: 0, t: 0 };
  let t = 0;
  let walls = 0;
  const limit = track.def.targetSec * 4;
  while (car.prog < LAPS * track.length && t < limit) {
    ai.t = t;
    const input = botInput(car, track, ai);
    input.useItem = false;
    if (stepCar(car, input, track, FIXED_DT).includes('bump')) walls++;
    t += FIXED_DT;
  }
  return { time: t, done: car.prog >= LAPS * track.length, walls };
}

const fit = process.argv.includes('--fit');
for (const def of TRACKS) {
  let scale = def.scale;
  let result;
  for (let round = 0; round < (fit ? 6 : 1); round++) {
    result = drive(buildTrack(def, scale));
    if (!fit) break;
    const next = scale * (def.targetSec / result.time);
    if (Math.abs(next - scale) < 0.002) break;
    scale = next;
  }
  const track = buildTrack(def, scale);
  const g = geometry(track);
  const warn = [];
  if (g.minGap < 2 * WALL + 8) warn.push(`가까운 구간 ${g.minGap.toFixed(1)}m (샘플 ${g.gapAt})`);
  if (g.minRadius < 16) warn.push(`급커브 반지름 ${g.minRadius.toFixed(1)}m`);
  if (g.maxSlope > 0.2) warn.push(`경사 ${(g.maxSlope * 100).toFixed(0)}%`);
  if (!result.done) warn.push('완주 못 함');
  console.log(
    `${def.id.padEnd(4)} ${def.name.padEnd(8)} scale ${scale.toFixed(3)}  한 바퀴 ${track.length.toFixed(0)}m  ` +
      `주행 ${result.time.toFixed(1)}s / 목표 ${def.targetSec}s  벽 ${result.walls}회  반지름 ${g.minRadius.toFixed(0)}m  간격 ${g.minGap.toFixed(0)}m` +
      (warn.length ? `  ⚠ ${warn.join(', ')}` : ''),
  );
}

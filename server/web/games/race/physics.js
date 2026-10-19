/*
 * 가족 레이스: 자동차 움직임. 내 차와 컴퓨터 차가 같은 코드로 달립니다. three.js 없이 돌아가서
 * 서버 쪽 보정 스크립트(scripts/race-calibrate.mjs)도 그대로 씁니다.
 * 방향: yaw 0 = +z 방향, forward = (sin yaw, cos yaw), 오른쪽 = (-cos yaw, sin yaw).
 */

export const TUNE = {
  boostSpeed: 1.38, // top speed while boosting
  boostAccel: 30,
  itemBoost: 2.2, // seconds
  padBoost: 1.1,
  offroadSpeed: 0.5,
  brake: 26,
  reverse: 8,
  grip: 11,
  driftGrip: 1.6,
  driftTurn: 1.45,
  overSpeedDecel: 10,
  maxItems: 2,
};

const SEARCH = 14; // samples searched around the last known one

export function newCar(track, slot, stats) {
  return {
    stats,
    x: slot.x, z: slot.z, y: slot.y, yaw: slot.yaw,
    vx: 0, vz: 0,
    fwd: 0,
    steer: 0,
    pitch: 0,
    idx: slot.i,
    // Distance driven along the track; grid slots are behind the line so it starts negative.
    unwrap: -track.length,
    prog: slot.i * track.spacing - track.length,
    lat: 0,
    boost: 0,
    drift: 0,
    driftCharge: 0,
    driftTime: 0,
    offroad: false,
    bump: 0,
    items: 0,
    wrongWay: 0,
  };
}

/** Finds where the car is on the track: sample index, side offset, height, lap progress. */
export function locate(car, track) {
  const { N, px, pz } = track;
  let best = car.idx;
  let bestD = Infinity;
  for (let k = -SEARCH; k <= SEARCH; k++) {
    const i = (car.idx + k + N) % N;
    const dx = car.x - px[i];
    const dz = car.z - pz[i];
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  // Crossing the start line moves the lap counter.
  if (car.idx > N * 0.75 && best < N * 0.25) car.unwrap += track.length;
  else if (car.idx < N * 0.25 && best > N * 0.75) car.unwrap -= track.length;
  car.idx = best;
  const i = best;
  const dx = car.x - px[i];
  const dz = car.z - pz[i];
  const along = dx * track.tx[i] + dz * track.tz[i];
  car.lat = dx * track.nx[i] + dz * track.nz[i];
  // Height: between this sample and the neighbor on the side the car is on.
  const j = along >= 0 ? (i + 1) % N : (i - 1 + N) % N;
  const f = Math.min(1, Math.abs(along) / track.spacing);
  car.y = track.py[i] + (track.py[j] - track.py[i]) * f;
  const slope = (track.py[(i + 1) % N] - track.py[(i - 1 + N) % N]) / (2 * track.spacing);
  car.pitch = -Math.atan(slope) * Math.cos(car.yaw - track.heading[i]);
  car.prog = car.unwrap + i * track.spacing + along;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * One physics step. input: { steer -1..1 (+ = right), throttle 0..1, brake bool, drift bool }.
 * Returns events that happened this step ('miniturbo', 'bump').
 */
export function stepCar(car, input, track, dt) {
  const events = [];
  const s = car.stats;
  let max = s.speed;
  if (car.offroad) max *= TUNE.offroadSpeed;
  if (car.boost > 0) {
    max = s.speed * TUNE.boostSpeed;
    car.boost = Math.max(0, car.boost - dt);
  }

  const fx = Math.sin(car.yaw);
  const fz = Math.cos(car.yaw);
  const rx = -fz;
  const rz = fx;
  let fwd = car.vx * fx + car.vz * fz;
  let lat = car.vx * rx + car.vz * rz;

  // Speed
  if (input.brake) {
    fwd = fwd > 0 ? Math.max(0, fwd - TUNE.brake * dt) : Math.max(-TUNE.reverse, fwd - 6 * dt);
  } else if (car.boost > 0) {
    fwd += (TUNE.boostAccel + s.accel) * dt;
  } else if (input.throttle > 0) {
    if (fwd < max) fwd += s.accel * input.throttle * Math.max(0.15, 1 - fwd / max) * dt * 1.6;
  } else {
    fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 3 * dt);
  }
  if (fwd > max) fwd = Math.max(max, fwd - TUNE.overSpeedDecel * dt);

  // Drift: hold the drift button while turning. Releasing after a long slide gives a mini turbo.
  const steer = clamp(input.steer, -1, 1);
  if (input.drift && !car.drift && Math.abs(steer) > 0.3 && fwd > 12) {
    car.drift = Math.sign(steer);
    car.driftCharge = 0;
    car.driftTime = 0;
  }
  if (car.drift && (!input.drift || fwd < 8)) {
    if (car.driftCharge > 1.6) {
      car.boost = Math.max(car.boost, 1.1);
      events.push('miniturbo');
    } else if (car.driftCharge > 0.7) {
      car.boost = Math.max(car.boost, 0.6);
      events.push('miniturbo');
    }
    car.drift = 0;
    car.driftCharge = 0;
  }

  // Steering
  const speedFactor = clamp(Math.abs(fwd) / 7, 0, 1) * Math.sign(fwd || 1);
  let turn = steer * s.turn * speedFactor * (1 - 0.22 * clamp(fwd / s.speed, 0, 1.3));
  if (car.drift) {
    car.driftTime += dt;
    // Always turning into the drift; steering widens or tightens it.
    turn = car.drift * s.turn * TUNE.driftTurn * (0.65 + 0.35 * steer * car.drift) * speedFactor;
    car.driftCharge += dt * (0.6 + 0.6 * Math.abs(steer));
    fwd -= fwd * 0.12 * dt;
  }
  car.yaw -= turn * dt;
  car.steer += (steer - car.steer) * Math.min(1, dt * 10);

  // Sideways slip dies off quickly unless drifting.
  lat *= Math.exp(-(car.drift ? TUNE.driftGrip : TUNE.grip) * dt);
  if (car.drift) lat += car.drift * fwd * 0.9 * dt;

  const nfx = Math.sin(car.yaw);
  const nfz = Math.cos(car.yaw);
  car.vx = nfx * fwd + -nfz * lat;
  car.vz = nfz * fwd + nfx * lat;
  car.x += car.vx * dt;
  car.z += car.vz * dt;
  car.fwd = fwd;

  locate(car, track);

  // Barriers
  const side = Math.sign(car.lat);
  const over = Math.abs(car.lat) - track.wall;
  if (over > 0) {
    const nx = track.nx[car.idx] * side;
    const nz = track.nz[car.idx] * side;
    car.x -= nx * over;
    car.z -= nz * over;
    const vn = car.vx * nx + car.vz * nz;
    if (vn > 0) {
      car.vx -= nx * vn * 1.35;
      car.vz -= nz * vn * 1.35;
      if (vn > 4) {
        car.bump = 0.3;
        events.push('bump');
      }
    }
    car.vx *= 1 - 1.2 * dt;
    car.vz *= 1 - 1.2 * dt;
    car.lat = side * track.wall;
    // Turn the car along the barrier (whichever way along it is closer) so it slides off instead of
    // sitting nose-first against it.
    const h = track.heading[car.idx];
    const along = Math.abs(wrapAngle(car.yaw - h)) < Math.PI / 2 ? h : h + Math.PI;
    const diff = wrapAngle(along - car.yaw);
    car.yaw += clamp(diff, -1, 1) * Math.min(1, 4 * dt);
  }
  car.offroad = Math.abs(car.lat) > track.hw + 1.2;
  car.bump = Math.max(0, car.bump - dt);

  // Facing the wrong way for a while?
  const off = Math.abs(wrapAngle(car.yaw - track.heading[car.idx]));
  car.wrongWay = off > 2.0 && Math.abs(fwd) > 3 ? car.wrongWay + dt : 0;
  return events;
}

/** Heading change over the next `meters` of track from sample i. */
function turnAhead(track, i, meters) {
  const steps = Math.round(meters / track.spacing);
  let most = 0;
  const h0 = track.heading[i];
  for (let k = 4; k <= steps; k += 3) {
    const d = Math.abs(wrapAngle(track.heading[(i + k) % track.N] - h0));
    if (d > most) most = d;
  }
  return most;
}

/**
 * Computer driver. ai: { skill 0.8..1, lane -1..1 (preferred side), t (time, for wobble) }.
 */
export function botInput(car, track, ai) {
  const speed = Math.max(0, car.fwd);
  const ahead = 9 + speed * 0.5;
  const k = Math.round(ahead / track.spacing);
  const i = (car.idx + k) % track.N;
  const lane = clamp(ai.lane + Math.sin(ai.t * 0.4 + ai.lane * 3) * 0.25, -1, 1) * (track.hw - 3);
  const txp = track.px[i] + track.nx[i] * lane;
  const tzp = track.pz[i] + track.nz[i] * lane;
  const want = Math.atan2(txp - car.x, tzp - car.z);
  const diff = wrapAngle(want - car.yaw);
  const steer = clamp(-diff * 2.8, -1, 1);

  const bend = turnAhead(track, car.idx, 18 + speed * 1.1);
  const limit = car.stats.speed * ai.skill * (1 - clamp(bend / 2.4, 0, 0.5));
  const brake = speed > limit + 3;
  const throttle = speed < limit * ai.skill + 0.5 ? 1 : 0;
  // Boost on straights.
  const useItem = car.items > 0 && bend < 0.25 && car.boost <= 0 && Math.random() < 0.02;
  return { steer, throttle, brake, drift: false, useItem };
}

/** Pushes two cars apart (only `a` moves when `onlyA`). */
export function separate(a, b, onlyA) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  const d = Math.hypot(dx, dz);
  const R = 2.3;
  if (d >= R || d < 1e-3 || Math.abs(a.y - b.y) > 3) return false;
  const push = (R - d) / d;
  if (onlyA) {
    a.x += dx * push;
    a.z += dz * push;
  } else {
    a.x += dx * push * 0.5;
    a.z += dz * push * 0.5;
    b.x -= dx * push * 0.5;
    b.z -= dz * push * 0.5;
  }
  // Lose a little speed in the bump.
  a.vx *= 0.985;
  a.vz *= 0.985;
  return true;
}

export const FIXED_DT = 1 / 60;

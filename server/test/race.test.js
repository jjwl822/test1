import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { createServer } from '../src/app.js';
import { TRACKS, buildTrack, gridSlot } from '../web/games/race/tracks.js';

let server;
let base;
let dataDir;
const clients = [];

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-race-'));
  server = createServer({ familyCode: 'c', dataDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `127.0.0.1:${server.address().port}`;
});

after(async () => {
  for (const ws of clients) ws.terminate();
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const reg = async (username, displayName) =>
  (await fetch(`http://${base}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ familyCode: 'c', username, displayName, password: 'pass1234' }),
  })).json();

/** A race client that remembers every message and can wait for one. */
function join(token) {
  const ws = new WebSocket(`ws://${base}/ws/race?token=${token}`);
  clients.push(ws);
  // Messages not looked at yet; next() takes the first match and drops everything before it.
  const queue = [];
  let waiter = null;
  ws.on('message', (data) => {
    queue.push(JSON.parse(data));
    waiter?.();
  });
  return {
    ws,
    send: (m) => ws.send(JSON.stringify(m)),
    next(match, ms = 15000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiter = null;
          reject(new Error(`timed out waiting; got ${queue.map((m) => m.t).join(',')}`));
        }, ms);
        const check = () => {
          const i = queue.findIndex(match);
          if (i < 0) return;
          const m = queue[i];
          queue.splice(0, i + 1);
          waiter = null;
          clearTimeout(timer);
          resolve(m);
        };
        waiter = check;
        check();
      });
    },
    opened: new Promise((r) => ws.on('open', r)),
  };
}

test('every track builds, closes up and fits its grid', () => {
  for (const def of TRACKS) {
    const t = buildTrack(def);
    assert.ok(t.N > 200, def.id);
    const gap = Math.hypot(t.px[0] - t.px[t.N - 1], t.pz[0] - t.pz[t.N - 1]);
    assert.ok(gap < t.spacing * 1.5, `${def.id} loop closes`);
    for (let k = 0; k < 8; k++) assert.ok(Number.isFinite(gridSlot(t, k).x));
  }
});

test('a family race: lobby, ready, start, positions, finish, records', async () => {
  const dad = await reg('dad', '아빠');
  const kid = await reg('kid', '유이');
  assert.equal((await fetch(`http://${base}/api/race/records`)).status, 401);

  const a = join(dad.token);
  await a.opened;
  const welcome = await a.next((m) => m.t === 'welcome');
  assert.equal(welcome.you, `u${dad.user.id}`);
  const b = join(kid.token);
  await b.next((m) => m.t === 'room' && m.players.length === 2);

  // The first one in is the host and picks the track; the other one can't.
  b.send({ t: 'settings', track: 't3' });
  a.send({ t: 'settings', track: 't2', bots: 2 });
  const room = await b.next((m) => m.t === 'room' && m.track === 't2');
  assert.equal(room.hostId, `u${dad.user.id}`);
  assert.equal(room.bots, 2);

  // Can't start until everyone is ready.
  a.send({ t: 'start' });
  assert.match((await a.next((m) => m.t === 'notice')).text, /준비/);
  b.send({ t: 'car', car: 'rocket' });
  b.send({ t: 'ready', ready: true });
  await a.next((m) => m.t === 'room' && m.players.every((p) => p.id === m.hostId || p.ready));
  a.send({ t: 'start' });
  const start = await b.next((m) => m.t === 'start');
  assert.equal(start.track, 't2');
  assert.equal(start.racers.length, 4);
  assert.equal(start.botHost, `u${dad.user.id}`);
  assert.equal(start.racers.find((r) => r.name === '유이').car, 'rocket');
  assert.deepEqual(start.racers.map((r) => r.slot).sort(), [0, 1, 2, 3]);

  // Positions from each phone (and the host's computer cars) reach everyone.
  a.send({ t: 'st', s: [1, 0, 2, 0, 10, 5, 0, 0, 0], b: { b0: [3, 0, 4, 0, 9, 4, 0, 0, 0] } });
  b.send({ t: 'st', s: [5, 0, 6, 0, 11, 7, 0, 0, 0], b: { b1: [9, 9, 9, 0, 0, 999, 0, 0, 0] } });
  const st = await a.next((m) => m.t === 'st' && m.p[`u${kid.user.id}`] && m.p.b0);
  assert.deepEqual(st.p[`u${kid.user.id}`], [5, 0, 6, 0, 11, 7, 0, 0, 0]);
  assert.equal(st.p.b1, undefined); // only the host drives computer cars

  // Finishing before the green light, or impossibly fast, doesn't count.
  b.send({ t: 'fin', time: 50000 });
  await new Promise((r) => setTimeout(r, start.startAt - Date.now() + 100));
  b.send({ t: 'fin', time: 2000 });
  b.send({ t: 'fin', time: 61000 });
  const fin = await a.next((m) => m.t === 'fin');
  assert.deepEqual([fin.name, fin.rank, fin.time], ['유이', 1, 61000]);
  assert.ok(fin.endAt > Date.now());
  a.send({ t: 'fin', id: 'b0', time: 62000 });
  a.send({ t: 'fin', time: 65000 });

  const results = await a.next((m) => m.t === 'results');
  // Finished by time, then the rest by how far they got; computer car times aren't saved.
  assert.deepEqual(results.list.map((r) => [r.name, r.rank, r.time]), [['유이', 1, 61000], ['토끼봇', 2, 62000], ['아빠', 3, 65000], ['거북봇', 4, null]]);
  assert.deepEqual(results.newBest.sort(), [`u${dad.user.id}`, `u${kid.user.id}`].sort());
  assert.deepEqual(results.records.t2.map((r) => [r.name, r.best, r.car]), [['유이', 61000, 'rocket'], ['아빠', 65000, 'thunder']]);
  const room2 = await a.next((m) => m.t === 'room' && m.phase === 'lobby');
  assert.ok(room2.players.every((p) => !p.ready));

  const records = await (await fetch(`http://${base}/api/race/records`, { headers: { authorization: `Bearer ${kid.token}` } })).json();
  assert.equal(records.tracks.t2[0].name, '유이');
  assert.deepEqual(records.tracks.t1, []);

  // Leaving hands the host role on.
  a.ws.close();
  const after = await b.next((m) => m.t === 'room' && m.players.length === 1);
  assert.equal(after.hostId, `u${kid.user.id}`);
  b.ws.close();
});

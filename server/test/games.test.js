import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from '../src/app.js';

let server;
let base;
let dataDir;
let gamesDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-games-'));
  gamesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-games-dir-'));
  for (const id of ['quiz', 'race']) {
    fs.mkdirSync(path.join(gamesDir, id));
    fs.writeFileSync(path.join(gamesDir, id, 'index.html'), '<!doctype html><title>game</title>');
  }
  fs.writeFileSync(
    path.join(gamesDir, 'games.json'),
    JSON.stringify([
      { id: 'quiz', title: '퀴즈', emoji: '❓' },
      { id: 'race', title: '달리기', scoreOrder: 'low', scoreUnit: '초' },
      { id: 'missing', title: '파일 없음' },
      { id: '../evil', title: '나쁜 경로' },
    ]),
  );
  server = createServer({ familyCode: 'c', dataDir, gamesDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(gamesDir, { recursive: true, force: true });
});

async function call(token, method, url, json) {
  const headers = { authorization: `Bearer ${token}` };
  if (json) headers['content-type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: json ? JSON.stringify(json) : undefined });
  return { status: res.status, data: await res.json() };
}
const reg = async (username, displayName) =>
  (await fetch(`${base}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ familyCode: 'c', username, displayName, password: 'pass1234' }),
  })).json();

test('games list and family leaderboards', async () => {
  const mom = await reg('mom', '엄마');
  const kid = await reg('kid', '아이');

  const games = (await call(mom.token, 'GET', '/api/games')).data;
  assert.deepEqual(games.map((g) => g.id), ['quiz', 'race']); // missing file and bad id are skipped
  assert.equal(games[0].url, '/games/quiz/index.html');
  assert.equal(games[0].scoreOrder, 'high');
  assert.equal(games[1].scoreUnit, '초');
  assert.equal((await fetch(`${base}/api/games`)).status, 401);

  // Higher is better for quiz
  await call(mom.token, 'POST', '/api/games/quiz/scores', { score: 5 });
  await call(mom.token, 'POST', '/api/games/quiz/scores', { score: 9 });
  const first = (await call(kid.token, 'POST', '/api/games/quiz/scores', { score: 7 })).data;
  assert.equal(first.record, true);
  assert.deepEqual(first.leaderboard.map((r) => [r.name, r.best, r.plays, r.me]), [['엄마', 9, 2, false], ['아이', 7, 1, true]]);
  assert.equal((await call(kid.token, 'POST', '/api/games/quiz/scores', { score: 3 })).data.record, false);

  // Lower is better for race
  await call(mom.token, 'POST', '/api/games/race/scores', { score: 12.5 });
  const race = (await call(kid.token, 'POST', '/api/games/race/scores', { score: 10.2 })).data;
  assert.deepEqual(race.leaderboard.map((r) => r.name), ['아이', '엄마']);
  assert.equal((await call(mom.token, 'GET', '/api/games/race/scores')).data.leaderboard[0].best, 10.2);

  assert.equal((await call(mom.token, 'POST', '/api/games/quiz/scores', { score: 'lots' })).status, 400);
  assert.equal((await call(mom.token, 'POST', '/api/games/nope/scores', { score: 1 })).status, 404);

  // Adding a game is just editing games.json: no restart.
  fs.mkdirSync(path.join(gamesDir, 'new'));
  fs.writeFileSync(path.join(gamesDir, 'new', 'index.html'), '<!doctype html>');
  const list = JSON.parse(fs.readFileSync(path.join(gamesDir, 'games.json'), 'utf8'));
  fs.writeFileSync(path.join(gamesDir, 'games.json'), JSON.stringify([...list, { id: 'new', title: '새 게임' }]));
  assert.deepEqual((await call(mom.token, 'GET', '/api/games')).data.map((g) => g.id), ['quiz', 'race', 'new']);

  // A broken games.json shows no games instead of failing.
  fs.writeFileSync(path.join(gamesDir, 'games.json'), '{ oops');
  assert.deepEqual((await call(mom.token, 'GET', '/api/games')).data, []);
});

test('the bundled games.json lists games that exist', () => {
  const dir = new URL('../web/games/', import.meta.url);
  const list = JSON.parse(fs.readFileSync(new URL('games.json', dir), 'utf8'));
  assert.ok(list.length >= 2);
  for (const g of list) assert.ok(fs.existsSync(new URL(`${g.id}/index.html`, dir)), `${g.id}/index.html`);
});

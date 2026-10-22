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

test('every play is kept, resends count once, and records can be read without playing', async () => {
  fs.writeFileSync(
    path.join(gamesDir, 'games.json'),
    JSON.stringify([
      { id: 'quiz', title: '퀴즈' },
      { id: 'race', title: '달리기', scoreOrder: 'low', scoreUnit: '초' },
      { id: 'board', title: '기록판', scores: false },
    ]),
  );
  fs.mkdirSync(path.join(gamesDir, 'board'), { recursive: true });
  fs.writeFileSync(path.join(gamesDir, 'board', 'index.html'), '<!doctype html>');
  const dad = await reg('dad', '아빠');
  const grandma = await reg('grandma', '할머니');

  const games = (await call(dad.token, 'GET', '/api/games')).data;
  assert.deepEqual(games.map((g) => [g.id, g.scores]), [['quiz', true], ['race', true], ['board', false]]);
  assert.equal((await call(dad.token, 'POST', '/api/games/board/scores', { score: 1 })).status, 404);

  // Each play counts, and the board shows the latest score next to the best.
  for (const score of [20, 35, 28]) await call(dad.token, 'POST', '/api/games/quiz/scores', { score });
  const quiz = (await call(grandma.token, 'GET', '/api/games/quiz/scores')).data;
  const dadRow = quiz.leaderboard.find((r) => r.name === '아빠');
  assert.deepEqual([dadRow.best, dadRow.plays, dadRow.last, dadRow.me], [35, 3, 28, false]);
  assert.deepEqual(quiz.recent.slice(0, 3).map((r) => [r.name, r.score]), [['아빠', 28], ['아빠', 35], ['아빠', 20]]);

  // A score resent after a dropped connection is saved once, at the time it was played.
  const playedAt = Date.now() - 60_000;
  const first = await call(grandma.token, 'POST', '/api/games/race/scores', { score: 9.5, clientId: 'abcdef12-retry', playedAt });
  const again = await call(grandma.token, 'POST', '/api/games/race/scores', { score: 9.5, clientId: 'abcdef12-retry', playedAt });
  assert.equal(first.status, 201);
  assert.equal(again.status, 200);
  assert.equal(again.data.duplicate, true);
  const race = (await call(grandma.token, 'GET', '/api/games/race/scores')).data;
  const mine = race.leaderboard.find((r) => r.me);
  assert.equal(mine.plays, 1);
  assert.equal(mine.lastAt, playedAt);
  // A made-up future time is replaced with now.
  const future = await call(grandma.token, 'POST', '/api/games/race/scores', { score: 11, playedAt: Date.now() + 1e9 });
  assert.ok(future.data.recent[0].at <= Date.now());

  // The records board gets every scored game at once.
  const records = (await call(grandma.token, 'GET', '/api/games/records')).data;
  assert.deepEqual(records.map((r) => r.game.id), ['quiz', 'race']);
  assert.equal(records[0].leaderboard.find((r) => r.name === '아빠').plays, 3);
  assert.ok(records[1].recent.length >= 2);
  assert.equal((await fetch(`${base}/api/games/records`)).status, 401);
});

test('script errors from games are written to the error log', async () => {
  const errorLog = path.join(dataDir, 'game-errors.log');
  const kid = await reg('errkid', '막내');
  const res = await fetch(`${base}/api/games/quiz/errors`, {
    method: 'POST',
    headers: { authorization: `Bearer ${kid.token}`, 'content-type': 'application/json', 'user-agent': 'TestPhone/1.0' },
    body: JSON.stringify({ message: 'x is not defined', where: 'quiz/index.html:10:5' }),
  });
  assert.equal(res.status, 204);
  const line = JSON.parse(fs.readFileSync(errorLog, 'utf8').trim().split('\n').pop());
  assert.deepEqual([line.user, line.game, line.message, line.where, line.ua], ['막내', 'quiz', 'x is not defined', 'quiz/index.html:10:5', 'TestPhone/1.0']);
  assert.equal((await fetch(`${base}/api/games/quiz/errors`, { method: 'POST' })).status, 401);
});

test('game saves are backed up per person and an older save never replaces a newer one', async () => {
  const a = await reg('saver', '세이브');
  const b = await reg('other', '다른 사람');
  const put = (token, body, at) =>
    fetch(`${base}/api/games/quiz/save?at=${at}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' },
      body,
    });

  assert.deepEqual((await call(a.token, 'GET', '/api/games/quiz/save')).data, { data: null, savedAt: 0 });
  assert.equal((await put(a.token, '{"lv":3}', 1000)).status, 204);
  assert.equal((await put(a.token, '{"lv":1}', 500)).status, 204); // late, older copy is ignored
  assert.deepEqual((await call(a.token, 'GET', '/api/games/quiz/save')).data, { data: '{"lv":3}', savedAt: 1000 });
  assert.equal((await put(a.token, '{"lv":5}', 2000)).status, 204);
  assert.equal((await call(a.token, 'GET', '/api/games/quiz/save')).data.data, '{"lv":5}');

  assert.equal((await call(b.token, 'GET', '/api/games/quiz/save')).data.data, null); // each person has their own
  assert.equal((await put(a.token, 'x', 1)).status, 204);
  assert.equal((await fetch(`${base}/api/games/nope/save?at=1`, { method: 'PUT', headers: { authorization: `Bearer ${a.token}`, 'content-type': 'text/plain' }, body: 'x' })).status, 404);
  assert.equal((await fetch(`${base}/api/games/quiz/save`)).status, 401);
});

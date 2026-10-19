import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { createServer } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { ruleExtract } from '../src/homework.js';

let server;
let base;
let dataDir;
let clock = new Date(2026, 9, 17, 8, 0); // Sat 17 Oct 2026
const calls = [];
let failNext = false;

/**
 * Stands in for Claude: one item per "- " line; whose it is from "유호숙제" / "유이숙제" in the
 * conversation; "월요일" → the 19th.
 */
async function fakeExtract(conversation, today, context) {
  calls.push({ conversation, today, context });
  if (failNext) {
    failNext = false;
    throw new Error('claude unavailable');
  }
  const child = conversation.includes('유호숙제') ? '유호' : conversation.includes('유이숙제') ? '유이' : null;
  return conversation
    .split('\n')
    .map((l) => l.replace(/^\[[^\]]*\]\s*/, '').trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => ({ text: l.slice(2), due: l.includes('월요일') ? '2026-10-19' : 'someday', child }));
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-homework-'));
  server = createServer({
    familyCode: 'secret',
    dataDir,
    now: () => clock,
    reminderHour: 9,
    homework: { authors: ['mom', 'dad'], children: { 유호: 'boy', 유이: 'kid' }, assignee: 'kid', extract: fakeExtract },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function call(method, url, { token, json } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (json) headers['content-type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: json ? JSON.stringify(json) : undefined });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, data };
}

const users = {};
async function setup() {
  if (users.mom) return users;
  for (const [username, displayName] of [['mom', '엄마'], ['dad', '아빠'], ['kid', '유이'], ['boy', '유호']]) {
    users[username] = (
      await call('POST', '/api/register', { json: { familyCode: 'secret', username, displayName, password: 'pass1234' } })
    ).data;
  }
  return users;
}

const say = (u, text, room = 'family') => call('POST', `/api/conversations/${room}/messages`, { token: u.token, json: { text } });
const homework = async (u) => (await call('GET', '/api/lists/items', { token: u.token })).data.filter((i) => i.list === 'homework');
const lastLine = async (u, room = 'family') => (await call('GET', `/api/conversations/${room}/messages`, { token: u.token })).data.at(-1).text;
const dm = (a, b) => `dm-${Math.min(a.user.id, b.user.id)}-${Math.max(a.user.id, b.user.id)}`;

test('nothing is sent to Claude until a parent says 숙제', async () => {
  const { mom, dad, kid } = await setup();
  await say(mom, '라이팅\n- 31쪽 끝내기\n- 섀도잉 월요일까지 제출');
  await say(dad, 'ㅇㅋ');
  await say(kid, '숙제 하기 싫다'); // not a parent
  await server.homeworkIdle();
  assert.equal(calls.length, 0);

  await say(mom, '유이숙제');
  await server.homeworkIdle();
  assert.equal(calls.length, 1);
  const { conversation, context } = calls[0];
  assert.match(conversation, /\[엄마\] 라이팅/, 'the conversation before it is included, with names');
  assert.match(conversation, /\[아빠\] ㅇㅋ/);
  assert.deepEqual(context.children, ['유이', '유호']);

  const items = await homework(kid);
  assert.deepEqual(items.map((i) => i.text).sort(), ['31쪽 끝내기', '섀도잉 월요일까지 제출']);
  const shadowing = items.find((i) => i.text.startsWith('섀도잉'));
  assert.equal(shadowing.due, '2026-10-19');
  assert.equal(items.find((i) => i.text === '31쪽 끝내기').due, null, 'bad dates are dropped');
  assert.equal(shadowing.assigneeName, '유이');
  assert.equal(shadowing.authorName, '엄마');
  assert.equal(shadowing.fromChat, true);
  const source = (await call('GET', `/api/lists/items/${shadowing.id}/source`, { token: kid.token })).data;
  assert.ok(source.messages.some((m) => /라이팅/.test(m.text)));
  assert.match(await lastLine(kid), /📚 숙제 2개를 목록에 넣었어요\n• \[유이\] /);

  // Messages already read aren't sent again.
  await say(mom, '숙제 다 했니?');
  await server.homeworkIdle();
  assert.doesNotMatch(calls.at(-1).conversation, /라이팅/);
});

test('"유호숙제" with the details in the next message, in a 1:1 chat', async () => {
  const { dad, mom, boy } = await setup();
  const room = dm(dad, mom);
  await say(dad, '유호숙제', room);
  await say(dad, '- 내일 영어시험', room);
  await server.homeworkIdle();
  assert.match(calls.at(-1).conversation, /유호숙제\n\[아빠\] - 내일 영어시험/);
  assert.equal((await homework(boy)).find((i) => i.text === '내일 영어시험')?.assigneeName, '유호');
  assert.match(await lastLine(mom, room), /📚 숙제 1개를 목록에 넣었어요\n• \[유호\] 내일 영어시험/);
});

test('"과제" works like "숙제"', async () => {
  const { mom, boy } = await setup();
  const before = calls.length;
  await say(mom, '유호숙제 말고 과제\n- 과학 탐구 보고서 쓰기');
  await server.homeworkIdle();
  assert.equal(calls.length, before + 1);
  await say(mom, '방학 과제\n- 독서록 2편');
  await server.homeworkIdle();
  assert.equal(calls.length, before + 2);
  assert.ok((await homework(boy)).some((i) => i.text === '과학 탐구 보고서 쓰기'));
});

test('📢 notices count, a notice pasted again is skipped, items are not added twice', async () => {
  const { mom, kid } = await setup();
  const before = calls.length;
  await say(mom, '📢 Vocab Test 이번 주 공지입니다\n- 단어시험 5주+6주 연습하기\n- 31쪽 끝내기');
  await server.homeworkIdle();
  assert.equal(calls.length, before + 1);
  const items = await homework(kid);
  assert.equal(items.filter((i) => i.text === '31쪽 끝내기').length, 1, 'still-open items are not added twice');
  assert.ok(items.some((i) => i.text === '단어시험 5주+6주 연습하기'));
  assert.ok(calls.at(-1).context.existing['유이'].includes('31쪽 끝내기'), 'Claude sees what is already there');

  await say(mom, '붙여📢 Vocab Test 이번 주 공지입니다\n- 단어시험 5주+6주 연습하기\n- 31쪽 끝내기');
  await server.homeworkIdle();
  assert.equal(calls.length, before + 1);
  assert.equal(await lastLine(kid), '📚 이미 숙제 목록에 넣은 공지예요.');
});

test('when Claude fails the "- " lines are used as they are', async () => {
  const { mom, kid } = await setup();
  failNext = true;
  await say(mom, '숙제\n- 연필 깎아 오기\n- 1~4주 제출자는 상품이 나갈 예정입니다.');
  await server.homeworkIdle();
  const items = await homework(kid);
  assert.ok(items.some((i) => i.text === '연필 깎아 오기'));
  assert.ok(!items.some((i) => i.text.includes('상품')));
});

test('homework is split between the children and can be added or moved by hand', async () => {
  const { mom, kid, boy } = await setup();
  const people = (await call('GET', '/api/homework/people', { token: kid.token })).data;
  assert.deepEqual(people.map((p) => p.name), ['유이', '유호'], 'the default child comes first');
  const item = (await call('POST', '/api/lists/items', { token: mom.token, json: { list: 'homework', text: '일기 쓰기', assigneeId: boy.user.id } })).data;
  assert.equal(item.assigneeName, '유호');
  const moved = (await call('PATCH', `/api/lists/items/${item.id}`, { token: mom.token, json: { assigneeId: kid.user.id } })).data;
  assert.equal(moved.assigneeName, '유이');
  const bad = await call('PATCH', `/api/lists/items/${item.id}`, { token: mom.token, json: { assigneeId: mom.user.id } });
  assert.equal(bad.status, 400);
});

test('homework due dates, and reminders only for the child', async () => {
  const { mom, dad, kid } = await setup();
  const bad = await call('POST', '/api/lists/items', { token: mom.token, json: { list: 'homework', text: '수학', due: '2026-13-01' } });
  assert.equal(bad.status, 400);
  const item = (await call('POST', '/api/lists/items', { token: mom.token, json: { list: 'homework', text: '수학 익힘책', due: '2026-10-18' } })).data;
  assert.equal(item.due, '2026-10-18');
  assert.equal(item.assigneeName, '유이');
  assert.equal((await call('PATCH', `/api/lists/items/${item.id}`, { token: mom.token, json: { due: null } })).data.due, null);
  await call('PATCH', `/api/lists/items/${item.id}`, { token: mom.token, json: { due: '2026-10-18' } });

  clock = new Date(2026, 9, 17, 19, 0);
  const sent = [];
  const sockets = await Promise.all(
    [kid, dad].map(async (u) => {
      const socket = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { authorization: `Bearer ${u.token}` } });
      socket.on('message', (d) => {
        const e = JSON.parse(d);
        if (e.type === 'reminder') sent.push({ who: u.user.username, ...e });
      });
      await new Promise((r) => socket.on('open', r));
      return socket;
    }),
  );
  await new Promise((r) => setTimeout(r, 200));
  sockets.forEach((s) => s.close());
  const reminders = sent.filter((s) => s.title.includes('숙제'));
  assert.ok(reminders.some((s) => s.who === 'kid' && s.text === '수학 익힘책' && s.title.includes('내일') && s.target === 'homework'));
  assert.ok(!reminders.some((s) => s.who === 'dad'));
});

test('ruleExtract keeps the to-do lines', () => {
  assert.deepEqual(ruleExtract('[엄마] 📢 A\n- 하나\n; 둘째\n안내 문장\n[엄마] - 상품이 나갑니다'), [
    { text: '하나', due: null, child: null },
    { text: '둘째', due: null, child: null },
  ]);
});

test('an old database gets the homework list without losing items', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-hw-migrate-'));
  const file = path.join(dir, 'm.db');
  const db = openDatabase(file);
  db.exec(`
    DROP TABLE list_items;
    CREATE TABLE list_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, list TEXT NOT NULL CHECK (list IN ('shopping', 'todo')), text TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0, author_id INTEGER NOT NULL REFERENCES users(id), done_by INTEGER REFERENCES users(id),
      created_at INTEGER NOT NULL, done_at INTEGER);
    INSERT INTO users (username, display_name, password_hash, created_at) VALUES ('a', 'A', 'x', 0);
    INSERT INTO list_items (list, text, author_id, created_at) VALUES ('todo', '분리수거', 1, 0);
  `);
  db.close();
  const again = openDatabase(file);
  again.prepare("INSERT INTO list_items (list, text, author_id, created_at, due) VALUES ('homework', '숙제', 1, 0, '2026-10-20')").run();
  assert.deepEqual(again.prepare('SELECT list, text FROM list_items ORDER BY id').all().map((r) => `${r.list}:${r.text}`), [
    'todo:분리수거',
    'homework:숙제',
  ]);
  again.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

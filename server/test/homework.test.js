import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { ruleExtract } from '../src/homework.js';

let server;
let base;
let dataDir;
let clock = new Date(2026, 9, 17, 8, 0); // Sat 17 Oct 2026
const calls = [];
let failNext = false;

/** Stands in for Claude: one item per "- " line, "월요일" → the 19th. */
async function fakeExtract(text, today, existing) {
  calls.push({ text, today, existing });
  if (failNext) {
    failNext = false;
    throw new Error('claude unavailable');
  }
  return text
    .split('\n')
    .filter((l) => l.trim().startsWith('- '))
    .map((l) => ({ text: l.trim().slice(2), due: l.includes('월요일') ? '2026-10-19' : 'someday' }));
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-homework-'));
  server = createServer({
    familyCode: 'secret',
    dataDir,
    now: () => clock,
    reminderHour: 9,
    homework: { authors: ['mom'], assignee: 'kid', extract: fakeExtract },
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
  for (const [username, displayName] of [['mom', '엄마'], ['dad', '아빠'], ['kid', '유이']]) {
    users[username] = (
      await call('POST', '/api/register', { json: { familyCode: 'secret', username, displayName, password: 'pass1234' } })
    ).data;
  }
  return users;
}

const say = (u, text) => call('POST', '/api/conversations/family/messages', { token: u.token, json: { text } });
const homework = async (u) => (await call('GET', '/api/lists/items', { token: u.token })).data.filter((i) => i.list === 'homework');

test('a notice followed by "유이숙제" becomes homework items, once', async () => {
  const { mom, dad, kid } = await setup();
  await say(mom, '라이팅 숙제\n- 31쪽 끝내기\n- 섀도잉 6주차 월요일까지 제출');
  await say(dad, '- 아빠 글은 무시');
  await say(mom, '오늘 저녁 뭐 먹지');
  await server.homeworkIdle();
  assert.equal(calls.length, 0, 'plain messages are left alone');

  await say(mom, '유이숙제');
  await server.homeworkIdle();
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /31쪽/);
  assert.match(calls[0].text, /저녁/, 'takes the messages mom sent just before');
  assert.doesNotMatch(calls[0].text, /아빠/);

  const items = await homework(kid);
  assert.deepEqual(items.map((i) => i.text).sort(), ['31쪽 끝내기', '섀도잉 6주차 월요일까지 제출']);
  const shadowing = items.find((i) => i.text.startsWith('섀도잉'));
  assert.equal(shadowing.due, '2026-10-19');
  assert.equal(items.find((i) => i.text === '31쪽 끝내기').due, null, 'bad dates are dropped');
  assert.equal(shadowing.assigneeName, '유이');
  assert.equal(shadowing.authorName, '엄마');
  assert.equal(shadowing.fromChat, true);

  const source = (await call('GET', `/api/lists/items/${shadowing.id}/source`, { token: kid.token })).data;
  assert.equal(source.messages.length, 2);
  assert.match(source.messages[0].text, /라이팅/);

  const chat = (await call('GET', '/api/conversations/family/messages', { token: kid.token })).data;
  assert.match(chat.at(-1).text, /📚 숙제 2개를 목록에 넣었어요/);

  // Saying it again finds nothing new to read.
  await say(mom, '유이숙제');
  await server.homeworkIdle();
  assert.equal(calls.length, 1);
});

test('📢 notices are picked up on their own and duplicates are skipped', async () => {
  const { mom, kid } = await setup();
  const before = calls.length;
  await say(mom, '📢 Vocab Test\n- 단어시험 5주+6주 연습\n- 31쪽 끝내기');
  await server.homeworkIdle();
  assert.equal(calls.length, before + 1);
  const items = await homework(kid);
  assert.equal(items.filter((i) => i.text === '31쪽 끝내기').length, 1, 'still-open items are not added twice');
  assert.ok(items.some((i) => i.text === '단어시험 5주+6주 연습'));

  // "유이숙제" right after the 📢 notice doesn't process it a second time.
  await say(mom, '유이숙제');
  await server.homeworkIdle();
  assert.equal(calls.length, before + 1);

  // The same notice pasted again a day later (with a stray word) isn't sent to Claude again,
  // since Claude would word the items differently and slip past the item check.
  await say(mom, '붙여📢 Vocab Test\n- 단어시험 5주+6주 연습\n- 31쪽 끝내기');
  await server.homeworkIdle();
  assert.equal(calls.length, before + 1);
  const chat = (await call('GET', '/api/conversations/family/messages', { token: kid.token })).data;
  assert.equal(chat.at(-1).text, '📚 이미 숙제 목록에 넣은 공지예요.');
});

test('Claude is shown the homework already on the list', async () => {
  const { mom } = await setup();
  await say(mom, '📢 새 공지\n- 받아쓰기 3단원 연습하기');
  await server.homeworkIdle();
  const existing = calls.at(-1).existing;
  assert.ok(existing.includes('31쪽 끝내기'));
});

test('when Claude fails the "- " lines are used as they are', async () => {
  const { mom, kid } = await setup();
  failNext = true;
  await say(mom, '📢 필통\n- 연필 깎아 오기\n- 1~4주 제출자는 상품이 나갈 예정입니다.');
  await server.homeworkIdle();
  const items = await homework(kid);
  assert.ok(items.some((i) => i.text === '연필 깎아 오기'));
  assert.ok(!items.some((i) => i.text.includes('상품')));
});

test('homework can be added by hand with a due date, and reminds only the child', async () => {
  const { mom, dad, kid } = await setup();
  const bad = await call('POST', '/api/lists/items', { token: mom.token, json: { list: 'homework', text: '수학', due: '2026-13-01' } });
  assert.equal(bad.status, 400);
  const item = (await call('POST', '/api/lists/items', { token: mom.token, json: { list: 'homework', text: '수학 익힘책', due: '2026-10-18' } })).data;
  assert.equal(item.due, '2026-10-18');
  assert.equal(item.assigneeName, '유이');
  const moved = (await call('PATCH', `/api/lists/items/${item.id}`, { token: mom.token, json: { due: null } })).data;
  assert.equal(moved.due, null);
  await call('PATCH', `/api/lists/items/${item.id}`, { token: mom.token, json: { due: '2026-10-18' } });

  clock = new Date(2026, 9, 17, 19, 0);
  const sent = [];
  const ws = await Promise.all(
    [kid, dad].map(async (u) => {
      const { default: WebSocket } = await import('ws');
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
  ws.forEach((s) => s.close());
  const homeworkReminders = sent.filter((s) => s.title.includes('숙제'));
  assert.ok(homeworkReminders.some((s) => s.who === 'kid' && s.text === '수학 익힘책' && s.title.includes('내일')));
  assert.ok(!homeworkReminders.some((s) => s.who === 'dad'));
});

test('ruleExtract keeps the to-do lines of a notice', () => {
  assert.deepEqual(ruleExtract('📢 A\n- 하나\n; 둘째\n안내 문장\n- 상품이 나갑니다'), [
    { text: '하나', due: null },
    { text: '둘째', due: null },
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

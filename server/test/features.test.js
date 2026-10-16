import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { createServer } from '../src/app.js';
import { openDatabase } from '../src/db.js';

let server;
let base;
let dataDir;
let clock = new Date(2026, 9, 15, 8, 0); // 15 Oct 2026, 08:00 local

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-features-'));
  server = createServer({ familyCode: 'secret', dataDir, now: () => clock, reminderHour: 9 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function call(method, url, { token, json, body, type } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (json) headers['content-type'] = 'application/json';
  if (type) headers['content-type'] = type;
  const res = await fetch(base + url, { method, headers, body: json ? JSON.stringify(json) : body });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, data };
}

const users = {};
async function setup() {
  if (users.mom) return users;
  for (const [username, displayName] of [['mom', '엄마'], ['dad', '아빠'], ['kid', '아이']]) {
    users[username] = (
      await call('POST', '/api/register', { json: { familyCode: 'secret', username, displayName, password: 'pass1234' } })
    ).data;
  }
  return users;
}

/** Opens a socket and collects events; call .close() when done. */
async function listen(token) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { authorization: `Bearer ${token}` } });
  const events = [];
  ws.on('message', (d) => events.push(JSON.parse(d)));
  await new Promise((r) => ws.on('open', r));
  return { events, close: () => ws.close(), settle: () => new Promise((r) => setTimeout(r, 80)) };
}

test('read receipts and unread counts', async () => {
  const { mom, dad, kid } = await setup();
  const send = (u, text) => call('POST', '/api/conversations/family/messages', { token: u.token, json: { text } });
  const m1 = (await send(mom, '하나')).data;
  const m2 = (await send(mom, '둘')).data;

  const unread = async (u) => (await call('GET', '/api/conversations', { token: u.token })).data[0].unreadCount;
  assert.equal(await unread(dad), 2);
  assert.equal(await unread(mom), 0); // own messages are never unread

  const momSocket = await listen(mom.token);
  const r = await call('POST', '/api/conversations/family/read', { token: dad.token, json: { lastReadId: m1.id } });
  assert.equal(r.data.lastReadId, m1.id);
  assert.equal(await unread(dad), 1);
  // Can't move backwards or past the newest message
  await call('POST', '/api/conversations/family/read', { token: dad.token, json: { lastReadId: 999999 } });
  assert.equal(await unread(dad), 0);
  await momSocket.settle();
  momSocket.close();
  assert.ok(momSocket.events.some((e) => e.type === 'read' && e.userId === dad.user.id));

  const reads = (await call('GET', '/api/conversations/family/reads', { token: kid.token })).data;
  const byUser = Object.fromEntries(reads.map((x) => [x.userId, x.lastReadId]));
  assert.equal(byUser[mom.user.id], m2.id);
  assert.equal(byUser[dad.user.id], m2.id);
  assert.equal(byUser[kid.user.id], 0);
});

test('replies, emoji reactions and deleting', async () => {
  const { mom, dad, kid } = await setup();
  const dm = `dm-${mom.user.id}-${dad.user.id}`;
  const original = (await call('POST', `/api/conversations/${dm}/messages`, { token: mom.token, json: { text: '퇴근했어?' } })).data;
  const reply = await call('POST', `/api/conversations/${dm}/messages`, {
    token: dad.token,
    json: { text: '응 가는 중', replyTo: original.id },
  });
  assert.equal(reply.status, 201);
  assert.deepEqual(reply.data.replyTo, { id: original.id, senderName: '엄마', preview: '퇴근했어?' });
  // Can't reply to a message from another conversation
  const other = (await call('POST', '/api/conversations/family/messages', { token: mom.token, json: { text: 'x' } })).data;
  assert.equal(
    (await call('POST', `/api/conversations/${dm}/messages`, { token: dad.token, json: { text: 'y', replyTo: other.id } })).status,
    400,
  );

  const react = (u, emoji, id = original.id) => call('POST', `/api/messages/${id}/reactions`, { token: u.token, json: { emoji } });
  await react(dad, '❤️');
  let m = (await react(mom, '❤️')).data;
  assert.deepEqual(m.reactions, [{ emoji: '❤️', userIds: [dad.user.id, mom.user.id] }]);
  m = (await react(dad, '😂')).data; // replaces dad's heart
  assert.deepEqual(m.reactions.map((r) => [r.emoji, r.userIds]).sort(), [['❤️', [mom.user.id]], ['😂', [dad.user.id]]].sort());
  m = (await react(mom, '❤️')).data; // toggles off
  assert.deepEqual(m.reactions, [{ emoji: '😂', userIds: [dad.user.id] }]);
  assert.equal((await react(mom, '🍕')).status, 400);
  assert.equal((await react(kid, '❤️')).status, 404); // not in this conversation

  assert.equal((await call('DELETE', `/api/messages/${original.id}`, { token: dad.token })).status, 403);
  const deleted = (await call('DELETE', `/api/messages/${original.id}`, { token: mom.token })).data;
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.text, null);
  assert.deepEqual(deleted.reactions, []);
  const history = (await call('GET', `/api/conversations/${dm}/messages`, { token: dad.token })).data;
  assert.equal(history.find((x) => x.id === reply.data.id).replyTo.preview, '삭제된 메시지');

  // Deleting a photo removes the file
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const photo = (await call('POST', `/api/conversations/${dm}/images`, { token: mom.token, body: png, type: 'image/png' })).data;
  const file = path.join(dataDir, 'uploads', photo.imageUrl.split('/').pop());
  assert.ok(fs.existsSync(file));
  await call('DELETE', `/api/messages/${photo.id}`, { token: mom.token });
  assert.equal(fs.existsSync(file), false);
});

test('polls', async () => {
  const { mom, dad, kid } = await setup();
  const create = (json) => call('POST', '/api/conversations/family/polls', { token: mom.token, json });
  assert.equal((await create({ question: '저녁?', options: ['짜장'] })).status, 400);
  const poll = (await create({ question: '저녁 뭐 먹을까?', options: ['짜장면', '짬뽕', ' '] })).data;
  assert.equal(poll.kind, 'poll');
  assert.deepEqual(poll.poll.options.map((o) => o.text), ['짜장면', '짬뽕']);
  const [a, b] = poll.poll.options.map((o) => o.id);

  const vote = (u, optionIds) => call('POST', `/api/messages/${poll.id}/vote`, { token: u.token, json: { optionIds } });
  assert.equal((await vote(dad, [a, b])).status, 400); // single choice
  await vote(dad, [a]);
  await vote(kid, [a]);
  let p = (await vote(kid, [b])).data.poll; // changes vote
  assert.deepEqual(p.options.map((o) => o.voterIds), [[dad.user.id], [kid.user.id]]);
  p = (await vote(dad, [])).data.poll; // takes vote back
  assert.deepEqual(p.options[0].voterIds, []);

  const multi = (await create({ question: '언제 모일까?', options: ['토', '일'], multiple: true })).data;
  const both = multi.poll.options.map((o) => o.id);
  const voted = (await call('POST', `/api/messages/${multi.id}/vote`, { token: dad.token, json: { optionIds: both } })).data;
  assert.deepEqual(voted.poll.options.map((o) => o.voterIds), [[dad.user.id], [dad.user.id]]);
  // Options from another poll are rejected
  assert.equal((await vote(dad, [both[0]])).status, 400);
});

test('profile name and photo', async () => {
  const { mom, dad } = await setup();
  const dadSocket = await listen(dad.token);
  const renamed = await call('PATCH', '/api/me', { token: mom.token, json: { displayName: '엄마😊' } });
  assert.equal(renamed.data.displayName, '엄마😊');
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const withPhoto = (await call('POST', '/api/me/avatar', { token: mom.token, body: png, type: 'image/png' })).data;
  assert.match(withPhoto.avatarUrl, /^\/api\/media\/[a-f0-9]{32}\.png$/);
  assert.equal((await call('GET', withPhoto.avatarUrl, { token: dad.token })).status, 200);

  const replaced = (await call('POST', '/api/me/avatar', { token: mom.token, body: png, type: 'image/png' })).data;
  assert.equal((await call('GET', withPhoto.avatarUrl, { token: dad.token })).status, 404); // old photo removed
  const list = (await call('GET', '/api/users', { token: dad.token })).data;
  assert.equal(list.find((u) => u.id === mom.user.id).avatarUrl, replaced.avatarUrl);

  await call('DELETE', '/api/me/avatar', { token: mom.token });
  await dadSocket.settle();
  dadSocket.close();
  assert.ok(dadSocket.events.filter((e) => e.type === 'user').length >= 3);
  await call('PATCH', '/api/me', { token: mom.token, json: { displayName: '엄마' } });
});

test('bubble colors', async () => {
  const { mom, dad } = await setup();
  const colors = (await call('GET', '/api/colors', { token: mom.token })).data;
  assert.equal(colors.length, 10);
  // Everyone starts with a different color, by join order.
  const users = (await call('GET', '/api/users', { token: mom.token })).data;
  assert.equal(new Set(users.map((u) => u.color)).size, users.length);
  assert.ok(users.every((u) => colors.includes(u.color)));

  const picked = await call('PATCH', '/api/me', { token: dad.token, json: { color: colors[4] } });
  assert.equal(picked.data.color, colors[4]);
  assert.equal(picked.data.displayName, '아빠'); // name untouched
  assert.equal((await call('PATCH', '/api/me', { token: dad.token, json: { color: '#123456' } })).status, 400);
  assert.equal((await call('PATCH', '/api/me', { token: dad.token, json: {} })).status, 400);
  const seen = (await call('GET', '/api/users', { token: mom.token })).data.find((u) => u.id === dad.user.id);
  assert.equal(seen.color, colors[4]);
});

test('calendar and reminders', async () => {
  const { mom, dad } = await setup();
  const add = (json) => call('POST', '/api/events', { token: mom.token, json });
  assert.equal((await add({ title: '틀린 날짜', date: '2026-02-30' })).status, 400);
  assert.equal((await add({ title: '틀린 시간', date: '2026-10-16', time: '25:00' })).status, 400);

  const dentist = (await add({ title: '치과', date: '2026-10-16', time: '14:30' })).data;
  await add({ title: '아빠 생일', date: '1970-10-15', yearly: true });
  await add({ title: '먼 일정', date: '2026-12-25' });
  assert.equal(dentist.authorName, '엄마');

  // Anyone can edit or delete
  const edited = (await call('PATCH', `/api/events/${dentist.id}`, { token: dad.token, json: { ...dentist, note: '보험증 챙기기' } })).data;
  assert.equal(edited.note, '보험증 챙기기');
  assert.equal((await call('GET', '/api/events', { token: dad.token })).data.length, 3);

  // Before 9:00 nothing is sent; at 9:00 a connected phone gets today's and tomorrow's reminders, once.
  let socket = await listen(dad.token);
  await socket.settle();
  assert.equal(socket.events.filter((e) => e.type === 'reminder').length, 0);
  socket.close();

  clock = new Date(2026, 9, 15, 9, 5);
  socket = await listen(dad.token);
  await socket.settle();
  socket.close();
  const reminders = socket.events.filter((e) => e.type === 'reminder');
  assert.deepEqual(
    reminders.map((r) => [r.title, r.text]),
    [['오늘 일정', '아빠 생일'], ['내일 일정', '치과 (14:30)']],
  );

  socket = await listen(dad.token);
  await socket.settle();
  socket.close();
  assert.equal(socket.events.filter((e) => e.type === 'reminder').length, 0);

  assert.equal((await call('DELETE', `/api/events/${dentist.id}`, { token: dad.token })).status, 200);
  assert.equal((await call('DELETE', `/api/events/${dentist.id}`, { token: dad.token })).status, 404);
});

test('memories from this day in earlier years', async () => {
  const { mom, kid } = await setup();
  const post = (await call('POST', '/api/posts', { token: mom.token, json: { text: '작년 소풍' } })).data;
  // Pretend it was posted one year ago today
  const db = new DatabaseSync(path.join(dataDir, 'messenger.db'));
  db.prepare('UPDATE posts SET created_at = ? WHERE id = ?').run(new Date(2025, 9, 15, 12, 0).getTime(), post.id);
  db.close();
  await call('POST', '/api/posts', { token: mom.token, json: { text: '오늘 글' } });

  const memories = (await call('GET', '/api/memories', { token: kid.token })).data;
  assert.deepEqual(memories.map((p) => p.text), ['작년 소풍']);

  const socket = await listen(kid.token);
  await socket.settle();
  socket.close();
  const memory = socket.events.find((e) => e.type === 'reminder' && e.target === 'feed');
  assert.equal(memory.title, '1년 전 오늘');
});

test('shared shopping and to-do lists', async () => {
  const { mom, dad } = await setup();
  const add = (u, list, text) => call('POST', '/api/lists/items', { token: u.token, json: { list, text } });
  assert.equal((await add(mom, 'wishlist', '?')).status, 400);
  const milk = (await add(mom, 'shopping', '우유')).data;
  await add(dad, 'shopping', '계란');
  await add(dad, 'todo', '분리수거');

  const done = (await call('PATCH', `/api/lists/items/${milk.id}`, { token: dad.token, json: { done: true } })).data;
  assert.equal(done.done, true);
  assert.equal(done.doneByName, '아빠');
  const renamed = (await call('PATCH', `/api/lists/items/${milk.id}`, { token: mom.token, json: { text: '저지방 우유' } })).data;
  assert.equal(renamed.text, '저지방 우유');

  const items = (await call('GET', '/api/lists/items', { token: mom.token })).data;
  assert.deepEqual(items.filter((i) => i.list === 'shopping').map((i) => [i.text, i.done]), [['계란', false], ['저지방 우유', true]]);
  assert.equal((await call('POST', '/api/lists/shopping/clear-done', { token: mom.token })).data.removed, 1);
  assert.equal((await call('GET', '/api/lists/items', { token: mom.token })).data.length, 2);
});

test('databases from earlier versions are upgraded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-migrate-'));
  const file = path.join(dir, 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL,
      sender_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK (kind IN ('text', 'image')),
      text TEXT, image TEXT, created_at INTEGER NOT NULL);
    INSERT INTO users VALUES (1, 'mom', '엄마', 'x', 1);
    INSERT INTO messages VALUES (7, 'family', 1, 'text', '옛날 메시지', NULL, 1);
  `);
  old.close();
  openDatabase(file).close();
  const db = openDatabase(file); // running twice is harmless
  assert.deepEqual({ ...db.prepare('SELECT id, text, deleted, reply_to FROM messages').get() }, { id: 7, text: '옛날 메시지', deleted: 0, reply_to: null });
  db.prepare("INSERT INTO messages (conversation_id, sender_id, kind, text, created_at) VALUES ('family', 1, 'poll', 'q', 2)").run();
  assert.ok(db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'avatar'));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { createServer } from '../src/app.js';

let server;
let base;
let dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-'));
  server = createServer({ familyCode: 'secret', dataDir });
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

const register = (username, displayName) =>
  call('POST', '/api/register', { json: { familyCode: 'secret', username, displayName, password: 'pass1234' } });

test('full messaging flow', async () => {
  assert.equal((await call('POST', '/api/register', { json: { familyCode: 'wrong', username: 'x1x', displayName: 'X', password: 'pass1234' } })).status, 403);

  const mom = (await register('mom', '엄마')).data;
  const dad = (await register('dad', '아빠')).data;
  const kid = (await register('kid', '아이')).data;
  assert.ok(mom.token);
  assert.equal((await register('MOM', '중복')).status, 409);

  assert.equal((await call('POST', '/api/login', { json: { username: 'mom', password: 'bad' } })).status, 401);
  assert.equal((await call('POST', '/api/login', { json: { username: 'mom', password: 'pass1234' } })).status, 200);

  const convs = (await call('GET', '/api/conversations', { token: mom.token })).data;
  assert.deepEqual(convs.map((c) => c.id), ['family', `dm-${mom.user.id}-${dad.user.id}`, `dm-${mom.user.id}-${kid.user.id}`]);

  // Dad listens on websocket
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { authorization: `Bearer ${dad.token}` } });
  const received = [];
  await new Promise((resolve) => ws.on('message', (d) => { received.push(JSON.parse(d)); if (received.length === 1) resolve(); }));
  assert.equal(received[0].type, 'hello');
  const gotMessage = new Promise((resolve) => ws.on('message', (d) => resolve(JSON.parse(d))));

  const sent = await call('POST', '/api/conversations/family/messages', { token: mom.token, json: { text: '저녁 먹자' } });
  assert.equal(sent.status, 201);
  const pushed = await gotMessage;
  assert.equal(pushed.message.text, '저녁 먹자');
  assert.equal(pushed.message.senderName, '엄마');
  ws.close();

  // Direct conversation privacy
  const dm = `dm-${mom.user.id}-${dad.user.id}`;
  assert.equal((await call('POST', `/api/conversations/${dm}/messages`, { token: dad.token, json: { text: '비밀' } })).status, 201);
  assert.equal((await call('GET', `/api/conversations/${dm}/messages`, { token: kid.token })).status, 404);
  assert.equal((await call('GET', `/api/conversations/dm-${dad.user.id}-${mom.user.id}/messages`, { token: mom.token })).status, 404);
  const history = (await call('GET', `/api/conversations/${dm}/messages`, { token: mom.token })).data;
  assert.equal(history.length, 1);

  // Images
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const img = await call('POST', `/api/conversations/${dm}/images`, { token: mom.token, body: png, type: 'image/png' });
  assert.equal(img.status, 201);
  assert.match(img.data.imageUrl, /^\/api\/images\/[a-f0-9]{32}\.png$/);
  assert.equal((await call('GET', img.data.imageUrl, { token: dad.token })).status, 200);
  assert.equal((await call('GET', img.data.imageUrl, { token: kid.token })).status, 404);
  assert.equal((await call('GET', img.data.imageUrl)).status, 401);
  assert.equal((await call('POST', `/api/conversations/${dm}/images`, { token: mom.token, body: 'x', type: 'text/plain' })).status, 400);

  // Logout invalidates token
  await call('POST', '/api/logout', { token: kid.token });
  assert.equal((await call('GET', '/api/me', { token: kid.token })).status, 401);
});

test('story feed', async () => {
  const login = (u) => call('POST', '/api/login', { json: { username: u, password: 'pass1234' } }).then((r) => r.data);
  const mom = await login('mom');
  const dad = await login('dad');

  assert.equal((await call('POST', '/api/posts', { token: mom.token, json: {} })).status, 400);
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');

  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { authorization: `Bearer ${dad.token}` } });
  const events = [];
  ws.on('message', (d) => events.push(JSON.parse(d)));
  await new Promise((r) => ws.on('open', r));

  const created = await call('POST', '/api/posts', {
    token: mom.token,
    json: { text: '오늘 소풍!', image: { type: 'image/png', data: png } },
  });
  assert.equal(created.status, 201);
  const post = created.data;
  assert.equal(post.authorName, '엄마');
  assert.deepEqual(post.reactions, { heart: 0, like: 0, dislike: 0 });
  // Story photos are visible to every family member
  assert.equal((await call('GET', post.imageUrl, { token: dad.token })).status, 200);
  assert.equal((await call('POST', '/api/posts', { token: dad.token, json: { text: '글만 올리기' } })).status, 201);

  const feed = (await call('GET', '/api/posts', { token: dad.token })).data;
  assert.deepEqual(feed.map((p) => p.text), ['글만 올리기', '오늘 소풍!']);

  // Reactions: heart independent, like/dislike exclusive, second press undoes
  const react = (kind) => call('POST', `/api/posts/${post.id}/reactions`, { token: dad.token, json: { kind } }).then((r) => r.data);
  await react('heart');
  await react('like');
  let p = await react('dislike');
  assert.deepEqual(p.reactions, { heart: 1, like: 0, dislike: 1 });
  assert.deepEqual(p.myReactions.sort(), ['dislike', 'heart']);
  p = await react('heart');
  assert.equal(p.reactions.heart, 0);
  assert.equal((await call('POST', `/api/posts/${post.id}/reactions`, { token: dad.token, json: { kind: 'wow' } })).status, 400);
  // Viewer-specific state
  const momView = (await call('GET', `/api/posts/${post.id}`, { token: mom.token })).data;
  assert.deepEqual(momView.myReactions, []);

  // Comments
  const c = await call('POST', `/api/posts/${post.id}/comments`, { token: dad.token, json: { text: '멋지다' } });
  assert.equal(c.status, 201);
  const comments = (await call('GET', `/api/posts/${post.id}/comments`, { token: mom.token })).data;
  assert.equal(comments[0].authorName, '아빠');
  assert.equal((await call('GET', `/api/posts/${post.id}`, { token: mom.token })).data.commentCount, 1);
  assert.equal((await call('DELETE', `/api/comments/${c.data.id}`, { token: mom.token })).status, 403);
  assert.equal((await call('DELETE', `/api/comments/${c.data.id}`, { token: dad.token })).status, 200);

  // Only the author can delete; deleting removes the photo
  assert.equal((await call('DELETE', `/api/posts/${post.id}`, { token: dad.token })).status, 403);
  assert.equal((await call('DELETE', `/api/posts/${post.id}`, { token: mom.token })).status, 200);
  assert.equal((await call('GET', `/api/posts/${post.id}`, { token: mom.token })).status, 404);
  assert.equal((await call('GET', post.imageUrl, { token: dad.token })).status, 404);

  await new Promise((r) => setTimeout(r, 50));
  ws.close();
  const types = events.map((e) => e.type);
  assert.ok(types.includes('post'));
  assert.ok(types.includes('comment'));
  assert.ok(types.includes('feed'));
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from '../src/app.js';

let server;
let base;
let dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-songs-'));
  server = createServer({ familyCode: 'c', dataDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const reg = async (username, displayName) =>
  (await fetch(`${base}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ familyCode: 'c', username, displayName, password: 'pass1234' }),
  })).json();

async function call(token, method, url, json) {
  const headers = { authorization: `Bearer ${token}` };
  if (json) headers['content-type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: json ? JSON.stringify(json) : undefined });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
}

const upload = (token, query, body, type = 'audio/mpeg') =>
  fetch(`${base}/api/games/neon/songs?${new URLSearchParams(query)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': type },
    body,
  });

test('family members register songs with a title and difficulty, and only the uploader can change them', async () => {
  const kid = await reg('kid', '유호');
  const mom = await reg('mom', '엄마');
  const audio = Buffer.alloc(5000, 7);

  let res = await upload(kid.token, { title: '  내 노래  ', level: '4' }, audio);
  assert.equal(res.status, 201);
  const song = await res.json();
  assert.equal(song.title, '내 노래');
  assert.equal(song.level, 4);
  assert.equal(song.uploaderName, '유호');
  assert.equal(song.mine, true);

  assert.equal((await upload(kid.token, { title: '', level: '2' }, audio)).status, 400);
  assert.equal((await upload(kid.token, { title: '곡', level: '6' }, audio)).status, 400);
  assert.equal((await upload(kid.token, { title: '곡', level: '2' }, audio, 'text/html')).status, 415);

  // Everyone sees it and can download the audio.
  const list = (await call(mom.token, 'GET', '/api/games/neon/songs')).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].mine, false);
  const file = await fetch(base + list[0].url, { headers: { authorization: `Bearer ${mom.token}` } });
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-type'), /^audio\/mpeg/);
  assert.equal(Buffer.from(await file.arrayBuffer()).length, audio.length);

  // Only the uploader can edit or delete.
  assert.equal((await call(mom.token, 'PATCH', `/api/games/neon/songs/${song.id}`, { level: 1 })).status, 403);
  assert.equal((await call(mom.token, 'DELETE', `/api/games/neon/songs/${song.id}`)).status, 403);
  const edited = await call(kid.token, 'PATCH', `/api/games/neon/songs/${song.id}`, { title: '새 제목', level: 2 });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.title, '새 제목');
  assert.equal(edited.data.level, 2);

  assert.equal((await call(kid.token, 'DELETE', `/api/games/neon/songs/${song.id}`)).status, 204);
  assert.equal((await call(mom.token, 'GET', '/api/games/neon/songs')).data.length, 0);
  assert.equal(fs.readdirSync(path.join(dataDir, 'songs')).length, 0);
});

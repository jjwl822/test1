import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import webpush from 'web-push';
import WebSocket from 'ws';
import { createServer } from '../src/app.js';

let server;
let base;
let dataDir;
const pushes = [];

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-web-'));
  // Stands in for Apple's / Google's push service: builds the real encrypted request, records it.
  const pushSend = async (subscription, data, options) => {
    const request = webpush.generateRequestDetails(subscription, data, options);
    pushes.push({ url: new URL(request.endpoint).pathname, headers: request.headers, size: request.body.length });
    if (request.endpoint.includes('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 });
  };
  server = createServer({ familyCode: 'secret', dataDir, pushSend });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function call(method, url, { token, cookie, json, body, type } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  if (json) headers['content-type'] = 'application/json';
  if (type) headers['content-type'] = type;
  const res = await fetch(base + url, { method, headers, body: json ? JSON.stringify(json) : body });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, data, headers: res.headers };
}

/** A browser-like push subscription pointing at the fake push service. */
function fakeSubscription(name) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `https://push.example.com/${name}`,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') },
  };
}

const waitFor = async (check) => {
  for (let i = 0; i < 50; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
};

test('serves the web app', async () => {
  const page = await call('GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.data, /<html/);
  assert.equal(page.headers.get('cache-control'), 'private, no-cache');
  assert.equal((await call('GET', '/sw.js')).status, 200);
  assert.equal((await call('GET', '/vendor/preact-htm.js')).status, 200);
});

test('web login cookie works for API, media and live updates', async () => {
  const reg = await call('POST', '/api/register', {
    json: { familyCode: 'secret', username: 'mom', displayName: '엄마', password: 'pass1234' },
  });
  const setCookie = reg.headers.get('set-cookie');
  assert.match(setCookie, /fm_token=[a-f0-9]+; Path=\/; HttpOnly; SameSite=Lax/);
  assert.doesNotMatch(setCookie, /Secure/); // plain http here
  const cookie = setCookie.split(';')[0];
  assert.equal((await call('GET', '/api/me', { cookie })).data.displayName, '엄마');

  // Behind an https tunnel the cookie is marked Secure.
  const login = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
    body: JSON.stringify({ username: 'mom', password: 'pass1234' }),
  });
  assert.match(login.headers.get('set-cookie'), /; Secure/);

  // iPhone .mov videos are accepted and served with the cookie
  const mov = await call('POST', '/api/media', { cookie, body: Buffer.from('0000001466747970717420', 'hex'), type: 'video/quicktime' });
  assert.match(mov.data.name, /\.mov$/);
  assert.equal((await call('GET', `/api/media/${mov.data.name}`, { cookie })).status, 200);

  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { cookie } });
  const hello = await new Promise((r) => ws.on('message', (d) => r(JSON.parse(d))));
  assert.equal(hello.user.displayName, '엄마');
  ws.close();

  const out = await call('POST', '/api/logout', { cookie, json: {} });
  assert.match(out.headers.get('set-cookie'), /fm_token=; .*Max-Age=0/);
  assert.equal((await call('GET', '/api/me', { cookie })).status, 401);
});

test('web push goes to people who are not looking at the app', async () => {
  const dad = (await call('POST', '/api/register', {
    json: { familyCode: 'secret', username: 'dad', displayName: '아빠', password: 'pass1234' },
  })).data;
  const mom = (await call('POST', '/api/login', { json: { username: 'mom', password: 'pass1234' } })).data;

  assert.ok((await call('GET', '/api/push/key', { token: dad.token })).data.publicKey.length > 40);
  assert.equal((await call('POST', '/api/push/subscribe', { token: dad.token, json: { endpoint: 'nope' } })).status, 400);
  assert.equal((await call('POST', '/api/push/subscribe', { token: dad.token, json: fakeSubscription('dad-phone') })).status, 200);

  // Dad's web app is closed: a message reaches his phone as an encrypted push.
  pushes.length = 0;
  await call('POST', '/api/conversations/family/messages', { token: mom.token, json: { text: '저녁 먹자' } });
  await waitFor(() => pushes.length > 0);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].url, '/dad-phone');
  assert.equal(pushes[0].headers['Content-Encoding'], 'aes128gcm');
  assert.match(pushes[0].headers.Authorization, /^vapid t=/);
  assert.ok(pushes[0].size > 0);

  // Mom (the sender) never gets her own message; a new story reaches dad too.
  await call('POST', '/api/posts', { token: mom.token, json: { text: '소풍' } });
  await waitFor(() => pushes.length > 1);
  assert.equal(pushes.length, 2);

  // With the web app open on screen, no push is sent.
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { authorization: `Bearer ${dad.token}` } });
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'visibility', visible: true }));
  await new Promise((r) => setTimeout(r, 50));
  pushes.length = 0;
  await call('POST', '/api/conversations/family/messages', { token: mom.token, json: { text: '보고 있지?' } });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(pushes.length, 0);
  ws.close();

  // A subscription the push service says is gone (410) is forgotten.
  await call('POST', '/api/push/subscribe', { token: dad.token, json: fakeSubscription('gone-phone') });
  await new Promise((r) => setTimeout(r, 50));
  pushes.length = 0;
  await call('POST', '/api/conversations/family/messages', { token: mom.token, json: { text: '하나 더' } });
  await waitFor(() => pushes.length >= 2);
  pushes.length = 0;
  await call('POST', '/api/conversations/family/messages', { token: mom.token, json: { text: '마지막' } });
  await waitFor(() => pushes.length >= 1);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(pushes.map((p) => p.url), ['/dad-phone']);
});

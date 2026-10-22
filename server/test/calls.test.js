import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { createServer } from '../src/app.js';

let server;
let base;
let dataDir;
const pushes = [];
let turnCalls = 0;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-calls-'));
  server = createServer({
    familyCode: 'c',
    dataDir,
    ringSeconds: 0.3,
    callDropSeconds: 0.3,
    pushSend: async (_sub, data) => pushes.push(JSON.parse(data)),
    turn: { keyId: 'key123', token: 'secret' },
    // Stands in for Cloudflare's TURN API.
    fetchImpl: async (url, init) => {
      turnCalls++;
      assert.equal(url, 'https://rtc.live.cloudflare.com/v1/turn/keys/key123/credentials/generate-ice-servers');
      assert.equal(init.headers.authorization, 'Bearer secret');
      assert.deepEqual(JSON.parse(init.body), { ttl: 86400 });
      return {
        ok: true,
        json: async () => ({
          iceServers: [
            { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
            { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp'], username: 'u', credential: 'p' },
          ],
        }),
      };
    },
  });
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
const get = async (token, url) => (await fetch(base + url, { headers: { authorization: `Bearer ${token}` } })).json();

/** Keys like a browser's push subscription has. */
function browserKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
}

/** A phone/tab: a socket that collects call events. */
async function device(token) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { authorization: `Bearer ${token}` } });
  const events = [];
  const waiters = [];
  ws.on('message', (d) => {
    const e = JSON.parse(d);
    if (e.type !== 'call') return;
    events.push(e);
    waiters.splice(0).forEach((w) => w());
  });
  await new Promise((r) => ws.on('open', r));
  return {
    events,
    send: (msg) => ws.send(JSON.stringify({ type: 'call', ...msg })),
    async next(action) {
      for (let i = 0; i < 100; i++) {
        const found = events.find((e) => e.action === action && !e.seen);
        if (found) {
          found.seen = true;
          return found;
        }
        await new Promise((r) => {
          waiters.push(r);
          setTimeout(r, 30);
        });
      }
      throw new Error(`no ${action} (got ${events.map((e) => e.action)})`);
    },
    close: () => ws.close(),
  };
}

const lastMessage = async (token, a, b) => {
  const [x, y] = [a, b].sort((p, q) => p - q);
  const list = await get(token, `/api/conversations/dm-${x}-${y}/messages`);
  return list[list.length - 1]?.text;
};

test('a video call from ringing to hang-up', async () => {
  const mom = await reg('mom', '엄마');
  const dad = await reg('dad', '아빠');
  const kid = await reg('kid', '아이');
  await fetch(`${base}/api/push/subscribe`, {
    method: 'POST',
    headers: { authorization: `Bearer ${dad.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: 'https://push.example.com/dad', keys: browserKeys() }),
  });
  const momPhone = await device(mom.token);
  const dadPhone = await device(dad.token);
  const dadTablet = await device(dad.token);

  momPhone.send({ action: 'invite', callId: 'c1', to: dad.user.id, video: true, sdp: 'offer-sdp' });
  const ring1 = await dadPhone.next('invite');
  await dadTablet.next('invite'); // every device of dad's rings
  assert.equal(ring1.from.displayName, '엄마');
  assert.equal(ring1.sdp, 'offer-sdp');
  assert.equal(ring1.video, true);
  momPhone.send({ action: 'ice', callId: 'c1', candidate: { candidate: 'cand-1' } });
  assert.deepEqual((await dadPhone.next('ice')).candidate, { candidate: 'cand-1' });

  // A phone opened from the notification can still pick it up, with the offer and candidates so far.
  const pending = await get(dad.token, '/api/calls/pending');
  assert.equal(pending.callId, 'c1');
  assert.equal(pending.sdp, 'offer-sdp');
  assert.deepEqual(pending.candidates, [{ candidate: 'cand-1' }]);
  assert.equal(await get(mom.token, '/api/calls/pending'), null);

  // Dad's closed web app (iPhone) gets an incoming-call notification that opens the call.
  const callPush = pushes.find((p) => p.tag === 'call-c1');
  assert.equal(callPush.title, '엄마님의 영상통화');
  assert.equal(callPush.url, '/#/call/c1');

  // Someone else calling either of them is told they're busy.
  const kidPhone = await device(kid.token);
  kidPhone.send({ action: 'invite', callId: 'c2', to: mom.user.id, video: false, sdp: 'x' });
  await kidPhone.next('busy');

  dadPhone.send({ action: 'accept', callId: 'c1', sdp: 'answer-sdp', deviceId: 'phone' });
  assert.equal((await momPhone.next('accept')).sdp, 'answer-sdp');
  assert.equal((await dadTablet.next('answered-elsewhere')).except, 'phone'); // tablet stops ringing
  dadPhone.send({ action: 'ice', callId: 'c1', candidate: { candidate: 'cand-2' } });
  await momPhone.next('ice');

  momPhone.send({ action: 'end', callId: 'c1' });
  await dadPhone.next('end');
  assert.match(await lastMessage(mom.token, mom.user.id, dad.user.id), /^📞 영상통화 \d+초$/);
  // A finished call is recorded in the chat but doesn't send a notification.
  assert.ok(!pushes.some((p) => p.body?.startsWith('📞 영상통화')));
  assert.equal(await get(dad.token, '/api/calls/pending'), null);
  [momPhone, dadPhone, dadTablet, kidPhone].forEach((d) => d.close());
});

test('declined, cancelled and unanswered calls', async () => {
  const mom = (await (await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'mom', password: 'pass1234' }) })).json());
  const kid = (await (await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'kid', password: 'pass1234' }) })).json());
  const momPhone = await device(mom.token);
  const kidPhone = await device(kid.token);

  momPhone.send({ action: 'invite', callId: 'd1', to: kid.user.id, video: false, sdp: 'o' });
  await kidPhone.next('invite');
  kidPhone.send({ action: 'decline', callId: 'd1' });
  await momPhone.next('decline');
  assert.equal(await lastMessage(mom.token, mom.user.id, kid.user.id), '📞 음성통화 · 거절됨');

  momPhone.send({ action: 'invite', callId: 'd2', to: kid.user.id, video: true, sdp: 'o' });
  await kidPhone.next('invite');
  momPhone.send({ action: 'cancel', callId: 'd2' });
  await kidPhone.next('cancel');
  assert.equal(await lastMessage(mom.token, mom.user.id, kid.user.id), '📞 부재중 영상통화');

  // Nobody answers: both sides hear "missed" after the ring time.
  momPhone.send({ action: 'invite', callId: 'd3', to: kid.user.id, video: false, sdp: 'o' });
  await kidPhone.next('invite');
  await momPhone.next('missed');
  await kidPhone.next('missed');

  // Only the callee can accept, and nobody can call themselves.
  momPhone.send({ action: 'invite', callId: 'd4', to: mom.user.id, video: false, sdp: 'o' });
  await momPhone.next('error');

  // The caller dropping off cancels a ringing call.
  momPhone.send({ action: 'invite', callId: 'd5', to: kid.user.id, video: false, sdp: 'o' });
  await kidPhone.next('invite');
  momPhone.close();
  await kidPhone.next('cancel');
  kidPhone.close();
});

const login = async (username) =>
  (await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'pass1234' }) })).json();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('during a call: reconnecting after a network change, and mute / camera state', async () => {
  const mom = await login('mom');
  const dad = await login('dad');
  const momPhone = await device(mom.token);
  let dadPhone = await device(dad.token);
  momPhone.send({ action: 'invite', callId: 'r1', to: dad.user.id, video: true, sdp: 'o' });
  await dadPhone.next('invite');

  // Not before the call is answered.
  momPhone.send({ action: 'renegotiate', callId: 'r1', kind: 'offer', sdp: 'too-early' });
  dadPhone.send({ action: 'accept', callId: 'r1', sdp: 'a' });
  await momPhone.next('accept');

  momPhone.send({ action: 'renegotiate', callId: 'r1', kind: 'offer', sdp: 'restart-offer' });
  const offer = await dadPhone.next('renegotiate');
  assert.deepEqual([offer.kind, offer.sdp], ['offer', 'restart-offer']);
  dadPhone.send({ action: 'renegotiate', callId: 'r1', kind: 'answer', sdp: 'restart-answer' });
  assert.equal((await momPhone.next('renegotiate')).sdp, 'restart-answer');
  assert.ok(!momPhone.events.some((e) => e.sdp === 'too-early') && !dadPhone.events.some((e) => e.sdp === 'too-early'));

  dadPhone.send({ action: 'media', callId: 'r1', muted: true, cameraOff: false });
  const media = await momPhone.next('media');
  assert.deepEqual([media.muted, media.cameraOff], [true, false]);

  // Dad's phone drops off the server and comes back in time: the call goes on.
  dadPhone.close();
  await wait(50);
  dadPhone = await device(dad.token);
  await wait(400);
  assert.ok(!momPhone.events.some((e) => e.action === 'end'));

  // This time it doesn't come back (app killed): the call ends instead of staying "busy".
  dadPhone.close();
  await momPhone.next('end');
  assert.match(await lastMessage(mom.token, mom.user.id, dad.user.id), /^📞 영상통화 \d+초$/);
  const kid = await login('kid');
  const kidPhone = await device(kid.token);
  kidPhone.send({ action: 'invite', callId: 'r2', to: mom.user.id, video: false, sdp: 'o' });
  await momPhone.next('invite');
  kidPhone.send({ action: 'cancel', callId: 'r2' });
  [momPhone, kidPhone].forEach((d) => d.close());
});

test('relay (TURN) credentials come from Cloudflare, cached, without port 53', async () => {
  const mom = (await (await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'mom', password: 'pass1234' }) })).json());
  const first = await get(mom.token, '/api/calls/ice');
  assert.equal(first.relay, true);
  const urls = first.iceServers.flatMap((s) => s.urls);
  assert.ok(urls.includes('turn:turn.cloudflare.com:3478?transport=udp'));
  assert.ok(!urls.some((u) => u.includes(':53')));
  assert.equal(first.iceServers[1].username, 'u');
  await get(mom.token, '/api/calls/ice');
  assert.equal(turnCalls, 1);
  assert.equal((await fetch(`${base}/api/calls/ice`)).status, 401);
});

test('without a relay set up, calls use STUN only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-calls2-'));
  const plain = createServer({ familyCode: 'c', dataDir: dir });
  await new Promise((r) => plain.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${plain.address().port}`;
  const u = await (await fetch(`${url}/api/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ familyCode: 'c', username: 'mom', displayName: '엄마', password: 'pass1234' }) })).json();
  const ice = await (await fetch(`${url}/api/calls/ice`, { headers: { authorization: `Bearer ${u.token}` } })).json();
  assert.equal(ice.relay, false);
  assert.ok(ice.iceServers[0].urls.some((x) => x.startsWith('stun:')));
  await new Promise((r) => plain.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

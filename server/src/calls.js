import { directId } from './chat.js';

const DEFAULT_STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];

/**
 * 1:1 voice/video calls. Phones talk to each other directly with WebRTC; the server only relays the
 * call signals ("invite", "accept", network candidates, "end") over the live connection, keeps a
 * ringing call so a phone woken by a notification can still pick it up, hands out relay (TURN)
 * credentials, and leaves a "📞 ..." line in the chat when a call finishes.
 *
 * Client → server messages: { type: 'call', action, callId, ... }
 *   invite { to, video, sdp }   accept { sdp }   ringing   decline   cancel   end   ice { candidate }
 *   renegotiate { sdp, kind: 'offer' | 'answer' }  (reconnecting after the network changed)
 *   media { muted, cameraOff }  (so the other side can show it)
 * Server → client: the same shape, plus `from` on invite, and busy / missed / answered-elsewhere.
 *
 * renegotiate and media only go to a side that said it understands them (`v: 2` on invite /
 * accept): older Android apps end the call on a signal they don't know.
 */
export function createCalls({
  db,
  auth,
  app,
  sendTo,
  isOnline,
  notify,
  logMessage,
  turn,
  fetchImpl = fetch,
  now = Date.now,
  ringSeconds = 45,
  // How long someone in a call may be off the server (a phone switching networks reconnects well
  // within this) before the call is ended, so it doesn't stay "busy" after an app was killed.
  dropSeconds = 90,
}) {
  /** callId -> { id, from, to, video, sdp, callerCandidates, state, startedAt, answeredAt, timer } */
  const calls = new Map();
  const userRow = db.prepare('SELECT id, display_name AS name FROM users WHERE id = ?');

  const inCall = (userId) => [...calls.values()].find((c) => c.from === userId || c.to === userId);
  const other = (call, userId) => (call.from === userId ? call.to : call.from);
  const send = (userId, call, action, extra = {}) =>
    sendTo(userId, { type: 'call', action, callId: call.id, video: call.video, ...extra });

  const kindLabel = (call) => (call.video ? '영상통화' : '음성통화');

  function duration(ms) {
    const s = Math.max(1, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}분 ${s % 60}초` : `${s}초`;
  }

  /** Ends a call and writes what happened into the 1:1 chat. */
  function finish(call, outcome) {
    clearTimeout(call.timer);
    clearTimeout(call.dropTimer);
    calls.delete(call.id);
    const text =
      outcome === 'ended'
        ? `📞 ${kindLabel(call)} ${duration(now() - call.answeredAt)}`
        : outcome === 'declined'
          ? `📞 ${kindLabel(call)} · 거절됨`
          : `📞 부재중 ${kindLabel(call)}`;
    logMessage(directId(call.from, call.to), call.from, text, [call.from, call.to], { silent: outcome === 'ended' });
  }

  function handle(user, msg) {
    const me = user.id;
    const call = msg.callId ? calls.get(String(msg.callId)) : null;
    switch (msg.action) {
      case 'invite': {
        const to = Number(msg.to);
        const callId = typeof msg.callId === 'string' ? msg.callId.slice(0, 64) : '';
        if (!callId || calls.has(callId) || to === me || !userRow.get(to) || typeof msg.sdp !== 'string') {
          return sendTo(me, { type: 'call', action: 'error', callId, message: '전화를 걸 수 없습니다.' });
        }
        const fresh = { id: callId, from: me, to, video: Boolean(msg.video) };
        if (inCall(me) || inCall(to)) return send(me, fresh, 'busy');
        Object.assign(fresh, { sdp: msg.sdp, callerCandidates: [], state: 'ringing', startedAt: now(), v2: new Set() });
        if (msg.v === 2) fresh.v2.add(me);
        calls.set(callId, fresh);
        fresh.timer = setTimeout(() => {
          if (calls.get(callId)?.state !== 'ringing') return;
          send(fresh.from, fresh, 'missed');
          send(fresh.to, fresh, 'missed');
          finish(fresh, 'missed');
        }, ringSeconds * 1000);
        fresh.timer.unref?.();
        const caller = { id: me, displayName: user.displayName };
        send(to, fresh, 'invite', { from: caller, sdp: msg.sdp });
        // Wakes a closed web app (iPhone). The Android app is always connected and rings by itself.
        notify([to], {
          title: `${user.displayName}님의 ${kindLabel(fresh)}`,
          body: '눌러서 받기',
          url: `/#/call/${encodeURIComponent(callId)}`,
          tag: `call-${callId}`,
        });
        if (!isOnline(to)) send(me, fresh, 'offline');
        return;
      }
      case 'ringing':
        if (call?.to === me) send(call.from, call, 'ringing');
        return;
      case 'accept':
        if (!call || call.to !== me || call.state !== 'ringing' || typeof msg.sdp !== 'string') return;
        call.state = 'active';
        call.answeredAt = now();
        if (msg.v === 2) call.v2.add(me);
        clearTimeout(call.timer);
        send(call.from, call, 'accept', { sdp: msg.sdp });
        // Stop the ringing on the callee's other phones / tabs.
        send(call.to, call, 'answered-elsewhere', { except: msg.deviceId ?? null });
        return;
      case 'decline':
        if (!call || call.to !== me || call.state !== 'ringing') return;
        send(call.from, call, 'decline');
        send(call.to, call, 'answered-elsewhere');
        finish(call, 'declined');
        return;
      case 'cancel':
        if (!call || call.from !== me || call.state !== 'ringing') return;
        send(call.to, call, 'cancel');
        finish(call, 'missed');
        return;
      case 'end':
        if (!call || (call.from !== me && call.to !== me)) return;
        send(other(call, me), call, 'end');
        finish(call, call.state === 'active' ? 'ended' : 'missed');
        return;
      case 'ice':
        if (!call || (call.from !== me && call.to !== me) || !msg.candidate) return;
        // Kept so a phone that picks up later (from a notification) still gets them.
        if (call.from === me && call.state === 'ringing') call.callerCandidates.push(msg.candidate);
        send(other(call, me), call, 'ice', { candidate: msg.candidate });
        return;
      case 'renegotiate':
        if (!call || call.state !== 'active' || (call.from !== me && call.to !== me)) return;
        if (typeof msg.sdp !== 'string' || (msg.kind !== 'offer' && msg.kind !== 'answer')) return;
        if (call.v2.has(other(call, me))) send(other(call, me), call, 'renegotiate', { sdp: msg.sdp, kind: msg.kind });
        return;
      case 'media':
        if (!call || (call.from !== me && call.to !== me)) return;
        if (call.v2.has(other(call, me))) {
          send(other(call, me), call, 'media', { muted: Boolean(msg.muted), cameraOff: Boolean(msg.cameraOff) });
        }
        return;
      default:
    }
  }

  /**
   * Someone lost their last connection: a call they were ringing out on is cancelled, and a call
   * they're in is ended if they don't come back within [dropSeconds].
   */
  function onDisconnect(userId) {
    for (const call of [...calls.values()]) {
      if (call.state === 'ringing' && call.from === userId) {
        send(call.to, call, 'cancel');
        finish(call, 'missed');
      } else if (call.state === 'active' && (call.from === userId || call.to === userId)) {
        clearTimeout(call.dropTimer);
        call.dropTimer = setTimeout(() => {
          if (calls.get(call.id) !== call || isOnline(userId)) return;
          send(other(call, userId), call, 'end');
          finish(call, 'ended');
        }, dropSeconds * 1000);
        call.dropTimer.unref?.();
      }
    }
  }

  // A call this phone can still answer (opened from a "전화 왔어요" notification).
  app.get('/api/calls/pending', auth, (req, res) => {
    const call = [...calls.values()].find((c) => c.to === req.user.id && c.state === 'ringing');
    if (!call) return res.json(null);
    const caller = userRow.get(call.from);
    res.json({
      callId: call.id,
      from: { id: caller.id, displayName: caller.name },
      video: call.video,
      sdp: call.sdp,
      candidates: call.callerCandidates,
    });
  });

  // Network routes for the call: STUN always, plus Cloudflare's relay (TURN) when it's set up.
  let cached = null;
  app.get('/api/calls/ice', auth, async (_req, res) => {
    if (!turn?.keyId || !turn?.token) return res.json({ iceServers: DEFAULT_STUN, relay: false });
    if (cached && cached.expires > now()) return res.json({ iceServers: cached.iceServers, relay: true });
    try {
      const response = await fetchImpl(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(turn.keyId)}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${turn.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ ttl: 86400 }),
        },
      );
      if (!response.ok) throw new Error(`Cloudflare TURN ${response.status}`);
      const data = await response.json();
      // Browsers can't use port 53 and would wait on it until it times out.
      const iceServers = (data.iceServers ?? []).map((s) => ({
        ...s,
        urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)),
      }));
      cached = { iceServers, expires: now() + 12 * 60 * 60 * 1000 };
      res.json({ iceServers, relay: true });
    } catch (err) {
      console.warn('통화 중계(TURN) 키를 받지 못했습니다:', err.message);
      res.json({ iceServers: DEFAULT_STUN, relay: false });
    }
  });

  const sweep = setInterval(() => {
    for (const call of [...calls.values()]) {
      if (now() - call.startedAt > 6 * 60 * 60 * 1000) calls.delete(call.id);
    }
  }, 10 * 60 * 1000);
  sweep.unref();

  return {
    handle,
    onDisconnect,
    stop: () => {
      clearInterval(sweep);
      for (const call of calls.values()) {
        clearTimeout(call.timer);
        clearTimeout(call.dropTimer);
      }
    },
  };
}

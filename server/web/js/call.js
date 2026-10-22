// 1:1 voice/video calls with WebRTC. The server only relays the call signals; audio and video
// go phone to phone (or through Cloudflare's relay when a direct connection isn't possible).
import { useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { api, onLive, sendLive, store } from './api.js';
import { Avatar, avatarUrlOf, colorOf, html, Icon } from './ui.js';

const deviceId = Math.random().toString(36).slice(2);
const events = new EventTarget();

/** Everything the call screen shows. status: idle | outgoing | incoming | connecting | active | ended */
let state = { status: 'idle' };
let pc = null;
let localStream = null;
let pendingCandidates = [];
let ringTone = null;
let endTimer = null;
/** While the connection is lost: retrying it, and giving up after a while. */
let retryTimer = null;
let giveUpTimer = null;
const GIVE_UP_MS = 30_000;

function set(patch) {
  state = { ...state, ...patch };
  events.dispatchEvent(new Event('change'));
}

export function useCall() {
  const [, force] = useState(0);
  useEffect(() => {
    const on = () => force((n) => n + 1);
    events.addEventListener('change', on);
    return () => events.removeEventListener('change', on);
  }, []);
  return state;
}

const signal = (action, extra = {}) => sendLive({ type: 'call', action, callId: state.callId, ...extra });

// ---- Sounds -------------------------------------------------------------------------------------

/** Ring (incoming) or ringback (outgoing) beeps, made with WebAudio so no sound files are needed. */
function startTone(kind) {
  stopTone();
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const beep = () => {
      const pattern = kind === 'incoming' ? [0, 0.35, 0.7] : [0];
      for (const at of pattern) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = kind === 'incoming' ? 880 : 440;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
        gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + at);
        osc.stop(ctx.currentTime + at + 0.32);
      }
      if (kind === 'incoming') navigator.vibrate?.([400, 200, 400]);
    };
    beep();
    const timer = setInterval(beep, kind === 'incoming' ? 2000 : 3000);
    ringTone = { ctx, timer };
  } catch {
    // no audio available
  }
}

function stopTone() {
  if (!ringTone) return;
  clearInterval(ringTone.timer);
  ringTone.ctx.close().catch(() => {});
  ringTone = null;
  navigator.vibrate?.(0);
}

// ---- WebRTC -------------------------------------------------------------------------------------

async function media(video) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: video ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
  } catch {
    throw new Error(video ? '카메라와 마이크를 쓸 수 있게 허용해 주세요.' : '마이크를 쓸 수 있게 허용해 주세요.');
  }
}

async function makePeer() {
  const { iceServers } = await api.callIce().catch(() => ({ iceServers: [] }));
  const peer = new RTCPeerConnection({ iceServers });
  peer.onicecandidate = (e) => e.candidate && signal('ice', { candidate: e.candidate.toJSON() });
  peer.ontrack = (e) => set({ remoteStream: e.streams[0] });
  peer.onconnectionstatechange = () => {
    if (peer !== pc) return;
    const s = peer.connectionState;
    if (s === 'connected') {
      stopRetrying();
      if (state.status !== 'active') {
        set({ status: 'active', startedAt: Date.now() });
        sendMedia();
        startStats();
      } else if (state.reconnecting) set({ reconnecting: false });
    }
    if ((s === 'disconnected' || s === 'failed') && state.status === 'active') lostConnection(s === 'failed');
  };
  localStream.getTracks().forEach((t) => peer.addTrack(t, localStream));
  return peer;
}

// ---- Keeping the call up when the network changes (Wi-Fi ↔ LTE) ------------------------------

/**
 * The connection dropped. "disconnected" often comes back by itself within a few seconds; if not
 * (or once it's "failed"), the caller restarts the connection over new network routes (ICE restart)
 * and keeps trying until it works or [GIVE_UP_MS] passes. Only the caller restarts, so both sides
 * never send offers at once.
 */
function lostConnection(failed) {
  if (!state.reconnecting) set({ reconnecting: true });
  if (!giveUpTimer) giveUpTimer = setTimeout(() => hangUp('연결이 끊겼어요.'), GIVE_UP_MS);
  if (!state.isCaller || retryTimer) return;
  const attempt = () => {
    retryTimer = setTimeout(attempt, 4000);
    restartIce();
  };
  retryTimer = setTimeout(attempt, failed ? 0 : 2000);
}

function stopRetrying() {
  clearTimeout(retryTimer);
  clearTimeout(giveUpTimer);
  retryTimer = null;
  giveUpTimer = null;
}

async function restartIce() {
  if (!pc || pc.signalingState !== 'stable') return;
  try {
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    signal('renegotiate', { kind: 'offer', sdp: offer.sdp });
  } catch {
    // tried again on the next attempt
  }
}

async function onRenegotiate(msg) {
  if (!pc) return;
  try {
    if (msg.kind === 'offer') {
      await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      signal('renegotiate', { kind: 'answer', sdp: answer.sdp });
    } else if (pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
    }
  } catch {
    // the next restart attempt starts over
  }
}

// The phone got a network back (e.g. walked out of Wi-Fi range onto LTE): try right away.
window.addEventListener('online', () => {
  if (state.status === 'active' && state.isCaller && pc?.connectionState !== 'connected') restartIce();
});

// ---- Connection quality ------------------------------------------------------------------------

let statsTimer = null;
let lastReceived = 0;
let lastLost = 0;

/** Every 2 seconds: how long a round trip takes and how much of the sound gets lost. */
function startStats() {
  stopStats();
  lastReceived = 0;
  lastLost = 0;
  statsTimer = setInterval(measure, 2000);
}

function stopStats() {
  clearInterval(statsTimer);
  statsTimer = null;
}

async function measure() {
  if (!pc) return;
  let rtt = null;
  let received = 0;
  let lost = 0;
  (await pc.getStats()).forEach((s) => {
    if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded' && s.currentRoundTripTime != null) rtt = s.currentRoundTripTime;
    if (s.type === 'inbound-rtp' && s.kind === 'audio') {
      received += s.packetsReceived ?? 0;
      lost += s.packetsLost ?? 0;
    }
  });
  const newReceived = received - lastReceived;
  const newLost = Math.max(0, lost - lastLost);
  lastReceived = received;
  lastLost = lost;
  const loss = newReceived + newLost > 0 ? newLost / (newReceived + newLost) : 1;
  const r = rtt ?? 1;
  const quality = state.reconnecting ? 1 : r < 0.3 && loss < 0.03 ? 3 : r < 0.7 && loss < 0.1 ? 2 : 1;
  if (quality !== state.quality) set({ quality });
}

/** Tells the other side whether my microphone / camera is off, so their screen can show it. */
const sendMedia = () => signal('media', { muted: Boolean(state.muted), cameraOff: Boolean(state.cameraOff) });

async function addCandidate(candidate) {
  if (pc?.remoteDescription) await pc.addIceCandidate(candidate).catch(() => {});
  else pendingCandidates.push(candidate);
}

async function flushCandidates() {
  const list = pendingCandidates;
  pendingCandidates = [];
  for (const c of list) await pc.addIceCandidate(c).catch(() => {});
}

function cleanup() {
  stopTone();
  stopRetrying();
  stopStats();
  pc?.close();
  pc = null;
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  pendingCandidates = [];
}

/** Shows a short "통화 종료" message, then closes the call screen. */
function finish(message) {
  cleanup();
  set({ status: 'ended', message, localStream: null });
  clearTimeout(endTimer);
  endTimer = setTimeout(() => set({ status: 'idle', remoteStream: null, message: null }), 1800);
}

// ---- Actions ------------------------------------------------------------------------------------

/** What a new call starts with. */
const fresh = () => ({
  muted: false,
  cameraOff: false,
  peerMuted: false,
  peerCameraOff: false,
  reconnecting: false,
  quality: 0,
  remoteStream: null,
  message: null,
  startedAt: null,
});

/** Calls [peer] ({ id, displayName }). */
export async function startCall(peer, video) {
  if (state.status !== 'idle' && state.status !== 'ended') return;
  clearTimeout(endTimer);
  const callId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  set({ ...fresh(), status: 'outgoing', callId, peer, video, isCaller: true });
  try {
    localStream = await media(video);
    set({ localStream });
    pc = await makePeer();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (!signal('invite', { to: peer.id, video, sdp: offer.sdp, v: 2 })) throw new Error('서버에 연결되어 있지 않아요.');
    startTone('outgoing');
  } catch (e) {
    finish(e.message);
  }
}

export async function acceptCall() {
  if (state.status !== 'incoming') return;
  stopTone();
  set({ status: 'connecting' });
  try {
    localStream = await media(state.video);
    set({ localStream });
    pc = await makePeer();
    await pc.setRemoteDescription({ type: 'offer', sdp: state.offerSdp });
    await flushCandidates();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    signal('accept', { sdp: answer.sdp, deviceId, v: 2 });
  } catch (e) {
    signal('decline');
    finish(e.message);
  }
}

export function declineCall() {
  if (state.status !== 'incoming') return;
  signal('decline');
  finish('거절했어요.');
}

export function hangUp(message = '통화가 끝났어요.') {
  if (state.status === 'outgoing') signal('cancel');
  else if (state.status === 'incoming') signal('decline');
  else if (state.status === 'connecting' || state.status === 'active') signal('end');
  finish(message);
}

export function toggleMute() {
  const muted = !state.muted;
  localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  set({ muted });
  sendMedia();
}

export function toggleCamera() {
  const cameraOff = !state.cameraOff;
  localStream?.getVideoTracks().forEach((t) => (t.enabled = !cameraOff));
  set({ cameraOff });
  sendMedia();
}

/** Front ↔ back camera. */
export async function switchCamera() {
  const current = localStream?.getVideoTracks()[0];
  if (!current || !pc) return;
  const facing = current.getSettings().facingMode === 'environment' ? 'user' : 'environment';
  try {
    const fresh = (await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } })).getVideoTracks()[0];
    const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
    await sender?.replaceTrack(fresh);
    localStream.removeTrack(current);
    current.stop();
    localStream.addTrack(fresh);
    set({ localStream });
  } catch {
    // only one camera
  }
}

function ring(callId, from, video, sdp, candidates = []) {
  clearTimeout(endTimer);
  pendingCandidates = [...candidates];
  set({ ...fresh(), status: 'incoming', callId, peer: from, video, offerSdp: sdp, isCaller: false });
  signal('ringing');
  startTone('incoming');
}

/** Opened from a "전화 왔어요" notification: pick up the call that's still ringing. */
export async function resumePendingCall(callId) {
  if (state.status !== 'idle' && state.status !== 'ended') return;
  const pending = await api.pendingCall().catch(() => null);
  if (!pending || (callId && pending.callId !== callId)) return false;
  ring(pending.callId, pending.from, pending.video, pending.sdp, pending.candidates);
  return true;
}

// ---- Signals from the server -------------------------------------------------------------------

onLive('call', async (msg) => {
  const mine = msg.callId === state.callId;
  switch (msg.action) {
    case 'invite':
      if (state.status === 'idle' || state.status === 'ended') ring(msg.callId, msg.from, msg.video, msg.sdp);
      return;
    case 'ringing':
      if (mine && state.status === 'outgoing') set({ message: '상대방 전화가 울리고 있어요' });
      return;
    case 'accept':
      if (!mine || !pc) return;
      stopTone();
      set({ status: 'connecting', message: null });
      await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
      await flushCandidates();
      return;
    case 'ice':
      if (mine) await addCandidate(msg.candidate);
      return;
    case 'answered-elsewhere':
      if (mine && state.status === 'incoming' && msg.except !== deviceId) finish('다른 기기에서 받았어요.');
      return;
    case 'offline':
      if (mine) set({ message: '상대방이 지금 연결되어 있지 않아요. 알림을 보냈어요.' });
      return;
    case 'renegotiate':
      if (mine && state.status === 'active') await onRenegotiate(msg);
      return;
    case 'media':
      if (mine) set({ peerMuted: Boolean(msg.muted), peerCameraOff: Boolean(msg.cameraOff) });
      return;
    default:
      if (!mine || state.status === 'idle' || state.status === 'ended') return;
      finish(
        {
          decline: '상대방이 전화를 받지 않았어요.',
          cancel: '상대방이 전화를 끊었어요.',
          missed: '전화를 받지 않았어요.',
          end: '통화가 끝났어요.',
          busy: '상대방이 다른 통화 중이에요.',
          error: msg.message || '전화를 걸 수 없어요.',
        }[msg.action] ?? '통화가 끝났어요.',
      );
  }
});

// ---- Screen -------------------------------------------------------------------------------------

function Video({ stream, muted, mirror, cls, remote, drag, ...handlers }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream ?? null;
  }, [stream]);
  const transform = [drag && `translate(${drag.dx}px, ${drag.dy}px)`, mirror && 'scaleX(-1)'].filter(Boolean).join(' ');
  return html`<video ref=${ref} class=${cls} autoplay playsinline muted=${muted} data-remote=${remote ? '1' : undefined}
    style=${transform ? `transform:${transform}` : ''} ...${handlers}></video>`;
}

const pipSupported = () =>
  typeof document !== 'undefined' && (document.pictureInPictureEnabled || 'webkitSetPresentationMode' in HTMLVideoElement.prototype);

/** The other person's picture in a small floating window, over other apps / tabs. */
async function togglePip() {
  const v = document.querySelector('.call video[data-remote]');
  if (!v) return;
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else if (v.requestPictureInPicture) await v.requestPictureInPicture();
    else v.webkitSetPresentationMode?.(v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
  } catch {
    // not allowed right now
  }
}

/** Signal bars for the connection: 3 good, 2 fair, 1 weak (0: not measured yet). */
function QualityBars({ quality }) {
  return html`<span class=${`bars ${quality === 1 ? 'weak' : ''}`} aria-label=${`연결 상태 ${quality}/3`}>
    ${[1, 2, 3].map((i) => html`<i class=${quality >= i ? 'on' : ''} style=${`height:${4 + i * 3}px`}></i>`)}
  </span>`;
}

function useClock(startedAt) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!startedAt) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  if (!startedAt) return '';
  const s = Math.floor((Date.now() - startedAt) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function RoundButton({ icon, label, onClick, color = 'rgba(255,255,255,.18)', on = false }) {
  return html`<button class="call-btn" onClick=${onClick} aria-label=${label}>
    <span style=${`background:${on ? '#fff' : color};color:${on ? '#000' : '#fff'}`}><${Icon} name=${icon} /></span>
    <small>${label}</small>
  </button>`;
}

/** Full-screen call UI, shown over everything while a call is on. */
export function CallScreen() {
  const call = useCall();
  const clock = useClock(call.status === 'active' ? call.startedAt : null);
  const active = call.status === 'active';
  // The other person's camera off: their photo instead of a black picture.
  const showRemoteVideo = Boolean(call.video && call.remoteStream && active && !call.peerCameraOff);
  const showLocal = Boolean(call.video && call.localStream && !call.cameraOff);

  // Tapping my small picture swaps it with the big one; dragging moves it to another corner.
  const [swapped, setSwapped] = useState(false);
  const swap = swapped && showRemoteVideo && showLocal;
  const [corner, setCorner] = useState('tr');
  const [drag, setDrag] = useState(null);
  const press = useRef(null);
  // On a video call, tapping the picture hides the buttons; they also hide by themselves.
  const [controls, setControls] = useState(true);
  const [touched, setTouched] = useState(0);
  useEffect(() => {
    if (!showRemoteVideo) {
      setControls(true);
      return undefined;
    }
    if (!controls) return undefined;
    const t = setTimeout(() => setControls(false), 5000);
    return () => clearTimeout(t);
  }, [showRemoteVideo, controls, touched]);

  if (call.status === 'idle') return null;
  const peer = call.peer ?? {};
  const ringing = call.status === 'incoming' || call.status === 'outgoing' || call.status === 'connecting';
  const isSmall = (el) => el.classList.contains('local');
  const small = {
    onPointerDown: (e) => {
      if (!isSmall(e.currentTarget)) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      press.current = { x: e.clientX, y: e.clientY, moved: false };
    },
    onPointerMove: (e) => {
      const p = press.current;
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (Math.hypot(dx, dy) > 6) p.moved = true;
      if (p.moved) setDrag({ dx, dy });
    },
    onPointerUp: (e) => {
      const p = press.current;
      press.current = null;
      if (!p) return;
      setDrag(null);
      if (!p.moved) {
        if (showRemoteVideo) setSwapped((v) => !v);
        return;
      }
      // Snaps to the nearest corner.
      const r = e.currentTarget.getBoundingClientRect();
      setCorner(`${r.top + r.height / 2 < innerHeight / 2 ? 't' : 'b'}${r.left + r.width / 2 < innerWidth / 2 ? 'l' : 'r'}`);
    },
  };
  const onScreenTap = (e) => {
    if (e.target.closest('button, video.local')) {
      setTouched((n) => n + 1);
      return;
    }
    if (!showRemoteVideo) return;
    setControls((c) => !c);
    setTouched((n) => n + 1);
  };
  const statusText = {
    outgoing: call.message ?? '연결 중…',
    incoming: `${call.video ? '영상통화' : '음성통화'}가 왔어요`,
    connecting: '연결 중…',
    active: call.reconnecting ? '연결이 불안정해요. 다시 연결하는 중…' : clock,
    ended: call.message,
  }[call.status];
  const note = active && [call.peerMuted && '🔇 상대방이 음소거했어요', call.video && call.peerCameraOff && '상대방이 카메라를 껐어요'].filter(Boolean).join(' · ');
  const smallCls = `local c-${corner}`;
  // While reconnecting the status always shows.
  const hidden = showRemoteVideo && !controls && !call.reconnecting;

  return html`<div class=${`call ${showRemoteVideo ? 'on-video' : ''} ${hidden ? 'controls-hidden' : ''}`} onClick=${onScreenTap}>
    ${call.remoteStream &&
    html`<${Video} stream=${call.remoteStream} remote cls=${!showRemoteVideo ? 'hidden' : swap ? smallCls : 'remote'}
      drag=${swap ? drag : null} ...${small} />`}
    ${showLocal &&
    // My camera fills the screen while ringing, then moves to the corner once connected.
    html`<${Video} stream=${call.localStream} muted mirror cls=${!active ? 'remote dim' : swap ? 'remote' : smallCls}
      drag=${swap ? null : drag} ...${small} />`}
    ${showRemoteVideo && html`<div class="call-scrim top"></div><div class="call-scrim bottom"></div>`}
    ${call.reconnecting && html`<div class="call-reconnect"><span class="spinner"></span></div>`}
    ${active && call.video && pipSupported() && showRemoteVideo &&
    html`<button class="call-top-btn" aria-label="작게 보기" onClick=${togglePip}><${Icon} name="pip" /></button>`}
    <div class=${`call-info ${showRemoteVideo ? 'over-video' : ''}`}>
      ${!showRemoteVideo &&
      html`<div class=${`ripple ${ringing ? 'on' : ''}`}>
        <${Avatar} name=${peer.displayName ?? ''} url=${avatarUrlOf(peer.id)} color=${colorOf(peer.id)} size=${120} ring />
      </div>`}
      <h2>${peer.displayName}</h2>
      <p class="call-status">${active && !call.reconnecting && html`<${QualityBars} quality=${call.quality} />`}${statusText}</p>
      ${active && call.quality === 1 && !call.reconnecting && html`<p class="call-weak">연결이 약해요</p>`}
      ${note && html`<p class="call-note">${note}</p>`}
    </div>
    <div class="call-actions">
      ${call.status === 'incoming'
        ? html`<${RoundButton} icon="phoneOff" label="거절" color="#ff3b30" onClick=${declineCall} />
            <${RoundButton} icon=${call.video ? 'video' : 'phone'} label="받기" color="#34c759" onClick=${acceptCall} />`
        : call.status === 'ended'
          ? null
          : html`<${RoundButton} icon=${call.muted ? 'micOff' : 'mic'} label=${call.muted ? '음소거 해제' : '음소거'} on=${call.muted} onClick=${toggleMute} />
              ${call.video &&
              html`<${RoundButton} icon=${call.cameraOff ? 'videoOff' : 'video'} label=${call.cameraOff ? '카메라 켜기' : '카메라 끄기'} on=${call.cameraOff} onClick=${toggleCamera} />
                <${RoundButton} icon="refresh" label="전환" onClick=${switchCamera} />`}
              <${RoundButton} icon="phoneOff" label="종료" color="#ff3b30" onClick=${() => hangUp()} />`}
    </div>
  </div>`;
}

/** Peer user of a 1:1 room id like "dm-3-7", seen from [me]. */
export function peerOf(roomId, me) {
  const m = /^dm-(\d+)-(\d+)$/.exec(roomId);
  if (!m) return null;
  const id = Number(m[1]) === me.id ? Number(m[2]) : Number(m[1]);
  return store.user(id) ?? { id, displayName: '' };
}

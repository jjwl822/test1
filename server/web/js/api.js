// Talking to the family server: REST calls, the live WebSocket, and shared app state.
// The server sets a login cookie, so every request (and <img>/<video>) is authenticated automatically.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Fires when the server says we're no longer logged in. */
export const onLoggedOut = new EventTarget();

async function request(method, path, body, contentType) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': contentType || 'application/json' },
      body: body === undefined ? undefined : contentType ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요.', 0);
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && !path.endsWith('/login')) onLoggedOut.dispatchEvent(new Event('logout'));
    throw new ApiError(data?.error || `요청에 실패했습니다. (${res.status})`, res.status);
  }
  return data;
}

const get = (p) => request('GET', p);
const post = (p, b = {}) => request('POST', p, b);
const patch = (p, b) => request('PATCH', p, b);
const del = (p) => request('DELETE', p);
const upload = (p, blob) => request('POST', p, blob, blob.type || 'application/octet-stream');

export const api = {
  me: () => get('/api/me'),
  login: (username, password) => post('/api/login', { username, password }),
  register: (body) => post('/api/register', body),
  logout: (endpoint) => post('/api/logout', { endpoint }),
  users: () => get('/api/users'),
  updateName: (displayName) => patch('/api/me', { displayName }),
  updateColor: (color) => patch('/api/me', { color }),
  colors: () => get('/api/colors'),
  uploadAvatar: (jpeg) => upload('/api/me/avatar', jpeg),
  deleteAvatar: () => del('/api/me/avatar'),

  conversations: () => get('/api/conversations'),
  messages: (id, before) => get(`/api/conversations/${id}/messages${before ? `?before=${before}` : ''}`),
  reads: (id) => get(`/api/conversations/${id}/reads`),
  markRead: (id, lastReadId) => post(`/api/conversations/${id}/read`, { lastReadId }),
  sendText: (id, text, replyTo) => post(`/api/conversations/${id}/messages`, { text, replyTo: replyTo ?? undefined }),
  sendImage: (id, jpeg, replyTo) => upload(`/api/conversations/${id}/images${replyTo ? `?replyTo=${replyTo}` : ''}`, jpeg),
  createPoll: (id, question, options, multiple) => post(`/api/conversations/${id}/polls`, { question, options, multiple }),
  vote: (messageId, optionIds) => post(`/api/messages/${messageId}/vote`, { optionIds }),
  reactMessage: (messageId, emoji) => post(`/api/messages/${messageId}/reactions`, { emoji }),
  deleteMessage: (messageId) => del(`/api/messages/${messageId}`),

  posts: (before) => get(`/api/posts${before ? `?before=${before}` : ''}`),
  post: (id) => get(`/api/posts/${id}`),
  memories: () => get('/api/memories'),
  feedSummary: () => get('/api/feed/summary'),
  uploadMedia: (blob) => upload('/api/media', blob),
  createPost: (text, media) => post('/api/posts', { text, media }),
  updatePost: (id, text, media) => patch(`/api/posts/${id}`, { text, media }),
  deletePost: (id) => del(`/api/posts/${id}`),
  reactPost: (id, kind) => post(`/api/posts/${id}/reactions`, { kind }),
  comments: (id) => get(`/api/posts/${id}/comments`),
  addComment: (id, text) => post(`/api/posts/${id}/comments`, { text }),
  deleteComment: (id) => del(`/api/comments/${id}`),

  events: () => get('/api/events'),
  saveEvent: (id, body) => (id ? patch(`/api/events/${id}`, body) : post('/api/events', body)),
  deleteEvent: (id) => del(`/api/events/${id}`),

  listItems: () => get('/api/lists/items'),
  addItem: (list, text, due) => post('/api/lists/items', { list, text, due }),
  setItemDue: (id, due) => patch(`/api/lists/items/${id}`, { due }),
  itemSource: (id) => get(`/api/lists/items/${id}/source`),
  setItemDone: (id, done) => patch(`/api/lists/items/${id}`, { done }),
  deleteItem: (id) => del(`/api/lists/items/${id}`),
  clearDone: (list) => post(`/api/lists/${list}/clear-done`),

  games: () => get('/api/games'),

  callIce: () => get('/api/calls/ice'),
  pendingCall: () => get('/api/calls/pending'),

  pushKey: () => get('/api/push/key'),
  pushSubscribe: (sub) => post('/api/push/subscribe', sub),
};

// ---- Live updates ---------------------------------------------------------------------------

/** Server events by type ("message", "messageUpdated", "read", "user", "events", ...), plus "connected". */
export const live = new EventTarget();
let socket = null;
let retry = 0;
let stopped = true;

function sendVisibility() {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'visibility', visible: document.visibilityState === 'visible' }));
  }
}
document.addEventListener('visibilitychange', () => {
  sendVisibility();
  // Phones drop sockets in the background; reconnect as soon as we're back.
  if (document.visibilityState === 'visible' && !stopped && (!socket || socket.readyState > WebSocket.OPEN)) connect();
});

/** Sends something over the live connection (call signals). Returns false when offline. */
export function sendLive(data) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(data));
  return true;
}

export function connect() {
  stopped = false;
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  socket = ws;
  ws.onopen = () => {
    retry = 0;
    sendVisibility();
    live.dispatchEvent(new Event('connected'));
  };
  ws.onmessage = (e) => {
    let data;
    try {
      data = JSON.parse(e.data);
    } catch {
      return;
    }
    const event = new Event(data.type);
    event.data = data;
    live.dispatchEvent(event);
  };
  ws.onclose = () => {
    if (socket !== ws || stopped) return;
    socket = null;
    const wait = Math.min(30000, 1000 * 2 ** retry++);
    setTimeout(() => !stopped && connect(), wait);
  };
}

export function disconnect() {
  stopped = true;
  socket?.close();
  socket = null;
}

/** Subscribes to live events in a component; returns the unsubscribe function for useEffect. */
export function onLive(types, handler) {
  const list = Array.isArray(types) ? types : [types];
  const fn = (e) => handler(e.data ?? {}, e.type);
  list.forEach((t) => live.addEventListener(t, fn));
  return () => list.forEach((t) => live.removeEventListener(t, fn));
}

// ---- Shared state: me and the family directory ----------------------------------------------

export const store = {
  me: null,
  users: new Map(),
  listeners: new Set(),
  set(patchObj) {
    Object.assign(this, patchObj);
    this.listeners.forEach((l) => l());
  },
  user(id) {
    return this.users.get(id);
  },
  async refreshUsers() {
    try {
      const list = await api.users();
      const users = new Map(list.map((u) => [u.id, u]));
      this.set({ users, me: users.get(this.me?.id) ?? this.me });
    } catch {
      // keep what we have
    }
  },
};
live.addEventListener('user', (e) => {
  const user = e.data.user;
  const users = new Map(store.users);
  users.set(user.id, user);
  store.set({ users, me: store.me?.id === user.id ? user : store.me });
});

// ---- Photos & videos ------------------------------------------------------------------------

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // fall through (older Safari)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToJpeg(source, width, height, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new ApiError('사진을 변환하지 못했습니다.'))), 'image/jpeg', quality),
  );
}

/** Shrinks a photo to at most [maxSide] px (JPEG) so it uploads quickly on mobile data. */
export async function compressImage(file, maxSide = 1600, quality = 0.85) {
  const bitmap = await loadBitmap(file).catch(() => {
    throw new ApiError('사진을 열 수 없습니다.');
  });
  const w = bitmap.width || bitmap.naturalWidth;
  const h = bitmap.height || bitmap.naturalHeight;
  return canvasToJpeg(bitmap, w, h, maxSide, quality);
}

export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const isVideoFile = (file) => file.type.startsWith('video/');

/** First frame of a video as a JPEG (shown in the grid before playing). Null if the browser can't decode it. */
export function videoPoster(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const done = (value) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), 8000);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    video.onloadeddata = () => {
      video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
    };
    video.onseeked = async () => {
      clearTimeout(timer);
      try {
        done(await canvasToJpeg(video, video.videoWidth, video.videoHeight, 1080, 0.8));
      } catch {
        done(null);
      }
    };
    video.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
  });
}

// ---- Web push ---------------------------------------------------------------------------------

export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Current push state: "unsupported", "needs-install" (iPhone Safari tab), "off", "on" or "blocked". */
export async function pushState() {
  if (!pushSupported) return isIOS && !isStandalone ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Asks for permission (must be called from a tap) and registers this device for notifications. */
export async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new ApiError('알림이 허용되지 않았습니다. 설정에서 알림을 허용해 주세요.');
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api.pushKey();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  await api.pushSubscribe(sub.toJSON());
}

/** Re-sends an existing subscription (e.g. after the server was reinstalled). */
export async function syncPush() {
  if (!pushSupported || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await api.pushSubscribe(sub.toJSON()).catch(() => {});
}

export async function pushEndpoint() {
  if (!pushSupported) return undefined;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription())?.endpoint;
}

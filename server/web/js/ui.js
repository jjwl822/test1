// Shared building blocks: icons, avatar, sheets, dialogs, media viewer, long-press, time formatting.
import { html, useEffect, useLayoutEffect, useRef, useState } from '../vendor/preact-htm.js';
import { store } from './api.js';

export { html };

// Stroke icons (Feather style).
const PATHS = {
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  list: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  plusSquare: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  poll: '<path d="M18 20V10M12 20V4M6 20v-6"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1 7.8 7.8 7.8-7.8 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
  comment: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z"/>',
  thumbUp: '<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.3a2 2 0 0 0 2-1.7l1.4-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>',
  thumbDown: '<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.7a2 2 0 0 0-2 1.7l-1.4 9a2 2 0 0 0 2 2.3zm7-13h2.7A2.3 2.3 0 0 1 22 4v7a2.3 2.3 0 0 1-2.3 2H17"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  reply: '<path d="M9 14L4 9l5-5"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
  layers: '<rect x="7" y="7" width="14" height="14" rx="2"/><path d="M3 17V5a2 2 0 0 1 2-2h12"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/>',
  cake: '<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1M2 21h20M7 8v3M12 8v3M17 8v3M7 4h.01M12 4h.01M17 4h.01"/>',
  game: '<rect x="2" y="6" width="20" height="12" rx="6"/><path d="M7 12h4M9 10v4"/><circle cx="15.5" cy="11" r=".6"/><circle cx="17.5" cy="13" r=".6"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
};

export function Icon({ name, size, filled, color, cls = '' }) {
  return html`<svg
    class=${`icon ${size === 'sm' ? 'sm' : ''} ${filled ? 'filled' : ''} ${cls}`}
    viewBox="0 0 24 24"
    style=${color ? `color:${color}` : ''}
    aria-hidden="true"
    dangerouslySetInnerHTML=${{ __html: PATHS[name] || '' }}
  ></svg>`;
}

/** Re-renders when the shared store (me, family directory) changes. */
export function useStore() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    store.listeners.add(l);
    return () => store.listeners.delete(l);
  }, []);
  return store;
}

/** Round avatar: profile photo if set, else first letter. [ring] adds the story gradient. */
export function Avatar({ name = '', url, size = 44, ring = false, group = false, color }) {
  // Without a photo, the first letter sits on the person's own color.
  const tint = !url && color ? `;background:${color};color:#fff` : '';
  const inner = html`<div class="avatar" style=${`width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px${tint}`}>
    ${url ? html`<img src=${url} alt="" loading="lazy" />` : group ? html`<${Icon} name="users" size="sm" />` : name.slice(0, 1)}
  </div>`;
  return ring ? html`<div class="ring">${inner}</div>` : inner;
}

export function avatarUrlOf(userId) {
  return store.user(userId)?.avatarUrl ?? null;
}

/** The person's chat bubble color (chosen in their profile). */
export function colorOf(userId) {
  return store.user(userId)?.color ?? '#1877F2';
}

export function Spinner() {
  return html`<div class="center" style="padding:24px"><div class="spinner"></div></div>`;
}

export function TopBar({ title, small, onBack, children }) {
  return html`<header class="topbar">
    ${onBack && html`<button class="icon-btn" onClick=${onBack} aria-label="뒤로"><${Icon} name="back" /></button>`}
    <h1 class=${small ? 'small' : ''}>${title}</h1>
    ${children}
  </header>`;
}

// ---- Back button closes pop-ups ---------------------------------------------------------------
// Each open pop-up adds a history entry, so the phone's back button (or swipe) closes the pop-up
// instead of leaving the screen. Closing it any other way removes that entry again.

let overlayDepth = 0;

export function useBackToClose(onClose) {
  const latest = useRef(onClose);
  latest.current = onClose;
  // Layout effect: the entry exists as soon as the pop-up is on screen.
  useLayoutEffect(() => {
    const depth = ++overlayDepth;
    let closedByBack = false;
    history.pushState({ overlay: depth }, '');
    const onPop = (e) => {
      if ((e.state?.overlay ?? 0) < depth && !closedByBack) {
        closedByBack = true;
        latest.current?.();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      overlayDepth = depth - 1;
      if (!closedByBack && history.state?.overlay === depth) history.back();
    };
  }, []);
}

export function Sheet({ title, onClose, children }) {
  useBackToClose(onClose);
  return html`<div class="backdrop" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="sheet">
      <div class="grabber"></div>
      ${title && html`<h3>${title}</h3>`}
      ${children}
    </div>
  </div>`;
}

export function Dialog({ title, onClose, children, actions }) {
  useBackToClose(onClose);
  return html`<div class="backdrop middle" onClick=${(e) => e.target === e.currentTarget && onClose?.()}>
    <div class="dialog" role="dialog">
      ${title && html`<h2>${title}</h2>`}
      ${children}
      ${actions && html`<div class="actions">${actions}</div>`}
    </div>
  </div>`;
}

export function Confirm({ title, text, confirm = '삭제', danger = true, onConfirm, onClose }) {
  return html`<${Dialog}
    title=${title}
    onClose=${onClose}
    actions=${html`<button class="link" style="color:var(--fg)" onClick=${onClose}>취소</button>
      <button class=${`link ${danger ? 'danger' : ''}`} onClick=${onConfirm}>${confirm}</button>`}
  >
    ${text && html`<p class="muted" style="margin:0">${text}</p>`}
  <//>`;
}

export function Toggle({ checked, onChange }) {
  return html`<label class="switch"><input type="checkbox" checked=${checked} onChange=${(e) => onChange(e.target.checked)} /><span></span></label>`;
}

/** Full-screen, swipeable photo/video viewer. items: [{ url, kind, posterUrl }] */
export function MediaViewer({ items, start = 0, onClose }) {
  useBackToClose(onClose);
  const track = useRef(null);
  const [index, setIndex] = useState(start);
  useEffect(() => {
    const el = track.current;
    el.scrollLeft = el.clientWidth * start;
  }, []);
  useEffect(() => {
    // Only the visible video plays.
    track.current.querySelectorAll('video').forEach((v, i) => {
      if (Number(v.dataset.index) === index) v.play().catch(() => {});
      else v.pause();
    });
  }, [index]);
  return html`<div class="viewer">
    <div class="bar">
      <button class="icon-btn" onClick=${onClose} aria-label="닫기"><${Icon} name="close" /></button>
      ${items.length > 1 && html`<span>${index + 1} / ${items.length}</span>`}
      <span style="width:44px"></span>
    </div>
    <div class="track" ref=${track} onScroll=${(e) => setIndex(Math.round(e.target.scrollLeft / e.target.clientWidth))}>
      ${items.map(
        (m, i) => html`<div class="slide">
          ${m.kind === 'video'
            ? html`<video data-index=${i} src=${m.url} poster=${m.posterUrl || undefined} controls playsinline preload="metadata"></video>`
            : html`<img src=${m.url} alt="" />`}
        </div>`,
      )}
    </div>
  </div>`;
}

/** Long-press (and right-click) handler props, e.g. <div ...${longPress(() => openMenu())}>. */
export function longPress(callback, ms = 450) {
  let timer = null;
  let start = null;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  return {
    onPointerDown: (e) => {
      start = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => {
        timer = null;
        navigator.vibrate?.(10);
        callback();
      }, ms);
    },
    onPointerMove: (e) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e) => {
      e.preventDefault();
      cancel();
      callback();
    },
  };
}

/** Navigates within the app (hash routes like "/chat/family"). */
export const go = (path) => {
  location.hash = path;
};

/** One-line summary of a chat message, for lists and banners. */
export function preview(m) {
  if (m.deleted) return '삭제된 메시지';
  if (m.kind === 'image') return '사진';
  if (m.kind === 'poll') return `투표: ${m.poll?.question ?? m.text ?? ''}`;
  return m.text ?? '';
}

// ---- Time ------------------------------------------------------------------------------------

const two = (n) => String(n).padStart(2, '0');

export function timeOf(ms) {
  const d = new Date(ms);
  const h = d.getHours();
  return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${two(d.getMinutes())}`;
}

export function ago(ms) {
  const diff = (Date.now() - ms) / 1000;
  const d = new Date(ms);
  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  if (d.getFullYear() === new Date().getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const weekdayName = (d) => `${WEEKDAYS[d.getDay()]}요일`;
export const dayLabel = (d) => `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${weekdayName(d)}`;
export const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
/** YYYY-MM-DD in local time. */
export const isoDate = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
export const parseDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// ---- Toast -----------------------------------------------------------------------------------

export const toasts = new EventTarget();
/** Shows a small banner at the top, e.g. a message from another chat. */
export function toast(title, body, onClick) {
  const e = new Event('toast');
  e.data = { title, body, onClick, id: Math.random() };
  toasts.dispatchEvent(e);
}

export function Toasts() {
  const [current, setCurrent] = useState(null);
  useEffect(() => {
    let timer;
    const show = (e) => {
      setCurrent(e.data);
      clearTimeout(timer);
      timer = setTimeout(() => setCurrent(null), 3500);
    };
    toasts.addEventListener('toast', show);
    return () => toasts.removeEventListener('toast', show);
  }, []);
  if (!current) return null;
  return html`<div
    class="toast"
    onClick=${() => {
      current.onClick?.();
      setCurrent(null);
    }}
  >
    <div class="bold">${current.title}</div>
    ${current.body && html`<div class="small muted ellipsis">${current.body}</div>`}
  </div>`;
}

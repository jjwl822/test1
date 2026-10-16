// App entry: login check, hash router, bottom tabs, unread badge, in-app banners.
import { render, useEffect, useState } from '../vendor/preact-htm.js';
import { api, connect, disconnect, onLive, onLoggedOut, store, syncPush } from './api.js';
import { ChatList, ChatRoom } from './chat.js';
import { CallScreen, resumePendingCall } from './call.js';
import { CalendarScreen } from './calendar.js';
import { GamePlayer, GamesScreen } from './games.js';
import { ListsScreen } from './lists.js';
import { LoginScreen } from './login.js';
import { ProfileScreen } from './profile.js';
import { StoryScreen } from './story.js';
import { go, html, Icon, preview, Spinner, toast, Toasts, useStore } from './ui.js';

// Keep the layout the size of the visible area (iPhone keyboard shrinks it).
function fitViewport() {
  const h = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${h}px`);
  document.documentElement.style.setProperty('--vv-top', `${window.visualViewport?.offsetTop ?? 0}px`);
}
window.visualViewport?.addEventListener('resize', fitViewport);
window.visualViewport?.addEventListener('scroll', fitViewport);
window.addEventListener('resize', fitViewport);
fitViewport();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  // A tapped notification asks an open app to go to its screen.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'navigate') location.href = e.data.url;
  });
}

function parseRoute() {
  const [, name = 'chats', id] = (location.hash || '#/chats').slice(1).split('/');
  return { name, id: id ? decodeURIComponent(id) : undefined };
}

function useRoute() {
  const [route, setRoute] = useState(parseRoute());
  useEffect(() => {
    const on = () => setRoute(parseRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

const TABS = [
  { route: 'chats', label: '채팅', icon: 'chat' },
  { route: 'story', label: '스토리', icon: 'grid' },
  { route: 'calendar', label: '일정', icon: 'calendar' },
  { route: 'lists', label: '목록', icon: 'list' },
  { route: 'games', label: '게임', icon: 'game' },
];

function TabBar({ current, unread }) {
  return html`<nav class="tabbar">
    ${TABS.map(
      (t) => html`<button class=${current === t.route ? 'on' : ''} onClick=${() => go(`/${t.route}`)}>
        <${Icon} name=${t.icon} filled=${current === t.route && t.icon === 'chat'} />
        ${t.label}
        ${t.route === 'chats' && unread > 0 && html`<span class="badge">${unread > 99 ? '99+' : unread}</span>`}
      </button>`,
    )}
  </nav>`;
}

/** Chat rooms with unread counts; shared by the chat list and the tab badge. */
function useConversations(me) {
  const [rooms, setRooms] = useState([]);
  const [error, setError] = useState(null);
  const refresh = () =>
    api
      .conversations()
      .then((r) => {
        setRooms(r);
        setError(null);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (!me) return undefined;
    refresh();
    return onLive(['message', 'messageUpdated', 'connected', 'read', 'user'], (data, type) => {
      if (type === 'read' && data.userId !== me.id) return;
      refresh();
    });
  }, [me?.id]);
  return { rooms, error, refresh };
}

function App() {
  const { me } = useStore();
  const [checking, setChecking] = useState(true);
  const route = useRoute();
  const conversations = useConversations(me);

  useEffect(() => {
    api
      .me()
      .then((user) => store.set({ me: user }))
      .catch(() => {})
      .finally(() => setChecking(false));
    const out = () => {
      disconnect();
      store.set({ me: null, users: new Map() });
    };
    onLoggedOut.addEventListener('logout', out);
    return () => onLoggedOut.removeEventListener('logout', out);
  }, []);

  useEffect(() => {
    if (!me) return undefined;
    connect();
    store.refreshUsers();
    syncPush();
    const offConnected = onLive('connected', () => {
      store.refreshUsers();
      // Reopened while someone is calling: show the incoming call.
      resumePendingCall();
    });
    // Banners for things happening elsewhere while the app is open.
    const offEvents = onLive(['message', 'reminder', 'post'], (data, type) => {
      const here = parseRoute();
      if (type === 'message') {
        const m = data.message;
        if (m.senderId === me.id || (here.name === 'chat' && here.id === m.conversationId)) return;
        const group = m.conversationId === 'family';
        toast(group ? '우리 가족' : m.senderName, `${group ? `${m.senderName}: ` : ''}${preview(m)}`, () => go(`/chat/${m.conversationId}`));
      } else if (type === 'reminder') {
        toast(data.title, data.text, () => go(data.target === 'feed' ? '/story' : '/calendar'));
      } else if (type === 'post' && data.authorId !== me.id && here.name !== 'story') {
        toast('가족 스토리', `${data.authorName}님이 새 스토리를 올렸어요`, () => go('/story'));
      }
    });
    return () => {
      offConnected();
      offEvents();
    };
  }, [me?.id]);

  // Home-screen icon badge (iPhone 16.4+ web apps, Chrome).
  const unread = conversations.rooms.reduce((n, r) => n + r.unreadCount, 0);
  useEffect(() => {
    if (!navigator.setAppBadge) return;
    (unread > 0 ? navigator.setAppBadge(unread) : navigator.clearAppBadge()).catch(() => {});
  }, [unread]);

  if (checking) return html`<${Spinner} />`;
  if (!me) return html`<${LoginScreen} />`;

  const titleOf = (id) => conversations.rooms.find((r) => r.id === id)?.title ?? (id === 'family' ? '우리 가족' : '대화');
  let screen;
  let tab = route.name;
  switch (route.name) {
    case 'chat':
      return html`<${ChatRoom} key=${route.id} id=${route.id} title=${titleOf(route.id)} me=${me} onBack=${() => go('/chats')} /><${Toasts} /><${CallScreen} />`;
    case 'call':
      // Opened from an incoming-call notification.
      resumePendingCall(route.id).finally(() => go('/chats'));
      return html`<${Spinner} /><${CallScreen} />`;
    case 'game':
      return html`<${GamePlayer} key=${route.id} id=${route.id} onBack=${() => go('/games')} /><${Toasts} /><${CallScreen} />`;
    case 'games':
      screen = html`<${GamesScreen} />`;
      break;
    case 'profile':
      return html`<${ProfileScreen} me=${me} onBack=${() => go('/chats')} /><${Toasts} /><${CallScreen} />`;
    case 'story':
    case 'post':
      tab = 'story';
      screen = html`<${StoryScreen} me=${me} postId=${route.name === 'post' ? Number(route.id) : null} />`;
      break;
    case 'calendar':
      screen = html`<${CalendarScreen} me=${me} />`;
      break;
    case 'lists':
      screen = html`<${ListsScreen} />`;
      break;
    default:
      tab = 'chats';
      screen = html`<${ChatList} me=${me} conversations=${conversations} />`;
  }
  return html`<div class="screen">${screen}</div>
    <${TabBar} current=${tab} unread=${unread} />
    <${Toasts} /><${CallScreen} />`;
}

render(html`<${App} />`, document.getElementById('app'));

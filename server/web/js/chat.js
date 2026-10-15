import { useEffect, useLayoutEffect, useRef, useState } from '../vendor/preact-htm.js';
import { api, compressImage, onLive } from './api.js';
import { PushBanner } from './profile.js';
import {
  ago,
  Avatar,
  avatarUrlOf,
  Confirm,
  dayLabel,
  Dialog,
  go,
  html,
  Icon,
  longPress,
  MediaViewer,
  preview,
  sameDay,
  Sheet,
  Spinner,
  timeOf,
  Toggle,
  TopBar,
  useStore,
} from './ui.js';

const EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];

// ---- Chat list -------------------------------------------------------------------------------

export function ChatList({ me, conversations }) {
  useStore();
  const { rooms, error } = conversations;
  return html`<${TopBar} title="가족 메신저">
      <button class="icon-btn" onClick=${() => go('/profile')} aria-label="내 프로필">
        <${Avatar} name=${me.displayName} url=${me.avatarUrl} size=${32} />
      </button>
    <//>
    <div class="scroll">
      <${PushBanner} />
      <div class="small muted" style="padding:10px 16px 4px">${me.displayName}님, 안녕하세요</div>
      ${error && html`<div class="error">${error}</div>`}
      ${rooms.map((room) => {
        const last = room.lastMessage;
        const unread = room.unreadCount > 0;
        const text = last ? `${room.kind === 'group' ? `${last.senderName}: ` : ''}${preview(last)} · ${ago(last.createdAt)}` : '대화를 시작해 보세요';
        return html`<button class=${`room ${unread ? 'unread' : ''}`} onClick=${() => go(`/chat/${room.id}`)}>
          <${Avatar} name=${room.title} url=${room.userId ? avatarUrlOf(room.userId) : null} size=${56} ring=${unread} group=${room.kind === 'group'} />
          <div class="grow">
            <div class="name">${room.title}</div>
            <div class="last small muted ellipsis">${text}</div>
          </div>
          ${unread && html`<span class="badge">${room.unreadCount > 99 ? '99+' : room.unreadCount}</span>`}
        </button>`;
      })}
      ${rooms.length === 1 &&
      html`<div class="empty small">아직 다른 가족이 가입하지 않았어요.<br />이 주소와 가족 코드를 알려주세요.</div>`}
    </div>`;
}

// ---- Chat room -------------------------------------------------------------------------------

export function ChatRoom({ id, title, me, onBack }) {
  useStore();
  const [messages, setMessages] = useState([]);
  const [reads, setReads] = useState({});
  const [loading, setLoading] = useState(true);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [sending, setSending] = useState(false);
  const [actionsFor, setActionsFor] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [attach, setAttach] = useState(false);
  const [composingPoll, setComposingPoll] = useState(false);
  const scroller = useRef(null);
  const fileInput = useRef(null);
  const stickToBottom = useRef(true);
  const firstLoad = useRef(true);
  const isGroup = id === 'family';

  const merge = (incoming) =>
    setMessages((current) => {
      const byId = new Map(current.map((m) => [m.id, m]));
      incoming.forEach((m) => byId.set(m.id, m));
      return [...byId.values()].sort((a, b) => a.id - b.id);
    });
  const replace = (m) => setMessages((current) => current.map((x) => (x.id === m.id ? m : x)));

  async function loadLatest() {
    try {
      const [latest, readList] = await Promise.all([api.messages(id), api.reads(id)]);
      if (firstLoad.current) setHasOlder(latest.length >= 50);
      firstLoad.current = false;
      merge(latest);
      setReads(Object.fromEntries(readList.map((r) => [r.userId, r.lastReadId])));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLatest();
    return onLive(['message', 'messageUpdated', 'read', 'connected'], (data, type) => {
      if (type === 'connected') return loadLatest();
      if (type === 'read') {
        if (data.conversationId === id) setReads((r) => ({ ...r, [data.userId]: Math.max(r[data.userId] ?? 0, data.lastReadId) }));
        return;
      }
      if (data.message?.conversationId !== id) return;
      if (type === 'message') merge([data.message]);
      else replace(data.message);
    });
  }, [id]);

  // Mark as read while this chat is actually on screen.
  const newest = messages[messages.length - 1]?.id ?? 0;
  useEffect(() => {
    const mark = () => {
      if (document.visibilityState !== 'visible' || !newest || (reads[me.id] ?? 0) >= newest) return;
      setReads((r) => ({ ...r, [me.id]: newest }));
      api.markRead(id, newest).catch(() => {});
    };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [newest, reads[me.id]]);

  // Photos finish loading after the first scroll and push content down; stay at the bottom.
  useEffect(() => {
    const el = scroller.current;
    const onLoad = () => stickToBottom.current && (el.scrollTop = el.scrollHeight);
    el.addEventListener('load', onLoad, true);
    return () => el.removeEventListener('load', onLoad, true);
  }, []);

  // Keep the newest message in view when it arrives (unless reading older ones).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, replyTo]);

  async function loadOlder() {
    const el = scroller.current;
    const fromBottom = el.scrollHeight - el.scrollTop;
    try {
      const older = await api.messages(id, messages[0]?.id);
      setHasOlder(older.length >= 50);
      stickToBottom.current = false;
      merge(older);
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight - fromBottom;
      });
    } catch (e) {
      setError(e.message);
    }
  }

  async function send(work) {
    setSending(true);
    setError(null);
    const target = replyTo?.id;
    setReplyTo(null);
    stickToBottom.current = true;
    try {
      const m = await work(target);
      merge([m]);
      setReads((r) => ({ ...r, [me.id]: Math.max(r[me.id] ?? 0, m.id) }));
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  const update = (work) => work().then(replace).catch((e) => setError(e.message));

  const unreadCount = (m) =>
    Object.entries(reads).filter(([userId, last]) => Number(userId) !== m.senderId && last < m.id).length;

  function submitText() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    send((reply) => api.sendText(id, text, reply));
  }

  return html`<div class="screen">
    <${TopBar} title=${title} small onBack=${onBack} />
    <div
      class="scroll"
      ref=${scroller}
      onScroll=${(e) => {
        const el = e.currentTarget;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div class="messages">
        ${loading && messages.length === 0 && html`<${Spinner} />`}
        ${hasOlder && html`<div class="center"><button class="link" onClick=${loadOlder}>이전 메시지 더 보기</button></div>`}
        ${messages.map((m, i) => {
          const prev = messages[i - 1];
          const day = new Date(m.createdAt);
          const newDay = !prev || !sameDay(new Date(prev.createdAt), day);
          const first = newDay || prev.senderId !== m.senderId;
          return html`${newDay && html`<div class="day"><span>${dayLabel(day)}</span></div>`}
            <${MessageRow}
              key=${m.id}
              m=${m}
              me=${me}
              first=${first}
              showName=${isGroup && first && m.senderId !== me.id}
              unread=${unreadCount(m)}
              onLongPress=${() => !m.deleted && setActionsFor(m)}
              onImage=${(url) => setViewing(url)}
              onReact=${(emoji) => update(() => api.reactMessage(m.id, emoji))}
              onVote=${(ids) => update(() => api.vote(m.id, ids))}
            />`;
        })}
      </div>
    </div>
    ${error && html`<div class="error" onClick=${() => setError(null)}>${error}</div>`}
    <div class="composer">
      ${replyTo &&
      html`<div class="replybar">
        <${Icon} name="reply" size="sm" color="var(--blue)" />
        <div class="grow">
          <div class="small bold">${replyTo.senderName} 님에게 답장</div>
          <div class="small muted ellipsis">${preview(replyTo)}</div>
        </div>
        <button class="icon-btn" onClick=${() => setReplyTo(null)} aria-label="답장 취소"><${Icon} name="close" size="sm" /></button>
      </div>`}
      <div class="row">
        <button class="icon-btn" onClick=${() => setAttach(true)} disabled=${sending} aria-label="보내기 메뉴"><${Icon} name="plus" /></button>
        <textarea
          class="pill-input"
          rows="1"
          placeholder="메시지 보내기..."
          value=${draft}
          onInput=${(e) => {
            setDraft(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
          }}
          onKeyDown=${(e) => {
            // Enter sends on a computer; on phones the return key adds a line.
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(pointer: fine)').matches) {
              e.preventDefault();
              submitText();
            }
          }}
        ></textarea>
        ${sending
          ? html`<div class="icon-btn"><div class="spinner" style="width:20px;height:20px"></div></div>`
          : html`<button class="icon-btn" onClick=${submitText} disabled=${!draft.trim()} aria-label="보내기">
              <${Icon} name="send" color="var(--blue)" />
            </button>`}
      </div>
      <input
        type="file"
        accept="image/*"
        ref=${fileInput}
        style="display:none"
        onChange=${(e) => {
          const file = e.target.files[0];
          e.target.value = '';
          if (file) send(async (reply) => api.sendImage(id, await compressImage(file), reply));
        }}
      />
    </div>

    ${attach &&
    html`<${Sheet} onClose=${() => setAttach(false)}>
      <button class="sheet-item" onClick=${() => { setAttach(false); fileInput.current.click(); }}><${Icon} name="image" /> 사진</button>
      <button class="sheet-item" onClick=${() => { setAttach(false); setComposingPoll(true); }}><${Icon} name="poll" /> 투표 만들기</button>
    <//>`}
    ${actionsFor &&
    html`<${MessageActions}
      m=${actionsFor}
      me=${me}
      onClose=${() => setActionsFor(null)}
      onReact=${(emoji) => { update(() => api.reactMessage(actionsFor.id, emoji)); setActionsFor(null); }}
      onReply=${() => { setReplyTo(actionsFor); setActionsFor(null); }}
      onDelete=${() => { update(() => api.deleteMessage(actionsFor.id)); setActionsFor(null); }}
    />`}
    ${composingPoll &&
    html`<${PollComposer}
      onClose=${() => setComposingPoll(false)}
      onCreate=${(q, options, multiple) => { setComposingPoll(false); send(() => api.createPoll(id, q, options, multiple)); }}
    />`}
    ${viewing && html`<${MediaViewer} items=${[{ url: viewing, kind: 'image' }]} onClose=${() => setViewing(null)} />`}
  </div>`;
}

function MessageRow({ m, me, first, showName, unread, onLongPress, onImage, onReact, onVote }) {
  const mine = m.senderId === me.id;
  const press = longPress(onLongPress);
  let bubble;
  if (m.deleted) {
    bubble = html`<div class="bubble deleted">삭제된 메시지입니다</div>`;
  } else if (m.kind === 'poll' && m.poll) {
    bubble = html`<${PollCard} m=${m} me=${me} press=${press} onVote=${onVote} />`;
  } else if (m.imageUrl) {
    bubble = html`<div>
      ${m.replyTo && html`<div class="bubble" style="margin-bottom:4px"><${Quote} r=${m.replyTo} /></div>`}
      <div class="bubble photo" ...${press} onClick=${() => onImage(m.imageUrl)}><img src=${m.imageUrl} alt="사진" loading="lazy" /></div>
    </div>`;
  } else {
    bubble = html`<div class="bubble" ...${press}>${m.replyTo && html`<${Quote} r=${m.replyTo} />`}${m.text}</div>`;
  }
  return html`<div class=${`msg ${mine ? 'mine' : ''} ${first ? 'first' : ''}`}>
    ${!mine && html`<div class="av">${first && html`<${Avatar} name=${m.senderName} url=${avatarUrlOf(m.senderId)} size=${30} />`}</div>`}
    <div class="body">
      ${showName && html`<div class="sender">${m.senderName}</div>`}
      <div class="line">
        ${bubble}
        <div class="meta">
          ${unread > 0 && !m.deleted && html`<span class="unread">${unread}</span>`}
          <span>${timeOf(m.createdAt)}</span>
        </div>
      </div>
      ${m.reactions.length > 0 &&
      html`<div class="reactions">
        ${m.reactions.map(
          (r) => html`<button class=${r.userIds.includes(me.id) ? 'on' : ''} onClick=${() => onReact(r.emoji)}>${r.emoji} ${r.userIds.length}</button>`,
        )}
      </div>`}
    </div>
  </div>`;
}

function Quote({ r }) {
  return html`<div class="quote">
    <div class="tiny bold">${r.senderName} 님에게 답장</div>
    <div class="ellipsis">${r.preview}</div>
  </div>`;
}

function PollCard({ m, me, press, onVote }) {
  const { poll } = m;
  const voters = new Set(poll.options.flatMap((o) => o.voterIds));
  const mine = poll.options.filter((o) => o.voterIds.includes(me.id)).map((o) => o.id);
  return html`<div class="poll" ...${press}>
    <div class="tiny bold" style="color:var(--blue)">📊 투표</div>
    <div class="q">${poll.question}</div>
    ${poll.options.map((o) => {
      const chosen = mine.includes(o.id);
      const share = voters.size ? (o.voterIds.length / voters.size) * 100 : 0;
      const next = chosen ? mine.filter((x) => x !== o.id) : poll.multiple ? [...mine, o.id] : [o.id];
      return html`<button class="opt" onClick=${() => onVote(next)}>
        <div class="row">
          <span class=${`check ${chosen ? 'on' : ''}`}>${chosen && html`<${Icon} name="check" size="sm" color="#fff" />`}</span>
          <span class=${`grow ${chosen ? 'bold' : ''}`}>${o.text}</span>
          <span class="small muted">${o.voterIds.length}명</span>
        </div>
        <div class="bar"><i style=${`width:${share}%`}></i></div>
      </button>`;
    })}
    <div class="tiny muted" style="margin-top:6px">${voters.size}명 참여${poll.multiple ? ' · 여러 개 선택 가능' : ''}</div>
  </div>`;
}

function MessageActions({ m, me, onClose, onReact, onReply, onDelete }) {
  const [confirm, setConfirm] = useState(false);
  const myEmoji = m.reactions.find((r) => r.userIds.includes(me.id))?.emoji;
  if (confirm) {
    return html`<${Confirm}
      title="메시지를 삭제할까요?"
      text='모든 가족의 화면에서 "삭제된 메시지입니다"로 바뀌어요.'
      onClose=${onClose}
      onConfirm=${onDelete}
    />`;
  }
  return html`<${Sheet} onClose=${onClose}>
    <div class="emoji-row">
      ${EMOJIS.map((e) => html`<button class=${e === myEmoji ? 'on' : ''} onClick=${() => onReact(e)}>${e}</button>`)}
    </div>
    <button class="sheet-item" onClick=${onReply}><${Icon} name="reply" /> 답장</button>
    ${m.text && m.kind === 'text' &&
    html`<button
      class="sheet-item"
      onClick=${() => {
        navigator.clipboard?.writeText(m.text).catch(() => {});
        onClose();
      }}
    >
      <${Icon} name="copy" /> 복사
    </button>`}
    ${m.senderId === me.id && html`<button class="sheet-item danger" onClick=${() => setConfirm(true)}><${Icon} name="trash" /> 삭제</button>`}
  <//>`;
}

function PollComposer({ onClose, onCreate }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  return html`<${Dialog}
    title="투표 만들기"
    onClose=${onClose}
    actions=${html`<button class="link" style="color:var(--fg)" onClick=${onClose}>취소</button>
      <button class="link" disabled=${!question.trim() || filled.length < 2} onClick=${() => onCreate(question.trim(), filled, multiple)}>올리기</button>`}
  >
    <input class="field" placeholder="질문 (예: 저녁 뭐 먹을까?)" value=${question} onInput=${(e) => setQuestion(e.target.value)} />
    ${options.map(
      (o, i) => html`<div class="row" style="margin-top:8px">
        <input
          class="field"
          placeholder=${`선택지 ${i + 1}`}
          value=${o}
          onInput=${(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))}
        />
        ${options.length > 2 &&
        html`<button class="icon-btn" onClick=${() => setOptions(options.filter((_, j) => j !== i))} aria-label="선택지 빼기">
          <${Icon} name="close" size="sm" />
        </button>`}
      </div>`,
    )}
    ${options.length < 10 && html`<button class="link" style="padding:10px 0" onClick=${() => setOptions([...options, ''])}>+ 선택지 추가</button>`}
    <div class="row" style="margin-top:8px"><span class="grow">여러 개 선택 가능</span><${Toggle} checked=${multiple} onChange=${setMultiple} /></div>
  <//>`;
}

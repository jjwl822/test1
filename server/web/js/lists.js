import { useEffect, useState } from '../vendor/preact-htm.js';
import { api, onLive } from './api.js';
import { ago, Dialog, html, Icon, isoDate, parseDate, Spinner, TopBar } from './ui.js';

const LISTS = [
  { key: 'shopping', title: '🛒 장보기', placeholder: '살 것 추가 (예: 우유, 계란)' },
  { key: 'todo', title: '✅ 할 일', placeholder: '할 일 추가 (예: 분리수거)' },
  { key: 'homework', title: '📚 숙제', placeholder: '숙제 추가 (예: 수학 익힘책 12쪽)' },
];

/** Days from today to a YYYY-MM-DD date (0 = today, negative = past). */
function daysUntil(due) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((parseDate(due) - today) / 86400000);
}

function DueBadge({ due, done }) {
  const d = daysUntil(due);
  const date = parseDate(due);
  const label = d === 0 ? '오늘까지' : d === 1 ? '내일까지' : d < 0 ? `${-d}일 지남` : `${date.getMonth() + 1}/${date.getDate()}까지`;
  const cls = done ? '' : d < 0 ? 'over' : d <= 1 ? 'soon' : '';
  return html`<span class=${`due ${cls}`}>${label}</span>`;
}

/** The chat notice a homework item was taken from. */
function SourceDialog({ item, onClose }) {
  const [messages, setMessages] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.itemSource(item.id).then((r) => setMessages(r.messages)).catch((e) => setError(e.message));
  }, [item.id]);
  return html`<${Dialog}
    title="원본 메시지"
    onClose=${onClose}
    actions=${html`<button class="link" onClick=${onClose}>닫기</button>`}
  >
    ${error && html`<div class="error">${error}</div>`}
    ${messages === null && !error && html`<${Spinner} />`}
    ${messages?.map(
      (m) => html`<div key=${m.id}>
        <div class="tiny muted">${m.senderName} · ${ago(m.createdAt)}</div>
        <div class="source-text">${m.text}</div>
      </div>`,
    )}
  <//>`;
}

/** The 📚 숙제 tab: the homework list on its own. */
export const HomeworkScreen = () => ListsScreen({ keys: ['homework'], title: '📚 숙제' });

export function ListsScreen({ keys = ['shopping', 'todo'], title = '함께 쓰는 목록' } = {}) {
  const lists = LISTS.filter((l) => keys.includes(l.key));
  const [items, setItems] = useState(null);
  const [tab, setTab] = useState(0);
  const [draft, setDraft] = useState('');
  const [due, setDue] = useState('');
  const [source, setSource] = useState(null);
  const [error, setError] = useState(null);
  const list = lists[tab] ?? lists[0];
  const homework = list.key === 'homework';

  const load = () => api.listItems().then((i) => { setItems(i); setError(null); }).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    return onLive(['lists', 'connected'], load);
  }, []);
  const act = (work) => work().then(load).catch((e) => setError(e.message));

  // Homework: soonest due first, then the ones without a date.
  const byDue = (a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999');
  const shown = (items ?? [])
    .filter((i) => i.list === list.key)
    .sort((a, b) => Number(a.done) - Number(b.done) || (homework && !a.done ? byDue(a, b) : 0) || b.id - a.id);
  const doneCount = shown.filter((i) => i.done).length;

  function add() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setDue('');
    act(() => api.addItem(list.key, text, homework && due ? due : undefined));
  }

  function toggle(item) {
    // Flip immediately; the server confirms.
    setItems((all) => all.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
    act(() => api.setItemDone(item.id, !item.done));
  }

  function subtitle(i) {
    if (i.done && i.doneByName) return `${i.doneByName} 완료`;
    const who = homework && i.assigneeName ? `${i.assigneeName} · ` : '';
    return `${who}${i.authorName} ${i.fromChat ? '단체방에서' : '추가'} · ${ago(i.createdAt)}`;
  }

  return html`<${TopBar} title=${title} />
    ${lists.length > 1 &&
    html`<div class="tabs">
      ${lists.map((l, i) => {
        const open = (items ?? []).filter((x) => x.list === l.key && !x.done).length;
        return html`<button class=${tab === i ? 'on' : ''} onClick=${() => setTab(i)}>${l.title}${open > 0 ? ` ${open}` : ''}</button>`;
      })}
    </div>`}
    <div class="row" style="padding:12px">
      <input
        class="pill-input"
        placeholder=${list.placeholder}
        value=${draft}
        onInput=${(e) => setDraft(e.target.value)}
        onKeyDown=${(e) => e.key === 'Enter' && !e.isComposing && add()}
        enterkeyhint="done"
      />
      ${homework &&
      html`<input class="date-input" type="date" value=${due} min=${isoDate(new Date())} onInput=${(e) => setDue(e.target.value)} aria-label="마감일" />`}
      <button class="link" disabled=${!draft.trim()} onClick=${add}>추가</button>
    </div>
    ${homework && html`<div class="tiny muted" style="padding:0 16px 8px">단체방에 📢 공지를 올리거나, 공지 뒤에 "숙제"(예: 유이숙제)라고 보내면 자동으로 들어와요.</div>`}
    ${error && html`<div class="error">${error}</div>`}
    <div class="scroll">
      ${items === null && html`<${Spinner} />`}
      ${items && shown.length === 0 && html`<div class="empty small">아직 비어 있어요.<br />위에서 추가하면 가족 모두에게 바로 보여요.</div>`}
      ${shown.map(
        (i) => html`<div class=${`item-row ${i.done ? 'done' : ''}`} key=${i.id}>
          <button class=${`box ${i.done ? 'on' : ''}`} onClick=${() => toggle(i)} aria-label=${i.done ? '완료 취소' : '완료'}>
            ${i.done && html`<${Icon} name="check" size="sm" />`}
          </button>
          <button class="grow" style="text-align:left" onClick=${() => toggle(i)}>
            <div class="text">${i.due && html`<${DueBadge} due=${i.due} done=${i.done} />`}${i.text}</div>
            <div class="tiny muted">${subtitle(i)}</div>
          </button>
          ${i.fromChat && html`<button class="link tiny" style="color:var(--muted)" onClick=${() => setSource(i)}>원본</button>`}
          <button class="icon-btn" onClick=${() => act(() => api.deleteItem(i.id))} aria-label="삭제"><${Icon} name="close" size="sm" /></button>
        </div>`,
      )}
      ${doneCount > 0 &&
      html`<button class="link" style="color:var(--muted);margin:8px" onClick=${() => act(() => api.clearDone(list.key))}>완료한 항목 ${doneCount}개 지우기</button>`}
    </div>
    ${source && html`<${SourceDialog} item=${source} onClose=${() => setSource(null)} />`}`;
}

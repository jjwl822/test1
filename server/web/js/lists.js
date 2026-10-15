import { useEffect, useState } from '../vendor/preact-htm.js';
import { api, onLive } from './api.js';
import { ago, html, Icon, Spinner, TopBar } from './ui.js';

const LISTS = [
  { key: 'shopping', title: '🛒 장보기', placeholder: '살 것 추가 (예: 우유, 계란)' },
  { key: 'todo', title: '✅ 할 일', placeholder: '할 일 추가 (예: 분리수거)' },
];

export function ListsScreen() {
  const [items, setItems] = useState(null);
  const [tab, setTab] = useState(0);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(null);
  const list = LISTS[tab];

  const load = () => api.listItems().then((i) => { setItems(i); setError(null); }).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    return onLive(['lists', 'connected'], load);
  }, []);
  const act = (work) => work().then(load).catch((e) => setError(e.message));

  const shown = (items ?? [])
    .filter((i) => i.list === list.key)
    .sort((a, b) => Number(a.done) - Number(b.done) || b.id - a.id);
  const doneCount = shown.filter((i) => i.done).length;

  function add() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    act(() => api.addItem(list.key, text));
  }

  function toggle(item) {
    // Flip immediately; the server confirms.
    setItems((all) => all.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
    act(() => api.setItemDone(item.id, !item.done));
  }

  return html`<${TopBar} title="함께 쓰는 목록" />
    <div class="tabs">
      ${LISTS.map((l, i) => {
        const open = (items ?? []).filter((x) => x.list === l.key && !x.done).length;
        return html`<button class=${tab === i ? 'on' : ''} onClick=${() => setTab(i)}>${l.title}${open > 0 ? ` ${open}` : ''}</button>`;
      })}
    </div>
    <div class="row" style="padding:12px">
      <input
        class="pill-input"
        placeholder=${list.placeholder}
        value=${draft}
        onInput=${(e) => setDraft(e.target.value)}
        onKeyDown=${(e) => e.key === 'Enter' && !e.isComposing && add()}
        enterkeyhint="done"
      />
      <button class="link" disabled=${!draft.trim()} onClick=${add}>추가</button>
    </div>
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
            <div class="text">${i.text}</div>
            <div class="tiny muted">${i.done && i.doneByName ? `${i.doneByName} 완료` : `${i.authorName} 추가 · ${ago(i.createdAt)}`}</div>
          </button>
          <button class="icon-btn" onClick=${() => act(() => api.deleteItem(i.id))} aria-label="삭제"><${Icon} name="close" size="sm" /></button>
        </div>`,
      )}
      ${doneCount > 0 &&
      html`<button class="link" style="color:var(--muted);margin:8px" onClick=${() => act(() => api.clearDone(list.key))}>완료한 항목 ${doneCount}개 지우기</button>`}
    </div>`;
}

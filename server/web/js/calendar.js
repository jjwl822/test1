import { useEffect, useState } from '../vendor/preact-htm.js';
import { api, onLive } from './api.js';
import { Confirm, Dialog, html, Icon, isoDate, parseDate, Spinner, Toggle, TopBar, weekdayName } from './ui.js';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

/** Events on a day; yearly ones (birthdays) show every year from their first date on. */
function eventsOn(events, day) {
  const key = isoDate(day);
  return events
    .filter((e) => e.date === key || (e.yearly && e.date.slice(5) === key.slice(5) && e.date <= key))
    .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
}

const shortLabel = (d) => `${d.getMonth() + 1}/${d.getDate()} (${WEEK[d.getDay()]})`;
const longLabel = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일 ${weekdayName(d)}`;

export function CalendarScreen() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(today);
  const [editing, setEditing] = useState(null); // 'new' or an event

  const load = () => api.events().then((e) => { setEvents(e); setError(null); }).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    return onLive(['events', 'connected'], load);
  }, []);

  const list = events ?? [];
  const lead = month.getDay();
  const length = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  const dayEvents = eventsOn(list, selected);
  const upcoming = [];
  for (let i = 0; i < 365 && upcoming.length < 5; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    if (isoDate(d) !== isoDate(selected)) eventsOn(list, d).forEach((e) => upcoming.push([d, e]));
  }

  const EventRow = ({ e, day, label, onClick }) => {
    const years = e.yearly ? day.getFullYear() - Number(e.date.slice(0, 4)) : 0;
    return html`<button class="event" onClick=${onClick}>
      <span class=${`stripe ${e.yearly ? 'yearly' : ''}`}></span>
      <div class="grow">
        <div class="bold">${e.yearly && '🎂 '}${e.title}</div>
        <div class="small muted">${[label, years > 0 && `${years}주년`, e.note, `${e.authorName} 등록`].filter(Boolean).join(' · ')}</div>
      </div>
    </button>`;
  };

  return html`<${TopBar} title="가족 일정">
      <button class="icon-btn" onClick=${() => setEditing('new')} aria-label="일정 추가"><${Icon} name="plusSquare" /></button>
    <//>
    <div class="scroll">
      <div class="month-head">
        <button class="icon-btn" onClick=${() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="이전 달"><${Icon} name="left" /></button>
        <h2>${month.getFullYear()}년 ${month.getMonth() + 1}월</h2>
        <button class="link" onClick=${() => { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelected(today); }}>오늘</button>
        <button class="icon-btn" onClick=${() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="다음 달"><${Icon} name="right" /></button>
      </div>
      <div class="weekdays">${WEEK.map((w) => html`<div>${w}</div>`)}</div>
      <div class="days">
        ${cells.map((d) => {
          if (!d) return html`<div></div>`;
          const marks = eventsOn(list, d).slice(0, 3);
          const cls = [
            d.getDay() === 0 && 'sun',
            d.getDay() === 6 && 'sat',
            isoDate(d) === isoDate(today) && 'today',
            isoDate(d) === isoDate(selected) && 'sel',
          ].filter(Boolean).join(' ');
          return html`<button class=${cls} onClick=${() => setSelected(d)}>
            <span>${d.getDate()}</span>
            <div class="marks">${marks.map((e) => html`<i class=${e.yearly ? 'yearly' : ''}></i>`)}</div>
          </button>`;
        })}
      </div>
      <div class="section-title" style="border-top:0.5px solid var(--line);margin-top:8px">${longLabel(selected)}</div>
      ${error && html`<div class="error">${error}</div>`}
      ${events === null && html`<${Spinner} />`}
      ${events && dayEvents.length === 0 && html`<div class="small muted" style="padding:6px 16px">일정이 없어요. 오른쪽 위 + 로 추가하세요.</div>`}
      ${dayEvents.map((e) => html`<${EventRow} e=${e} day=${selected} label=${e.time ?? '하루 종일'} onClick=${() => setEditing(e)} />`)}
      ${upcoming.length > 0 &&
      html`<div class="section-title">다가오는 일정</div>
        ${upcoming.map(
          ([d, e]) => html`<${EventRow}
            e=${e}
            day=${d}
            label=${shortLabel(d)}
            onClick=${() => { setSelected(d); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}
          />`,
        )}`}
      <div style="height:24px"></div>
    </div>
    ${editing &&
    html`<${EventEditor}
      event=${editing === 'new' ? null : editing}
      initialDate=${selected}
      onClose=${() => setEditing(null)}
      onSaved=${(date) => {
        setEditing(null);
        setSelected(date);
        setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
        load();
      }}
    />`}`;
}

function EventEditor({ event, initialDate, onClose, onSaved }) {
  const [title, setTitle] = useState(event?.title ?? '');
  const [date, setDate] = useState(event?.date ?? isoDate(initialDate));
  const [time, setTime] = useState(event?.time ?? '');
  const [note, setNote] = useState(event?.note ?? '');
  const [yearly, setYearly] = useState(event?.yearly ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.saveEvent(event?.id, { title: title.trim(), date, time: time || null, note: note.trim(), yearly });
      onSaved(parseDate(date));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (confirm) {
    return html`<${Confirm}
      title="일정을 삭제할까요?"
      text="가족 모두의 캘린더에서 사라져요."
      onClose=${() => setConfirm(false)}
      onConfirm=${() => api.deleteEvent(event.id).then(() => onSaved(parseDate(event.date))).catch((e) => { setConfirm(false); setError(e.message); })}
    />`;
  }

  return html`<${Dialog}
    title=${event ? '일정 수정' : '일정 추가'}
    onClose=${() => !busy && onClose()}
    actions=${html`${event && html`<button class="link danger" style="margin-right:auto" onClick=${() => setConfirm(true)}>삭제</button>`}
      <button class="link" style="color:var(--fg)" onClick=${onClose}>취소</button>
      <button class="link" disabled=${busy || !title.trim() || !date} onClick=${save}>저장</button>`}
  >
    <input class="field" placeholder="제목 (예: 엄마 생일, 치과)" value=${title} onInput=${(e) => setTitle(e.target.value)} />
    <label>날짜</label>
    <input class="field" type="date" value=${date} onInput=${(e) => setDate(e.target.value)} />
    <label>시간 (비워두면 하루 종일)</label>
    <div class="row">
      <input class="field" type="time" value=${time} onInput=${(e) => setTime(e.target.value)} />
      ${time && html`<button class="link" onClick=${() => setTime('')}>지우기</button>`}
    </div>
    <div class="row" style="margin-top:14px">
      <div class="grow"><div>매년 반복</div><div class="small muted">생일·기념일</div></div>
      <${Toggle} checked=${yearly} onChange=${setYearly} />
    </div>
    <label>메모 (선택)</label>
    <input class="field" value=${note} onInput=${(e) => setNote(e.target.value)} />
    <p class="small muted">전날과 당일 아침 9시에 가족 모두에게 알림이 가요.</p>
    ${error && html`<div class="error" style="padding:0">${error}</div>`}
  <//>`;
}

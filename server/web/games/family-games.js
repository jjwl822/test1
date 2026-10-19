/*
 * 가족 메신저 게임 도우미. 게임 HTML에서 이렇게 불러 쓰세요.
 *   <script src="/games/family-games.js"></script>
 *
 * 가장 쉬운 방법: 시작 화면·끝 화면·가족 순위를 도우미가 그려줍니다.
 *   FamilyGames.setup({ title: '두더지 잡기', emoji: '🐹', howTo: '30초 동안 두더지를 잡아요', onStart: start });
 *   // 게임이 끝나면
 *   FamilyGames.finish(점수, '두더지 15마리를 잡았어요!');
 *
 * 직접 그리고 싶으면:
 *   const me = await FamilyGames.me();                 // 로그인한 가족 { id, displayName, ... }
 *   const result = await FamilyGames.submitScore(42);  // 점수 저장 → { record, leaderboard, recent }
 *   const board = await FamilyGames.leaderboard();     // 가족 순위와 최근 기록
 *   FamilyGames.renderLeaderboard(element, board);     // 순위표 그리기
 *
 * 점수 저장에 실패하면(인터넷이 끊기는 등) 휴대폰에 보관했다가 다음에 게임을 열 때 자동으로 다시 보냅니다.
 */
(function () {
  const gameId = location.pathname.split('/')[2];
  const PENDING_KEY = 'familyGames.pending';
  const MAX_PENDING = 50;

  /** { status, data } from the server, or null when the server can't be reached. */
  async function request(method, path, body) {
    try {
      const res = await fetch(path, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      let data = null;
      try {
        data = await res.json();
      } catch {}
      return { status: res.status, data };
    } catch {
      return null;
    }
  }
  const ok = (r) => r && r.status >= 200 && r.status < 300;

  // Script errors are sent to the server (data/game-errors.log) so a game that breaks on someone's
  // phone can be fixed. At most a few per visit.
  let reported = 0;
  function report(message, where) {
    if (reported++ >= 5 || !gameId) return;
    request('POST', `/api/games/${gameId}/errors`, { message: String(message), where: String(where || '') });
  }
  window.addEventListener('error', (e) => report(e.message, `${(e.filename || '').split('/').slice(-2).join('/')}:${e.lineno}:${e.colno}`));
  window.addEventListener('unhandledrejection', (e) => report(`unhandled: ${e.reason?.message ?? e.reason}`, e.reason?.stack?.split('\n')[1]?.trim()));

  // ---- Scores waiting to be sent -------------------------------------------------------------

  function readPending() {
    try {
      const list = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }
  function writePending(list) {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-MAX_PENDING)));
    } catch {}
  }
  const removePending = (clientId) => writePending(readPending().filter((p) => p.clientId !== clientId));

  function newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Sends one saved score. True when it no longer needs sending. */
  async function send(item) {
    const r = await request('POST', `/api/games/${item.gameId}/scores`, {
      score: item.score,
      clientId: item.clientId,
      playedAt: item.playedAt,
    });
    if (!r) return { done: false };
    // 400/404: the server will never take it (bad score, game removed), so stop trying.
    const done = ok(r) || r.status === 400 || r.status === 404;
    if (done) removePending(item.clientId);
    return { done, result: ok(r) ? r.data : null };
  }

  let flushing = null;
  /** Sends scores left over from earlier games. */
  function flushPending() {
    flushing ??= (async () => {
      for (const item of readPending()) {
        const { done } = await send(item);
        if (!done) break;
      }
    })().finally(() => (flushing = null));
    return flushing;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function submitScore(score) {
    const item = { gameId, score: Number(score), clientId: newId(), playedAt: Date.now() };
    writePending([...readPending(), item]);
    for (const delay of [0, 1000, 3000]) {
      if (delay) await wait(delay);
      const { done, result } = await send(item);
      if (result) {
        flushPending();
        return result;
      }
      if (done) return null;
    }
    return null; // kept in pending; sent next time
  }

  async function leaderboard() {
    await flushPending();
    const r = await request('GET', `/api/games/${gameId}/scores`);
    return ok(r) ? r.data : null;
  }

  // ---- Drawing -------------------------------------------------------------------------------

  const style = document.createElement('style');
  style.textContent = `
    .fg-tabs { display: flex; gap: 6px; margin: 6px 0 8px; }
    .fg-tabs button { flex: 1; border: 0; border-radius: 999px; padding: 7px 0; font-size: 14px; font-weight: 600;
      background: rgba(128,128,128,.15); color: inherit; }
    .fg-tabs button.on { background: #0095f6; color: #fff; }
    .fg-board { list-style: none; margin: 0; padding: 0; text-align: left; }
    .fg-board li { display: flex; gap: 10px; align-items: center; padding: 8px 4px; border-bottom: 1px solid rgba(128,128,128,.2); }
    .fg-board li.me { font-weight: 700; }
    .fg-board .rank { width: 28px; text-align: center; font-size: 18px; flex: none; }
    .fg-board .name { flex: 1; min-width: 0; }
    .fg-board .sub { display: block; font-size: 12px; font-weight: 400; opacity: .6; }
    .fg-board .score { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .fg-board .empty { opacity: .6; justify-content: center; }
    .fg-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,.5); display: none;
      align-items: center; justify-content: center; padding: 16px; }
    .fg-overlay.show { display: flex; }
    .fg-panel { background: var(--bg, #fff); color: var(--fg, #222); border-radius: 18px; padding: 20px; width: 100%;
      max-width: 380px; max-height: calc(100% - 16px); display: flex; flex-direction: column; text-align: center;
      font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
    .fg-panel h2 { margin: 0 0 6px; font-size: 24px; }
    .fg-panel .fg-text { margin: 0 0 10px; opacity: .75; line-height: 1.45; white-space: pre-line; }
    .fg-panel .fg-record { color: #ff3040; font-weight: 800; margin-bottom: 6px; }
    .fg-panel .fg-note { font-size: 12px; opacity: .6; margin-top: 6px; }
    .fg-panel .fg-list { flex: 1; min-height: 80px; overflow: auto; margin-bottom: 14px; }
    .fg-panel .fg-go { background: #0095f6; color: #fff; border: 0; border-radius: 12px; padding: 14px; font-size: 17px;
      font-weight: 800; width: 100%; flex: none; }
    @media (prefers-color-scheme: dark) { .fg-panel { background: var(--bg, #1c1c1e); color: var(--fg, #eee); } }
  `;
  document.head.appendChild(style);

  const fmt = (n) => (Math.round(Number(n) * 100) / 100).toLocaleString('ko-KR');

  function ago(t) {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return '방금';
    if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
    if (s < 172800) return '어제';
    const d = new Date(t);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /** Family ranking: best score, number of plays and last score for each person. */
  function renderLeaderboard(element, data) {
    const rows = data?.leaderboard ?? [];
    const unit = data?.game?.scoreUnit ?? '점';
    const medal = ['🥇', '🥈', '🥉'];
    element.innerHTML = '';
    const list = el('ul', 'fg-board');
    if (!rows.length) list.appendChild(el('li', 'empty', '아직 기록이 없어요. 첫 번째 주인공이 되어 보세요!'));
    for (const r of rows) {
      const li = el('li', r.me ? 'me' : '');
      const name = el('span', 'name', r.me ? `${r.name} (나)` : r.name);
      const sub = [`${r.plays}판`];
      if (r.last !== undefined && r.last !== null) sub.push(`최근 ${fmt(r.last)}${unit}`);
      if (r.lastAt) sub.push(ago(r.lastAt));
      name.appendChild(el('span', 'sub', sub.join(' · ')));
      li.append(el('span', 'rank', medal[r.rank - 1] ?? String(r.rank)), name, el('span', 'score', `${fmt(r.best)}${unit}`));
      list.appendChild(li);
    }
    element.appendChild(list);
  }

  /** The last few games anyone in the family played. */
  function renderRecent(element, data) {
    const rows = data?.recent ?? [];
    const unit = data?.game?.scoreUnit ?? '점';
    element.innerHTML = '';
    const list = el('ul', 'fg-board');
    if (!rows.length) list.appendChild(el('li', 'empty', '아직 기록이 없어요.'));
    for (const r of rows) {
      const li = el('li', r.me ? 'me' : '');
      const name = el('span', 'name', r.me ? `${r.name} (나)` : r.name);
      name.appendChild(el('span', 'sub', ago(r.at)));
      li.append(name, el('span', 'score', `${fmt(r.score)}${unit}`));
      list.appendChild(li);
    }
    element.appendChild(list);
  }

  /** Ranking / recent tabs drawn into [element]. */
  function renderBoard(element, data, tab = 'rank') {
    element.innerHTML = '';
    const tabs = el('div', 'fg-tabs');
    const body = el('div');
    const show = (which) => {
      for (const b of tabs.children) b.classList.toggle('on', b.dataset.tab === which);
      (which === 'rank' ? renderLeaderboard : renderRecent)(body, data);
    };
    for (const [id, label] of [['rank', '🏆 가족 순위'], ['recent', '🕘 최근 기록']]) {
      const b = el('button', '', label);
      b.type = 'button';
      b.dataset.tab = id;
      b.addEventListener('click', () => show(id));
      tabs.appendChild(b);
    }
    element.append(tabs, body);
    show(tab);
  }

  // ---- Start and end screens -----------------------------------------------------------------

  let options = null;
  let overlay = null;

  function panel({ title, text, record, data, loading, note, button, onButton }) {
    if (!overlay) {
      overlay = el('div', 'fg-overlay');
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = '';
    const box = el('div', 'fg-panel');
    box.appendChild(el('h2', '', title));
    if (text) box.appendChild(el('p', 'fg-text', text));
    if (record) box.appendChild(el('div', 'fg-record', '🏆 내 최고 기록!'));
    const list = el('div', 'fg-list');
    if (loading) list.appendChild(el('ul', 'fg-board')).appendChild(el('li', 'empty', '기록 불러오는 중…'));
    else if (data) renderBoard(list, data);
    else list.appendChild(el('ul', 'fg-board')).appendChild(el('li', 'empty', '기록을 불러올 수 없어요.'));
    box.appendChild(list);
    const go = el('button', 'fg-go', button);
    go.type = 'button';
    go.addEventListener('click', onButton);
    box.appendChild(go);
    if (note) box.appendChild(el('div', 'fg-note', note));
    overlay.appendChild(box);
    overlay.classList.add('show');
    return list;
  }

  function begin() {
    overlay?.classList.remove('show');
    options.onStart();
  }

  async function showStart() {
    const props = {
      title: `${options.emoji ?? '🎮'} ${options.title ?? ''}`.trim(),
      text: options.howTo,
      button: options.startLabel ?? '시작!',
      onButton: begin,
    };
    panel({ ...props, loading: true });
    const data = await leaderboard();
    if (overlay.classList.contains('show') && !running) panel({ ...props, data });
  }

  let running = false;

  /** Shows the start screen (how to play + family records). onStart runs when 시작 is tapped. */
  function setup(opts) {
    options = opts;
    const start = opts.onStart;
    options.onStart = () => {
      running = true;
      start();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showStart);
    else showStart();
  }

  /** Saves the score and shows the end screen with the family records. */
  async function finish(score, summary) {
    running = false;
    const props = { title: '🎉 끝!', text: summary, button: '한 번 더', onButton: begin };
    panel({ ...props, loading: true });
    const result = await submitScore(score);
    if (running) return; // already playing again
    if (result) {
      panel({ ...props, record: result.record, data: result });
    } else {
      const data = await leaderboard();
      if (running) return;
      panel({ ...props, data, note: '지금은 기록을 저장하지 못했어요. 다음에 게임을 열면 자동으로 저장돼요.' });
    }
  }

  window.FamilyGames = {
    gameId,
    me: async () => {
      const r = await request('GET', '/api/me');
      return ok(r) ? r.data : null;
    },
    submitScore,
    leaderboard,
    flushPending,
    renderLeaderboard,
    renderRecent,
    renderBoard,
    setup,
    finish,
    fmt,
    ago,
  };

  flushPending();
})();

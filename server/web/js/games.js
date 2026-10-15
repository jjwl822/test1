import { useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { api } from './api.js';
import { go, html, Icon, Spinner, TopBar } from './ui.js';

/** Games tab: the list comes from games.json on the server, so new games appear without an update. */
export function GamesScreen() {
  const [games, setGames] = useState(null);
  const [error, setError] = useState(null);
  const load = () => api.games().then((g) => { setGames(g); setError(null); }).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  return html`<${TopBar} title="가족 게임">
      <button class="icon-btn" onClick=${load} aria-label="새로고침"><${Icon} name="refresh" /></button>
    <//>
    <div class="scroll">
      ${error && html`<div class="error">${error}</div>`}
      ${games === null && !error && html`<${Spinner} />`}
      ${games?.length === 0 && html`<div class="empty">아직 게임이 없어요.<br />서버의 web/games 폴더에 게임을 넣어 주세요.</div>`}
      <div class="games">
        ${games?.map(
          (g) => html`<button class="game" onClick=${() => go(`/game/${g.id}`)}>
            <span class="emoji">${g.emoji}</span>
            <div class="grow">
              <div class="bold">${g.title}</div>
              <div class="small muted">${g.description}</div>
            </div>
            <${Icon} name="right" size="sm" />
          </button>`,
        )}
      </div>
    </div>`;
}

/** Plays one game full screen. */
export function GamePlayer({ id, onBack }) {
  const [game, setGame] = useState(null);
  const [error, setError] = useState(null);
  const frame = useRef(null);
  useEffect(() => {
    api
      .games()
      .then((list) => {
        const found = list.find((g) => g.id === id);
        if (found) setGame(found);
        else setError('게임을 찾을 수 없어요.');
      })
      .catch((e) => setError(e.message));
  }, [id]);
  return html`<div class="screen">
    <${TopBar} title=${game ? `${game.emoji} ${game.title}` : '게임'} small onBack=${onBack}>
      <button class="icon-btn" onClick=${() => frame.current?.contentWindow?.location.reload()} aria-label="다시 시작">
        <${Icon} name="refresh" />
      </button>
    <//>
    ${error && html`<div class="error">${error}</div>`}
    ${!game && !error && html`<${Spinner} />`}
    ${game && html`<iframe class="game-frame" ref=${frame} src=${game.url} title=${game.title} allow="autoplay; fullscreen; vibrate"></iframe>`}
  </div>`;
}

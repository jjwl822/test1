/*
 * 가족 메신저 게임 도우미 — 게임 HTML에서 이렇게 불러 쓰세요:
 *   <script src="/games/family-games.js"></script>
 *
 *   const me = await FamilyGames.me();                 // { id, displayName, ... } 로그인한 가족
 *   const result = await FamilyGames.submitScore(42);  // 점수 저장 → { record, leaderboard }
 *   const board = await FamilyGames.leaderboard();     // 가족 순위
 *   FamilyGames.renderLeaderboard(element, board);     // 순위표를 element 안에 그리기
 *
 * 게임 id는 폴더 이름입니다 (/games/<id>/index.html). 로그인하지 않았거나 서버에 닿지 않으면
 * 점수 관련 함수는 null을 돌려주고, 게임은 그냥 계속할 수 있습니다.
 */
(function () {
  const gameId = location.pathname.split('/')[2];

  async function request(method, path, body) {
    try {
      const res = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  const style = document.createElement('style');
  style.textContent = `
    .fg-board { list-style: none; margin: 0; padding: 0; text-align: left; }
    .fg-board li { display: flex; gap: 10px; align-items: center; padding: 8px 4px; border-bottom: 1px solid rgba(128,128,128,.2); }
    .fg-board li.me { font-weight: 700; }
    .fg-board .rank { width: 28px; text-align: center; font-size: 18px; }
    .fg-board .name { flex: 1; }
    .fg-board .empty { color: #888; justify-content: center; }
  `;
  document.head.appendChild(style);

  window.FamilyGames = {
    gameId,
    me: () => request('GET', '/api/me'),
    submitScore: (score) => request('POST', `/api/games/${gameId}/scores`, { score }),
    leaderboard: () => request('GET', `/api/games/${gameId}/scores`),

    /** Draws a family ranking into [element] from submitScore()/leaderboard() results. */
    renderLeaderboard(element, data) {
      const rows = data?.leaderboard ?? [];
      const unit = data?.game?.scoreUnit ?? '점';
      const medal = ['🥇', '🥈', '🥉'];
      element.innerHTML = '';
      const list = document.createElement('ul');
      list.className = 'fg-board';
      if (!rows.length) {
        list.innerHTML = '<li class="empty">아직 기록이 없어요. 첫 번째 주인공이 되어 보세요!</li>';
      }
      for (const r of rows) {
        const li = document.createElement('li');
        if (r.me) li.className = 'me';
        const rank = document.createElement('span');
        rank.className = 'rank';
        rank.textContent = medal[r.rank - 1] ?? String(r.rank);
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = r.me ? `${r.name} (나)` : r.name;
        const best = document.createElement('span');
        best.textContent = `${Math.round(r.best * 10) / 10}${unit}`;
        li.append(rank, name, best);
        list.appendChild(li);
      }
      element.appendChild(list);
    },
  };
})();

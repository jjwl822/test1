import fs from 'node:fs';
import path from 'node:path';

const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/**
 * Games are plain HTML files in web/games/<id>/, listed in web/games/games.json. The list is read
 * on every request, so adding or editing a game needs no app update and no server restart.
 * Scores are kept per game for a family leaderboard.
 */
export function registerGameRoutes(app, { db, auth, gamesDir }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_scores (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      game       TEXT NOT NULL,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score      REAL NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_game_scores ON game_scores(game, user_id);
  `);

  function readGames() {
    let list;
    try {
      list = JSON.parse(fs.readFileSync(path.join(gamesDir, 'games.json'), 'utf8'));
    } catch (err) {
      console.warn('games.json을 읽을 수 없습니다:', err.message);
      return [];
    }
    if (!Array.isArray(list)) return [];
    return list
      .filter((g) => g && ID.test(g.id) && typeof g.title === 'string')
      .filter((g) => fs.existsSync(path.join(gamesDir, g.id, 'index.html')))
      .map((g) => ({
        id: g.id,
        title: g.title,
        emoji: typeof g.emoji === 'string' ? g.emoji : '🎮',
        description: typeof g.description === 'string' ? g.description : '',
        url: `/games/${g.id}/index.html`,
        // "high": bigger is better (points), "low": smaller is better (moves, seconds)
        scoreOrder: g.scoreOrder === 'low' ? 'low' : 'high',
        scoreUnit: typeof g.scoreUnit === 'string' ? g.scoreUnit : '점',
      }));
  }

  const findGame = (id) => readGames().find((g) => g.id === id);

  function leaderboard(game, me) {
    const best = game.scoreOrder === 'low' ? 'MIN' : 'MAX';
    const rows = db
      .prepare(
        `SELECT s.user_id, u.display_name, ${best}(s.score) AS best, COUNT(*) AS plays
         FROM game_scores s JOIN users u ON u.id = s.user_id
         WHERE s.game = ? GROUP BY s.user_id
         ORDER BY best ${game.scoreOrder === 'low' ? 'ASC' : 'DESC'} LIMIT 20`,
      )
      .all(game.id);
    return rows.map((r, i) => ({
      rank: i + 1,
      userId: r.user_id,
      name: r.display_name,
      best: r.best,
      plays: r.plays,
      me: r.user_id === me,
    }));
  }

  app.get('/api/games', auth, (_req, res) => res.json(readGames()));

  app.get('/api/games/:id/scores', auth, (req, res) => {
    const game = findGame(req.params.id);
    if (!game) return res.status(404).json({ error: '게임을 찾을 수 없습니다.' });
    res.json({ game, leaderboard: leaderboard(game, req.user.id) });
  });

  app.post('/api/games/:id/scores', auth, (req, res) => {
    const game = findGame(req.params.id);
    if (!game) return res.status(404).json({ error: '게임을 찾을 수 없습니다.' });
    const score = Number(req.body?.score);
    if (!Number.isFinite(score) || Math.abs(score) > 1e9) return res.status(400).json({ error: '점수가 올바르지 않습니다.' });
    const better = game.scoreOrder === 'low' ? 'MIN' : 'MAX';
    const previous = db
      .prepare(`SELECT ${better}(score) AS best FROM game_scores WHERE game = ? AND user_id = ?`)
      .get(game.id, req.user.id).best;
    db.prepare('INSERT INTO game_scores (game, user_id, score, created_at) VALUES (?, ?, ?, ?)').run(
      game.id,
      req.user.id,
      score,
      Date.now(),
    );
    const record = previous === null || (game.scoreOrder === 'low' ? score < previous : score > previous);
    res.status(201).json({ score, record, game, leaderboard: leaderboard(game, req.user.id) });
  });
}

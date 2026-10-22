import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;
const RECENT = 10;
// Scores saved on the phone while offline are sent later with the time they were played.
const MAX_DELAY = 30 * 24 * 60 * 60 * 1000;

/**
 * Games are plain HTML files in web/games/<id>/, listed in web/games/games.json. The list is read
 * on every request, so adding or editing a game needs no app update and no server restart.
 * Scores are kept per game for a family leaderboard.
 */
export function registerGameRoutes(app, { db, auth, gamesDir, errorLog, now = Date.now }) {
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
  const columns = db.prepare('PRAGMA table_info(game_scores)').all().map((c) => c.name);
  // client_id lets a phone resend a score after a dropped connection without counting it twice.
  if (!columns.includes('client_id')) db.exec('ALTER TABLE game_scores ADD COLUMN client_id TEXT');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_game_scores_client ON game_scores(user_id, client_id) WHERE client_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_game_scores_recent ON game_scores(game, created_at);
    CREATE TABLE IF NOT EXISTS game_saves (
      game       TEXT NOT NULL,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      data       TEXT NOT NULL,
      saved_at   INTEGER NOT NULL,
      PRIMARY KEY (game, user_id)
    );
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
        // false for pages in the list that aren't scored games (the records board)
        scores: g.scores !== false,
      }));
  }

  const findGame = (id) => readGames().find((g) => g.id === id && g.scores);

  function leaderboard(game, me) {
    const best = game.scoreOrder === 'low' ? 'MIN' : 'MAX';
    const rows = db
      .prepare(
        `SELECT s.user_id, u.display_name, ${best}(s.score) AS best, COUNT(*) AS plays, MAX(s.created_at) AS last_at,
           (SELECT l.score FROM game_scores l WHERE l.game = s.game AND l.user_id = s.user_id
            ORDER BY l.created_at DESC, l.id DESC LIMIT 1) AS last
         FROM game_scores s JOIN users u ON u.id = s.user_id
         WHERE s.game = ? GROUP BY s.user_id
         ORDER BY best ${game.scoreOrder === 'low' ? 'ASC' : 'DESC'}, last_at ASC LIMIT 20`,
      )
      .all(game.id);
    return rows.map((r, i) => ({
      rank: i + 1,
      userId: r.user_id,
      name: r.display_name,
      best: r.best,
      plays: r.plays,
      last: r.last,
      lastAt: r.last_at,
      me: r.user_id === me,
    }));
  }

  function recent(game, me) {
    return db
      .prepare(
        `SELECT s.user_id, u.display_name, s.score, s.created_at FROM game_scores s JOIN users u ON u.id = s.user_id
         WHERE s.game = ? ORDER BY s.created_at DESC, s.id DESC LIMIT ${RECENT}`,
      )
      .all(game.id)
      .map((r) => ({ userId: r.user_id, name: r.display_name, score: r.score, at: r.created_at, me: r.user_id === me }));
  }

  const board = (game, me) => ({ game, leaderboard: leaderboard(game, me), recent: recent(game, me) });

  app.get('/api/games', auth, (_req, res) => res.json(readGames()));

  // Every game's rankings in one go, for the records board.
  app.get('/api/games/records', auth, (req, res) => {
    res.json(readGames().filter((g) => g.scores).map((g) => board(g, req.user.id)));
  });

  app.get('/api/games/:id/scores', auth, (req, res) => {
    const game = findGame(req.params.id);
    if (!game) return res.status(404).json({ error: '게임을 찾을 수 없습니다.' });
    res.json(board(game, req.user.id));
  });

  // Saved games are backed up per person, so progress survives reinstalling the app or a new phone,
  // and carries over between the app and the browser. savedAt is when the phone saved it; the
  // game keeps whichever copy is newer.
  app.get('/api/games/:id/save', auth, (req, res) => {
    if (!ID.test(req.params.id)) return res.status(404).json({ error: '게임을 찾을 수 없습니다.' });
    const row = db.prepare('SELECT data, saved_at FROM game_saves WHERE game = ? AND user_id = ?').get(req.params.id, req.user.id);
    res.json(row ? { data: row.data, savedAt: row.saved_at } : { data: null, savedAt: 0 });
  });

  app.put('/api/games/:id/save', auth, express.text({ type: 'text/plain', limit: '2mb' }), (req, res) => {
    if (!ID.test(req.params.id) || !readGames().some((g) => g.id === req.params.id)) {
      return res.status(404).json({ error: '게임을 찾을 수 없습니다.' });
    }
    const data = typeof req.body === 'string' ? req.body : '';
    const savedAt = Math.min(Number(req.query.at) || now(), now());
    if (!data) return res.status(400).json({ error: '저장할 내용이 없습니다.' });
    // An older save arriving late (from another phone) never replaces a newer one.
    db.prepare(
      `INSERT INTO game_saves (game, user_id, data, saved_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (game, user_id) DO UPDATE SET data = excluded.data, saved_at = excluded.saved_at
       WHERE excluded.saved_at >= game_saves.saved_at`,
    ).run(req.params.id, req.user.id, data, savedAt);
    res.status(204).end();
  });

  // Script errors from games on family phones, so a game that breaks on one phone can be fixed.
  app.post('/api/games/:id/errors', auth, (req, res) => {
    res.status(204).end();
    if (!errorLog || !ID.test(req.params.id)) return;
    const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
    try {
      if (fs.existsSync(errorLog) && fs.statSync(errorLog).size > 1_000_000) return;
      const line = {
        at: new Date(now()).toISOString(),
        user: req.user.display_name ?? req.user.displayName ?? req.user.id,
        game: req.params.id,
        message: text(req.body?.message, 500),
        where: text(req.body?.where, 200),
        ua: text(req.headers['user-agent'], 200),
      };
      fs.appendFileSync(errorLog, `${JSON.stringify(line)}\n`);
    } catch (err) {
      console.warn('게임 오류 기록 실패:', err.message);
    }
  });

  app.post('/api/games/:id/scores', auth, (req, res) => {
    const game = findGame(req.params.id);
    if (!game) return res.status(404).json({ error: '게임을 찾을 수 없습니다.' });
    const score = Number(req.body?.score);
    if (!Number.isFinite(score) || Math.abs(score) > 1e9) return res.status(400).json({ error: '점수가 올바르지 않습니다.' });
    const clientId = typeof req.body?.clientId === 'string' && CLIENT_ID.test(req.body.clientId) ? req.body.clientId : null;
    if (clientId) {
      const saved = db.prepare('SELECT id FROM game_scores WHERE user_id = ? AND client_id = ?').get(req.user.id, clientId);
      if (saved) return res.json({ score, record: false, duplicate: true, ...board(game, req.user.id) });
    }
    const t = now();
    const playedAt = Number(req.body?.playedAt);
    const createdAt = Number.isFinite(playedAt) && playedAt <= t && playedAt > t - MAX_DELAY ? Math.round(playedAt) : t;
    const better = game.scoreOrder === 'low' ? 'MIN' : 'MAX';
    const previous = db
      .prepare(`SELECT ${better}(score) AS best FROM game_scores WHERE game = ? AND user_id = ?`)
      .get(game.id, req.user.id).best;
    db.prepare('INSERT INTO game_scores (game, user_id, score, created_at, client_id) VALUES (?, ?, ?, ?, ?)').run(
      game.id,
      req.user.id,
      score,
      createdAt,
      clientId,
    );
    const record = previous === null || (game.scoreOrder === 'low' ? score < previous : score > previous);
    res.status(201).json({ score, record, ...board(game, req.user.id) });
  });
}

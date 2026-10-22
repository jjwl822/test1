import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

// Audio formats phones and browsers can decode; anything else is refused so the folder only
// ever serves sound files.
const AUDIO_TYPES = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
};
const FILE_NAME = /^[a-f0-9]{32}\.(mp3|m4a|aac|wav|ogg|webm|flac)$/;
export const MAX_TITLE = 40;
export const LEVELS = 5;

/**
 * Songs the family uploads for the NEON THUMB rhythm game: an audio file plus a title and a
 * difficulty (1-5) the uploader picks. Everyone in the family can play them; only the uploader
 * can rename, change the difficulty, or delete.
 */
export function registerSongRoutes(app, { db, auth, dataDir, now = Date.now }) {
  const songDir = path.join(dataDir, 'songs');
  fs.mkdirSync(songDir, { recursive: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_songs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      game         TEXT NOT NULL,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      level        INTEGER NOT NULL,
      file         TEXT NOT NULL,
      content_type TEXT NOT NULL,
      created_at   INTEGER NOT NULL
    );
  `);

  const GAME = 'neon';
  const toSong = (r, me) => ({
    id: r.id,
    title: r.title,
    level: r.level,
    uploaderId: r.user_id,
    uploaderName: r.display_name,
    createdAt: r.created_at,
    url: `/api/games/${GAME}/songs/${r.id}/audio`,
    mine: r.user_id === me,
  });
  const select = `SELECT s.*, u.display_name FROM game_songs s JOIN users u ON u.id = s.user_id WHERE s.game = '${GAME}'`;
  const find = (id) => db.prepare(`${select} AND s.id = ?`).get(Number(id));

  function readTitle(value) {
    const title = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
    if (!title) return { error: '제목을 입력하세요.' };
    if (title.length > MAX_TITLE) return { error: `제목은 ${MAX_TITLE}자까지예요.` };
    return { title };
  }
  function readLevel(value) {
    const level = Number(value);
    if (!Number.isInteger(level) || level < 1 || level > LEVELS) return { error: `난이도는 1~${LEVELS} 중에서 골라 주세요.` };
    return { level };
  }

  app.get(`/api/games/${GAME}/songs`, auth, (req, res) => {
    res.json(db.prepare(`${select} ORDER BY s.level, s.created_at`).all().map((r) => toSong(r, req.user.id)));
  });

  // The file is the request body; title and level ride in the query string.
  app.post(
    `/api/games/${GAME}/songs`,
    auth,
    express.raw({ type: Object.keys(AUDIO_TYPES), limit: '40mb' }),
    (req, res) => {
      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const ext = AUDIO_TYPES[type];
      if (!ext || !Buffer.isBuffer(req.body)) return res.status(415).json({ error: 'mp3, m4a, wav 같은 음악 파일만 올릴 수 있어요.' });
      if (req.body.length < 1000) return res.status(400).json({ error: '파일이 비어 있어요.' });
      const t = readTitle(req.query.title);
      if (t.error) return res.status(400).json({ error: t.error });
      const l = readLevel(req.query.level);
      if (l.error) return res.status(400).json({ error: l.error });
      const file = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(songDir, file), req.body);
      const { lastInsertRowid } = db
        .prepare('INSERT INTO game_songs (game, user_id, title, level, file, content_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(GAME, req.user.id, t.title, l.level, file, type, now());
      res.status(201).json(toSong(find(lastInsertRowid), req.user.id));
    },
  );

  app.patch(`/api/games/${GAME}/songs/:id`, auth, (req, res) => {
    const song = find(req.params.id);
    if (!song) return res.status(404).json({ error: '곡을 찾을 수 없어요.' });
    if (song.user_id !== req.user.id) return res.status(403).json({ error: '올린 사람만 바꿀 수 있어요.' });
    const t = req.body?.title === undefined ? { title: song.title } : readTitle(req.body.title);
    if (t.error) return res.status(400).json({ error: t.error });
    const l = req.body?.level === undefined ? { level: song.level } : readLevel(req.body.level);
    if (l.error) return res.status(400).json({ error: l.error });
    db.prepare('UPDATE game_songs SET title = ?, level = ? WHERE id = ?').run(t.title, l.level, song.id);
    res.json(toSong(find(song.id), req.user.id));
  });

  app.delete(`/api/games/${GAME}/songs/:id`, auth, (req, res) => {
    const song = find(req.params.id);
    if (!song) return res.status(404).json({ error: '곡을 찾을 수 없어요.' });
    if (song.user_id !== req.user.id) return res.status(403).json({ error: '올린 사람만 지울 수 있어요.' });
    db.prepare('DELETE FROM game_songs WHERE id = ?').run(song.id);
    if (FILE_NAME.test(song.file)) fs.rmSync(path.join(songDir, song.file), { force: true });
    res.status(204).end();
  });

  app.get(`/api/games/${GAME}/songs/:id/audio`, auth, (req, res) => {
    const song = find(req.params.id);
    if (!song || !FILE_NAME.test(song.file)) return res.status(404).end();
    // The file never changes under the same id, so the phone may keep it.
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.set('X-Content-Type-Options', 'nosniff');
    res.type(song.content_type);
    res.sendFile(path.join(songDir, song.file));
  });
}

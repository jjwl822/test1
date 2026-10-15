import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

const MAX_POST_TEXT = 2000;
const MAX_COMMENT_TEXT = 500;
export const MAX_MEDIA = 10;
const ORPHAN_AGE = 24 * 60 * 60 * 1000;
export const REACTIONS = ['heart', 'like', 'dislike'];

/**
 * The family story feed: one shared board everyone sees, with photo + text posts,
 * comments and heart / like / dislike reactions.
 */
export function registerFeedRoutes(app, { db, auth, broadcastAll, saveFile, uploadDir, mediaTypes }) {
  const mediaUrl = (name) => (name ? `/api/media/${name}` : null);
  const postMedia = db.prepare(
    'SELECT name, kind, poster FROM media WHERE post_id = ? AND position IS NOT NULL ORDER BY position',
  );
  const removeFiles = (names) => {
    for (const name of names) fs.rmSync(path.join(uploadDir, name), { force: true });
  };
  const POST_SELECT = `
    SELECT p.*, u.display_name AS author_name,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
    FROM posts p JOIN users u ON u.id = p.author_id`;

  const reactionCounts = db.prepare('SELECT kind, COUNT(*) AS n FROM reactions WHERE post_id = ? GROUP BY kind');
  const myReactions = db.prepare('SELECT kind FROM reactions WHERE post_id = ? AND user_id = ?');

  function toPost(row, viewerId) {
    const counts = { heart: 0, like: 0, dislike: 0 };
    for (const r of reactionCounts.all(row.id)) counts[r.kind] = r.n;
    return {
      id: row.id,
      authorId: row.author_id,
      authorName: row.author_name,
      text: row.text,
      media: postMedia.all(row.id).map((m) => ({ url: mediaUrl(m.name), kind: m.kind, posterUrl: mediaUrl(m.poster) })),
      createdAt: row.created_at,
      commentCount: row.comment_count,
      reactions: counts,
      myReactions: myReactions.all(row.id, viewerId).map((r) => r.kind),
    };
  }

  function toComment(row) {
    return {
      id: row.id,
      postId: row.post_id,
      authorId: row.author_id,
      authorName: row.author_name,
      text: row.text,
      createdAt: row.created_at,
    };
  }

  function findPost(id, viewerId) {
    const row = db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(Number(id) || 0);
    return row ? toPost(row, viewerId) : null;
  }

  function requirePost(req, res, next) {
    const post = findPost(req.params.id, req.user.id);
    if (!post) return res.status(404).json({ error: '게시물을 찾을 수 없습니다.' });
    req.post = post;
    next();
  }

  /** Tells every app a post changed, so they refetch it with their own reaction state. */
  const changed = (postId) => broadcastAll({ type: 'feed', postId });

  app.get('/api/posts', auth, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
    const rows = db.prepare(`${POST_SELECT} WHERE p.id < ? ORDER BY p.id DESC LIMIT ?`).all(before, limit);
    res.json(rows.map((r) => toPost(r, req.user.id)));
  });

  app.get('/api/posts/:id', auth, requirePost, (req, res) => res.json(req.post));

  // Step 1: upload each photo or video (and each video's poster frame) as a raw body.
  app.post('/api/media', auth, express.raw({ type: mediaTypes, limit: '100mb' }), (req, res) => {
    const contentType = req.get('content-type') ?? '';
    const name = Buffer.isBuffer(req.body) && req.body.length > 0 ? saveFile(req.body, contentType) : null;
    if (!name) return res.status(400).json({ error: '지원하지 않는 파일 형식입니다.' });
    const kind = contentType.startsWith('video/') ? 'video' : 'image';
    db.prepare('INSERT INTO media (name, uploader_id, kind, created_at) VALUES (?, ?, ?, ?)').run(
      name,
      req.user.id,
      kind,
      Date.now(),
    );
    res.status(201).json({ name, kind });
  });

  // Step 2: create the post. Body: { text, media: [{ name, poster? }] } using names from step 1.
  app.post('/api/posts', auth, (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const items = Array.isArray(req.body?.media) ? req.body.media : [];
    if (text.length > MAX_POST_TEXT) return res.status(400).json({ error: '글이 너무 깁니다.' });
    if (!text && items.length === 0) return res.status(400).json({ error: '사진이나 글을 입력하세요.' });
    if (items.length > MAX_MEDIA) return res.status(400).json({ error: `사진과 동영상은 ${MAX_MEDIA}개까지 올릴 수 있습니다.` });

    const upload = db.prepare('SELECT * FROM media WHERE name = ? AND uploader_id = ? AND post_id IS NULL');
    const seen = new Set();
    const usable = (name, kind) => {
      if (typeof name !== 'string' || seen.has(name)) return false;
      const row = upload.get(name, req.user.id);
      if (!row || (kind && row.kind !== kind)) return false;
      seen.add(name);
      return row;
    };
    const resolved = [];
    for (const item of items) {
      const row = usable(item?.name);
      const poster = item?.poster == null ? null : usable(item.poster, 'image');
      if (!row || poster === false || (poster && row.kind !== 'video')) {
        return res.status(400).json({ error: '업로드한 파일을 찾을 수 없습니다. 다시 시도하세요.' });
      }
      resolved.push({ name: row.name, poster: poster ? poster.name : null });
    }

    const attach = db.prepare('UPDATE media SET post_id = ?, position = ?, poster = ? WHERE name = ?');
    db.exec('BEGIN');
    let postId;
    try {
      postId = db
        .prepare('INSERT INTO posts (author_id, text, created_at) VALUES (?, ?, ?)')
        .run(req.user.id, text, Date.now()).lastInsertRowid;
      resolved.forEach((m, i) => {
        attach.run(postId, i, m.poster, m.name);
        if (m.poster) attach.run(postId, null, null, m.poster);
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    const post = findPost(postId, req.user.id);
    broadcastAll({ type: 'post', postId: post.id, authorId: req.user.id, authorName: req.user.displayName });
    res.status(201).json(post);
  });

  app.delete('/api/posts/:id', auth, requirePost, (req, res) => {
    if (req.post.authorId !== req.user.id) return res.status(403).json({ error: '내가 올린 글만 지울 수 있습니다.' });
    const files = db.prepare('SELECT name FROM media WHERE post_id = ?').all(req.post.id).map((r) => r.name);
    db.prepare('DELETE FROM posts WHERE id = ?').run(req.post.id);
    removeFiles(files);
    changed(req.post.id);
    res.json({ ok: true });
  });

  // Toggles one reaction. Like and dislike cancel each other; heart is independent.
  app.post('/api/posts/:id/reactions', auth, requirePost, (req, res) => {
    const kind = req.body?.kind;
    if (!REACTIONS.includes(kind)) return res.status(400).json({ error: '잘못된 반응입니다.' });
    const postId = req.post.id;
    const userId = req.user.id;
    if (req.post.myReactions.includes(kind)) {
      db.prepare('DELETE FROM reactions WHERE post_id = ? AND user_id = ? AND kind = ?').run(postId, userId, kind);
    } else {
      db.prepare('INSERT INTO reactions (post_id, user_id, kind) VALUES (?, ?, ?)').run(postId, userId, kind);
      const opposite = { like: 'dislike', dislike: 'like' }[kind];
      if (opposite) {
        db.prepare('DELETE FROM reactions WHERE post_id = ? AND user_id = ? AND kind = ?').run(postId, userId, opposite);
      }
    }
    changed(postId);
    res.json(findPost(postId, userId));
  });

  app.get('/api/posts/:id/comments', auth, requirePost, (req, res) => {
    const rows = db
      .prepare(
        `SELECT c.*, u.display_name AS author_name FROM comments c JOIN users u ON u.id = c.author_id
         WHERE c.post_id = ? ORDER BY c.id`,
      )
      .all(req.post.id);
    res.json(rows.map(toComment));
  });

  app.post('/api/posts/:id/comments', auth, requirePost, (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) return res.status(400).json({ error: '댓글을 입력하세요.' });
    if (text.length > MAX_COMMENT_TEXT) return res.status(400).json({ error: '댓글이 너무 깁니다.' });
    const { lastInsertRowid } = db
      .prepare('INSERT INTO comments (post_id, author_id, text, created_at) VALUES (?, ?, ?, ?)')
      .run(req.post.id, req.user.id, text, Date.now());
    const comment = toComment(
      db
        .prepare('SELECT c.*, u.display_name AS author_name FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?')
        .get(lastInsertRowid),
    );
    broadcastAll({ type: 'comment', postId: req.post.id, postAuthorId: req.post.authorId, comment });
    res.status(201).json(comment);
  });

  app.delete('/api/comments/:id', auth, (req, res) => {
    const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(req.params.id) || 0);
    if (!row) return res.status(404).json({ error: '댓글을 찾을 수 없습니다.' });
    if (row.author_id !== req.user.id) return res.status(403).json({ error: '내가 쓴 댓글만 지울 수 있습니다.' });
    db.prepare('DELETE FROM comments WHERE id = ?').run(row.id);
    changed(row.post_id);
    res.json({ ok: true });
  });

  // Uploads that were never attached to a post (e.g. the app closed mid-upload) are removed after a day.
  function cleanup() {
    const cutoff = Date.now() - ORPHAN_AGE;
    const stale = db.prepare('SELECT name FROM media WHERE post_id IS NULL AND created_at < ?').all(cutoff);
    db.prepare('DELETE FROM media WHERE post_id IS NULL AND created_at < ?').run(cutoff);
    removeFiles(stale.map((r) => r.name));
  }
  cleanup();
  const timer = setInterval(cleanup, 60 * 60 * 1000);
  timer.unref();
  app.locals.stopCleanup = () => clearInterval(timer);
}

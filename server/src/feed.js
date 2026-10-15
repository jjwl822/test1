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
export function registerFeedRoutes(app, { db, auth, broadcastAll, saveFile, uploadDir, mediaTypes, now, notify }) {
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
      media: postMedia
        .all(row.id)
        .map((m) => ({ name: m.name, url: mediaUrl(m.name), kind: m.kind, posterUrl: mediaUrl(m.poster) })),
      createdAt: row.created_at,
      editedAt: row.edited_at ?? null,
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

  // "1년 전 오늘": posts from this month and day in earlier years, newest first.
  app.get('/api/memories', auth, (req, res) => {
    const today = now();
    const monthDay = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const rows = db
      .prepare(
        `${POST_SELECT}
         WHERE strftime('%m-%d', p.created_at / 1000, 'unixepoch', 'localtime') = ?
           AND strftime('%Y', p.created_at / 1000, 'unixepoch', 'localtime') < ?
         ORDER BY p.id DESC`,
      )
      .all(monthDay, String(today.getFullYear()));
    res.json(rows.map((r) => toPost(r, req.user.id)));
  });

  // Counts for the top of the story grid.
  app.get('/api/feed/summary', auth, (_req, res) => {
    const posts = db.prepare('SELECT COUNT(*) AS n FROM posts').get().n;
    const members = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    res.json({ posts, members });
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

  const upload = db.prepare('SELECT * FROM media WHERE name = ? AND uploader_id = ? AND post_id IS NULL');
  const ownMedia = db.prepare('SELECT * FROM media WHERE name = ? AND post_id = ? AND position IS NOT NULL');
  const attach = db.prepare('UPDATE media SET post_id = ?, position = ?, poster = ? WHERE name = ?');

  /**
   * Validates a post body { text, media: [{ name, poster? }] }. Each item is either a fresh upload
   * of mine (step 1) or, when editing, an item already in this post. Returns { error } or the parts.
   */
  function parsePost(body, userId, postId = null) {
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const items = Array.isArray(body?.media) ? body.media : [];
    if (text.length > MAX_POST_TEXT) return { error: '글이 너무 깁니다.' };
    if (!text && items.length === 0) return { error: '사진이나 글을 입력하세요.' };
    if (items.length > MAX_MEDIA) return { error: `사진과 동영상은 ${MAX_MEDIA}개까지 올릴 수 있습니다.` };

    const seen = new Set();
    const fresh = (name, kind) => {
      if (typeof name !== 'string' || seen.has(name)) return false;
      const row = upload.get(name, userId);
      if (!row || (kind && row.kind !== kind)) return false;
      seen.add(name);
      return row;
    };
    const media = [];
    for (const item of items) {
      const kept = postId !== null && typeof item?.name === 'string' && !seen.has(item.name) && ownMedia.get(item.name, postId);
      if (kept) {
        seen.add(kept.name);
        media.push({ name: kept.name, existing: true });
        continue;
      }
      const row = fresh(item?.name);
      const poster = item?.poster == null ? null : fresh(item.poster, 'image');
      if (!row || poster === false || (poster && row.kind !== 'video')) {
        return { error: '업로드한 파일을 찾을 수 없습니다. 다시 시도하세요.' };
      }
      media.push({ name: row.name, poster: poster ? poster.name : null, existing: false });
    }
    return { text, media };
  }

  function transaction(fn) {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Puts the post's media in the given order, attaching fresh uploads with their poster frames. */
  function placeMedia(postId, media) {
    media.forEach((m, i) => {
      if (m.existing) {
        db.prepare('UPDATE media SET position = ? WHERE name = ?').run(i, m.name);
      } else {
        attach.run(postId, i, m.poster, m.name);
        if (m.poster) attach.run(postId, null, null, m.poster);
      }
    });
  }

  // Step 2: create the post. Body: { text, media: [{ name, poster? }] } using names from step 1.
  app.post('/api/posts', auth, (req, res) => {
    const parsed = parsePost(req.body, req.user.id);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const postId = transaction(() => {
      const id = db
        .prepare('INSERT INTO posts (author_id, text, created_at) VALUES (?, ?, ?)')
        .run(req.user.id, parsed.text, Date.now()).lastInsertRowid;
      placeMedia(id, parsed.media);
      return id;
    });
    const post = findPost(postId, req.user.id);
    broadcastAll({ type: 'post', postId: post.id, authorId: req.user.id, authorName: req.user.displayName });
    const everyone = db.prepare('SELECT id FROM users WHERE id != ?').all(req.user.id).map((r) => r.id);
    notify(everyone, { title: '가족 스토리', body: `${req.user.displayName}님이 새 스토리를 올렸어요`, url: '/#/story', tag: 'feed' });
    res.status(201).json(post);
  });

  // Edit: same body as creating. Items left out of `media` are removed from the post.
  app.patch('/api/posts/:id', auth, requirePost, (req, res) => {
    if (req.post.authorId !== req.user.id) return res.status(403).json({ error: '내가 올린 글만 수정할 수 있습니다.' });
    const postId = req.post.id;
    const parsed = parsePost(req.body, req.user.id, postId);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const kept = new Set(parsed.media.filter((m) => m.existing).map((m) => m.name));
    const removedFiles = transaction(() => {
      const current = db
        .prepare('SELECT name, poster FROM media WHERE post_id = ? AND position IS NOT NULL')
        .all(postId);
      const removed = current.filter((m) => !kept.has(m.name)).flatMap((m) => [m.name, m.poster].filter(Boolean));
      const drop = db.prepare('DELETE FROM media WHERE name = ?');
      for (const name of removed) drop.run(name);
      placeMedia(postId, parsed.media);
      db.prepare('UPDATE posts SET text = ?, edited_at = ? WHERE id = ?').run(parsed.text, Date.now(), postId);
      return removed;
    });
    removeFiles(removedFiles);
    changed(postId);
    res.json(findPost(postId, req.user.id));
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
    if (req.post.authorId !== req.user.id) {
      notify([req.post.authorId], {
        title: '가족 스토리',
        body: `${comment.authorName}님의 댓글: ${comment.text}`,
        url: `/#/post/${req.post.id}`,
        tag: `post-${req.post.id}`,
      });
    }
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

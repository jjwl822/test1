import fs from 'node:fs';
import path from 'node:path';

const MAX_POST_TEXT = 2000;
const MAX_COMMENT_TEXT = 500;
export const REACTIONS = ['heart', 'like', 'dislike'];

/**
 * The family story feed: one shared board everyone sees, with photo + text posts,
 * comments and heart / like / dislike reactions.
 */
export function registerFeedRoutes(app, { db, auth, broadcastAll, saveImage, uploadDir }) {
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
      imageUrl: row.image ? `/api/images/${row.image}` : null,
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

  // JSON body: { text, image?: { type: "image/jpeg", data: "<base64>" } }
  app.post('/api/posts', auth, (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const image = req.body?.image;
    if (text.length > MAX_POST_TEXT) return res.status(400).json({ error: '글이 너무 깁니다.' });
    if (!text && !image) return res.status(400).json({ error: '사진이나 글을 입력하세요.' });
    let imageName = null;
    if (image) {
      const buffer = typeof image.data === 'string' ? Buffer.from(image.data, 'base64') : null;
      imageName = buffer?.length ? saveImage(buffer, image.type) : null;
      if (!imageName) return res.status(400).json({ error: '지원하지 않는 이미지 형식입니다.' });
    }
    const { lastInsertRowid } = db
      .prepare('INSERT INTO posts (author_id, text, image, created_at) VALUES (?, ?, ?, ?)')
      .run(req.user.id, text, imageName, Date.now());
    const post = findPost(lastInsertRowid, req.user.id);
    broadcastAll({ type: 'post', postId: post.id, authorId: req.user.id, authorName: req.user.displayName });
    res.status(201).json(post);
  });

  app.delete('/api/posts/:id', auth, requirePost, (req, res) => {
    if (req.post.authorId !== req.user.id) return res.status(403).json({ error: '내가 올린 글만 지울 수 있습니다.' });
    const { image } = db.prepare('SELECT image FROM posts WHERE id = ?').get(req.post.id);
    db.prepare('DELETE FROM posts WHERE id = ?').run(req.post.id);
    if (image) fs.rm(path.join(uploadDir, image), { force: true }, () => {});
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
}

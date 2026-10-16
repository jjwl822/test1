import express from 'express';

export const GROUP_ID = 'family';
export const EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];
const MAX_TEXT = 4000;
const MAX_POLL_OPTIONS = 10;

export function directId(a, b) {
  const [x, y] = [a, b].sort((p, q) => p - q);
  return `dm-${x}-${y}`;
}

/** Returns the user ids allowed in a conversation, or null if the id is invalid. */
export function participants(db, conversationId) {
  if (conversationId === GROUP_ID) {
    return db.prepare('SELECT id FROM users').all().map((r) => r.id);
  }
  const m = /^dm-(\d+)-(\d+)$/.exec(conversationId);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a >= b) return null;
  const found = db.prepare('SELECT id FROM users WHERE id IN (?, ?)').all(a, b);
  return found.length === 2 ? [a, b] : null;
}

/**
 * Conversations (family group + 1:1), messages with replies, emoji reactions, polls and
 * deletion, and read receipts.
 */
export function registerChatRoutes(app, { db, auth, broadcast, saveFile, removeFiles, imageTypes, notify }) {
  const MESSAGE_SELECT = `
    SELECT m.*, u.display_name AS sender_name
    FROM messages m JOIN users u ON u.id = m.sender_id`;
  const byId = db.prepare(`${MESSAGE_SELECT} WHERE m.id = ?`);
  const reactionsOf = db.prepare('SELECT emoji, user_id FROM message_reactions WHERE message_id = ? ORDER BY rowid');
  const pollOf = db.prepare('SELECT * FROM polls WHERE message_id = ?');
  const pollOptions = db.prepare('SELECT * FROM poll_options WHERE message_id = ? ORDER BY position');
  const votersOf = db.prepare('SELECT user_id FROM poll_votes WHERE option_id = ? ORDER BY rowid');

  function preview(row) {
    if (row.deleted) return '삭제된 메시지';
    if (row.kind === 'image') return '사진';
    if (row.kind === 'poll') return `투표: ${row.text}`;
    return row.text.length > 100 ? `${row.text.slice(0, 100)}…` : row.text;
  }

  function toMessage(row) {
    const reactions = [];
    for (const r of reactionsOf.all(row.id)) {
      const group = reactions.find((g) => g.emoji === r.emoji);
      if (group) group.userIds.push(r.user_id);
      else reactions.push({ emoji: r.emoji, userIds: [r.user_id] });
    }
    const replied = row.reply_to ? byId.get(row.reply_to) : null;
    const poll = row.kind === 'poll' && !row.deleted ? pollOf.get(row.id) : null;
    return {
      id: row.id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      senderName: row.sender_name,
      kind: row.kind,
      text: row.deleted ? null : (row.text ?? null),
      imageUrl: row.image && !row.deleted ? `/api/images/${row.image}` : null,
      deleted: Boolean(row.deleted),
      replyTo: replied ? { id: replied.id, senderName: replied.sender_name, preview: preview(replied) } : null,
      reactions,
      poll: poll
        ? {
            question: poll.question,
            multiple: Boolean(poll.multiple),
            options: pollOptions.all(row.id).map((o) => ({
              id: o.id,
              text: o.text,
              voterIds: votersOf.all(o.id).map((v) => v.user_id),
            })),
          }
        : null,
      createdAt: row.created_at,
    };
  }

  function requireConversation(req, res, next) {
    const ids = participants(db, req.params.id);
    if (!ids || !ids.includes(req.user.id)) {
      return res.status(404).json({ error: '대화방을 찾을 수 없습니다.' });
    }
    req.participants = ids;
    next();
  }

  /** Loads :id as a message the current user can see, into req.message / req.participants. */
  function requireMessage(req, res, next) {
    const row = byId.get(Number(req.params.id) || 0);
    const ids = row && participants(db, row.conversation_id);
    if (!ids || !ids.includes(req.user.id)) return res.status(404).json({ error: '메시지를 찾을 수 없습니다.' });
    req.message = row;
    req.participants = ids;
    next();
  }

  const markRead = db.prepare(`
    INSERT INTO reads (conversation_id, user_id, last_read_id) VALUES (?, ?, ?)
    ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`);

  function replyTarget(conversationId, value) {
    if (value == null) return { id: null };
    const row = byId.get(Number(value) || 0);
    if (!row || row.conversation_id !== conversationId) return { error: '답장할 메시지를 찾을 수 없습니다.' };
    return { id: row.id };
  }

  function saveMessage(conversationId, senderId, kind, text, image, replyTo, recipients, extra, { silent = false } = {}) {
    const { lastInsertRowid: id } = db
      .prepare(
        `INSERT INTO messages (conversation_id, sender_id, kind, text, image, reply_to, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(conversationId, senderId, kind, text, image, replyTo, Date.now());
    extra?.(id);
    // Sending a message means you've read everything up to it.
    markRead.run(conversationId, senderId, id);
    const message = toMessage(byId.get(id));
    broadcast(recipients, { type: 'message', message });
    const group = conversationId === GROUP_ID;
    if (!silent) notify(
      recipients.filter((r) => r !== senderId),
      {
        title: group ? '우리 가족' : message.senderName,
        body: group ? `${message.senderName}: ${preview(byId.get(id))}` : preview(byId.get(id)),
        url: `/#/chat/${conversationId}`,
        tag: conversationId,
      },
    );
    return message;
  }

  const updated = (req) => {
    const message = toMessage(byId.get(req.message.id));
    broadcast(req.participants, { type: 'messageUpdated', message });
    return message;
  };

  app.get('/api/conversations', auth, (req, res) => {
    const me = req.user.id;
    const last = db.prepare(`${MESSAGE_SELECT} WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT 1`);
    const unread = db.prepare(`
      SELECT COUNT(*) AS n FROM messages
      WHERE conversation_id = ? AND sender_id != ? AND deleted = 0
        AND id > COALESCE((SELECT last_read_id FROM reads WHERE conversation_id = ? AND user_id = ?), 0)`);
    const summary = (id, kind, title, userId) => {
      const row = last.get(id);
      return { id, kind, title, userId, lastMessage: row ? toMessage(row) : null, unreadCount: unread.get(id, me, id, me).n };
    };
    const others = db.prepare('SELECT * FROM users WHERE id != ? ORDER BY display_name').all(me);
    res.json([
      summary(GROUP_ID, 'group', '우리 가족', null),
      ...others.map((u) => summary(directId(me, u.id), 'direct', u.display_name, u.id)),
    ]);
  });

  app.get('/api/conversations/:id/messages', auth, requireConversation, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
    const rows = db
      .prepare(`${MESSAGE_SELECT} WHERE m.conversation_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`)
      .all(req.params.id, before, limit);
    res.json(rows.reverse().map(toMessage));
  });

  /** How far each participant has read, so the app can show how many haven't read each message. */
  app.get('/api/conversations/:id/reads', auth, requireConversation, (req, res) => {
    const get = db.prepare('SELECT last_read_id FROM reads WHERE conversation_id = ? AND user_id = ?');
    res.json(req.participants.map((userId) => ({ userId, lastReadId: get.get(req.params.id, userId)?.last_read_id ?? 0 })));
  });

  app.post('/api/conversations/:id/read', auth, requireConversation, (req, res) => {
    const newest = db.prepare('SELECT MAX(id) AS id FROM messages WHERE conversation_id = ?').get(req.params.id).id ?? 0;
    const lastReadId = Math.min(Number(req.body?.lastReadId) || 0, newest);
    if (lastReadId > 0) markRead.run(req.params.id, req.user.id, lastReadId);
    const current = db
      .prepare('SELECT last_read_id FROM reads WHERE conversation_id = ? AND user_id = ?')
      .get(req.params.id, req.user.id)?.last_read_id ?? 0;
    broadcast(req.participants, { type: 'read', conversationId: req.params.id, userId: req.user.id, lastReadId: current });
    res.json({ lastReadId: current });
  });

  app.post('/api/conversations/:id/messages', auth, requireConversation, (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) return res.status(400).json({ error: '메시지를 입력하세요.' });
    if (text.length > MAX_TEXT) return res.status(400).json({ error: '메시지가 너무 깁니다.' });
    const reply = replyTarget(req.params.id, req.body?.replyTo);
    if (reply.error) return res.status(400).json({ error: reply.error });
    res.status(201).json(saveMessage(req.params.id, req.user.id, 'text', text, null, reply.id, req.participants));
  });

  app.post(
    '/api/conversations/:id/images',
    auth,
    requireConversation,
    express.raw({ type: Object.keys(imageTypes), limit: '15mb' }),
    (req, res) => {
      const reply = replyTarget(req.params.id, req.query.replyTo);
      if (reply.error) return res.status(400).json({ error: reply.error });
      const name =
        Buffer.isBuffer(req.body) && req.body.length > 0 ? saveFile(req.body, req.get('content-type'), imageTypes) : null;
      if (!name) return res.status(400).json({ error: '지원하지 않는 이미지 형식입니다.' });
      res.status(201).json(saveMessage(req.params.id, req.user.id, 'image', null, name, reply.id, req.participants));
    },
  );

  // Body: { question, options: ["짜장면", "짬뽕"], multiple: false }
  app.post('/api/conversations/:id/polls', auth, requireConversation, (req, res) => {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    const options = (Array.isArray(req.body?.options) ? req.body.options : [])
      .map((o) => (typeof o === 'string' ? o.trim() : ''))
      .filter(Boolean);
    if (!question || question.length > 200) return res.status(400).json({ error: '질문을 입력하세요.' });
    if (options.length < 2 || options.length > MAX_POLL_OPTIONS || options.some((o) => o.length > 100)) {
      return res.status(400).json({ error: `선택지는 2~${MAX_POLL_OPTIONS}개 입력하세요.` });
    }
    db.exec('BEGIN');
    try {
      const message = saveMessage(req.params.id, req.user.id, 'poll', question, null, null, req.participants, (id) => {
        db.prepare('INSERT INTO polls (message_id, question, multiple) VALUES (?, ?, ?)').run(id, question, req.body?.multiple ? 1 : 0);
        const add = db.prepare('INSERT INTO poll_options (message_id, text, position) VALUES (?, ?, ?)');
        options.forEach((text, i) => add.run(id, text, i));
      });
      db.exec('COMMIT');
      res.status(201).json(message);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });

  // Body: { optionIds: [..] } replaces my votes; an empty list takes my vote back.
  app.post('/api/messages/:id/vote', auth, requireMessage, (req, res) => {
    const poll = pollOf.get(req.message.id);
    if (!poll || req.message.deleted) return res.status(404).json({ error: '투표를 찾을 수 없습니다.' });
    const valid = new Set(pollOptions.all(poll.message_id).map((o) => o.id));
    const chosen = [...new Set(Array.isArray(req.body?.optionIds) ? req.body.optionIds.map(Number) : [])];
    if (chosen.some((id) => !valid.has(id)) || (!poll.multiple && chosen.length > 1)) {
      return res.status(400).json({ error: '잘못된 선택입니다.' });
    }
    const clear = db.prepare('DELETE FROM poll_votes WHERE option_id = ? AND user_id = ?');
    const vote = db.prepare('INSERT INTO poll_votes (option_id, user_id) VALUES (?, ?)');
    for (const id of valid) clear.run(id, req.user.id);
    for (const id of chosen) vote.run(id, req.user.id);
    res.json(updated(req));
  });

  // Toggles my emoji on a message; a different emoji replaces my previous one.
  app.post('/api/messages/:id/reactions', auth, requireMessage, (req, res) => {
    const { emoji } = req.body ?? {};
    if (!EMOJIS.includes(emoji)) return res.status(400).json({ error: '지원하지 않는 이모지입니다.' });
    if (req.message.deleted) return res.status(400).json({ error: '삭제된 메시지입니다.' });
    const mine = db
      .prepare('SELECT emoji FROM message_reactions WHERE message_id = ? AND user_id = ?')
      .get(req.message.id, req.user.id);
    if (mine?.emoji === emoji) {
      db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?').run(req.message.id, req.user.id);
    } else {
      db.prepare(
        `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)
         ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = excluded.emoji`,
      ).run(req.message.id, req.user.id, emoji);
    }
    res.json(updated(req));
  });

  // Only the sender can delete. The message stays in place as "삭제된 메시지입니다".
  app.delete('/api/messages/:id', auth, requireMessage, (req, res) => {
    if (req.message.sender_id !== req.user.id) return res.status(403).json({ error: '내가 보낸 메시지만 삭제할 수 있습니다.' });
    const { id, image } = req.message;
    db.prepare('UPDATE messages SET deleted = 1, text = NULL, image = NULL WHERE id = ?').run(id);
    db.prepare('DELETE FROM message_reactions WHERE message_id = ?').run(id);
    db.prepare('DELETE FROM polls WHERE message_id = ?').run(id);
    if (image) removeFiles([image]);
    res.json(updated(req));
  });

  return {
    /** Adds a plain text line from [senderId] (used for "📞 ..." call records). */
    logMessage: (conversationId, senderId, text, recipients, options) =>
      saveMessage(conversationId, senderId, 'text', text, null, null, recipients, undefined, options),
  };
}

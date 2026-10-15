import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { openDatabase } from './db.js';
import { registerFeedRoutes } from './feed.js';

export const GROUP_ID = 'family';

const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const IMAGE_NAME = /^[a-f0-9]{32}\.(jpg|png|webp|gif)$/;
const MAX_TEXT = 4000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function directId(a, b) {
  const [x, y] = [a, b].sort((p, q) => p - q);
  return `dm-${x}-${y}`;
}

/** Returns the user ids allowed in a conversation, or null if the id is invalid. */
function participants(db, conversationId) {
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

function toUser(row) {
  return { id: row.id, username: row.username, displayName: row.display_name };
}

function toMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    kind: row.kind,
    text: row.text ?? null,
    imageUrl: row.image ? `/api/images/${row.image}` : null,
    createdAt: row.created_at,
  };
}

const MESSAGE_SELECT = `
  SELECT m.*, u.display_name AS sender_name
  FROM messages m JOIN users u ON u.id = m.sender_id`;

export function createServer({ familyCode, dataDir }) {
  if (!familyCode) throw new Error('familyCode is required');
  const uploadDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const db = openDatabase(path.join(dataDir, 'messenger.db'));

  const app = express();
  app.disable('x-powered-by');
  const smallJson = express.json({ limit: '64kb' });
  const postJson = express.json({ limit: '20mb' }); // story posts carry a base64 photo
  app.use((req, res, next) =>
    (req.method === 'POST' && req.path === '/api/posts' ? postJson : smallJson)(req, res, next),
  );

  /** userId -> Set<WebSocket> */
  const sockets = new Map();

  function userForToken(token) {
    if (!token) return null;
    const row = db
      .prepare('SELECT u.* FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ?')
      .get(token);
    return row ? toUser(row) : null;
  }

  function issueToken(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO tokens (token, user_id, created_at) VALUES (?, ?, ?)').run(
      token,
      userId,
      Date.now(),
    );
    return token;
  }

  function auth(req, res, next) {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const user = userForToken(token);
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
    req.user = user;
    req.token = token;
    next();
  }

  function requireConversation(req, res, next) {
    const ids = participants(db, req.params.id);
    if (!ids || !ids.includes(req.user.id)) {
      return res.status(404).json({ error: '대화방을 찾을 수 없습니다.' });
    }
    req.participants = ids;
    next();
  }

  function broadcast(userIds, payload) {
    const data = JSON.stringify(payload);
    for (const id of userIds) {
      for (const ws of sockets.get(id) ?? []) {
        if (ws.readyState === ws.OPEN) ws.send(data);
      }
    }
  }

  function broadcastAll(payload) {
    broadcast([...sockets.keys()], payload);
  }

  /** Writes an uploaded image and returns its file name, or null for unsupported types. */
  function saveImage(buffer, contentType) {
    const ext = IMAGE_TYPES[contentType?.split(';')[0].trim()];
    if (!ext) return null;
    const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(uploadDir, name), buffer);
    return name;
  }

  function saveMessage(conversationId, senderId, kind, text, image, recipients) {
    const { lastInsertRowid } = db
      .prepare(
        'INSERT INTO messages (conversation_id, sender_id, kind, text, image, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(conversationId, senderId, kind, text, image, Date.now());
    const message = toMessage(db.prepare(`${MESSAGE_SELECT} WHERE m.id = ?`).get(lastInsertRowid));
    broadcast(recipients, { type: 'message', message });
    return message;
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.post('/api/register', (req, res) => {
    const { familyCode: code, username, displayName, password } = req.body ?? {};
    if (!code || !safeEqual(code, familyCode)) {
      return res.status(403).json({ error: '가족 코드가 올바르지 않습니다.' });
    }
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: '아이디는 영문/숫자/밑줄 3~20자로 입력하세요.' });
    }
    const name = typeof displayName === 'string' ? displayName.trim() : '';
    if (name.length < 1 || name.length > 20) {
      return res.status(400).json({ error: '이름은 1~20자로 입력하세요.' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' });
    }
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      return res.status(409).json({ error: '이미 사용 중인 아이디입니다.' });
    }
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(username, name, hashPassword(password), Date.now());
    const user = toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid));
    res.status(201).json({ token: issueToken(user.id), user });
  });

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body ?? {};
    const row =
      typeof username === 'string' && db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!row || typeof password !== 'string' || !verifyPassword(password, row.password_hash)) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }
    res.json({ token: issueToken(row.id), user: toUser(row) });
  });

  app.post('/api/logout', auth, (req, res) => {
    db.prepare('DELETE FROM tokens WHERE token = ?').run(req.token);
    res.json({ ok: true });
  });

  app.get('/api/me', auth, (req, res) => res.json(req.user));

  app.get('/api/users', auth, (_req, res) => {
    res.json(db.prepare('SELECT * FROM users ORDER BY display_name').all().map(toUser));
  });

  app.get('/api/conversations', auth, (req, res) => {
    const last = db.prepare(`${MESSAGE_SELECT} WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT 1`);
    const lastMessage = (id) => {
      const row = last.get(id);
      return row ? toMessage(row) : null;
    };
    const others = db.prepare('SELECT * FROM users WHERE id != ? ORDER BY display_name').all(req.user.id);
    const conversations = [
      { id: GROUP_ID, kind: 'group', title: '우리 가족', lastMessage: lastMessage(GROUP_ID) },
      ...others.map((u) => {
        const id = directId(req.user.id, u.id);
        return { id, kind: 'direct', title: u.display_name, lastMessage: lastMessage(id) };
      }),
    ];
    res.json(conversations);
  });

  app.get('/api/conversations/:id/messages', auth, requireConversation, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
    const rows = db
      .prepare(`${MESSAGE_SELECT} WHERE m.conversation_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`)
      .all(req.params.id, before, limit);
    res.json(rows.reverse().map(toMessage));
  });

  app.post('/api/conversations/:id/messages', auth, requireConversation, (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) return res.status(400).json({ error: '메시지를 입력하세요.' });
    if (text.length > MAX_TEXT) return res.status(400).json({ error: '메시지가 너무 깁니다.' });
    res.status(201).json(saveMessage(req.params.id, req.user.id, 'text', text, null, req.participants));
  });

  app.post(
    '/api/conversations/:id/images',
    auth,
    requireConversation,
    express.raw({ type: Object.keys(IMAGE_TYPES), limit: '15mb' }),
    (req, res) => {
      const name =
        Buffer.isBuffer(req.body) && req.body.length > 0 ? saveImage(req.body, req.get('content-type')) : null;
      if (!name) return res.status(400).json({ error: '지원하지 않는 이미지 형식입니다.' });
      res.status(201).json(saveMessage(req.params.id, req.user.id, 'image', null, name, req.participants));
    },
  );

  app.get('/api/images/:name', auth, (req, res) => {
    const { name } = req.params;
    if (!IMAGE_NAME.test(name)) return res.status(404).end();
    // Story photos are visible to the whole family; chat photos only to that conversation.
    const isStory = db.prepare('SELECT 1 FROM posts WHERE image = ?').get(name);
    if (!isStory) {
      const row = db.prepare('SELECT conversation_id FROM messages WHERE image = ?').get(name);
      const ids = row && participants(db, row.conversation_id);
      if (!ids || !ids.includes(req.user.id)) return res.status(404).end();
    }
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.sendFile(path.join(uploadDir, name));
  });

  registerFeedRoutes(app, { db, auth, broadcastAll, saveImage, uploadDir });

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: '파일이 너무 큽니다.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '잘못된 요청입니다.' });
    console.error(err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token');
    const user = url.pathname === '/ws' ? userForToken(token) : null;
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => (ws.isAlive = true));
      if (!sockets.has(user.id)) sockets.set(user.id, new Set());
      sockets.get(user.id).add(ws);
      ws.on('close', () => {
        const set = sockets.get(user.id);
        set?.delete(ws);
        if (set?.size === 0) sockets.delete(user.id);
      });
      ws.send(JSON.stringify({ type: 'hello', user }));
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);

  server.on('close', () => {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    db.close();
  });

  return server;
}

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { openDatabase } from './db.js';
import { participants, registerChatRoutes } from './chat.js';
import { registerFamilyRoutes } from './family.js';
import { registerFeedRoutes } from './feed.js';
import { registerGameRoutes } from './games.js';
import { createPush } from './push.js';

export { GROUP_ID } from './chat.js';

const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
// iPhones record .mov (QuickTime); the web app uploads those as they are.
const MEDIA_TYPES = { ...IMAGE_TYPES, 'video/mp4': 'mp4', 'video/quicktime': 'mov' };
const MEDIA_NAME = /^[a-f0-9]{32}\.(jpg|png|webp|gif|mp4|mov)$/;
const WEB_DIR = fileURLToPath(new URL('../web', import.meta.url));
const COOKIE = 'fm_token';

/** Login token from the Authorization header (Android app) or the login cookie (web app). */
function tokenFrom(req) {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE) return decodeURIComponent(value.join('='));
  }
  return null;
}

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

/**
 * Chat bubble colors. Everyone gets one by join order and can pick another in their profile.
 * All are dark enough for white text.
 */
export const BUBBLE_COLORS = [
  '#1877F2', // blue
  '#E0533A', // coral
  '#1A8F52', // green
  '#7C4DDB', // purple
  '#D63F7C', // pink
  '#C2620A', // orange
  '#0E8582', // teal
  '#4F5BD5', // indigo
  '#D13A41', // red
  '#8E5B3A', // brown
];

function toUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar ? `/api/media/${row.avatar}` : null,
    color: BUBBLE_COLORS.includes(row.color) ? row.color : BUBBLE_COLORS[(row.id - 1) % BUBBLE_COLORS.length],
  };
}

export function createServer({
  familyCode,
  dataDir,
  now = () => new Date(),
  reminderHour = 9,
  pushSend,
  gamesDir = path.join(WEB_DIR, 'games'),
}) {
  if (!familyCode) throw new Error('familyCode is required');
  const uploadDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const db = openDatabase(path.join(dataDir, 'messenger.db'));

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  /** userId -> Set<WebSocket> */
  const sockets = new Map();
  /** True while someone has the web app open on screen (then they don't need a push). */
  const isVisible = (userId) => [...(sockets.get(userId) ?? [])].some((ws) => ws.visible);
  const push = createPush({ db, dataDir, isVisible, send: pushSend });

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

  /** Web browsers can't attach a header to <img>/<video>/WebSocket, so the web app logs in with a cookie. */
  function setLoginCookie(req, res, token) {
    const https = req.secure || req.get('x-forwarded-proto') === 'https';
    res.append(
      'Set-Cookie',
      `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${https ? '; Secure' : ''}`,
    );
  }

  function auth(req, res, next) {
    const token = tokenFrom(req);
    const user = userForToken(token);
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
    req.user = user;
    req.token = token;
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

  /** Writes an uploaded photo or video and returns its file name, or null for unsupported types. */
  function saveFile(buffer, contentType, types = MEDIA_TYPES) {
    const ext = types[contentType?.split(';')[0].trim()];
    if (!ext) return null;
    const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(uploadDir, name), buffer);
    return name;
  }

  function removeFiles(names) {
    for (const name of names) fs.rmSync(path.join(uploadDir, name), { force: true });
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // Web push (web app on iPhone / PC)
  app.get('/api/push/key', auth, (_req, res) => res.json({ publicKey: push.publicKey }));
  app.post('/api/push/subscribe', auth, (req, res) => {
    if (!push.subscribe(req.user.id, req.body)) return res.status(400).json({ error: '잘못된 알림 정보입니다.' });
    res.json({ ok: true });
  });
  app.post('/api/push/unsubscribe', auth, (req, res) => {
    push.unsubscribe(req.body?.endpoint);
    res.json({ ok: true });
  });

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
    const token = issueToken(user.id);
    setLoginCookie(req, res, token);
    res.status(201).json({ token, user });
  });

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body ?? {};
    const row =
      typeof username === 'string' && db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!row || typeof password !== 'string' || !verifyPassword(password, row.password_hash)) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }
    const token = issueToken(row.id);
    setLoginCookie(req, res, token);
    res.json({ token, user: toUser(row) });
  });

  app.post('/api/logout', auth, (req, res) => {
    db.prepare('DELETE FROM tokens WHERE token = ?').run(req.token);
    if (req.body?.endpoint) push.unsubscribe(req.body.endpoint);
    res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });

  app.get('/api/me', auth, (req, res) => res.json(req.user));

  app.get('/api/users', auth, (_req, res) => {
    res.json(db.prepare('SELECT * FROM users ORDER BY display_name').all().map(toUser));
  });

  /** Tells everyone a profile changed (name or photo). */
  const profileChanged = (id) =>
    broadcastAll({ type: 'user', user: toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });

  app.get('/api/colors', auth, (_req, res) => res.json(BUBBLE_COLORS));

  // Body: { displayName?, color? } — either or both.
  app.patch('/api/me', auth, (req, res) => {
    const { displayName, color } = req.body ?? {};
    if (displayName === undefined && color === undefined) return res.status(400).json({ error: '바꿀 내용이 없습니다.' });
    if (displayName !== undefined) {
      const name = typeof displayName === 'string' ? displayName.trim() : '';
      if (name.length < 1 || name.length > 20) return res.status(400).json({ error: '이름은 1~20자로 입력하세요.' });
    }
    if (color !== undefined && !BUBBLE_COLORS.includes(color)) return res.status(400).json({ error: '고를 수 없는 색입니다.' });
    if (displayName !== undefined) {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName.trim(), req.user.id);
    }
    if (color !== undefined) db.prepare('UPDATE users SET color = ? WHERE id = ?').run(color, req.user.id);
    profileChanged(req.user.id);
    res.json(toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
  });

  app.post('/api/me/avatar', auth, express.raw({ type: Object.keys(IMAGE_TYPES), limit: '10mb' }), (req, res) => {
    const name =
      Buffer.isBuffer(req.body) && req.body.length > 0 ? saveFile(req.body, req.get('content-type'), IMAGE_TYPES) : null;
    if (!name) return res.status(400).json({ error: '지원하지 않는 이미지 형식입니다.' });
    const old = db.prepare('SELECT avatar FROM users WHERE id = ?').get(req.user.id).avatar;
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(name, req.user.id);
    if (old) removeFiles([old]);
    profileChanged(req.user.id);
    res.json(toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
  });

  app.delete('/api/me/avatar', auth, (req, res) => {
    const old = db.prepare('SELECT avatar FROM users WHERE id = ?').get(req.user.id).avatar;
    db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(req.user.id);
    if (old) removeFiles([old]);
    profileChanged(req.user.id);
    res.json(toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
  });

  // Serves chat photos and story photos/videos. sendFile supports Range requests for video seeking.
  app.get(['/api/images/:name', '/api/media/:name'], auth, (req, res) => {
    const { name } = req.params;
    if (!MEDIA_NAME.test(name)) return res.status(404).end();
    // Story media is visible to the whole family once posted (before that, only to the uploader);
    // chat photos only to that conversation.
    const story = db.prepare('SELECT uploader_id, post_id FROM media WHERE name = ?').get(name);
    const isAvatar = db.prepare('SELECT 1 FROM users WHERE avatar = ?').get(name);
    if (isAvatar) {
      // Profile photos are visible to the whole family.
    } else if (story) {
      if (story.post_id === null && story.uploader_id !== req.user.id) return res.status(404).end();
    } else {
      const row = db.prepare('SELECT conversation_id FROM messages WHERE image = ?').get(name);
      const ids = row && participants(db, row.conversation_id);
      if (!ids || !ids.includes(req.user.id)) return res.status(404).end();
    }
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.sendFile(path.join(uploadDir, name));
  });

  const notify = (userIds, payload) => push.notify(userIds, payload).catch((err) => console.warn(err));
  registerChatRoutes(app, { db, auth, broadcast, saveFile, removeFiles, imageTypes: IMAGE_TYPES, notify });
  registerFeedRoutes(app, { db, auth, broadcastAll, saveFile, uploadDir, mediaTypes: Object.keys(MEDIA_TYPES), now, notify });
  registerGameRoutes(app, { db, auth, gamesDir });
  const family = registerFamilyRoutes(app, {
    db,
    auth,
    broadcastAll,
    sendTo: (userId, payload) => broadcast([userId], payload),
    connectedUserIds: () => [...new Set([...sockets.keys(), ...push.userIds()])],
    notify,
    now,
    reminderHour,
  });

  // The web app (iPhone / PC). index.html and the service worker are never cached so updates show up.
  app.use(
    express.static(WEB_DIR, {
      setHeaders: (res, file) => {
        // Games are edited in place on the server PC, so they're never cached either.
        if (/(index\.html|sw\.js|\.webmanifest)$/.test(file) || file.includes(`${path.sep}games${path.sep}`)) {
          res.set('Cache-Control', 'no-cache');
        }
      },
    }),
  );

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
    const token = tokenFrom(req) ?? url.searchParams.get('token');
    const user = url.pathname === '/ws' ? userForToken(token) : null;
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.visible = false;
      ws.on('pong', () => (ws.isAlive = true));
      // The web app reports whether it's on screen; Android keeps the default (not visible).
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'visibility') ws.visible = Boolean(msg.visible);
        } catch {
          // ignore anything else
        }
      });
      if (!sockets.has(user.id)) sockets.set(user.id, new Set());
      sockets.get(user.id).add(ws);
      ws.on('close', () => {
        const set = sockets.get(user.id);
        set?.delete(ws);
        if (set?.size === 0) sockets.delete(user.id);
      });
      ws.send(JSON.stringify({ type: 'hello', user }));
      // Deliver today's calendar and memory reminders as soon as the phone connects.
      family.remind(user.id);
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
    app.locals.stopCleanup?.();
    family.stop();
    for (const ws of wss.clients) ws.terminate();
    db.close();
  });

  return server;
}

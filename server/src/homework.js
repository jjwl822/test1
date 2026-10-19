import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localDate } from './family.js';

// A parent's message with one of these is worth asking Claude about; nothing else is sent.
const KEYWORD = /숙제/;
const NOTICE = '📢';
// Lines this module writes into the chat (in the parent's name), never read back as homework.
const BOT = '📚 ';
// How far back the conversation is shown to Claude, and how long to wait for the parent to finish
// ("유호숙제" first, the details in the next message).
const CONTEXT = 10 * 60 * 1000;
const MAX_CONTEXT = 12;
const QUIET = 45 * 1000;
const MAX_ITEMS = 12;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = '일월화수목금토';

const schema = (children) => ({
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'due', 'child'],
        properties: {
          text: { type: 'string', description: '아이가 할 일 한 가지, 짧은 한국어' },
          due: { type: ['string', 'null'], description: 'YYYY-MM-DD, 마감이 없으면 null' },
          child: { type: ['string', 'null'], description: `누구 숙제인지: ${children.join(', ')} 중 하나, 모르면 null` },
        },
      },
    },
  },
});

function prompt(conversation, today, { children = [], existing = {} } = {}) {
  const time = `${String(today.getHours()).padStart(2, '0')}:${String(today.getMinutes()).padStart(2, '0')}`;
  const day = `${localDate(today)}(${WEEKDAYS[today.getDay()]}) ${time}`;
  const already = Object.entries(existing)
    .filter(([, list]) => list.length)
    .map(([name, list]) => `${name}: ${list.join(' / ')}`)
    .join('\n');
  return `지금은 ${day}(한국 시간)입니다. 새벽이라도 "오늘"은 이 날짜예요.
아래는 가족 메신저 대화의 일부예요. 부모가 아이들(${children.join(', ')})의 숙제 이야기를 했어요.
대화에서 아이가 실제로 해야 할 일(숙제, 시험 준비, 제출, 챙겨 갈 준비물)만 항목으로 뽑으세요.
- 항목마다 한 가지 일만, 짧은 한국어로 (40자 안팎).
- 누구 숙제인지 child에 적으세요 ("유호숙제" → 유호). 대화로 알 수 없으면 null.
- 단순 안내, 상품·행사 소식, 선생님 인사, 숙제를 했는지 묻는 말, 잡담은 빼세요. 할 일이 없으면 빈 목록.
- "월요일까지", "내일", "오늘" 같은 마감은 오늘 날짜를 기준으로 YYYY-MM-DD로 바꾸세요. 마감이 없으면 null.
${already ? `- 이미 숙제 목록에 있는 항목이에요. 표현이 달라도 같은 일이면 빼세요.\n${already}\n` : ''}
--- 대화 ---
${conversation}`;
}

/** Default Claude Code location for an npm install on Windows; elsewhere `claude` on PATH. */
function defaultClaude() {
  const exe = path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  return process.env.APPDATA && fs.existsSync(exe) ? exe : 'claude';
}

/**
 * Finds homework in a bit of conversation with the Claude Code CLI already signed in on the server
 * PC (the family's own subscription, no API key). Resolves to [{ text, due, child }].
 */
export function claudeExtractor({ command = defaultClaude(), model = 'sonnet', effort = 'medium', timeoutMs = 120_000 } = {}) {
  // An empty folder, so the CLI doesn't pick up project files or settings from the server folder.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-homework-'));
  return (conversation, today, context = {}) =>
    new Promise((resolve, reject) => {
      const args = ['-p', '--model', model, '--effort', effort, '--output-format', 'json',
        '--json-schema', JSON.stringify(schema(context.children ?? [])), '--tools', '', '--no-session-persistence'];
      const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        try {
          const result = JSON.parse(out);
          if (result.is_error) throw new Error(result.result || 'claude error');
          const items = result.structured_output?.items;
          if (!Array.isArray(items)) throw new Error('no items in claude output');
          resolve(items);
        } catch (e) {
          reject(new Error(`claude exited ${code}: ${e.message} ${err.slice(0, 300)}`));
        }
      });
      child.stdin.end(prompt(conversation, today, context));
    });
}

/** Without Claude: the "- ..." lines, minus obvious announcements. */
export function ruleExtract(text) {
  const items = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\[[^\]]*\]\s*/, '').trim();
    if (!/^[-;•·*]/.test(line)) continue;
    const item = line.replace(/^[-;•·*]+\s*/, '').trim();
    if (item.length < 2 || /상품|예정입니다/.test(item)) continue;
    items.push({ text: item, due: null, child: null });
  }
  return items;
}

function validDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Same item written slightly differently ("필통 챙기기" / "필통 챙기기!") counts as a duplicate. */
export const dedupeKey = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * The children homework is for: [{ id, name, username }], from
 * homework.children ({ "유호": "uho", "유이": "uiui" }: name → username) or, for a single child,
 * homework.assignee. The first one gets homework when it isn't clear whose it is
 * (homework.assignee when it's one of them).
 */
export function homeworkPeople(db, { children, assignee } = {}) {
  const entries = Object.entries(children ?? {});
  if (!entries.length && assignee) entries.push([null, assignee]);
  const people = [];
  for (const [name, username] of entries) {
    const user = db.prepare('SELECT id, display_name FROM users WHERE username = ?').get(username);
    if (user) people.push({ id: user.id, name: name ?? user.display_name, username });
  }
  const first = people.findIndex((p) => p.username === assignee);
  if (first > 0) people.unshift(...people.splice(first, 1));
  return people;
}

/**
 * Puts homework that a parent mentions in any chat on the 📚 숙제 list.
 *
 * Only a parent's message containing "숙제" (or a pasted 📢 notice) starts it. Once the parent has
 * been quiet for a little while, that chat's recent messages (up to 10 minutes back, not yet read)
 * go to Claude, which picks out the to-dos and whose they are. So "유호숙제" followed by the details,
 * or a pasted notice followed by "유이숙제", both work. A notice pasted again is skipped, and items
 * already on a child's list aren't added twice. A quiet line in the same chat says what was added.
 */
export function createHomework({ db, authors, children, assignee, extract, now, listsChanged, notify, logMessage,
  quietMs = QUIET, log = console }) {
  const userId = (username) => db.prepare('SELECT id FROM users WHERE username = ?').get(username)?.id;
  const people = () => homeworkPeople(db, { children, assignee });

  const isSource = db.prepare('SELECT 1 FROM homework_sources WHERE message_id = ?');
  const addSource = db.prepare('INSERT OR IGNORE INTO homework_sources (message_id, job, created_at) VALUES (?, ?, ?)');
  const recent = db.prepare(`
    SELECT m.id, m.sender_id, m.text, m.created_at, u.display_name AS name FROM messages m JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ? AND m.id <= ? AND m.created_at >= ? AND m.deleted = 0 AND m.kind = 'text'
    ORDER BY m.id DESC LIMIT ?`);
  const openTexts = db.prepare("SELECT text FROM list_items WHERE list = 'homework' AND done = 0 AND assignee_id IS ? ORDER BY id");
  // Notices already read in the last 60 days, to spot the same notice pasted again.
  const pastNotices = db.prepare(`
    SELECT m.text FROM homework_sources h JOIN messages m ON m.id = h.message_id
    WHERE h.created_at > ? AND m.text IS NOT NULL`);
  const openKeys = db.prepare(
    "SELECT dedupe FROM list_items WHERE list = 'homework' AND done = 0 AND dedupe IS NOT NULL AND assignee_id IS ?",
  );
  const insert = db.prepare(`
    INSERT INTO list_items (list, text, author_id, created_at, due, assignee_id, source_job, dedupe)
    VALUES ('homework', ?, ?, ?, ?, ?, ?, ?)`);

  /** True when [text] is a long notice that was already read (pasted again, maybe with a word added). */
  function seenBefore(text) {
    const key = dedupeKey(text);
    if (key.length < 30) return false;
    return pastNotices.all(Date.now() - 60 * 86400000).some(({ text: old }) => {
      const k = dedupeKey(old);
      return k.length >= 30 && (key.includes(k) || k.includes(key));
    });
  }

  /** conversationId -> { timer, from, until, senderId } while waiting for the parent to finish */
  const waiting = new Map();
  let queue = Promise.resolve();

  /** Called for every text message a person sends. */
  function onMessage(message) {
    if (message.kind !== 'text' || !message.text || message.text.startsWith(BOT)) return;
    if (!authors.map(userId).includes(message.senderId)) return;
    const room = message.conversationId;
    const wait = waiting.get(room);
    if (wait) {
      // Still talking: take this message too and wait a little longer.
      wait.until = message.id;
      clearTimeout(wait.timer);
      wait.timer = setTimeout(() => flush(room), quietMs);
      return;
    }
    if (!KEYWORD.test(message.text) && !message.text.includes(NOTICE)) return;
    waiting.set(room, {
      from: message.createdAt - CONTEXT,
      until: message.id,
      senderId: message.senderId,
      timer: setTimeout(() => flush(room), quietMs),
    });
  }

  function flush(room) {
    const wait = waiting.get(room);
    if (!wait) return;
    clearTimeout(wait.timer);
    waiting.delete(room);
    const rows = recent
      .all(room, wait.until, wait.from, MAX_CONTEXT)
      .reverse()
      .filter((r) => r.text && !r.text.startsWith(BOT) && !isSource.get(r.id));
    if (!rows.length) return;
    const job = rows[0].id;
    // Claim them now, so they're never sent again; a notice pasted again is left out.
    const fresh = rows.filter((r) => !seenBefore(r.text));
    for (const r of rows) addSource.run(r.id, job, Date.now());
    if (!fresh.length) {
      logMessage(room, wait.senderId, '📚 이미 숙제 목록에 넣은 공지예요.');
      return;
    }
    const conversation = fresh.map((r) => `[${r.name}] ${r.text}`).join('\n');
    queue = queue.then(() => run(job, conversation, room, wait.senderId)).catch((e) => log.warn('숙제 정리 실패:', e));
  }

  async function run(job, conversation, room, authorId) {
    const kids = people();
    const existing = Object.fromEntries(kids.map((p) => [p.name, openTexts.all(p.id).map((r) => r.text)]));
    let items;
    let fallback = false;
    try {
      items = await extract(conversation, now(), { children: kids.map((p) => p.name), existing });
    } catch (e) {
      log.warn('Claude로 숙제를 정리하지 못해 "- " 줄을 그대로 씁니다:', e.message);
      items = ruleExtract(conversation);
      fallback = true;
    }
    const seen = new Map(kids.map((p) => [p.id, new Set(openKeys.all(p.id).map((r) => r.dedupe))]));
    const added = [];
    for (const item of items.slice(0, MAX_ITEMS)) {
      const text = typeof item?.text === 'string' ? item.text.trim().slice(0, 200) : '';
      const key = dedupeKey(text);
      const kid = kids.find((p) => typeof item.child === 'string' && item.child.trim().startsWith(p.name)) ?? kids[0] ?? null;
      const keys = seen.get(kid?.id) ?? new Set();
      if (!key || keys.has(key)) continue;
      keys.add(key);
      const due = validDate(item.due) ? item.due : null;
      insert.run(text, authorId, Date.now(), due, kid?.id ?? null, job, key);
      added.push({ text, due, kid });
    }
    if (!added.length) {
      if (items.length) logMessage(room, authorId, '📚 이미 숙제 목록에 있는 내용이에요.');
      return added;
    }
    listsChanged();
    const dueText = (d) => (d ? ` (~${Number(d.slice(5, 7))}/${Number(d.slice(8))})` : '');
    const lines = added.map((i) => `• ${i.kid && kids.length > 1 ? `[${i.kid.name}] ` : ''}${i.text}${dueText(i.due)}`);
    logMessage(room, authorId, `📚 숙제 ${added.length}개를 목록에 넣었어요${fallback ? ' (원문 그대로)' : ''}\n${lines.join('\n')}`);
    for (const kid of kids) {
      const mine = added.filter((i) => i.kid?.id === kid.id);
      if (mine.length) {
        notify([kid.id], { title: `📚 새 숙제 ${mine.length}개`, body: mine.map((i) => i.text).join(', '), url: '/#/homework', tag: `homework-${job}` });
      }
    }
    return added;
  }

  return {
    onMessage,
    /** Sends anything still waiting right away, and resolves when it's on the list (for tests). */
    idle: () => {
      for (const room of [...waiting.keys()]) flush(room);
      return queue;
    },
    stop: () => waiting.forEach((w) => clearTimeout(w.timer)),
  };
}

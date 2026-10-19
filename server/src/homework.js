import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GROUP_ID } from './chat.js';
import { localDate } from './family.js';

// "유이숙제", "유이 숙제", "숙제!" sent right after a pasted notice means "that was homework".
const TRIGGER = /^\s*(\S{1,8}\s?)?숙제\s*[!.~]*\s*$/;
const NOTICE = '📢';
// Lines this module writes into the chat (in the parent's name), never read back as homework.
const BOT = '📚 ';
// Messages sent this close together (before a trigger) are one pasted notice.
const GAP = 3 * 60 * 1000;
const MAX_SOURCES = 3;
const MAX_ITEMS = 12;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = '일월화수목금토';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'due'],
        properties: {
          text: { type: 'string', description: '아이가 할 일 한 가지, 짧은 한국어' },
          due: { type: ['string', 'null'], description: 'YYYY-MM-DD, 마감이 없으면 null' },
        },
      },
    },
  },
};

function prompt(text, today) {
  const day = `${localDate(today)}(${WEEKDAYS[today.getDay()]})`;
  return `오늘은 ${day}입니다. 아래는 엄마가 가족 단체방에 붙여넣은 아이의 학원·학교 공지나 숙제 메모입니다.
아이가 실제로 해야 할 일(숙제, 시험 준비, 제출, 챙겨 갈 준비물)만 항목으로 뽑으세요.
- 항목마다 한 가지 일만, 짧은 한국어로 (40자 안팎).
- 단순 안내, 상품·행사 소식, 선생님 인사는 빼세요.
- "월요일까지", "내일", "오늘" 같은 마감은 오늘 날짜를 기준으로 YYYY-MM-DD로 바꾸세요. 마감이 없으면 null.

---
${text}`;
}

/** Default Claude Code location for an npm install on Windows; elsewhere `claude` on PATH. */
function defaultClaude() {
  const exe = path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  return process.env.APPDATA && fs.existsSync(exe) ? exe : 'claude';
}

/**
 * Splits a notice into to-do items with the Claude Code CLI already signed in on the server PC
 * (the family's own subscription, no API key). Resolves to [{ text, due }].
 */
export function claudeExtractor({ command = defaultClaude(), model = 'sonnet', effort = 'medium', timeoutMs = 120_000 } = {}) {
  // An empty folder, so the CLI doesn't pick up project files or settings from the server folder.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-homework-'));
  return (text, today) =>
    new Promise((resolve, reject) => {
      const args = ['-p', '--model', model, '--effort', effort, '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA),
        '--tools', '', '--no-session-persistence'];
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
      child.stdin.end(prompt(text, today));
    });
}

/** Without Claude: the "- ..." lines of the notice, minus obvious announcements. */
export function ruleExtract(text) {
  const items = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!/^[-;•·*]/.test(line)) continue;
    const item = line.replace(/^[-;•·*]+\s*/, '').trim();
    if (item.length < 2 || /상품|예정입니다/.test(item)) continue;
    items.push({ text: item, due: null });
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
 * Turns homework notices that a parent posts in the family chat into items on the 📚 숙제 list.
 *
 * A message counts when it contains 📢 (pasted academy notices), or when the parent follows a
 * notice with a short "유이숙제" / "숙제" message, which takes the messages they sent just before.
 * Each message is used once. Items are deduplicated against unfinished homework, so pasting the
 * same notice twice adds nothing.
 */
export function createHomework({ db, authors, assignee, extract, now, listsChanged, notify, logMessage, log = console }) {
  const userId = (username) => db.prepare('SELECT id FROM users WHERE username = ?').get(username)?.id;

  const isSource = db.prepare('SELECT 1 FROM homework_sources WHERE message_id = ?');
  const addSource = db.prepare('INSERT OR IGNORE INTO homework_sources (message_id, job, created_at) VALUES (?, ?, ?)');
  const before = db.prepare(`
    SELECT id, sender_id, text, created_at FROM messages
    WHERE conversation_id = ? AND id < ? AND deleted = 0 ORDER BY id DESC LIMIT ?`);
  const openKeys = db.prepare("SELECT dedupe FROM list_items WHERE list = 'homework' AND done = 0 AND dedupe IS NOT NULL");
  const insert = db.prepare(`
    INSERT INTO list_items (list, text, author_id, created_at, due, assignee_id, source_job, dedupe)
    VALUES ('homework', ?, ?, ?, ?, ?, ?, ?)`);

  /** The messages a "숙제" trigger refers to: the sender's own messages in the few minutes before it. */
  function noticeBefore(trigger) {
    const found = [];
    let after = trigger.createdAt;
    for (const row of before.all(GROUP_ID, trigger.id, 10)) {
      if (after - row.created_at > GAP) break;
      // Someone else chiming in between the notice and "유이숙제" doesn't end it.
      if (row.sender_id !== trigger.senderId || !row.text || row.text.startsWith(BOT)) continue;
      if (TRIGGER.test(row.text)) break;
      if (!isSource.get(row.id)) found.unshift(row);
      after = row.created_at;
      if (found.length >= MAX_SOURCES) break;
    }
    return found;
  }

  let queue = Promise.resolve();

  /** Called for every text message a person sends. */
  function onMessage(message) {
    if (message.conversationId !== GROUP_ID || message.kind !== 'text' || !message.text) return;
    const allowed = authors.map(userId).filter(Boolean);
    if (!allowed.includes(message.senderId)) return;
    let sources;
    if (TRIGGER.test(message.text)) sources = noticeBefore(message);
    else if (message.text.includes(NOTICE)) sources = [{ id: message.id, text: message.text }];
    else return;
    if (!sources.length) return;
    // Claim the messages now, so a 📢 notice followed by "유이숙제" is handled once.
    const job = sources[0].id;
    for (const s of sources) addSource.run(s.id, job, Date.now());
    const text = sources.map((s) => s.text).join('\n\n');
    queue = queue.then(() => run(job, text, message.senderId)).catch((e) => log.warn('숙제 정리 실패:', e));
    return queue;
  }

  async function run(job, text, authorId) {
    let items;
    let fallback = false;
    try {
      items = await extract(text, now());
    } catch (e) {
      log.warn('Claude로 숙제를 정리하지 못해 원문 줄을 그대로 씁니다:', e.message);
      items = ruleExtract(text);
      fallback = true;
    }
    const assigneeId = userId(assignee) ?? null;
    const seen = new Set(openKeys.all().map((r) => r.dedupe));
    const added = [];
    for (const item of items.slice(0, MAX_ITEMS)) {
      const itemText = typeof item?.text === 'string' ? item.text.trim().slice(0, 200) : '';
      const key = dedupeKey(itemText);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const due = validDate(item.due) ? item.due : null;
      insert.run(itemText, authorId, Date.now(), due, assigneeId, job, key);
      added.push({ text: itemText, due });
    }
    if (!added.length) {
      if (items.length) logMessage(authorId, '📚 이미 숙제 목록에 있는 내용이에요.');
      else logMessage(authorId, '📚 숙제 항목을 찾지 못했어요. 목록에 직접 적어 주세요.');
      return added;
    }
    listsChanged();
    const lines = added.map((i) => `• ${i.text}${i.due ? ` (~${Number(i.due.slice(5, 7))}/${Number(i.due.slice(8))})` : ''}`);
    logMessage(authorId, `📚 숙제 ${added.length}개를 목록에 넣었어요${fallback ? ' (원문 그대로)' : ''}\n${lines.join('\n')}`);
    if (assigneeId) {
      notify([assigneeId], { title: `📚 새 숙제 ${added.length}개`, body: added.map((i) => i.text).join(', '), url: '/#/lists', tag: `homework-${job}` });
    }
    return added;
  }

  return { onMessage, idle: () => queue };
}

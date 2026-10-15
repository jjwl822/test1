const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const LISTS = ['shopping', 'todo'];

const pad = (n) => String(n).padStart(2, '0');
/** YYYY-MM-DD in the server's local time zone. */
export const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function validDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/**
 * Family calendar (with day-before and same-day reminders), "1년 전 오늘" memory reminders,
 * and the shared shopping / to-do lists.
 */
export function registerFamilyRoutes(app, { db, auth, broadcastAll, sendTo, connectedUserIds, now, reminderHour }) {
  // ---- Calendar -------------------------------------------------------------------------------

  const EVENT_SELECT = `
    SELECT e.*, u.display_name AS author_name FROM events e JOIN users u ON u.id = e.author_id`;
  const toEvent = (row) => ({
    id: row.id,
    title: row.title,
    date: row.date,
    time: row.time ?? null,
    note: row.note,
    yearly: Boolean(row.yearly),
    authorId: row.author_id,
    authorName: row.author_name,
    createdAt: row.created_at,
  });

  function parseEvent(body) {
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const note = typeof body?.note === 'string' ? body.note.trim() : '';
    const time = body?.time == null || body.time === '' ? null : body.time;
    if (!title || title.length > 100) return { error: '일정 제목을 입력하세요.' };
    if (!validDate(body?.date)) return { error: '날짜가 올바르지 않습니다.' };
    if (time !== null && (typeof time !== 'string' || !TIME.test(time))) return { error: '시간이 올바르지 않습니다.' };
    if (note.length > 1000) return { error: '메모가 너무 깁니다.' };
    return { title, date: body.date, time, note, yearly: body?.yearly ? 1 : 0 };
  }

  const eventsChanged = () => broadcastAll({ type: 'events' });

  app.get('/api/events', auth, (_req, res) => {
    res.json(db.prepare(`${EVENT_SELECT} ORDER BY e.date, e.time`).all().map(toEvent));
  });

  app.post('/api/events', auth, (req, res) => {
    const e = parseEvent(req.body);
    if (e.error) return res.status(400).json({ error: e.error });
    const { lastInsertRowid } = db
      .prepare('INSERT INTO events (title, date, time, note, yearly, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(e.title, e.date, e.time, e.note, e.yearly, req.user.id, Date.now());
    eventsChanged();
    res.status(201).json(toEvent(db.prepare(`${EVENT_SELECT} WHERE e.id = ?`).get(lastInsertRowid)));
  });

  // The calendar is shared, so anyone in the family can fix or remove an event.
  app.patch('/api/events/:id', auth, (req, res) => {
    const id = Number(req.params.id) || 0;
    if (!db.prepare('SELECT 1 FROM events WHERE id = ?').get(id)) return res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
    const e = parseEvent(req.body);
    if (e.error) return res.status(400).json({ error: e.error });
    db.prepare('UPDATE events SET title = ?, date = ?, time = ?, note = ?, yearly = ? WHERE id = ?').run(
      e.title, e.date, e.time, e.note, e.yearly, id,
    );
    eventsChanged();
    res.json(toEvent(db.prepare(`${EVENT_SELECT} WHERE e.id = ?`).get(id)));
  });

  app.delete('/api/events/:id', auth, (req, res) => {
    const { changes } = db.prepare('DELETE FROM events WHERE id = ?').run(Number(req.params.id) || 0);
    if (!changes) return res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
    eventsChanged();
    res.json({ ok: true });
  });

  // ---- Reminders ------------------------------------------------------------------------------

  /** Events falling on a date; yearly ones match on month and day in any year. */
  const eventsOn = (date) =>
    db
      .prepare('SELECT * FROM events WHERE date = ? OR (yearly = 1 AND substr(date, 6) = ? AND date <= ?) ORDER BY time')
      .all(date, date.slice(5), date);

  const memoryCount = db.prepare(`
    SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM posts
    WHERE strftime('%m-%d', created_at / 1000, 'unixepoch', 'localtime') = ?
      AND strftime('%Y', created_at / 1000, 'unixepoch', 'localtime') < ?`);
  const wasSent = db.prepare('SELECT 1 FROM reminders_sent WHERE key = ?');
  const markSent = db.prepare('INSERT OR IGNORE INTO reminders_sent (key, sent_at) VALUES (?, ?)');

  /** Reminders due for today; each has a key so it's delivered once per person. */
  function dueReminders() {
    const today = now();
    if (today.getHours() < reminderHour) return [];
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const day = localDate(today);
    const reminders = [];
    const label = (e) => (e.time ? `${e.title} (${e.time})` : e.title);
    for (const e of eventsOn(day)) {
      reminders.push({ key: `event:${e.id}:${day}:today`, target: 'calendar', title: '오늘 일정', text: label(e) });
    }
    for (const e of eventsOn(localDate(tomorrow))) {
      reminders.push({ key: `event:${e.id}:${day}:tomorrow`, target: 'calendar', title: '내일 일정', text: label(e) });
    }
    const memories = memoryCount.get(day.slice(5), day.slice(0, 4));
    if (memories.n > 0) {
      const years = today.getFullYear() - new Date(memories.oldest).getFullYear();
      reminders.push({
        key: `memories:${day}`,
        target: 'feed',
        title: `${years}년 전 오늘`,
        text: `이날의 추억 ${memories.n}개가 있어요. 함께 볼까요?`,
      });
    }
    return reminders;
  }

  /** Sends anything due to a connected person who hasn't had it yet. */
  function remind(userId) {
    for (const r of dueReminders()) {
      const key = `${r.key}:user:${userId}`;
      if (wasSent.get(key)) continue;
      markSent.run(key, Date.now());
      sendTo(userId, { type: 'reminder', target: r.target, title: r.title, text: r.text });
    }
  }

  const remindAll = () => connectedUserIds().forEach(remind);
  const timer = setInterval(remindAll, 5 * 60 * 1000);
  timer.unref();

  // ---- Shared lists ---------------------------------------------------------------------------

  const ITEM_SELECT = `
    SELECT i.*, a.display_name AS author_name, d.display_name AS done_by_name
    FROM list_items i JOIN users a ON a.id = i.author_id LEFT JOIN users d ON d.id = i.done_by`;
  const toItem = (row) => ({
    id: row.id,
    list: row.list,
    text: row.text,
    done: Boolean(row.done),
    authorId: row.author_id,
    authorName: row.author_name,
    doneByName: row.done_by_name ?? null,
    createdAt: row.created_at,
    doneAt: row.done_at ?? null,
  });
  const itemById = db.prepare(`${ITEM_SELECT} WHERE i.id = ?`);
  const listsChanged = () => broadcastAll({ type: 'lists' });
  const itemText = (value) => (typeof value === 'string' ? value.trim() : '');

  app.get('/api/lists/items', auth, (_req, res) => {
    res.json(db.prepare(`${ITEM_SELECT} ORDER BY i.done, i.id DESC`).all().map(toItem));
  });

  app.post('/api/lists/items', auth, (req, res) => {
    const text = itemText(req.body?.text);
    if (!LISTS.includes(req.body?.list)) return res.status(400).json({ error: '잘못된 목록입니다.' });
    if (!text || text.length > 200) return res.status(400).json({ error: '내용을 입력하세요.' });
    const { lastInsertRowid } = db
      .prepare('INSERT INTO list_items (list, text, author_id, created_at) VALUES (?, ?, ?, ?)')
      .run(req.body.list, text, req.user.id, Date.now());
    listsChanged();
    res.status(201).json(toItem(itemById.get(lastInsertRowid)));
  });

  // Body: { done?: boolean, text?: string }
  app.patch('/api/lists/items/:id', auth, (req, res) => {
    const id = Number(req.params.id) || 0;
    if (!itemById.get(id)) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
    if (typeof req.body?.done === 'boolean') {
      db.prepare('UPDATE list_items SET done = ?, done_by = ?, done_at = ? WHERE id = ?').run(
        req.body.done ? 1 : 0,
        req.body.done ? req.user.id : null,
        req.body.done ? Date.now() : null,
        id,
      );
    }
    if (req.body?.text !== undefined) {
      const text = itemText(req.body.text);
      if (!text || text.length > 200) return res.status(400).json({ error: '내용을 입력하세요.' });
      db.prepare('UPDATE list_items SET text = ? WHERE id = ?').run(text, id);
    }
    listsChanged();
    res.json(toItem(itemById.get(id)));
  });

  app.delete('/api/lists/items/:id', auth, (req, res) => {
    const { changes } = db.prepare('DELETE FROM list_items WHERE id = ?').run(Number(req.params.id) || 0);
    if (!changes) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
    listsChanged();
    res.json({ ok: true });
  });

  app.post('/api/lists/:list/clear-done', auth, (req, res) => {
    if (!LISTS.includes(req.params.list)) return res.status(400).json({ error: '잘못된 목록입니다.' });
    const { changes } = db.prepare('DELETE FROM list_items WHERE list = ? AND done = 1').run(req.params.list);
    listsChanged();
    res.json({ removed: changes });
  });

  return {
    remind,
    stop: () => clearInterval(timer),
  };
}

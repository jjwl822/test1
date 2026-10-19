import { LAPS, MAX_RACERS, CARS, TRACKS, trackById } from '../web/games/race/tracks.js';

const BOT_NAMES = ['토끼봇', '거북봇', '여우봇', '곰돌봇', '펭귄봇', '고양봇', '판다봇'];
const SEND_EVERY = 66; // ms between position broadcasts during a race (~15 per second)
const COUNTDOWN = 4000; // ms from "start" to the green light
const AFTER_FIRST = 30_000; // ms the others get after the first person finishes
const ALL_HOME = 4000; // ms after the last person finishes until the results
const MAX_BOTS = MAX_RACERS - 1;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const round2 = (v) => Math.round(num(v) * 100) / 100;

/**
 * 가족 레이스 방 (WebSocket /ws/race). There is one room for the whole family: whoever opens the game
 * joins it. The first one in is the host and picks the track and how many computer cars race.
 * Phones drive their own car and report where it is; the server passes positions on to everyone,
 * keeps the finishing order and saves finish times. The host's phone also drives the computer cars.
 */
export function createRace({ db, now = Date.now }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS race_results (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      track      TEXT NOT NULL,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      time_ms    INTEGER NOT NULL,
      car        TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_race_results ON race_results(track, user_id);
  `);

  /** id ('u<userId>') -> { id, userId, name, car, ready, ws } in the order they came in */
  const players = new Map();
  const settings = { track: TRACKS[0].id, bots: 3 };
  let race = null;
  let ticker = null;

  const hostId = () => players.keys().next().value ?? null;

  function send(ws, msg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }
  function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const p of players.values()) if (p.ws.readyState === p.ws.OPEN) p.ws.send(data);
  }

  function roomState() {
    return {
      t: 'room',
      phase: race ? (now() < race.startAt ? 'countdown' : 'race') : 'lobby',
      hostId: hostId(),
      track: settings.track,
      bots: settings.bots,
      players: [...players.values()].map((p) => ({ id: p.id, name: p.name, car: p.car, ready: p.ready })),
      race: race && {
        track: race.track,
        startAt: race.startAt,
        endAt: race.endAt,
        racers: race.racers.map(racerInfo),
      },
    };
  }
  const sendRoom = () => broadcast(roomState());
  const racerInfo = (r) => ({ id: r.id, name: r.name, car: r.car, bot: r.bot, slot: r.slot });

  function records() {
    const rows = db
      .prepare(
        `SELECT r.track, r.user_id, u.display_name AS name, MIN(r.time_ms) AS best, r.car, COUNT(*) AS plays
         FROM race_results r JOIN users u ON u.id = r.user_id
         GROUP BY r.track, r.user_id ORDER BY r.track, best`,
      )
      .all();
    const out = {};
    for (const t of TRACKS) out[t.id] = [];
    for (const r of rows) {
      out[r.track]?.push({ userId: r.user_id, name: r.name, best: r.best, car: r.car, plays: r.plays });
    }
    return out;
  }

  function start() {
    const def = trackById(settings.track);
    const humans = [...players.values()].slice(0, MAX_RACERS);
    const botCount = Math.min(settings.bots, MAX_RACERS - humans.length);
    const used = new Set(humans.map((p) => p.car));
    const freeCars = CARS.map((c) => c.id).filter((id) => !used.has(id));
    const racers = [
      ...humans.map((p) => ({ id: p.id, userId: p.userId, name: p.name, car: p.car, bot: false })),
      ...Array.from({ length: botCount }, (_, k) => ({
        id: `b${k}`,
        name: BOT_NAMES[k % BOT_NAMES.length],
        car: freeCars.length ? freeCars[k % freeCars.length] : CARS[k % CARS.length].id,
        bot: true,
      })),
    ];
    // Random grid
    const order = racers.map((_, k) => k).sort(() => Math.random() - 0.5);
    order.forEach((k, slot) => (racers[k].slot = slot));
    for (const r of racers) {
      r.state = null;
      r.finished = false;
      r.time = null;
      r.gone = false;
    }
    const startAt = now() + COUNTDOWN;
    race = {
      track: def.id,
      laps: LAPS,
      startAt,
      endAt: null,
      // Nobody can take forever: three times the normal race time after the start.
      hardEnd: startAt + def.targetSec * 3000,
      botHost: hostId(),
      racers,
      order: [],
    };
    for (const p of players.values()) p.ready = false;
    broadcast({ t: 'start', track: def.id, laps: LAPS, startAt, botHost: race.botHost, racers: racers.map(racerInfo) });
    sendRoom();
    ticker = setInterval(tick, SEND_EVERY);
  }

  function tick() {
    if (!race) return;
    const t = now();
    const p = {};
    for (const r of race.racers) if (r.state && !r.gone) p[r.id] = r.state;
    broadcast({ t: 'st', now: t, p });
    const humans = race.racers.filter((r) => !r.bot && !r.gone);
    // Once every person is home, a few seconds to see the finish before the results.
    if (humans.length && humans.every((r) => r.finished) && !race.allHome) {
      race.allHome = true;
      race.endAt = Math.min(race.endAt ?? Infinity, t + ALL_HOME);
      broadcast({ t: 'end', endAt: race.endAt });
    }
    if (!humans.length || (race.endAt && t >= race.endAt) || t >= race.hardEnd) finishRace();
  }

  function finishRace() {
    clearInterval(ticker);
    ticker = null;
    const done = race;
    race = null;
    const prog = (r) => (r.state ? num(r.state[5]) : -Infinity);
    const finished = done.racers.filter((r) => r.finished).sort((a, b) => a.time - b.time);
    const rest = done.racers.filter((r) => !r.finished && !r.gone).sort((a, b) => prog(b) - prog(a));
    const list = [...finished, ...rest].map((r, i) => ({ ...racerInfo(r), rank: i + 1, time: r.time }));
    const insert = db.prepare(
      'INSERT INTO race_results (track, user_id, time_ms, car, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    const before = records()[done.track] ?? [];
    const newBest = [];
    for (const r of finished) {
      if (r.bot || !r.userId) continue;
      insert.run(done.track, r.userId, Math.round(r.time), r.car, now());
      const old = before.find((b) => b.userId === r.userId);
      if (!old || r.time < old.best) newBest.push(r.id);
    }
    broadcast({ t: 'results', track: done.track, list, newBest, records: records() });
    sendRoom();
  }

  /** Takes a person out of the running race (and the computer cars their phone was driving). */
  function dropRacers(id) {
    for (const r of race.racers) {
      if (r.gone || !(r.id === id || (r.bot && race.botHost === id))) continue;
      r.gone = true;
      broadcast({ t: 'gone', id: r.id });
    }
  }

  function onMessage(player, msg) {
    const isHost = hostId() === player.id;
    switch (msg.t) {
      case 'ping':
        return send(player.ws, { t: 'pong', c: msg.c, s: now() });
      case 'car':
        if (CARS.some((c) => c.id === msg.car)) player.car = msg.car;
        return race ? undefined : sendRoom();
      case 'settings':
        if (!isHost || race) return;
        if (trackById(msg.track)) settings.track = msg.track;
        if (Number.isInteger(msg.bots)) settings.bots = Math.max(0, Math.min(MAX_BOTS, msg.bots));
        return sendRoom();
      case 'ready':
        if (race) return;
        player.ready = Boolean(msg.ready);
        return sendRoom();
      case 'start': {
        if (!isHost || race) return;
        const others = [...players.values()].filter((p) => p.id !== player.id);
        if (others.some((p) => !p.ready)) return send(player.ws, { t: 'notice', text: '모두 준비해야 시작할 수 있어요.' });
        return start();
      }
      case 'st': {
        if (!race) return;
        const me = race.racers.find((r) => r.id === player.id && !r.gone);
        if (me && Array.isArray(msg.s)) me.state = msg.s.slice(0, 9).map(round2);
        if (player.id === race.botHost && msg.b && typeof msg.b === 'object') {
          for (const r of race.racers) {
            if (r.bot && Array.isArray(msg.b[r.id])) r.state = msg.b[r.id].slice(0, 9).map(round2);
          }
        }
        return;
      }
      case 'leave':
        if (race) dropRacers(player.id);
        return;
      case 'fin': {
        if (!race || now() < race.startAt) return;
        const id = msg.id && player.id === race.botHost ? msg.id : player.id;
        const r = race.racers.find((x) => x.id === id && !x.gone);
        if (!r || r.finished) return;
        const time = num(msg.time);
        // A lap can't be done in a few seconds; ignore nonsense.
        if (time < 10_000 || time > race.hardEnd - race.startAt + 5000) return;
        r.finished = true;
        r.time = time;
        race.order.push(r.id);
        // The clock for everyone else starts when the first person (not a computer car) finishes.
        if (!race.endAt && !r.bot) race.endAt = now() + AFTER_FIRST;
        return broadcast({ t: 'fin', id: r.id, name: r.name, time, rank: race.order.length, endAt: race.endAt });
      }
      default:
    }
  }

  function connect(ws, user) {
    const id = `u${user.id}`;
    // The same person opening the game again (another tab, reconnect) replaces the old connection.
    const old = players.get(id);
    if (old) {
      old.replaced = true;
      old.ws.close(4000, 'replaced');
    }
    const used = new Set([...players.values()].map((p) => p.car));
    const player = {
      id,
      userId: user.id,
      name: user.displayName,
      car: old?.car ?? CARS.find((c) => !used.has(c.id))?.id ?? CARS[0].id,
      ready: false,
      ws,
    };
    players.delete(id); // re-insert keeps the host order sensible after a reconnect
    players.set(id, player);
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('message', (data) => {
      if (data.length > 8000) return;
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg && typeof msg === 'object') onMessage(player, msg);
    });
    ws.on('close', () => {
      if (players.get(id) !== player) return;
      players.delete(id);
      if (race) dropRacers(id);
      sendRoom();
    });
    send(ws, { t: 'welcome', you: id, now: now() });
    sendRoom();
    // Someone opening the game during a race sees it running and waits for the next one.
    if (race) send(ws, { t: 'watch', track: race.track, startAt: race.startAt, racers: race.racers.map(racerInfo) });
  }

  const heartbeat = setInterval(() => {
    for (const p of players.values()) {
      if (!p.ws.isAlive) {
        p.ws.terminate();
        continue;
      }
      p.ws.isAlive = false;
      p.ws.ping();
    }
  }, 20_000);

  function stop() {
    clearInterval(heartbeat);
    clearInterval(ticker);
    for (const p of players.values()) p.ws.terminate();
  }

  return { connect, records, stop };
}

export function registerRaceRoutes(app, { auth, race }) {
  app.get('/api/race/records', auth, (_req, res) => res.json({ tracks: race.records() }));
}

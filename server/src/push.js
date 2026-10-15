import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';

/**
 * Web push for the iPhone/PC web app: notifications that arrive while the web app is closed.
 * Keys (VAPID) are created on first start and kept in data/vapid.json.
 */
export function createPush({
  db,
  dataDir,
  isVisible,
  subject = process.env.VAPID_SUBJECT || 'mailto:family-messenger@example.com',
  // Tests replace the network call; everything up to it (keys, encryption) is the real thing.
  send = webpush.sendNotification,
}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint   TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      p256dh     TEXT NOT NULL,
      auth       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  const keyFile = path.join(dataDir, 'vapid.json');
  let keys;
  try {
    keys = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  } catch {
    keys = webpush.generateVAPIDKeys();
    fs.writeFileSync(keyFile, JSON.stringify(keys, null, 2));
  }
  const options = { vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 24 * 60 * 60 };

  const forUser = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?');
  const drop = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');

  return {
    publicKey: keys.publicKey,

    subscribe(userId, sub) {
      const endpoint = sub?.endpoint;
      const p256dh = sub?.keys?.p256dh;
      const auth = sub?.keys?.auth;
      if (typeof endpoint !== 'string' || !/^https?:\/\//.test(endpoint) || typeof p256dh !== 'string' || typeof auth !== 'string') {
        return false;
      }
      db.prepare(
        `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
      ).run(endpoint, userId, p256dh, auth, Date.now());
      return true;
    },

    unsubscribe(endpoint) {
      drop.run(String(endpoint ?? ''));
    },

    userIds: () => db.prepare('SELECT DISTINCT user_id FROM push_subscriptions').all().map((r) => r.user_id),

    /**
     * Sends { title, body, url, tag } to each person's devices — unless they have the app open
     * right now, in which case they already see it.
     */
    async notify(userIds, payload) {
      const data = JSON.stringify(payload);
      const sends = [];
      for (const userId of new Set(userIds)) {
        if (isVisible(userId)) continue;
        for (const s of forUser.all(userId)) {
          const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
          sends.push(
            Promise.resolve(send(subscription, data, options)).catch((err) => {
              // The phone unsubscribed or the app was removed.
              if (err.statusCode === 404 || err.statusCode === 410) drop.run(s.endpoint);
              else console.warn('push failed:', err.statusCode ?? err.message);
            }),
          );
        }
      }
      await Promise.all(sends);
    },
  };
}

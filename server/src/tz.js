// The family lives in Korea, whatever time zone the server PC is set to: dates ("오늘", due dates)
// and reminder hours follow TZ (data/config.json "timeZone", default Asia/Seoul).
// Imported first by index.js, before anything reads the clock.
import fs from 'node:fs';
import path from 'node:path';

let zone = process.env.TZ;
if (!zone) {
  try {
    zone = JSON.parse(fs.readFileSync(path.join(path.resolve(process.env.DATA_DIR || 'data'), 'config.json'), 'utf8')).timeZone;
  } catch {}
}
process.env.TZ = zone || 'Asia/Seoul';

/**
 * SQLite modifier for the server's local time. SQLite's own 'localtime' uses the Windows time zone
 * and ignores TZ, so the offset is passed in instead.
 */
export const localModifier = () => `${-new Date().getTimezoneOffset()} minutes`;

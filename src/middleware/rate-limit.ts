import { RATE_LIMITS } from '../constants';
import { firstRow } from '../db';

export async function checkRateLimit(db: D1Database, ip: string, key: string): Promise<boolean> {
  const limit = RATE_LIMITS[key] || RATE_LIMITS['default:GET'];
  const [max, window] = limit;
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - window;

  const existing = await firstRow<{ count: number; window_start: number }>(
    db,
    'SELECT count, window_start FROM rate_limits WHERE ip = ? AND key = ?',
    ip, key,
  );

  if (!existing) {
    await db.prepare(
      'INSERT INTO rate_limits (ip, key, count, window_start) VALUES (?, ?, 1, ?)',
    ).bind(ip, key, now).run();
    return true;
  }

  if (existing.window_start < cutoff) {
    // Window expired: reset the count for this new window
    await db.prepare(
      'UPDATE rate_limits SET count = 1, window_start = ? WHERE ip = ? AND key = ?',
    ).bind(now, ip, key).run();
    return true;
  }

  if (existing.count >= max) return false;

  await db.prepare(
    'UPDATE rate_limits SET count = count + 1 WHERE ip = ? AND key = ?',
  ).bind(ip, key).run();

  return true;
}

export async function cleanupRateLimits(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(Math.floor(Date.now() / 1000) - 300).run();
}

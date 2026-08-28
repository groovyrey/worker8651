import type { Route } from '../types';
import { json, error, clamp, getLimit } from '../utils/http';
import { rows, firstRow } from '../db';
import { adminOk } from '../utils/admin';
import { checkRateLimit } from '../middleware/rate-limit';

const TABLE = 'messages';

export const messagesRoute: Route = async (request, env) => {
  const url = new URL(request.url);
  if (url.pathname !== '/api/messages') return null;

  const { method } = request;
  const db = env.DB;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  if (method === 'GET') {
    if (!(await checkRateLimit(db, ip, 'default:GET'))) {
      return error('Rate limit exceeded', 429);
    }
    const list = await rows(
      db,
      `SELECT id, name, text, created_at FROM ${TABLE} ORDER BY id DESC LIMIT ?`,
      getLimit(url),
    );
    return json({ count: list.length, messages: list });
  }

  if (method === 'POST') {
    if (!(await checkRateLimit(db, ip, 'default:POST'))) {
      return error('Rate limit exceeded', 429);
    }
    let body: any;
    try {
      body = await request.json();
    } catch {
      return error('Request body must be valid JSON', 400);
    }
    const name = clamp(body?.name, 60);
    const text = clamp(body?.text, 500);
    if (!name || !text) {
      return error("Fields 'name' and 'text' are required (max 60 / 500 chars)", 400);
    }
    const created = await firstRow(
      db,
      `INSERT INTO ${TABLE} (name, text) VALUES (?, ?) RETURNING id, name, text, created_at`,
      name,
      text,
    );
    if (!created) return error('Insert failed', 500);
    return json({ created }, 201);
  }

  if (method === 'DELETE') {
    if (!adminOk(env, request.headers.get('X-Admin-Key'))) {
      return error('Unauthorized', 401);
    }
    await rows(db, `DELETE FROM ${TABLE} RETURNING id`);
    return json({ deleted: 'all' });
  }

  return null;
};

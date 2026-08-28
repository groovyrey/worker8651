import type { Route } from '../types';
import { json, error } from '../utils/http';
import { rows } from '../db';
import { adminOk } from '../utils/admin';
import { checkRateLimit } from '../middleware/rate-limit';

export const adminRoute: Route = async (request, env) => {
  const url = new URL(request.url);
  if (url.pathname !== '/api/groovyrey/admin/comments' || request.method !== 'GET') return null;

  if (!adminOk(env, request.headers.get('X-Admin-Key'))) {
    return error('Unauthorized', 401);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await checkRateLimit(env.DB, ip, 'admin:GET'))) {
    return error('Rate limit exceeded', 429);
  }

  const list = await rows(
    env.DB,
    'SELECT id, name, text, ip, photo, created_at FROM groovyrey_comments ORDER BY created_at DESC, id DESC',
  );
  return json({ count: list.length, comments: list });
};

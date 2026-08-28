import type { Env, Route } from '../types';
import { json, error, clamp, getLimit } from '../utils/http';
import { rows, firstRow } from '../db';
import { adminOk } from '../utils/admin';
import { checkRateLimit } from '../middleware/rate-limit';

const TABLE = 'groovyrey_comments';
const PHOTOS_PREFIX = '/api/groovyrey/photos/';

export const commentsRoute: Route = async (request, env) => {
  const url = new URL(request.url);
  const { pathname } = url;
  const { method } = request;

  if (pathname.startsWith(PHOTOS_PREFIX) && method === 'GET') {
    return servePhoto(env.R2, pathname);
  }

  if (pathname !== '/api/groovyrey/comments') return null;
  return handleComments(request, env, method);
};

async function servePhoto(r2: R2Bucket, pathname: string): Promise<Response> {
  const key = decodeURIComponent(pathname.slice(PHOTOS_PREFIX.length));
  if (!key || key.includes('..')) return error('Not found', 404);
  const obj = await r2.get(key);
  if (!obj) return error('Not found', 404);
  const headers = new Headers({
    'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
    'Cache-Control': 'public, max-age=86400',
  });
  return new Response(obj.body, { headers });
}

async function handleComments(request: Request, env: Env, method: string): Promise<Response | null> {
  const db = env.DB;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  if (method === 'GET') {
    if (!(await checkRateLimit(db, ip, 'default:GET'))) {
      return error('Rate limit exceeded', 429);
    }
    const url = new URL(request.url);
    const list = await rows(
      db,
      `SELECT id, name, text, photo, created_at FROM ${TABLE} ORDER BY created_at DESC, id DESC LIMIT ?`,
      getLimit(url),
    );
    return json({ count: list.length, comments: list });
  }

  if (method === 'POST') {
    return postComment(request, db, env.R2, ip);
  }

  if (method === 'DELETE') {
    return deleteComment(request, env);
  }

  return null;
}

async function deleteComment(request: Request, env: Env): Promise<Response> {
  if (!adminOk(env, request.headers.get('X-Admin-Key'))) {
    return error('Unauthorized', 401);
  }

  const url = new URL(request.url);
  const rawId = url.searchParams.get('id');
  const db = env.DB;

  if (rawId === 'all') {
    const toDelete = await rows(db, `SELECT photo FROM ${TABLE} WHERE photo IS NOT NULL`);
    await Promise.all(toDelete.map(r => env.R2.delete(r.photo as string).catch(() => {})));
    await rows(db, `DELETE FROM ${TABLE} RETURNING id`);
    return json({ deleted: 'all' });
  }

  if (rawId !== null && /^\d+$/.test(rawId)) {
    const nid = parseInt(rawId, 10);
    const row = await firstRow<{ photo: string | null }>(db, `SELECT photo FROM ${TABLE} WHERE id = ?`, nid);
    if (row?.photo) await env.R2.delete(row.photo).catch(() => {});
    const deleted = await rows(db, `DELETE FROM ${TABLE} WHERE id = ? RETURNING id`, nid);
    return json({ deleted: deleted.length });
  }

  return error(`Specify ?id=<row id> or ?id=all to delete all ${TABLE}`, 400);
}

async function postComment(request: Request, db: D1Database, r2: R2Bucket, ip: string): Promise<Response> {
  if (!(await checkRateLimit(db, ip, 'comments:POST'))) {
    return error('Rate limit exceeded', 429);
  }

  const contentType = request.headers.get('Content-Type') || '';
  const isMultipart = contentType.includes('multipart/form-data');
  const isJson = contentType.includes('application/json');
  if (!isMultipart && !isJson) {
    return error('Content-Type must be multipart/form-data or application/json', 415);
  }

  let name: string = '';
  let text: string = '';
  let honeypot = '';
  let file: File | null = null;

  if (isMultipart) {
    const form = await request.formData().catch(() => null);
    if (!form) return error('Invalid form data', 400);
    name = clamp(String(form.get('name') ?? ''), 40) || 'Anonymous';
    text = clamp(String(form.get('text') ?? ''), 500);
    honeypot = String(form.get('honeypot') ?? '');
    const f = form.get('photo');
    if (f instanceof File && f.size > 0) file = f;
  } else {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return error('Request body must be valid JSON', 400);
    }
    if (body?.honeypot) honeypot = body.honeypot;
    name = clamp(body?.name, 40) || 'Anonymous';
    text = clamp(body?.text, 500);
  }

  if (honeypot) return json({ ok: true });
  if (!text) return error("Field 'text' is required (max 500 chars)", 400);

  if (file) {
    if (file.size > 2 * 1024 * 1024) return error('Photo must be under 2MB', 413);
    if (!file.type.startsWith('image/')) return error('Photo must be an image', 415);
  }

  const existing = await firstRow<{ id: number }>(
    db,
    `SELECT id FROM ${TABLE} WHERE ip = ? LIMIT 1`,
    ip,
  );
  if (existing) {
    return error('You already commented', 409);
  }

  let photoKey: string | null = null;
  if (file) {
    photoKey = `${Date.now()}-${crypto.randomUUID()}`;
    const ext = (file.type.split('/')[1] || 'jpeg').replace(/[^a-z0-9]/gi, '');
    photoKey = `${photoKey}.${ext}`;
    await r2.put(photoKey, file.stream() as any, {
      httpMetadata: { contentType: file.type },
    });
  }

  const created = await firstRow(
    db,
    photoKey
      ? `INSERT INTO ${TABLE} (name, text, ip, photo) VALUES (?, ?, ?, ?) RETURNING id, name, text, photo, created_at`
      : `INSERT INTO ${TABLE} (name, text, ip) VALUES (?, ?, ?) RETURNING id, name, text, photo, created_at`,
    ...(photoKey ? [name, text, ip, photoKey] : [name, text, ip]),
  );
  if (!created) {
    if (photoKey) await r2.delete(photoKey).catch(() => {});
    return error('Insert failed', 500);
  }
  return json({ created }, 201);
}

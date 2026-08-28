/**
 * cfworker — TypeScript port (V8 isolate, no pyodide cold-start tax).
 *
 * Security model:
 * - Admin auth via X-Admin-Key header only (never query strings)
 * - Bulk deletes require an explicit ?id=all
 * - Browser origins restricted to the production site (+ localhost for dev)
 * - Internal error details go to logs, never to responses
 * - Rate limiting via D1 (sliding window per IP)
 * - One comment per IP
 */

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  ADMIN_KEY?: string;
  GREETING?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

const ALLOWED_ORIGIN = 'https://groovyrey.github.io';
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const CORS_METHODS = 'GET, POST, DELETE, OPTIONS';
const CORS_HEADERS = 'Content-Type, X-Admin-Key';

// Rate limits: [max requests, window in seconds]
const RATE_LIMITS: Record<string, [number, number]> = {
  'comments:POST': [3, 60],       // 3 comments per minute
  'admin:GET': [30, 60],          // 30 admin reads per minute
  'gemini:POST': [10, 60],        // 10 Gemini calls per minute
  'default:GET': [60, 60],        // 60 GET requests per minute
  'default:POST': [20, 60],       // 20 POST requests per minute
};

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true;
  return origin === ALLOWED_ORIGIN || LOCAL_ORIGIN.test(origin);
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': CORS_METHODS,
    'Access-Control-Allow-Headers': CORS_HEADERS,
    Vary: 'Origin',
  };
  if (origin && isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function error(message: string, status: number): Response {
  return json({ error: message }, status);
}

function clamp(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, limit);
}

function getLimit(url: URL): number {
  const raw = url.searchParams.get('limit');
  if (raw === null) return 50;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return 50;
  return Math.max(1, Math.min(n, 100));
}

function adminOk(env: Env, headerKey: string | null): boolean {
  return !!env.ADMIN_KEY && !!headerKey && headerKey === env.ADMIN_KEY;
}

async function rows<T = any>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T[]> {
  const result = await db.prepare(sql).bind(...binds).all<T>();
  return result.results ?? [];
}

async function firstRow<T = any>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T | null> {
  return await db.prepare(sql).bind(...binds).first<T>();
}

async function checkRateLimit(db: D1Database, ip: string, key: string): Promise<boolean> {
  const limit = RATE_LIMITS[key] || RATE_LIMITS['default:GET'];
  const [max, window] = limit;
  const cutoff = Math.floor(Date.now() / 1000) - window;

  const existing = await firstRow<{ count: number }>(
    db,
    'SELECT COUNT(*) as count FROM rate_limits WHERE ip = ? AND key = ? AND ts > ?',
    ip, key, cutoff,
  );

  if ((existing?.count ?? 0) >= max) return false;

  await db.prepare(
    'INSERT INTO rate_limits (ip, key, ts) VALUES (?, ?, ?)',
  ).bind(ip, key, Math.floor(Date.now() / 1000)).run();

  return true;
}

async function cleanupRateLimits(db: D1Database): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - 300; // keep 5 min
  await db.prepare('DELETE FROM rate_limits WHERE ts < ?').bind(cutoff).run();
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const db = env.DB;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  if (path === '/' && method === 'GET') {
    return json({
      name: 'cfworker',
      description: 'Cloudflare Worker API written in TypeScript with D1 SQLite',
      runtime: 'workers (typescript)',
      endpoints: [
        '/',
        '/api/hello?name=Rey',
        '/api/time',
        '/api/echo (POST)',
        '/api/messages (GET, POST, DELETE)',
        '/api/groovyrey/comments (GET, POST, DELETE)',
        '/api/groovyrey/admin/comments (GET, admin-only)',
        '/api/groovyrey/gemini (POST, AI generation)',
      ],
    });
  }

  if (path === '/api/hello' && method === 'GET') {
    const name = url.searchParams.get('name') || 'world';
    const greeting = env.GREETING || 'Hello';
    return json({ message: `${greeting}, ${name}!` });
  }

  if (path === '/api/time' && method === 'GET') {
    return json({ iso: new Date().toISOString(), epoch: Date.now() });
  }

  if (path === '/api/echo' && method === 'POST') {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return error('Request body must be valid JSON', 400);
    }
    return json({ youSent: body, receivedAt: new Date().toISOString() });
  }

  if (path === '/api/messages' && method === 'GET') {
    if (!(await checkRateLimit(db, ip, 'default:GET'))) {
      return error('Rate limit exceeded', 429);
    }
    const list = await rows(
      db,
      'SELECT id, name, text, created_at FROM messages ORDER BY id DESC LIMIT ?',
      getLimit(url),
    );
    return json({ count: list.length, messages: list });
  }

  if (path === '/api/messages' && method === 'POST') {
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
      'INSERT INTO messages (name, text) VALUES (?, ?) RETURNING id, name, text, created_at',
      name,
      text,
    );
    if (!created) return error('Insert failed', 500);
    return json({ created }, 201);
  }

  if ((path === '/api/messages' || path === '/api/groovyrey/comments') && method === 'DELETE') {
    if (!adminOk(env, request.headers.get('X-Admin-Key'))) {
      return error('Unauthorized', 401);
    }

    const table = path === '/api/messages' ? 'messages' : 'groovyrey_comments';
    const rawId = url.searchParams.get('id');

    if (rawId === 'all') {
      if (path === '/api/groovyrey/comments') {
        const toDelete = await rows(db, 'SELECT photo FROM groovyrey_comments WHERE photo IS NOT NULL');
        await Promise.all(toDelete.map(r => env.R2.delete(r.photo as string).catch(() => {})));
      }
      await rows(db, `DELETE FROM ${table} RETURNING id`);
      return json({ deleted: 'all' });
    }

    if (rawId !== null && /^\d+$/.test(rawId)) {
      const nid = parseInt(rawId, 10);
      if (path === '/api/groovyrey/comments') {
        const row = await firstRow<{ photo: string | null }>(db, 'SELECT photo FROM groovyrey_comments WHERE id = ?', nid);
        if (row?.photo) await env.R2.delete(row.photo).catch(() => {});
      }
      const deleted = await rows(db, `DELETE FROM ${table} WHERE id = ? RETURNING id`, nid);
      return json({ deleted: deleted.length });
    }

    return error(`Specify ?id=<row id> or ?id=all to delete all ${table}`, 400);
  }

  if (path === '/api/groovyrey/comments' && method === 'GET') {
    if (!(await checkRateLimit(db, ip, 'default:GET'))) {
      return error('Rate limit exceeded', 429);
    }
    const list = await rows(
      db,
      'SELECT id, name, text, photo, created_at FROM groovyrey_comments ORDER BY created_at DESC, id DESC LIMIT ?',
      getLimit(url),
    );
    return json({ count: list.length, comments: list });
  }

  if (path.startsWith('/api/groovyrey/photos/') && method === 'GET') {
    const key = decodeURIComponent(path.slice('/api/groovyrey/photos/'.length));
    if (!key || key.includes('..')) return error('Not found', 404);
    const obj = await env.R2.get(key);
    if (!obj) return error('Not found', 404);
    const headers = new Headers({
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400',
    });
    return new Response(obj.body, { headers });
  }

  if (path === '/api/groovyrey/comments' && method === 'POST') {
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
      'SELECT id FROM groovyrey_comments WHERE ip = ? LIMIT 1',
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
      await env.R2.put(photoKey, file.stream() as any, {
        httpMetadata: { contentType: file.type },
      });
    }

    const created = await firstRow(
      db,
      photoKey
        ? 'INSERT INTO groovyrey_comments (name, text, ip, photo) VALUES (?, ?, ?, ?) RETURNING id, name, text, photo, created_at'
        : 'INSERT INTO groovyrey_comments (name, text, ip) VALUES (?, ?, ?) RETURNING id, name, text, photo, created_at',
      ...(photoKey ? [name, text, ip, photoKey] : [name, text, ip]),
    );
    if (!created) {
      if (photoKey) await env.R2.delete(photoKey).catch(() => {});
      return error('Insert failed', 500);
    }
    return json({ created }, 201);
  }

  if (path === '/api/groovyrey/admin/comments' && method === 'GET') {
    if (!adminOk(env, request.headers.get('X-Admin-Key'))) {
      return error('Unauthorized', 401);
    }
    if (!(await checkRateLimit(db, ip, 'admin:GET'))) {
      return error('Rate limit exceeded', 429);
    }
    const list = await rows(
      db,
      'SELECT id, name, text, ip, photo, created_at FROM groovyrey_comments ORDER BY created_at DESC, id DESC',
    );
    return json({ count: list.length, comments: list });
  }

  if (path === '/api/groovyrey/gemini' && method === 'POST') {
    if (!env.GEMINI_API_KEY) {
      return error('Gemini is not configured', 503);
    }
    if (!(await checkRateLimit(db, ip, 'gemini:POST'))) {
      return error('Rate limit exceeded', 429);
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return error('Request body must be valid JSON', 400);
    }

    const prompt = typeof body?.prompt === 'string' && body.prompt.trim() ? body.prompt.trim().slice(0, 4000) : '';
    if (!prompt) {
      return error("Field 'prompt' is required (max 4000 chars)", 400);
    }

    const model = env.GEMINI_MODEL || 'gemma-4-26b-a4b-it';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const upstream = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error(`[gemini] upstream ${upstream.status}: ${detail.slice(0, 500)}`);
      return error('Upstream generation failed', 502);
    }

    const data: any = await upstream.json();
    const text = data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p?.text || '')
      .join('') || '';
    return json({ model, text });
  }

  return error(`No route for ${method} ${path}`, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');

    if (!isAllowedOrigin(origin)) {
      return new Response('Forbidden', { status: 403 });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Periodic cleanup (runs ~every 100 requests in a warm isolate)
    if (Math.random() < 0.01) {
      cleanupRateLimits(env.DB).catch(() => {});
    }

    let resp: Response;
    try {
      resp = await route(request, env);
    } catch (err: any) {
      console.error(`[cfworker] ${request.method} ${new URL(request.url).pathname}:`, err);
      resp = json({ error: 'Internal Server Error' }, 500);
    }

    const headers = new Headers(resp.headers);
    for (const [key, value] of Object.entries(corsHeaders(origin))) {
      headers.set(key, value);
    }
    return new Response(resp.body, { status: resp.status, headers });
  },
};

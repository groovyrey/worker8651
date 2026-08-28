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
 *
 * Structure:
 * - src/constants.ts        fixed config (origins, CORS, rate limits)
 * - src/types.ts            shared types (Env, Route)
 * - src/db.ts               D1 query helpers
 * - src/utils/              http, cors, admin helpers
 * - src/middleware/         cross-cutting logic (rate limiting)
 * - src/routes/             one file per API endpoint
 */
import type { Env, Route } from './types';
import { json } from './utils/http';
import { isAllowedOrigin, corsHeaders } from './utils/cors';
import { cleanupRateLimits } from './middleware/rate-limit';
import { rootRoute } from './routes/root';
import { helloRoute } from './routes/hello';
import { timeRoute } from './routes/time';
import { echoRoute } from './routes/echo';
import { messagesRoute } from './routes/messages';
import { commentsRoute } from './routes/comments';
import { adminRoute } from './routes/admin';
import { geminiRoute } from './routes/gemini';

const routes: Route[] = [
  rootRoute,
  helloRoute,
  timeRoute,
  echoRoute,
  messagesRoute,
  commentsRoute,
  adminRoute,
  geminiRoute,
];

async function dispatch(request: Request, env: Env): Promise<Response> {
  for (const route of routes) {
    const response = await route(request, env);
    if (response) return response;
  }
  const url = new URL(request.url);
  return json({ error: `No route for ${request.method} ${url.pathname}` }, 404);
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
      resp = await dispatch(request, env);
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

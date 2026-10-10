import type { Route } from '../types';
import { json } from '../utils/http';

export const rootRoute: Route = async (request) => {
  const url = new URL(request.url);
  if (url.pathname !== '/' || request.method !== 'GET') return null;

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
      '/api/groovyrey/gemini (POST, AI generation; optional system, temperature, json, maxTokens)',
    ],
  });
};

import type { Route } from '../types';
import { json, error } from '../utils/http';

export const echoRoute: Route = async (request) => {
  const url = new URL(request.url);
  if (url.pathname !== '/api/echo' || request.method !== 'POST') return null;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error('Request body must be valid JSON', 400);
  }
  return json({ youSent: body, receivedAt: new Date().toISOString() });
};

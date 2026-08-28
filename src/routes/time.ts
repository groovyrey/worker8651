import type { Route } from '../types';
import { json } from '../utils/http';

export const timeRoute: Route = async (request) => {
  const url = new URL(request.url);
  if (url.pathname !== '/api/time' || request.method !== 'GET') return null;

  return json({ iso: new Date().toISOString(), epoch: Date.now() });
};

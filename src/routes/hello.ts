import type { Route } from '../types';
import { json } from '../utils/http';

export const helloRoute: Route = async (request, env) => {
  const url = new URL(request.url);
  if (url.pathname !== '/api/hello' || request.method !== 'GET') return null;

  const name = url.searchParams.get('name') || 'world';
  const greeting = env.GREETING || 'Hello';
  return json({ message: `${greeting}, ${name}!` });
};

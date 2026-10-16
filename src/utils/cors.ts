import { ALLOWED_ORIGIN, LOCAL_ORIGIN, PRIVATE_ORIGIN, CORS_METHODS, CORS_HEADERS } from '../constants';

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin || origin === 'null') return true;
  return origin === ALLOWED_ORIGIN || LOCAL_ORIGIN.test(origin) || PRIVATE_ORIGIN.test(origin);
}

export function corsHeaders(origin: string | null): Record<string, string> {
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

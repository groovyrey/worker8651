export const ALLOWED_ORIGIN = 'https://groovyrey.github.io';
export const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
export const CORS_METHODS = 'GET, POST, DELETE, OPTIONS';
export const CORS_HEADERS = 'Content-Type, X-Admin-Key';

// Rate limits: [max requests, window in seconds]
export const RATE_LIMITS: Record<string, [number, number]> = {
  'comments:POST': [3, 60],       // 3 comments per minute
  'admin:GET': [30, 60],          // 30 admin reads per minute
  'gemini:POST': [10, 60],        // 10 Gemini calls per minute
  'default:GET': [60, 60],        // 60 GET requests per minute
  'default:POST': [20, 60],       // 20 POST requests per minute
};

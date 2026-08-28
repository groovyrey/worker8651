export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  ADMIN_KEY?: string;
  GREETING?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

// A handler returns a Response if it handled the request, or null to fall
// through to the next handler in the dispatch chain.
export type Route = (request: Request, env: Env) => Promise<Response | null>;

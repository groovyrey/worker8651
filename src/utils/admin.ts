import type { Env } from '../types';

export function adminOk(env: Env, headerKey: string | null): boolean {
  return !!env.ADMIN_KEY && !!headerKey && headerKey === env.ADMIN_KEY;
}

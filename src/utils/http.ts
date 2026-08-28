export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function error(message: string, status: number): Response {
  return json({ error: message }, status);
}

export function clamp(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, limit);
}

export function getLimit(url: URL): number {
  const raw = url.searchParams.get('limit');
  if (raw === null) return 50;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return 50;
  return Math.max(1, Math.min(n, 100));
}

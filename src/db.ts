export async function rows<T = any>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T[]> {
  const result = await db.prepare(sql).bind(...binds).all<T>();
  return result.results ?? [];
}

export async function firstRow<T = any>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T | null> {
  return await db.prepare(sql).bind(...binds).first<T>();
}

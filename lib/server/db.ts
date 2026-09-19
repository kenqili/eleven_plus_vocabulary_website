import { env } from "cloudflare:workers";
export function database(): D1Database {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new Error("Account storage is unavailable.");
  return db;
}
export function setting(key: string) {
  return (
    ((env as unknown as Record<string, unknown>)[key] as string | undefined) ||
    process.env[key] ||
    ""
  );
}

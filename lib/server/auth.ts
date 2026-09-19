import { database } from "./db";
import { HttpError } from "./http";
import { newToken, tokenDigest } from "./password";
export type User = { id: string; email: string; customer_id: string | null };
export async function currentUser(request: Request): Promise<User | null> {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("mw_session="))
    ?.slice(11);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return database()
    .prepare(
      "SELECT users.id, users.email, users.customer_id FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?",
    )
    .bind(tokenDigest(token), Date.now())
    .first<User>();
}
export async function requireUser(request: Request) {
  const user = await currentUser(request);
  if (!user) throw new HttpError(401, "Please sign in to save your progress.");
  return user;
}
export function sessionCookie(token: string, request: Request, age = 604800) {
  return `mw_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
export async function createSession(userId: string, request: Request) {
  const token = newToken();
  await database().batch([
    database()
      .prepare("DELETE FROM sessions WHERE expires_at < ?")
      .bind(Date.now()),
    database()
      .prepare(
        "INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)",
      )
      .bind(tokenDigest(token), userId, Date.now() + 604800000),
  ]);
  return sessionCookie(token, request);
}
export async function rateLimit(key: string, limit: number, windowMs = 900000) {
  const now = Date.now();
  const result = await database()
    .prepare(
      "INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN expires_at < ? THEN 1 ELSE count+1 END, expires_at = CASE WHEN expires_at < ? THEN ? ELSE expires_at END RETURNING count",
    )
    .bind(tokenDigest(key), now + windowMs, now, now, now + windowMs)
    .first<{ count: number }>();
  if (!result || result.count > limit)
    throw new HttpError(
      429,
      "Too many attempts. Please try again in 15 minutes.",
    );
}

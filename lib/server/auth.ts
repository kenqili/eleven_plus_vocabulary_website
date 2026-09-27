import { database } from "./db";
import { HttpError } from "./http";
import { newToken, tokenDigest } from "./password";
export type User = { id: string; email: string; customer_id: string | null };
export async function currentUser(request: Request): Promise<User | null> {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("mw_session=") || x.startsWith("__Host-mw_session="))
    ?.split("=")[1];
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
  if (!user)
    throw new HttpError(401, "Please sign in again to keep your progress.");
  return user;
}
/** How long a session lasts, and how long it slides for on use. */
export const SESSION_TTL_MS = 604800000;

export function sessionCookie(
  token: string,
  request: Request,
  age = SESSION_TTL_MS / 1000,
) {
  // A __Host- cookie is refused by the browser unless it is Secure, has no
  // Domain, and has Path=/, so those three cannot be broken by a later edit and
  // a subdomain cannot overwrite or read the session. The prefix is dropped in
  // local development, where there is no https and the browser would reject it
  // outright, which would leave nobody able to sign in on a laptop.
  const secure = new URL(request.url).protocol === "https:";
  const name = secure ? "__Host-mw_session" : "mw_session";
  const parts = [
    `${name}=${token}`,
    "HttpOnly",
    // Lax still permits a top-level GET, which is what an email link would be.
    // No route in this app changes state on a GET, so that is the right trade.
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${age}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
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

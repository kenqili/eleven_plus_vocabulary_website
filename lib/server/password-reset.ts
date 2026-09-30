import { database } from "./db";
import { newToken, tokenDigest } from "./password";

/**
 * How long a reset link works: one hour.
 *
 * Long enough that a parent can find the email, open it after a meeting, and
 * finish. Short enough that a link still sitting in a mailbox in a year's time
 * is already dead, which is the case that matters - it is the copy nobody is
 * looking at any more.
 */
export const RESET_TTL_MS = 60 * 60 * 1000;

/** The page the emailed link opens. It reads `?token=` and asks for a password. */
export const RESET_LINK_PATH = "/reset-password";

/**
 * Mint a reset link for an account and return the raw token, which the caller
 * emails and never stores.
 *
 * Only the digest goes into the table, so a dump of the database is not a list
 * of working reset links - the same reason sessions store a hash. A token that
 * is never used is a row, not a liability, which is what `expires_at` is for.
 */
export async function issueResetToken(userId: string): Promise<string> {
  const db = database(),
    now = Date.now(),
    token = newToken();
  await db.batch([
    // One live link per account. Asking for a second link retires the first
    // rather than leaving two in circulation: two links means a parent who
    // asked twice cannot tell which is the current one, and the older one is a
    // token sitting in an inbox neither of them is watching.
    db.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(userId),
    // Already-expired rows are not evidence of anything, and clearing them here
    // means a busy account does not accumulate them between purges.
    db.prepare("DELETE FROM password_resets WHERE expires_at < ?").bind(now),
    db
      .prepare(
        "INSERT INTO password_resets (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)",
      )
      .bind(
        crypto.randomUUID(),
        userId,
        tokenDigest(token),
        now + RESET_TTL_MS,
        now,
      ),
  ]);
  return token;
}

/**
 * The live reset row behind a token, joined to the account it would change.
 *
 * `expires_at > ?` is in the query rather than in the caller so that the
 * expiry is a condition of the lookup itself, and a caller that forgets to
 * check it cannot accept a dead link.
 */
export async function findLiveReset(token: string): Promise<{
  id: string;
  userId: string;
  email: string;
  storedHash: string;
} | null> {
  const row = await database()
    .prepare(
      "SELECT password_resets.id, password_resets.user_id, users.email, users.password AS storedHash FROM password_resets JOIN users ON users.id = password_resets.user_id WHERE password_resets.token_hash = ? AND password_resets.expires_at > ?",
    )
    .bind(tokenDigest(token), Date.now())
    .first<{
      id: string;
      user_id: string;
      email: string;
      storedHash: string;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    storedHash: row.storedHash,
  };
}

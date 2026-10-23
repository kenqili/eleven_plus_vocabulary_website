/**
 * Which accounts the retention promise has come due for.
 *
 * The privacy notice makes two promises about time: an account is deleted two
 * years after it was last used - signed into, or practised on - and a
 * registration that is never confirmed is not kept either. This file answers
 * "who is due". It deletes nothing.
 *
 * That separation is the design. Deleting an account is a manual act, taken for
 * an account somebody has looked at, and the list is what makes it possible
 * without a query against production: the address, when it was made and when it
 * was last used, on the administrator's page, next to the button.
 *
 * The list is deliberately not a count. A rule applied to rows nobody read is
 * how an account in use disappears; a person reading the date is why it does not.
 */
import { database } from "./db";

/** Two years. The longest an account nobody has used is kept. */
export const DORMANT_MS = 2 * 365 * 24 * 60 * 60 * 1000;

/**
 * A week for a registration nobody confirmed.
 *
 * Such a row grants nothing - no session is issued for it and sign-in refuses it
 * - so what it holds is a claim on an address and the password typed next to it.
 * Seven days is long enough for a parent to open the mail and short enough that a
 * mistyped or squatted address does not stay blocked for ever.
 */
export const UNCONFIRMED_MS = 7 * 24 * 60 * 60 * 1000;export type DueAccount = {
  id: string;
  email: string;
  createdAt: number;
  /** Null for a registration nobody confirmed, which was never used. */
  lastUsedAt: number | null;
};

export type DueAccounts = {
  /** Registered, never confirmed, and no link asked for inside the window. */
  unconfirmed: DueAccount[];
  /** Confirmed, and nothing has touched it for two years. */
  dormant: DueAccount[];
};

/**
 * Unconfirmed, older than a week, and with no link still waiting to be used.
 *
 * The link row is what stops an account being deleted between asking for a
 * confirmation and opening it. It has to be the link's *expiry* rather than its
 * age: `issueVerification` clears expired rows as housekeeping, so a token asked
 * for six days ago is already gone. An unexpired one cannot be.
 */
const UNCONFIRMED_SQL = `
  SELECT u.id, u.email, u.created_at AS createdAt
    FROM users u
   WHERE u.email_verified_at IS NULL
     AND u.created_at < ?
     AND NOT EXISTS (
           SELECT 1 FROM email_verifications v
            WHERE v.user_id = u.id AND v.expires_at > ?
         )
   ORDER BY u.created_at`;

/**
 * Confirmed, and last used before the cutoff.
 *
 * "Last used" is the latest of four things, because no single column records it:
 * the account's creation, the last sign-in (which covers every other use too,
 * since a session lasts a week), the last answered question, and the last
 * purchase. Signing in did not leave a durable trace before `last_seen_at`
 * existed, which is why practice and purchases are still here: an older account
 * is judged on the evidence there is, and every source is a lower bound on when
 * it was last used.
 *
 * The scalar `max` is SQLite's, not the aggregate: five arguments, no grouping.
 * `coalesce` gives a missing source zero so it cannot swallow the others.
 */
const DORMANT_SQL = `
  SELECT id, email, createdAt, lastUsedAt
    FROM (
      SELECT u.id,
             u.email,
             u.created_at AS createdAt,
             max(
               u.created_at,
               coalesce(u.last_seen_at, 0),
               coalesce((SELECT max(e.created_at) FROM learning_events e
                          WHERE e.user_id = u.id), 0),
               coalesce((SELECT max(p.created_at) FROM purchases p
                          WHERE p.user_id = u.id), 0)
             ) AS lastUsedAt
        FROM users u
       WHERE u.email_verified_at IS NOT NULL
    )
   WHERE lastUsedAt < ?
   ORDER BY lastUsedAt`;

export async function dueForDeletion(now = Date.now()): Promise<DueAccounts> {
  const db = database();
  const [unconfirmed, dormant] = await Promise.all([
    db
      .prepare(UNCONFIRMED_SQL)
      .bind(now - UNCONFIRMED_MS, now)
      .all<{ id: string; email: string; createdAt: number }>(),
    db
      .prepare(DORMANT_SQL)
      .bind(now - DORMANT_MS)
      .all<{ id: string; email: string; createdAt: number; lastUsedAt: number }>(),
  ]);
  return {
    unconfirmed: unconfirmed.results.map((row) => ({
      ...row,
      lastUsedAt: null,
    })),
    dormant: dormant.results,
  };
}

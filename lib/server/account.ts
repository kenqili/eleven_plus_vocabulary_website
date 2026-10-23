/**
 * Removing an account, and everything that hangs off it.
 *
 * Every table that points at a user cascades, so this is one statement. What it
 * returns is the number of practice records, because both callers tell somebody
 * what is going rather than asking them to trust that something is: a parent
 * before they press the button, an administrator after they press it.
 *
 * One function rather than the statement written twice. There are two ways to
 * delete an account - the parent's own button and the administrator's list of
 * accounts due for deletion - and two copies of "delete the account" are two
 * chances for one of them to leave something behind.
 */
import { database } from "./db";

/** Delete the account and everything in it, returning how many records went. */
export async function removeAccount(userId: string): Promise<number> {
  const records =
    (
      await database()
        .prepare(
          "SELECT COUNT(*) AS count FROM learning_events WHERE user_id=?",
        )
        .bind(userId)
        .first<{ count: number }>()
    )?.count ?? 0;
  await database().prepare("DELETE FROM users WHERE id=?").bind(userId).run();
  return records;
}

/**
 * Who is allowed to issue access.
 *
 * One function, and it is the only thing in the app that decides. That is the
 * whole design: an earlier version of this file did not exist, and the
 * alternative was an address compared inline in each route that needed it, which
 * puts a credential in the source, cannot be rotated without a deploy, and
 * guarantees that one of the copies will eventually forget the check.
 *
 * Read from the `users` row rather than from configuration for the same reason.
 * Authority then lives with the account rather than with the code, so changing
 * who is in charge is an UPDATE rather than a deploy.
 */
import { database } from "./db";
import { HttpError } from "./http";
import { requireUser, type User } from "./auth";

/**
 * Refuse anyone who is not the administrator.
 *
 * The check is a column read, not a cached value or an environment variable, so
 * it cannot go stale between a deploy and the next request.
 */
export async function requireAdmin(request: Request): Promise<User> {
  const user = await requireUser(request);
  const row = await database()
    .prepare("SELECT is_admin FROM users WHERE id = ?")
    .bind(user.id)
    .first<{ is_admin: number }>();
  if (!row?.is_admin) {
    // 404 rather than 403, deliberately. A 403 says "this exists, and you are not
    // allowed", which is an answer about the admin surface to anyone who asks -
    // and an admin page is worth not advertising. The parent gets the same
    // message they get for a route that genuinely is not there.
    throw new HttpError(404, "There is nothing here.");
  }
  return user;
}

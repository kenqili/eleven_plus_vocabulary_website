/**
 * Confirming that an address belongs to whoever signed up.
 *
 * The same shape as `password-reset.ts`, and for the same reasons: a token that
 * proves control of a mailbox is the same proof a password is, so this is not a
 * weaker version of signing in; the emailed token is stored only as a sha256, so
 * a copy of the database is not a list of links that still work; and the expiry is
 * read in the lookup rather than swept, so a table nobody prunes cannot be read as
 * permission.
 *
 * What differs from a password reset is who may use it. This link *creates* access
 * to an account that has none, so it is the one place where a leaked or
 * mis-delivered message matters most, and where the escape hatches have to be
 * generous rather than tight.
 */
import { database, setting } from "./db";
import { HttpError } from "./http";
import { emailReady, sendEmail, verificationEmail } from "./email";
import { tokenDigest } from "./password";
import { randomBytes } from "node:crypto";

/**
 * A day, rather than the hour a reset gets.
 *
 * This is the only way into a new account, and it may be the first message that
 * address has ever received. An hour turns a parent who checked email at dinner
 * into a locked-out account, and the only remedy would be asking support.
 */
export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

/** Where the link goes, and what a parent reads when it opens. */
export const VERIFY_LINK_PATH = "/confirm-email";

const TOKEN_SHAPE = /^[0-9a-f]{64}$/;
export const isVerifyToken = (token: string) => TOKEN_SHAPE.test(token);

/**
 * Issue a link, retiring any previous one.
 *
 * The old rows are deleted rather than left to expire, so an account has exactly
 * one live link and a parent who asks twice is not confused by which of two
 * emails to use. The most recent request wins, which is the one they expect.
 */
export async function issueVerification(userId: string): Promise<string> {
  const db = database();
  // Generated here rather than in the statement, because SQLite has no sha256 and
  // the column is UNIQUE - so the row cannot be written until the hash exists.
  const token = randomBytes(32).toString("hex");
  await db.batch([
    db
      .prepare("DELETE FROM email_verifications WHERE user_id = ?")
      .bind(userId),
    // Already-expired rows are not evidence of anything, and clearing them here
    // means the table does not accumulate them in a deployment that never runs a
    // sweep. This is the same line issueResetToken carries, for the same reason.
    // The expiry is still read in confirmEmail's lookup, so this is housekeeping
    // and never a permission.
    db
      .prepare("DELETE FROM email_verifications WHERE expires_at < ?")
      .bind(Date.now()),
    db
      .prepare(
        "INSERT INTO email_verifications (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)",
      )
      .bind(
        randomBytes(16).toString("hex"),
        userId,
        tokenDigest(token),
        Date.now() + VERIFY_TTL_MS,
        Date.now(),
      ),
  ]);
  return token;
}

/**
 * Spend a link.
 *
 * Deletes the row and stamps the account in one transaction, so a link cannot be
 * opened twice: whichever request gets the delete is the one that verifies, and
 * the other finds nothing. `changes` is what makes that true rather than hopeful.
 */
export async function confirmEmail(token: string): Promise<string> {
  if (!isVerifyToken(token))
    throw new HttpError(400, "This link is not valid.");
  const db = database();
  const row = await db
    .prepare(
      "SELECT id,user_id FROM email_verifications WHERE token_hash=? AND expires_at>=?",
    )
    .bind(tokenDigest(token), Date.now())
    .first<{ id: string; user_id: string }>();
  if (!row)
    throw new HttpError(
      400,
      "This link has expired or has already been used. Ask for a new one from the sign-in page.",
    );
  const result = await db.batch([
    db.prepare("DELETE FROM email_verifications WHERE id=?").bind(row.id),
    db
      .prepare("UPDATE users SET email_verified_at=? WHERE id=?")
      .bind(Date.now(), row.user_id),
  ]);
  // A concurrent request that lost the race deletes nothing, and must not report
  // success: the account is verified either way, but the second reader of a
  // single-use link is being told a token worked when it did not.
  if (!(result[0]?.meta?.changes ?? 0))
    throw new HttpError(
      400,
      "This link has already been used. Sign in with your email address.",
    );
  return row.user_id;
}

/**
 * Mark an address verified without a link, because something else already proved
 * the mailbox is theirs.
 *
 * A password reset does: receiving it at all is the proof. This is the escape
 * hatch that keeps "sign-in needs a verified address" from becoming a trap - an
 * account whose verification mail was lost is unreachable by every other route,
 * and the one route a parent can still take is the one that arrives by email.
 */
export async function markVerified(userId: string): Promise<void> {
  await database()
    .prepare(
      "UPDATE users SET email_verified_at=? WHERE id=? AND email_verified_at IS NULL",
    )
    .bind(Date.now(), userId)
    .run();
}

/**
 * The sentence the parent is shown, in one place.
 *
 * Three places say it - registration, sign-in, and a resend - and they have to
 * agree, or a parent who registers is told one thing and then, at sign-in, is
 * told a different one by what looks like the same application.
 */
export const CHECK_INBOX =
  "Check your inbox for the link that confirms this address. Your account opens as soon as you use it.";

/**
 * Issue a link and send it, and never throw.
 *
 * The failure is logged rather than returned, for the same reason the password
 * reset does not report a send failure to the browser: the address may not exist
 * at all, and a status that differs between "we sent something" and "we did not"
 * is a way to enumerate registered addresses. Registration has already stored the
 * account, so returning an error would also leave a parent who registered with a
 * working address unable to sign in and no idea why.
 *
 * `emailReady()` is checked first so the common case - a deployment with no mail
 * configured - is visible in the logs as a configuration problem rather than as a
 * provider failure with a status.
 */
export async function deliverVerification(
  userId: string,
  to: string,
): Promise<boolean> {
  if (!(await emailReady())) {
    console.warn(
      "Email confirmation cannot be sent. Set RESEND_API_KEY and EMAIL_FROM.",
    );
    return false;
  }
  const token = await issueVerification(userId);
  try {
    const origin = setting("APP_ORIGIN");
    if (!origin)
      throw new Error(
        "APP_ORIGIN is not set, so the confirmation link cannot be built.",
      );
    const link = `${new URL(origin).origin}${VERIFY_LINK_PATH}?token=${token}`;
    await sendEmail({ to, ...verificationEmail({ link }) });
    return true;
  } catch (error) {
    console.error(
      "Email confirmation could not be sent",
      error instanceof Error ? error.message : "Unknown error",
    );
    return false;
  }
}

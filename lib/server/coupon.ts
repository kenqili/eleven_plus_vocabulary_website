/**
 * Coupons: access issued to a family who cannot meet the cost.
 *
 * Not a gift and not a purchase by anyone. A code exists because a family told us
 * the price was a problem, and we issue one so their child keeps every word and
 * keeps printing. Nobody pays for it, which is why there is no Stripe product and
 * no invoice: this writes the same column the webhook writes, and records the
 * grant as `status: 'redeemed'` rather than `paid`, so a parent who was given
 * access is never shown a receipt for it.
 *
 * Which makes it the second writer of `expiry_date`, and the schema comment on
 * that column says only the webhook may write it. That is a real tension and it
 * is resolved rather than ignored: the invariant is not "only the webhook writes
 * this", it is "only a path that proved something may write this", and a coupon
 * proves something the webhook cannot - that an administrator issued it. What
 * this module owes the invariant is the same thing the webhook owes it, which is
 * an audit row written in the same transaction as the grant. `grantPurchase` does
 * that with `purchases`; so does this, and for the same reason: a parent asking
 * why their child has access until March needs an answer, and the only place that
 * answer can live is the row recording the grant.
 *
 * The reason the grant cannot be doubled, which is the whole risk in this file:
 * a coupon is spent by a single conditional UPDATE, and the grant is conditional
 * on that UPDATE having changed a row. There is no read-then-write anywhere, so
 * two parents racing on the same code produce one grant and one refusal.
 */
import { database } from "./db";
import { HttpError } from "./http";
import { randomBytes } from "node:crypto";

/**
 * What a redemption is recorded as in `purchases.confirmation`.
 *
 * Written here and read by `purchaseHistory`, because the account page has to
 * tell a code from a payment and this is the only thing in the row that says
 * which it was. It was a literal on each side, which is two places to keep in
 * step and one place to be wrong in - and being wrong in that direction puts a
 * hardship code in front of a parent as something they paid for.
 *
 * It carries the coupon's **id**, not its code, so the row does not republish a
 * bearer token into a table the account page reads back.
 */
export const COUPON_CONFIRMATION_PREFIX = "coupon:";

/** How long a batch runs for, and how many codes it issues. */
export const COUPON_DAYS = [30, 90, 365] as const;
export const COUPON_COUNT = 32;

/**
 * 20 characters from an alphabet with no vowels and no lookalikes.
 *
 * Long enough that the codes cannot be enumerated, short enough to read aloud
 * over a telephone to a parent who has just been told their child has lost
 * access - which is the situation this exists for. A six-digit numeric code is
 * 20 bits and is guessable in a weekend, and a code that can be guessed is a way
 * to give yourself a year for nothing.
 *
 * The alphabet omits I, O, L and U so a code dictated over the phone, or copied
 * off a screen, cannot be mistyped into a second valid code.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 20;

export const newCode = (): string => {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++)
    code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
};

/**
 * What a parent types, normalised to the stored form.
 *
 * Hyphens, spaces and case are all accepted, because a code read off an email
 * arrives with whatever the sender's mail client decided to do to it. Stripped
 * rather than merely upper-cased, since the stored codes carry no punctuation and
 * a parent who typed the hyphens would otherwise be told their code is invalid.
 */
export function normaliseCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 64);
}

/**
 * Issue a batch, and return the codes.
 *
 * All 32 or none: the codes go in one batch statement, so a partial batch is not
 * a state this can be in. Codes are unique-indexed, so a collision is impossible
 * rather than unlikely - and the batch is one transaction, so an error rolls the
 * whole thing back rather than leaving a short batch nobody asked for.
 *
 * The batch holds only the inserts. There is no count statement in it: the codes
 * are read back afterwards, outside the transaction, because a plain SELECT of
 * the batch's own `batch` column is a better answer than anything counted up
 * from the batch results would be.
 */
export async function issueCoupons(
  days: number,
  count = COUPON_COUNT,
): Promise<{ batch: string; codes: string[] }> {
  if (!COUPON_DAYS.includes(days as (typeof COUPON_DAYS)[number]))
    throw new HttpError(400, "Choose how long the code should last.");
  if (!Number.isInteger(count) || count < 1 || count > 100)
    throw new HttpError(400, "Generate between 1 and 100 codes.");
  const batch = randomBytes(8).toString("hex");
  const now = Date.now();
  const db = database();
  await db.batch(
    Array.from({ length: count }, () =>
      db
        .prepare(
          "INSERT INTO coupons (id,code,days,status,batch,created_at) VALUES (?,?,?,'unused',?,?)",
        )
        .bind(crypto.randomUUID(), newCode(), days, batch, now),
    ),
  );
  const codes = (
    await db
      .prepare("SELECT code FROM coupons WHERE batch = ? ORDER BY code")
      .bind(batch)
      .all<{ code: string }>()
  ).results.map((row) => row.code);
  return { batch, codes };
}

/**
 * Spend a code, and extend the account by however long it was worth.
 *
 * All three statements are one transaction, and each of the two after the claim is
 * keyed on a value that only this delivery could have written. That is what lets
 * the claim join the batch at all - a batch is built before it runs, so a statement
 * after the claim cannot be given something only the claim could produce - and it
 * is also what makes a replay harmless.
 *
 * The sentinel is `id`, a fresh UUID generated per call, and it is the same device
 * `grantPurchase` uses for the same reason. The obvious guard - "is this code
 * redeemed, by this account?" - is not one: on a replay that is *true*, because the
 * first attempt is what redeemed it. So the second attempt re-inserted the audit
 * row, hit the UNIQUE index on `confirmation`, and threw out of the batch as a raw
 * database error rather than as a refusal. It happened to cost no access, because
 * the transaction rolled back, but the parent got a 500 and a code that could never
 * be spent again. A guard that is true on replay guards nothing.
 *
 * The claim was outside the batch until recently, and that was a real loss of money
 * rather than a tidiness issue: a Worker evicted, or any error, between the claim
 * and the grant spent a twenty-character code worth up to a year and extended
 * nothing, and the parent's retry was told the code had already been used.
 * Recovery was a person issuing a new code by hand.
 *
 * Order matters, and it is the reverse of `grantPurchase`'s for a reason that is
 * specific to a coupon. The audit row is written *before* the grant here, so
 * `original_expiry` is the account as it was before and `new_expiry` is worked out
 * from that same value - which is what a purchase row has to be. Written after, its
 * `SELECT expiry_date` would read the value the grant had just written, so the row
 * would claim the account had already been extended when it had not and run until
 * twice the length the code was worth.
 *
 * What makes two racing redemptions safe is unchanged and is the claim's own
 * `WHERE`: only one of them matches an unspent code, and the other's update and
 * insert are keyed on a row that was never written. There is no read-then-write
 * anywhere in here.
 *
 * Returns the new expiry so the caller can show the parent when their access now
 * ends, which is the number they actually came here for.
 */
export async function redeemCoupon(
  userId: string,
  rawCode: string,
): Promise<{ days: number; expiresAt: number }> {
  const code = normaliseCode(rawCode);
  if (code.length !== CODE_LENGTH)
    throw new HttpError(400, "That code is not one of ours.");
  const db = database();
  const now = Date.now();
  // This delivery's own audit row id, generated here so the grant below can be made
  // conditional on it. See the comment on that statement.
  const id = crypto.randomUUID();
  const [claimed] = await db.batch<{ id: string; days: number }>([
    db
      .prepare(
        "UPDATE coupons SET status='redeemed', user_id=?, redeemed_at=? WHERE code=? AND status='unused' RETURNING id, days",
      )
      .bind(userId, now, code),
    // The audit row, written before the grant so that its dates describe the
    // account as it was rather than as the grant leaves it. `confirmation` is
    // unique, so a replay collapses here instead of throwing out of the batch.
    //
    // `ON CONFLICT DO NOTHING` is not a nicety: without it a replay raises the
    // UNIQUE violation as a raw database error, and a parent who mistyped nothing
    // and simply pressed the button twice is answered with a 500.
    //
    // The dates are real, which they were not at first: they were written as 0, and
    // the account page renders `new_expiry` as a date - so a parent who redeemed a
    // coupon saw their history say "Access then ran until 1 January 1970". The
    // point of the row is to answer "why does my child have access until March",
    // and with no dates in it the answer was not in the row.
    db
      .prepare(
        `INSERT INTO purchases (id,user_id,product_id,confirmation,original_expiry,new_expiry,status,created_at)
         SELECT ?, ?, 'coupon', ? ||
                 (SELECT id FROM coupons WHERE code = ?),
                COALESCE((SELECT expiry_date FROM users WHERE id = ?), 0),
                MAX(COALESCE((SELECT expiry_date FROM users WHERE id = ?), 0), ?)
                  + COALESCE((SELECT days FROM coupons WHERE code = ?), 0) * 86400000,
                'redeemed', ?
           WHERE EXISTS (SELECT 1 FROM coupons WHERE code = ? AND status = 'redeemed' AND user_id = ?)
         ON CONFLICT(confirmation) DO NOTHING`,
      )
      .bind(
        id,
        userId,
        COUPON_CONFIRMATION_PREFIX,
        code,
        userId,
        userId,
        now,
        code,
        now,
        code,
        userId,
      ),
    // Extends from the later of now and the current expiry, so redeeming early adds
    // to time already paid for rather than shortening it. `MAX` rather than a
    // comparison in JS because this is the write, and a read-then-write would race
    // two redemptions on the same account.
    //
    // Conditional on the audit row this call just tried to write, which is what
    // carries the idempotency into the batch: a batch cannot look at the first
    // result before running the later statements, so the insert alone was not
    // enough. `id` is a UUID minted above, so the row can only be there if this
    // delivery is the one that wrote it.
    db
      .prepare(
        `UPDATE users
            SET expiry_date = MAX(COALESCE(expiry_date, 0), ?)
                               + COALESCE((SELECT days FROM coupons WHERE code = ?), 0) * 86400000
          WHERE id = ?
            AND EXISTS (SELECT 1 FROM purchases WHERE id = ?)`,
      )
      .bind(now, code, userId, id),
  ]);
  // One message for "never existed" and "already spent". Telling them apart would
  // confirm a code to anyone holding a list of them, and a parent who has already
  // spent a code learns nothing useful from being told it was spent.
  //
  // The returned row is what says the claim happened, and not `meta.changes`: the
  // claim ends in `RETURNING`, and a statement that returns rows reports a change
  // count of zero however many it matched - so `changes` is zero on the success
  // path too, and reading it would refuse every code that was perfectly valid.
  if (!claimed?.results?.length)
    throw new HttpError(
      400,
      "That code is not valid, or has already been used.",
    );
  const row = await db
    .prepare("SELECT expiry_date FROM users WHERE id = ?")
    .bind(userId)
    .first<{ expiry_date: number | null }>();
  return {
    days: Number(claimed.results[0]?.days ?? 0),
    expiresAt: row?.expiry_date ?? 0,
  };
}

/** How many codes a batch produced, and how many have been spent. */
export async function couponStats() {
  const db = database();
  const [totals, batches] = await Promise.all([
    db
      .prepare(
        "SELECT COUNT(*) AS issued, SUM(status='redeemed') AS redeemed FROM coupons",
      )
      .first<{ issued: number; redeemed: number }>(),
    db
      .prepare(
        "SELECT batch, days, COUNT(*) AS issued, SUM(status='redeemed') AS redeemed, MAX(created_at) AS created_at FROM coupons GROUP BY batch, days ORDER BY created_at DESC LIMIT 20",
      )
      .all<{
        batch: string;
        days: number;
        issued: number;
        redeemed: number;
        created_at: number;
      }>(),
  ]);
  return {
    issued: totals?.issued ?? 0,
    redeemed: totals?.redeemed ?? 0,
    batches: batches.results,
  };
}

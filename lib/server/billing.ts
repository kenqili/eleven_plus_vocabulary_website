import { database, setting } from "./db";
import { HttpError } from "./http";
import { sendEmail } from "./email";
import { CONTACT_EMAIL } from "@/lib/contact";
import { words } from "@/lib/challenge/bank";
import type { User } from "./auth";

export type Tier = (typeof TIERS)[number]["id"];

/**
 * How much one payment was worth, and so which tier it bought.
 *
 * Read from the price id on the payment, never guessed from the amount. The
 * amount is not a reliable key: two tiers can cost the same in a promotion, a
 * discount changes it, and the currency is not checked - so a parent paying £2
 * for a year would grant a month because that is what £2 usually means. Matching
 * on the price is the only thing that cannot be wrong in that way.
 *
 * An unrecognised price returns null, and the caller grants nothing. That is the
 * guard that stopped somebody paying through the same Stripe account for
 * something else from unlocking this site.
 */
export function tierForPayment(priceId: string | null): Tier | null {
  if (!priceId) return null;
  return availableTiers().find((t) => priceFor(t.id) === priceId)?.id ?? null;
}

/**
 * The three lengths a parent can buy.
 *
 * A fixed term, bought once. Not a subscription, and the difference is the whole
 * design here: there is no renewal, no cancellation and no plan state, because
 * an 11+ is a dated exam and a family preparing for one needs access until then
 * rather than an open-ended thing they have to remember to cancel. Parents are
 * reluctant to subscribe for a child, and a fixed term is what they will buy.
 *
 * `days` is the term, and it lives here rather than in Stripe because a
 * one-time price carries no interval - there is nothing in the price object that
 * says how long anything lasts. So this map is the only record of what a parent
 * paid for, and it is the reason the checkout route checks that a price really
 * is one-time before selling it: a recurring price filed under the quarterly id
 * would grant three months for the price of a month, forever, with no second
 * charge to notice it by.
 *
 * 30/90/365 rather than calendar months, because a term that is described as
 * "3 months" and measured as 92 days depends on which month the child started in,
 * and a parent who buys in February should not get less than one who buys in July.
 * These match COUPON_DAYS in lib/server/coupon.ts on purpose - one place decides
 * what a month is worth.
 */
export const TIERS = [
  { id: "monthly", label: "1 month", days: 30 },
  { id: "quarterly", label: "3 months", days: 90 },
  { id: "yearly", label: "1 year", days: 365 },
] as const;

/**
 * The Stripe price id for one tier.
 *
 * Every `setting()` call is written out longhand rather than computed from the
 * tier name, because the test that guarantees every setting the code reads
 * appears in the deploy guide finds them by matching a literal setting read.
 * A computed `setting(\`PREFIX_${tier}\`)` reads the same three settings and is
 * found by none of them, so the quarterly and yearly prices could go undocumented
 * and that test would stay green - which is the exact failure it exists to
 * prevent. The duplication is the price of that test.
 *
 * The fallback to the old single `STRIPE_PRICE_ID` is a rename bridge, and
 * deliberately so. Without it, deploying this file to the site that is live now
 * would find no configured price and take payments down at the moment of the
 * deploy, rather than at the moment someone set the three ids. It applies to the
 * monthly tier only, which is what that setting has always meant. Delete it once
 * `STRIPE_PRICE_MONTHLY` is set.
 */
export function priceFor(tier: Tier): string {
  // Unvalidated rather than trusted, because this is reached with whatever a
  // request or an older caller passed. `priceFor(undefined)` must be an empty
  // string and not a TypeError or a fallthrough to the yearly price: a checkout
  // that cannot name its price has to be refused with a message a parent can
  // read, and the callers above check for the empty string to do exactly that.
  // So the test is membership, not a chain of elses that would treat anything
  // unrecognised as the last option.
  // Against the catalogue, not against the configured tiers: the second of those
  // calls priceFor, so asking it here would recurse.
  if (!TIERS.some((t) => t.id === tier)) return "";
  const named =
    tier === "monthly"
      ? setting("STRIPE_PRICE_MONTHLY")
      : tier === "quarterly"
        ? setting("STRIPE_PRICE_QUARTERLY")
        : setting("STRIPE_PRICE_YEARLY");
  if (named) return named;
  if (tier === "monthly") return setting("STRIPE_PRICE_ID");
  return "";
}

/** The tiers this deployment can actually sell, so a partial setup offers less. */
export const availableTiers = () => TIERS.filter((tier) => priceFor(tier.id));

/** Which tier a Stripe price id is, or null when it is not one of ours. */
export const tierOf = (priceId: string): Tier | null =>
  availableTiers().find((tier) => priceFor(tier.id) === priceId)?.id ?? null;

export const billingReady = () =>
  Boolean(
    setting("STRIPE_SECRET_KEY") &&
      availableTiers().length &&
      setting("STRIPE_WEBHOOK_SECRET") &&
      setting("APP_ORIGIN"),
  );
export async function stripe<T = Record<string, unknown>>(
  path: string,
  data?: Record<string, string>,
  idempotencyKey?: string,
): Promise<T> {
  const key = setting("STRIPE_SECRET_KEY");
  if (!key)
    throw new HttpError(503, "Membership payments are not available yet.");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: data ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(data ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: data ? new URLSearchParams(data) : undefined,
  });
  if (!response.ok) {
    console.error("Stripe request failed", response.status);
    throw new HttpError(
      502,
      "The payment service is unavailable. Please try again.",
    );
  }
  return response.json() as Promise<T>;
}
export function configuredFreeTrialDays() {
  const configured = setting("FREE_TRIAL_DAYS");
  if (!configured) return 7;
  if (!/^(?:0|[1-9]\d{0,2})$/.test(configured))
    throw new Error("FREE_TRIAL_DAYS must be a whole number from 0 to 365.");
  const days = Number(configured);
  if (days > 365)
    throw new Error("FREE_TRIAL_DAYS must be a whole number from 0 to 365.");
  return days;
}
/**
 * What a parent is charged, in pence per month, read from configuration so it
 * can be shown before anyone creates an account. Null when it is not set, and
 * the pages then say so rather than inventing a number.
 */
export function configuredMonthlyPricePence(): number | null {
  const configured =
    setting("MONTHLY_PRICE_PENCE") ?? setting("SUBSCRIPTION_PRICE_PENCE");
  if (!configured) return null;
  if (!/^[1-9]\d{0,6}$/.test(configured))
    throw new Error("MONTHLY_PRICE_PENCE must be a whole number of pence.");
  return Number(configured);
}

/** The price as it would be written, or null when it is not configured. */
export function configuredPriceLabel(): string | null {
  const pence = configuredMonthlyPricePence();
  if (pence === null) return null;
  return `£${(pence / 100).toFixed(pence % 100 === 0 ? 0 : 2)} a month`;
}

export function configuredFreeWordLimit() {
  const configured = setting("FREE_WORD_LIMIT");
  // Two hundred and twenty four is a real working vocabulary for a child
  // working through the easiest bands, rather than a single sitting's taste.
  // Twenty was so small that the daily mission, which asks for twenty
  // questions, exhausted the whole free library on day one.
  if (!configured) return 224;
  // Derived from the bank so the cap cannot fall behind the word count.
  const ceiling = words.length;
  if (!/^(?:0|[1-9]\d*)$/.test(configured))
    throw new Error(
      `FREE_WORD_LIMIT must be a whole number from 0 to ${ceiling}.`,
    );
  const count = Number(configured);
  if (count > ceiling)
    throw new Error(
      `FREE_WORD_LIMIT must be a whole number from 0 to ${ceiling}.`,
    );
  return count;
}
export async function membership(user: User) {
  const db = database(),
    now = Date.now(),
    trialDays = configuredFreeTrialDays();
  // One row, and a round trip that was already being paid for: the auth query
  // reads this same users row. Entitlement used to be a second query against
  // `subscriptions`, matching a price id and a validity window, on every
  // authenticated request in the app - to answer a question with a boolean.
  const account = await db
    .prepare("SELECT created_at, expiry_date FROM users WHERE id=?")
    .bind(user.id)
    .first<{ created_at: number; expiry_date: number | null }>();
  const expiresAt = account?.expiry_date ?? null;
  const active = expiresAt !== null && expiresAt > now;
  const trialEndsAt = (account?.created_at || 0) + trialDays * 86_400_000;
  const trial = !active && trialDays > 0 && now < trialEndsAt;
  return {
    active,
    access: active || trial,
    trial,
    trialDays,
    trialDaysRemaining: trial ? Math.ceil((trialEndsAt - now) / 86_400_000) : 0,
    trialEndsAt: account && trialDays > 0 ? trialEndsAt : null,
    trialExpired: !active && !trial,
    status: active ? "active" : "inactive",
    periodEnd: expiresAt,
    // Whole days left on a paid term, for the renewal warning. Computed here
    // rather than in each page because `now` is only known here, and three
    // places each doing their own rounding is how a parent ends up being told
    // "0 days left" on the day they bought. Zero when nothing is paid for, which
    // is what keeps the renewal warning off somebody on a trial - they get the
    // trial message instead.
    daysRemaining: active ? Math.ceil((expiresAt - now) / 86_400_000) : 0,
  };
}
/**
 * Grant a paid term, from a Stripe payment intent we have been told about.
 *
 * Same operation as redeeming a coupon - extend from the later of now and the
 * current expiry, record why - with a different proof of payment. That reuse is
 * the reason this is not a second way of granting access: `expiry_date` gains one
 * extension statement and one shape, and a second function computing a period
 * from Stripe would be a second source of truth for what a parent bought.
 *
 * One `db.batch`, which D1 runs as a single transaction, so a parent cannot end
 * up with the two halves disagreeing. This used to be two separate statements,
 * insert then update, and the trade it argued for was the reverse of what it
 * bought: a process that died between them left a purchase recorded with no
 * access granted - and because `purchases.confirmation` is the payment intent and
 * is UNIQUE, every later delivery of that same event collides on it and returns
 * false without extending anything. The grant was therefore permanently
 * unrecoverable from the only code path that can make it, and the only repair was
 * a human editing the row. A duplicated grant is recoverable by subtracting a
 * term; a grant that can never be replayed is not recoverable at all, so the
 * window was the wrong thing to be trading.
 *
 * The insert is first because it is the idempotency guard: Stripe delivers
 * `checkout.session.completed` at least once, sometimes twice, and a replay must
 * not grant a second term. `purchases.confirmation` is the payment intent and is
 * UNIQUE, so a replay conflicts and changes nothing - and the update is written to
 * be conditional on the audit row this delivery tried to write, because a batch
 * runs both statements without looking at the first one's result. Its change count
 * is then what this function reports.
 *
 * `new_expiry` is written by the same expression that writes the column, read
 * from `users` inside the transaction rather than computed beforehand in JS. It
 * was computed in JS from a SELECT taken before the write, so two payments
 * landing close together produced two audit rows that both claimed the earlier
 * expiry - and `revokePurchase` derives the length of a refund from those two
 * columns, so an understated `new_expiry` made a refund subtract too much.
 */
export async function grantPurchase(
  paymentIntentId: string,
  userId: string,
  priceId: string,
): Promise<boolean> {
  const tier = availableTiers().find((t) => priceFor(t.id) === priceId);
  // A payment for a price we do not sell grants nothing. Same rule the
  // subscription path had, and for the same reason: somebody paying through the
  // same Stripe account for something else must not unlock this site.
  if (!tier) return false;
  const db = database();
  const now = Date.now();
  const account = await db
    .prepare("SELECT expiry_date FROM users WHERE id=?")
    .bind(userId)
    .first<{ expiry_date: number | null }>();
  // The account has gone. `purchases.user_id` is a foreign key, so the insert
  // below would raise one and take the whole batch with it - and because a
  // webhook that is refused is a webhook Stripe redelivers for three days, the
  // account would keep being reported as broken long after anyone cared. Account
  // deletion does not tell Stripe, so this is a routine late delivery rather than
  // an impossible one, and a payment for an account that no longer exists is
  // nothing to grant.
  if (!account) return false;
  const term = tier.days * 86_400_000;
  // This delivery's own audit row id, generated here so the update below can be
  // made conditional on it. See the comment on that statement.
  const id = crypto.randomUUID();
  const recorded = (
    await db.batch([
      db
        .prepare(
          `INSERT INTO purchases(id,user_id,product_id,confirmation,original_expiry,new_expiry,status,created_at)
       VALUES(?,?,?,?,
         (SELECT expiry_date FROM users WHERE id = ?),
         (SELECT MAX(COALESCE(expiry_date, 0), ?) + ? FROM users WHERE id = ?),
         'paid', ?)
       ON CONFLICT(confirmation) DO NOTHING`,
        )
        .bind(
          id,
          userId,
          priceId,
          paymentIntentId,
          userId,
          now,
          term,
          userId,
          now,
        ),
      db
        .prepare(
          // From the later of now and the current expiry, so buying again early adds
          // to time already paid for rather than shortening it. A child whose family
          // buys a second term in month two keeps both. MAX rather than a comparison
          // in JS because two payments landing in the same second would otherwise
          // both read the same expiry and the second would overwrite the first.
          //
          // And conditional on the audit row this call just tried to write, which is
          // what carries the idempotency into the batch. A batch cannot look at the
          // first result before running the second statement, so the insert alone
          // was not enough: a replay of an event that has already been granted
          // collided on `confirmation`, inserted nothing, and still went on to
          // extend the expiry a second time. `EXISTS` on the row's own id is the
          // same shape the coupon grant uses on the code it claimed.
          "UPDATE users SET expiry_date = MAX(COALESCE(expiry_date, 0), ?) + ? WHERE id = ? AND EXISTS (SELECT 1 FROM purchases WHERE id = ?)",
        )
        .bind(now, term, userId, id),
    ])
  )[0];
  // Already granted by an earlier delivery of this same event, so nothing above
  // changed anything.
  if (!(recorded?.meta?.changes ?? 0)) return false;
  // A payment was taken, and this is the only place that knows it. So it is also
  // the only place that can notice a second one.
  await noticePossibleDoubleCharge(userId, priceId, paymentIntentId);
  return true;
}

/**
 * How close together two of the same purchase have to be to be worth asking about.
 *
 * Two identical purchases minutes apart is one intention paid for twice. The same
 * two purchases a fortnight apart is a family buying a second term, which is the
 * normal way this product is used and must never be questioned.
 *
 * An hour rather than a few minutes, because the gap that matters is not the two
 * clicks: it is a parent who completed a payment, did not see the confirmation,
 * and started again. That takes as long as it takes to notice, and the lock on
 * `checkout_requests` cannot help with it - by then the first session is a real,
 * paid, completed purchase with its own payment intent, and nothing about the
 * second is anomalous except that it is very like the first.
 */
const DOUBLE_CHARGE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Notice when one account pays twice for the same thing, and tell the parent.
 *
 * Reporting rather than refunding, and that is the whole design. A refund moves
 * money, so this cannot decide to do one: a duplicate is inferred from timing
 * alone, and a family who deliberately bought two terms to have a spare would be
 * refunded for one of them without being asked. So it says what it has noticed and
 * offers the refund, and a person decides. The alternative - doing nothing - is
 * what this exists to replace, because a silent double charge is found by the
 * parent in their bank statement rather than by us, and the worst outcome is that
 * they conclude the site took their money and never gave it back.
 *
 * Fired from `grantPurchase` rather than from the webhook, because
 * `checkoutSession` is a second path to the same grant and a check that only
 * watched one of them would miss whichever fired.
 *
 * Best effort throughout. It runs after the grant is committed and must never
 * throw into it: the parent has paid, and a failure to send an email about it is
 * not a reason to fail a payment that has already been applied. Everything it does
 * is wrapped, and the log is the fallback.
 */
async function noticePossibleDoubleCharge(
  userId: string,
  priceId: string,
  paymentIntentId: string,
): Promise<void> {
  try {
    const db = database();
    const since = Date.now() - DOUBLE_CHARGE_WINDOW_MS;
    // The other purchase, not this one. Both rows are in the ledger by now - this
    // grant's batch has committed - so the match is on an earlier `created_at`, and
    // the newest other row is the one worth naming.
    const earlier = await db
      .prepare(
        // `status <> 'refunded'` so a refunded-then-rebought pair is not asked
        // about: the money for the first one came back, so there is nothing
        // outstanding and nothing to ask.
        //
        // And the same `product_id`, because "the same length twice" is the
        // signal. A family who buys a month and then a year has paid twice
        // deliberately, and telling them we are not sure is insulting.
        `SELECT confirmation, created_at FROM purchases
          WHERE user_id = ? AND product_id = ? AND confirmation <> ?
            AND status <> 'refunded' AND created_at >= ?
          ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(userId, priceId, paymentIntentId, since)
      .first<{ confirmation: string; created_at: number }>();
    if (!earlier) return;
    const account = await db
      .prepare("SELECT email FROM users WHERE id = ?")
      .bind(userId)
      .first<{ email: string }>();
    const gapMinutes = Math.max(
      1,
      Math.round((Date.now() - earlier.created_at) / 60000),
    );
    // The log is the thing that is guaranteed to happen, so it carries everything
    // needed to refund without opening the database: which two payments, for which
    // account, and how far apart. A log line that says "possible double charge" and
    // nothing else is a line somebody has to go and reconstruct.
    console.error(
      "Possible double charge: one account paid twice for the same length",
      JSON.stringify({
        user: userId,
        email: account?.email ?? null,
        price: priceId,
        // The newer is the one to refund: the earlier is the purchase the parent
        // believes they made.
        duplicatePaymentIntent: paymentIntentId,
        originalPaymentIntent: earlier.confirmation,
        minutesApart: gapMinutes,
      }),
    );
    if (!account?.email) return;
    await sendDoubleChargeEmail(account.email);
  } catch (error) {
    // Logged, not thrown. The grant is committed and the parent has their access;
    // failing the request here would tell Stripe the webhook failed, and Stripe
    // would redeliver it for three days, re-running this on every attempt.
    console.error(
      "Could not report a possible double charge",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

/**
 * What the parent is told.
 *
 * Says what was noticed, says plainly that they have not been charged twice for
 * something they did not intend, and offers the refund without requiring them to
 * chase it. Deliberately does not apologise for a fault that may not exist - two
 * payments can be deliberate - and does not claim the refund is automatic, because
 * it is not: somebody reads this and does it.
 */
async function sendDoubleChargeEmail(to: string): Promise<void> {
  await sendEmail({
    to,
    subject: "Two payments on your MineWords account",
    text: [
      "We have noticed two payments on your account in a short space of time.",
      "",
      "This can happen when a payment page is opened twice, or when a payment",
      "goes through and the confirmation is not seen. If you only meant to pay",
      "once, reply to this message and we will refund the second payment in full.",
      "",
      "Your access is not affected either way, and you do not need to do anything",
      "if you did intend to buy twice.",
      "",
      `If it is easier, write to ${CONTACT_EMAIL} with the subject above.`,
      "",
      "MineWords",
    ].join("\n"),
  });
}

/**
 * Take a term back, when Stripe says the payment was refunded.
 *
 * With a subscription, cancelling revokes access by itself. With a fixed term
 * there is nothing left to cancel, so a refund that did not shorten the expiry
 * would leave a parent with a year of access they were refunded for - and unlike
 * the rest of this file, that is a failure nobody would notice until it mattered.
 *
 * Shortens rather than clears. A family who bought a year and then a second term
 * keeps the one they still paid for, which is the same reason redeeming extends
 * rather than replaces.
 */
export async function revokePurchase(paymentIntentId: string): Promise<void> {
  const db = database();
  // Claimed first, and conditionally on the row still being `paid`.
  //
  // That single `WHERE` is what makes a refund idempotent. Stripe retries
  // deliveries for days, and a Worker that writes and then exceeds its wall
  // clock looks like a failure, so the same event will arrive more than once. An
  // unconditional read-then-write subtracted the term again on every redelivery -
  // and because the subtraction is `expiry - days` clamped to now, a redelivery
  // after a later purchase silently removed access they had paid for.
  const claimed = await db
    .prepare(
      "UPDATE purchases SET status='refunded' WHERE confirmation=? AND status='paid' RETURNING user_id, original_expiry, new_expiry, created_at",
    )
    .bind(paymentIntentId)
    .first<{
      user_id: string;
      original_expiry: number | null;
      new_expiry: number;
      created_at: number;
    }>();
  if (!claimed) return;
  // The term comes out of the ledger, not out of configuration.
  //
  // Re-deriving it from the price id meant a refund could only be honoured while
  // that price id was still a live setting - and `docs/DEPLOY.md` instructs the
  // operator to delete `STRIPE_PRICE_ID` once `STRIPE_PRICE_MONTHLY` is set,
  // which is exactly the change that orphans it. After that, a refunded parent
  // kept a year of refunded access, silently and permanently.
  //
  // The row already records what was granted: `new_expiry` is what the grant
  // produced, and the base it started from was `max(original_expiry, created_at)`.
  // The difference is the term, whatever the price is called now.
  const base = Math.max(claimed.original_expiry ?? 0, claimed.created_at);
  const days = Math.max(
    0,
    Math.round((claimed.new_expiry - base) / 86_400_000),
  );
  if (!days) return;
  await db
    .prepare(
      "UPDATE users SET expiry_date = MAX(?, COALESCE(expiry_date, 0) - ?) WHERE id = ?",
    )
    .bind(Date.now(), days * 86_400_000, claimed.user_id)
    .run();
}

/**
 * How long one checkout attempt holds this account's row before another may take
 * it over.
 *
 * This is the lock that stops a parent being sent to Stripe twice. It is a
 * timestamp rather than a flag on purpose: there is no lock to release if a Worker
 * is killed between writing the row and writing the session id, so nothing can be
 * left held and no parent can be locked out of buying. A row older than this is
 * simply not held by anyone, and the next request takes it.
 *
 * Sized against what it has to cover - the Stripe session creation plus the
 * database writes after it - and against how long a parent will wait. The Stripe
 * call is the slow part and the whole checkout is given `CHECKOUT_TIMEOUT_MS` on
 * the client, so this is well inside that: a second request arriving seconds later
 * is refused, and one arriving later than this has a real chance of being a first
 * attempt whose predecessor died.
 *
 * Not a lock for the whole session lifetime. That is what the stored `session_id`
 * is for - a session that exists is reused rather than replaced, which is the
 * other half of the same problem and needs no window at all.
 */
const CHECKOUT_LOCK_SECONDS = 30;

export async function checkoutSession(
  userId: string,
  customerId: string,
  origin: string,
  tier: Tier,
): Promise<{ url: string }> {
  const db = database();
  const now = Math.floor(Date.now() / 1000);
  const insert = db
    .prepare(
      // Taken over rather than ignored when the row it finds has never been used.
      //
      // The row is written before the Stripe call and `session_id` is filled in
      // after it, so anything that goes wrong in between - a dropped connection, a
      // Worker over its wall clock, a parent who pressed the button and closed the
      // tab - leaves a row that is attached to nothing. Such a row used to sit
      // there, and once it was thirty minutes old every attempt to buy anything
      // was refused with "an earlier checkout is being resolved. Please try again
      // in an hour", for up to half an hour, with no way forward. The wait was for
      // a Stripe session that had never been given an id, and the parent could not
      // know that from the message.
      //
      // Replacing the token and the date is safe precisely because there is no
      // session: there is nothing at Stripe this row is standing in for. The
      // idempotency key is derived from the token, so the new key is a new
      // session, and the old one is not a session. A row that *has* a session id is
      // left completely alone, which is what stops a double-click opening two.
      //
      // And it only takes over a row that is STALE as well as sessionless, which
      // is what makes this row a lock rather than a slot. It used to replace
      // `session_id IS NULL` with nothing else, so two overlapping requests both
      // wrote a fresh token: the second overwrote the first, each request then read
      // back a token that was not the one it had written, and they derived two
      // different Stripe idempotency keys from two different tokens. Stripe has no
      // rule about one open session per customer - this app has no subscription -
      // so both keys were honoured and both sessions were live. Two tabs, two
      // devices, or one retry after a slow first attempt, and a parent could be
      // sent to the payment page twice and pay twice.
      //
      // With the staleness clause the row is claimed once and the second request
      // changes nothing, so both read the *same* token and both derive the same key
      // - which is Stripe answering the second with the first's session, one charge
      // and no duplicate. The clause is what turns "last writer wins" into "first
      // writer holds", and `changes` below is how the caller tells those apart.
      //
      // The window is short on purpose. Long enough to cover the Stripe call and
      // the writes after it, short enough that a Worker killed mid-request costs a
      // parent seconds rather than the half hour the old age guard did. There is no
      // unlock to forget and no lock to leak, because the lock is a timestamp and a
      // timestamp expires by being old.
      "INSERT INTO checkout_requests (user_id,token,created_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET token=excluded.token, created_at=excluded.created_at WHERE checkout_requests.session_id IS NULL AND checkout_requests.created_at < ?",
    )
    .bind(userId, crypto.randomUUID(), now, now - CHECKOUT_LOCK_SECONDS);
  // Captured, because the change count is the only thing that distinguishes the
  // request which took the row from the one that found it held. Read from this
  // statement's own result rather than from a `changes()` query afterwards, which
  // would be a second round trip reporting whatever ran last.
  const claimed = await insert.run();
  const row = await db
    .prepare(
      "SELECT token,created_at,session_id FROM checkout_requests WHERE user_id=?",
    )
    .bind(userId)
    .first<{ token: string; created_at: number; session_id: string | null }>();
  if (!row)
    throw new HttpError(503, "Unable to start checkout. Please try again.");
  // Whether *this* request is the one holding the row, and it is the changes count
  // that says so rather than the age. A fresh insert and a takeover of a stale row
  // both report one change; an insert whose `DO UPDATE` did not fire because
  // another request holds the row reports none.
  //
  // Without this distinction the lock refused the request that had just claimed it,
  // because a row this request had written is by definition younger than the
  // window. Reading the age alone cannot tell "I am the holder" from "someone else
  // is", and only the first of those two is allowed to continue.
  const holds = (claimed?.meta?.changes ?? 0) > 0;
  if (row.session_id) {
    let existing: {
      status: string;
      url: string;
      payment_intent?: string;
      metadata?: Record<string, string>;
    };
    try {
      existing = await stripe(
        `checkout/sessions/${encodeURIComponent(row.session_id)}`,
      );
    } catch (error) {
      // A stored session that cannot be read is unusable, and it is treated here
      // exactly like every other unusable one: the row goes and a fresh session is
      // started. It used to throw instead, and that turned any Stripe error - a
      // deleted session, a 404, a bad key - into a permanent block. The row was
      // never deleted on that path, so the parent was sent back to the same
      // unreadable id on every click and could never buy anything again, with the
      // whole time looking like the payment service was down.
      console.error(
        "Stored checkout session could not be read",
        error instanceof Error ? error.message : "Unknown error",
      );
      await db
        .prepare("DELETE FROM checkout_requests WHERE user_id=? AND token=?")
        .bind(userId, row.token)
        .run();
      return checkoutSession(userId, customerId, origin, tier);
    }
    // Reused only for the tier it was opened for. Handing a parent who clicked
    // "1 month" the URL of an abandoned yearly session is not an error of money
    // - they pay the yearly price and get the yearly term - but it is not what
    // they clicked either, and it is surprising in a way that costs a support
    // message.
    if (existing.status === "open") {
      const openedFor = existing.metadata?.price_id;
      if (!openedFor || openedFor === priceFor(tier)) return existing;
      await db
        .prepare("DELETE FROM checkout_requests WHERE user_id=? AND token=?")
        .bind(userId, row.token)
        .run();
      return checkoutSession(userId, customerId, origin, tier);
    }
    if (existing.status === "complete" && existing.payment_intent) {
      // The payment went through on a session this user came back to. Grant from
      // it rather than waiting for a webhook that may never arrive: a parent who
      // has paid and is watching a spinner should not be told to refresh and hope.
      //
      // `grantPurchase` keys on the payment intent, so calling it here and again
      // when the webhook lands collapses onto one purchase - it cannot grant twice.
      // The price is read from the session's own line items, the same place the
      // webhook reads it, so the two agree on what was bought.
      // Best effort, and deliberately not allowed to fail. This whole branch is a
      // fallback for a webhook that may not have arrived; if the extra lookup
      // throws, the parent has already paid and would be shown a 502 for a
      // request that was never really about paying. The price they chose is a
      // sound fallback - it is what this call was started for.
      // The price of the session that was PAID, never the tier this request asked
      // for. Those are two different things whenever a parent buys twice: the
      // second click carries a new tier while `existing.payment_intent` is the
      // first payment. Granting the new tier against the old payment is how a
      // year gets recorded as a month - and because the later webhook then
      // collides on `confirmation`, the year is never granted at all.
      //
      // So the price comes from the session itself. It is read from metadata,
      // which `checkoutSession` writes at creation, with the expanded line items
      // as a fallback for a session created before that was sent. The requested
      // tier is not a fallback for it: it is a different purchase.
      let priceId = existing.metadata?.price_id || "";
      if (!priceId) {
        try {
          const detail = await stripe<{
            line_items?: { data: { price?: { id?: string } }[] };
          }>(
            `checkout/sessions/${encodeURIComponent(row.session_id)}?expand[]=line_items`,
          );
          priceId = detail.line_items?.data?.[0]?.price?.id || "";
        } catch (error) {
          console.error(
            "Could not read the paid checkout's price",
            error instanceof Error ? error.message : "Unknown error",
          );
        }
      }
      // Neither source produced a price, so there is nothing safe to grant. The row is
      // still cleared - it is spent, and leaving it here would refuse every future
      // purchase - but the payment id is logged so this is recoverable by hand
      // rather than silently lost.
      if (!priceId) {
        console.error(
          "A paid checkout has no readable price and was not granted",
          JSON.stringify({
            paymentIntent: existing.payment_intent,
            user: userId,
          }),
        );
        await db
          .prepare("DELETE FROM checkout_requests WHERE user_id=? AND token=?")
          .bind(userId, row.token)
          .run();
        return checkoutSession(userId, customerId, origin, tier);
      }
      const granted = await grantPurchase(
        existing.payment_intent,
        userId,
        priceId,
      );
      // The row is cleared once the session is complete, because that session has
      // nothing left to protect against.
      //
      // This branch is then TERMINAL: every path out of it returns. It did not
      // used to, and falling out of it ran the age guard below against the
      // pre-delete in-memory `row` - so a parent who had just had a stale row
      // cleared was told "an earlier checkout is being resolved, try again in an
      // hour" for up to thirty minutes, on a row that no longer existed. Making
      // it terminal makes that read structurally impossible rather than defended
      // against.
      await db
        .prepare("DELETE FROM checkout_requests WHERE user_id=? AND token=?")
        .bind(userId, row.token)
        .run();
      // Nothing grantable left in this payment, and the ledger already holds it.
      //
      // `grantPurchase` answers false for two quite different reasons: this exact
      // payment was granted by an earlier delivery of the webhook, or it was
      // priced at something this deployment no longer sells. The second is live -
      // `docs/DEPLOY.md` tells the operator to delete `STRIPE_PRICE_ID` once
      // `STRIPE_PRICE_MONTHLY` is set, and a payment taken before that is sitting
      // in `purchases` under a price id nothing maps to a term any more. Reading
      // both as "start another purchase" sent the parent to Stripe to pay a
      // second time for a payment already recorded, which is the one outcome a
      // checkout must never produce.
      if (
        !granted &&
        (await recordedButUngrantable(db, existing.payment_intent, priceId))
      )
        throw new HttpError(
          409,
          "We have already got this payment on your account, but we can no longer tell what it was for. Please choose an option below and we'll take you to the payment page.",
        );
      // Already granted means they are here to make a NEW purchase, and the only
      // correct answer is to get on with it. This is what makes buying a second
      // term work on the first click rather than the second.
      if (!granted) return checkoutSession(userId, customerId, origin, tier);
      // Newly granted means we have just applied a payment that had not taken
      // effect. Not an error, and deliberately not worded as one: the parent
      // clicked "buy" and was sent back to the account page, so the message has
      // to say what happened, what they now have, and that the button still works.
      const applied = await db
        .prepare("SELECT new_expiry FROM purchases WHERE confirmation = ?")
        .bind(existing.payment_intent)
        .first<{ new_expiry: number }>();
      if (granted)
        throw new HttpError(
          409,
          // No locale named here. Every other date on this page is written by the
          // browser, in the reader's own language and format, and a server that
          // guesses one produces a second spelling of the same date on one screen.
          `We've applied a payment to your account that hadn't taken effect yet. Your access now runs until ${new Date(
            applied?.new_expiry ?? Date.now(),
          ).toLocaleDateString(undefined, {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}. If you'd like more time, choose an option below and we'll take you to the payment page.`,
          // A stable identifier, so the interface can show this as a status rather
          // than in the red error box. Same mechanism `email_unverified` uses.
          //
          // And the identifier, not the status, is what the interface branches on.
          // That is the whole reason a successful grant can be answered with a 409
          // here: the route's success shape is a Stripe URL to send the browser to,
          // and there is none here - the parent is already on the page, and the
          // thing to tell them is a date. Answering 200 with a different body
          // would mean the client had to check which of two success shapes it had
          // been given, and `pay` navigates on `url` the moment it returns. So the
          // conflict is carried by the code and the status, and the wording above
          // is what the parent actually reads.
          "membership_applied",
        );
    }
    await db
      .prepare("DELETE FROM checkout_requests WHERE user_id=? AND token=?")
      .bind(userId, row.token)
      .run();
    return checkoutSession(userId, customerId, origin, tier);
  }
  // No session, and this row is younger than the lock window: another request is
  // holding it right now. It got here first and is between writing this row and
  // writing the session id onto it, and if this request claimed the row it would
  // take that request's token, derive a different idempotency key, and leave two
  // live Stripe sessions for one intention. So it is refused, and the message says
  // what is actually true - a moment's wait, not a dead end.
  //
  // Checked *after* the session branch above, deliberately. A parent pressing the
  // button twice while a session is already open is not a second charge and must
  // not be told there is one in progress: the branch above answers that by handing
  // back the session they already have, which is the correct answer and costs them
  // nothing. This is only for the window where there is genuinely no session yet.
  //
  // Waiting rather than proceeding is what makes it safe. Both requests cannot be
  // served from one token unless they also share an idempotency key, and the whole
  // value of the row is that they do.
  //
  // `!holds` and not the age. A row this request has just written is younger than
  // the window by definition, so testing the age alone refuses the request that
  // legitimately took the lock - which is every first attempt, and the whole
  // feature dead on arrival. Zero changes means the `DO UPDATE` did not fire,
  // which is only possible when the row is held by someone else.
  if (!holds)
    throw new HttpError(
      409,
      `Another payment is already being set up for this account. Please wait a moment and try again — it takes a few seconds, and this one will not charge you twice.`,
      // A stable identifier, so the interface can show this as a status rather than
      // in the red error box. Same mechanism `membership_applied` uses, and for the
      // same reason: this is a state the parent can act on, not something that went
      // wrong.
      "checkout_in_progress",
    );
  // A row this old that never reached Stripe is replaced, and never refused.
  //
  // It used to refuse, for half an hour, with "An earlier checkout is being
  // resolved. Please try again in an hour." The wait was there in case a creation
  // had reached Stripe even though the reply never came back - but that case is
  // the one where `session_id` HAS been written, and it is handled above, by
  // reading the session and deciding what to do with it. A row with no session id
  // is a row whose creation demonstrably did not complete, and the INSERT above
  // now takes it over rather than leaving it to age, so an ordinary parent could
  // not reach this at all. What is left is the replacement the hour-old code also
  // did, and it can go once nothing indexes on this line.
  if (now > row.created_at + 1800) {
    await db
      .prepare("DELETE FROM checkout_requests WHERE user_id=? AND token=?")
      .bind(userId, row.token)
      .run();
    return checkoutSession(userId, customerId, origin, tier);
  }
  const session = await stripe<{ id: string; url: string }>(
    "checkout/sessions",
    {
      // "payment", not "subscription". A term is bought once and ends; there is
      // nothing to renew and nothing to cancel. The metadata is what the webhook
      // reads to find the user, because a webhook carries no session cookie and
      // cannot know who paid from the browser's point of view.
      mode: "payment",
      customer: customerId,
      "line_items[0][price]": priceFor(tier),
      "line_items[0][quantity]": "1",
      success_url: `${origin}/account?checkout=success`,
      cancel_url: `${origin}/account?checkout=cancelled`,
      client_reference_id: userId,
      "payment_intent_data[metadata][user_id]": userId,
      "metadata[user_id]": userId,
      // The price, written into metadata at the point we know it.
      //
      // This is not belt-and-braces, it is the only thing a webhook can rely on.
      // Stripe does not expand `line_items` in an event payload - it arrives as
      // an empty list with a URL to fetch - so a webhook reading the price from
      // there finds nothing, grants nothing, and answers 200. That is exactly
      // how a real annual purchase was taken and dropped. Metadata set on the
      // session is echoed in the payload verbatim, so this is the price id
      // arriving intact.
      //
      // Trusting it is safe: it is written here, on a route that has already
      // checked the price is one of ours, and the webhook's signature proves
      // Stripe sent it. It is also cross-checked against the tier map, so a price
      // that is not one of ours still grants nothing.
      "payment_intent_data[metadata][price_id]": priceFor(tier),
      "metadata[price_id]": priceFor(tier),
      expires_at: String(row.created_at + 3600),
    },
    // The tier is in the key, not only the token. Two tabs open on this page can
    // ask for different lengths within the same half hour, and they share one row
    // and so one token - and Stripe rejects a reused idempotency key whose body
    // differs from the first. The parent who picked the year was then told "The
    // payment service is unavailable", which is what a genuine outage looks like,
    // for what was a choice between two buttons.
    `checkout-${row.token}-${tier}`,
  );
  await db
    .prepare(
      "UPDATE checkout_requests SET session_id=? WHERE user_id=? AND token=?",
    )
    .bind(session.id, userId, row.token)
    .run();
  return session;
}

/**
 * Whether this payment is already in the ledger and cannot be matched to a term.
 *
 * The one case where a parent must not be sent to Stripe again. `grantPurchase`
 * says no to a payment twice - because it has already granted it, and because the
 * price is not one this deployment sells - and the caller can only tell them apart
 * by asking the ledger. Both facts have to hold: a payment recorded but
 * unmatchable is money already taken that no new checkout can improve on, while a
 * payment that is merely unmatchable and was never recorded has granted nothing
 * and the right thing to do is let them buy again at a price that does work.
 */
async function recordedButUngrantable(
  db: D1Database,
  paymentIntentId: string,
  priceId: string,
): Promise<boolean> {
  const recorded = await db
    .prepare("SELECT 1 AS recorded FROM purchases WHERE confirmation = ?")
    .bind(paymentIntentId)
    .first<{ recorded: number }>();
  return Boolean(recorded) && !tierForPayment(priceId);
}

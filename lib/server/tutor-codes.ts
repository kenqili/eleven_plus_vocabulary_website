/**
 * Tutor discount codes: 20% off the yearly term, one code per tutor.
 *
 * A tutor gets a code (TUTOR-SARAH-20) to hand to their students. The money
 * math lives in Stripe - one shared 20%-off coupon, one promotion code per
 * tutor - and this module holds the mapping plus the policy (yearly only,
 * redemption cap, expiry, suspension) that validation reads without a network
 * call, and the redemption count the private split is worked out from.
 *
 * Why Stripe does the discount rather than a second price per tier: the grant
 * matches the paid price id against the one configured price per tier, so a
 * discounted duplicate price would match nothing and a parent would pay for no
 * access. A coupon leaves the price id untouched, so the entire grant and
 * webhook path works with no changes.
 *
 * Why the count is COUNT(*) over `tutor_redemptions` and never a cached
 * number: a cached count and the rows can disagree, and the rows are the
 * audit. The UNIQUE index on `payment_intent` is what makes a redelivered
 * webhook recover a lost count instead of doubling one.
 */
import { database } from "./db";
import { HttpError } from "./http";
import { stripe } from "./billing";

/** The only discount tutors give, as whole percent. */
export const TUTOR_PERCENT_OFF = 20;
/** The only term a tutor code discounts. A code on any other tier is refused. */
export const TUTOR_TIER = "yearly";
/** How many students may use one code before Stripe refuses it. */
export const TUTOR_MAX_REDEMPTIONS = 100;
/** How long an issued code lasts, in months. */
export const TUTOR_CODE_MONTHS = 12;
/**
 * The shared Stripe coupon every tutor promotion code points at.
 *
 * One coupon, many promotion codes: the percent lives in exactly one place,
 * and issuing a code never mints money rules. Created on first issue if it is
 * not there yet, looked up by this fixed id.
 */
export const TUTOR_COUPON_ID = "tutor-20-yearly";

/** What a code looks like: TUTOR-SARAH-20. Prefix enforced, never optional. */
const LABEL_PREFIX = "TUTOR-";
const LABEL_SUFFIX = `-${TUTOR_PERCENT_OFF}`;

export type TutorCode = {
  id: string;
  label: string;
  tutorId: string;
  tutorName: string;
  tier: string;
  stripeCouponId: string;
  stripePromotionCodeId: string;
  percentOff: number;
  maxRedemptions: number;
  expiresAt: number;
  status: string;
};

/**
 * What a parent types, normalised to the stored form.
 *
 * Upper-cased and de-spaced, hyphens kept: the label carries them, so
 * stripping them would turn two different labels into one lookup. Capped,
 * because the lookup is by value and an unbounded input is a log line, not a
 * code.
 */
export function normaliseTutorCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 64);
}

/**
 * The label for a tutor's code, from their name.
 *
 * Anything that is not a letter or digit becomes a hyphen, runs collapse, and
 * the percent rides on the end so the label says what it is worth: a tutor
 * reading TUTOR-SARAH-20 off a whiteboard cannot misstate the discount.
 * Collisions (two Sarahs) get -2, -3, counted from the rows already stored.
 */
export function tutorCodeLabel(name: string, taken: ReadonlySet<string>): string {
  const stem =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "TUTOR";
  let label = `${LABEL_PREFIX}${stem}${LABEL_SUFFIX}`;
  for (let n = 2; taken.has(label); n += 1)
    label = `${LABEL_PREFIX}${stem}${LABEL_SUFFIX}-${n}`;
  return label;
}

/**
 * The shared 20%-off coupon, created once.
 *
 * Tried first, confirmed after: creating with a fixed id collides when the
 * coupon already exists, and a blind create-then-ignore would also ignore the
 * coupon existing with a different percent - which would discount every tutor
 * code wrongly from then on. So a failed create is followed by a read, and the
 * read must show 20 or this throws rather than issuing against a coupon nobody
 * checked.
 */
async function ensureSharedCoupon(): Promise<string> {
  try {
    await stripe<Record<string, unknown>>("coupons", {
      id: TUTOR_COUPON_ID,
      percent_off: String(TUTOR_PERCENT_OFF),
      duration: "once",
    });
    return TUTOR_COUPON_ID;
  } catch {
    const existing = await stripe<{ percent_off?: number }>(
      `coupons/${encodeURIComponent(TUTOR_COUPON_ID)}`,
    );
    if (existing?.percent_off !== TUTOR_PERCENT_OFF)
      throw new HttpError(
        503,
        "The tutor discount is misconfigured. No code was issued.",
      );
    return TUTOR_COUPON_ID;
  }
}

/**
 * Issue a code to a tutor: our rows plus the Stripe promotion code, in that
 * order.
 *
 * Our rows first, because a Stripe object with no row behind it is a code that
 * works and that nobody can see, count or suspend - money out with no ledger.
 * The failure the other way round (rows without a Stripe code) fails safe, as
 * the note at the Stripe step explains.
 */
export async function issueTutorCode(input: {
  tutorName: string;
  contact?: string;
  maxRedemptions?: number;
  monthsValid?: number;
  label?: string;
}): Promise<{ label: string; tutorId: string; codeId: string }> {
  const name = (input.tutorName ?? "").trim().slice(0, 80);
  if (!name) throw new HttpError(400, "Name the tutor the code is for.");
  const maxRedemptions = input.maxRedemptions ?? TUTOR_MAX_REDEMPTIONS;
  if (
    !Number.isInteger(maxRedemptions) ||
    maxRedemptions < 1 ||
    maxRedemptions > 1000
  )
    throw new HttpError(400, "Cap redemptions between 1 and 1000.");
  const monthsValid = input.monthsValid ?? TUTOR_CODE_MONTHS;
  if (!Number.isInteger(monthsValid) || monthsValid < 1 || monthsValid > 36)
    throw new HttpError(400, "Set validity between 1 and 36 months.");
  const db = database();
  const taken = new Set(
    (
      await db
        .prepare("SELECT label FROM tutor_codes")
        .all<{ label: string }>()
    ).results.map((row) => row.label),
  );
  const wanted = input.label ? normaliseTutorCode(input.label) : "";
  const label = wanted || tutorCodeLabel(name, taken);
  // The shape, not just the affixes: the collision suffix (-2, -3) rides after
  // the percent, so an endsWith check would refuse the very labels the
  // collision rule mints. Built from the constants, so a future percent does
  // not rot the pattern.
  const shape = new RegExp(
    `^${LABEL_PREFIX}[A-Z0-9-]*[A-Z0-9]-${TUTOR_PERCENT_OFF}(-\\d+)?$`,
  );
  if (!shape.test(label) || taken.has(label))
    throw new HttpError(
      400,
      `Labels look like TUTOR-NAME-${TUTOR_PERCENT_OFF} and must be unused.`,
    );
  const now = Date.now();
  const expiresAt = now + monthsValid * 30 * 86_400_000;
  const tutorId = crypto.randomUUID();
  const codeId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        "INSERT INTO tutors (id,name,contact,status,created_at) VALUES (?,?,?,'active',?)",
      )
      .bind(tutorId, name, (input.contact ?? "").trim().slice(0, 160) || null, now),
    // The Stripe promotion code id follows: an empty string validates as
    // suspended, so a failure between here and the Stripe create leaves a row
    // that refuses rather than a code that works unseen. See above.
    db
      .prepare(
        `INSERT INTO tutor_codes
           (id,tutor_id,label,tier,stripe_coupon_id,stripe_promotion_code_id,percent_off,max_redemptions,expires_at,status,created_at)
         VALUES (?,?,?,?,'','',?,?,?,'active',?)`,
      )
      .bind(
        codeId,
        tutorId,
        label,
        TUTOR_TIER,
        TUTOR_PERCENT_OFF,
        maxRedemptions,
        expiresAt,
        now,
      ),
  ]);
  // Our insert and the Stripe create are separate steps, and a failure between
  // them leaves a row whose promotion code id is empty, which validation
  // refuses like a suspended code. Re-issuing then collides onto -2, and the
  // dead row stays visible rather than silently working. A row that cannot
  // validate cannot take money, which is the safe direction to fail in.
  const couponId = await ensureSharedCoupon();
  // Stripe counts expiry in seconds; the database in milliseconds. Converted
  // here, once, because a seconds value stored as milliseconds would read as
  // January 1970 and a milliseconds value sent to Stripe would run for 30,000
  // years.
  const promo = await stripe<{ id: string }>("promotion_codes", {
    code: label,
    coupon: couponId,
    active: "true",
    max_redemptions: String(maxRedemptions),
    expires_at: String(Math.floor(expiresAt / 1000)),
  });
  // `.run()` is the statement: without it this is a prepared query that
  // changes nothing, and the row keeps its empty promotion code id - which
  // validation reads as suspended, so the issued code would never work.
  await db
    .prepare(
      "UPDATE tutor_codes SET stripe_coupon_id=?, stripe_promotion_code_id=? WHERE id=?",
    )
    .bind(couponId, promo.id, codeId)
    .run();
  return { label, tutorId, codeId };
}

/**
 * Whether a code may discount a tier, for display and for checkout.
 *
 * One message for unknown, suspended, expired or fully-redeemed codes: telling
 * those apart confirms a code to anyone holding a list of them. The tier
 * mismatch gets its own message, because it reveals nothing secret and the
 * parent can act on it - they picked the wrong length, not a bad code.
 * Redemption counts are NOT checked here: Stripe enforces the cap at payment
 * time, and a count read here would race the payment anyway.
 */
export async function quoteTutorCode(
  rawLabel: string,
  tier: string,
): Promise<TutorCode> {
  const label = normaliseTutorCode(rawLabel);
  if (!label) throw new HttpError(400, "Enter your tutor's code.");
  const row = await database()
    .prepare(
      `SELECT c.id, c.label, c.tutor_id AS tutorId, t.name AS tutorName, c.tier,
              c.stripe_coupon_id AS stripeCouponId,
              c.stripe_promotion_code_id AS stripePromotionCodeId,
              c.percent_off AS percentOff, c.max_redemptions AS maxRedemptions,
              c.expires_at AS expiresAt, c.status
         FROM tutor_codes c JOIN tutors t ON t.id = c.tutor_id
        WHERE c.label = ?`,
    )
    .bind(label)
    .first<TutorCode & { status: string } & { tutorStatus?: never }>();
  const usable =
    row &&
    row.status === "active" &&
    row.expiresAt > Date.now() &&
    row.stripePromotionCodeId !== "";
  // Suspended tutors invalidate their codes: a tutor who is no longer someone
  // we work with must not keep discounting, and the code is theirs, not the
  // student's, so there is nothing grandfathered.
  const tutorActive =
    usable &&
    (await database()
      .prepare("SELECT status FROM tutors WHERE id = ?")
      .bind(row.tutorId)
      .first<{ status: string }>())?.status === "active";
  if (!usable || !tutorActive)
    throw new HttpError(400, "That tutor code is not valid.");
  if (tier !== row.tier)
    throw new HttpError(400, "Tutor codes work on the 1-year option.");
  return row;
}

/**
 * The discounted amount for display, in minor units.
 *
 * Integer math, half up. Stripe does the final computation at payment and the
 * whole-pound prices this site charges make it exact; on an odd-pence price
 * this could differ by a penny from the charge, which is why the button names
 * the percent as well as the figure.
 */
export function discountedAmount(amount: number, percentOff: number): number {
  return amount - Math.round((amount * percentOff) / 100);
}

/**
 * Count a paid referral, exactly once.
 *
 * Inserted only when the purchase row exists: a payment for a price this
 * deployment does not sell grants nothing, and a referral for a grant that
 * never happened would pay a tutor for access nobody got. `ON CONFLICT DO
 * NOTHING` on the payment intent is what makes a redelivered webhook recover
 * a lost count (the grant already happened, so a grant-gated write would skip
 * it) instead of doubling one.
 */
export async function recordTutorRedemption(input: {
  paymentIntent: string;
  userId: string;
  label: string;
}): Promise<boolean> {
  const label = normaliseTutorCode(input.label);
  if (!label || !input.paymentIntent) return false;
  const now = Date.now();
  const result = await database()
    .prepare(
      `INSERT INTO tutor_redemptions (id,tutor_code_id,user_id,payment_intent,created_at)
       SELECT ?, c.id, ?, ?, ?
         FROM tutor_codes c
        WHERE c.label = ?
          AND EXISTS (SELECT 1 FROM purchases WHERE confirmation = ?)
        ON CONFLICT(payment_intent) DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      input.userId,
      input.paymentIntent,
      now,
      label,
      input.paymentIntent,
    )
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** Per-code redemption counts, for the admin page and the private splits. */
export async function tutorCodeStats(): Promise<
  Array<{
    id: string;
    label: string;
    tutorName: string;
    contact: string | null;
    tier: string;
    percentOff: number;
    maxRedemptions: number;
    redeemed: number;
    expiresAt: number;
    status: string;
    createdAt: number;
  }>
> {
  const rows = (
    await database()
      .prepare(
        `SELECT c.id, c.label, t.name AS tutorName, t.contact, c.tier,
                c.percent_off AS percentOff, c.max_redemptions AS maxRedemptions,
                (SELECT COUNT(*) FROM tutor_redemptions r WHERE r.tutor_code_id = c.id) AS redeemed,
                c.expires_at AS expiresAt, c.status, c.created_at AS createdAt
           FROM tutor_codes c JOIN tutors t ON t.id = c.tutor_id
          ORDER BY c.created_at DESC
          LIMIT 100`,
      )
      .all<{
        id: string;
        label: string;
        tutorName: string;
        contact: string | null;
        tier: string;
        percentOff: number;
        maxRedemptions: number;
        redeemed: number;
        expiresAt: number;
        status: string;
        createdAt: number;
      }>()
  ).results;
  return rows;
}

/**
 * Suspend a code, here and at Stripe.
 *
 * Both, because either alone leaves a working code: ours alone still
 * discounts at Stripe, Stripe's alone still validates here and is then
 * refused at payment with a worse message. Suspension is for tutors who are
 * no longer someone we work with; expiry and the redemption cap are the
 * normal endings and need no action.
 */
export async function suspendTutorCode(codeId: string): Promise<void> {
  const db = database();
  const row = await db
    .prepare("SELECT stripe_promotion_code_id FROM tutor_codes WHERE id = ?")
    .bind(codeId)
    .first<{ stripe_promotion_code_id: string }>();
  if (!row) throw new HttpError(404, "No such tutor code.");
  if (row.stripe_promotion_code_id) {
    try {
      await stripe(
        `promotion_codes/${encodeURIComponent(row.stripe_promotion_code_id)}`,
        { active: "false" },
      );
    } catch (error) {
      console.error(
        "Tutor promotion code could not be deactivated at Stripe",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }
  await db
    .prepare("UPDATE tutor_codes SET status='suspended' WHERE id = ?")
    .bind(codeId)
    .run();
}

/**
 * Discount codes: 20% off the yearly term for a tutor's students, and our own
 * vouchers for a promotion, with any percent.
 *
 * A tutor gets a code (TUTOR-SARAH-20) to hand to their students and a rebate
 * for each one who uses it. We issue ourselves vouchers (SUMMER-50) that differ
 * in one thing: they belong to nobody. Both are rows in `tutor_codes`, both are
 * one Stripe coupon plus one promotion code, and both are counted the same way,
 * because from the parent's side they are the same offer.
 *
 * The money math lives in Stripe - a coupon per percent, one promotion code per
 * code - and this module holds the mapping plus the policy (yearly only,
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

/** The discount tutors give, as whole percent. Ours may differ per voucher. */
export const TUTOR_PERCENT_OFF = 20;
/** The only term any code discounts. A code on any other tier is refused. */
export const TUTOR_TIER = "yearly";
/** How many families may use one code before Stripe refuses it. */
export const TUTOR_MAX_REDEMPTIONS = 100;
/** How long an issued code lasts, in months. */
export const TUTOR_CODE_MONTHS = 12;
/**
 * The Stripe coupon for a percent: one per percent, shared by every code worth
 * it.
 *
 * One coupon per percent and many promotion codes per coupon, because the
 * percent is a money rule and there should be one place it lives: issuing ten
 * 20% codes must not create ten ways for the discount to be edited. The id is
 * derived, so the coupon can be found in the dashboard from the percent alone.
 */
export function voucherCouponId(percentOff: number): string {
  return `voucher-${percentOff}-yearly`;
}

/** What a code looks like: TUTOR-SARAH-20. Prefix enforced, never optional. */
const LABEL_PREFIX = "TUTOR-";
const LABEL_SUFFIX = `-${TUTOR_PERCENT_OFF}`;

export type TutorCode = {
  id: string;
  label: string;
  /** Null when the code is ours rather than a tutor's. */
  tutorId: string | null;
  tutorName: string | null;
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
 * The label for one of our own vouchers, from what we want to call it.
 *
 * Named after the promotion rather than after us - SUMMER-SALE-50 - because the
 * label is the one thing a parent reads back to us when something goes wrong,
 * and "VOUCHER" tells them nothing about which offer they took. The percent
 * rides on the end for the reason it does on a tutor's code: a label read off a
 * screen or a flyer says what it is worth.
 *
 * TUTOR- is refused rather than sanitised. It is the prefix that marks a code as
 * a tutor's, and one of ours wearing it would file our promotion under somebody
 * else's rebate.
 */
export function houseVoucherLabel(
  label: string,
  percentOff: number,
  taken: ReadonlySet<string>,
): string {
  const stem = (label ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (!stem) throw new HttpError(400, "Name the voucher.");
  if (stem.startsWith(LABEL_PREFIX))
    throw new HttpError(
      400,
      "TUTOR- is for tutor codes. Name the voucher after the promotion.",
    );
  const named = stem.endsWith(`-${percentOff}`) ? stem : `${stem}-${percentOff}`;
  let full = named;
  for (let n = 2; taken.has(full); n += 1) full = `${named}-${n}`;
  return full;
}

/**
 * The coupon for a percent, created once.
 *
 * One coupon per percent rather than one per code: the percent is a money rule,
 * and a rule edited in one place is a rule that cannot come to mean two things.
 * The id is derived from the percent, so the object can be found in the
 * dashboard without a lookup here.
 *
 * Tried first, confirmed after: creating with a fixed id collides when the
 * coupon already exists, and a blind create-then-ignore would also ignore the
 * coupon existing with a different percent - which would discount every code
 * worth that percent wrongly from then on. So a failed create is followed by a
 * read, and the read must show the percent asked for, or this throws rather
 * than issuing against a coupon nobody checked.
 */
async function ensureCoupon(percentOff: number): Promise<string> {
  const id = voucherCouponId(percentOff);
  try {
    await stripe<Record<string, unknown>>("coupons", {
      id,
      percent_off: String(percentOff),
      duration: "once",
    });
    return id;
  } catch {
    const existing = await stripe<{ percent_off?: number }>(
      `coupons/${encodeURIComponent(id)}`,
    );
    if (existing?.percent_off !== percentOff)
      throw new HttpError(
        503,
        "The discount is misconfigured. No code was issued.",
      );
    return id;
  }
}

/** Every label already stored, for the collision rules to count from. */
async function takenLabels(): Promise<Set<string>> {
  const rows = await database()
    .prepare("SELECT label FROM tutor_codes")
    .all<{ label: string }>();
  return new Set(rows.results.map((row) => row.label));
}

/** Shared by both issuers: the cap is a policy, not a per-issuer opinion. */
function checkCap(maxRedemptions: number): void {
  if (
    !Number.isInteger(maxRedemptions) ||
    maxRedemptions < 1 ||
    maxRedemptions > 1000
  )
    throw new HttpError(400, "Cap redemptions between 1 and 1000.");
}

/** As above, for expiry. Stripe is told the same date, in seconds. */
function checkMonths(monthsValid: number): void {
  if (!Number.isInteger(monthsValid) || monthsValid < 1 || monthsValid > 36)
    throw new HttpError(400, "Set validity between 1 and 36 months.");
}

/**
 * The row, the Stripe objects, and the ids written back - one code, either
 * kind.
 *
 * Our row first, because a Stripe object with no row behind it is a code that
 * works and that nobody can see, count or suspend - money out with no ledger.
 * The failure the other way round (a row with no Stripe code) fails safe: an
 * empty promotion code id reads as suspended, so the code refuses at checkout
 * rather than working unseen, and re-issuing collides onto -2 and leaves the
 * dead row in front of the administrator.
 *
 * The two steps cannot be made one. Stripe is a network call and D1 is a
 * database, so there is a window either way; this is the order whose window
 * fails towards refusing money rather than towards taking it.
 */
async function issueCode(input: {
  label: string;
  percentOff: number;
  tutorId: string | null;
  maxRedemptions: number;
  monthsValid: number;
}): Promise<string> {
  const db = database();
  const now = Date.now();
  const expiresAt = now + input.monthsValid * 30 * 86_400_000;
  const codeId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO tutor_codes
         (id,tutor_id,label,tier,stripe_coupon_id,stripe_promotion_code_id,percent_off,max_redemptions,expires_at,status,created_at)
       VALUES (?,?,?,?,'','',?,?,?,'active',?)`,
    )
    .bind(
      codeId,
      input.tutorId,
      input.label,
      TUTOR_TIER,
      input.percentOff,
      input.maxRedemptions,
      expiresAt,
      now,
    )
    .run();
  const couponId = await ensureCoupon(input.percentOff);
  // Stripe counts expiry in seconds; the database in milliseconds. Converted
  // here, once, because a seconds value stored as milliseconds would read as
  // January 1970 and a milliseconds value sent to Stripe would run for 30,000
  // years.
  const promo = await stripe<{ id: string }>("promotion_codes", {
    code: input.label,
    coupon: couponId,
    active: "true",
    max_redemptions: String(input.maxRedemptions),
    expires_at: String(Math.floor(expiresAt / 1000)),
  });
  // `.run()` is the statement: without it this is a prepared query that changes
  // nothing, and the row keeps its empty promotion code id - which validation
  // reads as suspended, so the issued code would never work.
  await db
    .prepare(
      "UPDATE tutor_codes SET stripe_coupon_id=?, stripe_promotion_code_id=? WHERE id=?",
    )
    .bind(couponId, promo.id, codeId)
    .run();
  return codeId;
}

/**
 * Issue a code to a tutor: 20% off, one per tutor, for their students.
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
  checkCap(maxRedemptions);
  const monthsValid = input.monthsValid ?? TUTOR_CODE_MONTHS;
  checkMonths(monthsValid);
  const db = database();
  const taken = await takenLabels();
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
  const tutorId = crypto.randomUUID();
  // The tutor row and their code are one batch: a tutor with no code is a name
  // the administrator typed and cannot see again, and a code with no tutor is
  // ours, which is a different thing. `issueCode` owns the code itself.
  await db
    .prepare(
      "INSERT INTO tutors (id,name,contact,status,created_at) VALUES (?,?,?,'active',?)",
    )
    .bind(tutorId, name, (input.contact ?? "").trim().slice(0, 160) || null, now)
    .run();
  const codeId = await issueCode({
    label,
    percentOff: TUTOR_PERCENT_OFF,
    tutorId,
    maxRedemptions,
    monthsValid,
  });
  return { label, tutorId, codeId };
}

/**
 * Issue one of our own vouchers: any percent, named after the promotion, not
 * attached to anybody.
 *
 * No `tutors` row is created. A house voucher has no issuer to record, and
 * inventing a tutor row called "us" would put a name in the rebate list that
 * nobody is owed anything against - so `tutor_id` stays NULL, which is exactly
 * what that column means.
 */
export async function issueHouseVoucher(input: {
  label: string;
  percentOff: number;
  maxRedemptions?: number;
  monthsValid?: number;
}): Promise<{ label: string; codeId: string }> {
  const percentOff = Number(input.percentOff);
  // Whole percent, and never 100: a voucher that makes the yearly term free is
  // the coupon feature, which grants access without a payment and therefore
  // without a price to discount. Reaching for this one to do that job would
  // create a Stripe promotion code no payment can use.
  if (!Number.isInteger(percentOff) || percentOff < 1 || percentOff > 90)
    throw new HttpError(400, "Pick a whole percent between 1 and 90.");
  const maxRedemptions = input.maxRedemptions ?? TUTOR_MAX_REDEMPTIONS;
  checkCap(maxRedemptions);
  const monthsValid = input.monthsValid ?? TUTOR_CODE_MONTHS;
  checkMonths(monthsValid);
  const label = houseVoucherLabel(
    input.label,
    percentOff,
    await takenLabels(),
  );
  const codeId = await issueCode({
    label,
    percentOff,
    tutorId: null,
    maxRedemptions,
    monthsValid,
  });
  return { label, codeId };
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
  if (!label) throw new HttpError(400, "Enter your code.");
  // LEFT JOIN, because our own vouchers have no tutor. A plain JOIN would drop
  // them silently, and the parent would be told their code was invalid - the
  // one failure mode where a working code is refused and nobody can see why.
  const row = await database()
    .prepare(
      `SELECT c.id, c.label, c.tutor_id AS tutorId, t.name AS tutorName,
              t.status AS tutorStatus, c.tier,
              c.stripe_coupon_id AS stripeCouponId,
              c.stripe_promotion_code_id AS stripePromotionCodeId,
              c.percent_off AS percentOff, c.max_redemptions AS maxRedemptions,
              c.expires_at AS expiresAt, c.status
         FROM tutor_codes c LEFT JOIN tutors t ON t.id = c.tutor_id
        WHERE c.label = ?`,
    )
    .bind(label)
    .first<TutorCode & { tutorStatus?: string | null }>();
  const usable =
    row &&
    row.status === "active" &&
    row.expiresAt > Date.now() &&
    row.stripePromotionCodeId !== "";
  // Suspended tutors invalidate their codes: a tutor who is no longer someone
  // we work with must not keep discounting, and the code is theirs, not the
  // student's, so there is nothing grandfathered. A code with no tutor has no
  // one to suspend - it is ours, and suspending it is what `status` is for.
  if (!usable || (row.tutorId !== null && row.tutorStatus !== "active"))
    throw new HttpError(400, "That code is not valid.");
  if (tier !== row.tier)
    throw new HttpError(400, "This code works on the 1-year option.");
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
    tutorId: string | null;
    tutorName: string | null;
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
        // LEFT JOIN, so our own vouchers are listed rather than dropped: the
        // page that issues them is the page that counts them, and a voucher
        // missing from the list is one nobody can suspend.
        `SELECT c.id, c.label, c.tutor_id AS tutorId, t.name AS tutorName,
                t.contact, c.tier,
                c.percent_off AS percentOff, c.max_redemptions AS maxRedemptions,
                (SELECT COUNT(*) FROM tutor_redemptions r WHERE r.tutor_code_id = c.id) AS redeemed,
                c.expires_at AS expiresAt, c.status, c.created_at AS createdAt
           FROM tutor_codes c LEFT JOIN tutors t ON t.id = c.tutor_id
          ORDER BY c.created_at DESC
          LIMIT 100`,
      )
      .all<{
        id: string;
        label: string;
        tutorId: string | null;
        tutorName: string | null;
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
 * refused at payment with a worse message. Suspension is for a tutor we no
 * longer work with, or a promotion we have called off; expiry and the
 * redemption cap are the normal endings and need no action.
 */
export async function suspendTutorCode(codeId: string): Promise<void> {
  const db = database();
  const row = await db
    .prepare("SELECT stripe_promotion_code_id FROM tutor_codes WHERE id = ?")
    .bind(codeId)
    .first<{ stripe_promotion_code_id: string }>();
  if (!row) throw new HttpError(404, "No such code.");
  if (row.stripe_promotion_code_id) {
    try {
      await stripe(
        `promotion_codes/${encodeURIComponent(row.stripe_promotion_code_id)}`,
        { active: "false" },
      );
    } catch (error) {
      console.error(
        "Promotion code could not be deactivated at Stripe",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }
  await db
    .prepare("UPDATE tutor_codes SET status='suspended' WHERE id = ?")
    .bind(codeId)
    .run();
}

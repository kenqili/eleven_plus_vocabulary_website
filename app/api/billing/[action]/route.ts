import { requireUser, rateLimit } from "@/lib/server/auth";
import { database, setting } from "@/lib/server/db";
import {
  availableTiers,
  billingReady,
  membership,
  priceFor,
  stripe,
  checkoutSession,
  configuredFreeWordLimit,
  configuredFreeTrialDays,
  TIERS,
} from "@/lib/server/billing";
import { boundary, body, HttpError, json, sameOrigin } from "@/lib/server/http";
import { COUPON_CONFIRMATION_PREFIX } from "@/lib/server/coupon";

/**
 * What this parent has bought, from the `purchases` rows the webhook writes.
 *
 * Read from the local ledger rather than from Stripe, for two reasons. It is
 * already there, so the account page costs no Stripe calls to render; and it is
 * the record the grant itself was written from, so what a parent reads here is
 * the same thing that decided their access rather than a second opinion about it.
 *
 * Capped, because this is a parent's own history and not an export: nobody has
 * bought enough terms for an unbounded list to be a real need.
 */
/**
 * How a length is written everywhere a parent reads one.
 *
 * One function so a code worth 90 days and a purchase of 3 months are not two
 * spellings of the same length. `COUPON_DAYS` in lib/server/coupon.ts is the same
 * 30/90/365 on purpose, so a code and a purchase of the same length can share a
 * label; anything outside those three is written as the day count, because a
 * wrong guess about what a length is called is worse than the number.
 */
const lengthLabel = (days: number) =>
  TIERS.find((t) => t.days === days)?.label ?? `${days} days`;

/**
 * What a code row is called when its own length is no longer readable.
 *
 * Reachable, not hypothetical: the length is read by joining `coupons`, and that
 * row is gone if the code was deleted after being redeemed. The row still exists
 * in `purchases` and is still shown, so it still has to be called something - and
 * `lengthLabel(0)` would have called it "0 days", which reads as a code that was
 * worth nothing rather than one whose length we can no longer see.
 *
 * Used only for the label. The number of days is not invented, because a length
 * this page cannot read is a fact about the data, not something to paper over.
 */
const CODE_LABEL = "Code";

async function purchaseHistory(userId: string) {
  const rows = await database()
    .prepare(
      // The code's own duration, joined in rather than guessed.
      //
      // `purchases` records what a payment bought as a price id, and a code has
      // none: it is written as the literal 'coupon', with the code's own id kept in
      // `confirmation`. So the row cannot say how long the code was worth on its
      // own, and every code fell back to a flat "Access" - a grandparent-funded
      // year appearing in a parent's history as something whose length nobody
      // could name.
      //
      // The join is on `confirmation`, because that is where the code's id lives:
      // redemption writes it as `coupon:<id>` (see lib/server/coupon.ts). No column
      // was added for this, deliberately - `purchases` records what was paid for
      // and a code was not paid for by this account, so the days belong to the
      // code and are read from the code.
      //
      // LEFT JOIN, so a purchase row still appears if its code has since been
      // removed - which is why it cannot also be what says whether the row is a
      // code. See the note on `isCode` below.
      `SELECT p.product_id, p.confirmation, p.new_expiry, p.original_expiry, p.status,
              p.created_at, c.days AS coupon_days
         FROM purchases p
         LEFT JOIN coupons c ON p.confirmation = '${COUPON_CONFIRMATION_PREFIX}' || c.id
        WHERE p.user_id = ?
        ORDER BY p.created_at DESC
        LIMIT 20`,
    )
    .bind(userId)
    .all<{
      product_id: string;
      confirmation: string;
      new_expiry: number;
      original_expiry: number | null;
      status: string;
      created_at: number;
      coupon_days: number | null;
    }>();
  return rows.results.map((row) => {
    // The label from the tier map, so it reads "3 months" rather than
    // "price_1ULnzjEjo42uv0eV2AZlrQOQ". A parent cannot act on a price id.
    const tier = TIERS.find((t) => priceFor(t.id) === row.product_id);
    // A code is named as one, because this account did not pay for it -
    // somebody else did, which is the whole reason the feature exists, and a
    // history that cannot tell those apart tells a parent they paid for
    // something they were given. It was written as the bare word "Access",
    // which is also the fallback for an unrecognised price id, so a code was
    // indistinguishable from anything else in the one table on this site that
    // accounts for a parent's money.
    //
    // Whether a row is a code is read from `confirmation`, NOT from the join. The
    // join is a LEFT one so that a row still appears if its code has since been
    // deleted - but that means a null from the join says "not a code *or* the code
    // is gone", and reading it as "not a code" put a deleted code's row back in
    // front of the parent labelled "Paid". The prefix is written by the redemption
    // and nothing else, so it is the fact rather than a join that can lose its
    // match; the length still comes from the join, because that is the only place
    // it is stored.
    const isCode = row.confirmation.startsWith(COUPON_CONFIRMATION_PREFIX);
    const coupon = row.coupon_days;
    return {
      label: isCode
        ? // The code is named as one, and the length is whatever the join could still
          // find. With no code row left to ask, it is called a code and given no
          // length rather than the invented "0 days".
          coupon === null
          ? CODE_LABEL
          : `${lengthLabel(coupon)} code`
        : (tier?.label ?? "Access"),
      days: coupon ?? tier?.days ?? 0,
      status: row.status,
      boughtAt: row.created_at,
      expiresAt: row.new_expiry,
      // null when they bought it before they had any access at all, which is the
      // normal first purchase and not something to render as a date.
      extendedFrom: row.original_expiry,
      // Whether this row is a code rather than a purchase, so the interface can
      // say so and the summary and the table can agree about it.
      viaCode: isCode,
    };
  });
}

/** What Stripe returns for one price, which is what a parent is shown. */
type StripePrice = {
  active: boolean;
  unit_amount: number | null;
  currency: string;
  recurring?: { interval: string; interval_count: number } | null;
};

export async function GET(request: Request) {
  return boundary(async () => {
    const user = await requireUser(request);
    const ready = billingReady();
    // One request per tier rather than one for the whole catalogue: the price
    // endpoint is a direct lookup, so three of them answer the question exactly,
    // whereas listing prices would return every price the account has ever made
    // and filter it here. In parallel, because the account page waits for this.
    //
    // And each one is best effort. This whole route used to be all-or-nothing on
    // Stripe: one failed price lookup threw, `boundary` turned it into a 502 for
    // the entire response, and the interface rejected before it had set anything -
    // so a parent who had come to sign out, to read when their access ends, or to
    // enter a code they had been sent was told "The payment service is
    // unavailable" and shown an account page with no prices, no expiry date and no
    // purchase history. The membership facts are already in the local database
    // and none of them need a network round trip, so a price lookup that fails
    // now costs the price and nothing else.
    const priced = ready
      ? await Promise.all(
          availableTiers().map(async (tier) => {
            const base = {
              tier: tier.id,
              label: tier.label,
              days: tier.days,
              // Read from configuration rather than assumed, so an option whose
              // price could not be fetched is not rendered in a currency nobody
              // chose. `gbp` because every price in this app is a UK price.
              currency: "gbp",
              // Shown so the page can say why an option is unavailable rather
              // than rendering a button that will be refused at checkout.
              recurring: false,
            };
            try {
              const price = await stripe<StripePrice>(
                `prices/${encodeURIComponent(priceFor(tier.id))}`,
              );
              return {
                ...base,
                amount: price.unit_amount,
                currency: price.currency,
                recurring: Boolean(price.recurring),
              };
            } catch (error) {
              console.error(
                "Could not read a Stripe price",
                tier.id,
                error instanceof Error ? error.message : "Unknown error",
              );
              // `amount: null` is what the interface already renders as an
              // unpriced, disabled option, so this needs no new state.
              return { ...base, amount: null };
            }
          }),
        )
      : [];
    const purchases = await purchaseHistory(user.id);
    return json({
      ...(await membership(user)),
      ready,
      freeWordLimit: configuredFreeWordLimit(),
      // The array rather than the single `price` this replaced. A parent choosing
      // between three lengths cannot be shown one of them and left to guess.
      prices: priced,
      // What they have bought and when it runs out. Without this a parent who has
      // just paid sees only "Access through <date>", and has no way to tell
      // whether that date is from a term they bought, a trial, or a coupon
      // somebody else arranged - which is the question they are actually asking
      // after a payment.
      //
      // Read whatever `ready` says. This is a query against the local ledger and
      // needs nothing from Stripe, so a deployment with a price missing still has
      // a history to show - and the section's own reason for existing applies more
      // strongly when something is wrong, not less. Gating it on `ready` meant the
      // one screen a parent goes to when a purchase went wrong showed them no
      // record of any purchase.
      purchases,
      // Whether this account has ever paid or been given anything, which the
      // membership query above cannot answer: `trialExpired` is `!active && !trial`
      // and is equally true for a lapsed paid term. The interface needs the
      // difference to say "your access has ended" to one and "your free trial has
      // ended" to the other, and it can only get it from here.
      //
      // A refunded purchase does not count. A parent who bought a term, refunded
      // it and has nothing left was never left with access, and telling them their
      // access "has ended" would describe a term they do not have.
      everPaid: purchases.some((row) => row.status !== "refunded"),
      canManage: Boolean(user.customer_id),
      freeTrialDays: configuredFreeTrialDays(),
    });
  });
}
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  return boundary(async () => {
    sameOrigin(request);
    const user = await requireUser(request);
    const { action } = await context.params;
    // Keyed by action, because the two are not the same kind of request and one
    // budget between them punished the wrong thing. A parent whose payment failed
    // twice and who then pressed "Manage billing" to look for the receipt was told
    // they had made too many attempts and to wait fifteen minutes - for pressing one
    // button, once, after the button they actually wanted had already been
    // exhausted. Neither action is worth 20 requests a window to itself.
    await rateLimit(`billing:${action}:${user.id}`, 20);
    if (!billingReady())
      throw new HttpError(503, "Membership payments are not available yet.");
    const origin = new URL(setting("APP_ORIGIN")).origin;
    if (action === "portal") {
      if (!user.customer_id)
        throw new HttpError(400, "There is no billing account to manage yet.");
      const session = await stripe<{ url: string }>("billing_portal/sessions", {
        customer: user.customer_id,
        return_url: `${origin}/account`,
      });
      return json({ url: session.url });
    }
    if (action !== "checkout") throw new HttpError(404, "Unknown action.");
    let customerId = user.customer_id;
    if (!customerId) {
      const customer = await stripe<{ id: string }>(
        "customers",
        { email: user.email, "metadata[user_id]": user.id },
        `customer-${user.id}`,
      );
      customerId = customer.id;
      await database()
        .prepare(
          "UPDATE users SET customer_id = ? WHERE id = ? AND customer_id IS NULL",
        )
        .bind(customerId, user.id)
        .run();
    }
    // Repeat purchases are allowed, and this used to be where that was refused.
    // It was right for a subscription - one live subscription per customer is the
    // rule Stripe's own API enforces - and wrong for a fixed term, where a family
    // buying a second term in month two has to be able to. Nothing else was
    // stopping it: there is no plan to switch, so a repeat purchase is simply
    // another term added to the one they have.
    //
    // Two attempts at once are kept apart by the client, which disables the button
    // while a purchase is in flight, and by Stripe, which is given an idempotency
    // key derived from the row's token and the tier asked for - so a second press
    // of the same button returns the session already created rather than opening
    // another. `checkout_requests` itself does not serialise anything: its insert
    // only replaces a row that has no session attached, so it is what lets an
    // abandoned attempt be started again, not what prevents a double charge.
    const input = await body(request);
    const wanted = typeof input.tier === "string" ? input.tier : "";
    const tier = availableTiers().find((t) => t.id === wanted);
    if (!tier)
      throw new HttpError(400, "Choose how long you would like access for.");
    // What the price in the Stripe dashboard actually is. It has to be a one-time
    // price, and saying so explicitly is the whole check: a recurring price filed
    // under the quarterly id would charge the quarterly price once and then bill
    // the parent every month, while this app - which grants a fixed term and never
    // listens for a renewal - would have granted three months and stopped there.
    // The parent would be charged monthly for access that quietly ended.
    const price = await stripe<StripePrice>(
      `prices/${encodeURIComponent(priceFor(tier.id))}`,
    );
    if (!price.active)
      throw new HttpError(
        503,
        `The ${tier.label} option is not available at the moment.`,
      );
    if (price.recurring)
      throw new HttpError(
        503,
        `The ${tier.label} option is set up as a recurring price, which this site does not use. Please choose another option.`,
      );
    const session = await checkoutSession(user.id, customerId, origin, tier.id);
    return json({ url: session.url });
  });
}

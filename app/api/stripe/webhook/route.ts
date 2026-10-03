import { setting } from "@/lib/server/db";
import { grantPurchase, revokePurchase } from "@/lib/server/billing";
import { verifyStripeSignature } from "@/lib/server/webhook";
import { boundary, HttpError, json } from "@/lib/server/http";

/**
 * The price and user on a completed checkout, from either of the two places
 * Stripe puts them.
 *
 * `payment_intent` is where they are for a one-time payment, and it is the only
 * value that matters besides the id: the app grants against the payment intent,
 * because that is the one identifier that is unique per payment and unique in
 * the `purchases` ledger, so a redelivered event collapses onto the same row
 * instead of granting a second term.
 */
export async function POST(request: Request) {
  return boundary(async () => {
    const raw = await request.text();
    if (raw.length > 1000000) throw new HttpError(413, "Payload too large.");
    if (
      !verifyStripeSignature(
        raw,
        request.headers.get("stripe-signature") || "",
        setting("STRIPE_WEBHOOK_SECRET"),
      )
    )
      throw new HttpError(400, "Invalid webhook signature.");
    const event = JSON.parse(raw);
    const object = event.data?.object ?? {};
    // Read from the session *and* the payment intent. Stripe copies
    // `payment_intent_data[metadata]` onto the intent, and which of the two
    // carries the user depends on the event, so both are read rather than one
    // being assumed.
    if (event.type === "checkout.session.completed") {
      const intent = object.payment_intent;
      const expanded = typeof intent === "object" && intent ? intent : null;
      const paymentIntentId =
        typeof intent === "string" ? intent : (expanded?.id ?? null);
      const userId =
        expanded?.metadata?.user_id || object.metadata?.user_id || null;
      // Paid, not merely completed. With a delayed method - a bank transfer or
      // a payment link - Stripe emits `checkout.session.completed` while the
      // money is still in flight, with `payment_status: "unpaid"` and a payment
      // intent already created. Granting on that gives away a term that may
      // never be collected, and there is no charge to dispute afterwards.
      // Absent `payment_status` is treated as paid, because that is what an
      // older payload shape looks like and the signature has already proved it
      // came from Stripe.
      const paid = (object.payment_status ?? "paid") === "paid";
      // The price comes from metadata we set at checkout, not from `line_items`.
      //
      // Stripe does not expand line_items in an event payload - it arrives as an
      // empty list plus a URL to fetch - so reading the price from there finds
      // nothing, the grant is skipped, and the route still answers 200. That is
      // how a real £12 purchase was taken and dropped with no error anywhere.
      //
      // Metadata is therefore read first, on both the session and the payment
      // intent, because it is the one that is always present - it is echoed into
      // the event verbatim. `line_items` is the fallback for a session created
      // before that metadata was being written, which is the only case it can
      // answer. This comment used to say the opposite, and a test asserts the
      // order, which is how a comment can be wrong and the code right.
      const priceId =
        expanded?.metadata?.price_id ||
        object.metadata?.price_id ||
        object.line_items?.data?.[0]?.price?.id ||
        null;
      if (!paymentIntentId || !userId || !priceId || !paid) {
        // Logged rather than swallowed. A completed payment with nothing to act
        // on means a parent has paid and will not get access, and this is the only
        // place that can be noticed - the response is 200 by design, so without
        // this the money is taken in silence.
        console.error(
          "Stripe payment cannot be granted",
          JSON.stringify({
            reason: !paid
              ? "not yet paid"
              : "missing payment id, user or price",
            paymentIntent: paymentIntentId ?? null,
            user: userId ?? null,
            price: priceId ?? null,
            paymentStatus: object.payment_status ?? null,
          }),
        );
      } else {
        await grantPurchase(paymentIntentId, userId, priceId);
      }
    }
    // A refund takes the term back. With a fixed term there is nothing to
    // cancel, so without this a refunded parent keeps the access they were
    // refunded for - and unlike everything else here, nothing else would notice.
    //
    // Only a whole refund revokes: the event also fires on a partial one.
    if (event.type === "charge.refunded") {
      const intent = object.payment_intent;
      const paymentIntentId =
        typeof intent === "string" ? intent : (intent?.id ?? null);
      const amount = typeof object.amount === "number" ? object.amount : null;
      const refunded =
        typeof object.amount_refunded === "number"
          ? object.amount_refunded
          : null;
      const whole = amount !== null && refunded !== null && refunded >= amount;
      if (paymentIntentId && whole) {
        await revokePurchase(paymentIntentId);
      } else {
        // Whole refunds only. `charge.refunded` fires on a partial one too, and a
        // £1 goodwill adjustment against a year would otherwise revoke all of it
        // - not what the person issuing it meant, and not something a parent can
        // argue with. Logged, so a partial stays visible if it ever needs dealing
        // with by hand.
        console.error(
          "Partial refund ignored: access was not revoked",
          JSON.stringify({
            paymentIntent: paymentIntentId ?? null,
            amount,
            amountRefunded: refunded,
          }),
        );
      }
    }
    return json({ received: true });
  });
}

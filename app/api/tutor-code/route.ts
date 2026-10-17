import { requireUser, rateLimit } from "@/lib/server/auth";
import {
  availableTiers,
  billingReady,
  priceFor,
  stripe,
  usualPriceLabel,
} from "@/lib/server/billing";
import {
  discountedAmount,
  quoteTutorCode,
  TUTOR_TIER,
} from "@/lib/server/tutor-codes";
import { body, boundary, HttpError, json, sameOrigin } from "@/lib/server/http";

/**
 * What a tutor code is worth, before anyone pays.
 *
 * Display only: the quote names the percent and both figures so the button
 * can show them, but Stripe does the final computation at payment. A code the
 * parent just typed is validated the same way checkout validates it, so the
 * screen cannot promise a discount the payment then refuses - except when the
 * code is exhausted in between, which Stripe itself reports at payment.
 */
export async function POST(request: Request) {
  return boundary(async () => {
    sameOrigin(request);
    const user = await requireUser(request);
    // Counted per account and per address, like the coupon redemption:
    // a script working through codes it has been sent is bounded either way.
    await rateLimit(`tutor-code:${user.id}`, 20);
    await rateLimit(
      `tutor-code-ip:${request.headers.get("cf-connecting-ip") || "local"}`,
      30,
    );
    if (!billingReady())
      throw new HttpError(503, "Membership payments are not available yet.");
    const input = await body(request);
    const code = typeof input.code === "string" ? input.code : "";
    const tier = availableTiers().find((t) => t.id === TUTOR_TIER);
    if (!tier) throw new HttpError(503, "The 1-year option is not available.");
    const quoted = await quoteTutorCode(code, tier.id);
    const price = await stripe<{ unit_amount: number | null; currency: string }>(
      `prices/${encodeURIComponent(priceFor(tier.id))}`,
    );
    if (price.unit_amount === null)
      throw new HttpError(503, "The 1-year price could not be read.");
    const amount = price.unit_amount;
    const discounted = discountedAmount(amount, quoted.percentOff);
    return json({
      ok: true,
      label: quoted.label,
      tutorName: quoted.tutorName,
      percentOff: quoted.percentOff,
      tier: tier.id,
      currency: price.currency || "gbp",
      amount,
      discounted,
      usual: usualPriceLabel(amount, price.currency || "gbp"),
    });
  });
}

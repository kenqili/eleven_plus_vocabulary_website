/**
 * The administrator's own surface: issue coupons, tutor codes and our own
 * vouchers, and see what has been issued.
 *
 * Redemption counts are counts, not money: like the coupon batches they say how
 * many codes went out and how many came back, never what was paid. The money
 * stays in Stripe's dashboard, per the note below.
 *
 * Every route here is behind `requireAdmin`, which is the only check that exists.
 * There is no second gate in the client and no page-level guard - the client is
 * not a security boundary, and a guard there that reads as one is worse than
 * none. A parent who is not the administrator gets a 404 and an empty page, and
 * the codes are never in their browser.
 *
 * Deliberately not here: anything that reports money. Payment totals come from
 * `purchases`, which records what Stripe's webhook told us - not what Stripe
 * collected, and never a refund or a dispute. A number on this page would be read
 * as a takings figure, and it would be wrong in exactly the cases somebody would
 * most want it right. Stripe's own dashboard is the authority; this page issues
 * access and counts the access it has issued.
 */
import { rateLimit } from "@/lib/server/auth";
import { requireAdmin } from "@/lib/server/admin";
import { couponStats, issueCoupons } from "@/lib/server/coupon";
import {
  issueHouseVoucher,
  issueTutorCode,
  suspendDiscountCode,
  discountCodeStats,
} from "@/lib/server/discount-codes";
import { body, boundary, HttpError, json, sameOrigin } from "@/lib/server/http";

export async function GET(request: Request) {
  return boundary(async () => {
    await requireAdmin(request);
    const [coupons, discountCodes] = await Promise.all([
      couponStats(),
      discountCodeStats(),
    ]);
    return json({ ...coupons, discountCodes });
  });
}

export async function POST(request: Request) {
  return boundary(async () => {
    sameOrigin(request);
    const admin = await requireAdmin(request);
    // Per administrator rather than per address or per IP: an address can be
    // shared, an IP is not theirs, and the thing being protected is the issuing
    // of access rather than a login. Ten batches is a hundred and twenty unused
    // codes, which is more than a school needs in a fortnight.
    await rateLimit(`coupon-issue:${admin.id}`, 10);
    const input = await body(request);
    // Dispatched, with the coupon batch as the default: the admin page has
    // posted `{days}` here since before actions existed, and renaming that
    // call is churn with no benefit. New callers name what they want.
    const action =
      typeof input.action === "string" ? input.action : "issue-coupons";
    if (action === "issue-coupons") {
      const days = Number(input.days);
      const count = input.count === undefined ? undefined : Number(input.count);
      if (!Number.isFinite(days)) throw new HttpError(400, "Choose a length.");
      const batch = await issueCoupons(days, count);
      return json({ ok: true, ...batch });
    }
    if (action === "issue-tutor-code") {
      const issued = await issueTutorCode({
        tutorName: typeof input.tutorName === "string" ? input.tutorName : "",
        contact: typeof input.contact === "string" ? input.contact : "",
        maxRedemptions:
          input.maxRedemptions === undefined
            ? undefined
            : Number(input.maxRedemptions),
        monthsValid:
          input.monthsValid === undefined ? undefined : Number(input.monthsValid),
        label: typeof input.label === "string" ? input.label : "",
      });
      return json({ ok: true, ...issued });
    }
    if (action === "issue-house-voucher") {
      const issued = await issueHouseVoucher({
        label: typeof input.label === "string" ? input.label : "",
        percentOff: Number(input.percentOff),
      });
      return json({ ok: true, ...issued });
    }
    if (action === "suspend-discount-code") {
      if (typeof input.codeId !== "string" || !input.codeId)
        throw new HttpError(400, "Choose which code to suspend.");
      await suspendDiscountCode(input.codeId);
      return json({ ok: true });
    }
    throw new HttpError(404, "Unknown action.");
  });
}
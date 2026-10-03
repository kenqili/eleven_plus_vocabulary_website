import { requireUser, rateLimit } from "@/lib/server/auth";
import { membership } from "@/lib/server/billing";
import { redeemCoupon } from "@/lib/server/coupon";
import { body, boundary, HttpError, json, sameOrigin } from "@/lib/server/http";

export async function GET(request: Request) {
  // Whether there is anything to redeem against. A parent who cannot see the
  // field cannot wonder about it, and this is the same count the admin page shows
  // so the two cannot disagree.
  return boundary(async () => {
    const user = await requireUser(request);
    return json({ ...(await membership(user)) });
  });
}

export async function POST(request: Request) {
  return boundary(async () => {
    sameOrigin(request);
    const user = await requireUser(request);
    const input = await body(request);
    const code = typeof input.code === "string" ? input.code : "";
    // Counted per account before the lookup. A code is 100 bits, so guessing one
    // is not the attack this stops - but a script that has found the redemption
    // endpoint will try every code it has ever been sent, and this bounds that.
    await rateLimit(`coupon:${user.id}`, 10);
    await rateLimit(
      `coupon-ip:${request.headers.get("cf-connecting-ip") || "local"}`,
      30,
    );
    if (!code.trim()) throw new HttpError(400, "Enter your code.");
    const redeemed = await redeemCoupon(user.id, code);
    // Re-read rather than returning the number computed above, so the parent is
    // shown what is actually stored. A coupon is the one place a grant can be
    // wrong in a way the parent would not notice until access ran out.
    const periodEnd = (await membership(user)).periodEnd;
    return json({
      ok: true,
      days: redeemed.days,
      periodEnd,
      // The new end date, because that is the number the parent came for. They
      // did not come to be told that a code was accepted - they came because a
      // child was about to lose access, and "extended by 90 days" leaves them
      // doing the arithmetic to find out whether the code landed in time.
      //
      // "N days" rather than "3 months", deliberately. Everywhere else on this
      // screen a length is named ("1 month", "3 months", "1 year") from the same
      // 30/90/365, but the parent is owed something more precise than the
      // shortest form of it here, because this sentence is the only place the
      // exact boundary appears.
      //
      // No locale named. Every other date on this page is written by the browser,
      // in the reader's own language and format, and a server that guesses one
      // produces a second spelling of the same date on one screen.
      message: `Access extended by ${redeemed.days} days — your access now runs until ${new Date(
        periodEnd ?? redeemed.expiresAt,
      ).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })}.`,
    });
  });
}

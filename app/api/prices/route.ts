import { json } from "@/lib/server/http";
import { publicPrices } from "@/lib/server/billing";

/**
 * What a membership costs, for someone who has not signed in.
 *
 * Public, unlike `/api/billing`, which is `requireUser` — and it has to be, because
 * the front page has to show a price to a parent deciding whether to read further,
 * and that parent is by definition not signed in yet. Nothing here is personal: no
 * account, no session, no customer. It is the catalogue.
 *
 * The amounts come from Stripe, so the price a parent reads is the price their card
 * will be charged. A number written into the page's copy would be a second source of
 * truth that could quietly disagree with the checkout.
 *
 * No rate limit and no cache header. It costs one Stripe read per tier, the response
 * is identical for everyone, and it must never be the reason a sales page fails to
 * load — so the one thing it does not do is refuse.
 */
export async function GET() {
  return json(await publicPrices());
}

import { requireUser, rateLimit } from "@/lib/server/auth";
import { database, setting } from "@/lib/server/db";
import {
  billingReady,
  membership,
  stripe,
  syncSubscription,
  checkoutSession,
} from "@/lib/server/billing";
import { boundary, HttpError, json, sameOrigin } from "@/lib/server/http";
export async function GET(request: Request) {
  return boundary(async () => {
    const user = await requireUser(request);
    const ready = billingReady();
    let price: {
      unit_amount: number;
      currency: string;
      recurring: { interval: string; interval_count: number };
    } | null = null;
    if (ready)
      price = await stripe(
        `prices/${encodeURIComponent(setting("STRIPE_PRICE_ID"))}`,
      );
    return json({
      ...(await membership(user)),
      ready,
      price,
      canManage: Boolean(user.customer_id),
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
    await rateLimit(`billing:${user.id}`, 20);
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
    // Check Stripe as well as local state before starting another subscription.
    const list = await stripe<{ data: { id: string; status: string }[] }>(
      `subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=100`,
    );
    const existing = list.data.find(
      (s) => !["canceled", "incomplete_expired"].includes(s.status),
    );
    if (existing) {
      await syncSubscription(existing.id);
      throw new HttpError(
        409,
        "A subscription already exists. Use Manage billing to update it.",
      );
    }
    const price = await stripe<{
      active: boolean;
      recurring?: { interval: string; interval_count: number };
    }>(`prices/${encodeURIComponent(setting("STRIPE_PRICE_ID"))}`);
    if (
      !price.active ||
      price.recurring?.interval !== "month" ||
      price.recurring.interval_count !== 1
    )
      throw new HttpError(
        503,
        "The monthly subscription is not configured correctly.",
      );
    const session = await checkoutSession(user.id, customerId, origin);
    return json({ url: session.url });
  });
}

import { database, setting } from "./db";
import { HttpError } from "./http";
import type { User } from "./auth";
export const billingReady = () =>
  Boolean(
    setting("STRIPE_SECRET_KEY") &&
      setting("STRIPE_PRICE_ID") &&
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
export function configuredFreeWordLimit() {
  const configured = setting("FREE_WORD_LIMIT");
  if (!configured) return 20;
  if (!/^(?:0|[1-9]|[1-9]\d|[1-6]\d{2}|7[0-2]\d|730)$/.test(configured))
    throw new Error("FREE_WORD_LIMIT must be a whole number from 0 to 730.");
  const count = Number(configured);
  if (count > 730)
    throw new Error("FREE_WORD_LIMIT must be a whole number from 0 to 730.");
  return count;
}
export async function membership(user: User) {
  const db = database(),
    now = Date.now(),
    trialDays = configuredFreeTrialDays();
  const [active, account] = await Promise.all([
    db
      .prepare(
        "SELECT id,status,period_end FROM subscriptions WHERE user_id = ? AND status IN ('active','trialing') AND period_end > ? AND price_id = ? ORDER BY period_end DESC LIMIT 1",
      )
      .bind(user.id, Math.floor(now / 1000), setting("STRIPE_PRICE_ID"))
      .first<{ id: string; status: string; period_end: number }>(),
    db
      .prepare("SELECT created_at FROM users WHERE id=?")
      .bind(user.id)
      .first<{ created_at: number }>(),
  ]);
  const trialEndsAt = (account?.created_at || 0) + trialDays * 86_400_000;
  const trial = !active && trialDays > 0 && now < trialEndsAt;
  return {
    active: Boolean(active),
    access: Boolean(active) || trial,
    trial,
    trialDays,
    trialDaysRemaining: trial ? Math.ceil((trialEndsAt - now) / 86_400_000) : 0,
    trialEndsAt: account && trialDays > 0 ? trialEndsAt : null,
    trialExpired: !active && !trial,
    status: active?.status || "inactive",
    periodEnd: active?.period_end || null,
  };
}
export type StripeSubscription = {
  id: string;
  customer: string;
  status: string;
  current_period_end?: number;
  items: { data: { price: { id: string }; current_period_end?: number }[] };
};
export async function syncSubscription(id: string) {
  // Retrieve current Stripe state so delayed webhook payloads cannot restore stale access.
  const checkedAt = Date.now();
  const subscription = await stripe<StripeSubscription>(
    `subscriptions/${encodeURIComponent(id)}`,
  );
  const user = await database()
    .prepare("SELECT id FROM users WHERE customer_id = ?")
    .bind(subscription.customer)
    .first<{ id: string }>();
  if (!user) return;
  const item = subscription.items.data.find(
    (x) => x.price.id === setting("STRIPE_PRICE_ID"),
  );
  await database()
    .prepare(
      "INSERT INTO subscriptions (id,user_id,status,period_end,price_id,checked_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,period_end=excluded.period_end,price_id=excluded.price_id,checked_at=excluded.checked_at WHERE excluded.checked_at >= subscriptions.checked_at",
    )
    .bind(
      subscription.id,
      user.id,
      item ? subscription.status : "inactive",
      item?.current_period_end || subscription.current_period_end || 0,
      item?.price.id || "",
      checkedAt,
    )
    .run();
}

export async function checkoutSession(
  userId: string,
  customerId: string,
  origin: string,
): Promise<{ url: string }> {
  const db = database();
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      "INSERT INTO checkout_requests (user_id,token,created_at) VALUES (?,?,?) ON CONFLICT(user_id) DO NOTHING",
    )
    .bind(userId, crypto.randomUUID(), now)
    .run();
  const row = await db
    .prepare(
      "SELECT token,created_at,session_id FROM checkout_requests WHERE user_id=?",
    )
    .bind(userId)
    .first<{ token: string; created_at: number; session_id: string | null }>();
  if (!row)
    throw new HttpError(503, "Unable to start checkout. Please try again.");
  if (row.session_id) {
    const existing = await stripe<{
      status: string;
      url: string;
      subscription?: string;
    }>(`checkout/sessions/${encodeURIComponent(row.session_id)}`);
    if (existing.status === "open") return existing;
    if (existing.status === "complete" && existing.subscription) {
      const subscription = await stripe<StripeSubscription>(
        `subscriptions/${encodeURIComponent(existing.subscription)}`,
      );
      if (!["canceled", "incomplete_expired"].includes(subscription.status)) {
        await syncSubscription(subscription.id);
        throw new HttpError(
          409,
          "Your checkout is complete. Refresh your membership in a moment.",
        );
      }
    }
    await db
      .prepare("DELETE FROM checkout_requests WHERE user_id=? AND token=?")
      .bind(userId, row.token)
      .run();
    return checkoutSession(userId, customerId, origin);
  }
  if (now > row.created_at + 1800) {
    // A failed creation may still have reached Stripe. Wait for its expiry before replacing it.
    if (now < row.created_at + 3600)
      throw new HttpError(
        409,
        "An earlier checkout is being resolved. Please try again in an hour.",
      );
    await db
      .prepare("DELETE FROM checkout_requests WHERE user_id=? AND token=?")
      .bind(userId, row.token)
      .run();
    return checkoutSession(userId, customerId, origin);
  }
  const session = await stripe<{ id: string; url: string }>(
    "checkout/sessions",
    {
      mode: "subscription",
      customer: customerId,
      "line_items[0][price]": setting("STRIPE_PRICE_ID"),
      "line_items[0][quantity]": "1",
      success_url: `${origin}/account?checkout=success`,
      cancel_url: `${origin}/account?checkout=cancelled`,
      client_reference_id: userId,
      "subscription_data[metadata][user_id]": userId,
      expires_at: String(row.created_at + 3600),
    },
    `checkout-${row.token}`,
  );
  await db
    .prepare(
      "UPDATE checkout_requests SET session_id=? WHERE user_id=? AND token=?",
    )
    .bind(session.id, userId, row.token)
    .run();
  return session;
}

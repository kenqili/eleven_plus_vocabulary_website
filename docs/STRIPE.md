# Stripe setup

Just the steps. Everything here is checked against the code in this repository
on 28 September 2026, and each step says why it matters where getting it wrong
is silent.

**You do not have to do this to launch.** `billingReady()` in
`lib/server/billing.ts` returns false unless all four of `STRIPE_SECRET_KEY`,
`STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` and `APP_ORIGIN` are set, and
while it is false the account page says payments are not available yet rather
than erroring. Deploy first, take money later.

---

## 1. Create the product and price

1. **Products → Add product**
2. Name it. Whatever you want; the app never reads it.
3. **Add a price** with these exact settings:

   | Field | Value | Why |
   |---|---|---|
   | Recurring | **Yes** | Checkout is created with `mode: "subscription"` |
   | Interval | **Month** | The app refuses anything else |
   | Interval count | **1** | Ditto |

   **This is the one that fails silently.** `app/api/billing/[action]/route.ts`
   fetches the price at checkout time and throws `503 "The monthly subscription
   is not configured correctly."` if the interval is not `month` with a count of
   `1`. A yearly price, or a one-off payment, passes every setup screen and only
   fails when a parent tries to pay. The account page renders the price without
   checking, so you will not see the problem until someone tries to buy.
4. Copy the price id, `price_...`.

## 2. Get the three secrets

1. **Developers → API keys → Secret keys** → reveal → copy `sk_...`
2. The price id from step 1
3. The webhook secret, from step 4 — it does not exist until the endpoint is
   created

## 3. Set them on the Worker

```sh
npx wrangler@latest secret put APP_ORIGIN
npx wrangler@latest secret put STRIPE_SECRET_KEY
npx wrangler@latest secret put STRIPE_PRICE_ID
npx wrangler@latest secret put STRIPE_WEBHOOK_SECRET
```

`APP_ORIGIN` is your public origin and nothing else, for example
`https://minewords.app`. **No trailing slash, no path.** The return URLs are
built from it, so a wrong value sends a paying parent to a page that does not
exist after they have entered their card.

`secrets put` is interactive. Or set all four at once, non-interactively:

```sh
for kv in APP_ORIGIN STRIPE_SECRET_KEY STRIPE_PRICE_ID STRIPE_WEBHOOK_SECRET; do
  printf '%s' "${!kv}" | npx wrangler@latest secret put "$kv"
done
```

## 4. Create the webhook

**Developers → Webhooks → Add endpoint**

- **URL:** `https://<your-origin>/api/stripe/webhook`
- **Events**, exactly these four:

  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

- Copy the **signing secret**, `whsec_...`, into `STRIPE_WEBHOOK_SECRET`.

The app ignores every other event, so subscribing to more only adds noise.

**The signing secret is per-endpoint.** Regenerating it invalidates the old
one. If you redeploy to a different hostname, the endpoint URL changes, the old
endpoint keeps its old secret, and payments stop being recorded.

## 5. Turn on the customer portal

**Settings → Billing → Customer portal → Enable**

Without it, the account page's "Manage billing" button fails. Nothing else
depends on it, so the app runs without it — it just cannot cancel a
subscription.

---

## What the app does with each piece

Worth knowing, because it explains why the setup above is the whole of it:

- **Checkout** is created server-side with `mode: "subscription"`, a customer
  created on first use (idempotency key `customer-${userId}`, so a retry cannot
  create two), and `client_reference_id` set to the user id.
- **The webhook does not fire the grant.** It calls `syncSubscription`, which
  re-fetches the subscription from Stripe and writes the current state. So a
  delayed or replayed webhook cannot restore access that has since been
  cancelled, and the order events arrive in does not matter. You do not need to
  worry about delivery order.
- **A second subscription is refused.** Before starting a checkout the app asks
  Stripe for any existing non-cancelled subscription and returns `409` if one
  exists. A parent cannot be charged twice.
- **The Stripe customer is linked to your user by `customer_id`** in your own
  database, not by Stripe metadata. The metadata is set but not relied on.

---

## Verify it

After deploying, with a real price and before announcing anything:

```sh
# 1. Is it configured? Unconfigured returns ready:false, which is a clean
#    "not available yet" rather than an error.
curl -s "https://<origin>/api/auth" | python3 -m json.tool

# 2. Sign in, then start a checkout and confirm the URL is a real Stripe page.
#    Do this in a browser; it needs the session cookie.
#    POST https://<origin>/api/billing/checkout  with Origin: https://<origin>

# 3. Complete a real payment. Watch the webhook log at the same time.
#    Developers → Webhooks → your endpoint → Events
```

**Step 3 is the one that matters, and it is the one to do with a real card.**
It exercises checkout, the signature check, `syncSubscription`, and the
membership query, in that order. A webhook that is subscribed to the wrong
events, or signed with an old secret, produces a completed payment that grants
nothing, and nothing in the app will tell you that — the parent is charged and
stays on the free tier.

Then refund it from the Stripe dashboard.

**The log to read:** `Developers → Webhooks → [endpoint] → Events`. Every
delivery should show `200`. A `400` means the signature check failed, which in
practice means the signing secret is stale.

---

## Two things that are deliberate and will look wrong

**The webhook route does not check the `Origin` header**, unlike every other
route in this app. Stripe is not a browser and sends no `Origin`, so demanding
one would break it. What it does instead is verify an HMAC signature over the
raw request body with a five-minute freshness window, which for that route is
the stronger of the two defences. `tests/security.test.mjs` asserts both facts,
because either one on its own would look like a gap.

**There is no route that grants access based on the webhook payload's
contents.** It is treated as a signal to go and re-read the truth. If the
webhook is delivered three times, the answer is the same three times.

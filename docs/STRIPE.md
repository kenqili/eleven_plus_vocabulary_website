# Stripe setup

Just the steps. Everything here is checked against the code in this repository
on 28 September 2026, and each step says why it matters where getting it wrong
is silent.

**You do not have to do this to launch.** `billingReady()` in
`lib/server/billing.ts` returns false unless `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET` and `APP_ORIGIN` are all set **and at least one
`STRIPE_PRICE_*` is configured**, and while it is false the account page says
payments are not available yet rather than erroring. Deploy first, take money
later.

---

## 1. Create the product and price

1. **Products → Add product**
2. Name it. Whatever you want; the app never reads it.
3. **Add a price** with these exact settings:

   | Field      | Value        | Why                                        |
   | ---------- | ------------ | ------------------------------------------ |
   | Recurring  | **No**       | Checkout is created with `mode: "payment"` |
   | Price type | **One-time** | Ditto                                      |

   **This is the one that fails silently.** `app/api/billing/[action]/route.ts`
   fetches the price at checkout time and refuses it with `503 "The 3 months
option is set up as a recurring price, which this site does not use."` if
   `recurring` is set. A recurring price passes every setup screen and only fails
   when a parent tries to pay — and it fails in the worst direction, because
   Stripe would go on billing that parent every month for an app that grants a
   fixed term once and never listens for a renewal.

   Create **one price per length**, all one-time. The length each price buys is
   not stored in Stripe — a one-time price carries no interval, so there is
   nothing in the price object saying how long anything lasts. It is the
   `TIERS` map in `lib/server/billing.ts` that decides, which is why a price
   filed under the wrong setting grants the wrong number of days and Stripe
   cannot catch it.

4. Copy each price id, `price_...`.

## 2. Get the three secrets

1. **Developers → API keys → Secret keys** → reveal → copy `sk_...`
2. The price id from step 1
3. The webhook secret, from step 4 — it does not exist until the endpoint is
   created

## 3. Set them on the Worker

```sh
npx wrangler@latest secret put APP_ORIGIN
npx wrangler@latest secret put STRIPE_SECRET_KEY
npx wrangler@latest secret put STRIPE_PRICE_MONTHLY
npx wrangler@latest secret put STRIPE_PRICE_QUARTERLY
npx wrangler@latest secret put STRIPE_PRICE_YEARLY
npx wrangler@latest secret put STRIPE_WEBHOOK_SECRET
```

`APP_ORIGIN` is your public origin and nothing else, for example
`https://minewords.app`. **No trailing slash, no path.** The return URLs are
built from it, so a wrong value sends a paying parent to a page that does not
exist after they have entered their card.

`secrets put` is interactive. Or set them all at once, non-interactively:

```sh
for kv in APP_ORIGIN STRIPE_SECRET_KEY STRIPE_PRICE_MONTHLY \
  STRIPE_PRICE_QUARTERLY STRIPE_PRICE_YEARLY STRIPE_WEBHOOK_SECRET; do
  printf '%s' "${!kv}" | npx wrangler@latest secret put "$kv"
done
```

The three prices are the lengths sold — 1 month, 3 months and 1 year — and each
has to be a **one-time** price. At least one is required; any left unset is
simply not offered, so a partial setup sells less rather than failing. See
`docs/DEPLOY.md` for the table, which is the one to work from.

## 4. Create the webhook

**Developers → Webhooks → Add endpoint**

- **URL:** `https://<your-origin>/api/stripe/webhook`
- **Events**, exactly these two:
  - `checkout.session.completed` — grants the term
  - `charge.refunded` — takes it back

- Copy the **signing secret**, `whsec_...`, into `STRIPE_WEBHOOK_SECRET`.

There are no `customer.subscription.*` events, because nothing here is a
subscription. The app ignores every other event, so subscribing to more only
adds noise.

**The signing secret is per-endpoint.** Regenerating it invalidates the old
one. If you redeploy to a different hostname, the endpoint URL changes, the old
endpoint keeps its old secret, and payments stop being recorded.

## 5. Turn on the customer portal

**Settings → Billing → Customer portal → Enable**

Without it, the account page's "Manage billing" button fails. Nothing else
depends on it, so the app runs without it — the button is only offered to a
parent who has a Stripe customer, and the portal is where they get receipts.

---

## What the app does with each piece

Worth knowing, because it explains why the setup above is the whole of it:

- **Checkout** is created server-side with `mode: "payment"`, a customer
  created on first use (idempotency key `customer-${userId}`, so a retry cannot
  create two), and `client_reference_id` set to the user id.
- **A term is bought once and ends.** There is nothing to renew and nothing to
  cancel, so there are no subscription events to watch and no renewal to miss. A
  family wanting longer buys again, and the second purchase adds to the first.
- **Repeat purchases are allowed and are meant to be.** An 11+ is a dated exam
  and a family preparing for one needs access until then, so a second term in
  month two has to be possible. The account page offers the lengths to somebody
  who already has access, not only to somebody whose access has run out.
- **The grant is idempotent on the payment intent**, keyed on a UNIQUE
  `purchases.confirmation`. Stripe delivers `checkout.session.completed` at
  least once and sometimes twice; the second delivery changes nothing. The grant
  and its audit row are written in one transaction, so a payment cannot be
  recorded without the access — or the reverse.
- **The price reaches the webhook in metadata.** Stripe does not expand
  `line_items` in an event payload, so a webhook reading the price from there
  finds nothing, grants nothing, and answers `200`. That is not hypothetical:
  it is how a real annual purchase was taken and dropped. `checkoutSession`
  writes `metadata[price_id]` on both the session and the payment intent.
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
It exercises checkout, the signature check, the grant, and the membership query,
in that order. A webhook that is subscribed to the wrong events, or signed with
an old secret, produces a completed payment that grants nothing, and nothing in
the app will tell you that — the parent is charged and stays on the free tier.

Then buy a **second** term from the account page and check that the expiry moves
further out rather than being replaced. That is the flow the 409 bug broke: a
family with months left could not buy more at all.

Then refund the first payment from the Stripe dashboard and check that the term
comes back off and is marked refunded, while the second purchase is untouched.

**The log to read:** `Developers → Webhooks → [endpoint] → Events`. Every
delivery should show `200`. A `400` means the signature check failed, which in
practice means the signing secret is stale.

### If a parent was charged twice

The app looks for this itself and will not act on it. When one account pays twice
for the **same length** within an hour, two things happen: the parent is emailed,
and a line is logged.

```
Possible double charge: one account paid twice for the same length
{"user":"…","email":"…","price":"price_…",
 "duplicatePaymentIntent":"pi_…","originalPaymentIntent":"pi_…","minutesApart":3}
```

To refund, in this order:

1. **Stripe → Payments**, find `duplicatePaymentIntent` and refund it in full. The
   log names which of the two to refund: the **newer** one, because the earlier is
   the purchase the parent believes they made. Getting this backwards refunds the
   payment they meant to keep and leaves the duplicate in place.
2. **Nothing in the app.** The access is already correct and needs no change — the
   parent paid twice and received twice, so removing the second term would leave
   them short. `revokePurchase` runs by itself when Stripe sends `charge.refunded`,
   so the refund you issue in the dashboard takes the extra term back on its own.
   That is the correct outcome here: the refund is what should shorten the access.

**It reports, it does not refund, on purpose.** A refund moves money, and a
duplicate is inferred from timing alone — a family who deliberately buys two terms
to have a spare would be refunded for one without being asked. So it says what it
noticed and offers the refund, and a person decides. The alternative, doing
nothing, is what this replaces: a silent double charge is found by the parent in
their bank statement, and the reasonable conclusion is that the site took the money
and is not giving it back.

**What will not trigger it,** all of which are tested: buying two _different_
lengths (deliberate), buying the same length more than an hour apart (renewing
early, which the account page invites), a refunded-then-rebought pair (the money
came back), and the same payment delivered twice (Stripe redelivers for days, and
the check is on payments rather than on rows).

Two requests cannot open two payment pages at once — that is prevented rather
than detected, by holding the account's `checkout_requests` row while a request is
in it. See the commit on that. What this catches is the case a lock cannot help
with: a parent completes a payment, does not see the confirmation, and starts
again.

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

**The date a purchase bought lives in this repository, not in Stripe.** `TIERS` in
`lib/server/billing.ts` is the only record of what a term is worth, because a
one-time price carries no interval. Renaming a price setting does not change a
term; editing `TIERS` does. Do not let the two drift — a price filed under the
wrong setting grants the wrong number of days, and nothing at Stripe will notice.

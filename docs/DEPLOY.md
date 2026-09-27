# Deploying MineWords to production

Everything here is specific to this repository. Nothing in it is generic advice,
and every command was checked against the code as it stands on 27 September 2026.

**Read the two warnings at the bottom before your first deploy.** One of them is
the whole reason this document is careful in a particular place.

---

## What you are deploying to, and why

Cloudflare Workers, with the SQLite database in Cloudflare D1.

That is not a preference; it is what the code is built for. `db/index.ts` imports
`env` from `cloudflare:workers` and calls `drizzle(env.DB)` from
**`drizzle-orm/d1`**. Moving to a Node host is a medium-sized job, not a
config change, and it would buy you about €14 a month. See
`docs/HOSTING.md` for the comparison that was done and the numbers in it.

**Cost: $5/month.** The Workers paid plan includes 10 million requests, 30
million CPU-milliseconds, unlimited static asset requests, and — the part that
matters here — **no charge for bandwidth or storage**. The audio library is
167 MB across 2,369 files, and on this plan that is free and stays free however
much a child listens.

---

## Before the first deploy

### 1. A Cloudflare account and the paid plan

Workers Free has a 10 ms CPU limit per invocation, and the documentation is
explicit that server-rendered, authenticated pages typically run 10–20 ms. This
app is squarely in that band. Do not launch on Free.

D1 on Free is the harder stop: 5 million rows read and 100,000 written **per
day**, and 500 MB per database. The documentation says that when you hit the
daily limit *"you will not be able to run queries against D1"*. `learning_events`
and `progress` both grow by rows, per child, per answer. Launch on paid.

### 2. The database, in the EU

This is the one step with no undo, so do it once and correctly.

```sh
npx wrangler@latest d1 create minewords --jurisdiction=eu
```

`--jurisdiction=eu` is a hard constraint: Cloudflare documents that the database
"only runs and stores data within" the region, and that it is set at creation
and immutable afterwards. It is the strongest data-residency commitment
available at this price for a database holding children's accounts.

**It only covers the database, not the compute.** Workers run on Cloudflare's
global network; `placement.mode: "smart"` and `placement.region` are latency
settings, not residency controls. The product that pins execution is Regional
Services, which is Enterprise-only. Be honest about this in the privacy policy:
*the database is EU-resident by documented constraint; request processing is
not.* Do not imply the whole stack is in the EU.

Write down the `database_id` it prints. You need it in the next step.

### 3. Point the build at that database

`npm run build` generates `dist/server/wrangler.json` itself, with a placeholder
`database_id` of `00000000-0000-4000-8000-000000000000`. **The generated file is
not committed and is overwritten on every build**, so do not edit it by hand and
do not try to keep it in version control.

Patch it in the deploy step instead:

```sh
npm run build
node -e '
  const fs = require("node:fs");
  const path = "dist/server/wrangler.json";
  const config = JSON.parse(fs.readFileSync(path, "utf8"));
  const binding = config.d1_databases.find((d) => d.binding === "DB");
  if (!binding) throw new Error("no DB binding in the generated config");
  binding.database_name = process.env.D1_NAME;
  binding.database_id = process.env.D1_ID;
  fs.writeFileSync(path, JSON.stringify(config));
'
```

### 4. Run the migrations

The schema lives in `drizzle/`, applied in filename order, and the last one
(`0010_coach_last_seen.sql`) adds a column this app's feedback now depends on.
A deploy without it fails on the first answer, not at boot.

```sh
npx wrangler@latest d1 migrations apply minewords --remote
```

Read the list it prints before confirming. It should be 10 migrations.

### 5. Secrets

Secrets are read by `setting()`, which looks first at the Workers environment
and then at `process.env`. They are never committed: `.env*` is in `.gitignore`
and only `.env.example` is tracked.

```sh
npx wrangler@latest secret put APP_ORIGIN
npx wrangler@latest secret put STRIPE_SECRET_KEY
npx wrangler@latest secret put STRIPE_PRICE_ID
npx wrangler@latest secret put STRIPE_WEBHOOK_SECRET
```

`APP_ORIGIN` is the public origin including scheme, for example
`https://minewords.app`, and nothing else. It is used to build the Stripe return
URLs, so a wrong value sends parents to a page that does not exist.

**On `FREE_WORD_LIMIT` and `FREE_TRIAL_DAYS`:** these are optional. The defaults
are 224 words and 7 days, and the free limit is derived from the word count, so
it cannot fall behind the collection. Set them only to override.

`AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` are for regenerating pronunciation
audio. They are not needed to run the site and should not be in the production
Worker.

### 6. Stripe

In the Stripe dashboard:

- A **recurring monthly** price. The app checks that `recurring.interval` is
  `month` and `interval_count` is 1, and refuses to start a checkout otherwise,
  so a yearly price fails at the last step rather than charging wrongly.
- The price id into `STRIPE_PRICE_ID`.
- A webhook endpoint at `https://<your-origin>/api/stripe/webhook`, subscribed
  to `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`, and `checkout.session.completed`.
- Its signing secret into `STRIPE_WEBHOOK_SECRET`.

The webhook route verifies the signature over the raw body with a five-minute
freshness window, and it is the one route that deliberately does **not** check
the `Origin` header, because Stripe is not a browser. Nothing else in the API is
exempt.

---

## Deploying

```sh
npm test                      # 140 tests, must be green
npm run typecheck
npm run lint
npm run build                 # produces dist/
# patch the D1 id as above
npx wrangler@latest deploy
```

### Every deploy, after the first

1. `npm test && npm run typecheck && npm run lint && npm run build`
2. Patch the D1 id (step 3 above). **The generated config reverts to the
   placeholder on every build**, so skipping this is the single most likely way
   to break a deploy.
3. `npx wrangler@latest deploy`
4. If a migration was added, apply it **before** the new code serves traffic.

---

## After every deploy, check these

The order matters. The first three are the ones that fail silently.

```sh
ORIGIN=https://your-origin

# 1. The policy is present and carries a nonce. A missing CSP means middleware
#    did not run, and you will not find out from this command alone - you find
#    out from a blank page.
curl -sI "$ORIGIN/" | grep -i "content-security-policy"

# 2. The other security headers.
curl -sI "$ORIGIN/" | grep -iE "strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy"

# 3. A nonce is in it, and a *different* one on the next request. A fixed nonce
#    is published in the response and is no better than allowing inline script.
curl -sI "$ORIGIN/" | grep -io "nonce-[A-Za-z0-9+/=]*"
curl -sI "$ORIGIN/" | grep -io "nonce-[A-Za-z0-9+/=]*"

# 4. The session cookie is __Host- prefixed and Secure.
curl -sI -X POST "$ORIGIN/api/auth/login" -H "Origin: $ORIGIN" \
  -H "Content-Type: application/json" \
  -d '{"email":"a@b.co","password":"testing123"}' | grep -i set-cookie

# 5. The page actually renders. This is the one that catches a policy that is
#    too strict: the HTML arrives, the hydration script is blocked, and the page
#    is blank or inert. Open it and click an answer.
```

Then, by hand, in a browser:

- The practice page loads, an answer is given, and the feedback appears with its
  new line and animation. **A blocked script shows as a page that looks fine and
  does nothing.**
- A saved dark theme still applies before the first paint, with no white flash.
- Sign in, sign out, change password, sign out everywhere.
- The print sheet and the A4 export.
- The Stripe checkout, on a real price, ending in a cancelled payment. **Do not
  complete a real payment until you have checked the webhook log.**

---

## Rolling back

```sh
npx wrangler@latest deployments list
npx wrangler@latest rollback <deployment-id>
```

Seconds, and the previous build is still there. **Migrations do not roll back.**
A migration that removed or renamed a column is not undone by a rollback, and the
old code will fail against the new schema. For that reason, additive migrations
only: add columns, never drop or rename one in the same deploy that stops using
it.

---

## Cost, and when it changes

| | |
|---|---|
| Workers paid | $5/month, flat |
| Requests | 10M/month included. A month of 50,000 page views is under 1%. |
| CPU | 30M ms/month included |
| Bandwidth and asset storage | **Not charged** |
| D1 | 25B rows read, 50M written, 5 GB storage included |

The two things that could change this:

- **Requests.** Well inside the allowance. If RSC server rendering is doing one
  invocation per navigation, that is still a rounding error at 50,000 views.
- **D1 storage.** 5 GB is plenty. `learning_events` is the table that grows; at
  roughly 200 bytes a row that is around 25 million answers.

If you want to be certain about the CPU figure, read `cpu_time` in the
Cloudflare dashboard after a week of real use. If it sits comfortably under 10 ms
per invocation, the free plan becomes viable, and that is a measurement worth
making rather than a guess.

---

## Two warnings

**One. Nothing in this document has been run against a live deployment.**

The dev server cannot start on this machine: the Cloudflare Workers runtime
requires macOS 13.5 or newer and this is macOS 12.6. Every step above is derived
from reading the code, the generated `wrangler.json`, and the framework's own
source — which is where the middleware and nonce behaviour came from — and not
from watching it happen.

So the first deploy is a genuine first deploy. Deploy to a preview environment
or a `staging.` subdomain, walk the verification list, and only then point the
real domain at it.

**Two. The nonce policy is the part most likely to need adjusting.**

The framework writes its hydration data into inline `<script>` tags, so a policy
that forbids inline script outright breaks the site. The policy in
`middleware.ts` handles this the way it is meant to be handled: a fresh random
nonce per response, which the framework reads back out of the header and stamps
on the scripts it generates. That mechanism is the framework's own, not a
workaround.

It is still untested here. If the page renders but does not respond, that is a
policy that is too strict, and the fix is in one place: add the missing directive
to `policyFor()` in `middleware.ts`. Two things are known to need permissiveness
already and are allowed: inline styles, because React writes them, and the theme
script, by hash. A third may be needed and is not known; `tests/security.test.mjs`
asserts the policy cannot be loosened silently, so if you have to add something,
that test is where you record why.

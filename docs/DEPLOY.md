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
day**, and 5 GB of storage across the account. The documentation says that when
you hit the daily row limit _"you will not be able to run queries against D1"_.
`learning_events` and `progress` both grow by rows, per child, per answer, so
the write limit is the one that bites. Launch on paid.

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
_the database is EU-resident by documented constraint; request processing is
not._ Do not imply the whole stack is in the EU.

Write down the `database_id` it prints. You need it in the next step.

### 3. Point the build at that database

`npm run build` generates `dist/server/wrangler.json` itself, and the build reads
`D1_ID` and `D1_NAME` from the environment, so exporting them before the build is
all that is needed:

```sh
export D1_ID=<the database_id printed by d1 create>
export D1_NAME=minewords
npm run build
```

Check it landed before deploying, because a wrong id fails at the first query
rather than at boot:

```sh
node -e 'console.log(require("./dist/server/wrangler.json").d1_databases[0])'
# { binding: "DB", database_name: "minewords", database_id: "…" }
```

**The generated file is not committed and is overwritten on every build**, so do
not edit it by hand and do not try to keep it in version control. If the id above
still reads `00000000-0000-4000-8000-000000000000`, `D1_ID` was not exported in
the shell that ran the build.

With both variables unset the build emits that placeholder, which is correct for
the hosted control plane: it injects the real binding when it deploys, so the
placeholder is the template it expects. The variables are read for a build only,
never under `serve`, where the Cloudflare plugin talks to a local Miniflare store
and must not be pointed at the production database.

### 4. Run the migrations

The schema lives in `drizzle/`, applied in filename order, and the last one
(`0011_reconcile_mastered_totals.sql`) repairs the running mastered total for
accounts that predate the `mastered` column. The one before it
(`0010_coach_last_seen.sql`) adds a column this app's feedback now depends on.
A deploy without either fails on the first answer, not at boot.

**Do not use `wrangler d1 migrations apply`.** It cannot work here: wrangler
looks for a `migrations` folder next to the config, which is
`dist/server/migrations`, and that directory does not exist. It fails with
"No migrations present at …/dist/server/migrations". Apply the files directly,
in filename order, against the real database id:

```sh
export D1_ID=<the database_id printed by d1 create>
for file in drizzle/*.sql; do
  echo "applying $file"
  npx wrangler d1 execute "$D1_ID" --remote \
    --config dist/server/wrangler.json --file "$file"
done
```

**Read the output.** Each file must report its statements executed. A failure
half-way leaves a partial schema, and the next file will fail on the missing
table, so fix the cause and re-run only the file that failed.

Keep the full trigger statements intact, including the whitespace around
`CASE`/`END`: wrangler splits the file on statement boundaries, and the
`learning_awards`, `badge_receipt`, `redeem_badge`, `story_read_award`,
`story_tick_totals` and `study_tick_totals` triggers are what award credits.

Applying all eleven files to an empty database produces 23 tables, 6 triggers
and 16 custom indexes. That has been checked; it is what you should see.

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

**Full steps are in [docs/STRIPE.md](STRIPE.md).** The short version:

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

### 7. The audio, and the clone problem

`public/audio/` is gitignored and **nothing in it is committed**: 2,371 files,
169 MB. That is the right decision for a repository, and it means **a fresh
clone builds a site with no audio at all.** The Listen controls then show "This
story is still being recorded" rather than failing loudly, so this is easy to
miss and easy to ship.

Three ways to handle it, in order of preference:

**a) Keep the clips in object storage and point the manifest at it.** The app
fetches a `manifest.json` at runtime, so if the manifest's URLs can be absolute
this needs no rebuild when the clips move. Best long-term answer, and it also
takes 169 MB off every deploy.

**b) Store the clips in CI as a build artefact.** Generate once, upload, restore
per build. Needs `AZURE_SPEECH_KEY` in the CI secret store, or the artefact
store alone if you only ever restore.

**c) Generate them in CI before the build.** Needs the Azure keys. The
generators skip work that is already current, so it is not slow on every build,
but it is 169 MB of generation on the first one.

Whichever you pick, run the validators in CI or you will not find out:

```sh
npm run audio:validate
npm run audio:stories:validate
```

Both exit non-zero when a clip is missing or no longer matches its source. A
story clip counts as stale when the prose in `data/stories/level-*.txt` has
changed, so re-run the generator after editing any story.

---

## Getting a public hostname

`APP_ORIGIN`, the Stripe webhook URL and every check below need a public HTTPS
origin. There are two ways to get one, and the order matters.

### Option A: the free `workers.dev` name (do this first)

Every Worker gets one on first deploy, with no purchase and no DNS setup. Deploy
and Cloudflare prints something like
`https://minewords-blue-book.<your-account-subdomain>.workers.dev`. That is a
real public HTTPS origin and it is enough for Stripe, which is what makes it
useful: you can take a **real** payment and confirm the webhook works before you
have spent anything on a domain.

Set it as `APP_ORIGIN` and use it for the Stripe webhook endpoint.

### Option B: your own domain

1. Buy it. **Cloudflare Registrar sells domains at cost**, with no markup, and
   puts the zone on Cloudflare for you. Buy it here rather than at a registrar
   that would leave the nameservers elsewhere.
2. Once the zone is active, add the Worker as a custom domain:
   **Workers → your Worker → Settings → Domains & Routes → Add → Custom
   domain**, then enter `minewords.app` (or a subdomain such as `app.` if you
   also want the apex for marketing). Cloudflare creates the DNS record and the
   certificate. It works because the zone is already on Cloudflare; a domain
   bought elsewhere and merely pointed at Cloudflare will not attach this way.
3. Keep the `workers.dev` name working while you test. Both can serve the same
   Worker, so nothing breaks if the custom domain has a problem.

### Changing hostname afterwards

Two things must be updated, in this order, or a paying parent is stranded:

1. `APP_ORIGIN` → the new origin.
2. In Stripe, **edit the existing webhook endpoint's URL** rather than creating
   a second endpoint. The signing secret is per endpoint, so editing the URL
   keeps the secret you already set in `STRIPE_WEBHOOK_SECRET`. A second
   endpoint means a second `whsec_`, and forgetting to copy it means payments
   that complete and grant nothing.

`APP_ORIGIN` is used in exactly two places: the `billingReady()` gate, and
building Stripe's `success_url`/`cancel_url`. So a stale value does not break the
site — it sends a parent who has just paid to a page that does not exist. Check
`/account?checkout=success` works after changing it.

---

## Deploying

```sh
npm test                      # 167 tests, must be green
npm run typecheck
npm run lint
npm run build                 # produces dist/
# patch the D1 id as above
npx wrangler deploy
```

`wrangler deploy` with no `--config` does pick up `dist/server/wrangler.json`
automatically, so the patched database id is the one that ships. That has been
checked by patching a sentinel id and reading it back in the bindings table.

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
- **Listen works on a word and on a story.** The audio is not in the repository,
  so a deploy built from a fresh clone has none of it, and the Listen control
  degrades to a recording message rather than an error. This is the single
  easiest thing in this runbook to ship broken.
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

|                             |                                                               |
| --------------------------- | ------------------------------------------------------------- |
| Workers paid                | $5/month, flat                                                |
| Requests                    | 10M/month included. A month of 50,000 page views is under 1%. |
| CPU                         | 30M ms/month included                                         |
| Bandwidth and asset storage | **Not charged**                                               |
| D1                          | 25B rows read, 50M written, 5 GB storage included             |

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

The Cloudflare Workers runtime cannot run on this machine at all: it needs
macOS 13.5 or newer and this is macOS 12.7.5. Every `wrangler … --local`
command fails immediately with "Unsupported macOS version" — including
`d1 execute --local`, so **the migrations in step 4 cannot be rehearsed
locally**, only applied to the real database.

What _does_ work here is worth knowing precisely, because it is what the
development loop has been using:

- `npm run dev:node` starts the app, because it swaps the Workers runtime for
  `node:sqlite` and skips `workerd` entirely. This is why a dev server can be
  running on a machine that cannot run the Workers runtime.
- `wrangler deploy --dry-run` succeeds, so the bundle can be built and
  inspected. `wrangler deploy` and `d1 execute --remote` are cloud operations
  and do not need the local runtime, but they are untested here for want of
  credentials.

So the schema, the bundle and the binding wiring have been checked, and the
first deploy is still a genuine first deploy. Deploy to the free `workers.dev`
name first, walk the verification list, and only then point a real domain at
it.

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

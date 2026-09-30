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

The schema lives in `drizzle/`, applied in filename order. The newest is
`0014_email_verification.sql`, which adds the `email_verifications` table and
`users.email_verified_at`; sign-in refuses an unverified address, so a deploy
without it locks every new account out of the app rather than degrading one
feature. A deploy without `0010_coach_last_seen.sql` fails on the first answer,
not at boot.

**`scripts/deploy.sh` applies these for you**, and in the only order that is
safe: migrations first, the Worker second, and a failed migration exits non-zero
before anything is uploaded. It is not a bare `wrangler deploy` because
vinext writes `dist/server/wrangler.json` with no `migrations_dir` in it, so
`d1 migrations apply` would find nothing to read. The script therefore runs
`scripts/patch-wrangler-migrations.mjs` after the build to point that key at
`drizzle/` and name the ledger `d1_migrations`, and *then* runs
`d1 migrations apply`. The patch is what makes `apply` work here; it is not
optional and it is not a convenience.

**Do not apply these files with `wrangler d1 execute --file` by hand.** That
route is not idempotent - a migration that has already run fails when it runs
again - and it records nothing, so the next `d1 migrations apply` tries every
file from the start and stops on the first column that already exists. The deploy
script reconciles the ledger before `apply` runs, so that self-repairs now; see
[the ledger repairs itself](#cloudflare-workers-builds-automatic-deploys) below.

For a database that has never been touched, the manual equivalent of what the
script does is:

```sh
export D1_ID=<the database_id printed by d1 create>
node scripts/patch-wrangler-migrations.mjs   # needs a build to have run
npx wrangler d1 migrations apply DB --remote --config dist/server/wrangler.json
```

`DB` is the binding name, read out of the generated config rather than guessed.

**Read the output.** Each file must report its statements executed. A failure
half-way leaves a partial schema, and the next file will fail on the missing
table, so fix the cause and re-run only the file that failed.

Keep the full trigger statements intact, including the whitespace around
`CASE`/`END`: wrangler splits the file on statement boundaries, and the
`learning_awards`, `story_read_award`, `story_tick_totals` and
`study_tick_totals` triggers are what award credits. `redeem_badge` and
`badge_receipt` are named in older notes but no longer exist -
`0012_entitlement_and_purchases.sql` drops both, because entitlements are
checked in the application now.

To check the schema rather than trust it, apply every file to an empty database
and read `sqlite_master` directly. A count written into a document goes stale
the next time a migration lands, so this is deliberately a command rather than
a number:

```sh
dir=$(mktemp -d)
sqlite3 "$dir/schema.sqlite" < <(cat drizzle/*.sql)
sqlite3 "$dir/schema.sqlite" \
  "select type, count(*) from sqlite_master where name not like 'sqlite_%' group by type;"
```

When last checked against the migrations on disk, that reported 25 tables,
4 triggers and 24 indexes.

### 5. Secrets

Secrets are read by `setting()`, which looks first at the Workers environment
and then at `process.env`. They are never committed: `.env*` is in `.gitignore`
and only `.env.example` is tracked.

```sh
npx wrangler@latest secret put APP_ORIGIN
npx wrangler@latest secret put RESEND_API_KEY
npx wrangler@latest secret put EMAIL_FROM
npx wrangler@latest secret put STRIPE_SECRET_KEY
npx wrangler@latest secret put STRIPE_PRICE_ID
npx wrangler@latest secret put STRIPE_WEBHOOK_SECRET
```

`APP_ORIGIN` is the public origin including scheme, for example
`https://minewords.app`, and nothing else. It is used to build the Stripe return
URLs, so a wrong value sends parents to a page that does not exist.

**`RESEND_API_KEY` and `EMAIL_FROM` are what make password reset and email
confirmation work**, and a password reset against a deployment without them
looks fine from the outside: the endpoint answers "if that address has an
account, a reset link is on its way" whether or not a mail was sent, because
any other answer would reveal which addresses are registered. So the only
symptom is a parent who never receives anything, and the reason is in the logs.
To see it:

```sh
npx wrangler tail --format pretty
```

Then submit a reset. The line that matters is the error, which fires on every
attempt:

- `Email delivery is not configured.` — one of the two secrets above is missing.
- `Invalid URL` — `APP_ORIGIN` is missing or malformed. The link is never even
  built, because the origin is the first thing it needs.
- `The email service is unavailable.`, preceded by `Email delivery failed <status>`
  — Resend rejected it. **401** is a bad key, **403** is a sender domain that has
  not been verified in Resend, **422** is a malformed `from` or `to`.

`EMAIL_FROM` must be a sender on a domain you have verified in the Resend
dashboard under Sending → Domains, or every send fails with 403 regardless of
the key. The token itself is still written to `password_resets` when the send
fails, so a row there with no email arriving confirms the flow ran and the
delivery is the part that broke.

**Unlike a password reset, this failure is not invisible.** Since
`0014_email_verification.sql`, sign-in refuses an address with no
`email_verified_at` and answers 403 with "check your inbox for the link that
confirms this address" - so a deployment whose mail does not actually send is
not a degraded feature, it is every new account unable to sign in at all. The
password is checked first, so a wrong password still answers 401 as usual.
Confirm a real message arrives before calling a deploy finished.

If mail cannot be configured yet and existing accounts need to get in, stamp the
column directly - but only where you already know the address belongs to the
person who made the account, because this is the one check standing between a
typed password and the account:

```sh
npx wrangler d1 execute DB --remote --command \
  "UPDATE users SET email_verified_at = $(date +%s000) WHERE email_verified_at IS NULL"
```

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

### 7. The audio

`public/audio/` is **committed**: 2,371 files, 169 MB. It is generated once and
then rides along with every build, so a build from a clean clone has the same
clips a developer has, and a Git-triggered deploy needs nothing set up.

This is deliberately not the tidier-looking choice. Ignoring generated media is
normally the right call for a repository, and it was what this file used to
advise - but it means a fresh clone builds a site with no audio at all, and the
Listen controls then say "This story is still being recorded" rather than
failing loudly. That is easy to ship without noticing, which is exactly what
happened: a deploy from a clean checkout shipped a site whose 2,371 clips were
all 404.

The costs of committing, so they are a decision rather than a surprise: the
repository grows by 169 MB permanently, every fresh clone downloads it, and
each deploy still uploads all 2,371 files to Cloudflare. The largest single clip
is 1.4 MB, well under the 100 MB per-file limit, and Workers Static Assets
allows 20,000 files against the 2,371 here.

**Refreshing the clips.** They are generated from the word list and the story
prose, so they go stale when those change. Re-run the generators, which skip any
clip that is already current, so this is cheap unless a lot has changed:

```sh
npm run audio:generate          # 2,247 word pronunciations
npm run audio:stories:generate  # 120 story narrations
```

Both need `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` in `.env`. A story clip
counts as stale when the prose in `data/stories/level-*.txt` has changed, so
re-run the story generator after editing any story - editing one story
regenerates one file.

**Checking them.** Run these before deploying, or you will not find out:

```sh
npm run audio:validate
npm run audio:stories:validate
```

Both exit non-zero when a clip is missing or no longer matches its source.

**If the deploy size ever matters.** Moving the clips to an R2 bucket takes the
2,371 files off every deploy, and R2's free tier is 10 GB-month against 169 MB.
It needs the binding in `.openai/hosting.json` set from `null` to a bucket name,
absolute URLs in the manifests, and a wider `media-src` in the Content Security
Policy, which is currently `'self'` and would block clips from another origin.

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
npm test                                                  # must be green
npm run typecheck && npm run lint
D1_ID=<database_id> D1_NAME=<database_name> npm run build  # produces dist/
WORKER_NAME=<the deployed Worker's name> bash scripts/deploy.sh --skip-verify
```

The number of tests is deliberately not written here. It changes every time one
is added, and a count in a document is a count that will be wrong and still look
authoritative. `npm test` prints the real one.

Or, if you are deploying by hand and want no migrations in the way,
`npx wrangler deploy --name <the deployed Worker's name>`.

`wrangler deploy` with no `--config` does pick up `dist/server/wrangler.json`
automatically, so the database id the build wrote is the one that ships.

**Always build immediately before deploying.** `dist/` is gitignored and
`wrangler deploy` uploads whatever is in it, so deploying without a fresh build
ships the previous build. That is not a theoretical risk: a deploy of a stale
`dist/` is how a build that predated the last few commits went out.

### Migrations have to run before the code

The line above is missing one step, and its absence is not a small thing.

`wrangler deploy` alone does not migrate anything. If a release reads a column
the database does not have, the Worker starts serving requests that fail, and
rolling the deploy back does not help because the previous code was happy with
the previous schema. `users.expiry_date` is read by `membership()` on *every*
authenticated request, so that is not a degraded feature - it is every signed-in
request failing.

So the order is migrations, then the Worker, as two commands. `scripts/deploy.sh`
does it, and it takes the database id from the config the build just produced,
so it cannot be pointed at the wrong database by a stale environment variable.

## Cloudflare Workers Builds (automatic deploys)

In the dashboard: **Workers & Pages → your Worker → Settings → Builds**, or
**Create → Workers Builds** to connect the repository.

| Setting | Value |
| --- | --- |
| **Build command** | `npm run build` |
| **Deploy command** | `bash scripts/deploy.sh --skip-verify --no-build` |
| **Root directory** | leave at the repository root |
| **Build variable** | `D1_ID` = the D1 database id |
| **Build variable** | `D1_NAME` = `minewords` |
| **Build variable** | `WORKER_NAME` = the Worker's own name |

Notes on each, because the two commands are not interchangeable:

- **`--no-build` matters.** Workers Builds runs the build command and *then* the
  deploy command. Without this flag the deploy command would build a second time,
  wasting several minutes on every deploy.
- **`--skip-verify` matters.** The tests, typecheck and lint belong in the build
  command, not the deploy command. Put them there so a failing test stops the
  build before anything is uploaded.
- **The migrations run from the deploy command**, which is why it is not simply
  `npx wrangler deploy`. That is the whole change: the deploy command applies
  pending migrations first, and a failed migration exits non-zero so the Worker is
  never updated.
- **`WORKER_NAME` is not optional, and this is a trap worth knowing about.** The
  build takes the Worker name from `package.json`, so it generates
  `minewords-blue-book`. A Worker created by connecting a repository through
  Cloudflare's Git integration is named after the **repository**, which here is
  `eleven-plus-vocabulary-website`. Those are two different Workers: deploy the
  generated config without setting this and you upload a second Worker, the live
  one stays on the last commit, and every step reports success. `scripts/deploy.sh`
  prints `target Worker:` before it applies anything, so the name is visible in the
  build log either way.
- **`D1_ID` and `D1_NAME` are build variables**, because the build writes the
  database id into `dist/server/wrangler.json` and the deploy command reads it
  from there. Getting `D1_ID` wrong is the one mistake that will not announce
  itself: the build would target the wrong database and every later step would
  still report success.
- If the repository is set up to run tests in the build command, use
  `npm run verify:client` there rather than listing the three steps.

**The ledger repairs itself, so there is no bootstrap to do.** `d1 migrations
apply` decides what to run from `d1_migrations` alone - it cannot ask the schema,
because `ALTER TABLE ADD COLUMN` has no `IF NOT EXISTS`, so no migration can be
written safe to run twice. A database migrated by hand with
`wrangler d1 execute --file` therefore has a complete schema and an empty ledger,
and the first `apply` runs `0000` again and stops on
`table "attempts" already exists`. Nothing is damaged, nothing is applied, and
every deploy fails.

That is not a setup step, so it is not in this guide. `scripts/deploy.sh` runs
`scripts/reconcile-migration-ledger.mjs` before `apply`: it reads the database's
`sqlite_master` and column list, decides per migration whether that migration has
run, records the ones that have, and leaves the rest pending. Each migration's
evidence is named in that script next to the migration it comes from, so the two
cannot drift apart. **The build log prints one line per migration**, saying what
the ledger was made to agree with and why - read that table when a migration
fails, because it is the only place the answer exists.

Every row written is gated on positive evidence, so the failure mode is
"recorded too little" - a loud deploy failure on a table that already exists -
rather than "recorded too much", which is a schema change that is never made and
an app that fails at runtime while every deploy reports success. Two cases are
deliberate stops rather than decisions:

- An empty ledger on a database that has objects but is not recognisably this
  application's (no `users` with `attempts`/`progress`) exits non-zero and writes
  nothing. That is a typo'd `D1_ID` or a dump of the wrong database, and filling
  in its ledger from a guess is not recoverable.
- `0000`-`0003` predate the evidence, so they are recorded on the database being
  this application's at all rather than on each one individually. `0000` creates
  `users`, `attempts` and `progress` together, so no state this repository can
  produce has one without the others.

`scripts/seed-migrations-ledger.sql` is the older, hand-run version of the same
repair and is kept for a database you cannot reach with the deploy script. It is
already behind: it names fourteen migrations and takes `0000`-`0009` on trust.
Prefer the reconciler.

Verify what the ledger thinks before trusting a deploy: `npm run
check:deploy` locally, and the `Migrations to be applied` lines in the build log
on Cloudflare.

### Every deploy, after the first

1. `npm test && npm run typecheck && npm run lint`
2. `D1_ID=… D1_NAME=… npm run build`
3. `npm run verify:chunks`
4. `WORKER_NAME=… bash scripts/deploy.sh --skip-verify`
5. Click a link in the deployed app.

**Step 4 is the deploy script, not `wrangler deploy`.** The script applies
pending migrations and *then* uploads the Worker, in that order, and stops
before uploading anything if a migration fails. A bare `wrangler deploy` uploads
the code first and migrates never, which is the outage described under
[Migrations have to run before the code](#migrations-have-to-run-before-the-code).

**Step 3 is not optional, and step 5 is not ceremonial.** This repository once
shipped a build where *every* link in the app did nothing when clicked, while
the whole suite passed. The cause was a circular dynamic import between the
framework's client entry chunk and its Link chunk: the bundler left
`navigateClientSide` out of the entry chunk's export list, the Link chunk
destructured it off a namespace that did not have it, and the click handler
threw - after calling `preventDefault`, so the browser never navigated either.
It only ever appears in a production build, which is why no test caught it.

`npm run verify:chunks` reads the built chunks and fails on a missing
cross-chunk binding or on a chunk cycle, which is the shape that caused it. It
is a guard rather than a proof, so **step 5 is still the real check**: click
through the top menu on the deployed site. A production build cannot be served
on a Mac older than 13.5, so that click cannot be done locally.

Minification is off, but **not** because it caused any of this - that guess was
wrong, and it is recorded in `vite.config.ts` so nobody repeats it. Turning
minification on saves about 908 KB of client JavaScript, 48% of the bundle, and
is a reasonable follow-up once the site is confirmed working. The procedure and
the caveat are in that same comment.

---

## After every deploy, check these

The order matters. The first three are the ones that fail silently.

```sh
ORIGIN=https://your-origin

# 1. The policy is present and carries a nonce. A missing CSP means the proxy
#    file did not run, and you will not find out from this command alone - you
#    find out from a blank page.
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
`proxy.ts` handles this the way it is meant to be handled: a fresh random
nonce per response, which the framework reads back out of the header and stamps
on the scripts it generates. That mechanism is the framework's own, not a
workaround.

It is still untested here. If the page renders but does not respond, that is a
policy that is too strict, and the fix is in one place: add the missing directive
to `policyFor()` in `proxy.ts`. Two things are known to need permissiveness
already and are allowed: inline styles, because React writes them, and the theme
script, by hash. A third may be needed and is not known; `tests/security.test.mjs`
asserts the policy cannot be loosened silently, so if you have to add something,
that test is where you record why.

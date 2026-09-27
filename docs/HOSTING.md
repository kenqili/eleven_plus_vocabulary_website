# Where to host MineWords, and why

Researched 27 September 2026. Every price and limit below was read from the
vendor's own page during that research, and the URL is given. Anything that could
not be verified is in the last section rather than smoothed over.

## The recommendation

**Cloudflare Workers, paid plan. $5/month. D1 created with `--jurisdiction=eu`.**

Not because it is the cheapest thing that could work, though it is close. Because
it is the cheapest thing that needs **no code change**, and because it is the only
option at any price under $20/month that comes with a *citable* commitment about
where a child's account data lives.

### What the code actually requires

Read from the repository, not assumed:

- `vinext` 1.0.0-beta.5, which runs on Cloudflare Workers. `npm run build`
  produces `dist/server/wrangler.json`; `npm start` runs `wrangler dev --config
  dist/server/wrangler.json`.
- `db/index.ts` imports `env` from `cloudflare:workers` and calls
  `drizzle(env.DB)` from **`drizzle-orm/d1`**. This is **D1**, not Turso or
  libSQL.
- **Node >= 22.13.0**, enforced by `scripts/run-framework.mjs`.
- **167 MB of MP3 across 2,369 files** in `dist/client/audio`. This is the single
  biggest fact in the comparison, and it is the reason the answer is not a VPS.
- Stripe for the subscription.
- Nothing third-party at runtime: no analytics, no font CDN, no error reporter.
  The `Content-Security-Policy` in `middleware.ts` allows no absolute origin, and
  that is a statement about the architecture as much as about security.

---

## The comparison

| Option | Cheapest workable | Price | Data in EU/UK? | Migration |
|---|---|---|---|---|
| **Workers paid + D1 (EU)** | Workers Paid | **$5/mo** | **Citable, hard constraint** | **none** |
| Workers free + D1 | Workers Free | $0 | Citable for the database | none |
| Workers + Turso | Turso Developer | $4.99/mo | **unverified** | small |
| Fly.io `ams` | shared-cpu 1GB | $5.91/mo | Region named, no DPA read | medium |
| Contabo EU | Cloud VPS 4 | €4.40/mo, 24-month term | EU/UK DCs listed | medium |
| IONOS | VPS S+ | $6/mo after 3 months, 1-year term | DE/UK/ES named | medium |
| DigitalOcean | Basic 1GiB | $6/mo + 20–30% backups | AMS3/LON1/FRA1 | medium |
| Hetzner | CPX22 | €19.47/mo | FSN1/NBG1/HEL1, ISO 27001 | medium |
| Vercel | **Pro required** | $20/mo | Default region is **iad1 (US)** | large |
| Netlify | Pro (region pinning is Pro-only) | $20/mo | Default `cmh` (US) | large |
| Koyeb | Pro | $29/mo floor | 7 regions | large |

**Vercel and Netlify are both blocked at the free tier**, and not on price.
Vercel's Hobby plan is "restricted to non-commercial, personal use only", which
is a licensing cliff rather than a pricing one. Netlify's blocker is residency:
region selection is Pro-only, and Free/Personal are pinned to Ohio.

---

## Why Cloudflare

### The audio decides it

167 MB across 2,369 files, each well under Cloudflare's 25 MiB per-file limit.
On Workers:

- static asset requests are **free and unlimited**
- there is **no charge for storing assets**
- there is **no charge for bandwidth or throughput**
- 2,369 files is well inside the 20,000-file limit

No other option at any price matches that. On a VPS this 167 MB has to be copied
on every single deploy. On Netlify it would be billed at 20 credits per GB, which
is roughly 3,300 credits — more than the entire Free allowance, gone, with credit
packs that auto-recharge.

### The data residency is documentable

From Cloudflare's D1 data location documentation: *"Jurisdictions are used to
create D1 databases that only run and store data within a region… The
jurisdiction constraint only controls where the database itself runs and persists
data."*

`eu` is supported, set at creation, and immutable afterwards:

```sh
npx wrangler@latest d1 create minewords --jurisdiction=eu
```

**What you do not get, stated plainly:** Workers execute on Cloudflare's global
network, not inside a cloud provider's region. `placement.mode: "smart"` and
`placement.region` are latency settings — the documentation describes them as
running a Worker "in the data center with the lowest latency to your specified
cloud region". The product that actually pins execution is **Regional Services**,
which Cloudflare describes as "a compliance solution, not a performance
optimization", and which is Enterprise-only.

So: **the database is EU-resident by documented constraint. Request processing is
not.** For a UK child, a Worker will normally run at the London point of
presence, but that is an inference from network proximity and must not be
presented as a commitment. Say this in the privacy policy.

### The two cliffs that make $5 worth paying

**Workers Free: 10 ms CPU per invocation.** The documentation notes that
"heavier workloads that handle authentication, server-side rendering… typically
use 10-20 ms." This app is squarely in that band.

**D1 Free: 5 million rows read and 100,000 written per day, 500 MB per database.**
The documentation is blunt: *"When your account hits the daily read and/or write
limits, you will not be able to run queries against D1"* and *"you will need to
delete unused databases or clean up stale data before you can insert new data."*
`learning_events` grows by rows, per child, per answer. 5,000 users could
plausibly reach 500 MB.

$5/month is the price of removing both risks, and it includes the citable EU
jurisdiction.

### Zero migration

`drizzle-orm/d1`, the `nodejs_compat` flag, the generated `wrangler.json`, the
Stripe webhook (which reads the raw body and verifies the signature itself), Web
Audio and `localStorage` — all of it stays exactly as it is.

### It solves the macOS problem

The Workers local runtime needs macOS 13.5+. On 12.6 there is no local dev
server at all, which is why `DEPLOY.md` leans so hard on preview environments.
Deploying from CI or the dashboard needs no local runtime.

---

## If you ever need compute residency too

The honest bridge, if a stricter reading of UK GDPR transfer rules, a school, or a
B2B customer makes processing location a hard requirement:

- **Fly.io `ams`** — $5.91/month for shared-cpu 1GB, published per-second
  constants. European egress $0.02/GB.
- **Contabo Cloud VPS 4** — €4.40/month excluding VAT, 24-month term, unlimited
  traffic, DDoS protection and firewall included.

Budget **medium** effort, and the work is dominated by one thing: dropping
`vinext` for plain `next build` and `next start`. `next` is already a dependency
at a real version and `next.config.ts` is conventional, so that part is smaller
than it looks. Two real tasks beyond it:

1. `db/index.ts` swaps `cloudflare:workers` and `drizzle-orm/d1` for
   `better-sqlite3`. One file.
2. **`db.batch()` is not a transaction in D1.** The credit-debit path uses SQLite
   triggers for atomicity and Drizzle migrations create more. Those triggers
   port fine, but every call site that relies on a batch being atomic needs an
   explicit transaction after the move. This is the part that could quietly lose a
   credit, and it needs a careful read rather than a find-and-replace.

For Fly.io, Contabo, Hetzner, IONOS and DigitalOcean, datacenter locations are
citable vendor statements. Their DPAs were not read, so "your data is in region X"
from them is a stated infrastructure fact, not a contractual guarantee — weaker
than D1's jurisdiction flag, which is a configuration constraint with
documentation behind it.

---

## Could it be free?

Possibly, and it is worth measuring rather than guessing. Deploy on the paid
plan, read `cpu_time` in the Cloudflare dashboard after a week of real use, and
if it sits comfortably under 10 ms per invocation, the free plan becomes viable.
That is a five-minute measurement that could make the whole thing permanently
free.

The D1 free-tier storage ceiling would still apply, so it would be "free until the
database reaches 500 MB", not free. Design the answer for that: at roughly 200
bytes a row, 5 GB is around 25 million answers.

---

## Cost at scale

At 5,000 registered users and roughly 50,000 page views a month: **$5/month flat.**
Every parameter is inside the included allowance, and the estimate is robust
because bandwidth is not charged.

Where it would break: per-million-request pricing is not a concern at this scale
anywhere. Cloudflare's allowance is 10M requests; 50,000 page views is 0.5%. The
only two things that could move the number are genuine growth, and — on Netlify
rather than Cloudflare — audio bandwidth, which is why the audio matters so much
in the comparison.

---

## What could not be verified

1. **Turso's region list.** `api.turso.tech/v1/locations` returned 401, and both
   documentation pages 404. Turso is not recommended on the strength of an
   unverified claim about where it runs.
2. **Hetzner's cheapest tiers.** Prices render client-side and the API requires a
   token. Only the CPX22 and above were recovered, from Hetzner's own benchmark
   file. The cheaper cost-optimised line is likely well under €19.47 and is
   likely to be the best-value German option.
3. **Scaleway's regions** for the instance tiers priced, and whether the
   sub-€1 instance line is ARM.
4. **Uberspace and OVHcloud** — pricing pages unreachable, so neither is quoted.
5. **Whether `--jurisdiction=eu` works on the Workers Free plan.** Documented as
   ungated and D1 is documented on both plans, but no explicit statement was
   found. Confirm in the dashboard before relying on it.
6. **Any contractual commitment about Worker execution location** below
   Enterprise. This is a real gap in Cloudflare's cheap tiers, not a search
   failure.
7. **Signed data-residency commitments** for Fly.io, Contabo, Hetzner, IONOS and
   DigitalOcean. Their region lists were verified; their DPAs were not read.
8. **Vercel's per-unit overage rate** beyond the $20 platform fee and credit.

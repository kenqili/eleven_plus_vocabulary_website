# Student progress, credits and digital badges

Design proposal, 19 September 2026. This document specifies the next implementation; it does not enable these features yet.

## Deployment and storage

Keep the existing Cloudflare D1 database for private per-user data. The application already uses D1 for users, hashed passwords, sessions, attempts, word progress and subscriptions. CSV remains the editable vocabulary/question source, committed with the application. Never put student records, passwords or session tokens in CSV, the public directory or Git.

D1's current free allowance is 5 million rows read/day, 100,000 rows written/day and 5 GB total storage. Indexes also affect usage. Monitor quotas and use indexed queries, pagination and daily summaries; the free allowance is not unlimited hosting.

Sources: https://developers.cloudflare.com/d1/platform/pricing/ and https://developers.cloudflare.com/workers/platform/pricing/

A JSON file per user is unsuitable for the current serverless deployment: persistent shared writes and concurrent credit deductions require a transactional store. For a future single-server deployment, SQLite on a persistent disk is a viable file-based database, with backups. It is not a replacement that can simply be written into the current Worker filesystem.

Important deployment check: Workers Free currently allows 10 ms CPU per request. The existing deliberately expensive scrypt password hashing must be benchmarked in the hosted runtime; do not assume it fits, and do not weaken it to fit. D1 can remain free while application compute uses a paid tier, or authentication can move to a separately assessed managed provider. An entirely free deployment is therefore a target, not a promise.

## Dashboard

Use three tabs: Today, This week, All time. Default to Today. Always show the current credit balance and overall mastery separately from the selected period.

| Metric | Definition |
| --- | --- |
| Questions completed | Accepted answers plus Skip & reveal; excludes pending and retired questions |
| Correct answers | Accepted correct answers; answer replay never increases the count |
| Accuracy | Correct / submitted answers, excluding reveals; display an em dash if none |
| New words explored | Distinct words with their first completed attempt in this period |
| Words practised | Distinct words with any completed attempt in this period |
| Newly mastered | Words reaching five correct answers for the first time in this period |
| Study time | Recorded active study seconds, displayed as seconds below a minute, then minutes and seconds |
| Credits earned | Positive learning awards in the selected period, independent of spending |

Use “New words explored” rather than claiming a single exposure means learned. “Mastered” retains the existing five-correct-across-types rule. Show partially learned words too: for example “12 words in progress”.

Store event timestamps in UTC. Store an IANA reporting timezone per user, initially Europe/London; show it in the dashboard. Today uses local midnight; weeks run Monday to Sunday. Compute boundaries with daylight-saving-aware logic. Timezone changes rebuild daily summaries from events instead of relabelling UTC dates. Display date ranges on weekly views.

After every accepted answer, return refreshed period totals, mastery and balance in the same response. Animate only the changed values briefly; no reload is required. Show a live unsaved active-time increment separately, then reconcile with the server on persistence. Refresh after redemption and on window focus; do not continuously poll.

## Active study time

Count visible, focused question and explanation reading time. Pause when hidden and after 60 seconds without interaction; resume on interaction. Do not count account, checkout or badge browsing time as study.

Use a server-owned study-session ID and monotonic heartbeat sequence. Checkpoint cumulative active seconds every 30 seconds and when answering/leaving where possible. The server accepts each sequence once, caps increments by server-observed elapsed time, and prevents overlapping tabs from double-counting. Split intervals at local day boundaries for reporting. Time is an engagement estimate, not proof of attention; award no credits for time alone. A browser crash can lose the most recent unacknowledged interval, at most approximately 30 seconds under normal operation.

Existing attempt elapsed values are retained as historical recorded time, not retrospectively described as precise active time.

## Credit rules (initial defaults)

* +2 credits for each correct answer that advances a word's five-correct mastery count.
* +10 bonus credits when that word is first mastered.
* No credits for wrong answers, reveals, page refreshes or elapsed time; no credit deductions for mistakes.
* A word can earn at most 20 lifetime learning credits under these rules. Resetting practice or switching question types does not reset award eligibility.
* Demo practice shows session-only stats and never earns redeemable credits.

Keep rule values in a versioned server configuration. Include the rule version and event reference on each award. The client cannot submit award amounts, balances or correctness. Replaying an answer must return its original result without additional awards.

Backfill historic credits once from valid saved correct attempts: award the first five correct answers per word plus its first mastery bonus. Use deterministic unique keys so rerunning the backfill is safe. Derive historical first exposure and fifth-correct timestamps from attempts. If imported progress lacks supporting attempts, preserve its mastery count but label its date unknown and do not invent historical activity or awards.

## Badge redemption and parents

Initial catalogue, stored in a small versioned application configuration:

| Badge | Credit cost |
| --- | ---: |
| Vocabulary Spark | 20 |
| Word Explorer | 50 |
| Vocabulary Champion | 100 |

Students choose a badge and see its cost and resulting balance before selecting “Redeem”. Successful redemption deducts credits and immediately adds a dated digital badge receipt to their collection. Repeat redemptions are allowed, each with its own receipt; group duplicate badges visually by quantity. A retry of the same request does not buy another badge.

Parents decide whether a badge corresponds to any reward at home. The website supplies only digital badges and records their redemption; it does not promise, deliver or verify a physical reward or cash value. No parent approval workflow, parent PIN, family linking, address collection or fulfilment status is required for this initial scope. Parents can review the student's dated badge history together. A separately authenticated parent portal can be a later feature if requested.

Show two histories: learning credit transactions and redeemed badges. Each receipt records the immutable badge name/version/cost at redemption time, date, receipt ID and resulting balance. Later catalogue price changes must not rewrite past receipts. Do not accept arbitrary HTML or parent reward descriptions in the initial release.

## Backend data model

Extend existing tables rather than introduce another datastore. All private reads derive the user ID from the authenticated session.

* `users`: add reporting timezone.
* `progress`: add first-completed timestamp and first-mastered timestamp. Preserve existing correct/seen/retry fields.
* `study_sessions`: user ID, start/end timestamps, last checkpoint, accepted sequence, cumulative active seconds and lease for active-tab ownership.
* `study_intervals`: accepted time segments for attribution, with unique session/sequence; no credit awards from these events.
* `user_daily_stats`: user/local date/timezone version, question/correct/reveal/first-exposure/mastery counts and active seconds. Rebuildable summaries, not the only source of history.
* `credit_wallets`: one row per user, nonnegative integer balance and version.
* `credit_transactions`: immutable ID, user ID, signed integer amount, reason, attempt/word/redemption reference, rule version, created timestamp, balance after, unique per-user event key.
* `badge_redemptions`: immutable ID, user ID, unique request key, badge ID/version/name snapshot, cost, created timestamp and linked debit transaction ID.

Index attempts by user and answered timestamp; histories by user and timestamp; enforce unique award keys and user/request keys. Daily and weekly dashboard queries should not scan the user's complete history on every question. All-time totals can be cached alongside the wallet or a dedicated user summary, while remaining rebuildable from events.

## Transaction guarantees

The accepted-answer transition, mastery update, first-exposure/mastery markers, daily summary and credit award must commit atomically. Only an unanswered attempt owned by the current user can trigger them. Database uniqueness enforces one award per event; application checks alone are insufficient under simultaneous tabs.

Redemption takes only a known badge ID and idempotency key. Server resolves price and identity, then atomically checks/debits sufficient balance, inserts the ledger entry and creates the badge receipt. Use D1 transactional batches with guarded writes/constraints, or database triggers where needed; do not issue a separate unprotected read followed by a debit. A failed or insufficient-funds transaction produces neither a debit nor a receipt. A concurrent double-spend test is a release requirement.

Expose authenticated endpoints for period stats, paginated credit history, badge catalogue/collection and redemption. Preserve same-origin/CSRF protection and rate limiting. Redemption is available for already-earned credits even if membership lapses; active membership still controls full practice. Return authoritative balances after mutations.

## Passwords and account security

Current implementation already stores salted scrypt hashes, not plaintext or reversible encrypted passwords. It uses a random 16-byte salt, 32-byte digest and N=16384, r=8, p=5, matching one OWASP-listed scrypt profile. Session tokens are random; only their SHA-256 digests are stored. Production cookies use Secure, HttpOnly and SameSite=Lax, and sessions expire.

Source: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

Keep these protections. Version the hash encoding to include work parameters so future upgrades can rehash on successful login while still accepting existing hashes. Do not use plain SHA-256 for passwords, expose password hashes through APIs, log password bodies or commit user data/backups.

Before public launch, add verified email and password recovery using short-lived, single-use hashed tokens; use generic responses to reduce account enumeration, rate-limit requests, and revoke sessions after a reset. Recovery emails require a configured delivery provider. Separate test data from production, use HTTPS, keep secrets in runtime configuration, and test a database backup/restore. Support account deletion/export across all associated records, including credit and redemption history; avoid collecting unnecessary child profile data.

## Implementation and acceptance

1. Add migrations, event timestamps and indexed period stats; fix the dashboard's whole-minute display and immediate update behaviour.
2. Add active-time checkpointing, timezone-aware aggregation and one-time historical backfills.
3. Add atomic credit awards, wallet, ledger and read-only history.
4. Add badge catalogue, redemption confirmation and persistent receipt collection.
5. Complete deployment authentication checks, recovery configuration, backup/restore and free-tier load measurements.

Required tests: correct/wrong/reveal counters; first exposure only once; fifth-correct mastery only once; answer replay and concurrent submissions; timezone midnight, Monday boundary and DST; timer idle/hidden/two-tab behaviour; backfill rerun; redemption replay, concurrent purchases and insufficient funds; cross-user access isolation; persistence after logout/restart; existing question scheduling and CSV review hashes unchanged.

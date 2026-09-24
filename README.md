# 11+ Vocabulary Challenge

A web conversion of MineWordsAndroid's vocabulary challenge. Practice uses Flash Card 1, Flash Card 2 and Blue Book as one library with definition, synonym and antonym questions. There is no game or separate legacy 500-question challenge.

## Word database

Edit the three UTF-8 CSV files in `data/`:

1. `flash_card_1.csv`
2. `flash_card_2.csv`
3. `blue_book.csv`

The server merges these in exactly that order at build time. The first occurrence of each word wins, including its definition, synonyms, antonyms, example and source. Duplicates within a file are also removed. Matching trims surrounding whitespace, normalizes Unicode (NFKC), and ignores case. Source values are `flash_card_1`, `flash_card_2`, or `blue_book`; they remain internal metadata. The UI presents one vocabulary library without source names. Each answered or revealed question shows its definition, example, synonyms and antonyms, including in previous-word review.

Use the header `word,def,syn,ant,example`. Word and def are required; syn and ant supply the candidate relationships for generated questions. Quote cells containing commas, double quotes or newlines; escape embedded quotes by doubling them. Standard CSV exports and UTF-8 BOMs are supported. Invalid records fail validation with the source name and record number.

Add rows directly to the appropriate CSV, then run `npm run words:validate`, rebuild and redeploy. No manually maintained merged copy is needed. The old `data/bluebook.txt` is no longer used. Totals update automatically. IDs still use normalized word spelling, so existing mastery is preserved when words occur in a different source or position. Renaming a word creates a new ID. Load order determines merge precedence and word numbering; practice still uses its existing randomized/retry scheduling across the full merged bank.

## Generated question library

The current library contains **2,090 question templates**: 730 definitions, 730 synonyms and 630 antonyms. Each word has one definition and at most one question of each relationship type. Of the 100 omitted antonyms, 69 had no supplied opposite, 30 were excluded as misleading by independent review, and one direct dis- prefix pair (obedient/disobedient) was removed at user request. The generator excludes direct dis- prefix pairs in either direction. These exceptions are recorded in `data/question-review/generation-report.json`; the count is not padded with invented opposites.

- `data/syn.csv` and `data/ant.csv` are the question files used by the website. The requested antonym file is named `ant.csv` consistently, rather than maintaining a duplicate `antonym.csv`.
- Columns: `problem,options,answer,syn/ant,word`. `options` contains a CSV-escaped JSON array of four choices; `answer` is the exact correct option text, `syn/ant` is `syn` or `ant`, and `word` is the stable lowercase word ID.
- The generator prefers a suitable relation already present as a headword in the merged library, otherwise a common supplied relation. Explicit editorial overrides may choose a clearer answer even if a weaker supplied candidate is in the library. Distractors are drawn from the library unless a reviewer replaces them.
- All initial questions received independent semantic review. The final changed/new rows were rechecked, including all four options. `data/question-review/README.md` and `review-report.json` record decisions, dictionary references and exact reviewed file hashes. Tests reject CSV edits that no longer match that review.
- Source CSV values remain unchanged. Question-specific corrections and exclusions are in `data/question-review/overrides.json`, consumed by `scripts/generate-questions.mjs`. The original relation lists in word explanations are not a dictionary-wide audit.

After editing words, run `npm run questions:generate` and `npm run questions:validate`, then have the changed question rows reviewed before updating the review hashes. Rebuild/redeploy afterward. Restart the development server after regenerating CSVs: the current Vinext raw-CSV hot reload can retain stale data. Do not blindly update hashes to bypass semantic review.

## Code architecture

| Location                                 | Responsibility                                                    |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `data/*.csv`                             | Ordered source word databases                                     |
| `lib/challenge/words.ts`                 | CSV parsing, first-wins merge and definition choices              |
| `lib/challenge/types.ts`                 | Shared API contracts                                              |
| `lib/challenge/problems.ts`, `config.ts` | Question CSV validation, question types and shared mastery target |
| `lib/server/challenge.ts`                | Question scheduling, scoring, mastery and timing                  |
| `lib/server/auth.ts`, `password.ts`      | Server sessions, rate limits and password hashing                 |
| `lib/server/billing.ts`, `webhook.ts`    | Stripe subscriptions and signature verification                   |
| `lib/server/db.ts`, `http.ts`            | Runtime access and request/error handling                         |
| `app/api/`                               | Small route handlers enforcing authentication and access          |
| `components/minewords/`                  | Challenge, account, header and progress UI                        |
| `db/schema.ts`, `drizzle/`               | Account/progress schema and versioned migrations                  |
| `tests/`                                 | Content/security tests and local API integration checks           |

Words use the three CSV files. Accounts, hashed credentials, sessions, answers and subscriptions use D1/SQLite, not the CSV files. This avoids storing sensitive account data in downloadable vocabulary files. The runtime is React + TypeScript + Vinext on a Cloudflare Worker. Retained starter infrastructure and UI primitives remain separate from product modules.

## Development

Requires Node 22.13+ (Node 24 recommended for the test runner) and npm.
If you use nvm, run `nvm install` and `nvm use` to select the Node 24 version
specified in `.nvmrc` before running the commands below.

```sh
npm run install:ci
# Copy .env.example to .env; never commit .env
npm run db:generate
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_gray_mandrill.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_orange_jocasta.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_brainy_famine.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_ordinary_edwin_jarvis.sql
# Apply future migrations once, in filename order.
npm run dev
```

For a Node-only local preview (without the Cloudflare runtime), run:

```sh
npm run dev:node
```

This loads `.env`, applies all migrations automatically, and stores local data in
`.sites-runtime/node-dev.sqlite`, separately from the Worker preview database.
Use http://localhost:5173 to match the default `APP_ORIGIN`. To run integration
checks against this preview:

```sh
TEST_NODE_DB=.sites-runtime/node-dev.sqlite npm run test:integration
```

Use the local address printed by the server (normally http://localhost:5173). Local preview data persists under ignored `.wrangler/state`. Run `npm run start` to test the built Worker.

The Windows Sites helper encountered an npm-shim path issue in this environment. The equivalent direct commands work:

```powershell
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run install:ci
node scripts/run-framework.mjs build
```

## Accounts and login credentials

Visit `/account`, choose **Create an account**, and register with your email and a 12–128 character password. New free accounts receive full vocabulary practice, saved progress, word summaries, revision exports and badges for the first seven days after sign-up. Configure `FREE_TRIAL_DAYS` in `.env` locally or in the hosting environment (whole number from 0 to 365; default 7; set to 0 to disable free trials). The countdown is enforced by server-side access checks. After the trial, free users keep saved access to a stable, difficulty-balanced selection of 20 words (set `FREE_WORD_LIMIT` to a whole number from 0 to 730; default 20). Signed-out visitors can try the same free collection without saved progress. Subscribing unlocks the complete library and preserves existing progress.

Passwords use salted scrypt (N=16384, r=8, p=5); session tokens are random, stored only as hashes in D1, and sent in HttpOnly/SameSite cookies (Secure on HTTPS). Authentication endpoints are rate-limited, mutations check Origin, sessions expire after seven days, and logout revokes the session. Emails are normalized to lowercase.

This implementation does not yet provide email verification or self-service forgotten-password email delivery. Add an email provider and token-based recovery before a broad customer launch. No test account or test paid entitlement is included in deployment migrations.

## Monthly payments

The monthly price and currency have not been set. The account page displays the actual amount and currency from the configured Stripe recurring Price; it never invents a price. Until all required settings exist, checkout is disabled with a clear message. The configured free-account trial remains available; signed-out visitors can also try the configured free-word collection.

1. In Stripe **test mode**, create a product and a recurring Price with interval `month` and interval count `1`.
2. Configure `APP_ORIGIN`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, and `STRIPE_WEBHOOK_SECRET`. Use `.env` locally and the hosting secret manager for production. Never use `NEXT_PUBLIC_` for secrets.
3. Configure Stripe Customer Portal to let subscribers update payment details and cancel.
4. Point the webhook at `https://YOUR-PUBLIC-ORIGIN/api/stripe/webhook`, subscribing to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`.
5. Locally, use Stripe CLI forwarding to the same route, with its own webhook signing secret.
6. Test successful/declined payments, renewal, cancellation, expiry, replayed webhooks and repeated checkout before switching to live keys.

The return-from-checkout URL does not grant access. Signed webhooks fetch the current subscription from Stripe and synchronize access. Server routes require `active` or `trialing` status, an unexpired billing period and the configured Price ID. Invalid/stale signatures fail. Checkout requests use a durable idempotency key; repeated clicks reuse the same open session. Existing subscriptions direct users to billing management.

**Hosting audience matters:** a private Sites publication is for owner review. Public customers and Stripe cannot reach an owner-only site; launch on a public HTTPS origin and verify webhook reachability before enabling payments. Do not open the audience without the owner's launch decision.

## Practice rules

- Five correct answers across selected types master a word; mastered words leave the rotation. Existing three-correct progress is preserved and now needs two more correct answers.
- Choose one or more practice types. Definition cards are blue, synonyms green and antonyms amber, each with a written type label. At least one type must remain selected.
- Questions draw from the same word library. Among selected types, less-practised types for a word are preferred before repeating a type. Mastery is per word, not five for each separate type.
- Changing types preserves mastery; a pending question outside the selection is retired without credit. Answers to a retired question are rejected, including across tabs.
- Ordering lives in `lib/challenge/ordering.ts`: exclude the 20 most recently shown distinct eligible words (or all but one for a small pool), then choose a least-seen word with random ties. Due mistakes override this ordinary spacing, oldest due first.
- Missed/revealed words are scheduled for the 15th next question presentation (within the requested 10–20 range). Fixed spacing avoids collisions from random review dates. Waiting mistakes are excluded from ordinary selection; if only waiting mistakes remain, they can return earlier. Retired questions count as presentations; reloading a pending question does not. Reviews require an eligible selected type. Previously queued or temporarily filtered-out reviews are served oldest-due first when eligible and may already be overdue.
- Question types are balanced per word by completed attempts, with random ties. Five correct answers across types retire the word. Changing filters preserves progress; refreshing resumes the pending question.
- The free sample selects the configured number of words, balanced across difficulty levels and interleaves their question types in shuffled rounds. A new load/filter selection starts a fresh sample.
- The current question survives refresh and sign-in; concurrent tabs share one pending question.
- Server-side scoring prevents replayed answers from increasing mastery twice.
- Previous-word review is read-only. Optional auto-next waits briefly after a correct answer.
- Account progress persists across devices. Signed-out sample answers are temporary; signed-in free collection progress is saved.
- The dashboard has Today, This week (Monday–Sunday), and All time. Reporting uses Europe/London, including daylight saving. It distinguishes new words explored from words mastered, and updates after every answer.
- Active study time includes question and explanation reading. It pauses when hidden/unfocused or after 60 seconds without interaction. Authenticated practice checkpoints every 15 active seconds, on answers and on page exit where possible. Server wall-time caps, unique checkpoint IDs and a per-user tab lease prevent repeated requests or overlapping tabs from counting twice. A crash or connection loss can lose the latest unsaved interval; time is an engagement estimate. Historical answer-time records are preserved.

## Learning calendar

Visit `/calendar` to browse your learning by month. Each day shows the number of
distinct words answered or revealed and saved active study time. Select a day for
new words explored, words mastered, answer counts and exact time. Repeated answers
to one word count once per day; the monthly total also counts each word only once
across the month. Time-only reading days still count as active days.

The calendar uses the same Europe/London reporting days and midnight-split study
checkpoints as the dashboard, including daylight saving. It includes historical
records and remains available to signed-in accounts after premium membership ends.
It refreshes on focus and every minute while visible. Unsaved study time appears
after the next checkpoint. Month navigation, a month picker and This month make
it easy to move through history; future dates are disabled.

## Word summary and revision sheets

Visit `/words` for your saved progress across the full library. Learning status
is automatic: New (not shown), Learning, Needs practice (unmastered with a wrong
answer or reveal), and Mastered (five correct answers). Retired questions do not
count as mistakes. The Mistaken words and Revealed answers filters also include
historical mistakes on mastered words; Needs practice focuses on unfinished work.
Search matches words and definitions. Revision filters show the words with the
most mistakes/reveals first, with alphabetical ties.

Premium members can export every filtered result as a UTF-8 CSV or open a
print-friendly revision sheet and save it as PDF through the browser. Both export
formats enforce active membership on the server and include meanings, examples,
related words and progress. The screen is paginated; exports include all matching
words. Difficulty levels 1–5 are generated separately from learning progress. They use
70% English frequency rarity (wordfreq 3.1.1) and 30% letter count, with five equal
bands of 146 words. Combine a difficulty level with any progress filter, then
export that selection. These relative difficulty estimates are not exam grades.
See `data/word-levels/README.md` for methodology, source attribution and regeneration.

Auto-next is saved in this browser across navigation and reloads, and synchronises
between tabs. If browser storage is blocked, it is retained for the current session.

## Credits and digital badges

- Each mastery-advancing correct answer earns 2 credits; every third consecutive eligible correct answer adds 5, and a first mastery adds 10. Wrong answers/reveals reset the streak without deducting credits. Streaks persist across sessions and type changes. Demo practice has no redeemable credits.
- Visit /rewards for the badge catalogue, collection and paginated credit history. Badges cost 20, 50 or 100 credits. Parents decide any reward at home; the site supplies only digital badges and dated receipts. Already-earned credits remain redeemable after a membership lapses.
- D1 stores all private records. Migration 0003 adds the tables and transactional triggers. Answer awards, progress and saved answers commit in one batch; redemption debit, history and receipt commit in one statement through triggers. SQL constraints and unique event/request IDs protect retries and concurrent purchases.
- Existing attempts are imported once per user, in batches, through the same award trigger. Re-running the importer is safe. Imported progress without supporting attempts does not fabricate historical awards. Learning history records base, streak and mastery amounts in the award event, with a combined transaction total in the ledger.
- Apply the new migration before starting this version. The local preview has been migrated; hosted databases require the deployment migration step. Keep the full trigger statements intact (including whitespace around CASE/END for the Wrangler SQL splitter).
- The existing salted scrypt password hashes and secure session cookies are retained. Email verification/recovery delivery and hosted authentication CPU benchmarking remain launch-configuration work; this feature does not change authentication providers.

## Checks

```sh
npm test
npm run typecheck
npm run questions:validate
npm run build
# Requires a running local preview and migrated local database; no Stripe keys configured:
npm run test:integration
npm run format
```

Integration tests create a unique temporary local account, insert a local-only membership for protected-route checks, and clean up that account. Never run them against a production site. Core tests cover every word's choices, parser failures, reviewed-CSV hashes, salted passwords, and valid/forged/stale Stripe signatures. Integration checks cover CSRF, cookies, registration, wrong passwords, session revocation, paywalls, concurrent questions, all three question types, trial access and expiry, invalid filters, retired questions, answer replay, five-correct mastery, persistence and revoked access.

A feature-detected WebMCP surface exposes the visible question and answering action. A supported WebMCP browser validation context was not available in this run; these optional tools are not browser-verified. General browser interaction/visual QA was not requested and was not run.

## Deployment

`.openai/hosting.json` identifies the Site and its logical D1 binding. Keep generated migrations in source control. Never edit a migration already applied; add another migration instead. Build output is in `dist/`, ready for the Sites packaging/deployment flow. Hosted account data is separate from local preview data.

## Reference documentation

- [Stripe subscriptions with Checkout](https://docs.stripe.com/payments/checkout/build-subscriptions)
- [Stripe webhook signature verification](https://docs.stripe.com/webhooks/signature)
- [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

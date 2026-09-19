# 11+ Vocabulary Challenge

A web conversion of MineWordsAndroid's definition challenge. Practice now uses Flash Card 1, Flash Card 2 and Blue Book together. There is no game or separate antonym/synonym challenge.

## Word database

Edit the three UTF-8 CSV files in `data/`:

1. `flash_card_1.csv`
2. `flash_card_2.csv`
3. `blue_book.csv`

The server merges these in exactly that order at build time. The first occurrence of each word wins, including its definition, synonyms, antonyms, example and source. Duplicates within a file are also removed. Matching trims surrounding whitespace, normalizes Unicode (NFKC), and ignores case. Source values are `flash_card_1`, `flash_card_2`, or `blue_book`; they remain internal metadata. The UI presents one vocabulary library without source names. Each answered or revealed question shows its definition, example, synonyms and antonyms, including in previous-word review.

Use the header `word,def,syn,ant,example`. Word and def are required; other fields are preserved but do not introduce a synonym/antonym challenge. Quote cells containing commas, double quotes or newlines; escape embedded quotes by doubling them. Standard CSV exports and UTF-8 BOMs are supported. Invalid records fail validation with the source name and record number.

Add rows directly to the appropriate CSV, then run `npm run words:validate`, rebuild and redeploy. No manually maintained merged copy is needed. The old `data/bluebook.txt` is no longer used. Totals update automatically. IDs still use normalized word spelling, so existing mastery is preserved when words occur in a different source or position. Renaming a word creates a new ID. Load order determines merge precedence and word numbering; practice still uses its existing randomized/retry scheduling across the full merged bank.

## Architecture

| Location                              | Responsibility                                           |
| ------------------------------------- | -------------------------------------------------------- |
| `data/*.csv`                          | Ordered source word databases                            |
| `lib/challenge/words.ts`              | CSV parsing, first-wins merge and definition choices     |
| `lib/challenge/types.ts`              | Shared API contracts                                     |
| `lib/server/challenge.ts`             | Question scheduling, scoring, mastery and timing         |
| `lib/server/auth.ts`, `password.ts`   | Server sessions, rate limits and password hashing        |
| `lib/server/billing.ts`, `webhook.ts` | Stripe subscriptions and signature verification          |
| `lib/server/db.ts`, `http.ts`         | Runtime access and request/error handling                |
| `app/api/`                            | Small route handlers enforcing authentication and access |
| `components/minewords/`               | Challenge, account, header and progress UI               |
| `db/schema.ts`, `drizzle/`            | Account/progress schema and versioned migrations         |
| `tests/`                              | Content/security tests and local API integration checks  |

Words use the three CSV files. Accounts, hashed credentials, sessions, answers and subscriptions use D1/SQLite, not the CSV files. This avoids storing sensitive account data in downloadable vocabulary files. The runtime is React + TypeScript + Vinext on a Cloudflare Worker. Retained starter infrastructure and UI primitives remain separate from product modules.

## Development

Requires Node 22.13+ (Node 24 recommended for the test runner) and npm.

```sh
npm run install:ci
# Copy .env.example to .env; never commit .env
npm run db:generate
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_gray_mandrill.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_orange_jocasta.sql
# Apply future migrations once, in filename order.
npm run dev
```

Use the local address printed by the server (normally http://localhost:5173). Local preview data persists under ignored `.wrangler/state`. Run `npm run start` to test the built Worker.

The Windows Sites helper encountered an npm-shim path issue in this environment. The equivalent direct commands work:

```powershell
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run install:ci
node scripts/run-framework.mjs build
```

## Accounts and login credentials

Visit `/account`, choose **Create an account**, and register with your email and a 12–128 character password. Then use those credentials to sign in. There are no shared, default or hard-coded production credentials.

Passwords use salted scrypt (N=16384, r=8, p=5); session tokens are random, stored only as hashes in D1, and sent in HttpOnly/SameSite cookies (Secure on HTTPS). Authentication endpoints are rate-limited, mutations check Origin, sessions expire after seven days, and logout revokes the session. Emails are normalized to lowercase.

This implementation does not yet provide email verification or self-service forgotten-password email delivery. Add an email provider and token-based recovery before a broad customer launch. No test account or test paid entitlement is included in deployment migrations.

## Monthly payments

The monthly price and currency have not been set. The account page displays the actual amount and currency from the configured Stripe recurring Price; it never invents a price. Until all required settings exist, checkout is disabled with a clear message. The five-word sample remains available.

1. In Stripe **test mode**, create a product and a recurring Price with interval `month` and interval count `1`.
2. Configure `APP_ORIGIN`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, and `STRIPE_WEBHOOK_SECRET`. Use `.env` locally and the hosting secret manager for production. Never use `NEXT_PUBLIC_` for secrets.
3. Configure Stripe Customer Portal to let subscribers update payment details and cancel.
4. Point the webhook at `https://YOUR-PUBLIC-ORIGIN/api/stripe/webhook`, subscribing to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`.
5. Locally, use Stripe CLI forwarding to the same route, with its own webhook signing secret.
6. Test successful/declined payments, renewal, cancellation, expiry, replayed webhooks and repeated checkout before switching to live keys.

The return-from-checkout URL does not grant access. Signed webhooks fetch the current subscription from Stripe and synchronize access. Server routes require `active` or `trialing` status, an unexpired billing period and the configured Price ID. Invalid/stale signatures fail. Checkout requests use a durable idempotency key; repeated clicks reuse the same open session. Existing subscriptions direct users to billing management.

**Hosting audience matters:** a private Sites publication is for owner review. Public customers and Stripe cannot reach an owner-only site; launch on a public HTTPS origin and verify webhook reachability before enabling payments. Do not open the audience without the owner's launch decision.

## Practice rules

- Three correct answers master a word; mastered words leave the rotation.
- Missed/revealed words return after 5–20 other questions where enough eligible words remain.
- The current question survives refresh and sign-in; concurrent tabs share one pending question.
- Server-side scoring prevents replayed answers from increasing mastery twice.
- Previous-word review is read-only. Optional auto-next waits briefly after a correct answer.
- Account progress persists across devices. The sample is intentionally temporary.
- Practice time counts visible-question time reported on answer, bounded by elapsed wall time and capped at five minutes per question. Daily totals use UTC. Closing an unanswered question does not commit that question's time.

## Checks

```sh
npm test
npm run typecheck
npm run build
# Requires a running local preview and migrated local database; no Stripe keys configured:
npm run test:integration
npm run format
```

Integration tests create a unique temporary local account, insert a local-only membership for protected-route checks, and clean up that account. Never run them against a production site. Core tests cover every word's choices, parser failures, salted passwords, and valid/forged/stale Stripe signatures. Integration checks cover CSRF, cookies, registration, wrong passwords, session revocation, paywalls, concurrent questions, answer replay, persistence and revoked access.

A feature-detected WebMCP surface exposes the visible question and answering action. A supported WebMCP browser validation context was not available in this run; these optional tools are not browser-verified. General browser interaction/visual QA was not requested and was not run.

## Deployment

`.openai/hosting.json` identifies the Site and its logical D1 binding. Keep generated migrations in source control. Never edit a migration already applied; add another migration instead. Build output is in `dist/`, ready for the Sites packaging/deployment flow. Hosted account data is separate from local preview data.

## Reference documentation

- [Stripe subscriptions with Checkout](https://docs.stripe.com/payments/checkout/build-subscriptions)
- [Stripe webhook signature verification](https://docs.stripe.com/webhooks/signature)
- [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

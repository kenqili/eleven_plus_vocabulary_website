# Child learning experience

Implements the eight improvements from the simulated age-nine/ten usability review. No real children participated in that review or in automated testing.

## Behaviour

- The daily adventure is **20 attempted questions and one completed story**, resetting at midnight in Europe/London. Wrong answers count; reveals do not. Five-, ten- and fifteen-question messages mark progress. Extra practice remains optional.
- A qualifying reread can complete the story part of the daily adventure. It requires fresh active reading time and the comprehension answer. The existing once-per-story ten-credit award remains protected by the database.
- Every vocabulary entry has a child-friendly meaning and an example clue. Story-specific meanings and related words handle different senses, including flowing **current**, official **sanction**, the angle **obtuse**, and donkey-like **asinine**. The fuller dictionary explanation remains available.
- All 847 headwords and phrases have static British-English MP3 pronunciation. The generation voice is Azure Speech `en-GB-SoniaNeural`. Explicit IPA distinguishes adjective **deliberate** and verb **delegate**. Playback is user initiated, one recording at a time, and can be retried after failure.
- “Give me a clue” leaves answer choices available and carries no credit penalty. Clues are checked against all 2,090 questions for exact-answer leakage.
- Account bookmarks save paragraph/relative position and the selected level. They work across screen sizes and devices. Revision checks reject stale writes; an exact retry after a lost response is safe. Guest bookmarks stay in the current browser. Failed saves show a pending message.
- Stories show unread dots, Started labels and completed ticks. Continue reading restores unfinished reading, Start again returns to the beginning, and Next unread adventure stays within the level.
- Question pacing defaults to manual, with five- and ten-second options. Stay here, pronunciation, expanded help and hiding the tab stop automatic advancement. The twentieth question pauses automatic advancement.
- The compact reader retains its active second-by-second clock. Opening lines fit on a 390 × 844 phone without scrolling.
- Badge displays distinguish collected and uncollected badges, repeated collections, available credits and lifetime earned credits. Totals cover the complete account history; detailed receipts are expandable.

## Data and deployment

Apply `drizzle/0005_perpetual_hercules.sql` before serving the updated APIs. This additive migration preserves prior reading/credit history, adds revisioned bookmarks and reading preferences, and backfills daily story finishes from existing completions. Node development applies migrations through its existing startup runner; hosted D1 must receive the new migration through the normal deployment process.

The runtime never needs Azure credentials. They are used only by the explicit audio generation script. Recordings and their manifest live under `public/audio/vocabulary`; deploy these static assets with the app.

```sh
npm run audio:generate
npm run audio:validate
npm run learning:validate
npm run stories:validate
```

Generation resumes from existing files. To correct a pronunciation, update `data/learning/pronunciation-overrides.json`, then regenerate that one file:

```sh
node scripts/generate-pronunciation.mjs --generate --word=delegate --force
```

## Verification

Verified on 25 September 2026: 33 unit tests, both story/child API integration suites, lint, typecheck and the production build passed. Chromium 150 and WebKit 17.4 each passed the full child journey and 35 responsive layout checks (70 total). All 847 audio assets passed format validation and are included in the production output. Learning and story coverage validators passed.

The broader account integration suite also passed after replacing outdated five-word demo and fully blocked post-trial expectations. It verifies the configured free collection, full-library trial access, export access during the trial, export restrictions after expiry/cancellation, saved progress, mastery and calendar history.

Use Node 22.13 or later. Run the normal test, lint, typecheck and build commands. The child API suite uses isolated temporary accounts and deletes them afterwards:

```sh
TEST_NODE_DB=.sites-runtime/node-dev.sqlite npm run test:child:integration
```

`tests/child-experience.browser.mjs` runs the child journeys and five-page layout checks at 320×568, 390×844, 768×1024, 834×1194, 1024×768, 1194×834 and 1440×900. It requires Playwright installed separately; set `PLAYWRIGHT_MODULE` to its module path if it is outside the repository. Set `TEST_CHROME_EXECUTABLE` to use installed Chrome, or `TEST_BROWSER=webkit` to use Playwright WebKit. Set `TEST_NODE_DB` to the local preview database. The default preview is `http://127.0.0.1:5173`; tests reject remote hosts.

Screenshots and media validation output are written to ignored `outputs/child-experience/`.

## Requirement audit

| Requested outcome                                           | Evidence                                                                                                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Child-friendly meanings, clues and British pronunciation    | 847 meanings, 2,324 answer-safe clues and 847 packaged MP3s; browser playback and failure/retry checks                                                                           |
| Daily goal of 20 questions and one story                    | Unit and API tests cover mistakes, reveals, replay, the twentieth attempt and daily reset                                                                                        |
| Comfortable question pacing                                 | Browser journey covers manual, five/ten seconds, Stay here, help/audio pauses and stopping at the daily target                                                                   |
| Reading continuity                                          | Account isolation, revision checks and phone-to-tablet paragraph/level restoration tests; guest storage validation                                                               |
| Engaging stories at six levels                              | 60 local text stories, 10 per level including Level 0, complete vocabulary coverage, 15–30 marked targets; independent simulated editorial reviews in `data/stories/review-*.md` |
| Story definitions, timer, unread status and reading credits | Reader/library implementation, browser checks and story API tests for bounded time, concurrent completion and once-only awards                                                   |
| Clear rewards and progress                                  | Collection totals across pagination, lifetime-earned totals, mastery tests and badge browser checks                                                                              |
| Responsive pages and useful parent information              | Responsive review and browser matrices; About links to `/words` for revision exports                                                                                             |

## Testing limits

Phone/iPad checks use browser emulation, not a physical iPad. This Mac runs macOS 12, so current Playwright WebKit is unsupported. A separately installed Playwright 1.45.3 supplies its compatible WebKit build for additional engine coverage; it is not a substitute for current iPadOS Safari. See the [Playwright release notes](https://playwright.dev/docs/release-notes#version-145).

Audio checks cover asset coverage, MP3 format/duration, pronunciation settings and browser playback/retry. They do not represent a human listening review of every recording.

# Five Letters — plan for a Wordle-style word game

**Status:** implemented; updated 21 October 2026 for the full valid-guess list.
**Date:** 21 October 2026.

This is a plan for a five-letter guessing game that teaches vocabulary. It is
written against the current app, not a generic Wordle clone. The answer-pool
section below is the one that changes the brief, so read it before the rest.

The working name is **Five Letters** and the working route is `/five-letters`.
"Wordle" is a trademark of The New York Times; the mechanic is not protected,
but the name is. The plan uses "Wordle" only to describe the mechanic and
recommends a different name in the product.

---

## 1. The brief, as understood

1. Research how Wordle works.
2. The answer is a word from the vocabulary collection.
3. The answer is marked **mastered** automatically when the child solves the
   round, and each guessed vocabulary word counts **one correctness** on that
   word.
4. Every guessed word shows its definition, example, synonyms and antonyms.
5. The final answer shows the same card.
6. A synonym/antonym hint **deducts points from the 10,000 score**.
7. Guesses outside the vocabulary must still be checked as real words, using a
   free dictionary that is embedded rather than fetched from a third party at
   runtime.
8. Update every reference to the new feature across the app.

The decisions are locked:

- Strict five-letter game; the 194 five-letter bank words are the answer pool.
- The 14,855-word Wordle valid-guess list, minus a small safety blocklist, is
  the accepted-guess list. Words outside the vocabulary are accepted but have
  no dictionary card and do not count correctness.
- A hint deducts **5 points** from the 10,000 score, not a guess.
- The answer masters on a solve.
- Every guess of a vocabulary word counts one correctness on that word.
- **Five correctness counts master the guessed word**, whether the counts came
  from practice or from guesses. The word retires and is added to the mastered
  total once.
- Guests play a demo with no saved progress and no account-score penalty.

---

## 2. The answer-pool problem (read this first)

The bank has **2,247 distinct words**, not 2,400. Their lengths are:

| Length | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Words | 15 | 111 | **194** | 359 | 392 | 354 | 355 | 243 | 120 | 56 | 32 | 10 | 4 | 2 |

**Only 194 words are exactly five letters.** A true Wordle board is five
columns, so a strict Wordle can only use those 194 answers. All 194 have a
definition and an example; 192 have a synonym, 188 have an antonym, and 188 have
both. All 194 are present in the 14,855-word Wordle valid-guess list.

The three options:

| Option | Answers | What it is | Verdict |
|---|---|---|---|
| **A. Strict five letters** | 194 | A real Wordle: 5×6 board, five-letter guesses | **Recommended** |
| B. Variable-length board | 2,247 | The board has as many columns as the answer (3–16); guesses must match that length | Not Wordle, and a 16-column board is unusable on a phone |
| C. Five-letter answers from a larger list | 2,309+ | Real Wordle pool, but not "from the vocabulary" | Breaks the brief |

Option A is recommended. 194 answers is about six months of one daily puzzle, or
two weeks at fifteen rounds a day. The game can avoid immediate repeats and
prefer unmastered words; a full 194-word cycle is a later refinement.

If the intent is to use **all** 2,247 words, the right feature is a different
game (for example, "guess the word from its definition"), not a five-column
Wordle. That can be a later mode; it is not this plan.

---

## 3. How Wordle works

The rules worth reproducing:

- The answer is a five-letter word. The player has **six guesses**.
- Every guess must also be a five-letter word from an accepted-guess list.
- After a guess, each tile is marked:
  - **Green**: the letter is in the answer and in the same position.
  - **Yellow**: the letter is in the answer but in a different position.
  - **Grey**: the letter does not occur in the answer, or occurs fewer times
    than it was guessed.
- Duplicate letters are handled in two passes. Mark the greens first, then walk
  the remaining guess letters left to right and mark a yellow only while an
  unmatched copy of that letter remains in the answer. This is why guessing
  `BBBBB` against `ABBEY` produces two greens and three greys, not five greens:
  the answer only has two Bs.
- The on-screen keyboard keeps the **best** state seen for each letter:
  green beats yellow, yellow beats grey.
- The original game gives everyone the same word each day, has a share grid, a
  streak and a hard mode. **None of those are required here.** A daily lock
  would reduce vocabulary exposure in a learning app, and a share grid is a
  social feature this app does not have.
- Hard mode (revealed greens must stay, revealed yellows must be reused) is not
  in v1.

Sources are at the end.

---

## 4. Product rules

### 4.1 Round

- One five-letter answer, six guesses, standard green/yellow/grey feedback.
- Unlimited rounds; "Play another" starts a fresh answer. No daily lock in v1.
  A daily seeded puzzle can be added later without changing the game.
- The answer is a word from the child's collection: the 194 five-letter bank
  words filtered by the same entitlement and exclusions as practice. The
  selection prefers words the child has **met but not mastered**, then unmastered
  words, then mastered words for revision. The last 20 answers the child has
  played are excluded until the pool is exhausted, so it does not repeat.
- The answer is never sent to the browser while the round is in progress.
  The server grades guesses and returns the tiles. The answer is returned only
  when the round is solved or revealed.
- A round ends when the child solves the word, runs out of guesses, or presses
  "Give up".

### 4.2 Every vocabulary guess shows a card

Each accepted guess that is one of the carded words gets a word card with:

- the word and, in the bank, its pronunciation control;
- the definition (the child-facing `help` line where there is one);
- an example sentence;
- synonyms and antonyms, split from the bank's semicolon-separated strings;
- the source: "MineWords" or "WordNet 3.0"; the fallback note says "Game
  list".

A valid guess outside the card set still shows its word and marks, but the card
is a short fallback note: it is a valid game word, not a vocabulary word.

On desktop, the board is on the left and a card panel on the right shows the
latest guess; clicking an older row shows that row's card. On mobile, the latest
card sits under the board and past rows are tappable. This keeps six cards from
turning the page into a wall of text while still giving every guess its card.

The final answer uses the same card, with a "Solved" or "The answer was" banner.
The answer is one of the 194 bank words, so its card is always complete; no
dictionary lookup is needed for it.

### 4.3 What a guess and a solve do

**A solve masters the answer.** The answer is one of the 194 bank words, so its
mastered flag is set once, with no credits and no streak (the same economics as
"I know this"). The child sees a "Mastered" badge on the answer card.

**Every guessed vocabulary word counts one correctness.** If the guessed word is
one of the 194 bank words in the child's allowed, non-excluded collection, the
game increments that word's `progress.correct` by one, capped at
`CUMULATIVE_FLOOR` (5), and sets `last_seen` to the reporting day. The winning
guess counts too. This is the counter the word summary, the placement score and
the cumulative mastery route already read.

Two consequences that matter:

- **Five counts master a guessed word.** The app's existing rule is that five
  cumulative correct answers retire a word whatever the timing was. A word
  guessed five times across rounds therefore becomes mastered; the game sets the
  mastered flag and adds one to `daily_stats.mastered` at that point, once,
  guarded exactly like the answer's solve. This is the chosen behaviour: five
  correctness counts on a word, whether they came from practice or from guesses,
  master it. The answer's solve still masters the answer immediately, without
  waiting for five counts.
- **The correctness count moves the 10,000 score.** The score credits up to
  `COUNTED_CORRECT` (2) correct answers per word, so the first two guesses of a
  vocabulary word can raise the displayed score by roughly two points each. The
  later counts advance mastery but not the score. This is the existing placement
  formula; the game does not invent a second score.

**A guessed word outside the bank gets a card, not a count.** The 2,129
accepted words that are not in the 2,247-word vocabulary have no `progress` row
and no place in the collection, so guessing them shows their definition but
changes nothing. The same applies to a bank word that is excluded by the parent
or outside the child's entitlement: the card is shown, the count is not.

**A reveal or running out of guesses does not master the answer.** The answer
card is shown, the guesses already made have already counted their correctness,
and the answer can still be practised normally.

No answer, guess, or hint changes `daily_stats.correct`, `attempts`,
`learning_events`, credits, or the streak. The only daily total that moves is
`daily_stats.mastered`, when the answer is solved or a guessed word reaches five
counts.

### 4.4 Hints

The hint is a synonym or antonym **of the answer**, taken from the answer's
curated bank entry. It never reveals the answer itself; if the selected relation
equals the answer, it is skipped. Six answers have no antonym, two have no
synonym; the unavailable button is hidden and the other is offered. If neither
exists, hints are hidden for that round.

**Penalty: a hint deducts `HINT_SCORE_PENALTY` points from the 10,000 score.** The
amount is **5 points per hint**. It does not spend one of the six guesses; the
guess board is unchanged. One synonym hint and one antonym hint per round, so
the maximum is 10 points in a round.

The deduction is permanent and stored on the account, not per round. It is
applied to the **displayed** score:

```text
score = max(0, levelScore(level, correctCredit(...)) - score_penalty)
```

The level is not demoted by a hint; only the displayed score moves. The penalty
is the first thing in the app that can make the score go backward, and it is a
deliberate exception to the old "the score never runs backward" rule, which was
about wrong answers. A wrong answer still deducts nothing; a hint is a choice.
If the score reaches 0, the penalty still accrues and future practice gains pay
it back before the displayed score rises.

The guest demo has no account score, so its hints are free; the signed-in game
is where the deduction applies. No credits, no streak, no daily_stats row and no
level change are involved.

The amount is a constant in one place so it can be tuned without touching the
game logic. The amount is **5 points per hint**.

### 4.5 The dictionary

Two different problems are often conflated:

1. **Is this a real word?** This is a membership test. It should be a bundled
   word list, not a dictionary call. It must be instant, deterministic and
   offline.
2. **What does it mean?** This is a dictionary lookup. It can be a bundled data
   file for the accepted words.

The plan separates them:

- **Accepted guesses** are the 14,855-word Wordle valid-guess list, minus a
  small safety blocklist: **14,818 accepted five-letter words** in
  `data/five-letters/accepted.json`. Every one of the 194 answers is accepted.
  This accepts common words the curated answer list omitted (`bones`, `greek`,
  `years`, `games`) as well as the obscure tail.
- **Dictionary cards** are a smaller bundled set: the 2,315 common Wordle answer
  words plus the 8 bank answers that are not in it (`atlas`, `doyen`, `jaded`,
  `matte`, `muted`, `odour`, `pious`, `sated`), for **2,323 carded words**. The
  194 bank answers have curated cards; the rest use WordNet. A valid guess
  outside that set is accepted but shows a short fallback note and does not
  count correctness. Keeping cards to the common list keeps the dictionary small
  while the game accepts the full Wordle guess list.
- **Rejected guesses** get a friendly "that word is not in this game's list"
  message, not "that is not a word". The child keeps the guess; no row is spent.
  The list is a game dictionary, not a claim about the English language.
- **Vocabulary words** (the 2,247-word bank) get their cards from the
  **embedded dictionary**, described in section 5. A valid guess outside the
  vocabulary uses the fallback note instead.

### 4.6 Guests and free accounts

- **Signed out**: a client-side demo using the free bank. The free bank is
  currently 224 words, of which 20 are five letters. No progress is saved; the
  end card invites the visitor to sign in.
- **Trial / full access**: all 194 answers, mastery saved.
- **Post-trial free account**: the practice entitlement is 20 words
  (`FREE_WORD_LIMIT`), and only a few of those are five letters. Using only the
  practice entitlement would leave the game with a near-empty pool. The plan
  recommends using the same 20 five-letter words from the free demo bank as the
  free game sample, and saving mastery only for words in the child's practice
  set. The alternative is to make Five Letters a trial/full-access feature with
  the demo for everyone else. **This is a product decision, not a technical
  one.**

---

## 5. The embedded dictionary

### 5.1 Why not a runtime API

`docs/HOSTING.md` states the architecture plainly: "Nothing third-party at
runtime: no analytics, no font CDN, no error reporter. The Content-Security-Policy
in `proxy.ts` allows no absolute origin." A dictionary API call at runtime would
be the first exception to that rule, and a client-side call would need the CSP
opened. For a children's app it also sends every guess to a third party and
makes the game fail when that third party is slow or down.

The brief already says "embed", so the plan embeds.

### 5.2 The source

| Source | Licence / cost | Runtime? | Examples | Verdict |
|---|---|---|---|---|
| **WordNet 3.0** (Princeton) | Permissive; commercial use allowed with the copyright notice | No; offline data | Partial (gloss examples) | **Recommended** |
| Wiktionary via `freedictionaryapi.com` | CC BY-SA 4.0; attribution and share-alike on the data | Yes, unless fetched at build time | Rich | Build-time supplement only |
| `dictionaryapi.dev` | No key; 450-request limit, window not documented; data provenance/licence unclear | Yes | Some | **No** for a commercial site |
| Datamuse | 100,000/day, free for non-commercial use; commercial use needs an arrangement | Yes | Some | No |
| Merriam-Webster | Key; 1,000/day non-commercial | Yes | Some | No |
| Wiktionary REST | CC BY-SA 4.0 | Yes or build time | Rich but wiki-formatted | Build-time only |

**Recommended: a generated WordNet 3.0 subset.** WordNet is explicitly free for
commercial use under its licence (the Princeton copyright notice must be
included). A build script reads the WordNet database once and emits a JSON file
for the **2,323 carded words**:

```json
{
  "crane": {
    "definition": "Any bird of the family Gruidae, large birds with long legs ...",
    "example": "Aquatic birds of various kinds are very numerous ...",
    "synonyms": ["Grus"],
    "antonyms": [],
    "source": "WordNet 3.0"
  }
}
```

The 194 bank words are copied from the curated bank (definition, example,
synonyms, antonyms, source "MineWords"); the other ~2,129 carded words come from
WordNet. The signed-in server can still read the bank directly for the 194, but
the generated file is the single card source for the guest. At roughly 400–600
KB raw and 150–200 KB gzipped, it is small enough to lazy-load on the game page
and small enough to import on the server. If the Worker bundle grows too much,
the same file can be served as a static asset and read by the Worker; the data
is public, so there is no secret. A valid guess outside the card set uses a
short fallback note.

**Build gate.** The generator fails the build unless:

- every accepted guess and every carded word is five lower-case letters;
- every one of the 194 answers is in the accepted list and the card list;
- every carded word has a non-empty definition, either copied from the bank or
  taken from WordNet;
- every carded word has a source ("MineWords" or "WordNet 3.0");
- the accepted list is the valid-guess list minus the blocklist plus the bank's
  five-letter words;
- no blocklisted word is in the accepted list.

Any gap is fixed by adding a manual gloss for that word (a one-line entry) or
removing it from the card list. It is not fixed by shipping a card with no
definition. This is a finite, reviewable list.

**Examples.** WordNet's glosses contain usage examples for many senses but not
all. The card shows an example when the source has one and omits the row
otherwise. The bank's 194 answers all have examples. If every carded word must
have an example, add a one-time Wiktionary fetch for the gaps with the CC BY-SA
attribution; that is a follow-up, not a blocker.

**Attribution.** Add `THIRD_PARTY_NOTICES.md` (or a section in the existing
docs) with the WordNet 3.0 copyright and licence, and a footer line on the game:
"Definitions from WordNet 3.0, Princeton University." The game's own bank cards
say "MineWords". If a build-time Wiktionary supplement is used, its CC BY-SA 4.0
attribution and source links go there too.

**Safety.** The full Wordle valid-guess list is filtered through a
profanity/slur blocklist at build time, and flagged words are removed from the
accepted list. The dictionary generator keeps the first one or two senses only
and strips markup. The answer pool is curated; the guess pool is filtered; no
dictionary card is shown for a rejected word. A valid guess outside the card set
shows the fallback note instead.

---

## 6. Progress, credits and stats

### 6.1 The answer on a solve

A solve calls a new server helper, `markWordMastered(userId, wordId, day)`. In
one D1 batch it:

1. Ensures the word's `progress` row exists (the same `ENSURE_PROGRESS` the
   practice path uses).
2. Sets `mastered = 1` **only if** the word is not already mastered by flag or
   by `correct >= CUMULATIVE_FLOOR`, and there is no mastered learning event for
   it. The guard is the same one the flush uses, so a word mastered by an answer
   or by "I know this" is never counted twice.
3. Adds one to `daily_stats.mastered` on the reporting day, only when step 2
   changed a row. This is the same counter the calendar and the panel read.
4. Leaves the existing counters untouched: `correct`, `run`, `recalls`, `seen`,
   `attemptCount`, credits, streak, `attempts`, `learning_events`, and
   `study_ticks` do not move. When the row is created, `last_seen` is set to the
   reporting day; an existing row's practice state remains authoritative.

No credits and no streak: a solve is mastery evidence, not a correct answer.
The daily mission's question count and the calendar's questions/correct/study
time do not move. The calendar's "words mastered" does move, which is correct:
the word was mastered that day.

### 6.2 The guessed word's correctness

Every accepted guess that is one of the 194 bank words **in the child's allowed,
non-excluded collection** counts one correctness on that word. The winning guess
counts too. The write is a small batch per guess:

```sql
-- Runs before the update, and only when this count will finish the word.
INSERT INTO daily_stats (user_id, day, mastered)
SELECT ?, ?, 1
WHERE EXISTS (
  SELECT 1 FROM progress p
  WHERE p.user_id = ? AND p.word_id = ?
    AND p.mastered = 0 AND p.correct >= 4
    AND NOT EXISTS (
      SELECT 1 FROM learning_events e
      WHERE e.user_id = p.user_id AND e.word_id = p.word_id
        AND e.mastered = 1
    )
)
ON CONFLICT (user_id, day) DO UPDATE SET mastered = mastered + 1;

UPDATE progress
SET correct = MIN(5, correct + 1),
    mastered = CASE WHEN correct >= 4 THEN 1 ELSE mastered END,
    last_seen = ?
WHERE user_id = ? AND word_id = ?;
```

- `CUMULATIVE_FLOOR` is 5, so `correct = 4` is the count that finishes the word.
  The insert is guarded on the **pre-update** row, which is why it runs first.
- The update caps `correct` at 5, matching the rest of the app. It sets
  `last_seen` to the reporting day, because the child has just seen the word.
- It does not touch `run`, `recalls`, `seen`, `retry_at`, `attempts`,
  `learning_events`, credits, streak, `daily_stats.correct` or study time. The
  word's `correct` count is the only counter that moves (plus `last_seen`).
- If the word is already mastered, or an answer already produced a mastered
  learning event, the insert does not count it again; the update still applies
  the cap and leaves the flag at 1.
- If the guessed word is outside the bank, excluded, or outside the child's
  entitlement, there is no progress row and no count. The card still appears.

**The winning guess.** The answer's mastery is written first, so the guessed
word's `mastered` flag is already 1 when the correctness update runs. The
correctness insert therefore skips, and the answer is counted once. The winning
guess still gets its one `correct` count, so the answer's placement credit is
consistent with every other guessed word.

**The consequence.** A word guessed five times across rounds reaches
`CUMULATIVE_FLOOR`, becomes mastered, retires from practice, and is added to
`daily_stats.mastered` once. That is the chosen behaviour: five correctness
counts on a word, whether they came from practice or from guesses, master it.

The correctness count also feeds the existing 10,000 score: `correctCredit` counts
up to `COUNTED_CORRECT` (2) correct answers per word, so the first two counts on
a word can raise the score by roughly two points each. That is the app's existing
formula, not a new score. The third, fourth and fifth counts advance mastery but
not the score.

### 6.3 A stale practice tab must not undo it

The Five Letters game is a second writer of `correct`, `mastered` and `last_seen`. An open
practice tab holds a snapshot from before the guess; its next flush sends the
old values and, with the current unconditional `UPDATE`, would undo the game's
count and mastery and leave `daily_stats.mastered` inconsistent.

Fix: make the three cumulative fields monotonic in the flush's state write:

```sql
correct  = MAX(correct, ?),
mastered = MAX(mastered, ?),
last_seen = MAX(last_seen, ?)
```

`correct` only ever rises in the practice engine (`advanceMastery` caps it at 5),
mastery is never revoked, and `last_seen` is an ISO day string that moves
forward. Nothing in the app needs to lower any of them, so `MAX` is the true
rule. The daily_stats insert in the flush already runs before the update and
reads the row as it stands, so a retried or stale flush still cannot double
count. Add a test: increment `correct` and set `mastered` in one session, flush a
stale state from another, and assert `correct` stays, the flag stays 1, and
`daily_stats.mastered` moves once. The run and recall counters are not made
monotonic: those legitimately reset, and the game does not write them.

### 6.4 The hint score penalty

The hint deduction is account-level, not a per-round score. It is stored in a
new `users.score_penalty` column (integer, default 0; the same migration as the
game table). A hint adds `HINT_SCORE_PENALTY` to it in the same batch that
records the hint kind:

```sql
UPDATE word_games
SET hints = ?, updated_at = ?
WHERE id = ? AND user_id = ? AND instr(hints, ?) = 0;

UPDATE users
SET score_penalty = score_penalty + ?
WHERE id = ? AND changes() > 0;
```

The `changes() > 0` guard makes a retried hint request idempotent: the second
statement only runs when the first actually appended the kind. The same guard
enforces one synonym and one antonym per game. If the stored hints are a JSON
array, `instr` checks for the quoted kind; a comma-separated `syn,ant` string is
simpler and works the same way.

The displayed score is adjusted in every place that renders the 10,000 score:

- `lib/server/placement.ts` and the `placementOf` path in
  `lib/server/challenge.ts`: subtract the penalty before returning `score`.
- `lib/server/snapshot.ts` / `lib/challenge/types.ts`: include `scorePenalty` in
  the snapshot the practice client loads.
- `lib/client/session.ts` `placement()`: subtract the snapshot penalty from the
  engine's derived score.
- `app/api/placement/route.ts`: return the adjusted score.
- The Five Letters page shows the account score and the `−5` on each hint, fetched
  from the placement endpoint or returned by the hint action.

The subtraction is `Math.max(0, score - penalty)`. The level is computed from
mastery, not the score, so a hint never demotes the child. The penalty does not
touch `daily_stats`, credits, badges or the streak. It is permanent; there is no
reset in v1. The guest demo has no account score and no penalty.

The amount is the constant **`HINT_SCORE_PENALTY = 5`**.

### 6.5 "Words you have met"

For a full-access account, `statsFor` sets `meetCount` from
`daily_stats.new_words`, which counts first learning events. A game-only word
has no event, so a solve can make `mastered` larger than `meetCount`, and the
panel's "X of the Y words you have met" can read "1 of 0" on a fresh account.

Fix: count `progress` rows for `meetCount` on full access too, as the free-tier
branch already does:

```sql
SELECT COUNT(*) FROM progress WHERE user_id = ?
```

This is one aggregate in the existing `summaryReads` batch (no row transfer, and
the table is at most a few thousand rows). It makes the denominator mean "words
whose row exists", which now includes game solves and guesses, and is what the
copy says. Update the stats tests to cover a full-access user with a game-created
row.

The alternative — only auto-master words the child has already met — avoids the
change but weakens the feature. It is the fallback if the stats change is
unwelcome.

### 6.6 What does not change

- No credits, no streak, no eligible-answer count, no attempt rows, no
  `daily_stats.correct` and no study time from the game.
- No new badge is required; existing mastery badges may count it if they read
  `daily_stats.mastered`, which is intended.
- The "I know this" flow and its K shortcut are untouched.
- The quiz ordering, mastery arithmetic, level promotion and demotion are
  untouched.
- The 10,000 score loses points only through a hint; the level never falls
  because of one.

---

## 7. Architecture

### 7.1 Routes and files

| Path | Purpose |
|---|---|
| `app/five-letters/page.tsx` | Server component: metadata, noindex, renders the client game |
| `components/minewords/five-letters.tsx` | Client game: board, keyboard, cards, hint buttons |
| `components/minewords/word-card.tsx` | Shared card for a bank word or a dictionary entry |
| `app/api/five-letters/route.ts` | `GET` active game; `POST` start/guess/hint/reveal |
| `lib/challenge/five-letters.ts` | Pure game logic: answer pool, accepted set, grading, hint choice, card mapping, `HINT_SCORE_PENALTY` |
| `lib/server/five-letters.ts` | Game persistence, entitlement/exclusions, answer selection, answer mastery, guessed-word correctness, hint penalty |
| `lib/server/mastery.ts` | `markWordMastered` (or a function in an existing server module) |
| `lib/server/flush.ts` | Monotonic `correct`, `mastered` and `last_seen` writes (section 6.3) |
| `lib/server/challenge.ts` | `placementOf` subtracts the score penalty; `statsFor` uses the progress-row `meetCount` |
| `lib/server/rewards.ts` | `summaryReads` / `buildSummary` for the progress-row `meetCount` |
| `lib/server/placement.ts` | Subtracts `users.score_penalty` from the returned score |
| `lib/server/snapshot.ts` | Carries `scorePenalty` in the practice snapshot |
| `lib/client/session.ts` | Subtracts the snapshot penalty in `placement()` |
| `app/api/placement/route.ts` | Returns the adjusted score |
| `data/five-letters/dictionary.json` | Generated cards for the 2,323 carded words (bank words copied, the rest WordNet); published as `/five-letters/dictionary.json` |
| `scripts/build-five-letters-dictionary.mjs` | Generator and build gate |
| `drizzle/0006_word_games.sql` | `word_games` table, indexes, and `users.score_penalty` |
| `db/schema.ts` | Drizzle definition for `word_games` and `users.scorePenalty` |
| `drizzle/meta/_journal.json` | Migration entry |
| `tests/five-letters.test.mjs` | Pure grading, validation, hints, answer selection |
| `tests/five-letters.integration.mjs` | API, persistence, mastery, idempotency |
| `tests/five-letters.browser.mjs` or extend `tests/child-experience.browser.mjs` | Keyboard, mobile, solved/revealed, guest |

The client game is one component, but the game logic is a pure module so it can
be tested without a browser. The component is a thin layer over it and the API.

### 7.2 The game table

```sql
CREATE TABLE word_games (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_id TEXT NOT NULL,
  guesses TEXT NOT NULL DEFAULT '[]', -- [{ word, marks: ["green", ...] }]
  hints TEXT NOT NULL DEFAULT '[]',   -- ["syn", "ant"]
  status TEXT NOT NULL DEFAULT 'playing', -- playing | solved | revealed
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX word_games_one_active
  ON word_games(user_id) WHERE status = 'playing';
CREATE INDEX word_games_recent
  ON word_games(user_id, created_at DESC);

ALTER TABLE users ADD COLUMN score_penalty INTEGER NOT NULL DEFAULT 0;
```

- One active game per user; the unique index prevents two tabs starting two
  games, and the API returns the active one.
- Finished rows are kept as history. They are small, they make "no repeat in the
  last 20" possible, and they are useful when debugging. No user-facing history
  in v1.
- `word_id` is a bank id, not a foreign key: the bank lives in code and has no
  `words` table.
- `hints` is a comma-separated kind list (`"syn,ant"`) rather than JSON so the
  idempotency guard can use `instr(hints, 'syn') = 0` directly in SQL.
- `users.score_penalty` is the permanent hint deduction. It is an integer
  defaulting to 0, so every existing account starts with a full score.
- Every table cascades from `users`, so account deletion needs no extra code.
- Migration `0006` has no backfill. It is applied by the existing deploy before
  the Worker, never with `wrangler d1 execute --file`, per the repository rule.

### 7.3 API

`GET /api/five-letters`

- Signed-in only. Returns the active game (with guesses and hint kinds, never
  the answer) or `null`. A `401` puts the page into the guest demo, which makes
  no API calls and uses the free bank plus the dictionary asset.

`POST /api/five-letters`

```json
{ "action": "start" }
{ "action": "guess", "gameId": "...", "guess": "crane" }
{ "action": "hint", "gameId": "...", "kind": "syn" }
{ "action": "reveal", "gameId": "..." }
```

- `start`: resume the active game or create one. Returns the game, guesses,
  hints, remaining attempts, remaining hint kinds, the card for each guessed
  word, and the account `score` / `scorePenalty`. No answer.
- `guess`: validate five letters and membership in the accepted set; reject
  duplicates; grade; append. If the guess is a bank word in the child's allowed,
  non-excluded collection, add one correctness to it (section 6.2) and report
  `counted: true` and the new count. If that count masters a guessed word,
  report it on the guess card. If solved, call `markWordMastered` **before** the
  correctness update, return the answer card + `newlyMastered`; if no attempts
  remain, mark revealed and return the answer card. The answer never appears in
  a response while `playing`.
- `hint`: enforce one of each kind; it does **not** consume a guess. Append the
  kind and add `HINT_SCORE_PENALTY` to `users.score_penalty` in the same batch,
  guarded by `changes() > 0` so a retry or a second identical hint is free.
  Return the relation, `remainingHints`, the new `scorePenalty`, and the
  adjusted `score`. A hint never reveals the answer and never ends the round.
- `reveal`: mark revealed; return the answer card. No mastery.
- All actions are same-origin, authenticated by the session cookie, and
  rate-limited (e.g. 120 requests/hour/user). A duplicate or retried guess
  returns the existing state; it does not append twice and does not pay twice.
  A retried hint does not deduct twice.
- Errors are `400` for bad input, `409` for an invalid/duplicate guess, `404`
  for a game that is not the user's, `403` for no eligible words.

The guest demo is client-side and uses the free bank plus the dictionary asset;
it has no API calls, no saved progress, and **no score penalty** (there is no
account score to deduct from). The signed-in API returns cards so the client does
not need the whole dictionary.

### 7.4 Answer selection

`eligible = ANSWERS.filter(word => allowedIds.has(word.id) && !excluded.has(word.id))`

- If the child has an active game, resume it.
- Otherwise, remove the last 20 `word_id`s this user played. If that empties the
  pool, use the full pool.
- Split into `met but not mastered`, `not mastered` (whether met or not), and
  `mastered` using `hasMastered` and the progress rows for the eligible ids.
  Pick at random from the first non-empty group.
- `ANSWERS` is the 194 bank words of length 5, precomputed once in the pure
  module. The bank is already loaded server-side; no extra data file.
- Guests use the 20 five-letter words from the free bank, loaded from the
  manifest, with the same last-20 exclusion held in memory.

### 7.5 Grading

`gradeGuess(answer, guess)` is a pure function returning an array of
`"green" | "yellow" | "grey"`:

1. Mark greens and count the unmatched answer letters.
2. Walk the remaining positions; mark yellow while the count for that letter is
   positive, otherwise grey.

Test cases: exact answer, no shared letters, all yellows (a rotation), repeated
letters where the guess has more copies than the answer, repeated letters where
the answer has more copies than the guess, and the `ABBEY`/`BABES` case.

### 7.6 Dictionary asset

The generated file is keyed by word and covers the 2,323 carded words, including
the 194 bank words (copied from the curated bank). The signed-in API can read
the bank directly for those and the file for the rest; the guest bundle fetches
the same content lazily from `/five-letters/dictionary.json`. The generator
writes `data/five-letters/dictionary.json`, and the build copies it to
`public/five-letters/dictionary.json`; a check asserts the published copy
matches the source. The build gate described in section 5 runs in the normal
check chain (or as a dedicated `npm run words:five:check`), so a bank change that
adds a five-letter answer without a dictionary entry fails before deploy.

The 194 cards use `lib/challenge/bank.ts` as their source (definition, example,
synonyms, antonyms and the child-facing `help` line), so the game shows the same
curated content as the practice explanations. Carded words outside the bank use
WordNet. A valid guess outside the card set gets the fallback note and never
needs a dictionary entry.

---

## 8. UI and accessibility

- **Name:** Five Letters, route `/five-letters`. Do not use "Wordle" in the
  product or the marketing copy.
- **Layout:** 5×6 board, on-screen QWERTY, six attempt pips, hint buttons, card
  panel, and a small account-score strip. Desktop: board left, card right.
  Mobile: board, keyboard, card below; the latest card open, past rows tappable.
- **Entry:** physical keyboard (letters, Enter, Backspace) and on-screen keys.
  Only letters; one row at a time. A guess that is not accepted shakes once and
  does not spend a row. A duplicate guess says "Already guessed" and does not
  spend a row.
- **States:** empty, typing, checking, invalid, already guessed, solved,
  revealed, no attempts left. "Checking" is brief; the server round trip is the
  only wait.
- **Tiles:** green/yellow/grey plus an accessible label ("C, correct position",
  "R, in the word, wrong position", "A, not in the word") and a legend. Do not
  rely on colour alone: the tiles also carry a small shape/pattern (for example,
  a solid bar for green, a dotted bar for yellow, a cross for grey) or an
  underline. The exact visual is a design choice; the accessible label is not.
- **Keyboard state:** best state per letter, as in Wordle.
- **Answer card:** the answer, definition, example, synonyms, antonyms, source,
  and "Mastered" if the solve set the flag. If already mastered before the
  round, say "Already known" rather than claiming a new award.
- **Guess cards:** a vocabulary guess gets its card; a valid guess outside the
  card set gets the fallback note. If the guess's one correctness count reaches
  the cumulative floor, the card carries "Mastered" and the panel copy explains
  that five correct counts retire a word. A guess outside the bank, or outside
  the child's collection, carries no count and says "Not in your word list"
  rather than implying progress.
- **Hints:** "Synonym hint — −5 score" and "Antonym hint — −5 score";
  disabled with a reason when unavailable or already used. They do not spend a
  guess and do not end the round. The amount comes from `HINT_SCORE_PENALTY`, so
  the copy cannot drift from the server. The score strip shows the account score
  and the deduction; at 0 the strip stays 0 and the stored penalty is paid back
  by future practice. Guests see "Hints are free in the demo" and no score
  strip.
- **Accessibility:** `aria-live="polite"` for the guess result, hint and score
  change; focus moves to the new card or the next row after submit; buttons have
  44px targets; the board is usable at 320px; `prefers-reduced-motion` disables
  the flip and shake; no time limit.
- **Colour and theme:** use the existing CSS variables for light/dark; add
  `.five-*` classes in `app/globals.css`, not inline colours.
- **Copy:** keep it short and child-facing. "Guess the five-letter word in six
  tries. Every guess teaches you a word." Explain once, near the buttons, that
  "A hint costs 5 score, not a guess" and "Five correct guesses of the same
  word make it known." The score strip says "Score — hints deduct from this".

---

## 9. References to update (the "all references" checklist)

New routes or nav entries must be classified for robots, or
`tests/seo.test.mjs` fails. The recommendation is **noindex**, like practice,
stories and the account pages: this is a child's activity, not a marketing
page.

- `components/minewords/header.tsx` — add `{ href: "/five-letters", label:
  "Five Letters" }` to `FOR_CHILDREN`. Update the "Four things a child came
  for" comment. Check the header at 320px and the existing header test.
- `components/minewords/landing.tsx` — add a feature card/section and a CTA.
  Do not change the "tested five ways" claim; the game is an extra, not a sixth
  question type. Link to `/five-letters`.
- `app/how-to/page.tsx` — add a "Five Letters" section: six guesses, every guess
  shows its card, each guessed vocabulary word counts one correctness, five
  counts mark it known, hints deduct 5 score (not a guess), a solve marks the
  answer as known (no credits), a reveal does not.
- `components/minewords/challenge.tsx` — a small "Want a game? Five Letters"
  link in the practice help/footer or end-of-round panel, if it fits the
  existing layout. Do not add another persistent header link.
- `components/minewords/level-progress.tsx` — it reads the score from
  `use-challenge`, so it needs no arithmetic change; check that a hint used in
  another tab shows the reduced score on the next snapshot and that the level
  badge does not move.
- `lib/server/placement.ts`, `lib/server/challenge.ts`, `lib/server/snapshot.ts`,
  `lib/client/session.ts`, `app/api/placement/route.ts` — the score penalty
  plumbing (section 6.4). Any other reader of `levelScore` must subtract the
  penalty or it will disagree with the practice page.
- `components/minewords/progress-panel.tsx` — no copy change if `meetCount`
  is fixed; check that "words you know" reads correctly after a game-only
  solve. If the denominator change is rejected, add a note.
- `app/account/page.tsx` / `components/minewords/account.tsx` — mention the
  game as a mastery source and that hints deduct from the score, if mastery or
  scoring sources are listed there.
- `app/words/page.tsx` / `components/minewords/word-summary.tsx` — optional
  "Play Five Letters" link on the word list page; helpful but not required.
- `app/stories/page.tsx` — optional cross-link from the other child activity.
- `app/calendar/page.tsx` / `components/minewords/learning-calendar.tsx` — if
  the calendar has a legend for "words mastered", add the game as a source; the
  daily_stats change already makes the number appear.
- `app/rewards/page.tsx` / `components/minewords/rewards.tsx` — if the page
  lists how credits are earned, add "Five Letters earns mastery, not credits."
- `app/sitemap.ts`, `lib/seo.ts`, `next.config.ts`, `tests/seo.test.mjs` — add
  `/five-letters` to the noindex `source:` regex in `next.config.ts` and to the
  tests' refused list. Do not add it to `INDEXABLE_PAGES` or the sitemap. If the
  page should be indexable as marketing, do the opposite consistently: add it to
  `INDEXABLE_PAGES` and `PAGE_METADATA`, add it to the sitemap, remove it from
  the noindex regex, and update the test; do not leave both.
- `README.md` — line 3 currently says "There is no game or separate legacy
  500-question challenge." That becomes false. Add Five Letters to the feature
  list, describe the 194-answer pool, the no-credits rule, the correctness count,
  the score deduction for hints, and the embedded dictionary. Add the test
  commands.
- `docs/DEPLOY.md` / `docs/HOSTING.md` — only if the dictionary asset changes
  the bundle/deploy notes; the no-third-party-runtime statement stays true.
- `app/globals.css` — board, tiles, keyboard, cards, hints, score strip,
  responsive rules, reduced motion.
- `tests/header.test.mjs`, `tests/landing-page.test.mjs`,
  `tests/child-experience.test.mjs`, `tests/child-experience.browser.mjs` —
  extend the navigation/journey checks; do not assert a link count without
  updating it.
- `tests/stats-batching.integration.mjs` (or the stats tests) — full-access
  `meetCount` with a game-created progress row.
- `tests/placement.test.mjs` (or the existing placement tests) — the adjusted
  score, clamped at 0, level unchanged.
- `tests/flush.integration.mjs` — the stale-tab monotonic `correct`, `mastered`
  and `last_seen` cases.
- `drizzle/meta/_journal.json` — `0006` entry; `check:deploy` and the migration
  tests must see it.
- `THIRD_PARTY_NOTICES.md` — WordNet 3.0 notice and any build-time Wiktionary
  attribution.

---

## 10. Tests and verification

**Unit (`tests/five-letters.test.mjs`)**

- `gradeGuess`: exact, none, all-yellow rotation, duplicate letters both ways,
  `ABBEY`/`BABES`, case, length.
- Accepted list: 5 letters, lower case, no duplicates, all 194 answers present,
  no blocklisted entries.
- Answer pool: every answer is a bank word of length 5; entitlement and
  exclusion filtering; the last-20 exclusion; fallback when the pool is small;
  no answer outside the pool.
- Hint choice: syn/ant present, not equal to the answer, unavailable hidden,
  one of each; `HINT_SCORE_PENALTY` is the single source of the amount.
- Card mapping: bank word uses curated fields; non-bank uses the dictionary;
  missing entry is impossible for an accepted word (build gate); the count flag
  is true only for an allowed, non-excluded bank word.
- Score arithmetic: the `max(0, score - penalty)` helper is clamped at 0 and
  does not change the level.

**Server/integration (`tests/five-letters.integration.mjs`)**

- Start resumes one active game; two starts do not create two.
- Guess valid/invalid/duplicate; tiles persisted; the answer is absent from
  every `playing` response.
- Solve marks the answer mastered exactly once; a retried solve does not double
  count; a word already mastered by an answer or by "I know this" is not
  counted again; `daily_stats.mastered` matches; no attempt, credits, streak,
  learning event, or study time is created.
- Guess correctness: each accepted guess of an allowed, non-excluded bank word
  adds exactly one `progress.correct` (capped at 5) and one `last_seen`; the
  winning guess counts and the answer is still mastered once; a non-bank word
  and an excluded/out-of-entitlement bank word add nothing; a retried guess does
  not count twice.
- A guessed word at four counts becomes mastered on the fifth, sets the flag,
  adds one `daily_stats.mastered`, and retires; a sixth guess does not add
  another daily count.
- Hint: one synonym and one antonym per game; each deducts exactly
  `HINT_SCORE_PENALTY` from `users.score_penalty`; it does not spend a guess,
  does not end the round, and a retried or duplicate hint request deducts
  nothing. The displayed score is `max(0, derived − penalty)` at every endpoint
  (`/api/placement`, start, hint, snapshot); the level is unchanged; a penalty
  larger than the score shows 0 and future practice pays it back.
- Reveal/out-of-guesses does not master.
- Entitlement: a free-tier user cannot get a full-access answer; exclusions are
  respected.
- Stale-tab flush cannot lower a game-incremented `correct`, unmaster a game
  word, or move `last_seen` backward; the daily_stats total stays 1.
- Full-access `meetCount` includes a game-only progress row.
- Migration `0006` applies from `0000` and the journal lists it.

**Browser**

- Guest demo: start, invalid word, duplicate, valid guesses, cards, free hint,
  solve/reveal, sign-in CTA, no score strip, no console errors.
- Signed-in: solve → "Mastered", refresh → the game is still finished, next
  game starts; the answer is not visible in the page HTML or network before the
  end; a hint deducts 5 from the score strip, leaves the six pips untouched,
  and the practice page shows the lower score after reload; a stale practice tab
  test (two tabs) preserves the game count/mastery.
- Keyboard only, 320px/390px, dark mode, reduced motion, screen-reader labels.
- Header/landing/how-to links to the new page; `/five-letters` returns 200 and
  `X-Robots-Tag: noindex, nofollow`; it is absent from `sitemap.xml`.

**Existing suite**

- `npm test` (currently 425 tests), `npm run test:flush` with
  `TEST_NODE_DB=.sites-runtime/node-dev.sqlite`, `tsc`, lint, build,
  `verify:chunks`, `check:deploy`. Add the new integration test to the documented
  commands. The known `tests/mastery.integration.mjs` failure at line 567 is
  pre-existing and unrelated; do not treat it as caused by this work.

---

## 11. Rollout

1. **Pure logic + tests.** `lib/challenge/five-letters.ts`, the accepted list,
   the dictionary generator and its gate, `HINT_SCORE_PENALTY`. No UI, no
   migration.
2. **Migration + server.** `0006` (`word_games` + `users.score_penalty`),
   `lib/server/five-letters.ts`, `markWordMastered`, the guessed-word
   correctness batch, the hint penalty batch, the monotonic flush change, the
   `meetCount` change, integration tests.
3. **UI.** The page and component, cards, hints, score strip, guest demo,
   browser checks.
4. **References.** Header, landing, how-to, README, SEO config/tests, notices.
5. **Deploy.** Push to `main`; the deploy applies `0006` before the Worker.
   Verify the ledger, create one game, solve it, check `progress.mastered` and
   `daily_stats.mastered` move by one and the calendar shows it; guess a bank
   word and check `progress.correct` moves by one; use a hint and check
   `users.score_penalty` moves by 5 and `/api/placement` returns the lower
   score. No data backfill is needed.

No feature flag is needed: the route is not linked until the UI is ready, and
the migration is additive. The first deploy that includes the header link is
the public launch.

**Costs and limits.** The game adds no Stripe or credits changes. D1 writes are
one row per game, one correctness batch per accepted bank guess, one mastery
batch on a solve, and one hint row plus one penalty update per hint. The
dictionary is a static asset; WordNet is free for commercial use with the
notice. The 194-answer pool caps content work; the accepted list and dictionary
are generated, not hand-maintained.

---

## 12. Decisions and open points

**Taken**

- **Answer pool:** strict five letters; the 194 five-letter bank words.
- **Guess list:** the 14,855-word Wordle valid-guess list minus the safety
  blocklist; 2,323 words have dictionary cards.
- **Hint cost:** **5 points** from the 10,000 score per hint, permanent, and the
  hint does **not** spend a guess.
- **Mastery:** a solve masters the answer; every guessed vocabulary word counts
  one correctness, including the winning guess. **Five correctness counts on a
  guessed word master it**, whether the counts came from practice or from
  guesses.
- **Free tier:** the 20 five-letter words in the free demo bank are the free
  game sample (recommended default, not blocking).
- **Name and indexing:** Five Letters at `/five-letters`, noindex (recommended
  default, not blocking).

All decisions are taken. The plan is ready to build; no open questions remain.

---

## Sources

- Wordle rules: [How to Talk About Wordle, The New York Times](https://www.nytimes.com/2023/08/01/crosswords/how-to-talk-about-wordle.html); the Wordle game itself (one puzzle per day, six guesses, five letters).
- Valid guesses: [`tabatkins/wordle-list`](https://github.com/tabatkins/wordle-list), 14,855 five-letter words, MIT licence, including the duplicate-letter algorithm discussion.
- Common answer list: [cfreshman's Wordle answers gist](https://gist.github.com/cfreshman/a03ef2cba789d8cf00c08f767e0fad7b), 2,315 words (the source for the 2,323 dictionary cards, plus the 8 bank answers it lacks).
- WordNet 3.0: [Princeton WordNet](https://wordnet.princeton.edu/), [licence and commercial use](https://wordnet.princeton.edu/license-and-commercial-use); the notice must be preserved.
- Runtime dictionary options, for comparison only: [FreeDictionaryAPI.com](https://freedictionaryapi.com/) (Wiktionary, CC BY-SA 4.0), [Free Dictionary API](https://dictionaryapi.dev/), [Datamuse](https://www.datamuse.com/api/), [Merriam-Webster](https://dictionaryapi.com/).
- Repository constraints: `docs/HOSTING.md` ("Nothing third-party at runtime"), `docs/DEPLOY.md`, `AGENTS.md`.

/**
 * Five Letters against the real endpoint and database.
 *
 * The pure tests prove the marks and the score arithmetic. This suite is about
 * the parts only a request can show: the answer staying out of a playing
 * response, a retried guess or hint being free, a solve mastering exactly once,
 * and a free account never being given an answer outside its collection.
 *
 * Run against the Node preview:
 *
 *   npm run dev:node
 *   TEST_NODE_DB=.sites-runtime/node-dev.sqlite npm run test:five-letters:integration
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { signedUp } from "./helpers/account.mjs";
import {
  HINT_SCORE_PENALTY,
  MAX_GUESSES,
} from "../lib/challenge/five-letters.ts";
import { freeOrder, words } from "../lib/challenge/bank.ts";
import { localDay } from "../lib/challenge/rewards.ts";

const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:5173";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("Local previews only.");
if (!process.env.TEST_NODE_DB)
  throw Error("Set TEST_NODE_DB to the local preview SQLite database.");

const db = new DatabaseSync(process.env.TEST_NODE_DB);
db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");

const accepted = new Set(
  JSON.parse(readFileSync("data/five-letters/accepted.json", "utf8")),
);
const fiveLetterBank = words.filter((word) => word.word.length === 5);
const fiveLetterIds = new Set(fiveLetterBank.map((word) => word.id));

async function call(cookie, payload) {
  const response = await fetch(`${origin}/api/five-letters`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: cookie,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text.slice(0, 200) };
  }
  return { status: response.status, data };
}

async function placement(cookie) {
  const response = await fetch(`${origin}/api/placement`, {
    headers: { Cookie: cookie },
  });
  return { status: response.status, data: await response.json() };
}

const activeGame = (userId) =>
  db
    .prepare(
      "SELECT * FROM word_games WHERE user_id=? AND status='playing' ORDER BY created_at DESC LIMIT 1",
    )
    .get(userId);
const gameRow = (id) =>
  db.prepare("SELECT * FROM word_games WHERE id=?").get(id);
const progressFor = (userId, word) =>
  db
    .prepare(
      "SELECT correct,mastered,seen,last_seen FROM progress WHERE user_id=? AND word_id=?",
    )
    .get(userId, word) ?? null;
const masteredToday = (userId) =>
  db
    .prepare("SELECT mastered FROM daily_stats WHERE user_id=? AND day=?")
    .get(userId, localDay(Date.now()))?.mastered ?? 0;
const eventCount = (userId, word) =>
  db
    .prepare(
      "SELECT COUNT(*) AS n FROM learning_events WHERE user_id=? AND word_id=?",
    )
    .get(userId, word).n;
const attemptCount = (userId) =>
  db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_id=?").get(userId)
    .n;
const walletBalance = (userId) =>
  db
    .prepare(
      "SELECT COALESCE(balance,0) AS balance FROM credit_wallets WHERE user_id=?",
    )
    .get(userId)?.balance ?? 0;

/**
 * The free collection is the shipped prefix of `freeOrder`, which is also the
 * slice the browser downloads. Kept local so this suite does not import the
 * Worker-only server module.
 */
function freeSelection(limit) {
  const byId = new Map(words.map((word) => [word.id, word]));
  return freeOrder
    .slice(0, Math.min(limit, words.length))
    .map((id) => byId.get(id))
    .filter(Boolean);
}
test("Five Letters keeps the answer secret and pays each action exactly once", async () => {
  const account = await signedUp("five-letters");
  const cookie = account.cookie;
  const started = await call(cookie, { action: "start" });
  assert.equal(started.status, 200, JSON.stringify(started.data));
  assert.equal(started.data.game.status, "playing");
  assert.equal(
    "answer" in started.data.game,
    false,
    "a playing response leaked the answer",
  );
  assert.ok(started.data.game.id);
  assert.deepEqual(started.data.game.hints, []);
  assert.equal(started.data.game.guesses.length, 0);
  assert.equal(started.data.game.remainingGuesses, MAX_GUESSES);

  // Two starts are one game, because the partial unique index says so.
  const secondStart = await call(cookie, { action: "start" });
  assert.equal(secondStart.status, 200);
  assert.equal(secondStart.data.game.id, started.data.game.id);

  // Use a known answer with both hint kinds, so the assertions are not a
  // lottery. The update is test setup; the endpoint still has to keep it secret.
  const answer = "covet";
  assert.ok(fiveLetterIds.has(answer));
  const active = activeGame(account.id);
  assert.ok(active);
  db.prepare("UPDATE word_games SET word_id=? WHERE id=?").run(
    answer,
    active.id,
  );
  const restarted = await call(cookie, { action: "start" });
  assert.equal(restarted.status, 200);
  assert.equal(restarted.data.game.id, active.id);
  assert.equal("answer" in restarted.data.game, false);
  assert.deepEqual(restarted.data.game.remainingHints, ["syn", "ant"]);

  const invalid = await call(cookie, {
    action: "guess",
    gameId: active.id,
    guess: "zzzzz",
  });
  assert.equal(invalid.status, 409);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM word_games WHERE id=?").get(active.id)
      .n,
    1,
  );

  const wrong = "feign";
  assert.ok(accepted.has(wrong));
  assert.ok(fiveLetterIds.has(wrong));
  const wrongGuess = await call(cookie, {
    action: "guess",
    gameId: active.id,
    guess: wrong.toUpperCase(),
  });
  assert.equal(wrongGuess.status, 200, JSON.stringify(wrongGuess.data));
  assert.equal("answer" in wrongGuess.data.game, false);
  assert.equal(wrongGuess.data.game.guesses.length, 1);
  assert.equal(wrongGuess.data.game.guesses[0].word, wrong);
  assert.equal(wrongGuess.data.game.guesses[0].counted, true);
  assert.equal(wrongGuess.data.game.guesses[0].correct, 1);
  assert.equal(wrongGuess.data.game.guesses[0].mastered, false);
  assert.ok(wrongGuess.data.game.guesses[0].card.definition);
  assert.deepEqual(
    { ...progressFor(account.id, wrong) },
    { correct: 1, mastered: 0, seen: 0, last_seen: localDay(Date.now()) },
  );

  const duplicateGuess = await call(cookie, {
    action: "guess",
    gameId: active.id,
    guess: wrong,
  });
  assert.equal(duplicateGuess.status, 200);
  assert.equal(duplicateGuess.data.duplicate, true);
  assert.equal(duplicateGuess.data.game.guesses.length, 1);
  assert.equal(progressFor(account.id, wrong).correct, 1);

  const baseScore = restarted.data.score;
  const firstHint = await call(cookie, {
    action: "hint",
    gameId: active.id,
    kind: "syn",
  });
  assert.equal(firstHint.status, 200, JSON.stringify(firstHint.data));
  assert.equal(firstHint.data.game.hints.join(","), "syn");
  assert.equal(firstHint.data.game.guesses.length, 1, "a hint spent a guess");
  assert.equal(firstHint.data.game.hintText.syn.length > 0, true);
  assert.notEqual(firstHint.data.game.hintText.syn, answer);
  assert.equal(firstHint.data.game.remainingHints.join(","), "ant");
  assert.equal(firstHint.data.scorePenalty, HINT_SCORE_PENALTY);
  assert.equal(
    firstHint.data.score,
    Math.max(0, baseScore - HINT_SCORE_PENALTY),
  );
  assert.equal(
    db.prepare("SELECT score_penalty FROM users WHERE id=?").get(account.id)
      .score_penalty,
    HINT_SCORE_PENALTY,
  );

  const repeatedHint = await call(cookie, {
    action: "hint",
    gameId: active.id,
    kind: "syn",
  });
  assert.equal(repeatedHint.status, 200);
  assert.equal(repeatedHint.data.duplicate, true);
  assert.equal(repeatedHint.data.scorePenalty, HINT_SCORE_PENALTY);
  assert.equal(
    db.prepare("SELECT score_penalty FROM users WHERE id=?").get(account.id)
      .score_penalty,
    HINT_SCORE_PENALTY,
  );

  const secondHint = await call(cookie, {
    action: "hint",
    gameId: active.id,
    kind: "ant",
  });
  assert.equal(secondHint.status, 200, JSON.stringify(secondHint.data));
  assert.equal(secondHint.data.game.hints.join(","), "syn,ant");
  assert.equal(secondHint.data.scorePenalty, HINT_SCORE_PENALTY * 2);
  assert.equal(
    secondHint.data.score,
    Math.max(0, baseScore - HINT_SCORE_PENALTY * 2),
  );
  const scoreEndpoint = await placement(cookie);
  assert.equal(scoreEndpoint.status, 200);
  assert.equal(scoreEndpoint.data.score, secondHint.data.score);

  const walletBefore = walletBalance(account.id);
  const solved = await call(cookie, {
    action: "guess",
    gameId: active.id,
    guess: answer,
  });
  assert.equal(solved.status, 200, JSON.stringify(solved.data));
  assert.equal(solved.data.game.status, "solved");
  assert.equal(solved.data.game.answer.word, answer);
  assert.equal(solved.data.game.answer.newlyMastered, true);
  assert.equal(solved.data.game.answer.alreadyMastered, false);
  const answerGuess = solved.data.game.guesses.find(
    (guess) => guess.word === answer,
  );
  assert.ok(answerGuess);
  assert.equal(answerGuess.counted, true);
  assert.equal(answerGuess.correct, 1);
  assert.equal(
    answerGuess.mastered,
    false,
    "the answer was already mastered before the count",
  );
  assert.deepEqual(
    { ...progressFor(account.id, answer) },
    {
      correct: 1,
      mastered: 1,
      seen: 0,
      last_seen: localDay(Date.now()),
    },
  );
  assert.equal(
    eventCount(account.id, answer),
    0,
    "the game created a learning event",
  );
  assert.equal(attemptCount(account.id), 0, "the game created an attempt");
  assert.equal(
    walletBalance(account.id),
    walletBefore,
    "the game paid credits",
  );
  assert.equal(masteredToday(account.id), 1);

  const retriedSolve = await call(cookie, {
    action: "guess",
    gameId: active.id,
    guess: answer,
  });
  assert.equal(retriedSolve.status, 200);
  assert.equal(retriedSolve.data.duplicate, true);
  assert.equal(progressFor(account.id, answer).correct, 1);
  assert.equal(masteredToday(account.id), 1);

  // Refresh keeps the finished round. The explicit next action is what starts
  // the next answer, rather than every page load silently doing so.
  const refreshed = await call(cookie, { action: "start" });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.data.game.id, active.id);
  assert.equal(refreshed.data.game.status, "solved");
  assert.equal(refreshed.data.game.answer.word, answer);
  assert.equal(refreshed.data.game.answer.newlyMastered, true);

  const next = await call(cookie, { action: "next" });
  assert.equal(next.status, 200, JSON.stringify(next.data));
  assert.notEqual(next.data.game.id, active.id);
  assert.equal(next.data.game.status, "playing");
  assert.equal("answer" in next.data.game, false);

  // A non-bank word gets its card but never touches progress.
  const nonBank = "aback";
  assert.ok(accepted.has(nonBank));
  assert.equal(fiveLetterIds.has(nonBank), false);
  const nonBankGuess = await call(cookie, {
    action: "guess",
    gameId: next.data.game.id,
    guess: nonBank,
  });
  assert.equal(nonBankGuess.status, 200, JSON.stringify(nonBankGuess.data));
  assert.equal(nonBankGuess.data.game.guesses.at(-1).counted, false);
  assert.equal(nonBankGuess.data.game.guesses.at(-1).correct, 0);
  assert.equal(progressFor(account.id, nonBank), null);

  // The fifth correctness masters a guessed word and adds one daily mastery.
  const nextAnswer = activeGame(account.id).word_id;
  const fifth = ["peril", "rigid", "stern", "hasty", "lofty"].find(
    (word) => word !== nextAnswer && word !== answer,
  );
  assert.ok(fifth);
  db.prepare(
    `INSERT INTO progress(user_id,word_id,correct,seen,retry_at,mastered,last_seen)
     VALUES(?,?,4,0,NULL,0,?)
     ON CONFLICT(user_id,word_id) DO UPDATE SET correct=4,mastered=0`,
  ).run(account.id, fifth, localDay(Date.now()));
  const beforeFifth = masteredToday(account.id);
  const fifthGuess = await call(cookie, {
    action: "guess",
    gameId: next.data.game.id,
    guess: fifth,
  });
  assert.equal(fifthGuess.status, 200, JSON.stringify(fifthGuess.data));
  const fifthCard = fifthGuess.data.game.guesses.at(-1);
  assert.equal(fifthCard.counted, true);
  assert.equal(fifthCard.correct, 5);
  assert.equal(fifthCard.mastered, true);
  assert.deepEqual(
    { ...progressFor(account.id, fifth) },
    {
      correct: 5,
      mastered: 1,
      seen: 0,
      last_seen: localDay(Date.now()),
    },
  );
  assert.equal(masteredToday(account.id), beforeFifth + 1);

  const duplicateFifth = await call(cookie, {
    action: "guess",
    gameId: next.data.game.id,
    guess: fifth,
  });
  assert.equal(duplicateFifth.data.duplicate, true);
  assert.equal(masteredToday(account.id), beforeFifth + 1);

  const revealed = await call(cookie, {
    action: "reveal",
    gameId: next.data.game.id,
  });
  assert.equal(revealed.status, 200, JSON.stringify(revealed.data));
  assert.equal(revealed.data.game.status, "revealed");
  assert.equal(revealed.data.game.answer.word, nextAnswer);
  assert.equal(revealed.data.game.answer.newlyMastered, false);
  assert.equal(masteredToday(account.id), beforeFifth + 1);
  assert.equal(progressFor(account.id, nextAnswer)?.mastered ?? 0, 0);

  // A sixth-count guess updates nothing, even in a fresh round.
  const afterReveal = await call(cookie, { action: "start" });
  assert.equal(afterReveal.data.game.id, next.data.game.id);
  const sixthRound = await call(cookie, { action: "next" });
  assert.equal(sixthRound.status, 200);
  const sixth = await call(cookie, {
    action: "guess",
    gameId: sixthRound.data.game.id,
    guess: fifth,
  });
  assert.equal(sixth.status, 200, JSON.stringify(sixth.data));
  assert.equal(sixth.data.game.guesses.at(-1).correct, 5);
  assert.equal(sixth.data.game.guesses.at(-1).mastered, false);
  assert.equal(masteredToday(account.id), beforeFifth + 1);
});

test("a free account only gets free answers and only masters free words", async () => {
  const account = await signedUp("five-letters-free");
  // Make the derived trial expire. The account keeps its free collection.
  db.prepare("UPDATE users SET created_at=? WHERE id=?").run(
    Date.now() - 400 * 86_400_000,
    account.id,
  );
  const started = await call(account.cookie, { action: "start" });
  assert.equal(started.status, 200, JSON.stringify(started.data));
  assert.equal(started.data.freeTier, true);
  assert.equal(started.data.freeWordCount, 224);
  assert.equal("answer" in started.data.game, false);

  const freeIds = new Set(
    freeSelection(started.data.freeWordCount).map((word) => word.id),
  );
  const freeAnswers = [...freeIds].filter((id) => fiveLetterIds.has(id));
  assert.equal(freeAnswers.length, 20);
  const active = activeGame(account.id);
  assert.ok(freeIds.has(active.word_id));
  assert.ok(freeAnswers.includes(active.word_id));

  const nonFreeAnswer = fiveLetterBank.find(
    (word) => !freeIds.has(word.id) && word.id !== active.word_id,
  );
  assert.ok(nonFreeAnswer);
  db.prepare("UPDATE word_games SET word_id=? WHERE id=?").run(
    nonFreeAnswer.id,
    active.id,
  );

  // The answer is now outside the free collection, so a mid-round expiry
  // cannot be used to keep playing it. Starting again replaces it.
  const staleHint = await call(account.cookie, {
    action: "hint",
    gameId: active.id,
    kind: "syn",
  });
  assert.equal(staleHint.status, 409);
  const staleGuess = await call(account.cookie, {
    action: "guess",
    gameId: active.id,
    guess: "aback",
  });
  assert.equal(staleGuess.status, 409);
  const replacement = await call(account.cookie, { action: "start" });
  assert.equal(replacement.status, 200, JSON.stringify(replacement.data));
  assert.notEqual(replacement.data.game.id, active.id);
  assert.equal(gameRow(active.id), undefined);
  const replacementRow = activeGame(account.id);
  assert.ok(freeIds.has(replacementRow.word_id));
  assert.ok(freeAnswers.includes(replacementRow.word_id));

  const nonFreeGuess = fiveLetterBank.find(
    (word) => !freeIds.has(word.id) && word.id !== replacementRow.word_id,
  );
  assert.ok(nonFreeGuess);
  const guessed = await call(account.cookie, {
    action: "guess",
    gameId: replacementRow.id,
    guess: nonFreeGuess.id,
  });
  assert.equal(guessed.status, 200, JSON.stringify(guessed.data));
  assert.equal(guessed.data.game.guesses.at(-1).counted, false);
  assert.equal(guessed.data.game.guesses.at(-1).correct, 0);
  assert.equal(progressFor(account.id, nonFreeGuess.id), null);

  const solved = await call(account.cookie, {
    action: "guess",
    gameId: replacementRow.id,
    guess: replacementRow.word_id,
  });
  assert.equal(solved.status, 200, JSON.stringify(solved.data));
  assert.equal(solved.data.game.status, "solved");
  assert.equal(solved.data.game.answer.word, replacementRow.word_id);
  assert.equal(solved.data.game.answer.newlyMastered, true);
  assert.equal(progressFor(account.id, replacementRow.word_id).mastered, 1);
  assert.equal(masteredToday(account.id), 1);
});

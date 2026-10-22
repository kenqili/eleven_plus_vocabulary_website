/**
 * Five Letters against the real endpoint and database.
 *
 * The pure tests prove the marks and the score arithmetic. This suite is about
 * the parts only a request can show: the round that is played in the browser
 * and written down once at the end, a retried round being free, a solve
 * mastering exactly once, and a free account never being given an answer
 * outside its collection.
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

test("Five Letters plays a round in the browser and writes it down once", async () => {
  const account = await signedUp("five-letters");
  const cookie = account.cookie;
  const started = await call(cookie, { action: "start" });
  assert.equal(started.status, 200, JSON.stringify(started.data));
  assert.equal(started.data.game.status, "playing");
  assert.ok(started.data.game.id);
  assert.deepEqual(started.data.game.hints, []);
  assert.equal(started.data.game.guesses.length, 0);
  assert.equal(started.data.game.remainingGuesses, MAX_GUESSES);

  // The round travels with the state that starts it. The answer is in it,
  // because the browser marks the guesses, and the account's knowledge is in
  // it, because the score has to keep right while the child plays.
  assert.ok(started.data.round, "the round did not come with the state");
  assert.ok(
    fiveLetterIds.has(started.data.round.answer),
    "the round carried an answer that is not a bank word",
  );
  assert.equal(started.data.round.bands.length, 6);
  assert.equal(started.data.round.penalty, 0);
  assert.ok(started.data.round.answers.length > 0);
  for (const [wordId, band, correct, mastered] of started.data.round.answers) {
    assert.equal(typeof wordId, "string");
    assert.equal(band >= 0 && band <= 5, true);
    assert.equal(correct >= 0, true);
    assert.equal(typeof mastered, "boolean");
  }
  // The answer is in the round, so it is among the words it counts.
  assert.ok(
    started.data.round.answers.some(
      ([wordId]) => wordId === started.data.round.answer,
    ),
    "the answer was not among the countable words",
  );

  // Two starts are one game, because the partial unique index says so.
  const secondStart = await call(cookie, { action: "start" });
  assert.equal(secondStart.status, 200);
  assert.equal(secondStart.data.game.id, started.data.game.id);

  // Use a known answer with both hint kinds, so the assertions are not a
  // lottery. The update is test setup.
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
  assert.equal(restarted.data.round.answer, answer);
  assert.deepEqual(restarted.data.game.remainingHints, ["syn", "ant"]);
  assert.ok(restarted.data.round.hints.syn);
  assert.ok(restarted.data.round.hints.ant);
  assert.notEqual(restarted.data.round.hints.syn, answer);

  // A word that is not in the list is not a guess. The browser knows that
  // before it says anything, and the server drops it if it is told anyway.
  const wrong = "feign";
  assert.ok(accepted.has(wrong));
  assert.ok(fiveLetterIds.has(wrong));

  // Nothing is written until the round ends.
  assert.equal(progressFor(account.id, wrong), null);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM word_games WHERE id=?").get(active.id)
      .n,
    1,
  );

  const walletBefore = walletBalance(account.id);
  const finished = await call(cookie, {
    action: "finish",
    gameId: active.id,
    guesses: ["zzzzz", wrong, wrong, answer],
    hints: ["syn"],
    status: "solved",
  });
  assert.equal(finished.status, 200, JSON.stringify(finished.data));
  assert.equal(finished.data.game.status, "solved");
  assert.equal(finished.data.game.answer.word, answer);
  assert.equal(finished.data.game.answer.newlyMastered, true);
  assert.equal(finished.data.game.answer.alreadyMastered, false);
  assert.deepEqual(finished.data.game.hints, ["syn"]);
  assert.ok(finished.data.game.hintText.syn.length > 0);

  // The word that was guessed is worth what the server says it is worth: one
  // right answer, the marks the server drew, and the card it holds.
  const wrongGuess = finished.data.game.guesses.find(
    (guess) => guess.word === wrong,
  );
  assert.ok(wrongGuess, "the guessed word was not recorded");
  assert.equal(wrongGuess.counted, true);
  assert.equal(wrongGuess.correct, 1);
  assert.equal(wrongGuess.mastered, false);
  assert.equal(wrongGuess.marks.length, 5);
  assert.ok(wrongGuess.card.definition);
  // The word that is not in the list was never a guess, and the repeat was
  // only recorded once.
  assert.equal(
    finished.data.game.guesses.filter((guess) => guess.word === wrong).length,
    1,
  );
  assert.equal(
    finished.data.game.guesses.filter((guess) => guess.word === "zzzzz").length,
    0,
  );
  assert.deepEqual(
    { ...progressFor(account.id, wrong) },
    { correct: 1, mastered: 0, seen: 0, last_seen: localDay(Date.now()) },
  );

  // The answer was mastered by the solve, and the hints cost what they cost.
  const answerGuess = finished.data.game.guesses.find(
    (guess) => guess.word === answer,
  );
  assert.ok(answerGuess, "the answer was not recorded");
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
    db.prepare("SELECT score_penalty FROM users WHERE id=?").get(account.id)
      .score_penalty,
    HINT_SCORE_PENALTY,
  );
  assert.equal(finished.data.scorePenalty, HINT_SCORE_PENALTY);
  const scoreEndpoint = await placement(cookie);
  assert.equal(scoreEndpoint.status, 200);
  assert.equal(scoreEndpoint.data.score, finished.data.score);
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

  // A retried round is free. The round is claimed before it is paid for, so
  // the second attempt changes nothing.
  const retried = await call(cookie, {
    action: "finish",
    gameId: active.id,
    guesses: [answer],
    hints: ["syn"],
    status: "solved",
  });
  assert.equal(retried.status, 200);
  assert.equal(retried.data.duplicate, true);
  assert.equal(progressFor(account.id, wrong).correct, 1);
  assert.equal(progressFor(account.id, answer).mastered, 1);
  assert.equal(masteredToday(account.id), 1);
  assert.equal(
    db.prepare("SELECT score_penalty FROM users WHERE id=?").get(account.id)
      .score_penalty,
    HINT_SCORE_PENALTY,
  );

  // Refresh keeps the finished round. The explicit next action is what starts
  // the next answer, rather than every page load silently doing so.
  const refreshed = await call(cookie, { action: "start" });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.data.game.id, active.id);
  assert.equal(refreshed.data.game.status, "solved");
  assert.equal(refreshed.data.game.answer.word, answer);
  assert.equal(refreshed.data.game.answer.newlyMastered, true);
  assert.equal(refreshed.data.round, undefined, "a finished round came with a round");

  const next = await call(cookie, { action: "next" });
  assert.equal(next.status, 200, JSON.stringify(next.data));
  assert.notEqual(next.data.game.id, active.id);
  assert.equal(next.data.game.status, "playing");
  assert.ok(next.data.round.answer);

  // A non-bank word gets its card but never touches progress.
  const nonBank = "aback";
  assert.ok(accepted.has(nonBank));
  assert.equal(fiveLetterIds.has(nonBank), false);

  // A valid word outside the card set is accepted without a dictionary card.
  const nonCard = "bones";
  assert.ok(accepted.has(nonCard));
  assert.equal(fiveLetterIds.has(nonCard), false);

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

  const secondRound = await call(cookie, {
    action: "finish",
    gameId: next.data.game.id,
    guesses: [nonBank, nonCard, fifth],
    hints: [],
    status: "revealed",
  });
  assert.equal(secondRound.status, 200, JSON.stringify(secondRound.data));
  assert.equal(secondRound.data.game.status, "revealed");
  assert.equal(secondRound.data.game.answer.word, nextAnswer);
  assert.equal(secondRound.data.game.answer.newlyMastered, false);

  const nonBankRow = secondRound.data.game.guesses.find(
    (guess) => guess.word === nonBank,
  );
  assert.equal(nonBankRow.counted, false);
  assert.equal(nonBankRow.correct, 0);
  assert.equal(progressFor(account.id, nonBank), null);

  const nonCardRow = secondRound.data.game.guesses.find(
    (guess) => guess.word === nonCard,
  );
  assert.equal(nonCardRow.counted, false);
  assert.equal(nonCardRow.card.source, "Game list");
  assert.match(nonCardRow.card.definition, /not one of the vocabulary words/);
  assert.equal(progressFor(account.id, nonCard), null);

  const fifthCard = secondRound.data.game.guesses.find(
    (guess) => guess.word === fifth,
  );
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
  assert.equal(
    progressFor(account.id, nextAnswer)?.mastered ?? 0,
    0,
    "a revealed round mastered the answer",
  );
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

  const freeIds = new Set(
    freeSelection(started.data.freeWordCount).map((word) => word.id),
  );
  const freeAnswers = [...freeIds].filter((id) => fiveLetterIds.has(id));
  assert.equal(freeAnswers.length, 20);
  const active = activeGame(account.id);
  assert.ok(freeIds.has(active.word_id));
  assert.ok(freeAnswers.includes(active.word_id));

  // Only the free words can count, and only the free words are in the round's
  // list of countable words.
  const countable = new Set(started.data.round.answers.map(([wordId]) => wordId));
  for (const wordId of countable) assert.equal(freeIds.has(wordId), true);

  const nonFreeAnswer = fiveLetterBank.find(
    (word) => !freeIds.has(word.id) && word.id !== active.word_id,
  );
  assert.ok(nonFreeAnswer);
  db.prepare("UPDATE word_games SET word_id=? WHERE id=?").run(
    nonFreeAnswer.id,
    active.id,
  );

  // The answer is now outside the free collection, so a mid-round expiry
  // cannot be used to keep playing it. Finishing the round refuses it.
  const stale = await call(account.cookie, {
    action: "finish",
    gameId: active.id,
    guesses: ["aback"],
    hints: [],
    status: "revealed",
  });
  assert.equal(stale.status, 409);
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
    action: "finish",
    gameId: replacementRow.id,
    guesses: [nonFreeGuess.id],
    hints: [],
    status: "revealed",
  });
  assert.equal(guessed.status, 200, JSON.stringify(guessed.data));
  assert.equal(guessed.data.game.guesses.at(-1).counted, false);
  assert.equal(guessed.data.game.guesses.at(-1).correct, 0);
  assert.equal(progressFor(account.id, nonFreeGuess.id), null);

  // A solve in a round of its own, with a free answer the test chooses.
  const third = await call(account.cookie, { action: "next" });
  assert.equal(third.status, 200, JSON.stringify(third.data));
  const thirdRow = activeGame(account.id);
  assert.ok(freeIds.has(thirdRow.word_id));
  db.prepare("UPDATE word_games SET word_id=? WHERE id=?").run(
    thirdRow.word_id,
    thirdRow.id,
  );
  const solved = await call(account.cookie, {
    action: "finish",
    gameId: thirdRow.id,
    guesses: [thirdRow.word_id],
    hints: [],
    status: "solved",
  });
  assert.equal(solved.status, 200, JSON.stringify(solved.data));
  assert.equal(solved.data.game.status, "solved");
  assert.equal(solved.data.game.answer.word, thirdRow.word_id);
  assert.equal(solved.data.game.answer.newlyMastered, true);
  assert.equal(progressFor(account.id, thirdRow.word_id).mastered, 1);
  assert.equal(masteredToday(account.id), 1);
});

/**
 * The relation challenges against the real endpoint and database.
 *
 * The pure suite proves the questions are fair and that the answer set is the
 * one the server will recompute. This one is about the parts only a request can
 * show: that a finished match is written once, that a retry cannot pay a word
 * twice, that a free account is never asked a paid word, and that the score
 * history is per game.
 *
 * Run against the Node preview:
 *
 *   npm run dev:node
 *   TEST_NODE_DB=.sites-runtime/node-dev.sqlite npm run test:relations:integration
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { signedUp } from "./helpers/account.mjs";
import { relationAnswers } from "../lib/challenge/relations.ts";
import { freeOrder, levelOf, words } from "../lib/challenge/bank.ts";

const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:5173";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("Local previews only.");
if (!process.env.TEST_NODE_DB)
  throw Error("Set TEST_NODE_DB to the local preview SQLite database.");

const db = new DatabaseSync(process.env.TEST_NODE_DB);
db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");

const byId = new Map(words.map((word) => [word.id, word]));
const freeIds = new Set(
  freeOrder.slice(0, 224).map((id) => id),
);

async function get(cookie, kind) {
  const response = await fetch(`${origin}/api/games?kind=${kind}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  return { status: response.status, data: await response.json() };
}

async function post(cookie, payload) {
  const response = await fetch(`${origin}/api/games`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
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

const progressFor = (userId, wordId) =>
  db
    .prepare(
      "SELECT correct,mastered,last_seen FROM progress WHERE user_id=? AND word_id=?",
    )
    .get(userId, wordId) ?? null;

const matchRows = (userId, kind) =>
  db
    .prepare(
      "SELECT COUNT(*) AS n FROM game_matches WHERE user_id=? AND kind=?",
    )
    .get(userId, kind).n;

test("a finished match is written once, and a retry pays nothing again", async () => {
  const account = await signedUp("games");
  const cookie = account.cookie;

  const started = await get(cookie, "syn");
  assert.equal(started.status, 200, JSON.stringify(started.data));
  assert.equal(started.data.kind, "syn");
  assert.equal(started.data.questions.length, 10);
  assert.deepEqual(started.data.history, []);

  for (const question of started.data.questions) {
    assert.ok(byId.has(question.wordId), "the question is not a bank word");
    assert.deepEqual(
      question.answers,
      relationAnswers(byId.get(question.wordId), "syn"),
      "the page was given a different answer set from the one the server grades",
    );
  }

  const matchId = randomUUID();
  const answers = started.data.questions.map((question) => ({
    wordId: question.wordId,
    selected: question.answers,
  }));
  const finished = await post(cookie, {
    kind: "syn",
    matchId,
    answers,
    seconds: 42,
  });
  assert.equal(finished.status, 200, JSON.stringify(finished.data));
  assert.equal(finished.data.score, 10);
  assert.equal(finished.data.questions, 10);
  assert.equal(finished.data.seconds, 42);
  assert.equal(finished.data.awarded, 10);
  assert.equal(finished.data.history.length, 1);
  assert.equal(finished.data.history[0].id, matchId);
  assert.equal(finished.data.history[0].score, 10);

  // Every word got exactly one correctness, and the match is one row.
  for (const question of started.data.questions) {
    const progress = progressFor(account.id, question.wordId);
    assert.ok(progress, `${question.word} has no progress row`);
    assert.equal(progress.correct, 1, `${question.word} was not credited once`);
  }
  assert.equal(matchRows(account.id, "syn"), 1);

  // The same match again: the claim finds the row, the score is read from it,
  // and nothing is awarded a second time.
  const retried = await post(cookie, {
    kind: "syn",
    matchId,
    answers,
    seconds: 42,
  });
  assert.equal(retried.status, 200);
  assert.equal(retried.data.duplicate, true);
  assert.equal(retried.data.score, 10);
  assert.equal(retried.data.awarded, 0);
  assert.equal(retried.data.history.length, 1);
  for (const question of started.data.questions)
    assert.equal(progressFor(account.id, question.wordId).correct, 1);
  assert.equal(matchRows(account.id, "syn"), 1);

  // A later start sees the history, and the antonym challenge does not.
  const next = await get(cookie, "syn");
  assert.equal(next.status, 200);
  assert.equal(next.data.history.length, 1);
  const other = await get(cookie, "ant");
  assert.equal(other.status, 200);
  assert.deepEqual(other.data.history, [], "history leaked between games");
});

test("a wrong selection is recorded, but earns nothing", async () => {
  const account = await signedUp("games-wrong");
  const cookie = account.cookie;
  const started = await get(cookie, "ant");
  assert.equal(started.status, 200);
  const question = started.data.questions[0];
  const word = byId.get(question.wordId);
  const answers = question.answers;

  // Pick a distractor instead of an answer: the set is not the answer set, so
  // the word is missed even though something was selected.
  const distractor = question.options.find(
    (option) => !answers.includes(option),
  );
  const finished = await post(cookie, {
    kind: "ant",
    matchId: randomUUID(),
    answers: [{ wordId: question.wordId, selected: [distractor] }],
    seconds: 5,
  });
  assert.equal(finished.status, 200, JSON.stringify(finished.data));
  assert.equal(finished.data.score, 0);
  assert.equal(finished.data.awarded, 0);
  assert.equal(finished.data.results[0].correct, false);
  assert.equal(progressFor(account.id, word.id), null);
  // The match is still a row: a played round with no score is history too.
  assert.equal(matchRows(account.id, "ant"), 1);
});

test("a free account is never asked, or credited for, a paid word", async () => {
  const account = await signedUp("games-free");
  const cookie = account.cookie;
  // Make the derived trial expire. The account keeps its free collection.
  db.prepare("UPDATE users SET created_at=? WHERE id=?").run(
    Date.now() - 400 * 86_400_000,
    account.id,
  );
  const started = await get(cookie, "syn");
  assert.equal(started.status, 200);
  for (const question of started.data.questions)
    assert.ok(
      freeIds.has(question.wordId),
      `${question.word} is outside the free collection`,
    );

  const paid = words.find(
    (word) =>
      !freeIds.has(word.id) && relationAnswers(word, "syn").length > 0,
  );
  assert.ok(paid, "the bank has no paid word with a synonym");
  const finished = await post(cookie, {
    kind: "syn",
    matchId: randomUUID(),
    answers: [
      { wordId: paid.id, selected: relationAnswers(paid, "syn") },
    ],
    seconds: 3,
  });
  assert.equal(finished.status, 200, JSON.stringify(finished.data));
  assert.equal(finished.data.score, 0);
  assert.equal(finished.data.awarded, 0);
  assert.equal(progressFor(account.id, paid.id), null);
});

test("the relation games draw from the child's current band", async () => {
  const account = await signedUp("games-level");
  // Master 95% of band 0. The slow rule promotes out of a band at 80%, so the
  // account is on level 1 and the games must draw from there. The margin is
  // wider than 80% because the band's totals in the game are the words that
  // have a relation, a subset of the band, and the unmastered remainder could
  // otherwise fall inside that subset.
  const bandZero = words.filter((word) => levelOf.get(word.id) === 0);
  const insert = db.prepare(
    "INSERT INTO progress(user_id,word_id,correct,mastered) VALUES(?,?,5,1) ON CONFLICT(user_id,word_id) DO UPDATE SET correct=5,mastered=1",
  );
  db.exec("BEGIN");
  for (const word of bandZero.slice(0, Math.ceil(bandZero.length * 0.95)))
    insert.run(account.id, word.id);
  db.exec("COMMIT");

  for (const kind of ["syn", "ant"]) {
    const started = await get(account.cookie, kind);
    assert.equal(started.status, 200, JSON.stringify(started.data));
    assert.equal(
      started.data.level,
      1,
      `${kind}: the game did not report the account's band`,
    );
    for (const question of started.data.questions)
      assert.equal(
        levelOf.get(question.wordId),
        1,
        `${kind}: ${question.word} is outside the account's band`,
      );
  }
});

test("the mixed game asks every practice type and pays once", async () => {
  const account = await signedUp("games-mi");
  const cookie = account.cookie;
  const started = await get(cookie, "mi");
  assert.equal(started.status, 200, JSON.stringify(started.data));
  assert.equal(started.data.kind, "mi");
  assert.equal(started.data.questions.length, 10);
  assert.equal(
    new Set(started.data.questions.map((question) => question.wordId)).size,
    10,
    "the same word was asked twice",
  );
  assert.deepEqual(
    [
      ...new Set(started.data.questions.map((question) => question.type)),
    ].sort(),
    ["ant", "cloze", "def", "syn", "word"],
    "the match does not cover every practice type",
  );
  for (const question of started.data.questions) {
    assert.equal(question.choices.length, 4);
    assert.ok(
      question.choices.includes(question.answer),
      `${question.word}: the answer is not among the choices`,
    );
  }

  const matchId = randomUUID();
  const answers = started.data.questions.map((question) => ({
    wordId: question.wordId,
    type: question.type,
    selected: question.answer,
  }));
  const finished = await post(cookie, {
    kind: "mi",
    matchId,
    answers,
    seconds: 21,
  });
  assert.equal(finished.status, 200, JSON.stringify(finished.data));
  assert.equal(finished.data.score, 10);
  assert.equal(finished.data.awarded, 10);
  assert.equal(finished.data.history.length, 1);
  assert.equal(finished.data.history[0].kind, "mi");
  for (const question of started.data.questions)
    assert.equal(
      progressFor(account.id, question.wordId).correct,
      1,
      `${question.word} was not credited once`,
    );

  const retried = await post(cookie, {
    kind: "mi",
    matchId,
    answers,
    seconds: 21,
  });
  assert.equal(retried.status, 200);
  assert.equal(retried.data.duplicate, true);
  assert.equal(retried.data.awarded, 0);
  assert.equal(matchRows(account.id, "mi"), 1);
  // The relation history is a different game.
  const syn = await get(cookie, "syn");
  assert.deepEqual(syn.data.history, []);
});

test("a signed-out browser is refused, and a malformed match id is not saved", async () => {
  const guest = await get(undefined, "syn");
  assert.equal(guest.status, 401);
  assert.match(guest.data.error, /sign in/i);

  const account = await signedUp("games-bad-id");
  const bad = await post(account.cookie, {
    kind: "syn",
    matchId: "x",
    answers: [],
    seconds: 1,
  });
  assert.equal(bad.status, 400);
  assert.equal(matchRows(account.id, "syn"), 0);
});

test("the games pages are served, and the old Five Letters address redirects", async () => {
  const pages = [
    ["/games", /Synonym Challenge/],
    ["/games/syn", /Synonym Challenge/],
    ["/games/ant", /Antonym Challenge/],
    ["/games/mi", /Mi Challenge/],
    ["/games/five-letters", /Five Letters/],
  ];
  for (const [path, expected] of pages) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, `${path} did not render`);
    const html = await response.text();
    assert.match(html, expected, `${path} is missing its content`);
    assert.match(
      html,
      /href="\/games\/syn"/,
      `${path} has no left navigation`,
    );
  }
  const moved = await fetch(`${origin}/five-letters`, { redirect: "manual" });
  assert.equal(moved.status, 308);
  assert.equal(moved.headers.get("location"), "/games/five-letters");
});

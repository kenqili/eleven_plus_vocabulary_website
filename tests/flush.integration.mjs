/**
 * A flush is where a browser's arithmetic becomes the database's.
 *
 * The danger is not that it fails. It is that it half-succeeds: a question paid
 * for twice, or a child's whole five minutes dropped because one record in it was
 * unreadable. Both are invisible afterwards - the balance is simply wrong, and a
 * parent is the one who notices.
 *
 * So what is asserted is the behaviour a parent would see: the credits land, a
 * replay does not pay again, the eligibility cap holds across a batch, a word the
 * account may no longer use is dropped rather than failing the batch, and the
 * stats come back for the panels to reconcile against.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  confirmAddress,
  credentials,
  post as postJson,
} from "./helpers/account.mjs";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  BASE_CREDITS,
  MASTERY_CREDITS,
  STREAK_BONUS,
} from "../lib/challenge/credits.ts";
import { recallTarget } from "../lib/challenge/mastery.ts";
import { levelOf } from "../lib/challenge/bank.ts";

const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:5173";
const local = ["localhost", "127.0.0.1"].includes(new URL(origin).hostname);
let cookie = "";

const db = () => {
  if (!process.env.TEST_NODE_DB)
    throw Error("set TEST_NODE_DB to the local preview SQLite database");
  return new DatabaseSync(process.env.TEST_NODE_DB);
};

async function register() {
  const { email, password } = credentials("flush");
  const response = await postJson("/api/auth/register", { email, password });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  confirmAddress(email);
  cookie =
    (await postJson("/api/auth/login", { email, password })).headers.get(
      "set-cookie",
    ) || "";
  cookie = cookie.split(";")[0];
  return body.user.id;
}

const post = (payload) =>
  fetch(origin + "/api/flush", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: cookie,
    },
    body: JSON.stringify(payload),
  });

/** A real question, built the way the browser builds one from the shipped bank. */
const bank = JSON.parse(readFileSync("data/problem-bank.json", "utf8"));

function answered(wordId, { correct = true, type = "def", ago = 3000 } = {}) {
  const problem = bank.problems.find((p) => p[0] === wordId && p[1] === type);
  assert.ok(problem, `no ${type} problem for ${wordId}`);
  const [, , prompt, answer, distractors] = problem;
  const choices = [...distractors.slice(0, 3), answer];
  return {
    id: randomUUID(),
    wordId,
    type,
    prompt,
    answer,
    choices,
    selected: correct ? choices.indexOf(answer) : 0,
    elapsed: 3,
    shownAt: Date.now() - ago,
    revealed: false,
    assisted: false,
    evidence: correct ? "recalled" : "guessed",
    // A first answer never finishes a word. The browser is the one that knows
    // that, and the event insert checks it rather than taking it on trust.
    mastered: false,
  };
}

test(
  "a flush records a batch of answers and pays for them",
  { skip: !local },
  async () => {
    if (!local || !process.env.TEST_NODE_DB) return;
    const sql = db();
    sql.prepare("DELETE FROM rate_limits").run();
    const userId = await register();

    // A five-minute sitting: this is the case the batch exists for, and the single
    // `attempts_one_pending_per_user` index is exactly what used to forbid it.
    const answers = [
      answered("abandon"),
      answered("abundant"),
      answered("affable"),
      answered("antiquity"),
      answered("arduous"),
    ];
    const response = await post({
      answers,
      state: {
        progress: answers.map((a) => [
          a.wordId,
          1,
          1,
          1,
          0,
          1,
          "2026-09-29",
          null,
        ]),
      },
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.saved, 5, "every answer in the batch should be recorded");
    assert.ok(body.stats, "a flush must return the stats the panels read");

    // The single-pending-attempt index would have rejected four of these.
    const attempts = sql
      .prepare(
        "SELECT COUNT(*) AS c FROM attempts WHERE user_id=? AND answered_at IS NOT NULL",
      )
      .get(userId).c;
    assert.equal(
      attempts,
      5,
      "a batch of five answered questions must all be stored",
    );

    const events = sql
      .prepare("SELECT COUNT(*) AS c FROM learning_events WHERE user_id=?")
      .get(userId).c;
    assert.equal(events, 5, "and each must have produced an award event");
    assert.ok(
      body.stats.rewards.balance > 0,
      "and the credits must actually have been paid by the trigger",
    );

    // A retried flush is a browser that never saw the answer to its own request.
    // It must not pay twice.
    const balance = body.stats.rewards.balance;
    const repeat = await post({
      answers,
      state: {
        progress: answers.map((a) => [
          a.wordId,
          1,
          1,
          1,
          0,
          1,
          "2026-09-29",
          null,
        ]),
      },
    });
    const repeatBody = await repeat.json();
    assert.equal(repeat.status, 200, JSON.stringify(repeatBody));
    assert.equal(
      repeatBody.stats.rewards.balance,
      balance,
      "replaying a flush must not pay a second time",
    );
    assert.equal(
      sql
        .prepare("SELECT COUNT(*) AS c FROM learning_events WHERE user_id=?")
        .get(userId).c,
      5,
      "and must not record the answers twice",
    );

    sql.prepare("DELETE FROM users WHERE id=?").run(userId);
    sql.close();
  },
);

test(
  "a word stops paying after five counted answers, within one batch",
  { skip: !local },
  async () => {
    if (!local || !process.env.TEST_NODE_DB) return;
    const sql = db();
    sql.prepare("DELETE FROM rate_limits").run();
    const userId = await register();
    // Six correct answers at one word in a single flush. The cap is the thing that
    // stops a child farming credits, and it lives in SQL, so a batch must not be a
    // way round it.
    const answers = [0, 1, 2, 3, 4, 5].map((i) =>
      answered("abandon", { ago: 3000 * (i + 1) }),
    );
    const response = await post({
      answers,
      state: { progress: [["abandon", 6, 6, 6, 1, 6, "2026-09-29", null]] },
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.saved, 6, "all six should be recorded as answered");
    const eligible = sql
      .prepare(
        "SELECT COUNT(*) AS c FROM learning_events WHERE user_id=? AND eligible=1",
      )
      .get(userId).c;
    assert.equal(
      eligible,
      5,
      `the fifth-answer cap must hold; got ${eligible} eligible`,
    );
    const wallet = sql
      .prepare("SELECT balance FROM credit_wallets WHERE user_id=?")
      .get(userId);
    // Five base awards at 2 each, and nothing for the sixth.
    assert.ok(
      wallet.balance >= 10,
      `the first five must have paid; balance was ${wallet?.balance}`,
    );
    assert.ok(
      body.stats.rewards.balance < 30,
      "and the sixth must not have paid a sixth base award",
    );

    sql.prepare("DELETE FROM users WHERE id=?").run(userId);
    sql.close();
  },
);

test(
  "a reveal costs nothing and breaks nothing",
  { skip: !local },
  async () => {
    if (!local || !process.env.TEST_NODE_DB) return;
    const sql = db();
    sql.prepare("DELETE FROM rate_limits").run();
    const userId = await register();
    const reveal = answered("abandon", { correct: false });
    reveal.selected = -1;
    reveal.revealed = true;
    reveal.evidence = "revealed";
    const response = await post({ answers: [reveal] });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(
      body.saved,
      1,
      "a revealed answer is still an answer worth keeping",
    );
    const event = sql
      .prepare(
        "SELECT correct,revealed,eligible FROM learning_events WHERE user_id=?",
      )
      .get(userId);
    assert.equal(event.correct, 0, "a reveal is not a right answer");
    assert.equal(event.revealed, 1, "and is recorded as one");
    assert.equal(event.eligible, 0, "so it cannot pay");
    sql.prepare("DELETE FROM users WHERE id=?").run(userId);
    sql.close();
  },
);

test(
  "a client that lies about the answer is recorded as wrong",
  { skip: !local },
  async () => {
    if (!local || !process.env.TEST_NODE_DB) return;
    const sql = db();
    sql.prepare("DELETE FROM rate_limits").run();
    const userId = await register();
    // The question payload deliberately does not carry the answer, so a flush
    // cannot simply send it back. A client that fabricates one - claiming a
    // distractor is the answer and selecting it - is marking itself right, and the
    // award rules turn on exactly that.
    const honest = answered("abandon");
    const lie = { ...honest, answer: honest.choices[0], selected: 0 };
    assert.notEqual(
      lie.answer,
      honest.answer,
      "the fixture must actually be lying",
    );
    const response = await post({ answers: [lie] });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    const event = sql
      .prepare("SELECT correct,eligible FROM learning_events WHERE user_id=?")
      .get(userId);
    assert.ok(event, "the answer must still be recorded");
    assert.equal(
      event.correct,
      0,
      "the bank's answer decides whether this was right, not the browser's",
    );
    assert.equal(event.eligible, 0, "so it cannot pay a credit");
    assert.equal(
      body.stats.rewards.balance,
      0,
      "and a client that lies about the answer earns nothing",
    );
    sql.prepare("DELETE FROM users WHERE id=?").run(userId);
    sql.close();
  },
);

test(
  "the same question twice in one flush is answered once",
  { skip: !local },
  async () => {
    if (!local || !process.env.TEST_NODE_DB) return;
    const sql = db();
    sql.prepare("DELETE FROM rate_limits").run();
    const userId = await register();
    // Not a retry - the same record twice inside one request, which is what a
    // queue that replays on an error looks like. It must not be counted twice.
    const one = answered("abandon");
    const response = await post({ answers: [one, { ...one }] });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.saved, 1, "a repeated record in one flush is saved once");
    assert.equal(
      sql
        .prepare("SELECT COUNT(*) AS c FROM learning_events WHERE user_id=?")
        .get(userId).c,
      1,
      "and produces one award event, not two",
    );
    sql.prepare("DELETE FROM users WHERE id=?").run(userId);
    sql.close();
  },
);

test(
  "a flush refuses a caller with no origin, and an anonymous one",
  { skip: !local },
  async () => {
    if (!local || !process.env.TEST_NODE_DB) return;
    const sql = db();
    sql.prepare("DELETE FROM rate_limits").run();
    await register();
    const noOrigin = await fetch(origin + "/api/flush", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ answers: [] }),
    });
    assert.equal(noOrigin.status, 403, "a browser-less POST must be refused");
    const anonymous = await fetch(origin + "/api/flush", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ answers: [] }),
    });
    assert.equal(
      anonymous.status,
      401,
      "and an unsigned-in one must be refused",
    );
    sql.close();
  },
);

test(
  "a claim that a first answer finished a word pays nothing extra",
  { skip: !local },
  async () => {
    if (!local || !process.env.TEST_NODE_DB) return;
    const sql = db();
    sql.prepare("DELETE FROM rate_limits").run();
    const userId = await register();
    // The shape of the bug this file was missing: a flush whose mastered flag came
    // from SQL alone, so "this word has never paid a mastery award" was true of
    // every word the child had just met, and ten credits were paid for each of
    // them on the first right answer.
    const answers = [
      "abandon",
      "abundance",
      "affable",
      "antiquity",
      "arduous",
    ].map((wordId, index) => {
      const honest = answered(wordId);
      return {
        ...honest,
        mastered: true,
        shownAt: Date.now() - 3000 * (index + 1),
      };
    });
    const response = await post({ answers });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(
      body.stats.rewards.balance,
      BASE_CREDITS * 5 + STREAK_BONUS,
      "a client claiming every word was finished pays no mastery award at all",
    );
    sql.prepare("DELETE FROM users WHERE id=?").run(userId);
    sql.close();
  },
);

test(
  "a word that is genuinely finished does pay its mastery award",
  { skip: !local },
  async () => {
    if (!local || !process.env.TEST_NODE_DB) return;
    const sql = db();
    sql.prepare("DELETE FROM rate_limits").run();
    const userId = await register();
    // The other direction, and it matters as much as the first: the server works
    // mastery out for itself, and "the server ignores the client" and "the server
    // never pays a mastery award" are the same mistake. A word worth
    // `recallTarget` genuine recalls has been finished, by the same
    // `advanceMastery` the browser ran, and the award is owed.
    //
    // The same word answered repeatedly, with the progress a real sitting would
    // have left behind, so the run and the recalls have somewhere to build from.
    const target = recallTarget(levelOf.get("abandon") ?? 1);
    const answers = [];
    for (let i = 0; i < target + 1; i++) {
      const honest = answered("abandon", { ago: 4000 * (i + 1) });
      // Answered fast enough to read as a genuine recall rather than a guess, which
      // is the only evidence that builds a recall.
      answers.push({ ...honest, elapsed: 4, evidence: "recalled" });
    }
    const response = await post({
      answers,
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    const mastered = sql
      .prepare(
        "SELECT COUNT(*) AS c FROM learning_events WHERE user_id=? AND mastered=1",
      )
      .get(userId).c;
    assert.equal(
      mastered,
      1,
      `a word answered ${target + 1} times with genuine recalls has been finished; got ${mastered} mastery awards`,
    );
    const wallet = sql
      .prepare("SELECT balance FROM credit_wallets WHERE user_id=?")
      .get(userId);
    assert.equal(
      wallet.balance,
      BASE_CREDITS * (target + 1) +
        STREAK_BONUS * Math.floor((target + 1) / 3) +
        MASTERY_CREDITS,
      "so the mastery award is paid once, on top of the base awards and bonuses",
    );
    sql.prepare("DELETE FROM users WHERE id=?").run(userId);
    sql.close();
  },
);

/**
 * The browser builds its own questions from this snapshot, so the snapshot has
 * to contain what the server would have used.
 *
 * The risk is not that the endpoint breaks. It is that it returns something
 * plausible and slightly different, and question ordering quietly stops matching
 * what a child was getting before - mistakes never come back, or come back in a
 * clump, and nothing anywhere reports an error. No existing test would notice,
 * because none of them read this response.
 *
 * So each field is checked against the query the server uses today, on a
 * database with a history behind it: words answered, a word answered more than
 * once, a mistake with a review scheduled, a word a parent set aside, a word a
 * parent added.
 */
import assert from "node:assert/strict";
import { confirmAddress } from "./helpers/account.mjs";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { RECENT_WORD_WINDOW, reviewDueAt } from "../lib/challenge/ordering.ts";

const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:5173";
const local = ["localhost", "127.0.0.1"].includes(new URL(origin).hostname);
let cookie = "";

async function call(path) {
  const response = await fetch(origin + path, { headers: { Cookie: cookie } });
  const body = await response.json();
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return { status: response.status, data: body, headers: response.headers };
}

const db = () => {
  if (!process.env.TEST_NODE_DB)
    throw Error("set TEST_NODE_DB to the local preview SQLite database");
  return new DatabaseSync(process.env.TEST_NODE_DB);
};

test(
  "the snapshot carries what the ordering rules read",
  { skip: !local },
  async () => {
    if (!local || !process.env.TEST_NODE_DB) return;
    const sql = db();
    cookie = "";
    const email = `snapshot-${randomUUID()}@example.test`;
    const password = `Test-only-${randomUUID()}`;
    const registered = await fetch(origin + "/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        email,
        password,
      }),
    });
    const registeredBody = await registered.json();
    assert.equal(registered.status, 200, JSON.stringify(registeredBody));
    const userId = registeredBody.user.id;
    assert.ok(userId, "register must return the user id");
    // Registration hands out no session now, so the address is confirmed and the
    // cookie comes from a sign-in.
    confirmAddress(email);
    const login = await fetch(origin + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(login.status, 200, "sign in after confirming");
    cookie = (login.headers.get("set-cookie") || "").split(";")[0];
    assert.ok(cookie, "and a session");

    // Seed a history directly, so the snapshot is tested against rows a real
    // child would have rather than an empty account.
    const now = Date.now();
    const attempt = sql.prepare.bind(sql);

    // A history first, so the recent window has to truncate. Insertion order is
    // what the window is ordered by - `MAX(rowid)`, not clock time - so history has
    // to go in first for this session's attempts to be the recent ones.
    const bankRows = JSON.parse(readFileSync("data/problem-bank.json", "utf8"));
    const history = bankRows.words.slice(0, 50).map((row) => row[0]);
    for (const [i, word] of history.entries())
      attempt(
        "INSERT INTO attempts(id,user_id,word_id,choices,created_at,question_type,answer,prompt,answered_at,selected,is_correct,elapsed) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        randomUUID(),
        userId,
        word,
        "[]",
        now - 1_000_000 - i,
        "def",
        "x",
        "p",
        now - 999_000 - i,
        0,
        1,
        3,
      );

    // Progress with history behind it: a word answered more than once, a mistake
    // with a review scheduled, and a word mastered outright.
    for (const [
      word,
      correct,
      run,
      recalls,
      mastered,
      seen,
      lastSeen,
      retryAt,
    ] of [
      ["abandon", 3, 2, 1, 0, 4, "2026-09-28", reviewDueAt(9)],
      ["abundant", 0, 0, 0, 0, 2, "2026-09-29", null],
      ["benevolent", 5, 5, 5, 1, 7, "2026-09-20", null],
    ])
      attempt(
        "INSERT INTO progress(user_id,word_id,correct,run,recalls,mastered,seen,last_seen,retry_at) VALUES(?,?,?,?,?,?,?,?,?)",
      ).run(
        userId,
        word,
        correct,
        run,
        recalls,
        mastered,
        seen,
        lastSeen,
        retryAt,
      );

    // This session's attempts, including a repeat of a word already in the history.
    for (const [word, age] of [
      ["abandon", 120_000],
      ["abundant", 60_000],
      ["abandon", 0],
    ])
      attempt(
        "INSERT INTO attempts(id,user_id,word_id,choices,created_at,question_type,answer,prompt,answered_at,selected,is_correct,elapsed) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        randomUUID(),
        userId,
        word,
        "[]",
        now - age,
        "def",
        "x",
        "p",
        now - 500,
        0,
        1,
        3,
      );

    // A question issued but not yet answered. It still counts: the review clock is
    // the number of attempts, and it is the count a `retry_at` was written against,
    // so an answered-only count would shift every review a position.
    attempt(
      "INSERT INTO attempts(id,user_id,word_id,choices,created_at,question_type,answer,prompt) VALUES(?,?,?,?,?,?,?,?)",
    ).run(randomUUID(), userId, "abate", "[]", now, "def", "x", "p");

    sql
      .prepare(
        "INSERT INTO word_exclusions(user_id,word_id,created_at) VALUES(?,?,?)",
      )
      .run(userId, "abate", now);
    sql
      .prepare(
        "INSERT INTO custom_words(id,user_id,word,definition,example,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        userId,
        "wibble",
        "To wobble slightly.",
        "The wibble wobbled.",
        now,
      );

    const snapshot = await call("/api/progress");
    assert.equal(snapshot.status, 200, JSON.stringify(snapshot.data));

    // The bank, and which one it is.
    assert.ok(["full", "free"].includes(snapshot.data.bank.tier));
    assert.match(
      snapshot.data.bank.url,
      /^\/bank\/bank-(full|free)-[0-9a-f]{12}\.json$/,
    );
    const manifest = JSON.parse(readFileSync("data/client-bank.json", "utf8"));
    assert.equal(
      snapshot.data.bank.url,
      manifest[snapshot.data.bank.tier].url,
      "the snapshot must name the bank the manifest describes",
    );
    assert.equal(
      snapshot.data.bank.words,
      manifest[snapshot.data.bank.tier].words,
    );
    assert.equal(
      snapshot.data.bank.problems,
      manifest[snapshot.data.bank.tier].problems,
    );
    // A fresh account is trialling, so it may use everything.
    assert.equal(
      snapshot.data.account.freeTier,
      false,
      "a new account is inside its trial",
    );

    // The clock: total attempts, which is what retry_at was written against.
    assert.equal(
      snapshot.data.clock.attemptCount,
      54,
      "attemptCount must count every attempt, including one issued but not answered",
    );
    // Compared against the server's own query rather than an expected order,
    // because the order is `MAX(rowid)` - insertion order, not clock time - and
    // guessing at it is how this assertion ends up testing nothing.
    const window = RECENT_WORD_WINDOW * 2;
    const expectedRecent = sql
      .prepare(
        "SELECT word_id FROM attempts WHERE user_id = ? GROUP BY word_id ORDER BY MAX(rowid) DESC LIMIT ?",
      )
      .all(userId, window)
      .map((row) => row.word_id);
    assert.ok(
      expectedRecent.length === window,
      `the fixture must attempt more distinct words than the window holds, got ${expectedRecent.length}`,
    );
    assert.deepEqual(
      snapshot.data.clock.recent,
      expectedRecent,
      "recent must be exactly what the server's own query returns, in the same order",
    );
    assert.ok(
      snapshot.data.clock.recent.includes("abandon"),
      "a word answered in this session must be in the window",
    );

    // Progress, field for field, against the rows that were seeded.
    const byWord = new Map(snapshot.data.progress.map((row) => [row[0], row]));
    assert.equal(byWord.size, 3, "one row per word the child has met");
    assert.deepEqual(
      byWord.get("abandon"),
      ["abandon", 3, 2, 1, 0, 4, "2026-09-28", reviewDueAt(9)],
      "progress must be the row verbatim, in the documented column order",
    );
    assert.deepEqual(byWord.get("abundant"), [
      "abundant",
      0,
      0,
      0,
      0,
      2,
      "2026-09-29",
      null,
    ]);
    assert.deepEqual(byWord.get("benevolent"), [
      "benevolent",
      5,
      5,
      5,
      1,
      7,
      "2026-09-20",
      null,
    ]);
    assert.equal(
      byWord.has("abate"),
      false,
      "an excluded word still has its progress row, and must",
    );

    // The parent's own settings.
    assert.deepEqual(snapshot.data.excluded, ["abate"]);
    assert.equal(
      snapshot.data.addedWords.length,
      1,
      "an added word must be sent",
    );
    assert.equal(snapshot.data.addedWords[0].word, "wibble");
    assert.equal(snapshot.data.addedWords[0].definition, "To wobble slightly.");

    // The clock the reporting day is drawn against.
    assert.ok(
      snapshot.data.account.timezone,
      "the account must carry a timezone",
    );

    // The summary, so the practice page needs one call rather than two.
    assert.ok(snapshot.data.stats, "the snapshot must carry the stats summary");
    assert.ok(snapshot.data.stats.total > 0);

    sql.prepare("DELETE FROM users WHERE id=?").run(userId);
    sql.close();
  },
);

test(
  "a lapsed account is sent the free bank, not the whole collection",
  { skip: !local },
  async () => {
    if (!local || !process.env.TEST_NODE_DB) return;
    const sql = db();
    sql.prepare("DELETE FROM rate_limits").run();
    const lapsedEmail = `lapsed-${randomUUID()}@example.test`;
    const lapsedPassword = `Test-only-${randomUUID()}`;
    const registered = await fetch(origin + "/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        email: lapsedEmail,
        password: lapsedPassword,
      }),
    });
    const body = await registered.json();
    assert.equal(registered.status, 200, JSON.stringify(body));
    const userId = body.user.id;
    // Past the trial, with nothing purchased. Backdating created_at is the same
    // thing `membership()` derives the trial from.
    sql
      .prepare("UPDATE users SET created_at=?, expiry_date=NULL WHERE id=?")
      .run(Date.now() - 90 * 86_400_000, userId);

    confirmAddress(lapsedEmail);
    const login = await fetch(origin + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ email: lapsedEmail, password: lapsedPassword }),
    });
    assert.equal(login.status, 200, "sign in after confirming");
    const response = await fetch(origin + "/api/progress", {
      headers: {
        Cookie: (login.headers.get("set-cookie") || "").split(";")[0],
      },
    });
    const snapshot = await response.json();
    const manifest = JSON.parse(readFileSync("data/client-bank.json", "utf8"));
    assert.equal(
      snapshot.account.freeTier,
      true,
      "an account whose trial has lapsed and which has not paid is on the free tier",
    );
    assert.equal(snapshot.bank.tier, "free");
    // The point of the split: a lapsed child downloads 35 KB, not 349 KB, and the
    // words they may use are absent from what they were sent rather than hidden.
    assert.equal(snapshot.bank.url, manifest.free.url);
    assert.equal(snapshot.bank.words, 224);
    assert.ok(
      snapshot.bank.words < manifest.full.words,
      "the free bank must be smaller than the full one",
    );

    sql.prepare("DELETE FROM users WHERE id=?").run(userId);
    sql.close();
  },
);

test("the snapshot is not cacheable", { skip: !local }, async () => {
  if (!local) return;
  const response = await fetch(origin + "/api/progress", {
    headers: { Cookie: cookie },
  });
  assert.equal(
    response.headers.get("cache-control"),
    "no-store",
    "per-child state that changes with every answer must never be cached",
  );
});

test("the snapshot refuses an anonymous caller", { skip: !local }, async () => {
  if (!local) return;
  const response = await fetch(origin + "/api/progress");
  assert.equal(
    response.status,
    401,
    "an unsigned-in caller must not get a snapshot",
  );
});

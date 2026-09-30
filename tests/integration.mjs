import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { words } from "../scripts/load-word-bank.mjs";
import { parseCsv } from "../lib/challenge/words.ts";
import { problems } from "../scripts/load-problem-bank.mjs";
const origin = process.env.TEST_ORIGIN || "http://localhost:5173";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("Integration tests only run against local development.");
const nodeDatabase = process.env.TEST_NODE_DB
  ? new (await import("node:sqlite")).DatabaseSync(process.env.TEST_NODE_DB)
  : null;
nodeDatabase?.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
const stamp = randomUUID();
const password = `Test-only-${stamp}`;
let cookie = "";
async function call(path, data, options = {}) {
  const response = await fetch(origin + path, {
    method: data ? "POST" : "GET",
    headers: {
      ...(data ? { "Content-Type": "application/json", Origin: origin } : {}),
      Cookie: cookie,
      ...options.headers,
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { error: text };
  }
  return {
    status: response.status,
    data: parsed,
    cookie: response.headers.get("set-cookie"),
  };
}
function sql(text) {
  if (nodeDatabase) {
    nodeDatabase.exec(text);
    return;
  }
  mkdirSync("work", { recursive: true });
  writeFileSync("work/integration.sql", text);
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "./scripts/sites-env.mjs",
      "./node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "DB",
      "--local",
      "--config",
      "dist/server/wrangler.json",
      "--persist-to",
      ".wrangler/state",
      "--file",
      "work/integration.sql",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw Error(result.stderr || result.stdout);
}
let userId;
try {
  assert.equal((await call("/api/calendar")).status, 401);
  assert.equal((await call("/api/words")).status, 401);
  assert.equal((await call("/api/words/export")).status, 401);
  const demo = await call("/api/challenge?types=def");
  assert.equal(demo.status, 200);
  // The free word set, as the API reports it. Kept separate from the ids in the
  // sample below, which is this set minus the words that cannot be asked.
  const freeWordCount = demo.data.freeWordCount;
  const defSampleIds = new Set(demo.data.words.map((word) => word.wordId));
  assert.equal(defSampleIds.size, demo.data.words.length);
  // The sample is every free word that can be *asked* as a meaning question.
  // A few words in the collection are defined using the word itself, so
  // offering their definition as the answer to "choose the definition" would
  // show the answer in the question; the generator leaves those out, and they
  // are still practised through the other question types. So the sample is the
  // free set minus the words with no meaning question, never the whole free set.
  const askable = new Set(
    problems.filter((p) => p.type === "def").map((p) => p.wordId),
  );
  // Bounded, not just "less than". A check on the sign of the gap would still
  // pass if the sampler regressed and quietly dropped fifty words, and this is
  // the one assertion that would have caught it.
  const unaskable = freeWordCount - demo.data.words.length;
  assert.ok(
    unaskable > 0 && unaskable <= 2,
    `free set minus meaning-askable words: ${unaskable}`,
  );
  assert.equal(demo.data.stats.total, demo.data.words.length);
  for (const id of defSampleIds)
    assert.ok(askable.has(id), `${id} was sampled with no meaning question`);
  for (const type of ["syn", "ant"]) {
    const sample = await call(`/api/challenge?types=${type}`);
    assert.equal(sample.status, 200);
    assert.ok(sample.data.words.length > 0);
    for (const question of sample.data.words) {
      assert.equal(question.type, type);
      assert.equal(
        question.answer,
        problems.find((p) => p.id === `${type}:${question.wordId}`).answer,
      );
      assert.equal(
        question.choices.filter((x) => x === question.answer).length,
        1,
      );
    }
  }
  assert.equal((await call("/api/challenge?types=")).status, 400);
  assert.equal((await call("/api/challenge?types=invalid")).status, 400);
  const missingOrigin = await call(
    "/api/auth/register",
    { email: `${stamp}@example.test`, password },
    { headers: { Origin: "https://other.example" } },
  );
  assert.equal(missingOrigin.status, 403);
  const account = await call("/api/auth/register", {
    email: `${stamp}@example.test`,
    password,
  });
  assert.equal(account.status, 200, JSON.stringify(account.data));
  userId = account.data.user.id;
  cookie = account.cookie.split(";")[0];
  assert.match(account.cookie, /HttpOnly/);
  assert.match(account.cookie, /SameSite=Lax/);
  assert.equal((await call("/api/auth/me")).data.user.id, userId);
  const initialAccess = await call("/api/challenge");
  if (demo.data.trialDaysConfigured > 0) {
    assert.equal(initialAccess.data.trial, true);
    assert.equal(initialAccess.data.stats.total, words.length);
    assert.equal((await call("/api/words/export")).status, 200);
  }
  sql(`UPDATE users SET created_at=1 WHERE id='${userId}';`);
  const expiredAccess = await call("/api/challenge");
  assert.equal(expiredAccess.data.trialExpired, true);
  // The signed-out demo and the lapsed trial must agree on how big the free set
  // is. Comparing this response's own freeWordCount against its own stats.total
  // would be the same expression on both sides, because both come from
  // allowedWordIds.size, and would pass even if the free set were wrong.
  assert.equal(expiredAccess.data.stats.total, freeWordCount);
  assert.equal(expiredAccess.data.freeWordCount, freeWordCount);
  assert.equal((await call("/api/billing/checkout", {})).status, 503);
  const freeWords = await call("/api/words");
  assert.equal(freeWords.status, 200);
  assert.equal(freeWords.data.premium, false);
  const emptyCalendar = await call("/api/calendar?month=2024-02");
  assert.equal(emptyCalendar.status, 200);
  assert.equal(emptyCalendar.data.days.length, 29);
  assert.equal(emptyCalendar.data.totals.words, 0);
  assert.equal(emptyCalendar.data.totals.seconds, 0);
  for (const month of ["2024-13", "2024-2", "1999-12", "9999-12", ""]) {
    assert.equal((await call(`/api/calendar?month=${month}`)).status, 400);
  }
  assert.ok(
    freeWords.data.words.every(
      (word) => word.correct === 0 && word.status === "new",
    ),
  );
  assert.equal((await call("/api/words/export")).status, 402);
  assert.equal((await call("/api/words/export?format=print")).status, 402);
  assert.equal(
    (
      await call("/api/auth/login", {
        email: `${stamp}@example.test`,
        password: "incorrect password",
      })
    ).status,
    401,
  );
  sql(
    `INSERT INTO subscriptions (id,user_id,status,period_end,price_id,checked_at) VALUES ('test-${stamp}','${userId}','active',${Math.floor(Date.now() / 1000) + 3600},'',${Date.now()});`,
  );
  const [first, same] = await Promise.all([
    call("/api/challenge", { action: "next", types: ["def"] }),
    call("/api/challenge", { action: "next", types: ["def"] }),
  ]);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.question.id, same.data.question.id);
  const q = first.data.question;
  assert.equal(q.type, "def");
  assert.equal("answer" in q, false);
  const correct = q.choices.indexOf(
    words.find((w) => w.id === q.wordId).definition,
  );
  assert.ok(correct >= 0);
  const answered = await call("/api/challenge", {
    action: "answer",
    id: q.id,
    selected: correct,
    elapsed: 1,
  });
  assert.equal(answered.status, 200);
  assert.equal(answered.data.feedback.correct, true);
  const answeredWord = words.find((word) => word.id === q.wordId);
  for (const field of ["definition", "example", "syn", "ant"]) {
    assert.equal(answered.data.feedback[field], answeredWord[field]);
    assert.equal(
      demo.data.words[0][field],
      words.find((word) => word.id === demo.data.words[0].wordId)[field],
    );
  }
  assert.equal(answered.data.stats.correct, 1);
  const replay = await call("/api/challenge", {
    action: "answer",
    id: q.id,
    selected: correct,
    elapsed: 1,
  });
  assert.equal(replay.data.stats.correct, 1);
  const next = await call("/api/challenge", { action: "next" });
  assert.notEqual(next.data.question.id, q.id);
  assert.equal(
    (
      await call("/api/challenge", {
        action: "answer",
        id: next.data.question.id,
        selected: 4,
        elapsed: 1,
      })
    ).status,
    400,
  );
  const bad = await call("/api/challenge", {
    action: "answer",
    id: "foreign-id",
    selected: 0,
    elapsed: 1,
  });
  assert.equal(bad.status, 404);
  const oldCookie = cookie;
  await call("/api/auth/logout", {});
  assert.equal((await call("/api/auth/me")).data.user, null);
  cookie = "";
  assert.equal((await call("/api/challenge", { action: "next" })).status, 401);
  const login = await call("/api/auth/login", {
    email: `${stamp}@example.test`,
    password,
  });
  assert.equal(login.status, 200);
  cookie = login.cookie.split(";")[0];
  assert.notEqual(cookie, oldCookie);
  const resumed = await call("/api/challenge", { action: "next" });
  assert.equal(resumed.data.question.id, next.data.question.id);
  assert.equal(resumed.data.stats.correct, 1);
  for (const types of [[], ["invalid"]])
    assert.equal(
      (await call("/api/challenge", { action: "next", types })).status,
      400,
    );
  for (const level of [6, -1, 1.5, "curriculum", true])
    assert.equal(
      (await call("/api/challenge", { action: "next", level })).status,
      400,
      `level ${JSON.stringify(level)}`,
    );
  // A chosen level narrows the questions to that level, including level 0.
  // The two levels are used against each other, because "a question from
  // another level cannot earn credit" only means anything when the pending
  // question is known to be of a different level. Asking for level 0 when the
  // pending question happens to be a level 0 one would return that same
  // question, and answering it would be a legitimate 200.
  for (const [level, other] of [
    [0, 4],
    [4, 0],
  ]) {
    const before = await call("/api/challenge", {
      action: "next",
      level: other,
    });
    assert.equal(before.data.question.difficulty, other);
    const scoped = await call("/api/challenge", {
      action: "next",
      level,
    });
    assert.equal(scoped.data.question.difficulty, level);
    assert.notEqual(
      scoped.data.question.id,
      before.data.question.id,
      "changing level retires the pending question",
    );
    // A pending question from another level cannot earn credit.
    assert.equal(
      (
        await call("/api/challenge", {
          action: "answer",
          id: before.data.question.id,
          selected: 0,
          elapsed: 1,
        })
      ).status,
      409,
    );
    const same = await call("/api/challenge", { action: "next", level });
    assert.equal(same.data.question.id, scoped.data.question.id);
  }
  const mixedAgain = await call("/api/challenge", { action: "next" });
  assert.ok(
    [0, 1, 2, 3, 4, 5].includes(mixedAgain.data.question.difficulty),
    "dropping the level selection serves questions from any level again",
  );
  const syn = await call("/api/challenge", { action: "next", types: ["syn"] });
  assert.equal(syn.data.question.type, "syn");
  const synProblem = problems.find(
    (p) => p.id === `syn:${syn.data.question.wordId}`,
  );
  const synIndex = syn.data.question.choices.indexOf(synProblem.answer);
  assert.ok(synIndex >= 0);
  // If a pending question changes type, the old question cannot earn credit.
  const ant = await call("/api/challenge", { action: "next", types: ["ant"] });
  assert.equal(ant.data.question.type, "ant");
  assert.equal(
    (
      await call("/api/challenge", {
        action: "answer",
        id: syn.data.question.id,
        selected: synIndex,
        elapsed: 1,
      })
    ).status,
    409,
  );
  const antProblem = problems.find(
    (p) => p.id === `ant:${ant.data.question.wordId}`,
  );
  const antIndex = ant.data.question.choices.indexOf(antProblem.answer);
  const antonymAnswer = await call("/api/challenge", {
    action: "answer",
    id: ant.data.question.id,
    selected: antIndex,
    elapsed: 1,
  });
  assert.equal(antonymAnswer.data.feedback.correct, true);
  assert.equal(antonymAnswer.data.feedback.answer, antProblem.answer);
  assert.equal(antonymAnswer.data.feedback.type, "ant");
  const syn2 = await call("/api/challenge", { action: "next", types: ["syn"] });
  const syn2Answer = problems.find(
    (p) => p.id === `syn:${syn2.data.question.wordId}`,
  ).answer;
  const wrongIndex = syn2.data.question.choices.findIndex(
    (x) => x !== syn2Answer,
  );
  const wrong = await call("/api/challenge", {
    action: "answer",
    id: syn2.data.question.id,
    selected: wrongIndex,
    elapsed: 1,
  });
  assert.equal(wrong.data.feedback.correct, false);
  assert.equal(wrong.data.feedback.answer, syn2Answer);
  assert.equal(wrong.data.stats.correct, 2);
  const summary = await call("/api/words");
  assert.equal(summary.data.premium, true);
  // The word list is paged, so the total is what says the whole collection is
  // there and the page is one page of it.
  assert.equal(summary.data.total, words.length);
  assert.equal(summary.data.words.length, Math.min(40, words.length));
  assert.ok(
    summary.data.words.every(
      (word) =>
        [0, 1, 2, 3, 4, 5].includes(word.difficulty) && word.letterCount > 0,
    ),
  );
  // The list is paged, so a specific word is found by searching for it rather
  // than by hoping it is on the first page.
  const mistakenPage = await call(
    `/api/words?search=${encodeURIComponent(syn2.data.question.word)}`,
  );
  const mistaken = mistakenPage.data.words.find(
    (word) => word.id === syn2.data.question.wordId,
  );
  assert.ok(mistaken, "the mistaken word must be in its own search result");
  assert.equal(mistaken.mistakes, 1);
  assert.equal(mistaken.status, "practice");
  assert.equal(
    summary.data.words.filter((word) => word.mistakes > 0).length,
    0,
    "and it is not on the first page of an unfiltered list",
  );
  const practicePage = await call("/api/words?filter=practice");
  assert.equal(practicePage.data.total, 1);
  assert.equal(practicePage.data.words[0].id, syn2.data.question.wordId);
  assert.equal(practicePage.data.words[0].status, "practice");
  assert.equal(
    practicePage.data.words[0].reveals,
    0,
    "the reveal count in the summary is a count of reveals, not of attempts",
  );
  const answeredPage = await call(
    `/api/words?search=${encodeURIComponent(q.word)}`,
  );
  assert.equal(answeredPage.data.words[0].id, q.wordId);
  assert.equal(
    answeredPage.data.words[0].correct,
    1,
    "the first answered word records one correct answer",
  );
  const exported = await fetch(origin + "/api/words/export?filter=mistakes", {
    headers: { Cookie: cookie },
  });
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("content-type"), /text\/csv/);
  const csvRows = parseCsv((await exported.text()).replace(/^\uFEFF/, ""));
  assert.equal(csvRows.length, 2);
  assert.equal(csvRows[1][0], mistaken.word);
  const printed = await fetch(
    origin + "/api/words/export?filter=practice&format=print",
    { headers: { Cookie: cookie } },
  );
  assert.equal(printed.status, 200);
  assert.match(await printed.text(), /1 words/);
  const escaped = await fetch(
    origin +
      "/api/words/export?format=print&search=" +
      encodeURIComponent("<script>alert(1)</script>"),
    { headers: { Cookie: cookie } },
  );
  const escapedHtml = await escaped.text();
  assert.ok(!escapedHtml.includes("<script>alert(1)</script>"));
  assert.ok(escapedHtml.includes("&lt;script&gt;"));
  assert.equal((await call("/api/words/export?filter=unknown")).status, 400);
  assert.equal((await call("/api/words/export?format=unknown")).status, 400);
  assert.equal((await call("/api/words/export?level=6")).status, 400);
  const levelExport = await fetch(origin + "/api/words/export?level=5", {
    headers: { Cookie: cookie },
  });
  const levelRows = parseCsv((await levelExport.text()).replace(/^\uFEFF/, ""));
  const levelFive = await call("/api/words?level=5&limit=200");
  assert.equal(levelFive.data.total, levelRows.length - 1);
  assert.ok(levelFive.data.total > 0, "there are level 5 words to export");
  assert.equal(
    levelFive.data.words.length,
    Math.min(200, levelFive.data.total),
    "the level filter is applied to the exported rows, not just the page",
  );
  assert.ok(
    levelRows
      .slice(1)
      .every((row) =>
        row[levelRows[0].indexOf("Difficulty level")].startsWith("Level 5"),
      ),
  );
  const combined = await fetch(
    origin +
      `/api/words/export?filter=mistakes&level=${mistaken.difficulty}&search=${encodeURIComponent(mistaken.word)}`,
    { headers: { Cookie: cookie } },
  );
  assert.equal(
    parseCsv((await combined.text()).replace(/^\uFEFF/, "")).length,
    2,
  );
  // Saved rewards: six fresh correct answers, replay protection and competing purchases.
  assert.equal(wrong.data.stats.rewards.streak, 0);
  let lastPractice;
  const beforeRewards = await call("/api/rewards");
  assert.equal(beforeRewards.status, 200);
  const initialBalance = beforeRewards.data.rewards.balance;
  for (let i = 1; i <= 6; i++) {
    lastPractice = (
      await call("/api/challenge", { action: "next", types: ["def"] })
    ).data.question;
    const expected = words.find(
      (word) => word.id === lastPractice.wordId,
    ).definition;
    const payload = {
      action: "answer",
      id: lastPractice.id,
      selected: lastPractice.choices.indexOf(expected),
      elapsed: 1,
    };
    const answered = await call("/api/challenge", payload);
    assert.equal(answered.status, 200);
    assert.equal(answered.data.feedback.award.total, i % 3 === 0 ? 7 : 2);
    assert.equal(answered.data.stats.rewards.streak, i);
    assert.equal(
      (await call("/api/challenge", payload)).data.stats.rewards.balance,
      answered.data.stats.rewards.balance,
    );
  }
  const earned = await call("/api/rewards");
  assert.equal(earned.data.rewards.balance, initialBalance + 22);
  assert.equal(
    earned.data.periods.today.questions,
    earned.data.periods.all.questions,
  );
  assert.ok(earned.data.periods.today.newWords > 0);
  const keys = [randomUUID(), randomUUID()];
  const purchased = await Promise.all(
    keys.map((requestKey) =>
      call("/api/rewards", { action: "redeem", badgeId: "spark", requestKey }),
    ),
  );
  assert.deepEqual(purchased.map((result) => result.status).sort(), [200, 409]);
  const winner = purchased.findIndex((result) => result.status === 200);
  const repeat = await call("/api/rewards", {
    action: "redeem",
    badgeId: "spark",
    requestKey: keys[winner],
  });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.data.receipt.id, purchased[winner].data.receipt.id);
  assert.equal(repeat.data.rewards.balance, initialBalance + 2);
  assert.equal(repeat.data.receipts.length, 1);
  assert.equal(
    (
      await call("/api/rewards", {
        action: "redeem",
        badgeId: "champion",
        requestKey: keys[winner],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call(
        "/api/rewards",
        { action: "redeem", badgeId: "spark", requestKey: randomUUID() },
        { headers: { Origin: "https://untrusted.example" } },
      )
    ).status,
    403,
  );
  assert.equal(
    (await call("/api/rewards", undefined, { headers: { Cookie: "" } })).status,
    401,
  );
  const owner = randomUUID();
  const tick = {
    action: "time",
    since: Date.now(),
    owner,
    sequence: 1,
    seconds: 0,
  };
  const baseline = await call("/api/rewards", tick);
  assert.equal(baseline.status, 200);
  sql(
    `UPDATE study_clock SET last_at=${Date.now() - 15000} WHERE user_id='${userId}';`,
  );
  const checkpoint = { ...tick, sequence: 2, seconds: 10 };
  const timed = await call("/api/rewards", checkpoint);
  assert.equal(timed.status, 200);
  assert.equal(
    timed.data.periods.all.seconds,
    baseline.data.periods.all.seconds + 10,
  );
  assert.equal(
    (await call("/api/rewards", checkpoint)).data.periods.all.seconds,
    timed.data.periods.all.seconds,
  );
  assert.equal(
    (
      await call("/api/rewards", {
        ...checkpoint,
        owner: randomUUID(),
        sequence: 1,
      })
    ).data.periods.all.seconds,
    timed.data.periods.all.seconds,
  );
  assert.equal(
    (
      await call("/api/rewards", {
        ...checkpoint,
        sequence: 3,
        since: "yesterday",
      })
    ).status,
    400,
  );
  // A rerun of the historic importer must not duplicate any credit or time event.
  sql(`UPDATE users SET rewards_initialized=0 WHERE id='${userId}';`);
  const restored = await call("/api/rewards");
  assert.equal(restored.data.rewards.balance, timed.data.rewards.balance);
  assert.equal(
    restored.data.periods.all.seconds,
    timed.data.periods.all.seconds,
  );
  assert.equal(restored.data.receipts[0].id, repeat.data.receipt.id);
  // Re-create an old three-correct word. Other words are mastered to make selection deterministic.
  const target = "abandon";
  const mastered = words.length - 1;
  const tuples = words
    .map(
      (word) =>
        `('${userId}','${word.id.replaceAll("'", "''")}',${word.id === target ? 3 : 5},0,NULL,${word.id === target ? 0 : 1})`,
    )
    .join(",");
  sql(
    `INSERT INTO progress (user_id,word_id,correct,seen,retry_at,mastered) VALUES ${tuples} ON CONFLICT(user_id,word_id) DO UPDATE SET correct=excluded.correct,mastered=excluded.mastered,retry_at=NULL;`,
  );
  // The lifetime mastered total is a running counter, incremented by a trigger as
  // each word is first mastered, which keeps it to one cheap read per day
  // instead of a scan of the whole progress table. A history written straight
  // into that table therefore has to count itself the way the trigger would
  // have, or the assertions below would be measuring the seed instead of the
  // answer. The word list still derives each word's status from its own row, so
  // the two are checked against each other further down.
  sql(
    `INSERT INTO daily_stats(user_id,day,mastered) VALUES ('${userId}',date('now','localtime'),${mastered}) ON CONFLICT(user_id,day) DO UPDATE SET mastered=mastered+${mastered};`,
  );
  for (const [type, expectedMastered] of [
    ["def", mastered],
    ["syn", words.length],
  ]) {
    const practice = await call("/api/challenge", {
      action: "next",
      types: [type],
    });
    assert.equal(practice.data.question.wordId, target);
    assert.equal(practice.data.question.correctCount, type === "def" ? 3 : 4);
    const expected = problems.find((p) => p.id === `${type}:${target}`).answer;
    const selected = practice.data.question.choices.indexOf(expected);
    const data = {
      action: "answer",
      id: practice.data.question.id,
      selected,
      elapsed: 1,
    };
    const result = await call("/api/challenge", data);
    assert.equal(result.data.feedback.correct, true);
    assert.equal(result.data.stats.mastered, expectedMastered);
    assert.equal(
      (await call("/api/challenge", data)).data.stats.mastered,
      expectedMastered,
    );
    // What this pins is the plumbing, not the data: that the full-access path
    // reads the running counter, and that the word list classifies rows by its
    // own rule. It cannot catch the two disagreeing, because the seed above
    // deliberately made them agree - see migration 0011, which repairs accounts
    // whose mastery history predates the counter.
    const masteredPage = await call("/api/words?filter=mastered&limit=1");
    assert.equal(masteredPage.data.total, expectedMastered);
  }
  assert.equal(
    (
      await call("/api/challenge", {
        action: "next",
        types: ["def", "syn", "ant"],
      })
    ).data.complete,
    true,
  );
  sql(`UPDATE subscriptions SET status='canceled' WHERE user_id='${userId}';`);
  assert.equal((await call("/api/words/export")).status, 402);
  assert.equal((await call("/api/words/export?format=print")).status, 402);
  const afterCancellation = await call("/api/challenge", { action: "next" });
  assert.equal(afterCancellation.status, freeWordCount ? 200 : 402);
  if (freeWordCount) {
    assert.equal(afterCancellation.data.freeTier, true);
    // The free tier counts the whole free set, which is the demo sample plus the
    // words that have no meaning question of their own. Compared against the
    // *demo's* count of the free set rather than this response's own field,
    // which is the same number the stats total is derived from and would make
    // the assertion a tautology.
    assert.equal(afterCancellation.data.stats.total, freeWordCount);
    if (afterCancellation.data.question)
      // Any question type at all, so this is checked against the free set and
      // not against the meaning-question sample, which is one word short.
      assert.ok(
        words.some(
          (word) => word.id === afterCancellation.data.question.wordId,
        ),
        "a free-tier question must come from the collection",
      );
  }
  // Calendar history remains available after membership lapses. Repeated words
  // count once per day/month, and midnight study ticks split between dates.
  const otherCalendarUser = `calendar-other-${stamp}`;
  sql(
    `INSERT INTO users(id,email,password,created_at,rewards_initialized) VALUES('${otherCalendarUser}','${otherCalendarUser}@example.test','unused',0,1);`,
  );
  try {
    for (const [suffix, day, word, owner] of [
      ["a", "2024-02-28", "calendar-repeat", userId],
      ["b", "2024-02-29", "calendar-repeat", userId],
      ["c", "2024-02-29", "calendar-repeat", userId],
      ["d", "2024-02-29", "calendar-second", userId],
      ["e", "2024-03-01", "outside-month", userId],
      ["f", "2024-02-29", "other-user-word", otherCalendarUser],
    ]) {
      const attempt = `calendar-${stamp}-${suffix}`;
      const time = Date.parse(`${day}T12:00:00Z`);
      sql(`INSERT INTO attempts(id,user_id,word_id,choices,created_at,answered_at,selected,is_correct) VALUES('${attempt}','${owner}','${word}','[]',${time},${time},-1,0);
      INSERT INTO learning_events(attempt_id,user_id,word_id,created_at,day,correct,revealed,eligible,mastered) VALUES('${attempt}','${owner}','${word}',${time},'${day}',0,1,0,0);`);
    }
    sql(
      `INSERT INTO study_ticks(id,user_id,created_at,seconds,day,previous_day,since_midnight) VALUES('calendar-tick-${stamp}','${userId}',1709164830000,60,'2024-02-29','2024-02-28',30);`,
    );
    const calendar = await call("/api/calendar?month=2024-02");
    assert.equal(calendar.status, 200);
    assert.equal(calendar.data.timezone, "Europe/London");
    assert.equal(calendar.data.days.length, 29);
    assert.equal(calendar.data.totals.words, 2);
    assert.equal(calendar.data.totals.questions, 4);
    assert.equal(calendar.data.totals.seconds, 60);
    assert.equal(calendar.data.totals.studyDays, 2);
    assert.equal(calendar.data.days[27].words, 1);
    assert.equal(calendar.data.days[28].words, 2);
    assert.equal(calendar.data.days[28].questions, 3);
    assert.equal(calendar.data.days[28].newWords, 1);
    assert.equal(calendar.data.days[27].seconds, 30);
    assert.equal(calendar.data.days[28].seconds, 30);
    assert.equal(calendar.data.days[0].questions, 0);
  } finally {
    sql(`DELETE FROM users WHERE id='${otherCalendarUser}';`);
  }
  console.log(
    "PASS: accounts, CSRF, membership, all three question types, filters, replaced-question protection, correct/wrong answers, replay safety, saved progress, mastery evidence and per-level targets, calendar history and cancellation.",
  );
} finally {
  if (userId)
    sql(
      `DELETE FROM subscriptions WHERE user_id='${userId}'; DELETE FROM users WHERE id='${userId}';`,
    );
  nodeDatabase?.close();
}

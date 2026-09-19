import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { words } from "../scripts/load-word-bank.mjs";
const origin = process.env.TEST_ORIGIN || "http://localhost:5173";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("Integration tests only run against local development.");
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
  const demo = await call("/api/challenge");
  assert.equal(demo.status, 200);
  assert.equal(demo.data.words.length, Math.min(5, words.length));
  assert.equal(demo.data.stats.total, words.length);
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
  assert.equal((await call("/api/challenge", { action: "next" })).status, 402);
  assert.equal((await call("/api/billing/checkout", {})).status, 503);
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
    call("/api/challenge", { action: "next" }),
    call("/api/challenge", { action: "next" }),
  ]);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.question.id, same.data.question.id);
  const q = first.data.question;
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
  sql(`UPDATE subscriptions SET status='canceled' WHERE user_id='${userId}';`);
  assert.equal((await call("/api/challenge", { action: "next" })).status, 402);
  console.log(
    "PASS: registration, CSRF, cookies, login/logout, membership gating, concurrent questions, answer replay, saved progress, invalid answers, cancellation.",
  );
} finally {
  if (userId)
    sql(
      `DELETE FROM subscriptions WHERE user_id='${userId}'; DELETE FROM users WHERE id='${userId}';`,
    );
}

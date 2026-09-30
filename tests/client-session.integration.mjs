/**
 * The client path, run for real.
 *
 * The claim this whole refactor rests on is that a child can answer without the
 * database. Asserting that from the UI would only show it for one child, one
 * question, on one run. So this drives the actual modules - `loadSession` and
 * `ClientSession`, the ones the practice page uses - against the actual server,
 * and counts every request.
 *
 * The count is the point. Not "the code looks local": a number. Six answers and
 * a save, and the server is asked twice - once for the state, once for the bank
 * it names - and then not again until the child presses Save.
 *
 * It also checks the thing a parent would notice if it were wrong: that the
 * balance the child watched move is the balance the server ends up holding.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const origin = process.env.TEST_ORIGIN || "http://127.0.0.1:5173";
const local = ["localhost", "127.0.0.1"].includes(new URL(origin).hostname);

/**
 * Stand in for the two things a browser adds to a same-origin request and node's
 * `fetch` does not: the session cookie, and `Origin` (which the flush endpoint
 * requires). Nothing in the client code sets either, and that is correct - so
 * they are added here rather than by making production carry a test's concerns.
 */
const browserDefaults = (cookie) => (init) => ({
  ...init,
  headers: { Cookie: cookie, Origin: origin, ...(init && init.headers) },
});

const sql = () => {
  if (!process.env.TEST_NODE_DB)
    throw Error("set TEST_NODE_DB to the local preview SQLite database");
  return new DatabaseSync(process.env.TEST_NODE_DB);
};

async function register() {
  const response = await fetch(origin + "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({
      email: `session-${randomUUID()}@example.test`,
      password: `Test-only-${randomUUID()}`,
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return {
    id: body.user.id,
    cookie: (response.headers.get("set-cookie") || "").split(";")[0],
  };
}

test(
  "a child answers six questions and the server is asked twice",
  { skip: !local },
  async () => {
    if (!local || !process.env.TEST_NODE_DB) return;
    const { loadSession, ClientSession } = await import(
      "../lib/client/session.ts"
    );
    const db = sql();
    db.prepare("DELETE FROM rate_limits").run();
    const user = await register();
    // Seeded into `globalThis` because the client helper takes its own headers
    // from an options bag and there is nowhere else to put a cookie in node.
    const calls = [];
    const realFetch = globalThis.fetch;
    // Two jobs, both standing in for the browser. Relative URLs are resolved
    // against the document in a browser and are not valid in node, so they are
    // resolved against the origin here. And every request is counted, because
    // "the code looks local" is not the claim - the number of requests is.
    const withDefaults = browserDefaults(user.cookie);
    globalThis.fetch = (url, init) => {
      const target = new URL(String(url), origin);
      calls.push(target.pathname);
      return realFetch(target, withDefaults(init));
    };

    try {
      // No headers passed: a real browser does not set the cookie or `Origin`
      // either, and the shim adds both. Anything less would be testing a path the
      // child never takes.
      const loaded = await loadSession();
      const session = new ClientSession(loaded.engine, loaded.stats);
      let pending = 0;
      session.watch((count) => (pending = count));

      const bootstrap = calls.length;
      assert.equal(
        bootstrap,
        2,
        `bootstrapping should be two requests, one for the state and one for the bank; got ${calls.join(", ")}`,
      );

      // The balance the child starts with, and what they should end up with.
      const starting = session.stats.rewards.balance;
      const earned = [];
      for (let i = 0; i < 6; i++) {
        const question = session.next();
        assert.ok(question, `question ${i}: nothing to answer`);
        const result = session.answer(
          question.choices.indexOf(question.answer),
        );
        assert.ok(result, `question ${i}: nothing to grade`);
        earned.push(result.feedback.award.total);
      }

      // This is the assertion the refactor exists for.
      assert.equal(
        calls.length,
        bootstrap,
        `answering must not touch the server, but these requests were made: ${calls
          .slice(bootstrap)
          .join(", ")}`,
      );
      assert.equal(pending, 6, "six answers are waiting to be saved");
      assert.equal(
        session.dirty,
        true,
        "and the Save button has something to press",
      );
      assert.equal(
        session.stats.rewards.balance,
        starting + earned.reduce((a, b) => a + b, 0),
        "the balance moves while the child answers, not after a flush",
      );

      // Now the save, which is the one request that is allowed to be a write.
      await session.flush();
      assert.equal(
        calls.length,
        bootstrap + 1,
        "saving is one request, however many answers it carries",
      );
      assert.equal(pending, 0, "and the queue is empty afterwards");
      assert.equal(session.dirty, false, "so the Save button greys out");
      assert.equal(session.lastError, null, "and nothing went wrong");

      // The server agrees, which is the claim a parent would check.
      const wallet = db
        .prepare("SELECT balance FROM credit_wallets WHERE user_id=?")
        .get(user.id);
      assert.equal(
        wallet.balance,
        starting + earned.reduce((a, b) => a + b, 0),
        "the balance the child watched is the balance the server holds",
      );
      const answered = db
        .prepare(
          "SELECT COUNT(*) AS c FROM attempts WHERE user_id=? AND answered_at IS NOT NULL",
        )
        .get(user.id).c;
      assert.equal(answered, 6, "all six answers were written");
      const events = db
        .prepare("SELECT COUNT(*) AS c FROM learning_events WHERE user_id=?")
        .get(user.id).c;
      assert.equal(events, 6, "and each produced an award event");

      // A second press with an empty queue must not be a write. A child who is
      // unsure whether their work is safe will press it again.
      const afterSave = calls.length;
      const again = await session.flush();
      assert.equal(calls.length, afterSave, "an empty save sends nothing");
      void again;

      // And the practice page must not be reached for either. If the UI still
      // asked for a question the old way, this would pass and the latency would
      // still be there - so assert it was never called.
      assert.ok(
        !calls.some((path) => path.startsWith("/api/challenge")),
        `the practice page must not be asked for questions; it was asked for ${calls
          .filter((p) => p.startsWith("/api/challenge"))
          .join(", ")}`,
      );

      db.prepare("DELETE FROM users WHERE id=?").run(user.id);
    } finally {
      globalThis.fetch = realFetch;
      db.close();
    }
  },
);

test(
  "a save that fails keeps its answers and says so",
  { skip: !local },
  async () => {
    if (!local || !process.env.TEST_NODE_DB) return;
    const { ClientSession } = await import("../lib/client/session.ts");
    const db = sql();
    db.prepare("DELETE FROM rate_limits").run();
    const user = await register();
    const { loadSession } = await import("../lib/client/session.ts");
    const realFetch = globalThis.fetch;
    // Every URL is resolved the way a browser resolves it, and only the save is
    // broken - so the failure under test is a save that does not arrive, not a
    // session that cannot start.
    const withDefaults = browserDefaults(user.cookie);
    // A dropped connection, which is the case that matters: the child did the
    // work, the request never arrived, and there is no way for them to get the
    // answers back. So the queue has to keep them.
    globalThis.fetch = (url, init) => {
      const target = new URL(String(url), origin);
      if (target.pathname === "/api/flush")
        return Promise.reject(new TypeError("network error"));
      return realFetch(target, withDefaults(init));
    };
    let session;
    let pending = 0;
    try {
      const loaded = await loadSession();
      session = new ClientSession(loaded.engine, loaded.stats);
      session.watch((count) => (pending = count));

      const question = session.next();
      session.answer(question.choices.indexOf(question.answer));
      assert.equal(pending, 1, "one answer is queued");

      // A save that does not arrive. The answers must survive, because a child
      // who loses a sitting to a dropped connection has no way to get it back.
      await session.flush();
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.ok(
      session.lastError,
      "a failed save is reported rather than swallowed",
    );
    assert.equal(session.dirty, true, "and the answers are still queued");
    assert.equal(pending, 1, "so the Save button is still lit");
    const written = db
      .prepare(
        "SELECT COUNT(*) AS c FROM attempts WHERE user_id=? AND answered_at IS NOT NULL",
      )
      .get(user.id).c;
    assert.equal(written, 0, "and nothing was half-written");

    db.prepare("DELETE FROM users WHERE id=?").run(user.id);
    db.close();
  },
);

/**
 * Every migration on disk must be in the drizzle journal.
 *
 * This is the check that would have caught the four migrations nobody applied.
 * A `.sql` file that is not in `drizzle/meta/_journal.json` is a migration that
 * exists, that a developer reading the directory will believe is part of the
 * schema, and that every tool-driven deploy silently skips. There is no warning
 * at deploy time and nothing in the logs afterwards; the only symptom is the app
 * failing later on a column it thought was there.
 *
 * Which is what happened. `users.expiry_date` is read by `membership()` on every
 * authenticated request, so a database without 0012 does not degrade - every
 * signed-in request is a SQLite error about a missing column. The journal stopped
 * at 0009, four migrations were missing from it, and nothing noticed.
 *
 * The companion check - which of those missing things breaks the app rather than
 * one feature - is `tests/schema-deploy-drift.mjs`, run by `npm run check:deploy`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = readdirSync("drizzle")
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.replace(/\.sql$/, ""))
  .sort();

test("drizzle/ holds migrations and nothing else", () => {
  // Every tool that applies this directory applies *every* `.sql` in it, in
  // filename order, with no way to mark one as not-a-migration. So a helpful
  // query file dropped in here is a migration that runs against production at the
  // next deploy. There is one in `scripts/` for exactly this reason, and this test
  // is what keeps it there.
  const strays = readdirSync("drizzle").filter(
    (f) => !f.endsWith(".sql") && f !== "meta" && !f.startsWith("."),
  );
  assert.deepEqual(
    strays,
    [],
    `drizzle/ is applied wholesale; move these elsewhere: ${strays.join(", ")}`,
  );
});

test("every migration on disk is in the journal", () => {
  const journal = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8"),
  );
  const tags = journal.entries.map((e) => e.tag);
  const missing = files.filter((tag) => !tags.includes(tag));
  assert.deepEqual(
    missing,
    [],
    `these migrations exist but are not journalled, so a tool-driven deploy skips them: ${missing
      .map((m) => `drizzle/${m}.sql`)
      .join(", ")}`,
  );
});

test("the journal and the directory agree in both directions", () => {
  const journal = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8"),
  );
  const tags = journal.entries.map((e) => e.tag);
  // A journalled tag with no file is the other half of the same problem: the
  // tool reports a migration as applied when there was nothing to run, which is
  // how a schema change goes missing in the other direction.
  assert.deepEqual(
    tags.filter((tag) => !files.includes(tag)),
    [],
    "the journal lists migrations that do not exist on disk",
  );
});

test("the journal is in order and its indexes are dense", () => {
  // Wrangler applies what the journal lists, in the order it lists it. An index
  // that is not its position means something was inserted in the middle, which
  // reorders a deploy for a database that has already run some of them.
  const journal = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8"),
  );
  const tags = journal.entries.map((e) => e.tag);
  assert.deepEqual(tags, files, "the journal is not in the same order as the files");
  journal.entries.forEach((entry, i) =>
    assert.equal(entry.idx, i, `${entry.tag} has index ${entry.idx}, expected ${i}`),
  );
  for (let i = 1; i < journal.entries.length; i++)
    assert.ok(
      journal.entries[i].when > journal.entries[i - 1].when,
      `${journal.entries[i].tag} is not stamped after ${journal.entries[i - 1].tag}`,
    );
});

test("the declared schema is what the migrations build", () => {
  // The other half of the problem: a column added to `db/schema.ts` and used by the
  // app but never added by a migration is a deploy that builds cleanly and then
  // fails at runtime, which is worse than a migration that was simply not
  // journalled, because nothing about the deploy looks wrong.
  //
  // The check exits non-zero when `db/schema.ts` and the migrations disagree, and
  // prints the SQL lines it matched. Those matches are a heuristic - a same-named
  // column on another table matches too - so read them before changing anything.
  const result = spawnSync(
    process.execPath,
    ["tests/schema-deploy-drift.mjs"],
    { encoding: "utf8" },
  );
  assert.equal(
    result.status,
    0,
    `db/schema.ts and the migrations disagree:\n${result.stdout}`,
  );
});

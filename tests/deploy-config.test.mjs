/**
 * The generated wrangler config has to point at the migrations, and be seen to.
 *
 * `wrangler d1 migrations apply` reads `migrations_dir` from the D1 binding and
 * resolves it relative to the config file. vinext writes that config at build
 * time and puts no `migrations_dir` in it, so the deploy script amends it
 * afterwards. Two things can then go wrong quietly:
 *
 *   - the key lands somewhere wrangler never reads, so `apply` finds no
 *     migrations and exits zero. The deploy reports success and the database is
 *     left exactly as it was, which is the failure this whole change is about.
 *   - the path is right for the working directory and wrong for the config's, so
 *     it resolves to a directory that does not exist.
 *
 * Both are checked here by running the real script against a fixture, so the
 * check does not need a machine that can run workerd - which is most of them.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = "scripts/patch-wrangler-migrations.mjs";

/** A throwaway repository-shaped tree: a config where the build left it, and migrations. */
function fixture({
  bindings = {
    d1: [{ binding: "DB", database_name: "minewords", database_id: "x" }],
  },
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "wrangler-patch-"));
  mkdirSync(join(root, "dist/server"), { recursive: true });
  mkdirSync(join(root, "drizzle"), { recursive: true });
  writeFileSync(
    join(root, "dist/server/wrangler.json"),
    JSON.stringify(bindings, null, 2),
  );
  for (const name of ["0000_a.sql", "0001_b.sql"])
    writeFileSync(join(root, `drizzle/${name}`), "SELECT 1;");
  return root;
}

const patch = (root) =>
  spawnSync(process.execPath, [join(process.cwd(), script)], {
    cwd: root,
    encoding: "utf8",
  });

const patched = (root) =>
  JSON.parse(readFileSync(join(root, "dist/server/wrangler.json"), "utf8"));

test("the migrations directory is set, and resolves from the config", () => {
  const root = fixture();
  const result = patch(root);
  assert.equal(result.status, 0, result.stderr);
  const binding = patched(root).d1[0];
  assert.equal(binding.migrations_dir, "../../drizzle");
  assert.equal(
    binding.migrations_table,
    "d1_migrations",
    "the applied-migration ledger needs a name the deploy can read back",
  );
  // The path is relative to dist/server, which is where the build put the config,
  // so the naive value "drizzle" would resolve to dist/server/drizzle and find
  // nothing. Asserted by resolving it the way wrangler does rather than by
  // comparing strings, because a string that looks right is not the failure mode
  // being guarded - a string that looks right and points nowhere is.
  assert.ok(
    existsAt(join(root, "dist/server", binding.migrations_dir, "0000_a.sql")),
    `${binding.migrations_dir} must resolve to the migrations`,
  );
});

test("the documented d1_databases shape is handled as well as the flat one", () => {
  // vinext emits `d1`. Wrangler documents `d1_databases`. Only one is right for a
  // given config, and writing the key into the wrong one produces a config that
  // reads as correct and points at nothing.
  const root = fixture({
    bindings: {
      d1_databases: [
        { binding: "DB", database_name: "minewords", database_id: "x" },
      ],
    },
  });
  const result = patch(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(patched(root).d1_databases[0].migrations_dir, "../../drizzle");
});

test("every binding is pointed, not just the first", () => {
  const root = fixture({
    bindings: {
      d1: [
        { binding: "DB", database_name: "main", database_id: "x" },
        { binding: "LOGS", database_name: "logs", database_id: "y" },
      ],
    },
  });
  assert.equal(patch(root).status, 0);
  for (const binding of patched(root).d1)
    assert.equal(
      binding.migrations_dir,
      "../../drizzle",
      `${binding.binding} was skipped`,
    );
});

test("a config with no D1 binding fails rather than deploying quietly", () => {
  // The dangerous case: no binding means no key can be written, and a script that
  // exited zero there would let the deploy continue with migrations unapplied.
  const root = fixture({ bindings: { name: "app" } });
  const result = patch(root);
  assert.notEqual(
    result.status,
    0,
    "a config with no database must stop the deploy",
  );
  assert.match(result.stderr, /no D1 binding/i);
});

test("a missing migrations directory fails rather than deploying quietly", () => {
  const root = fixture();
  // Delete the migrations the build was supposed to produce. The path still
  // resolves to nothing, and that has to be an error.
  rmDir(join(root, "drizzle"));
  const result = patch(root);
  assert.notEqual(
    result.status,
    0,
    "an absent migrations directory must stop the deploy",
  );
  assert.match(result.stderr, /migrations_dir .* does not resolve/i);
});

test("an empty migrations directory fails, because it means the build lost them", () => {
  const root = fixture();
  rmDir(join(root, "drizzle"));
  mkdirSync(join(root, "drizzle"), { recursive: true });
  const result = patch(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no migrations found/i);
});

// Small local helpers, so this file does not grow a dependency on anything.
function existsAt(path) {
  try {
    return readFileSync(path, "utf8").length >= 0;
  } catch {
    return false;
  }
}
function rmDir(path) {
  spawnSync("rm", ["-rf", path]);
}

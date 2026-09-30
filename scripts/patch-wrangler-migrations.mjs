/**
 * Point the generated wrangler config at the migrations directory.
 *
 * `npm run build` writes `dist/server/wrangler.json`, and vinext puts no
 * `migrations_dir` in it. Without that key, `wrangler d1 migrations apply` has
 * nothing to read and either applies nothing or refuses to run - and it fails
 * quietly enough that a deploy can look successful while the database is left
 * exactly as it was. That is the failure this whole change exists to prevent, so
 * the key is asserted here rather than hoped for.
 *
 * Amending the generated file after every build is deliberate. The alternative is
 * a second, hand-maintained wrangler config, and two configs for one Worker drift
 * apart the moment one of them is edited. This one is derived from the build that
 * is about to ship, so it cannot describe a different Worker than the one being
 * deployed.
 *
 * The assertion at the end is the part that matters: it re-reads the file it just
 * wrote, so a future change to vinext's output shape fails here, loudly, rather
 * than turning into a deploy that quietly skips migrations.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const path = "dist/server/wrangler.json";
const config = JSON.parse(readFileSync(path, "utf8"));

// Wrangler resolves `migrations_dir` relative to the config file, and the config
// this build produced lives in dist/server/. So the honest value is not "drizzle"
// - that resolves to dist/server/drizzle, which does not exist, and wrangler's
// response to it is a warning followed by an error, having applied nothing. A
// path that is wrong in that direction fails loudly, which is the good case, but
// the deploy should not be relying on that.
const migrationsDir = relative(dirname(path), resolve("drizzle")) || ".";

// Checked here rather than left to the deploy, because the failure this prevents
// is a deploy that reports success and leaves the database alone. Every path is
// resolved the way wrangler resolves it - from the config file, not from the
// working directory - because those are different places and only one of them is
// the one that matters.
const resolved = resolve(dirname(path), migrationsDir);
if (!existsSync(resolved))
  throw new Error(
    `migrations_dir "${migrationsDir}" does not resolve from ${dirname(path)} to anything that exists`,
  );
const found = readdirSync(resolved).filter((f) => f.endsWith(".sql"));
if (!found.length) throw new Error(`no migrations found in ${migrationsDir}`);

// Wrangler accepts either the flat `d1` shape vinext emits or the documented
// `d1_databases`. Both are handled, because guessing wrong here would mean the
// key lands somewhere wrangler never reads and the deploy looks fine.
const bindings = config.d1_databases ?? config.d1;
if (!Array.isArray(bindings) || !bindings.length)
  throw new Error(
    `${path} has no D1 binding, so migrations cannot be pointed at a database. Found keys: ${Object.keys(config).join(", ")}`,
  );

for (const binding of bindings) {
  binding.migrations_dir = migrationsDir;
  binding.migrations_table = "d1_migrations";
}

// The Worker name, when the environment says which one.
//
// The build takes the name from package.json, so it is `minewords-blue-book`. A
// Worker connected to a repository through Cloudflare's Git integration is named
// after the *repository* - `eleven-plus-vocabulary-website` here - and the two are
// different Workers. Deploying the generated config without this would upload a
// second Worker, leave the live one on the last commit, and report success.
//
// It is not defaulted either way: guessing is what causes the problem, so an
// unset WORKER_NAME leaves the config alone and the deploy script prints the name
// it is about to act on, which is the point at which a mismatch is visible.
const workerName = process.env.WORKER_NAME;
if (workerName) config.name = workerName;

writeFileSync(path, JSON.stringify(config, null, 2) + "\n");

// Read it back rather than trusting the object in memory.
const written = JSON.parse(readFileSync(path, "utf8"));
const check = written.d1_databases ?? written.d1 ?? [];
for (const binding of check) {
  if (binding.migrations_dir !== migrationsDir)
    throw new Error(
      `the migrations directory did not survive the write: ${JSON.stringify(binding)}`,
    );
  if (!existsSync(resolve(dirname(path), binding.migrations_dir)))
    throw new Error(
      `${binding.migrations_dir} does not resolve from ${dirname(path)}, so wrangler would apply nothing`,
    );
}

const name = JSON.parse(readFileSync(path, "utf8")).name;
console.log(
  `  ${check.length} D1 binding(s) read ${found.length} migrations from ${migrationsDir}, tracked in d1_migrations`,
);
console.log(
  `  target Worker: ${name}${workerName ? " (from WORKER_NAME)" : " (from package.json)"}`,
);

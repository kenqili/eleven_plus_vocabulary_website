/**
 * Is the schema the app was written against the schema a deploy produces?
 *
 * `db/schema.ts` is what the application was written against, and the migrations
 * are what a database is actually built from. They are maintained by hand here,
 * so the question worth asking on every deploy is whether they still agree.
 *
 * It matters more than usual because the failure is silent in one direction and
 * loud in the other. A migration that is on disk but missing from
 * `drizzle/meta/_journal.json` is skipped by any tool that reads the journal, with
 * no warning. What the app then does depends on the column: `users.expiry_date`
 * is read by `membership()` on every authenticated request, and a column that
 * does not exist is a SQLite error rather than a null, so the whole signed-in app
 * stops working. A table only the webhook uses fails later and only for parents
 * who pay.
 *
 * So this reports the difference, and separates the difference into what breaks
 * the app now and what breaks one feature later, by looking for each missing
 * name in the application source rather than trusting a list written by hand.
 *
 * It looks both ways, and the second direction is the one that had been missing.
 * The obvious gap - declared but not built - breaks the deploy, so it was caught.
 * The reverse - built but not declared - breaks nothing on the deploy, because
 * the migrations do build it, and so it went unnoticed for a whole feature: a
 * table the app writes to and a column it reads that no tool reading
 * `db/schema.ts` could see. A table only the app uses is the quieter of the two
 * failures, and it is the one a one-directional check cannot see.
 *
 * Nothing here touches production. It is a statement of what is missing, so the
 * list can be checked against a real database by hand.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, readdirSync as _r } from "node:fs";

/** Every table and column the migrations create, and which migration made each. */
function buildFrom(files) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const madeBy = new Map(); // "table.column" -> migration tag
  for (const file of files) {
    const tag = file.replace(/\.sql$/, "");
    db.exec(
      readFileSync(`drizzle/${file}`, "utf8")
        .split("--> statement-breakpoint")
        .join(""),
    );
    for (const { name } of db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all()) {
      if (!madeBy.has(name)) madeBy.set(name, tag);
      for (const { name: column } of db
        .prepare("SELECT name FROM pragma_table_info(?)")
        .all(name))
        if (!madeBy.has(`${name}.${column}`))
          madeBy.set(`${name}.${column}`, tag);
    }
  }
  return { db, madeBy };
}

/** The tables and columns `db/schema.ts` declares, which is the app's own view. */
function declared() {
  const source = readFileSync("db/schema.ts", "utf8");
  const tables = new Map();
  // Each generated table is `sqliteTable("name", {` followed by an object of
  // column builders, so the two patterns pair up. Good enough for a file that is
  // machine-written in one style, and it fails loudly rather than silently if the
  // style ever changes.
  const blocks = source.split(/sqliteTable\(\s*"/).slice(1);
  for (const block of blocks) {
    const name = block.slice(0, block.indexOf('"'));
    const columns = new Set();
    for (const match of block.matchAll(
      /\b(?:text|integer|real|blob)\(\s*"([^"]+)"/g,
    ))
      columns.add(match[1]);
    tables.set(name, columns);
  }
  return tables;
}

/** Where in the application a name is used, so "hot" is derived and not assumed. */
function referenced(name) {
  const roots = ["lib", "app", "components"];
  const files = [];
  const walk = (dir) => {
    for (const entry of _r(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
    }
  };
  roots.forEach(walk);
  const hits = [];
  // Match the bare word, so a bare column in a SQL string is found and not just
  // the dotted form, which is what a naive search for "users.expiry_date" misses.
  // The matched line is reported rather than just its location, because this is a
  // heuristic: a TypeScript property called `streak` matches `users.streak`, and
  // only the line itself shows that. A reader who cannot check the evidence
  // cannot use the report.
  const word = new RegExp(
    `\\b${name.replace(".", "\\.")}\\b|\\b${name.split(".").pop()}\\b`,
  );
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    for (const [i, line] of lines.entries())
      if (
        word.test(line) &&
        /SELECT|INSERT|UPDATE|DELETE|FROM|JOIN|\.prepare|sql`/i.test(line)
      )
        hits.push({ at: `${file}:${i + 1}`, line: line.trim().slice(0, 92) });
  }
  return hits;
}

const all = readdirSync("drizzle")
  .filter((f) => f.endsWith(".sql"))
  .sort();
const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
const journalled = new Set(journal.entries.map((e) => e.tag));

const complete = buildFrom(all);
const fromJournal = buildFrom(
  all.filter((f) => journalled.has(f.replace(/\.sql$/, ""))),
);

const schemaOf = (db) => {
  const out = new Map();
  for (const { name } of db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all()) {
    out.set(
      name,
      new Set(
        db
          .prepare("SELECT name FROM pragma_table_info(?)")
          .all(name)
          .map((c) => c.name),
      ),
    );
  }
  return out;
};

const want = declared();
const have = schemaOf(fromJournal.db);
const full = schemaOf(complete.db);

const missing = [];
for (const [table, columns] of want) {
  if (!have.has(table)) {
    missing.push({ table, column: null, all: [...columns] });
    continue;
  }
  for (const column of columns)
    if (!have.get(table).has(column)) missing.push({ table, column, all: [] });
}

/**
 * The other direction: built by a migration, absent from `db/schema.ts`.
 *
 * The walk above cannot see this at all, and the blindness is not subtle once
 * stated - it only ever asks "is everything declared present?", so a table or a
 * column a migration created and the schema file never learned about has no
 * representation to be compared with. It is invisible whether it arrived with
 * the commit that added the migration or was dropped from the file by a later
 * one, which is how `email_verifications` and `users.email_verified_at` were
 * missing for a whole feature: the deploy was correct and the gate agreed,
 * because the gate was not looking.
 *
 * Production does not need anything applied for this - the migrations are the
 * migrations, and the database is right. What is wrong is `db/schema.ts`, which
 * is what the application is written against: a table the app writes to and a
 * column it reads are both invisible to every tool that reads the file, so
 * neither can be type-checked, and the next migration generated from the file
 * has no idea they exist. So it is reported as drift, and it fails the gate like
 * the other direction does, because a deploy check that only catches half the
 * disagreement is the kind that gets trusted for both halves.
 */
const undeclared = [];
for (const table of [...have.keys()].sort())
  if (!want.has(table)) undeclared.push(table);
// Then column by column, but only inside a table both sides have: a table
// missing from the schema file is already reported whole, and listing its
// columns as well would be the same fact three times over.
for (const table of [...have.keys()].sort())
  if (want.has(table))
    for (const column of [...have.get(table)].sort())
      if (!want.get(table).has(column)) undeclared.push(`${table}.${column}`);

console.log(
  "Schema declared in db/schema.ts vs schema a journal-driven deploy builds",
);
console.log("=".repeat(72));
console.log();
console.log(
  `  journal covers   ${journalled.size} of ${all.length} migrations (last: ${[...journalled].pop()})`,
);
for (const file of all)
  if (!journalled.has(file.replace(/\.sql$/, "")))
    console.log(`  NOT JOURNALLED   drizzle/${file}`);
console.log();

if (undeclared.length) {
  console.log(
    `  UNDECLARED (${undeclared.length}) - a migration creates these and db/schema.ts does not:`,
  );
  for (const label of undeclared) {
    console.log(`    ${label}`);
    const hits = referenced(label);
    for (const hit of hits.slice(0, 2))
      console.log(`      used at  ${hit.at}  ${hit.line}`);
    if (hits.length > 2) console.log(`      ...and ${hits.length - 2} more`);
  }
  console.log();
  console.log(
    "  Nothing to apply to production - the migrations already build these, and",
  );
  console.log(
    "  the database is right. db/schema.ts is what is behind: declare the table",
  );
  console.log(
    "  or column, so the app can be written against it and the next generated",
  );
  console.log("  migration starts from what a deploy actually produces.");
  console.log();
}
if (!missing.length) {
  console.log(
    "  Nothing missing. The declared schema is what a deploy produces.",
  );
} else {
  const cold = [];
  const hot = [];
  for (const gap of missing) {
    const label = gap.column ? `${gap.table}.${gap.column}` : gap.table;
    const hits = referenced(label);
    // Say which migration creates it, and say so plainly when none does. Falling
    // back to the table's own migration would blame `0000` for a column that
    // `0000` has never heard of, which is exactly the wrong thing to read.
    const by = complete.madeBy.get(label) ?? "NO MIGRATION CREATES THIS";
    (hits.length ? hot : cold).push({ label, hits, by });
  }
  console.log(`  MISSING, with a SQL reference in the app (${hot.length}):`);
  for (const { label, hits, by } of hot) {
    console.log(`    ${label}`);
    console.log(`      added by ${by}`);
    for (const hit of hits.slice(0, 2))
      console.log(`      ${hit.at}  ${hit.line}`);
    if (hits.length > 2) console.log(`      ...and ${hits.length - 2} more`);
    console.log();
  }
  console.log(
    "  Read those lines before acting. A match can be a same-named column on",
  );
  console.log(
    "  another table, or a TypeScript property, and only the line shows which.",
  );
  console.log();
  console.log();
  console.log(`  MISSING and not referenced yet (${cold.length}) - dormant:`);
  for (const { label, by } of cold)
    console.log(`    ${label.padEnd(26)} added by ${by}`);
}
console.log();
// A non-zero exit makes this usable as a gate, which is the only way it gets run
// before a deploy rather than after one. The printed lines are still the point -
// a reader has to judge the matches - so the detail is on stdout, not stderr.
// Either direction is drift: a deploy that is missing something and a schema
// file that is behind are different problems with the same answer, and the gate
// is only worth running before a deploy if it fails on both.
const drifted = missing.length || undeclared.length;
console.log(
  missing.length
    ? "Production needs these applied before the current code is served."
    : undeclared.length
      ? "Production is right. db/schema.ts is behind, and needs the rows above declared."
      : "Nothing to apply. db/schema.ts and the migrations agree.",
);
process.exitCode = drifted ? 1 : 0;

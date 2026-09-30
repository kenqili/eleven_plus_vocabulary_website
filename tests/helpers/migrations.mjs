/**
 * Read `drizzle/0000_baseline.sql`, and apply parts of it.
 *
 * The baseline is one file because the fifteen files it replaced were a history,
 * not a schema - see its header. The cost of that is that a test can no longer
 * express "the database as it stood before this change, then this change", which
 * is the only honest way to test a backfill: a migration that reads rows and
 * writes columns is not observable on a database that was already in its final
 * shape.
 *
 * So the baseline keeps a comment naming each section it absorbed, and this
 * splits on those. The comments are the only thing standing between a test and
 * the ability to check a backfill, which is why the baseline's header asks for
 * them to be kept.
 */
import { readFileSync } from "node:fs";

const BASELINE = "drizzle/0000_baseline.sql";

/** Each `-- 00NN_name` section, in order, with the SQL beneath it. */
function sections() {
  const source = readFileSync(BASELINE, "utf8");
  const marker = /^-- (\d{4}_[a-z0-9_]+)\s*$/gm;
  // Both offsets are kept, because they are different numbers: `index` is where
  // the marker comment starts and `from` is where the SQL beneath it starts.
  // Keeping only `from` and then reaching for the next `index` gets
  // `undefined`, which `slice` reads as "to the end of the file" - so every
  // section quietly contains every section after it.
  const starts = [...source.matchAll(marker)].map((m) => ({
    tag: m[1],
    index: m.index,
    from: m.index + m[0].length,
  }));
  return starts.map((start, i) => ({
    tag: start.tag,
    sql: source.slice(start.from, starts[i + 1] ? starts[i + 1].index : source.length),
  }));
}

const has = (tag) => {
  const found = sections().find((section) => section.tag === tag);
  if (!found)
    throw new Error(
      `${BASELINE} has no section called ${tag}. It has: ${sections()
        .map((s) => s.tag)
        .join(", ")}`,
    );
  return found.sql;
};

/** Every section up to but not including `tag` - the schema before that change. */
export const before = (tag) => {
  const all = sections();
  const at = all.findIndex((section) => section.tag === tag);
  if (at < 0) has(tag); // throws, naming the sections that do exist
  return all
    .slice(0, at)
    .map((section) => section.sql)
    .join("\n");
};

/** Just that one section - the change itself, with nothing after it. */
export const only = (tag) => has(tag);

/** The whole file, for a test that only asserts something is present in it. */
export const all = () => readFileSync(BASELINE, "utf8");

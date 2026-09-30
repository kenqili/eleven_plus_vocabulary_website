// Regenerates the question bank and fails the build if it had been out of date.
//
// The bank is a build product and it is committed, so it cannot drift by hand.
// But it can drift by accident: someone edits a word's definition, or a source
// CSV, and the bank still holds last week's questions until someone remembers to
// run the generator. A vocabulary app serving a stale definition is the exact
// failure the move to a generated bank exists to prevent, so it is a build
// failure rather than something to remember.
//
// It is committed deliberately. If it were ignored, a fresh clone would have no
// bank at all, the tests that assert the distractor rules would have nothing to
// assert against, and a review could not see a change to a question. The
// staleness is the point of committing a build product.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const bank = new URL("../data/problem-bank.json", import.meta.url);
const generator = new URL("./generate-problem-bank.mjs", import.meta.url);
const clientGenerator = new URL("./generate-client-bank.mjs", import.meta.url);
const clientManifest = new URL("../data/client-bank.json", import.meta.url);

const before = readFileSync(bank);
execFileSync(
  process.execPath,
  ["--experimental-strip-types", generator.pathname],
  {
    stdio: "ignore",
  },
);
const after = readFileSync(bank);

/**
 * What the bank says, with the generation date left out.
 *
 * The generator stamps the day it ran into meta.generated, so comparing raw
 * bytes meant the check failed on every build that ran after the day the bank
 * was generated, whether or not any word, question or piece of help had
 * changed. That is a calendar comparison in the shape of a drift check, and it
 * catches nothing: it reports a stale bank on a build with no edits at all, and
 * it would keep reporting one the day after the fix. The date is a record of
 * when the content was produced, not part of the content, so it is compared
 * apart. Everything else, including every word, every question and its options,
 * is still compared exactly, and a real edit still fails the build.
 */
const content = (bytes) => {
  const parsed = JSON.parse(bytes.toString("utf8"));
  if (parsed.meta) delete parsed.meta.generated;
  return JSON.stringify(parsed);
};

const bankCurrent = content(before) === content(after);

// The browser's copy of the bank, and the manifest that names it, are derived
// from the bank. They can only fall behind if someone runs the bank generator on
// its own, which `npm run build` does not do - it chains both. But a stale
// manifest is not merely a stale file, it is a URL that points at nothing, and
// the symptom is a 404 on a child's first question rather than anything a test
// would notice.
const manifestBefore = readFileSync(clientManifest, "utf8");
execFileSync(process.execPath, [clientGenerator.pathname], { stdio: "ignore" });
const clientCurrent = manifestBefore === readFileSync(clientManifest, "utf8");

if (bankCurrent && clientCurrent) {
  console.log("question bank is current");
} else {
  if (!bankCurrent)
    console.error(
      "\nThe question bank was out of date and has now been regenerated.\n" +
        "It is committed, so commit the change next to whatever you edited:\n\n" +
        "  git add data/problem-bank.json\n",
    );
  if (!clientCurrent)
    console.error(
      "\nThe client's copy of the bank was out of date and has now been regenerated.\n" +
        "Commit it too, or /api/progress will name a file that is not in the deploy:\n\n" +
        "  git add data/client-bank.json\n",
    );
  process.exitCode = 1;
}

// Generates every question the app can ever ask, once, at build time.
//
// Why this exists: the app used to build all 11,017 questions from the word
// list every time the module loaded, which cost 1.3 seconds of compute. On
// Cloudflare Workers the first request on a cold isolate pays for loading the
// module, and a plan with a ten millisecond budget cannot afford that. It also
// held about 70 MB of objects resident in every isolate, for data that never
// changes.
//
// Every question here is deterministic. The word, cloze, synonym and antonym
// choices were already built by a seeded walk over a fixed order, so they have
// always been the same for the same word. Only the definition question chose
// its wrong options at request time, because the pool was keyed on the attempt
// id so that two asks of the same word would differ.
//
// That is a real requirement and this keeps it: each word gets a pool of
// DEF_POOL definitions, and the request path shuffles that pool and takes three.
// So the pool is now fixed and the variation comes from the shuffle, which
// costs nothing.
//
// The output is deliberately a flat array-of-arrays rather than an array of
// objects. Repeated object keys are what make a large JSON file slow to parse,
// and the keys are read once at generation time instead of on every isolate
// start for the life of the deployment.
import { readFileSync, writeFileSync } from "node:fs";
import { mergeWordSources } from "../lib/challenge/words.ts";
import {
  buildDistractorContext,
  pickDefinitionDistractors,
  parseProblemCsv,
  blankExample,
  hasWholeWord,
  CHOICES_PER_PROBLEM,
} from "../lib/challenge/problems.ts";
import levels from "../data/word-levels/levels.json" with { type: "json" };

// The plain-language help is what a child actually reads, and it is a separate
// rewrite of each definition. It lives here rather than in its own file so it
// is carried in the same parse, and so it is regenerated whenever the bank is:
// ten words had help written against a definition that had since been corrected,
// and nothing was checking. The help for "queer" was still teaching the sense
// that correcting the word had specifically set out to stop teaching.
const help = JSON.parse(
  readFileSync(new URL("../data/learning/word-help.json", import.meta.url), "utf8"),
);

/**
 * How many wrong definitions to keep per word.
 *
 * Four is the minimum that lets a shuffle give three different sets, which is
 * why it is not three: with exactly three, every repeat shows the same question.
 */
const DEF_POOL = 6;
const WRONG_CHOICES = CHOICES_PER_PROBLEM - 1;

const read = (name) =>
  readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8");

const words = mergeWordSources({
  flash_card_1: read("flash_card_1.csv"),
  flash_card_2: read("flash_card_2.csv"),
  blue_book: read("blue_book.csv"),
  vocabquest: read("vocabquest.csv"),
  curriculum: read("curriculum.csv"),
});

const levelOf = (id) => levels.words[id]?.difficulty ?? 3;
const context = buildDistractorContext(words, levelOf);
const started = Date.now();

/** Words whose definition contains the word, which cannot be a question. */
const selfNaming = new Set(
  words.filter((word) => hasWholeWord(word.definition, word.word)).map((w) => w.id),
);

/** The four types the CSVs already carry, kept as they are. */
const fromCsv = [
  ...parseProblemCsv(read("syn.csv"), "syn", words),
  ...parseProblemCsv(read("ant.csv"), "ant", words),
];

/** Options for a question whose answer is the word, from the bank at large. */
const wordDistractors = (word) => {
  // A cloze blanks the word out of a sentence, so a synonym of the answer among
  // the options would give it away. Those are already excluded from the
  // question's own context, and using the word's key here keeps a word question
  // and its cloze from sharing an identical set.
  const out = [];
  const seen = new Set([word.word.toLowerCase()]);
  for (const band of [levelOf(word.id), levelOf(word.id) + 1, levelOf(word.id) - 1]) {
    const pool = context.byLevel.get(band) ?? [];
    for (const candidate of pool) {
      if (out.length >= WRONG_CHOICES) break;
      if (context.blocked.get(word.id)?.has(candidate.id)) continue;
      const key = candidate.word.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(candidate.word);
    }
    if (out.length >= WRONG_CHOICES) break;
  }
  return out;
};

const rows = [];
const skipped = { def: 0, word: 0, cloze: 0, syn: 0, ant: 0 };

for (const word of words) {
  // A definition question asks which meaning belongs to the word, so a
  // definition containing the word gives the answer away.
  if (!selfNaming.has(word.id)) {
    const pool = pickDefinitionDistractors(`def:${word.id}`, word, context, DEF_POOL);
    if (pool.length >= WRONG_CHOICES)
      rows.push([
        word.id,
        "def",
        `Choose the definition for '${word.word}'.`,
        word.definition,
        pool,
      ]);
    else skipped.def += 1;
  } else skipped.def += 1;

  if (!selfNaming.has(word.id)) {
    const options = wordDistractors(word);
    if (options.length === WRONG_CHOICES)
      rows.push([word.id, "word", word.definition, word.word, options]);
    else skipped.word += 1;
  } else skipped.word += 1;

  const blanked = word.example ? blankExample(word.example, word.word) : null;
  if (blanked) {
    const options = wordDistractors(word);
    if (options.length === WRONG_CHOICES)
      rows.push([word.id, "cloze", blanked, word.word, options]);
    else skipped.cloze += 1;
  } else skipped.cloze += 1;
}

for (const problem of fromCsv) {
  if (problem.type === "syn") skipped.syn += 1;
  else skipped.ant += 1;
  rows.push([
    problem.wordId,
    problem.type,
    problem.prompt,
    problem.answer,
    problem.choices.filter((choice) => choice !== problem.answer),
  ]);
}

// The word data the request path needs, so it never has to re-parse the source
// CSVs. A parent's own words are added at runtime and never appear here.
const wordRows = words.map((word) => [
  word.id,
  word.word,
  word.definition,
  word.example,
  word.syn,
  word.ant,
  levelOf(word.id),
  // Carried through because the difficulty snapshot is attributed to a
  // licence by source, and a parent reading the word list is told where a word
  // came from.
  word.source,
  // The plain-language help and the contextual clue, so answering a question
  // needs no second file. A word with no recorded help falls back to its own
  // definition, which is what storyMeaning did with it anyway.
  help[word.id]?.meaning ?? "",
  help[word.id]?.clue ?? "",
]);

// The difficulty snapshot, in the same file. It was a separate 336 KB JSON that
// the request path loaded to answer one question, when every row already carries
// its own level. Two files became one parse.
const levelRows = Object.entries(levels.words).map(([id, value]) => [
  id,
  value.difficulty,
]);

// The free collection is chosen by frequency within a difficulty band, and that
// ordering is fixed by the snapshot rather than by anything at request time. It
// is resolved here so the request path does not have to load a second data file
// to know which word to offer a child first.
const freeOrder = [...words]
  .sort((a, b) => {
    const bandA = levelOf(a.id);
    const bandB = levelOf(b.id);
    if (bandA !== bandB) return bandA - bandB;
    const zipfA = levels.words[a.id]?.frequencyZipf ?? -1;
    const zipfB = levels.words[b.id]?.frequencyZipf ?? -1;
    if (zipfB !== zipfA) return zipfB - zipfA;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })
  .map((word) => word.id);

const output = {
  meta: {
    generated: new Date().toISOString().slice(0, 10),
    choicesPerProblem: CHOICES_PER_PROBLEM,
    definitionPool: DEF_POOL,
    wordCount: wordRows.length,
    problemCount: rows.length,
    // Column order, so the loader allocates nothing to read the keys.
    wordColumns: [
      "id",
      "word",
      "definition",
      "example",
      "syn",
      "ant",
      "difficulty",
      "source",
      "help",
      "clue",
    ],
    problemColumns: ["wordId", "type", "prompt", "answer", "choices"],
  },
  words: wordRows,
  problems: rows,
  levels: levelRows,
  freeOrder,
};

const path = new URL("../data/problem-bank.json", import.meta.url);
writeFileSync(path, JSON.stringify(output));
const bytes = readFileSync(path).length;

const byType = {};
for (const [, type] of rows) byType[type] = (byType[type] ?? 0) + 1;

console.log(
  `generated ${rows.length} problems for ${wordRows.length} words in ${Date.now() - started} ms`,
);
for (const [type, count] of Object.entries(byType).sort())
  console.log(`  ${type.padEnd(6)} ${String(count).padStart(5)}`);
console.log(
  `  ${(bytes / 1048576).toFixed(2)} MB written to data/problem-bank.json`,
);
if (Object.values(skipped).some((n) => n > 0))
  console.log(
    `  skipped for want of distinct options: def ${skipped.def}, word ${skipped.word}, cloze ${skipped.cloze}`,
  );

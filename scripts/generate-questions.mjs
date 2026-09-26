import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { words } from "./load-word-bank.mjs";
import { similarDefinitions, parseCsv } from "../lib/challenge/words.ts";

const normalize = (value) => value.normalize("NFKC").trim().toLowerCase();
const terms = (value) =>
  value
    .split(";")
    .map(normalize)
    .filter((x) => x && !/^[—–-]$/.test(x));
const byId = new Map(words.map((word) => [word.id, word]));
const overridesPath = "data/question-review/overrides.json";
const overrides = existsSync(overridesPath)
  ? JSON.parse(readFileSync(overridesPath, "utf8"))
  : {};
const related = new Map(
  words.map((word) => [
    word.id,
    new Set([word.id, ...terms(word.syn), ...terms(word.ant)]),
  ]),
);
// Exclude direct and reverse relations, plus one-hop shared relations, from distractors.
for (const word of words)
  for (const other of words) {
    if (related.get(other.id).has(word.id)) related.get(word.id).add(other.id);
  }
function hash(value) {
  let n = 2166136261;
  for (const c of value) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
}
function csvCell(value) {
  return '"' + String(value).replaceAll('"', '""') + '"';
}
const report = {
  totalWords: words.length,
  generated: {},
  excluded: [],
  preferredLibraryAnswers: {},
};
mkdirSync("data/question-review", { recursive: true });
for (const type of ["syn", "ant"]) {
  const rows = [];
  // Add new vocabulary without changing questions already reviewed and in use.
  const retained = process.argv.includes("--append")
    ? new Map(parseCsv(readFileSync(`data/${type}.csv`, "utf8")).slice(1).map((row) => [row[4], row]))
    : new Map();
  let libraryAnswers = 0;
  for (const word of words) {
    if (retained.has(word.id)) {
      const row = retained.get(word.id);
      rows.push(row);
      if (byId.has(normalize(row[2]))) libraryAnswers++;
      continue;
    }
    const key = `${type}:${word.id}`;
    const fix = overrides[key] || {};
    const candidates = terms(word[type]).filter((x) => x !== word.id);
    if (fix.exclude || (!candidates.length && !fix.answer)) {
      report.excluded.push({
        word: word.word,
        type,
        reason: fix.reason || "No supplied relation",
      });
      continue;
    }
    const answer =
      fix.answer || candidates.find((x) => byId.has(x)) || candidates[0];
    if (
      type === "ant" &&
      (normalize(answer) === `dis${word.id}` || word.id === `dis${normalize(answer)}`)
    ) {
      report.excluded.push({
        word: word.word,
        type,
        reason: "Direct dis- prefix pair excluded from practice at user request.",
      });
      continue;
    }
    const excluded = new Set([
      ...related.get(word.id),
      answer,
      ...(related.get(answer) || []),
      ...(fix.excludeOptions || []),
    ]);
    for (const term of [...excluded])
      for (const connection of related.get(term) || [])
        excluded.add(connection);
    const candidatePool = words.filter(
      (other) =>
        !excluded.has(other.id) &&
        !similarDefinitions(word.definition, other.definition) &&
        (!byId.has(answer) ||
          !similarDefinitions(byId.get(answer).definition, other.definition)),
    );
    const distractors =
      fix.distractors ||
      candidatePool
        .sort((a, b) => hash(key + a.id) - hash(key + b.id))
        .slice(0, 3)
        .map((w) => w.word);
    if (distractors.length !== 3) throw Error(`Not enough distractors: ${key}`);
    const options = [...distractors];
    options.splice(hash(key) % 4, 0, answer);
    if (new Set(options.map(normalize)).size !== 4)
      throw Error(`Repeated option: ${key}`);
    const relation = type === "syn" ? "synonym" : "antonym";
    const problem =
      fix.problem ||
      `Choose the ${relation} for '${word.word}'${fix.sense ? ` (${fix.sense})` : ""}.`;
    rows.push([problem, JSON.stringify(options), answer, type, word.id]);
    if (byId.has(normalize(answer))) libraryAnswers++;
  }
  writeFileSync(
    `data/${type}.csv`,
    [
      "problem,options,answer,syn/ant,word",
      ...rows.map((row) => row.map(csvCell).join(",")),
    ].join("\n") + "\n",
  );
  report.generated[type] = rows.length;
  report.preferredLibraryAnswers[type] = libraryAnswers;
}
writeFileSync(
  "data/question-review/generation-report.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));

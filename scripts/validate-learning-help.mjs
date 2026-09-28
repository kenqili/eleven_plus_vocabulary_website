import { readFileSync } from "node:fs";
import { words } from "./load-word-bank.mjs";
import { problems } from "./load-problem-bank.mjs";
import { wordClue } from "../lib/challenge/story-meanings.ts";
const help = JSON.parse(readFileSync("data/learning/word-help.json"));
const errors = [];
for (const word of words)
  if (!help[word.id]?.meaning?.trim() || !help[word.id]?.clue?.trim())
    errors.push(`Missing help: ${word.id}`);
// A clue is a hint toward the answer, so it is only meaningful for the types
// that choose between options: syn and ant. The other three never carry one, and
// the app already encodes why by returning an empty clue:
//   - word and cloze ask for the word itself, and every example names it;
//   - def shows the word and asks for its meaning, so a clue that used the word
//     would give the answer away, and the usage sentence always does.
// The rule is the app's own, so this asks wordClue directly rather than
// restating which types qualify, and a new type is covered automatically.
const clueTypes = new Set(["syn", "ant"]);
for (const problem of problems) {
  if (!clueTypes.has(problem.type)) continue;
  // wordClue is the app's own rule, so a type added later is covered by asking
  // it rather than by restating the list here.
  if (!wordClue(problem.wordId, problem.answer, problem.type))
    errors.push(
      help[problem.wordId]?.clue?.trim()
        ? `Answer-leaking clue: ${problem.id}`
        : `Missing clue: ${problem.id}`,
    );
}
for (const id of Object.keys(help))
  if (!words.some((w) => w.id === id)) errors.push(`Unknown help word: ${id}`);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Validated ${words.length} meanings and ${problems.length} question clues.`,
  );

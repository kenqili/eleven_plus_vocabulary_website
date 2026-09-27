import { readFileSync } from "node:fs";
import { words } from "./load-word-bank.mjs";
import { problems } from "./load-problem-bank.mjs";
import { wordClue, typeAllowsClue } from "../lib/challenge/story-meanings.ts";
const help = JSON.parse(readFileSync("data/learning/word-help.json"));
const errors = [];
for (const word of words)
  if (!help[word.id]?.meaning?.trim() || !help[word.id]?.clue?.trim())
    errors.push(`Missing help: ${word.id}`);
for (const problem of problems)
  // The type decides whether a clue is offered at all: a word or cloze question
  // asks for the word, and its example sentence names it, so the app suppresses
  // the clue there. Checking without the type flagged every one of those as a
  // leak, which they are not.
  if (typeAllowsClue(problem.type) && !wordClue(problem.wordId, problem.answer, problem.type))
    errors.push(`Missing or answer-leaking clue: ${problem.id}`);
for (const id of Object.keys(help))
  if (!words.some((w) => w.id === id)) errors.push(`Unknown help word: ${id}`);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Validated ${words.length} meanings and ${problems.length} question clues.`,
  );

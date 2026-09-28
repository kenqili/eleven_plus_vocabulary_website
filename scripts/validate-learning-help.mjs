// Every word needs the plain-language help a child reads, and every question
// that can offer a clue must actually have one that does not give the answer
// away. Both the help and the clue are now carried on the word in the bank, so
// this reads them from there rather than from a second file that could drift.
import { words, problems } from "../lib/challenge/bank.ts";
import { wordClue } from "../lib/challenge/story-meanings.ts";

// Only the types that choose between options get a clue. A word or cloze
// question asks for the word itself, and every example sentence names it, so a
// clue would hand over the answer; wordClue returns an empty string for those
// and the app shows no clue button. A definition question shows the word and
// asks for its meaning, and the usage sentence always names the word, so it too
// carries no clue. Asking wordClue keeps this file in step with the app rather
// than restating the list.
const CLUE_TYPES = new Set(["syn", "ant"]);
const errors = [];
const byId = new Map(words.map((word) => [word.id, word]));

for (const word of words) {
  if (!word.help?.trim()) errors.push(`Missing help: ${word.id}`);
  if (!word.clue?.trim()) errors.push(`Missing clue: ${word.id}`);
}

let withClue = 0;
for (const problem of problems) {
  if (!CLUE_TYPES.has(problem.type)) continue;
  const word = byId.get(problem.wordId);
  if (!word) {
    errors.push(`Question for an unknown word: ${problem.id}`);
    continue;
  }
  const clue = wordClue(word, problem.answer, problem.type);
  if (!clue) {
    // Either no clue was written, or the written one repeats the correct
    // option, which would hand the answer over as help.
    errors.push(
      word.clue?.trim()
        ? `Answer-leaking clue: ${problem.id}`
        : `Missing clue: ${problem.id}`,
    );
    continue;
  }
  withClue += 1;
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${words.length} meanings and clues, and ${withClue} clued questions.`,
  );
}

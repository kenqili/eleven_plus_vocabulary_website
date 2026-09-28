import { words, sources } from "./load-word-bank.mjs";
import { SOURCE_ORDER, parseWordCsv } from "../lib/challenge/words.ts";
import { choicesForProblem, problems } from "../lib/challenge/bank.ts";
// Questions are generated at build time now, so the check is no longer that a
// word can produce four choices on demand but that every shipped question can
// be rendered: enough distinct options, the answer among them, and the answer
// present exactly once. choicesForProblem throws on the first of those, and a
// second check catches a repeated answer.
let rendered = 0;
for (const problem of problems) {
  const choices = choicesForProblem(problem);
  const answer = choices.filter(
    (choice) => choice.toLowerCase() === problem.answer.toLowerCase(),
  ).length;
  if (answer !== 1)
    throw new Error(
      `${problem.type}:${problem.wordId} shows its answer ${answer} times, not once.`,
    );
  rendered += 1;
}
console.log(
  `Validated ${words.length} words and rendered ${rendered} questions, each with four distinct choices and one correct answer.`,
);
for (const source of SOURCE_ORDER) {
  const loaded = parseWordCsv(sources[source], source).length;
  const kept = words.filter((word) => word.source === source).length;
  console.log(
    `${source}: ${loaded} loaded, ${kept} kept, ${loaded - kept} duplicates removed`,
  );
}

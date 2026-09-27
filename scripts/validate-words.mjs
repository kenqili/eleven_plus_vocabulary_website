import { words, sources } from "./load-word-bank.mjs";
import {
  SOURCE_ORDER,
  parseWordCsv,
  choicesFor,
} from "../lib/challenge/words.ts";
import { buildDistractorContext } from "../lib/challenge/problems.ts";
// choicesFor now draws through the shared distractor context, so the context is
// built once and each word is keyed the way the app keys a real attempt. Passing
// the bare word array here handed it an array in place of the context.
const context = buildDistractorContext(words);
for (const word of words) choicesFor(word, context, `validate:${word.id}`);
console.log(`Validated ${words.length} words with four distinct choices each.`);
for (const source of SOURCE_ORDER) {
  const loaded = parseWordCsv(sources[source], source).length;
  const kept = words.filter((word) => word.source === source).length;
  console.log(
    `${source}: ${loaded} loaded, ${kept} kept, ${loaded - kept} duplicates removed`,
  );
}

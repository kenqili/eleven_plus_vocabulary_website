import { words, sources } from "./load-word-bank.mjs";
import {
  SOURCE_ORDER,
  parseWordCsv,
  choicesFor,
} from "../lib/challenge/words.ts";
for (const word of words) choicesFor(word, words);
console.log(`Validated ${words.length} words with four distinct choices each.`);
for (const source of SOURCE_ORDER) {
  const loaded = parseWordCsv(sources[source], source).length;
  const kept = words.filter((word) => word.source === source).length;
  console.log(
    `${source}: ${loaded} loaded, ${kept} kept, ${loaded - kept} duplicates removed`,
  );
}

import { readFileSync } from "node:fs";
import { words } from "./load-word-bank.mjs";
import {
  parseStories,
  validateStories,
  storyLength,
} from "../lib/challenge/stories.ts";
const levels = JSON.parse(
  readFileSync(
    new URL("../data/word-levels/levels.json", import.meta.url),
    "utf8",
  ),
);
const stories = parseStories(
  [0, 1, 2, 3, 4, 5].map((level) =>
    readFileSync(
      new URL(`../data/stories/level-${level}.txt`, import.meta.url),
      "utf8",
    ),
  ),
);
const errors = validateStories(stories, words, levels.words);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  for (let level = 0; level <= 5; level++) {
    const group = stories.filter((story) => story.level === level);
    console.log(
      `Level ${level}: ${group.length} stories, ${new Set(group.flatMap((s) => s.wordIds)).size} vocabulary words, ${Math.min(...group.map(storyLength))}–${Math.max(...group.map(storyLength))} words per story.`,
    );
  }
  console.log(
    `All ${stories.length} stories pass coverage, target count, level, bold marker and question validation.`,
  );
}

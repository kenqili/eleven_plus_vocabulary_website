import level0 from "@/data/stories/level-0.txt?raw";
import level1 from "@/data/stories/level-1.txt?raw";
import level2 from "@/data/stories/level-2.txt?raw";
import level3 from "@/data/stories/level-3.txt?raw";
import level4 from "@/data/stories/level-4.txt?raw";
import level5 from "@/data/stories/level-5.txt?raw";
import levels from "@/data/word-levels/levels.json";
import { words } from "@/lib/challenge/bank";
import { parseStories, validateStories } from "@/lib/challenge/stories";
import { database } from "./db";
import { seedStories } from "./story-store";

const stories = parseStories([level0, level1, level2, level3, level4, level5]);
const errors = validateStories(stories, words, levels.words);
if (errors.length)
  throw new Error(`Invalid story library: ${errors.join(" ")}`);

/**
 * How many stories there are, for the landing page to quote.
 *
 * Counted from the same parsed list the library is seeded from, so it cannot say
 * one thing while the site serves another. The landing page used to say only "more
 * are being added", which a parent reads as "a handful" — and with 120 of them the
 * number is the strongest fact the section has.
 */
export const STORY_COUNT = stories.length;
let startup: Promise<void> | undefined;
export function initializeStoryLibrary() {
  return (startup ??= Promise.resolve()
    .then(() => seedStories(database(), stories))
    .catch((error) => {
      startup = undefined;
      throw error;
    }));
}

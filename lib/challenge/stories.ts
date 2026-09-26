import type { Difficulty } from "./difficulty.ts";
import type { Word } from "./words.ts";

export const STORY_CREDITS = 10;
/** A story marks between these many distinct vocabulary words. */
export const MIN_STORY_TARGETS = 15;
export const MAX_STORY_TARGETS = 30;
/** Every level keeps at least this many stories even when it has few words. */
export const MIN_STORIES_PER_LEVEL = 10;
/** Story numbers are zero-padded to two digits, so 99 is the ceiling per level. */
export const MAX_STORIES_PER_LEVEL = 99;
/**
 * Stories a level needs before each of its words can be marked somewhere.
 * Derived from the word count so a bigger word bank simply needs more
 * stories, instead of failing an exact count.
 */
export const storiesForWords = (wordCount: number) =>
  Math.max(MIN_STORIES_PER_LEVEL, Math.ceil(wordCount / MAX_STORY_TARGETS));
/** Story ids are `level-{0-5}-{01..99}`, so the API and client share one rule. */
export const STORY_ID = /^level-[0-5]-(0[1-9]|[1-9]\d)$/;
export type Story = {
  id: string;
  level: Difficulty;
  number: number;
  title: string;
  summary: string;
  wordIds: string[];
  paragraphs: string[];
  question: { prompt: string; options: string[]; answer: number };
};
export type ReadingProgress = {
  seconds: number;
  completedAt: number | null;
};
export type StoryCard = Pick<
  Story,
  "id" | "level" | "number" | "title" | "summary"
> & {
  wordCount: number;
  minutes: number;
  completed: boolean;
  started: boolean;
  bookmark: import("../server/reading-position").ReadingBookmark | null;
};
export type StoryDetail = Omit<Story, "question"> & {
  question: Omit<Story["question"], "answer">;
  vocabulary: Word[];
  signedIn: boolean;
  bookmarkScope: string;
  bookmark: import("../server/reading-position").ReadingBookmark | null;
  progress: ReadingProgress;
  minimumSeconds: number;
};
export const storyLength = (story: Story) =>
  story.paragraphs.join(" ").replaceAll("**", "").split(/\s+/).length;
// A modest eligibility floor, not a countdown or a claim about reading ability.
export const storyMinimumSeconds = (story: Story) =>
  Math.max(45, Math.ceil(storyLength(story) / 5));

export function parseStories(texts: string[]): Story[] {
  return texts.flatMap((text) => {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed))
      throw new Error("Stories must be a JSON array.");
    return parsed as Story[];
  });
}
export function validateStories(
  stories: Story[],
  words: Word[],
  levels: Record<string, { difficulty: number }>,
): string[] {
  const errors: string[] = [];
  const bank = new Map(words.map((word) => [word.id, word]));
  if (stories.length < 6 * MIN_STORIES_PER_LEVEL)
    errors.push(
      `Expected at least ${6 * MIN_STORIES_PER_LEVEL} stories, one set per level.`,
    );
  if (new Set(stories.map((story) => story.id)).size !== stories.length)
    errors.push("Duplicate story IDs.");
  for (let level = 0; level <= 5; level++) {
    const group = stories.filter((story) => story.level === level);
    const levelWords = words.filter(
      (word) => levels[word.id]?.difficulty === level,
    );
    const required = storiesForWords(levelWords.length);
    if (group.length < required)
      errors.push(
        `Level ${level}: expected at least ${required} stories to cover ${levelWords.length} words, found ${group.length}.`,
      );
    const numbers = group.map((story) => story.number).sort((a, b) => a - b);
    if (!numbers.every((number, index) => number === index + 1))
      errors.push(
        `Level ${level}: story numbers must run 1–${group.length} with no gaps.`,
      );
    const covered = new Set(group.flatMap((story) => story.wordIds));
    for (const word of words)
      if (levels[word.id]?.difficulty === level && !covered.has(word.id))
        errors.push(`Level ${level}: missing ${word.id}.`);
  }
  for (const story of stories) {
    const prefix = `${story.id}: `;
    if (
      story.id !==
        `level-${story.level}-${String(story.number).padStart(2, "0")}` ||
      story.number < 1 ||
      story.number > MAX_STORIES_PER_LEVEL
    )
      errors.push(prefix + "Invalid identity.");
    const targets = new Set(story.wordIds);
    if (
      targets.size !== story.wordIds.length ||
      targets.size < MIN_STORY_TARGETS ||
      targets.size > MAX_STORY_TARGETS
    )
      errors.push(
        prefix +
          `Expected ${MIN_STORY_TARGETS}–${MAX_STORY_TARGETS} distinct target words.`,
      );
    const marked = [
      ...story.paragraphs.join("\n").matchAll(/\*\*([^*]+)\*\*/g),
    ].map((match) => match[1].toLowerCase());
    for (const id of targets) {
      if (!bank.has(id) || levels[id]?.difficulty !== story.level)
        errors.push(prefix + `Wrong level or unknown word: ${id}.`);
      if (!marked.includes(id))
        errors.push(prefix + `Missing bold target: ${id}.`);
    }
    for (const id of marked)
      if (!targets.has(id))
        errors.push(prefix + `Unexpected bold word: ${id}.`);
    if (
      !story.title?.trim() ||
      !story.summary?.trim() ||
      story.paragraphs.length < 3 ||
      storyLength(story) < 300 ||
      storyLength(story) > 650
    )
      errors.push(
        prefix + "Needs a title, summary and 300–650 words of paragraphs.",
      );
    if (
      !story.question?.prompt ||
      story.question.options.length !== 3 ||
      new Set(story.question.options).size !== 3 ||
      !Number.isInteger(story.question.answer) ||
      story.question.answer < 0 ||
      story.question.answer > 2
    )
      errors.push(prefix + "Invalid comprehension question.");
  }
  return errors;
}

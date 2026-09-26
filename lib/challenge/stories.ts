import type { Difficulty } from "./difficulty.ts";
import type { Word } from "./words.ts";

export const STORY_CREDITS = 10;
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
  if (stories.length !== 60) errors.push("Expected 60 stories.");
  if (new Set(stories.map((story) => story.id)).size !== stories.length)
    errors.push("Duplicate story IDs.");
  for (let level = 0; level <= 5; level++) {
    const group = stories.filter((story) => story.level === level);
    if (group.length !== 10)
      errors.push(`Level ${level}: expected 10 stories.`);
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
      story.number > 10
    )
      errors.push(prefix + "Invalid identity.");
    const targets = new Set(story.wordIds);
    if (
      targets.size !== story.wordIds.length ||
      targets.size < 15 ||
      targets.size > 30
    )
      errors.push(prefix + "Expected 15–30 distinct target words.");
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

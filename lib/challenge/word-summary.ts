import {
  DIFFICULTY_LEVELS,
  type DifficultyInfo,
  type DifficultyFilter,
} from "./difficulty.ts";
import {
  CUMULATIVE_FLOOR,
  recallTarget,
  runTarget,
} from "./mastery.ts";
import type { Word } from "./words.ts";
export const LEARNING_STATUS = {
  new: "New",
  learning: "Learning",
  practice: "Slipped on · last 30 days",
  mastered: "Mastered",
} as const;
export type LearningStatus = keyof typeof LEARNING_STATUS;
export type WordSummary = Omit<Word, "source"> &
  DifficultyInfo & {
    correct: number;
    seen: number;
    mistakes: number;
    reveals: number;
    lastPractised: number | null;
    status: LearningStatus;
    /** True for a word the parent added, so the list can label it. */
    custom?: boolean;
  };
export type WordSummaryData = {
  words: WordSummary[];
  premium: boolean;
  trial?: boolean;
  trialDaysRemaining?: number;
  trialEndsAt?: number | null;
  /**
   * A paid term, as opposed to a trial. Present so the export note can tell a
   * family who has bought a year from one still inside its trial, instead of
   * telling both of them how many days of trial they have left.
   */
  active?: boolean;
  /** Whole days left on the paid term; zero when nothing is paid for. */
  daysRemaining?: number;
  trialExpired?: boolean;
  freeWordCount?: number;
  /** How many words the account may see in total, for "n of m". */
  collection: number;
  /** How many words matched the current filters. */
  total: number;
  /** Words per learning status, so the progress cards need no list to count. */
  counts: Record<string, number>;
  /** The same tallies per difficulty band, for the per-level summary bar. */
  levelCounts: Record<string, Record<string, number>>;
  /**
   * One character per word per band, in collection order: m for mastered, l
   * for learning (including slipped), n for new. The heatmap renders cells
   * from this instead of the browser holding all 2,249 entries - about two
   * kilobytes for the whole collection.
   */
  heatmap: Record<string, string>;
};
export function learningStatus(progress: {
  mastered: boolean;
  correct: number;
  seen: number;
  mistakes: number;
  reveals: number;
}): LearningStatus {
  if (progress.mastered) return "mastered";
  if (progress.mistakes + progress.reveals > 0) return "practice";
  return progress.seen > 0 || progress.correct > 0 ? "learning" : "new";
}
export const WORD_FILTERS = {
  all: "All words",
  practice: "Slipped on · last 30 days",
  mistakes: "Slipped on most",
  revealed: "Revealed answers",
  new: "New",
  learning: "Learning",
  mastered: "Mastered",
} as const;
export type WordFilter = keyof typeof WORD_FILTERS;
export function filterWords(
  words: WordSummary[],
  filter: WordFilter,
  search = "",
  difficulty: DifficultyFilter = "all",
) {
  const query = search.normalize("NFKC").trim().toLowerCase();
  return words
    .filter((word) => {
      const matches =
        filter === "all" ||
        (filter === "mistakes"
          ? word.mistakes > 0
          : filter === "revealed"
            ? word.reveals > 0
            : word.status === filter);
      return (
        matches &&
        (difficulty === "all" || word.difficulty === difficulty) &&
        (!query ||
          `${word.word} ${word.definition}`
            .normalize("NFKC")
            .toLowerCase()
            .includes(query))
      );
    })
    .sort((a, b) => {
      if (["practice", "mistakes", "revealed"].includes(filter)) {
        const difference = b.mistakes + b.reveals - (a.mistakes + a.reveals);
        if (difference) return difference;
      }
      return a.word.localeCompare(b.word, "en");
    });
}
function csvCell(value: string | number) {
  const text = String(value);
  // Prevent spreadsheet applications treating exported vocabulary as formulas.
  const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function wordSummaryCsv(words: WordSummary[]) {
  return (
    "\uFEFF" +
    [
      [
        "Word",
        "Definition",
        "Example",
        "Synonyms",
        "Antonyms",
        "Difficulty level",
        "Letters",
        "English frequency (Zipf)",
        "Frequency kind",
        "Learning status",
        "Correct towards mastery",
        "Mastery target",
        "Times shown",
        "Mistakes",
        "Reveals",
        "Last practised (UTC)",
        "Difficulty data source",
        "Difficulty data licence",
      ],
      ...words.map((word) => [
        word.word,
        word.definition,
        word.example,
        word.syn,
        word.ant,
        DIFFICULTY_LEVELS[word.difficulty],
        word.letterCount,
        word.frequencyZipf,
        word.frequencyKind,
        LEARNING_STATUS[word.status],
        word.correct,
        `${recallTarget(word.difficulty)} sure recalls, ${runTarget(word.difficulty)} in a row or ${CUMULATIVE_FLOOR} correct`,
        word.seen,
        word.mistakes,
        word.reveals,
        word.lastPractised ? new Date(word.lastPractised).toISOString() : "",
        "Derived from wordfreq 3.1.1 by Robyn Speer; SUBTLEX by Marc Brysbaert et al. https://github.com/rspeer/wordfreq",
        "CC BY-SA 4.0 https://creativecommons.org/licenses/by-sa/4.0/",
      ]),
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n") +
    "\r\n"
  );
}

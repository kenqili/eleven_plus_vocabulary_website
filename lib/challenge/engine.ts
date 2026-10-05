/**
 * Question generation, in the browser.
 *
 * This is the piece that removes the round trip a child waits through on every
 * question. It is deliberately a pure module with no database, no network and no
 * React: given the bank, the state `/api/progress` returned, and the settings
 * the child picked, it produces the same question the server would have produced
 * and grades the answer the same way.
 *
 * "The same" is the whole requirement, and it is a strong one. The ordering
 * rules are not decoration: the twenty-word exclusion window is what stops a
 * child being shown the same word repeatedly, and `retry_at` is a logical clock
 * over the attempt count that decides when a mistake comes back. A client engine
 * that was merely *reasonable* would quietly teach differently from the server,
 * and nothing would report it - the child would simply stop being given the words
 * they needed.
 *
 * So every function here is the one already in use, imported rather than
 * reimplemented, and `tests/client-engine.test.mjs` drives both this and the
 * server over identical fixtures and compares the questions they produce.
 */
import { CHOICES_PER_PROBLEM, type Problem } from "./bank.ts";
import { chooseWord, reviewDueAt, RECENT_WORD_WINDOW } from "./ordering.ts";
import {
  allocationFor,
  currentLevel,
  levelFractions,
  levelScore,
  narrowToBand,
  type Placement,
  type TrailingAnswer,
} from "./placement.ts";
import { awardFor, ELIGIBLE_ANSWERS, type Award } from "./credits.ts";
import {
  advanceMastery,
  answerWindow,
  classify,
  CUMULATIVE_FLOOR,
  hasMastered,
  initialMastery,
  masteryProgress,
  type Evidence,
} from "./mastery.ts";
import { shuffle, type Word } from "./words.ts";
import { wordClue } from "./story-meanings.ts";
import type { QuestionType } from "./config.ts";
import type { Difficulty } from "./difficulty.ts";
import type { ProgressRow } from "@/lib/server/snapshot.ts";

/**
 * The bank as it arrives from `/bank/*.json`.
 *
 * Positional, because the download is on the critical path of a child's first
 * question and repeating a column name for 2,247 words is most of it. The order
 * is fixed by the generator in scripts/generate-client-bank.mjs and by
 * `tests/client-bank.test.mjs`.
 */
export type ClientBank = {
  v: number;
  choices: number;
  types: QuestionType[];
  /** `[word, definition, example, syn, ant, difficulty, source, help, clue]` */
  words: (string | number)[][];
  /** `[wordIndex, typeIndex, prompt, answer, distractors]` */
  problems: [number, number, string, string, string[]][];
};

export type ClientProgress = {
  correct: number;
  run: number;
  recalls: number;
  mastered: number;
  seen: number;
  lastSeen: string | null;
  retryAt: number | null;
};

export type EngineOptions = {
  bank: ClientBank;
  progress: ProgressRow[];
  typeCounts: [string, string, number][];
  attemptCount: number;
  recent: string[];
  /** The account's credit streak, so the bonus is counted from where it stands. */
  streak?: number;
  /**
   * How many times each word has already paid, so the cap holds across a reload.
   *
   * The server counts these; the browser has no other way to know them, since a
   * correct-answer total is not the same number.
   */
  eligibleCounts?: [string, number][];
  addedWords: {
    id: string;
    word: string;
    definition: string;
    example: string;
  }[];
  excluded: string[];
  /** The words this account may use. Omitted means the whole collection. */
  allowedWordIds?: Set<string>;
  level: Difficulty | null;
  types: QuestionType[];
  /**
   * Recent graded answers, oldest first, capped at thirty by the caller.
   *
   * The server reads these from `learning_events`; the browser accumulates
   * them from `grade()` below. Both describe the same thing — trailing
   * accuracy per band — so both sides derive the same level from the same
   * history, and the parity test hands both the same explicit list.
   */
  trailing?: TrailingAnswer[];
  random?: () => number;
  now?: () => number;
};

const DEFAULTS = 0;

/**
 * A word as the engine needs it.
 *
 * `Word` leaves `difficulty`, `help` and `clue` optional and gets difficulty from
 * a lookup map the client does not have. The bank carries all three per row, so
 * they are resolved once here and every later read is total.
 */
type EngineWord = Word & {
  difficulty: number;
  help: string;
  clue: string;
};

/** The word rows, in the shape the rest of the app already uses. */
function wordsOf(bank: ClientBank): EngineWord[] {
  return bank.words.map((row) => ({
    id: String(row[0]),
    word: String(row[0]),
    definition: String(row[1] ?? ""),
    example: String(row[2] ?? ""),
    syn: String(row[3] ?? ""),
    ant: String(row[4] ?? ""),
    difficulty: Number(row[5] ?? 1),
    source: String(row[6] ?? "vocabquest") as Word["source"],
    // The help falls back to the definition, which is what the server's own
    // loader does for a word with no recorded help.
    help: String(row[7] ?? row[1] ?? ""),
    clue: String(row[8] ?? ""),
  }));
}

/** The shape `advanceMastery` reads, which counts mastery as a flag not a number. */
const masteryState = (c: ClientProgress) => ({
  correct: c.correct,
  run: c.run,
  recalls: c.recalls,
  mastered: hasMastered(c),
});

const problemOf = (
  bank: ClientBank,
  record: ClientBank["problems"][number],
): Problem => {
  const [wordAt, typeAt, prompt, answer, distractors] = record;
  const type = bank.types[typeAt];
  return {
    id: `${type}:${String(bank.words[wordAt][0])}`,
    wordId: String(bank.words[wordAt][0]),
    type,
    prompt,
    answer,
    // A definition question draws its wrong options from a pool of six, so a
    // repeat of the same word can be shown differently. The other types have
    // their three fixed. Same split as the server's own loader.
    choices: type === "def" ? null : distractors,
    defPool: type === "def" ? distractors : undefined,
  };
};

/** The four options, assembled the way the server assembles them. */
const optionsFor = (problem: Problem, random: () => number): string[] => {
  const wrong =
    problem.choices ??
    (problem.defPool ?? []).slice(0, CHOICES_PER_PROBLEM - 1);
  if (wrong.length < CHOICES_PER_PROBLEM - 1)
    throw Error(`a ${problem.id} question was generated with too few options.`);
  // The answer is stored apart from the wrong options, so a question is never
  // shown with the right answer missing from its own list.
  return shuffle([...wrong, problem.answer], random);
};

export type ShownQuestion = {
  id: string;
  wordId: string;
  type: QuestionType;
  prompt: string;
  choices: string[];
  answer: string;
  word: string;
  definition: string;
  example: string;
  syn: string;
  ant: string;
  help: string;
  clue: string;
  difficulty: number;
  /**
   * Where the child is, computed for this question.
   *
   * Present only in automatic ("all levels") mode, where it drove the band
   * draw above. With an explicit level choice there is nothing to estimate —
   * the child said where they are — so this is null rather than a number that
   * looks authoritative and is not.
   */
  placement: Placement | null;
  mastery: ReturnType<typeof masteryProgress>;
  correctCount: number;
  seen: number;
  /** Epoch ms, for the "you last saw this N days ago" line. */
  shownAt: number;
};

export type GradedAnswer = {
  correct: boolean;
  skipped: boolean;
  selected: number;
  evidence: Evidence;
  mastery: ReturnType<typeof masteryProgress>;
  newlyMastered: boolean;
  /**
   * What this answer is worth, worked out with the same rules the database uses.
   *
   * Computed here rather than left to the flush so the child sees their balance
   * move when they answer. It is the server's number that becomes true, and a
   * flush returns the authoritative balance to reconcile against; but because
   * both sides run the same functions from the same starting streak, this is an
   * exact figure rather than a guess.
   */
  award: Award;
  help: string;
  daysSince?: number;
};

/**
 * A practice session.
 *
 * Holds the mutable state - progress, the attempt clock, the per-type counts -
 * and advances it as questions are answered. The server is the durable copy; this
 * is the one a child sees between flushes, and a flush hands the server the whole
 * difference.
 */
export class PracticeEngine {
  private readonly words: EngineWord[];
  private readonly byId: Map<string, EngineWord>;
  private readonly problemsByWord: Map<string, Problem[]>;
  private readonly counters = new Map<string, ClientProgress>();
  private readonly typeCounts = new Map<string, Map<QuestionType, number>>();
  private attemptCount: number;
  /**
   * Counted answers per word, which is what the five-answer cap counts.
   *
   * Separate from `correct` on purpose: the SQL keys eligibility off both the
   * running total *and* the number of times the word has actually paid, and an
   * answer that is right but not counted moves one and not the other.
   */
  private eligibleCounts = new Map<string, number>();
  private streak = 0;
  private recent: string[];
  /**
   * Trailing graded answers for the level estimate, oldest first.
   *
   * Seeded from the caller (the server's `learning_events`, or fixtures) and
   * extended by every `grade()` below, so the estimate sharpens as the session
   * runs. Capped at thirty: older answers describe a child who knew less, and
   * the down-track only reads the last thirty anyway.
   */
  private trailing: TrailingAnswer[] = [];
  private lastQuestion: ShownQuestion | null = null;
  private readonly options: Required<Pick<EngineOptions, "level" | "types">> & {
    allowed?: Set<string>;
    added: EngineWord[];
    excluded: Set<string>;
    random: () => number;
    now: () => number;
  };

  constructor(options: EngineOptions) {
    const random = options.random ?? Math.random;
    const now = options.now ?? Date.now;
    this.words = wordsOf(options.bank);
    this.byId = new Map(this.words.map((word) => [word.id, word]));
    this.problemsByWord = new Map();
    for (const record of options.bank.problems) {
      const problem = problemOf(options.bank, record);
      const list = this.problemsByWord.get(problem.wordId) ?? [];
      list.push(problem);
      this.problemsByWord.set(problem.wordId, list);
    }
    for (const row of options.progress) {
      const [wordId, correct, run, recalls, mastered, seen, lastSeen, retryAt] =
        row;
      this.counters.set(wordId, {
        correct,
        run,
        recalls,
        mastered,
        seen,
        lastSeen,
        retryAt,
      });
    }
    for (const [wordId, type, count] of options.typeCounts) {
      const byType =
        this.typeCounts.get(wordId) ?? new Map<QuestionType, number>();
      byType.set(type as QuestionType, count);
      this.typeCounts.set(wordId, byType);
    }
    this.attemptCount = options.attemptCount;
    // The caller's trailing history, if any. The demo starts empty and the
    // estimate builds purely in-session; the server seeds from learning_events.
    this.trailing = [...(options.trailing ?? [])].slice(-30);
    // The streak the credit rules read is the account's, not a guess: a flush
    // reconciles it, and until then this is where the every-third bonus starts.
    this.streak = options.streak ?? 0;
    for (const [wordId, count] of options.eligibleCounts ?? [])
      this.eligibleCounts.set(wordId, count);
    this.recent = [...options.recent];
    this.options = {
      level: options.level,
      types: options.types,
      allowed: options.allowedWordIds,
      added: options.addedWords.map((word) => ({
        id: word.id,
        word: word.word,
        definition: word.definition,
        example: word.example,
        syn: "—",
        ant: "—",
        // A parent's own word has no corpus frequency, so it sits in the middle
        // band, which is what the server's own estimate does for a word with no
        // reading. What matters is that it is not filtered out by a level the
        // child did not choose.
        difficulty: 1,
        source: "vocabquest" as Word["source"],
        help: word.definition,
        clue: "",
      })),
      excluded: new Set(options.excluded),
      random,
      now,
    };
  }

  /** Words this account may be asked about, in bank order. */
  private pool(): EngineWord[] {
    const excluded = this.options.excluded;
    const allowed = this.options.allowed;
    return [...this.words, ...this.options.added].filter(
      (word) =>
        !excluded.has(word.id) &&
        (!allowed || allowed.has(word.id)) &&
        (this.options.level === null || word.difficulty === this.options.level),
    );
  }

  private countersFor(wordId: string): ClientProgress {
    return (
      this.counters.get(wordId) ?? {
        correct: DEFAULTS,
        run: DEFAULTS,
        recalls: DEFAULTS,
        mastered: DEFAULTS,
        seen: DEFAULTS,
        lastSeen: null,
        retryAt: null,
      }
    );
  }

  /**
   * Where the child is, for the badge and the band draw.
   *
   * Derived from the counters every time, never stored: the same rows always
   * give the same level, on both sides of the client/server split. Fractions
   * cover the pool's bands; totals come from the pool itself so excluded words
   * do not count against the child.
   */
  placement(): Placement {
    const words = this.pool();
    const totals = [0, 0, 0, 0, 0, 0];
    for (const word of words) {
      if (word.difficulty >= 0 && word.difficulty < 6)
        totals[word.difficulty] += 1;
    }
    const fractions = levelFractions(
      words.map((word) => ({
        level: word.difficulty,
        mastered: hasMastered(this.countersFor(word.id)),
      })),
      totals,
    );
    const level = currentLevel(fractions, this.trailing);
    return { level, score: levelScore(level, fractions[level] ?? 0) };
  }

  /**
   * The next question, or null when there is nothing left to ask.
   *
   * Null is a real answer, not a failure: a child who has mastered every word they
   * are allowed has finished, and the caller shows them that rather than looping.
   */
  next(): ShownQuestion | null {
    const available = this.pool().filter(
      (word) => !hasMastered(this.countersFor(word.id)),
    );
    if (!available.length) return null;
    // Automatic placement, only when the child did not pick a band. Due
    // mistake-reviews anywhere bypass the draw — the spaced-repetition clock
    // outranks the band plan — otherwise a band is drawn from the allocation
    // weights and the word is picked inside it. An explicit level choice keeps
    // the old exact filter in pool().
    let wordPool = available;
    let placement: Placement | null = null;
    if (this.options.level === null) {
      placement = this.placement();
      const owed = available.some((word) => {
        const counters = this.countersFor(word.id);
        return (
          counters.retryAt !== null && counters.retryAt <= this.attemptCount
        );
      });
      if (!owed) {
        wordPool = narrowToBand(
          available,
          (word) => word.difficulty,
          allocationFor(placement.level),
          this.options.random,
        ).words;
      }
    }
    const chosenId = chooseWord(
      wordPool.map((word) => {
        const counters = this.countersFor(word.id);
        return { id: word.id, seen: counters.seen, retryAt: counters.retryAt };
      }),
      this.recent,
      this.attemptCount,
      this.options.random,
    );
    if (!chosenId) return null;
    const word =
      this.byId.get(chosenId) ??
      this.options.added.find((w) => w.id === chosenId);
    if (!word) return null;
    // Cycle the word through the question types it is eligible for before
    // repeating one, while the choice of word stays with chooseWord.
    const eligible = (this.problemsByWord.get(chosenId) ?? []).filter(
      (problem) => this.options.types.includes(problem.type),
    );
    if (!eligible.length) return null;
    const counts =
      this.typeCounts.get(chosenId) ?? new Map<QuestionType, number>();
    const leastSeen = Math.min(
      ...eligible.map((p) => counts.get(p.type) ?? DEFAULTS),
    );
    const candidates = eligible.filter(
      (p) => (counts.get(p.type) ?? DEFAULTS) === leastSeen,
    );
    const problem =
      candidates[Math.floor(this.options.random() * candidates.length)];
    const counters = this.countersFor(chosenId);
    const shown: ShownQuestion = {
      id: `${problem.type}:${word.id}`,
      wordId: word.id,
      type: problem.type,
      prompt: problem.prompt || `Choose the definition for '${word.word}'.`,
      choices: optionsFor(problem, this.options.random),
      answer: problem.answer,
      word: word.word,
      definition: word.definition,
      example: word.example,
      syn: word.syn,
      ant: word.ant,
      help: word.help,
      clue: wordClue(word, problem.answer, problem.type),
      difficulty: word.difficulty,
      mastery: masteryProgress(
        {
          correct: counters.correct,
          run: counters.run,
          recalls: counters.recalls,
          mastered: hasMastered(counters),
        },
        word.difficulty,
      ),
      correctCount: counters.correct,
      seen: counters.seen,
      shownAt: this.options.now(),
      placement,
    };
    this.lastQuestion = shown;
    return shown;
  }

  /**
   * Grade an answer and advance every counter it should.
   *
   * The evidence verdict is computed from the time the question was *shown*, not
   * from when the answer arrived and not from any server timestamp. That matters
   * more here than it used to: a prefetched question sits in the queue for a while,
   * and measuring from the wrong origin makes every question read as a guess,
   * which stops counting towards mastery.
   */
  grade(
    selected: number,
    options: { assisted?: boolean } = {},
  ): GradedAnswer | null {
    const question = this.lastQuestion;
    if (!question) return null;
    const answer = { assisted: options.assisted === true };
    const correct =
      selected >= 0 && question.choices[selected] === question.answer;
    const skipped = selected === -1;
    const seconds = Math.max(0, (this.options.now() - question.shownAt) / 1000);
    const evidence = classify({
      correct,
      revealed: skipped,
      assisted: answer.assisted,
      seconds,
      wallSeconds: seconds,
      window: answerWindow(question.choices),
    });
    const previous = this.countersFor(question.wordId);
    const mastery = advanceMastery(
      masteryState(previous),
      evidence,
      question.difficulty,
    );
    // The trailing history for the level estimate. Unassisted correct only:
    // assisted, revealed and skipped answers count as not-correct, the same
    // way they do not count toward mastery.
    this.trailing = [
      ...this.trailing,
      {
        level: question.difficulty,
        correct: correct && !skipped && !answer.assisted,
      },
    ].slice(-30);
    const day = new Date(this.options.now()).toISOString().slice(0, 10);
    this.counters.set(question.wordId, {
      // The advanced counters, not the ones this answer started from. Keeping
      // `previous` here looks harmless and is not: `run` and `recalls` would stay
      // at zero forever, no word could ever reach its target, and a flush would
      // write those zeros over the child's real progress. The server stores
      // exactly these three fields from `advanceMastery`, and the two have to
      // agree or the same question is worth a different thing on each side.
      correct: mastery.correct,
      run: mastery.run,
      recalls: mastery.recalls,
      mastered: hasMastered(mastery) ? 1 : previous.mastered,
      seen: previous.seen + 1,
      lastSeen: day,
      // A mistake is scheduled against the attempt count, which is a logical
      // clock and not a date. The count is the one this session has been
      // advancing, and a flush reconciles it with the server's. A correct
      // answer clears the schedule instead of keeping it: the review has
      // happened, so the word rejoins the normal rotation and other words get
      // asked in between. Keeping the old value here pinned the word as due
      // and every remaining question type for it came back-to-back. This
      // matches the server, which clears retry_at on issue and writes null on
      // a correct answer.
      retryAt: correct ? null : reviewDueAt(this.attemptCount + 1),
    });
    // Eligibility, from the two counters the SQL uses: the running total of
    // correct answers for the word, and how many times it has actually paid. The
    // two are not the same - an answer that is right but not counted moves one
    // and not the other - which is the same distinction the SQL draws.
    const eligibleBefore = this.eligibleCounts.get(question.wordId) ?? DEFAULTS;
    const eligible =
      correct && !skipped && !answer.assisted
        ? previous.correct < CUMULATIVE_FLOOR &&
          eligibleBefore < ELIGIBLE_ANSWERS
        : false;
    if (eligible) this.eligibleCounts.set(question.wordId, eligibleBefore + 1);
    // The same functions the trigger's arithmetic was copied from, run from the
    // account's own streak. A flush returns the server's balance to confirm.
    const award = awardFor(
      { correct, eligible, mastered: mastery.newlyMastered },
      this.streak,
    );
    this.streak = award.currentStreak;

    const byType =
      this.typeCounts.get(question.wordId) ?? new Map<QuestionType, number>();
    if (!skipped)
      byType.set(question.type, (byType.get(question.type) ?? DEFAULTS) + 1);
    this.typeCounts.set(question.wordId, byType);
    this.attemptCount += 1;
    this.recent = [question.wordId, ...this.recent].slice(
      0,
      RECENT_WORD_WINDOW * 2,
    );
    this.lastQuestion = null;
    return {
      correct,
      skipped,
      selected,
      evidence,
      mastery: masteryProgress(mastery, question.difficulty),
      newlyMastered: mastery.newlyMastered,
      award,
      help: question.help,
      daysSince: daysSince(previous.lastSeen, this.options.now()),
    };
  }

  /** The state to hand a flush, so the server can apply exactly this difference. */
  /** The account's credit streak, so a new session starts where the last ended. */
  get creditStreak(): number {
    return this.streak;
  }

  pending(): {
    attemptCount: number;
    recent: string[];
    progress: ProgressRow[];
    typeCounts: [string, string, number][];
  } {
    return {
      attemptCount: this.attemptCount,
      recent: this.recent,
      progress: [...this.counters].map(
        ([wordId, c]): ProgressRow => [
          wordId,
          c.correct,
          c.run,
          c.recalls,
          c.mastered,
          c.seen,
          c.lastSeen,
          c.retryAt,
        ],
      ),
      typeCounts: [...this.typeCounts].flatMap(([wordId, byType]) =>
        [...byType].map(([type, count]): [string, string, number] => [
          wordId,
          type,
          count,
        ]),
      ),
    };
  }
}

function daysSince(lastSeen: string | null, now: number): number | undefined {
  if (!lastSeen) return undefined;
  const then = Date.parse(`${lastSeen}T12:00:00Z`);
  if (!Number.isFinite(then)) return undefined;
  const days = Math.round((now - then) / 86_400_000);
  return days > 0 ? days : undefined;
}

export { initialMastery, hasMastered, masteryProgress, reviewDueAt };

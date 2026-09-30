/**
 * A practice session the browser owns.
 *
 * The child asks for a question and gets one without a round trip, and their
 * answer is graded without one. What the server is left with is a durable copy:
 * a flush every five minutes, on demand when the child presses Save, and when
 * the page goes away.
 *
 * This is deliberately not React. It is the part with the interesting logic -
 * what is queued, when it is sent, what happens when sending fails, and what the
 * child sees while their answer is still only local - and it is worth being able
 * to test without a browser. The hook in `use-challenge.ts` is a thin layer over
 * it.
 */
// Relative, with extensions, and no `@/` alias. That is not a style choice: this
// module is imported by a test that node runs directly, and node resolves neither
// the extensionless form nor the path alias. `lib/challenge/engine.ts` is written
// the same way for the same reason.
import { api } from "./api.ts";
import {
  PracticeEngine,
  type ClientBank,
  type GradedAnswer,
  type ShownQuestion,
} from "../challenge/engine.ts";
import type { Stats } from "../challenge/types.ts";
import { emptyPeriod } from "../challenge/rewards.ts";
import { QUESTION_TYPES } from "../challenge/config.ts";
import type { QuestionType } from "../challenge/config.ts";
import type { Difficulty } from "../challenge/difficulty.ts";
// Type-only, so node erases them and a client module never pulls in a server one.
import type { Snapshot } from "../server/snapshot.ts";
import type { FlushedAnswer } from "../server/flush.ts";

/** How often the session saves itself. */
export const FLUSH_INTERVAL_MS = 5 * 60 * 1000;

export type SessionSnapshot = {
  /** The server's answer, kept whole so the page can render a trial banner. */
  snapshot: Snapshot;
  engine: PracticeEngine;
  stats: Stats;
  bank: ClientBank;
};

/**
 * Load everything a session needs: the child's state, and the bank they may use.
 *
 * Two requests, and they are not independent - the first names the second - so
 * they are sequential by necessity rather than by choice. After this the child
 * waits for nothing until the bank itself changes.
 */
export async function loadSession(options?: {
  headers?: Record<string, string>;
}): Promise<SessionSnapshot> {
  const snapshot = await api<Snapshot>("/api/progress", undefined, options);
  const bank = await api<ClientBank>(snapshot.bank.url, undefined, options);
  return {
    snapshot,
    bank,
    stats: snapshot.stats,
    engine: new PracticeEngine({
      bank,
      progress: snapshot.progress,
      typeCounts: snapshot.typeCounts,
      attemptCount: snapshot.clock.attemptCount,
      recent: snapshot.clock.recent,
      // Both of these come from the account, not from this session. The streak
      // decides when the every-third bonus lands and the counts hold the cap, so
      // starting either at zero would misprice credits for the whole sitting.
      streak: snapshot.stats.rewards?.streak ?? 0,
      eligibleCounts: snapshot.eligibleCounts,
      addedWords: snapshot.addedWords,
      excluded: snapshot.excluded,
      level: null,
      types: [...QUESTION_TYPES],
      // No allow-list, deliberately. The free tier is enforced by which bank the
      // server names in the snapshot, so the browser only ever holds the words it
      // is entitled to and there is nothing for it to decline.
    }),
  };
}

export type AnswerResult = {
  feedback: GradedAnswer;
  question: ShownQuestion;
  /** The id this answer was queued under, which is what makes a flush a retry. */
  attemptId: string;
};

/**
 * The panels, moved one answer on without waiting for anyone.
 *
 * The same arithmetic the demo path uses, and the same arithmetic the server used
 * to do on write. It lives here rather than in the practice page because the
 * session is what owns the state: a hook that recomputed this would have two
 * copies of the rule, and the one that drifted would be the one a child saw.
 *
 * A flush replaces all of it with the server's figures, and until then this is
 * what is on screen. The alternative - numbers frozen until a save - would mean a
 * balance that does not move while a child is answering, which is the whole thing
 * being fixed.
 */
function advanceStats(
  base: Stats,
  answer: {
    correct: boolean;
    revealed: boolean;
    seconds: number;
    firstTime: boolean;
    mastered: boolean;
    credits: number;
  },
  totals: { mastered: number; meetCount: number },
): Stats {
  const prior = base.periods?.all || emptyPeriod();
  const period = {
    ...prior,
    questions: prior.questions + 1,
    correct: prior.correct + (answer.correct ? 1 : 0),
    reveals: prior.reveals + (answer.revealed ? 1 : 0),
    newWords: prior.newWords + (answer.firstTime ? 1 : 0),
    mastered: prior.mastered + (answer.mastered ? 1 : 0),
    seconds: prior.seconds + answer.seconds,
  };
  return {
    ...base,
    mastered: totals.mastered,
    meetCount: totals.meetCount,
    correct: base.correct + (answer.correct ? 1 : 0),
    todaySeconds: base.todaySeconds + answer.seconds,
    totalSeconds: base.totalSeconds + answer.seconds,
    periods: { today: period, week: period, all: period },
    // The engine worked the award out from the same rules the trigger uses, so
    // the balance moves when the child answers. A flush replaces this with the
    // server's figure, which in practice is the same number.
    rewards: base.rewards
      ? { ...base.rewards, balance: base.rewards.balance + answer.credits }
      : base.rewards,
  };
}

/**
 * The queue, and the clock that empties it.
 *
 * Everything here is about one thing: a child must never be waiting on the
 * database to see feedback, and must never silently lose what they have done.
 * Those pull in opposite directions, so answers are applied locally and
 * immediately, and the sending is careful about not dropping anything.
 */
export class ClientSession {
  private readonly engine: PracticeEngine;
  private queue: FlushedAnswer[] = [];
  /** Called whenever the queue changes, so a Save button can grey itself out. */
  private onChange: (pending: number) => void = () => {};
  private question: ShownQuestion | null = null;
  private flushing: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  stats: Stats;
  /** Set when a flush fails, so the child can be told rather than left guessing. */
  lastError: string | null = null;
  /** Bumped on every applied answer, so a panel can tell there is something new. */
  private revision = 0;

  constructor(engine: PracticeEngine, stats: Stats) {
    this.engine = engine;
    this.stats = stats;
  }

  /**
   * Report the queue length as it changes.
   *
   * The Save button is the only visible sign that anything is unsaved, and a
   * button that is always lit is a button nobody reads. So the session reports
   * the number and the interface decides what to show.
   */
  watch(onChange: (pending: number) => void) {
    this.onChange = onChange;
    onChange(this.queue.length);
  }

  /** How many times the browser has shown this word, for "is this a first?". */
  private seenFor(wordId: string): number {
    const row = this.engine.pending().progress.find((r) => r[0] === wordId);
    return row ? row[5] : 0;
  }

  /** The browser's progress, for the panels that count words. */
  get progress(): ReturnType<PracticeEngine["pending"]>["progress"] {
    return this.engine.pending().progress;
  }

  /** Whether a flush would send anything. Drives the Save button. */
  get dirty(): boolean {
    return this.queue.length > 0;
  }

  /** The next question, decided in the browser. */
  next(): ShownQuestion | null {
    this.question = this.engine.next();
    return this.question;
  }

  /**
   * Grade an answer and remember it for the next flush.
   *
   * Nothing is sent here. That is the whole change: the child sees feedback
   * immediately, and the write happens on a timer or when they ask for it.
   */
  answer(
    selected: number,
    options: { assisted?: boolean } = {},
  ): AnswerResult | null {
    const question = this.question;
    if (!question) return null;
    // Read before grading, because grading is what makes the word "seen".
    const seenBefore = this.seenFor(question.wordId);
    const feedback = this.engine.grade(selected, options);
    if (!feedback) return null;
    const attemptId = crypto.randomUUID();
    this.queue.push({
      id: attemptId,
      wordId: question.wordId,
      type: question.type,
      answer: question.answer,
      choices: question.choices,
      selected,
      elapsed: Math.max(0, (Date.now() - question.shownAt) / 1000),
      shownAt: question.shownAt,
      revealed: selected === -1,
      assisted: options.assisted === true,
      evidence: feedback.evidence,
    });
    this.unconfirmed += feedback.award.total;
    // The panels move with the answer, on the same frame the child sees it.
    const counters = this.engine.pending().progress;
    this.stats = advanceStats(
      this.stats,
      {
        correct: feedback.correct,
        revealed: feedback.skipped,
        seconds: Math.max(0, (Date.now() - question.shownAt) / 1000),
        firstTime: seenBefore === 0,
        mastered: feedback.newlyMastered,
        credits: feedback.award.total,
      },
      {
        mastered: counters.filter((row) => row[4]).length,
        meetCount: counters.length,
      },
    );
    this.revision++;
    this.onChange(this.queue.length);
    this.schedule();
    return { feedback, question, attemptId };
  }

  /**
   * Credits earned locally and not yet confirmed by the server.
   *
   * The engine applies the same rules the database does, starting from the
   * account's own streak, so this is the real figure rather than an estimate. A
   * flush returns the authoritative balance and this resets, which is the
   * correction step - and in practice a correction of nothing, because the two
   * run the same code.
   */
  private unconfirmed = 0;

  get pendingCredits(): number {
    return this.unconfirmed;
  }

  private schedule() {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  /**
   * Send everything queued, and take the server's word for the stats.
   *
   * A flush that fails keeps its queue, so the next attempt sends the same
   * answers again. They carry ids the server has already seen, so a retry after a
   * partial success cannot pay twice - which is why the ids are generated here
   * rather than on the server.
   */
  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (!this.queue.length) {
      this.stop();
      return;
    }
    const batch = this.queue;
    this.flushing = (async () => {
      try {
        const result = await api<{ saved: number; stats: Stats }>(
          "/api/flush",
          {
            answers: batch,
            state: this.engine.pending(),
          },
        );
        // Only drop what was sent, and only once the server has said so. A
        // request that timed out may well have been applied.
        this.queue = this.queue.slice(batch.length);
        this.stats = result.stats;
        // The server's balance is the truth, and it now includes these answers.
        this.unconfirmed = 0;
        this.lastError = null;
        this.onChange(this.queue.length);
      } catch (error) {
        this.lastError = (error as Error).message;
        // Kept, and not rescheduled: the next answer, or Save, or the page going
        // away will try again.
        this.timer = null;
      } finally {
        this.flushing = null;
      }
    })();
    await this.flushing;
    if (!this.queue.length) this.stop();
  }

  /**
   * Best-effort save as the page goes away.
   *
   * A child's session ends with navigation far more often than with a crash, so
   * this is not a rare path. `keepalive` lets the request outlive the document;
   * if even that is dropped, the queue is still here on the next visit and the
   * server ignores the ids it has already seen.
   */
  async flushOnExit(): Promise<void> {
    if (!this.queue.length) return;
    const batch = this.queue;
    try {
      await api(
        "/api/flush",
        { answers: batch, state: this.engine.pending() },
        {
          keepalive: true,
          timeoutMs: 4000,
        },
      );
      this.queue = this.queue.slice(batch.length);
      this.onChange(this.queue.length);
    } catch {
      // Nothing to do. Losing this is the accepted cost, and it is bounded by
      // the flush interval rather than by the session.
    }
  }

  /** Stop the timer. Called when the child leaves the practice page. */
  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  get version(): number {
    return this.revision;
  }
}

export type { ShownQuestion, GradedAnswer, Difficulty, QuestionType };

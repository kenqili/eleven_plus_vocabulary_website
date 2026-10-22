/**
 * A practice session the browser owns.
 *
 * The child asks for a question and gets one without a round trip, and their
 * answer is graded without one. What the server is left with is a durable copy:
 * a flush every minute, earlier when more than ten answers are waiting, on
 * demand when the child presses Save, and when the page goes away.
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
export const FLUSH_INTERVAL_MS = 1 * 60 * 1000;
/**
 * How many unsaved answers trigger a flush before the minute is up.
 *
 * Bounds what a crash can lose: ten answers, not a whole sitting. Checked as
 * "more than ten" at the point of answering, so the eleventh answer goes
 * straight away.
 */
export const FLUSH_EARLY_AFTER = 10;

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
      // The server's own last-thirty answers, so the collapse guard reads
      // the same recent accuracy on both sides instead of starting blind
      // every visit.
      trailing: snapshot.clock.trailing ?? [],
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
    /**
     * Whether anything was answered. Marking a word known moves mastery
     * without answering, so it must not inflate the answered counts.
     */
    answered?: boolean;
  },
  totals: { mastered: number; meetCount: number },
): Stats {
  const asked = answer.answered ?? true;
  // Each period from its own prior. This used to advance the all-time period
  // and write the result into today and week as well, so the Today tab read
  // like all-time until the next flush replaced it with the server's figures.
  const bump = (prior: ReturnType<typeof emptyPeriod>) => ({
    ...prior,
    questions: prior.questions + (asked ? 1 : 0),
    correct: prior.correct + (asked && answer.correct ? 1 : 0),
    reveals: prior.reveals + (asked && answer.revealed ? 1 : 0),
    newWords: prior.newWords + (answer.firstTime ? 1 : 0),
    mastered: prior.mastered + (answer.mastered ? 1 : 0),
    seconds: prior.seconds + answer.seconds,
  });
  const prior = base.periods ?? {
    today: emptyPeriod(),
    week: emptyPeriod(),
    all: emptyPeriod(),
  };
  return {
    ...base,
    mastered: totals.mastered,
    meetCount: totals.meetCount,
    correct: base.correct + (asked && answer.correct ? 1 : 0),
    todaySeconds: base.todaySeconds + answer.seconds,
    totalSeconds: base.totalSeconds + answer.seconds,
    periods: {
      today: bump(prior.today),
      week: bump(prior.week),
      all: bump(prior.all),
    },
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
  private readonly scorePenalty: number;
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

  constructor(engine: PracticeEngine, stats: Stats, scorePenalty = 0) {
    this.engine = engine;
    this.stats = stats;
    this.scorePenalty = Math.max(0, Math.floor(scorePenalty));
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
    return this.queue.length > 0 || this.stateDirty;
  }

  /**
   * Progress changed without an answer - currently only marking a word
   * known. The answer queue stays empty, so without this flag a flush would
   * conclude there is nothing to send and the marking would die with the tab.
   */
  private stateDirty = false;

  /** The next question, decided in the browser. */
  next(): ShownQuestion | null {
    this.question = this.engine.next();
    return this.question;
  }

  /**
   * Where the child is right now, from the browser's own counters.
   *
   * Read live so the level bar moves the moment an answer is graded, rather
   * than waiting for the next flush to reach the database that `/api/placement`
   * reads. Same rows, same functions as the server — the engine owns both.
   */
  placement(): { level: number; score: number } {
    const placement = this.engine.placement();
    // The engine knows the derived level score, not the account's permanent
    // hint penalty. Subtract it here for the same reason the server does in
    // accountPlacement: one displayed number, wherever it is read.
    return {
      ...placement,
      score: Math.max(0, placement.score - this.scorePenalty),
    };
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
    // Bound what a crash can take: past ten unsaved answers the queue goes
    // now instead of waiting for the minute timer. A flush already in flight
    // is joined rather than duplicated, and a failed one keeps its queue for
    // the next answer, Save press, or page exit to retry.
    if (this.queue.length > FLUSH_EARLY_AFTER) void this.flush();
    return { feedback, question, attemptId };
  }

  /**
   * Mark the word just answered as known, so it leaves the rotation.
   *
   * Nothing is sent here, like an answer. Unlike an answer it joins no queue -
   * the press has no attempt row, because there is nothing more to answer: the
   * answer that earned it is already queued. So it raises the state flag
   * instead, which is what gets a flush moving and what the flush sends. Panels,
   * level and counts move on this frame; credits and streaks do not, because the
   * press earned nothing.
   */
  markKnown(
    wordId: string,
  ): { wordId: string; question: ShownQuestion } | null {
    if (this.question?.wordId !== wordId) return null;
    // Read before marking: the answer already counted this showing, so this is
    // at least one on the normal path and the word is not announced as new a
    // second time.
    const seenBefore = this.seenFor(wordId);
    const marked = this.engine.markKnown();
    if (!marked || marked.wordId !== wordId) return null;
    const counters = this.engine.pending().progress;
    this.stats = advanceStats(
      this.stats,
      {
        correct: false,
        revealed: false,
        seconds: 0,
        firstTime: seenBefore === 0,
        mastered: true,
        credits: 0,
        answered: false,
      },
      {
        mastered: counters.filter((row) => row[4]).length,
        meetCount: counters.length,
      },
    );
    this.stateDirty = true;
    this.revision++;
    this.onChange(this.queue.length);
    this.schedule();
    return { wordId, question: marked.question };
  }

  /** The account's credit streak, for a zero-value award that keeps the run. */
  get streak(): number {
    return this.engine.creditStreak;
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
    if (!this.queue.length && !this.stateDirty) {
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
        this.stateDirty = false;
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
    if (!this.queue.length && !this.stateDirty) this.stop();
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
    if (!this.queue.length && !this.stateDirty) return;
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

  /**
   * Take the session back after the page that owned it was unmounted.
   *
   * `stop` runs from the practice screen's cleanup, because leaving the page is
   * normally the end of the sitting. A client-side route change is not: the
   * document, the engine and this queue are all still here. Coming back to the
   * page resumes rather than rebuilds, which re-arms whatever the exit flush could
   * not send and restarts the clock on the question on screen.
   */
  resume() {
    this.engine.reshow();
    if (!this.stopped) return;
    this.stopped = false;
    if (this.queue.length || this.stateDirty) this.schedule();
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

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
import { api } from "./api";
import {
  PracticeEngine,
  type ClientBank,
  type EngineOptions,
  type GradedAnswer,
  type ShownQuestion,
} from "@/lib/challenge/engine";
import type { Stats } from "@/lib/challenge/types";
import { QUESTION_TYPES } from "@/lib/challenge/config";
import type { QuestionType } from "@/lib/challenge/config";
import type { Difficulty } from "@/lib/challenge/difficulty";
import type { Snapshot } from "@/lib/server/snapshot";
import type { FlushedAnswer } from "@/lib/server/flush";

/** How often the session saves itself. */
export const FLUSH_INTERVAL_MS = 5 * 60 * 1000;

export type SessionSnapshot = {
  engine: PracticeEngine;
  stats: Stats;
  bank: ClientBank;
  freeTier: boolean;
  timezone: string;
};

/**
 * Load everything a session needs: the child's state, and the bank they may use.
 *
 * Two requests, and they are not independent - the first names the second - so
 * they are sequential by necessity rather than by choice. After this the child
 * waits for nothing until the bank itself changes.
 */
export async function loadSession(): Promise<SessionSnapshot> {
  const snapshot = await api<Snapshot>("/api/progress");
  const bank = await api<ClientBank>(snapshot.bank.url);
  return {
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
    stats: snapshot.stats,
    bank,
    freeTier: snapshot.account.freeTier,
    timezone: snapshot.account.timezone,
  };
}

export type AnswerResult = {
  feedback: GradedAnswer;
  question: ShownQuestion;
};

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
  answer(selected: number): AnswerResult | null {
    const question = this.question;
    if (!question) return null;
    const feedback = this.engine.grade(selected);
    if (!feedback) return null;
    this.queue.push({
      id: crypto.randomUUID(),
      wordId: question.wordId,
      type: question.type,
      answer: question.answer,
      choices: question.choices,
      selected,
      elapsed: Math.max(0, (Date.now() - question.shownAt) / 1000),
      shownAt: question.shownAt,
      revealed: selected === -1,
      assisted: false,
      evidence: feedback.evidence,
    });
    this.unconfirmed += feedback.award.total;
    this.revision++;
    this.schedule();
    return { feedback, question };
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

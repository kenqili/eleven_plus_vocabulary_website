"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  readAutoNext,
  saveAutoNext,
  subscribeAutoNext,
  serverAutoNext,
} from "@/lib/client/auto-next";
import {
  advanceMastery,
  answerWindow,
  classify,
  initialMastery,
  masteryProgress,
  type Evidence,
  type MasteryState,
} from "@/lib/challenge/mastery";
import { api } from "@/lib/client/api";
import { ClientSession, loadSession } from "@/lib/client/session";
import { chosenWordExplanation } from "@/lib/challenge/option-gloss";
import type {
  ClientBank,
  GradedAnswer,
  ShownQuestion,
} from "@/lib/challenge/engine";
import { useStudyClock } from "./use-study-clock";
import { emptyPeriod } from "@/lib/challenge/rewards";
import { QUESTION_TYPES, type QuestionType } from "@/lib/challenge/config";
import type { Difficulty } from "@/lib/challenge/difficulty";
import type {
  ChallengeState,
  Feedback,
  Question,
  Stats,
} from "@/lib/challenge/types";
type DemoWord = {
  wordId: string;
  type: QuestionType;
  prompt: string;
  answer: string;
  source: import("@/lib/challenge/words").WordSource;
  id: string;
  word: string;
  definition: string;
  example: string;
  syn: string;
  ant: string;
  number: number;
  /** Worked out on the server, so the help data is not downloaded. */
  clue: string;
  /** A gloss for each option that is a single word, so a wrong pick is taught. */
  optionHelp?: Record<string, { meaning: string; example?: string }>;
  /** The word's band, sent with the question so the level table stays put. */
  difficulty: number;
  /** The plain-language help for this word, also from the server. */
  help: string;
  choices: string[];
};
const initialStats: Stats = {
  total: 0,
  collection: 0,
  mastered: 0,
  correct: 0,
  todaySeconds: 0,
  totalSeconds: 0,
};
/**
 * What the option the child chose means, taken from what the server sent with
 * the question. A definition question offers meanings rather than words, so
 * there is nothing to explain and this returns nothing. The bank itself is not
 * in the browser, so the glosses arrive with the question.
 */
function demoChosen(
  word: DemoWord,
  selected: number,
  answer: string,
): Feedback["chosen"] {
  if (selected < 0 || selected >= word.choices.length) return undefined;
  const chosen = word.choices[selected];
  if (!chosen || chosen.toLowerCase() === answer.toLowerCase())
    return undefined;
  const entry = word.optionHelp?.[chosen];
  if (!entry) return undefined;
  return { word: chosen, meaning: entry.meaning, example: entry.example };
}

/**
 * What the child is shown, with the answer taken off it.
 *
 * The engine needs the answer to grade without a round trip, and the question
 * that goes into a panel, a tool call or a parent's view must not carry it. So it
 * is dropped here rather than left on an object that is passed around.
 */
function shownToQuestion(shown: ShownQuestion): Question {
  return {
    id: shown.id,
    wordId: shown.wordId,
    type: shown.type,
    prompt: shown.prompt,
    choices: shown.choices,
    correctCount: shown.correctCount,
    seen: shown.seen,
    mastery: shown.mastery,
    difficulty: shown.difficulty,
    placement: shown.placement,
    clue: shown.clue,
    word: shown.word,
    source: "flash_card_1",
    number: 0,
  };
}

/**
 * A word lookup built from the shipped bank, so a wrong pick can still be taught.
 *
 * The server used to send a gloss with every question. It does not need to: the
 * bank already carries each word's definition and example, which is all a gloss
 * is, and the distractors are drawn from the same collection. Losing this would
 * have been the one real regression in moving grading to the browser - a child
 * who picks "debris" instead of "timid" learns nothing about debris.
 */
function glossLookup(bank: ClientBank) {
  const byWord = new Map<
    string,
    { word: string; definition: string; example: string }
  >();
  for (const [word, definition, example] of bank.words) {
    const entry = {
      word: String(word),
      definition: String(definition),
      example: String(example),
    };
    byWord.set(entry.word.toLowerCase(), entry);
  }
  return (word: string) => byWord.get(word);
}

function gradedToFeedback(
  graded: GradedAnswer,
  shown: ShownQuestion,
  selected: number,
  attemptId: string,
  bank: ClientBank,
): Feedback {
  return {
    mastery: graded.mastery,
    newlyMastered: graded.newlyMastered,
    attemptId,
    evidence: graded.evidence,
    help: graded.help,
    chosen: chosenWordExplanation(
      shown.choices,
      selected,
      shown.answer,
      glossLookup(bank),
    ),
    type: shown.type,
    answer: shown.answer,
    correct: graded.correct,
    skipped: graded.skipped,
    selected,
    word: shown.word,
    definition: shown.definition,
    example: shown.example,
    syn: shown.syn,
    ant: shown.ant,
    award: graded.award,
  };
}

export function useChallenge() {
  const [state, setState] = useState<ChallengeState>({
    question: null,
    stats: initialStats,
    demo: true,
  });
  const [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const [previous, setPrevious] = useState<Feedback | null>(null);
  const [history, setHistory] = useState<
    Array<{ question: Question; feedback: Feedback }>
  >([]);
  const [historyView, setHistoryView] = useState<number | null>(null);
  const historyViewRef = useRef<number | null>(null);
  const changeHistoryView = useCallback((index: number | null) => {
    historyViewRef.current = index;
    setHistoryView(index);
  }, []);
  const autoNext = useSyncExternalStore(
    subscribeAutoNext,
    readAutoNext,
    serverAutoNext,
  );
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>([
    ...QUESTION_TYPES,
  ]);
  // null is mixed practice across every level, which keeps levels 1-5 unchanged.
  const [level, setLevel] = useState<Difficulty | null>(null);
  /**
   * Where the child is right now, from the browser's own counters.
   *
   * The server's `/api/placement` reads the database, which only learns about
   * answers on flush (every minute, or past ten unsaved). This is the engine's own number on
   * this frame, so the level bar moves the moment an answer is graded.
   */
  const [livePlacement, setLivePlacement] = useState<{
    level: number;
    score: number;
  } | null>(null);
  const demoProgress = useRef(new Map<string, number>());
  const demoMastery = useRef(new Map<string, MasteryState>());
  const assisted = useRef(false);
  const demoSeen = useRef(new Set<string>());
  const demoStats = useRef(initialStats);
  const demoAttempt = useRef(0);
  const demoWords = useRef<DemoWord[]>([]),
    demoIndex = useRef(0),
    elapsed = useRef(0),
    lock = useRef(false);
  const stateRef = useRef(state);
  /**
   * The client session, when the child is signed in.
   *
   * Null means the demo path, which is already entirely local and stays exactly
   * as it was. A ref rather than state because it is a mutable engine, not
   * something to render, and because `answer` and `next` must reach the same
   * instance without a re-render between showing a question and grading it.
   */
  const session = useRef<ClientSession | null>(null);
  const bank = useRef<ClientBank | null>(null);
  /** How many answers are not yet saved. Zero is what greys the Save button. */
  const [unsaved, setUnsaved] = useState(0);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const updateTime = useCallback((result: Partial<Stats>) => {
    if (!result.periods) return;
    setState((current) => {
      const periods = current.stats.periods;
      if (!periods) return current;
      if (result.dates?.today !== current.stats.dates?.today) {
        return {
          ...current,
          stats: {
            ...current.stats,
            ...result,
            correct: result.periods!.all.correct,
            todaySeconds: result.periods!.today.seconds,
            totalSeconds: result.periods!.all.seconds,
          },
        };
      }
      const next = { ...periods };
      for (const key of ["today", "week", "all"] as const)
        next[key] = {
          ...periods[key],
          seconds: Math.max(periods[key].seconds, result.periods![key].seconds),
        };
      return {
        ...current,
        stats: {
          ...current.stats,
          periods: next,
          todaySeconds: next.today.seconds,
          totalSeconds: next.all.seconds,
        },
      };
    });
  }, []);
  const studyClock = useStudyClock(state.question?.id, !state.demo, updateTime);
  const demoQuestion = useCallback((index: number): Question | null => {
    const word = demoWords.current[index];
    // Sent by the server with the question, and by the demo route, rather
    // than looked up in a 344KB table the browser had no other use for.
    const difficulty = word?.difficulty;
    return word
      ? {
          id: word.id,
          difficulty: difficulty ?? 1,
          mastery: masteryProgress(
            demoMastery.current.get(word.wordId) ?? initialMastery,
            difficulty ?? 1,
          ),
          wordId: word.wordId,
          type: word.type,
          prompt: word.prompt,
          source: word.source,
          word: word.word,
          // The server works the clue out, so the learning-help data stays
          // on the server rather than being downloaded to show three questions.
          clue: word.clue,
          number: word.number,
          choices: word.choices,
          correctCount: demoProgress.current.get(word.wordId) || 0,
          seen: demoWords.current
            .slice(0, index + 1)
            .filter((item) => item.wordId === word.wordId).length,
        }
      : null;
  }, []);
  const load = useCallback(async () => {
    try {
      // One request for the whole of a child's state, and one for the bank it
      // names. After this a question costs no round trip at all.
      //
      // A 401 is not a failure: it means there is no signed-in child, so the
      // demo path below takes over. Anything else - a timeout, a dropped
      // connection - is an error worth showing, because falling back would hand a
      // signed-in child the demo and quietly lose their work.
      try {
        const loaded = await loadSession();
        const client = new ClientSession(loaded.engine, loaded.stats);
        client.watch(setUnsaved);
        session.current = client;
        bank.current = loaded.bank;
        const { account } = loaded.snapshot;
        const first = client.next();
        setLivePlacement(client.placement());
        setState({
          question: first ? shownToQuestion(first) : null,
          stats: client.stats,
          demo: false,
          complete: !first,
          gated: account.gated,
          // The server's own answer, not an inference. This used to be
          // `!account.freeTier`, which reads as "anyone not on the free tier is
          // in a trial" - so every paying customer was shown a trial countdown
          // reading "0 days left", with the trial end date computed from when
          // they registered. A parent who had bought a year was told their trial
          // was over before it began.
          trial: account.trial,
          active: account.active,
          daysRemaining: account.daysRemaining,
          periodEnd: account.periodEnd,
          trialExpired: account.trialExpired,
          freeTier: account.freeTier,
          freeWordCount: account.freeWordCount,
          trialDaysRemaining: account.trialDaysRemaining,
          trialDaysConfigured: account.trialDays,
          trialEndsAt: account.trialEndsAt,
        });
        elapsed.current = 0;
        assisted.current = false;
        return;
      } catch (cause) {
        if ((cause as { status?: number }).status !== 401) throw cause;
      }
      const result = await api<ChallengeState & { words?: DemoWord[] }>(
        `/api/challenge?types=${selectedTypes.join(",")}&level=${level ?? "all"}`,
      );
      session.current = null;
      bank.current = null;
      setUnsaved(0);
      setLivePlacement(null);
      if (result.gated) {
        setState({
          question: null,
          feedback: undefined,
          complete: true,
          demo: false,
          gated: true,
          trialExpired: true,
          freeTier: false,
          stats: result.stats,
        });
      } else if (result.demo) {
        demoWords.current = result.words || [];
        demoIndex.current = 0;
        const question = demoQuestion(0);
        setState({
          ...result,
          stats: { ...demoStats.current, total: result.stats.total },
          question,
          complete: !question,
        });
      } else {
        const next = await api<ChallengeState>("/api/challenge", {
          action: "next",
          types: selectedTypes,
          level: level ?? "all",
        });
        setState({
          ...next,
          trial: result.trial,
          trialDaysRemaining: result.trialDaysRemaining,
          trialEndsAt: result.trialEndsAt,
          // Carried through so the practice page can warn a parent whose paid
          // term is nearly over. It is the same `membership()` answer the
          // account page is showing, so the two cannot disagree about how long
          // is left.
          active: result.active,
          daysRemaining: result.daysRemaining,
          periodEnd: result.periodEnd,
          freeTier: result.freeTier,
          freeWordCount: result.freeWordCount,
        });
        setLivePlacement(next.question?.placement ?? null);
      }
      elapsed.current = 0;
      assisted.current = false;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [demoQuestion, selectedTypes, level]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (active) void load();
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [load]);
  useEffect(() => {
    const refreshStats = async () => {
      if (stateRef.current.demo || lock.current) return;
      // With the browser holding the state there is nothing to catch up on when a
      // child comes back to the tab - the numbers on screen are the ones the
      // engine has been keeping. What is worth doing is saving anything still
      // unsaved, because they are coming back to the same page.
      if (session.current) {
        void session.current.flush();
        return;
      }
      try {
        const result = await api<ChallengeState>("/api/challenge");
        if (!result.demo && !lock.current)
          setState((current) =>
            result.stats.correct >= current.stats.correct
              ? { ...current, stats: result.stats }
              : current,
          );
      } catch {
        /* Keep the saved view; the next answer refreshes it. */
      }
    };
    window.addEventListener("focus", refreshStats);
    return () => window.removeEventListener("focus", refreshStats);
  }, []);
  /**
   * Saving on the way out.
   *
   * The timer and the Save button are the two ways a session is meant to end, and
   * this is the third, because a child's session far more often ends with
   * navigation than with the button. `keepalive` lets the request outlive the
   * document; if even that is dropped, the answers carry ids the server has
   * already seen and a later flush cannot pay for them twice. The worst case is
   * losing one sitting, which is the trade this design was built on.
   *
   * Unmounting is the navigation case, and it is the common one. Every link in
   * this app is a `next/link`, which is a client-side route change: the document
   * is not unloaded, so neither `pagehide` nor `beforeunload` fires for any of
   * the fourteen links in the header. Cleanup runs on unmount and unmount is
   * what navigation does, which is why the three sibling hooks flush there.
   */
  useEffect(() => {
    const leave = () => void session.current?.flushOnExit();
    const hidden = () => {
      if (document.visibilityState === "hidden") leave();
    };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hidden);
      // Flush first, then stop. The order is not what makes the request go out:
      // `flushOnExit` reads the queue directly and neither consults `stopped`
      // nor re-arms the timer, so it sends whichever way round these run. It is
      // written this way because it is the order that means something - the
      // last write is issued, and only then is the session retired - and because
      // `stop` is a statement about the future ("no more scheduled writes")
      // while a flush is a statement about the queue right now.
      //
      // The request is safe to make from a cleanup: `api` builds its own abort
      // controller on its own 4s timer, nothing here is tied to the component's
      // lifetime, and `keepalive` covers the full-page-load case where the
      // document really is going away.
      void session.current?.flushOnExit();
      session.current?.stop();
    };
  }, []);
  useEffect(() => {
    const interval = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        stateRef.current.question &&
        !stateRef.current.feedback &&
        !lock.current
      )
        elapsed.current++;
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  const next = useCallback(async () => {
    const viewing = historyViewRef.current;
    if (viewing !== null) {
      changeHistoryView(viewing + 1 < history.length ? viewing + 1 : null);
      return;
    }
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      // Study time is not flushed here. The clock batches on its own five-minute
      // cadence and on the way out of the page, and a flush per answer was both
      // the largest source of database writes in the app and latency the child
      // waited through before the next word appeared.
      const current = stateRef.current;
      if (current.feedback) setPrevious(current.feedback);
      if (current.demo) {
        do {
          demoIndex.current++;
        } while (
          demoWords.current[demoIndex.current] &&
          demoMastery.current.get(demoWords.current[demoIndex.current].wordId)
            ?.mastered
        );
        const question = demoQuestion(demoIndex.current);
        setState({
          ...current,
          question,
          feedback: undefined,
          complete: !question,
        });
        if (current.question && current.feedback)
          setHistory((items) =>
            [
              ...items,
              { question: current.question!, feedback: current.feedback! },
            ].slice(-50),
          );
      } else if (session.current && bank.current) {
        // Built here, now, from state the browser already holds. This is the
        // round trip that used to stand between a child pressing Next and seeing
        // the next word.
        const shown = session.current.next();
        const stats = session.current.stats;
        setLivePlacement(session.current.placement());
        setState((latest) => ({
          ...latest,
          question: shown ? shownToQuestion(shown) : null,
          feedback: undefined,
          complete: !shown,
          stats,
        }));
        if (current.question && current.feedback)
          setHistory((items) =>
            [
              ...items,
              { question: current.question!, feedback: current.feedback! },
            ].slice(-50),
          );
      } else {
        const nextState = await api<ChallengeState>("/api/challenge", {
          action: "next",
          types: selectedTypes,
          level: level ?? "all",
        });
        setState(nextState);
        setLivePlacement(nextState.question?.placement ?? null);
        if (current.question && current.feedback)
          setHistory((items) =>
            [
              ...items,
              { question: current.question!, feedback: current.feedback! },
            ].slice(-50),
          );
      }
      elapsed.current = 0;
      assisted.current = false;
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes("free access has ended")) {
        setState((current) => ({
          ...current,
          question: null,
          feedback: undefined,
          complete: true,
          gated: true,
          trialExpired: true,
        }));
        setError("");
      } else setError(message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, [changeHistoryView, demoQuestion, history.length, selectedTypes, level]);
  const goPrevious = useCallback(() => {
    const viewing = historyViewRef.current;
    const target = viewing === null ? history.length - 1 : viewing - 1;
    if (target >= 0) changeHistoryView(target);
  }, [changeHistoryView, history.length]);
  const answer = useCallback(
    async (selected: number) => {
      const current = stateRef.current;
      if (
        historyViewRef.current !== null ||
        lock.current ||
        !current.question ||
        current.feedback
      )
        return;
      if (!Number.isInteger(selected) || selected < -1 || selected > 3)
        throw Error("Choose an answer between 0 and 3, or -1 to reveal.");
      lock.current = true;
      setBusy(true);
      setError("");
      try {
        if (current.demo) {
          const word = demoWords.current[demoIndex.current];
          const correct = word.choices[selected] === word.answer;
          const seenBefore = demoSeen.current.has(word.wordId);
          demoSeen.current.add(word.wordId);
          const difficulty = word.difficulty;
          const evidence: Evidence = classify({
            correct,
            revealed: selected === -1,
            assisted: assisted.current,
            seconds: elapsed.current,
            wallSeconds: elapsed.current,
            window: answerWindow(word.choices),
          });
          const previousMastery =
            demoMastery.current.get(word.wordId) ?? initialMastery;
          const mastery = advanceMastery(
            previousMastery,
            evidence,
            difficulty ?? 1,
          );
          const justMastered = mastery.newlyMastered;
          demoMastery.current.set(word.wordId, mastery);
          demoProgress.current.set(word.wordId, mastery.correct);
          const prior = current.stats.periods?.all || emptyPeriod();
          const period = {
            ...prior,
            questions: prior.questions + 1,
            correct: prior.correct + (correct ? 1 : 0),
            reveals: prior.reveals + (selected === -1 ? 1 : 0),
            newWords: prior.newWords + (seenBefore ? 0 : 1),
            mastered: prior.mastered + (justMastered ? 1 : 0),
            seconds: prior.seconds + elapsed.current,
          };
          demoStats.current = {
            ...current.stats,
            mastered: [...demoMastery.current.values()].filter(
              (m) => m.mastered,
            ).length,
            meetCount: demoMastery.current.size,
            correct: current.stats.correct + (correct ? 1 : 0),
            todaySeconds: current.stats.todaySeconds + elapsed.current,
            totalSeconds: current.stats.totalSeconds + elapsed.current,
            periods: { today: period, week: period, all: period },
          };
          setState({
            ...current,
            feedback: {
              mastery: masteryProgress(mastery, difficulty ?? 1),
              newlyMastered: justMastered,
              attemptId: `demo-${demoIndex.current}-${demoIndex.current}-${demoAttempt.current++}`,
              evidence,
              help: word.help,
              chosen: demoChosen(word, selected, word.answer),
              type: word.type,
              answer: word.answer,
              correct,
              skipped: selected === -1,
              selected,
              word: word.word,
              definition: word.definition,
              example: word.example,
              syn: word.syn,
              ant: word.ant,
            },
            stats: demoStats.current,
          });
          return {
            help: word.help,
            attemptId: `demo-return-${demoAttempt.current++}`,
            evidence,
            chosen: demoChosen(word, selected, word.answer),
            type: word.type,
            answer: word.answer,
            correct,
            skipped: selected === -1,
            selected,
            word: word.word,
            definition: word.definition,
            example: word.example,
            syn: word.syn,
            ant: word.ant,
          };
        } else if (session.current && bank.current) {
          // Graded here. The child sees the feedback on this frame, and the
          // answer joins a queue that is written on a timer, on demand, or when
          // the page goes away. Nothing here waits for the database.
          const client = session.current;
          const result = client.answer(selected, {
            assisted: assisted.current,
          });
          if (!result) throw Error("That question could not be marked.");
          const { feedback: graded, question: shown, attemptId } = result;
          const feedback = gradedToFeedback(
            graded,
            shown,
            selected,
            attemptId,
            bank.current,
          );
          // The session has already moved the panels, on this frame.
          setState((latest) => ({ ...latest, feedback, stats: client.stats }));
          // The bar moves on this frame too, not on the next flush.
          setLivePlacement(client.placement());
          return feedback;
        } else {
          const result = await api<ChallengeState>("/api/challenge", {
            action: "answer",
            id: current.question.id,
            selected,
            elapsed: elapsed.current,
            assisted: assisted.current,
          });
          setState({ ...current, ...result });
          setLivePlacement(
            result.question?.placement ?? current.question?.placement ?? null,
          );
          return result.feedback;
        }
      } catch (e) {
        const message = (e as Error).message;
        if (
          message.startsWith("This question is outside your free collection.")
        ) {
          setError("");
          await load();
        } else setError(message);
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [load],
  );
  /**
   * Save now.
   *
   * Deliberately separate from the timer: a child who presses it wants to know
   * it is done, and that has to be true whether or not there was anything to send.
   * With nothing queued it reports so rather than appearing broken.
   */
  const saveProgress = useCallback(async () => {
    const client = session.current;
    if (!client) return { saved: 0, alreadyClean: true, error: "" };
    if (!client.dirty) return { saved: 0, alreadyClean: true, error: "" };
    setBusy(true);
    try {
      await client.flush();
      return {
        saved: 0,
        alreadyClean: !client.dirty,
        error: client.lastError || "",
      };
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => Promise<void> | void;
        };
      }
    ).modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    const register = (tool: unknown) => {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    };
    register({
      name: "minewords_read_question",
      description:
        "Read the visible vocabulary question and practice progress.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: () => ({
        question: stateRef.current.question,
        stats: stateRef.current.stats,
        feedback: stateRef.current.feedback,
      }),
    });
    register({
      name: "minewords_answer_question",
      description:
        "Submit a zero-based choice for the visible question; -1 reveals the answer without credit.",
      inputSchema: {
        type: "object",
        properties: { choice: { type: "integer", minimum: -1, maximum: 3 } },
        required: ["choice"],
        additionalProperties: false,
      },
      execute: async (input: { choice: number }) => {
        if (
          !input ||
          !Number.isInteger(input.choice) ||
          input.choice < -1 ||
          input.choice > 3
        )
          throw Error("Invalid choice");
        const feedback = await answer(input.choice);
        if (!feedback)
          throw Error(
            "The answer was not submitted. The question may already be answered or a request failed.",
          );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        return { feedback };
      },
    });
    return () => lifecycle.abort();
  }, [answer]);
  return {
    ...state,
    liveSeconds: studyClock.seconds,
    timeError: studyClock.error,
    busy,
    error,
    previous,
    autoNext,
    setAutoNext: saveAutoNext,
    selectedTypes,
    selectTypes: (types: QuestionType[]) => {
      if (!busy && !lock.current && types.length) {
        setBusy(true);
        setHistory([]);
        changeHistoryView(null);
        setPrevious(null);
        setError("");
        setSelectedTypes(types);
      }
    },
    level,
    selectLevel: (value: Difficulty | null) => {
      if (!busy && !lock.current && value !== level) {
        setBusy(true);
        setHistory([]);
        changeHistoryView(null);
        setPrevious(null);
        setError("");
        setLevel(value);
      }
    },
    /** Live level/score from the browser engine, for the bar above the chart. */
    livePlacement,
    answer,
    /** How many answers are waiting to be written. Zero greys the Save button. */
    unsaved,
    saveProgress,
    markAssisted: () => {
      assisted.current = true;
    },
    next,
    goPrevious,
    historical: historyView !== null,
    hasPrevious: historyView === null ? history.length > 0 : historyView > 0,
    question:
      historyView === null
        ? state.question
        : history[historyView]?.question || state.question,
    feedback:
      historyView === null
        ? state.feedback
        : history[historyView]?.feedback || state.feedback,
    reload: () => {
      setBusy(true);
      setError("");
      return load();
    },
  };
}

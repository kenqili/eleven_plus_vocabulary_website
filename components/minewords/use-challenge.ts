"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useStudyClock } from "./use-study-clock";
import { emptyPeriod } from "@/lib/challenge/rewards";
import {
  QUESTION_TYPES,
  MASTERY_TARGET,
  type QuestionType,
} from "@/lib/challenge/config";
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
  choices: string[];
};
const initialStats: Stats = {
  total: 0,
  mastered: 0,
  correct: 0,
  todaySeconds: 0,
  totalSeconds: 0,
};
export function useChallenge() {
  const [state, setState] = useState<ChallengeState>({
    question: null,
    stats: initialStats,
    demo: true,
  });
  const [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const [previous, setPrevious] = useState<Feedback | null>(null);
  const [autoNext, setAutoNext] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>([
    ...QUESTION_TYPES,
  ]);
  const demoProgress = useRef(new Map<string, number>());
  const demoSeen = useRef(new Set<string>());
  const demoStats = useRef(initialStats);
  const demoWords = useRef<DemoWord[]>([]),
    demoIndex = useRef(0),
    elapsed = useRef(0),
    lock = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
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
  const flushTime = studyClock.flush;
  const demoQuestion = useCallback((index: number): Question | null => {
    const word = demoWords.current[index];
    return word
      ? {
          id: word.id,
          wordId: word.wordId,
          type: word.type,
          prompt: word.prompt,
          source: word.source,
          word: word.word,
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
    setBusy(true);
    setError("");
    try {
      const result = await api<ChallengeState & { words?: DemoWord[] }>(
        `/api/challenge?types=${selectedTypes.join(",")}`,
      );
      if (result.demo) {
        demoWords.current = result.words || [];
        demoIndex.current = 0;
        const question = demoQuestion(0);
        setState({
          ...result,
          stats: { ...demoStats.current, total: result.stats.total },
          question,
          complete: !question,
        });
      } else
        setState(
          await api<ChallengeState>("/api/challenge", {
            action: "next",
            types: selectedTypes,
          }),
        );
      elapsed.current = 0;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [demoQuestion, selectedTypes]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const refreshStats = async () => {
      if (stateRef.current.demo || lock.current) return;
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
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await flushTime();
      const current = stateRef.current;
      if (current.feedback) setPrevious(current.feedback);
      if (current.demo) {
        demoIndex.current++;
        const question = demoQuestion(demoIndex.current);
        setState({
          ...current,
          question,
          feedback: undefined,
          complete: !question,
        });
      } else
        setState(
          await api<ChallengeState>("/api/challenge", {
            action: "next",
            types: selectedTypes,
          }),
        );
      elapsed.current = 0;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, [demoQuestion, selectedTypes, flushTime]);
  const answer = useCallback(
    async (selected: number) => {
      const current = stateRef.current;
      if (lock.current || !current.question || current.feedback) return;
      if (!Number.isInteger(selected) || selected < -1 || selected > 3)
        throw Error("Choose an answer between 0 and 3, or -1 to reveal.");
      lock.current = true;
      setBusy(true);
      setError("");
      try {
        await flushTime();
        if (current.demo) {
          const word = demoWords.current[demoIndex.current];
          const correct = word.choices[selected] === word.answer;
          const seenBefore = demoSeen.current.has(word.wordId);
          demoSeen.current.add(word.wordId);
          const justMastered =
            correct &&
            demoProgress.current.get(word.wordId) === MASTERY_TARGET - 1;
          if (correct)
            demoProgress.current.set(
              word.wordId,
              Math.min(
                MASTERY_TARGET,
                (demoProgress.current.get(word.wordId) || 0) + 1,
              ),
            );
          const prior = current.stats.periods?.all || emptyPeriod();
          const period = {
            ...prior,
            questions: prior.questions + 1,
            correct: prior.correct + (correct ? 1 : 0),
            reveals: prior.reveals + (selected === -1 ? 1 : 0),
            newWords: prior.newWords + (seenBefore ? 0 : 1),
            words: prior.words + (seenBefore ? 0 : 1),
            mastered: prior.mastered + (justMastered ? 1 : 0),
            seconds: prior.seconds + elapsed.current,
          };
          demoStats.current = {
            ...current.stats,
            mastered: [...demoProgress.current.values()].filter(
              (count) => count >= MASTERY_TARGET,
            ).length,
            correct: current.stats.correct + (correct ? 1 : 0),
            todaySeconds: current.stats.todaySeconds + elapsed.current,
            totalSeconds: current.stats.totalSeconds + elapsed.current,
            periods: { today: period, week: period, all: period },
            inProgress: [...demoProgress.current.values()].filter(
              (count) => count > 0 && count < MASTERY_TARGET,
            ).length,
          };
          setState({
            ...current,
            feedback: {
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
        } else {
          const result = await api<ChallengeState>("/api/challenge", {
            action: "answer",
            id: current.question.id,
            selected,
            elapsed: elapsed.current,
          });
          setState({ ...current, ...result });
          return result.feedback;
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [flushTime],
  );
  useEffect(() => {
    if (!autoNext || !state.feedback?.correct || busy || error) return;
    const timer = setTimeout(() => void next(), 1400);
    return () => clearTimeout(timer);
  }, [autoNext, state.feedback, busy, error, next]);
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
    setAutoNext,
    selectedTypes,
    selectTypes: (types: QuestionType[]) => {
      if (!busy && !lock.current && types.length) {
        setBusy(true);
        setPrevious(null);
        setSelectedTypes(types);
      }
    },
    answer,
    next,
    reload: load,
  };
}

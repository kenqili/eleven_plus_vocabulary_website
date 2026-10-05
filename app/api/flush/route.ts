import { rateLimit, requireUser } from "@/lib/server/auth";
import { membership } from "@/lib/server/billing";
import { boundary, HttpError, json, sameOrigin } from "@/lib/server/http";
import { freeWordIds } from "@/lib/server/free-words";
import { statsFor } from "@/lib/server/challenge";
import {
  applyFlushed,
  type FlushedAnswer,
  type FlushedState,
} from "@/lib/server/flush";
import { CHOICES_PER_PROBLEM as CHOICES } from "@/lib/challenge/bank";
import { QUESTION_TYPES } from "@/lib/challenge/config";
import type { QuestionType } from "@/lib/challenge/config";

/**
 * Everything the browser worked out in the last minute, in one request.
 *
 * A flush is either the timer, or the child pressing Save because they are done,
 * or the page going away. It is never on the critical path - the child has already
 * moved on - so the shape here favours being correct and batched over being
 * quick, and the response carries the authoritative stats so the browser can
 * reconcile whatever it worked out in the meantime.
 */

/** A long sitting: the timer at one minute, or a child who forgot to press Save. */
const MAX_ANSWERS = 400;
const MAX_ELAPSED = 3600;

function parseAnswers(raw: unknown): FlushedAnswer[] {
  if (!Array.isArray(raw)) throw new HttpError(400, "Nothing to save.");
  if (raw.length > MAX_ANSWERS)
    throw new HttpError(400, "That is more questions than one sitting holds.");
  return raw.map((entry) => {
    const a = (entry ?? {}) as Record<string, unknown>;
    const wordId = String(a.wordId ?? "");
    const type = String(a.type ?? "") as QuestionType;
    const selected = Number(a.selected);
    const id = String(a.id ?? "");
    if (!wordId || !QUESTION_TYPES.includes(type))
      throw new HttpError(400, "A saved answer is not one we can read.");
    if (!id)
      throw new HttpError(400, "A saved answer has no id to deduplicate on.");
    if (!Number.isInteger(selected) || selected < -1 || selected > CHOICES - 1)
      throw new HttpError(
        400,
        "A saved answer names an option that was not offered.",
      );
    if (!Array.isArray(a.choices) || a.choices.length !== CHOICES)
      throw new HttpError(
        400,
        "A saved answer has the wrong number of options.",
      );
    return {
      id,
      wordId,
      type,
      // Ignored for a bank word - the bank supplies the real one - and only
      // trusted for a parent's own word, which is not in the bank.
      answer: String(a.answer ?? ""),
      choices: a.choices.map(String),
      selected,
      // Clamped, because this is a claim about a child's attention and an
      // unbounded one would let a single record sit in a parent's reading time.
      elapsed: Math.min(MAX_ELAPSED, Math.max(0, Number(a.elapsed) || 0)),
      shownAt: Number(a.shownAt) || Date.now(),
      revealed: Boolean(a.revealed) || selected === -1,
      assisted: Boolean(a.assisted),
      evidence: String(a.evidence ?? "unknown"),
    };
  });
}

function parseState(raw: unknown): FlushedState {
  const progress = (raw as { progress?: unknown } | null)?.progress;
  if (!Array.isArray(progress)) return { progress: [] };
  if (progress.length > 4000)
    throw new HttpError(400, "That is more words than a child has met.");
  return {
    progress: progress.map((row) => {
      const r = row as unknown[];
      return [
        String(r[0] ?? ""),
        Number(r[1]) || 0,
        Number(r[2]) || 0,
        Number(r[3]) || 0,
        Number(r[4]) || 0,
        Number(r[5]) || 0,
        r[6] == null ? null : String(r[6]),
        r[7] == null ? null : Number(r[7]),
      ];
    }),
  };
}

export async function POST(request: Request) {
  return boundary(async () => {
    sameOrigin(request);
    const user = await requireUser(request);
    // Generous, because a flush is a batch and a child pressing Save twice in
    // five minutes is not abuse. Still bounded.
    await rateLimit(`flush:${user.id}`, 120);
    const body = (await request.json()) as {
      answers?: unknown;
      state?: unknown;
    };
    const answers = parseAnswers(body.answers ?? []);
    const state = parseState(body.state);
    if (!answers.length && !state.progress.length)
      return json({ saved: 0, skipped: 0, stats: await statsFor(user.id) });

    const access = await membership(user);
    const allowed = access.access ? undefined : freeWordIds();
    const result = await applyFlushed(user.id, answers, state, allowed);
    return json({ ...result, stats: await statsFor(user.id, allowed) });
  });
}

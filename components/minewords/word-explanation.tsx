"use client";
import type { Feedback } from "@/lib/challenge/types";
import { TYPE_LABELS } from "@/lib/challenge/config";

/**
 * A dash or blank in the bank means no relation was recorded for that word, so
 * there is nothing to show. The row is left out rather than filled with a
 * placeholder: a child who gets a word wrong and then reads "Opposite words:
 * not provided" concludes the app is broken, or worse, that the word has no
 * opposite. Absence says nothing false.
 */
const has = (value: string) => !!value?.trim() && !/^[—–-]$/.test(value.trim());

/** Shared by answer feedback and read-only previous-word review. */
export default function WordExplanation({ word }: { word: Feedback }) {
  // On a definition question the correct answer is the meaning itself, so the
  // meaning row is the answer. Without this the one question type that is the
  // default never actually showed the right answer in words, leaving the child
  // to spot a tick on a button and work backwards.
  const answerIsMeaning = word.type === "def";
  return (
    <dl className="word-explanation">
      {!answerIsMeaning && (
        <div>
          <dt>Correct {TYPE_LABELS[word.type].toLowerCase()}</dt>
          <dd>{word.answer}</dd>
        </div>
      )}
      <div>
        <dt>{answerIsMeaning ? "The meaning is" : "Meaning"}</dt>
        {/* The help text is worked out on the server and arrives with the
            answer, so the learning-help data stays off the client. */}
        <dd>{word.help || word.definition}</dd>
      </div>
      {has(word.example) ? (
        <div>
          <dt>Example</dt>
          <dd>{word.example}</dd>
        </div>
      ) : null}
      {has(word.syn) ? (
        <div>
          <dt>Similar words (synonyms)</dt>
          <dd>{word.syn}</dd>
        </div>
      ) : null}
      {has(word.ant) ? (
        <div>
          <dt>Opposite words (antonyms)</dt>
          <dd>{word.ant}</dd>
        </div>
      ) : null}
    </dl>
  );
}

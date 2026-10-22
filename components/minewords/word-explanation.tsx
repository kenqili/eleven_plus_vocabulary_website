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

const escape = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The example with the answer inside it picked out.
 *
 * Used by a fill-the-gap question, where the sentence is the only place the
 * answer can be read in context: the question card keeps the gap it showed
 * before the answer, so a bare word here would leave the sentence unfinished on
 * screen for good.
 */
function CompletedSentence({
  sentence,
  word,
}: {
  sentence: string;
  word: string;
}) {
  if (!word) return <>{sentence}</>;
  const parts = sentence.split(new RegExp(`(${escape(word)})`, "i"));
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === word.toLowerCase() ? (
          <strong key={index}>{part}</strong>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** Shared by answer feedback and read-only previous-word review. */
export default function WordExplanation({ word }: { word: Feedback }) {
  // On a definition question the correct answer is the meaning itself, so the
  // meaning row is the answer. Without this the one question type that is the
  // default never actually showed the right answer in words, leaving the child
  // to spot a tick on a button and work backwards.
  const answerIsMeaning = word.type === "def";
  /**
   * A fill-the-gap question is made by blanking the word out of its own example,
   * so the sentence the child answered *is* the example. Printing the bare word
   * under "Correct sentence" and then the sentence again under "Example" said
   * the sentence twice and the word once - and the label promised something the
   * row did not contain.
   *
   * There is no new example to write: the question is built from the example, so
   * the row could only ever repeat it. Instead the sentence appears once, here,
   * completed - which is what the label says it is - and the example row is
   * dropped rather than shown twice.
   */
  const answerIsSentence =
    word.type === "cloze" &&
    has(word.example) &&
    new RegExp(escape(word.answer), "i").test(word.example);
  return (
    <dl className="word-explanation">
      {!answerIsMeaning && (
        <div>
          <dt>Correct {TYPE_LABELS[word.type].toLowerCase()}</dt>
          <dd>
            {answerIsSentence ? (
              <CompletedSentence sentence={word.example} word={word.answer} />
            ) : (
              word.answer
            )}
          </dd>
        </div>
      )}
      <div>
        <dt>{answerIsMeaning ? "The meaning is" : "Meaning"}</dt>
        {/* The help text is worked out on the server and arrives with the
            answer, so the learning-help data stays off the client. */}
        <dd>{word.help || word.definition}</dd>
      </div>
      {has(word.example) && !answerIsSentence ? (
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
